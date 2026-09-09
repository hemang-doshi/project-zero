import Combine
import Foundation
import ZeroKit

public enum RuntimeCommandState: Equatable, Sendable {
    case idle
    case submitting(id: String, operation: String)
    case uncertain(id: String, operation: String, message: String)
    case blocked(operation: String, message: String)
    case rejected(operation: String, message: String)

    public var isSubmitting: Bool {
        if case .submitting = self { return true }
        return false
    }
}

@MainActor
public final class CockpitModel: ObservableObject {
    @Published public var selection = CockpitSelection()
    @Published public private(set) var commandState: RuntimeCommandState = .idle
    @Published public private(set) var isWindowActive = false
    @Published public private(set) var clock = Date()
    @Published public private(set) var codexActionError: String?

    public let socketPath: String
    public let runtime: CockpitClient
    public let codex: CodexAppServer

    private let sendCommand: ([String: Any]) async throws -> Any
    private let resolveProjectPath: (String) async throws -> String
    private let userDefaults: UserDefaults?
    private let pendingDefaultsKey: String
    private var pendingCommand: [String: Any]?
    private var clockTask: Task<Void, Never>?
    private var subscriptions: Set<AnyCancellable> = []
    private var previewConnection: RuntimeConnectionState?

    public init(
        socketPath: String? = nil,
        client: CockpitClient? = nil,
        codex: CodexAppServer? = nil,
        sendCommand: (([String: Any]) async throws -> Any)? = nil,
        resolveProjectPath: ((String) async throws -> String)? = nil,
        userDefaults: UserDefaults? = .standard
    ) {
        let resolvedSocket = socketPath ?? Self.commandLineSocketPath()
        self.socketPath = resolvedSocket
        self.runtime = client ?? CockpitClient(socketPath: resolvedSocket)
        self.codex = codex ?? CodexAppServer()
        self.sendCommand = sendCommand ?? { request in
            try await UnixHTTP.call(socketPath: resolvedSocket, path: "commands", body: request)
        }
        self.resolveProjectPath = resolveProjectPath ?? { projectID in
            var allowed = CharacterSet.urlPathAllowed
            allowed.remove(charactersIn: "/?#%")
            guard let encoded = projectID.addingPercentEncoding(withAllowedCharacters: allowed), !encoded.isEmpty else {
                throw ZeroError("Invalid project identity")
            }
            let value = try await UnixHTTP.call(socketPath: resolvedSocket, path: "projects/\(encoded)")
            guard let envelope = value as? [String: Any],
                  let project = envelope["project"] as? [String: Any],
                  let path = project["path"] as? String,
                  path.hasPrefix("/") else {
                throw ZeroError("Registered project path unavailable")
            }
            return path
        }
        self.userDefaults = userDefaults
        self.pendingDefaultsKey = "pending:\(resolvedSocket)"

        restorePendingCommand()
        bindOwnedClients()
    }

    public static func preview(connection: RuntimeConnectionState = .offline) -> CockpitModel {
        let client = CockpitClient(
            socketPath: "/preview/project-zero.sock",
            fetchSnapshot: { throw ZeroError("Preview runtime is unavailable") },
            openStream: { AsyncThrowingStream { $0.finish() } }
        )
        let model = CockpitModel(
            socketPath: "/preview/project-zero.sock",
            client: client,
            sendCommand: { _ in throw ZeroError("Preview runtime is unavailable") },
            resolveProjectPath: { _ in throw ZeroError("Preview project is unavailable") },
            userDefaults: nil
        )
        model.previewConnection = connection
        return model
    }

    public var snapshot: CockpitSnapshot? { runtime.snapshot }
    public var runtimeConnection: RuntimeConnectionState { previewConnection ?? runtime.state }
    public var codexConnection: CodexConnectionState { codex.state }

    public var runtimeStatusLabel: String {
        switch runtimeConnection {
        case .connecting: "Connecting"
        case .live: "Runtime live"
        case .reconnecting: "Reconnecting"
        case .offline: "Runtime offline"
        }
    }

    public var runtimeStatusTone: ZeroTone {
        switch runtimeConnection {
        case .live: .healthy
        case .connecting, .reconnecting: .attention
        case .offline: .error
        }
    }

    public var activeProjectName: String {
        guard let session = snapshot?.session, session.state != "IDLE", !session.project.isEmpty else {
            return "No active project"
        }
        return session.project
    }

    public var focusElapsedMilliseconds: Int64 {
        guard let session = snapshot?.session else { return 0 }
        guard runtimeConnection == .live,
              session.state == "RUNNING",
              let receivedAt = runtime.receivedAt else { return session.elapsedMS }
        let additional = max(0, clock.timeIntervalSince(receivedAt) * 1_000)
        return session.elapsedMS + Int64(additional)
    }

