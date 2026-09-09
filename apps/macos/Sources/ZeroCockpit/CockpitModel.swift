import Combine
import Foundation
import ZeroKit

public enum RuntimeCommandValue: Codable, Equatable, Sendable,
    ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral
{
    case object([String: RuntimeCommandValue])
    case array([RuntimeCommandValue])
    case string(String)
    case integer(Int64)
    case number(Double)
    case bool(Bool)
    case null

    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int64) { self = .integer(value) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
        else if let decoded = try? value.decode(Int64.self) { self = .integer(decoded) }
        else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
        else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
        else if let decoded = try? value.decode([RuntimeCommandValue].self) { self = .array(decoded) }
        else { self = .object(try value.decode([String: RuntimeCommandValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let decoded): try value.encode(decoded)
        case .array(let decoded): try value.encode(decoded)
        case .string(let decoded): try value.encode(decoded)
        case .integer(let decoded): try value.encode(decoded)
        case .number(let decoded): try value.encode(decoded)
        case .bool(let decoded): try value.encode(decoded)
        case .null: try value.encodeNil()
        }
    }
}

public struct RuntimeCommandRequest: Codable, Equatable, Sendable {
    public let id: String
    public let op: String
    public let body: [String: RuntimeCommandValue]

    public init(id: String, op: String, body: [String: RuntimeCommandValue] = [:]) {
        self.id = id
        self.op = op
        self.body = body
    }
}

public struct RuntimeCommandResponse: Codable, Equatable, Sendable {
    public let version: String
    public let id: String
    public let status: String

    public init(version: String, id: String, status: String) {
        self.version = version
        self.id = id
        self.status = status
    }
}

public struct RuntimeProjectAuthority: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let path: String

    public init(id: String, name: String, path: String) {
        self.id = id
        self.name = name
        self.path = path
    }
}

public struct RuntimeProjectResponse: Codable, Equatable, Sendable {
    public let version: String
    public let project: RuntimeProjectAuthority