    public var focusElapsedLabel: String {
        CockpitFormat.elapsed(milliseconds: focusElapsedMilliseconds)
    }

    public var deliveryState: DeliveryState {
        guard runtimeConnection == .live, let snapshot else { return .offline }
        let displayNodes = snapshot.nodes.filter {
            !$0.revoked && ($0.capabilities.contains("display.render") || $0.capabilities.contains("display.clear"))
        }
        guard !displayNodes.isEmpty else {
            return .offline
        }
        guard displayNodes.contains(where: { $0.status == "ONLINE" }) else {
            return displayNodes.contains(where: { $0.status == "SUSPECT" }) ? .stale : .offline
        }
        guard let latest = snapshot.invocations.first(where: {
            $0["capability"].string == "display.render" || $0["capability"].string == "display.clear"
        }) else {
            return snapshot.session.state == "IDLE" ? .stale : .committedLocally
        }
        if let nodeID = latest["node"].string,
           let node = displayNodes.first(where: { $0.id == nodeID }),
           node.status != "ONLINE" {
            return node.status == "SUSPECT" ? .stale : .offline
        }
        switch latest["status"].string?.uppercased() {
        case "SUCCEEDED": return .delivered
        case "DISPATCHED": return .awaitingDelivery
        case "QUEUED", "WAITING_APPROVAL": return .queued
        case "FAILED", "REJECTED", "EXPIRED", "TIMED_OUT", "CANCELLED": return .stale
        default: return .stale
        }
    }

    public var attentionCount: Int {
        let runtimeApprovals = snapshot?.approvals.count ?? 0
        let pendingFirings = snapshot?.firings.filter { $0["state"].string == "PENDING" }.count ?? 0
        let uncertain = pendingCommand == nil ? 0 : 1
        return runtimeApprovals + pendingFirings + codex.store.approvals.count + uncertain
    }

    public var canIssueRuntimeCommand: Bool {
        runtimeConnection == .live && snapshot != nil && pendingCommand == nil && !commandState.isSubmitting
    }

    public var canPauseOrResume: Bool {
        guard canIssueRuntimeCommand, let state = snapshot?.session.state else { return false }
        return state == "RUNNING" || state == "PAUSED"
    }

    public var canEndFocus: Bool {
        canIssueRuntimeCommand && snapshot?.session.state != "IDLE"
    }

    public var hasUncertainRuntimeCommand: Bool { pendingCommand != nil }