    public init(version: String, project: RuntimeProjectAuthority) {
        self.version = version
        self.project = project
    }
}

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

    private struct DeliveryBaseline: Sendable {
        let commandID: String
        let snapshotRevision: UInt64
        let displayInvocationIDs: Set<String>
    }

    private let sendCommand: @Sendable (RuntimeCommandRequest) async throws -> RuntimeCommandResponse
    private let resolveProject: @Sendable (String) async throws -> RuntimeProjectResponse
    private let userDefaults: UserDefaults?
    private let pendingDefaultsKey: String
    private var pendingCommand: RuntimeCommandRequest?
    private var pendingDeliveryBaseline: DeliveryBaseline?
    private var committedDeliveryBaseline: DeliveryBaseline?
    private var activeSubmissionID: UUID?
    private var clockTask: Task<Void, Never>?
    private var subscriptions: Set<AnyCancellable> = []
    private var previewConnection: RuntimeConnectionState?
    private var runtimeStarted = false
    private var visibleWindowCount = 0

    public init(
        socketPath: String? = nil,
        client: CockpitClient? = nil,
        codex: CodexAppServer? = nil,
        sendCommand: (@Sendable (RuntimeCommandRequest) async throws -> RuntimeCommandResponse)? = nil,
        resolveProject: (@Sendable (String) async throws -> RuntimeProjectResponse)? = nil,
        userDefaults: UserDefaults? = .standard
    ) {
        let resolvedSocket = socketPath ?? Self.commandLineSocketPath()
        self.socketPath = resolvedSocket
        self.runtime = client ?? CockpitClient(socketPath: resolvedSocket)
        self.codex = codex ?? CodexAppServer()
        self.sendCommand = sendCommand ?? { request in
            let encoded = try JSONEncoder().encode(request)
            guard let body = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] else {
                throw ZeroError("Invalid command payload")
            }
            let value = try await UnixHTTP.call(socketPath: resolvedSocket, path: "commands", body: body)
            let response = try JSONSerialization.data(withJSONObject: value)
            return try JSONDecoder().decode(RuntimeCommandResponse.self, from: response)
        }
        self.resolveProject = resolveProject ?? { projectID in
            var allowed = CharacterSet.urlPathAllowed
            allowed.remove(charactersIn: "/?#%")
            guard let encoded = projectID.addingPercentEncoding(withAllowedCharacters: allowed), !encoded.isEmpty else {
                throw ZeroError("Invalid project identity")
            }
            let value = try await UnixHTTP.call(socketPath: resolvedSocket, path: "projects/\(encoded)")
            let response = try JSONSerialization.data(withJSONObject: value)
            return try JSONDecoder().decode(RuntimeProjectResponse.self, from: response)
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
            resolveProject: { _ in throw ZeroError("Preview project is unavailable") },
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
        let displayInvocations = snapshot.invocations.filter {
            $0["capability"].string == "display.render" || $0["capability"].string == "display.clear"
        }
        let latest: RuntimeRecord?
        if let baseline = committedDeliveryBaseline {
            guard snapshot.revision > baseline.snapshotRevision else { return .committedLocally }
            latest = displayInvocations.first(where: { invocation in
                guard let id = invocation["id"].string else { return false }
                return id.hasPrefix(baseline.commandID + ":") && !baseline.displayInvocationIDs.contains(id)
            })
            guard latest != nil else { return .committedLocally }
        } else {
            latest = displayInvocations.first
        }
        guard let latest else {
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

    /// A bounded snapshot with a truncated approval or firing collection can
    /// only establish a minimum number of items requiring owner attention.
    public var attentionIsLowerBound: Bool {
        snapshot?.truncated["approvals"] == true || snapshot?.truncated["firings"] == true
    }

    public var attentionLabel: String {
        "\(attentionCount)\(attentionIsLowerBound ? "+" : "")"
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

    /// Starts the one application-owned runtime stream. Windows and the menu
    /// share this model, so closing a WindowGroup instance must not stop it.
    public func applicationDidStart() {
        guard !runtimeStarted else { return }
        runtimeStarted = true
        previewConnection = nil
        runtime.start()
        runtime.refresh()
        clock = Date()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                guard let self, self.runtimeStarted else { return }
                self.clock = Date()
            }
        }
    }

    public func windowDidAppear() {
        applicationDidStart()
        visibleWindowCount += 1
        isWindowActive = true
    }

    public func windowDidDisappear() {
        visibleWindowCount = max(0, visibleWindowCount - 1)
        isWindowActive = visibleWindowCount > 0
    }

    /// Sends a single owner-authorized command through zerod's owner-only Unix
    /// socket. Transport ambiguity retains the same request identity for retry.
    @discardableResult
    public func command(_ operation: String, _ body: [String: RuntimeCommandValue] = [:]) async -> Bool {
        guard !operation.isEmpty else {
            commandState = .blocked(operation: operation, message: "Invalid command payload; no action was sent.")
            return false
        }
        guard canIssueRuntimeCommand else {
            commandState = .blocked(operation: operation, message: "Runtime is offline or unavailable; no action was sent.")
            return false
        }
        let request = RuntimeCommandRequest(id: UUID().uuidString, op: operation, body: body)
        pendingCommand = request
        pendingDeliveryBaseline = operation.hasPrefix("session.") ? deliveryBaseline(commandID: request.id) : nil
        persistPendingCommand()
        return await sendPendingCommand()
    }

    @discardableResult
    public func retryPendingRuntimeCommand() async -> Bool {
        guard pendingCommand != nil else { return false }
        guard !commandState.isSubmitting, activeSubmissionID == nil else { return false }
        guard runtimeConnection == .live, snapshot != nil else {
            if let pendingCommand {
                commandState = .uncertain(id: pendingCommand.id, operation: pendingCommand.op, message: "Runtime is offline; retry was not sent.")
            }
            return false
        }
        if pendingDeliveryBaseline == nil, let pendingCommand, pendingCommand.op.hasPrefix("session.") {
            pendingDeliveryBaseline = deliveryBaseline(commandID: pendingCommand.id)
        }
        return await sendPendingCommand()
    }

    @discardableResult
    public func startFocus(projectID: String) async -> Bool {
        guard snapshot?.projects.contains(where: { $0.id == projectID }) == true else {
            commandState = .blocked(operation: "session.start", message: "Select a registered project before starting focus.")
            return false
        }
        return await command("session.start", ["project_id": .string(projectID)])
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
        return await command("session.end", ["expected_revision": .integer(revision)])
    }

    @discardableResult
    public func resolveRuntimeApproval(id: String, approve: Bool) async -> Bool {
        guard snapshot?.approvals.contains(where: { $0["id"].string == id }) == true else {
            commandState = .blocked(operation: "approvals", message: "That exact approval is no longer pending.")
            return false
        }
        return await command(approve ? "approvals.approve" : "approvals.deny", ["id": .string(id)])
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
            let response = try await resolveProject(projectID)
            guard response.version == "0.2",
                  response.project.id == projectID,
                  response.project.path.hasPrefix("/") else {
                throw ZeroError("Registered project path unavailable")
            }
            let id = try await codex.startThread(project: response.project.path, model: model, mode: mode)
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
              !request.id.isEmpty,
              !request.op.isEmpty else {
            commandState = .blocked(operation: "unknown", message: "Pending action data is invalid.")
            return false
        }
        guard activeSubmissionID == nil else { return false }
        let id = request.id
        let operation = request.op
        let submissionID = UUID()
        activeSubmissionID = submissionID
        commandState = .submitting(id: id, operation: operation)
        do {
            let response = try await sendCommand(request)
            guard activeSubmissionID == submissionID, pendingCommand?.id == id else { return false }
            guard response.version == "0.1", response.id == id, !response.status.isEmpty else {
                throw ZeroError("Runtime returned a mismatched command response")
            }
            activeSubmissionID = nil
            if operation.hasPrefix("session.") {
                committedDeliveryBaseline = pendingDeliveryBaseline ?? deliveryBaseline(commandID: id)
            }
            pendingCommand = nil
            pendingDeliveryBaseline = nil
            clearPersistedCommand()
            commandState = .idle
            runtime.refresh()
            return true
        } catch let error as ZeroError where error.rejected {
            guard activeSubmissionID == submissionID, pendingCommand?.id == id else { return false }
            activeSubmissionID = nil
            pendingCommand = nil
            pendingDeliveryBaseline = nil
            clearPersistedCommand()
            commandState = .rejected(operation: operation, message: error.localizedDescription)
            runtime.refresh()
            return false
        } catch {
            guard activeSubmissionID == submissionID, pendingCommand?.id == id else { return false }
            activeSubmissionID = nil
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
              let value = try? JSONDecoder().decode(RuntimeCommandRequest.self, from: data),
              !value.id.isEmpty,
              !value.op.isEmpty else {
            return
        }
        pendingCommand = value
        commandState = .uncertain(id: value.id, operation: value.op, message: "A prior action needs an explicit retry.")
    }

    private func persistPendingCommand() {
        guard let pendingCommand,
              let data = try? JSONEncoder().encode(pendingCommand) else { return }
        userDefaults?.set(data, forKey: pendingDefaultsKey)
    }

    private func deliveryBaseline(commandID: String) -> DeliveryBaseline? {
        guard let snapshot else { return nil }
        let ids = Set(snapshot.invocations.compactMap { invocation -> String? in
            guard invocation["capability"].string == "display.render" || invocation["capability"].string == "display.clear" else {
                return nil
            }
            return invocation["id"].string
        })
        return DeliveryBaseline(commandID: commandID, snapshotRevision: snapshot.revision, displayInvocationIDs: ids)
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