    public func windowDidAppear() {
        guard !isWindowActive else { return }
        isWindowActive = true
        previewConnection = nil
        runtime.start()
        runtime.refresh()
        clock = Date()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                guard let self, self.isWindowActive else { return }
                self.clock = Date()
            }
        }
    }

    public func windowDidDisappear() {
        guard isWindowActive else { return }
        isWindowActive = false
        clockTask?.cancel()
        clockTask = nil
        runtime.stop()
    }

    /// Sends a single owner-authorized command through zerod's owner-only Unix
    /// socket. Transport ambiguity retains the same request identity for retry.
    @discardableResult
    public func command(_ operation: String, _ body: [String: Any] = [:]) async -> Bool {
        guard !operation.isEmpty, JSONSerialization.isValidJSONObject(body) else {
            commandState = .blocked(operation: operation, message: "Invalid command payload; no action was sent.")
            return false
        }
        guard canIssueRuntimeCommand else {
            commandState = .blocked(operation: operation, message: "Runtime is offline or unavailable; no action was sent.")
            return false
        }
        let request: [String: Any] = ["id": UUID().uuidString, "op": operation, "body": body]
        pendingCommand = request
        persistPendingCommand()
        return await sendPendingCommand()
    }

    @discardableResult
    public func retryPendingRuntimeCommand() async -> Bool {
        guard pendingCommand != nil else { return false }
        guard runtimeConnection == .live, snapshot != nil else {
            if let operation = pendingCommand?["op"] as? String, let id = pendingCommand?["id"] as? String {
                commandState = .uncertain(id: id, operation: operation, message: "Runtime is offline; retry was not sent.")
            }
            return false
        }
        return await sendPendingCommand()
    }

    @discardableResult
    public func startFocus(projectID: String) async -> Bool {
        guard snapshot?.projects.contains(where: { $0.id == projectID }) == true else {
            commandState = .blocked(operation: "session.start", message: "Select a registered project before starting focus.")
            return false
        }
        return await command("session.start", ["project_id": projectID])
    }

    @discardableResult
    public func pauseFocus() async -> Bool {
        guard snapshot?.session.state == "RUNNING" else {
            commandState = .blocked(operation: "session.pause", message: "The current focus is not running.")
            return false
        }
        return await command("session.pause")
    }

    @discardableResult
    public func resumeFocus() async -> Bool {
        guard snapshot?.session.state == "PAUSED" else {
            commandState = .blocked(operation: "session.resume", message: "The current focus is not paused.")
            return false
        }
        return await command("session.resume")
    }

    @discardableResult
    public func endFocus() async -> Bool {
        guard let revision = snapshot?.session.revision, snapshot?.session.state != "IDLE" else {
            commandState = .blocked(operation: "session.end", message: "There is no active focus to end.")
            return false
        }
        return await command("session.end", ["expected_revision": revision])
    }

    @discardableResult
    public func resolveRuntimeApproval(id: String, approve: Bool) async -> Bool {
        guard snapshot?.approvals.contains(where: { $0["id"].string == id }) == true else {
            commandState = .blocked(operation: "approvals", message: "That exact approval is no longer pending.")
            return false
        }
        return await command(approve ? "approvals.approve" : "approvals.deny", ["id": id])
    }

    @discardableResult
    public func connectCodex() async -> Bool {
        codexActionError = nil
        do {
            try await codex.connect()
            return true
        } catch {
            codexActionError = error.localizedDescription
            return false
        }
    }

    public func disconnectCodex() {
        codex.disconnect()
        codexActionError = nil
    }

    public func startCodexThread(projectID: String, model: String? = nil, mode: CodexMode) async -> String? {
        guard runtimeConnection == .live,
              snapshot?.projects.contains(where: { $0.id == projectID }) == true else {
            codexActionError = "A live registered Project Zero project is required."
            return nil
        }
        do {
            let authoritativePath = try await resolveProjectPath(projectID)
            let id = try await codex.startThread(project: authoritativePath, model: model, mode: mode)
            codexActionError = nil
            return id
        } catch {
            codexActionError = error.localizedDescription
            return nil
        }
    }

    public func startCodexTurn(threadID: String, text: String) async -> String? {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            codexActionError = "Enter a request before sending."
            return nil
        }
        do {
            let id = try await codex.startTurn(threadID: threadID, text: text)
            codexActionError = nil
            return id
        } catch {
            codexActionError = error.localizedDescription
            return nil
        }
    }

    @discardableResult
    public func interruptCodexTurn(turnID: String, threadID: String) async -> Bool {
        do {
            try await codex.interrupt(turnID: turnID, threadID: threadID)
            codexActionError = nil
            return true
        } catch {
            codexActionError = error.localizedDescription
            return false
        }
    }

    @discardableResult
    public func replyToCodexApproval(id: CodexRequestID, response: CodexJSON) -> Bool {
        do {
            try codex.reply(to: id, response: response)
            codexActionError = nil
            return true
        } catch {
            codexActionError = error.localizedDescription
            return false
        }
    }

    private func sendPendingCommand() async -> Bool {
        guard let request = pendingCommand,
              let id = request["id"] as? String,
              let operation = request["op"] as? String else {
            commandState = .blocked(operation: "unknown", message: "Pending action data is invalid.")
            return false
        }
        commandState = .submitting(id: id, operation: operation)
        do {
            _ = try await sendCommand(request)
            pendingCommand = nil
            clearPersistedCommand()
            commandState = .idle
            runtime.refresh()
            return true
        } catch let error as ZeroError where error.rejected {
            pendingCommand = nil
            clearPersistedCommand()
            commandState = .rejected(operation: operation, message: error.localizedDescription)
            runtime.refresh()
            return false
        } catch {
            commandState = .uncertain(
                id: id,
                operation: operation,
                message: "Action was not confirmed: \(error.localizedDescription). Retry preserves its identity."
            )
            return false
        }
    }

    private func bindOwnedClients() {
        runtime.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &subscriptions)
        codex.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &subscriptions)
    }

    private func restorePendingCommand() {
        guard let data = userDefaults?.data(forKey: pendingDefaultsKey),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = value["id"] as? String,
              let operation = value["op"] as? String,
              value["body"] is [String: Any] else {
            return
        }
        pendingCommand = value
        commandState = .uncertain(id: id, operation: operation, message: "A prior action needs an explicit retry.")
    }

    private func persistPendingCommand() {
        guard let pendingCommand,
              let data = try? JSONSerialization.data(withJSONObject: pendingCommand) else { return }
        userDefaults?.set(data, forKey: pendingDefaultsKey)
    }

    private func clearPersistedCommand() {
        userDefaults?.removeObject(forKey: pendingDefaultsKey)
    }

    private static func commandLineSocketPath() -> String {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--socket"), arguments.indices.contains(index + 1) {
            return arguments[index + 1]
        }
        return NSHomeDirectory() + "/Library/Application Support/ProjectZero/zero.sock"
    }
}
