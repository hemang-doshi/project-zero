import Combine
import Foundation

/// Provider-neutral identity for the cockpit's model backends.
///
/// Codex remains the default; OpenCode (via `opencode acp`) is the second
/// bridge. Sessions, threads and working directories are never shared across
/// providers — only the unified selection surface is common.
public enum ProviderID: String, CaseIterable, Codable, Sendable, Identifiable {
    case codex
    case opencode

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .codex: return "Codex"
        case .opencode: return "OpenCode"
        }
    }

    /// Strict harness lock: GPT models ride Codex only, Muse/Spark models
    /// ride OpenCode only. A mismatch never reroutes — the composer shows an
    /// inline warning and records a mirror file instead. Neither bridge ever
    /// opens the other provider's session store (including the desktop-owned
    /// Codex DB); cross-harness evidence flows only through explicit mirror
    /// files under `zero-meta/{codex,opencode}/`.
    public func allowsModel(_ id: String) -> Bool {
        let lower = id.lowercased()
        switch self {
        case .codex: return lower.hasPrefix("gpt-")
        case .opencode: return lower.contains("muse") || lower.contains("spark")
        }
    }
}

/// One model as advertised live by its own provider. The picker never offers
/// a model the connected provider did not advertise.
public struct ProviderModel: Equatable, Sendable {
    public let provider: ProviderID
    public let id: String
    public let label: String

    public init(provider: ProviderID, id: String, label: String) {
        self.provider = provider
        self.id = id
        self.label = label
    }

    public var identifier: String { provider.rawValue + "/" + id }

    public static func models(for provider: ProviderID, from advertised: [ProviderModel]) -> [ProviderModel] {
        advertised.filter { $0.provider == provider }
    }
}

/// The unified provider → model → policy choice shown before send.
public struct ProviderSelection: Equatable, Sendable {
    public var provider: ProviderID
    public var modelID: String
    public var policy: String

    public init(provider: ProviderID = .codex, modelID: String = "", policy: String = "ask") {
        self.provider = provider
        self.modelID = modelID
        self.policy = policy
    }

    public func isAdvertisedModel(in advertised: [ProviderModel]) -> Bool {
        advertised.contains { $0.provider == provider && $0.id == modelID }
    }

    public func with(provider: ProviderID) -> ProviderSelection {
        ProviderSelection(provider: provider, modelID: modelID, policy: policy)
    }
}

/// Bridge-level failures. Mirrors the `CodexBridgeError` cases that cross
/// the wire so both providers report one vocabulary to the UI. No case ever
/// carries credentials, tokens or approval payloads.
public enum ProviderBridgeError: Error, Equatable, LocalizedError {
    case invalidMessage
    case lineTooLarge
    case pendingLimit
    case timeout
    case disconnected
    case alreadyConnected
    case invalidProject
    case unknownModel(String)
    case unownedSession(String)
    case authRequired(String)
    case unsupportedOperation(String)
    case rpc(code: Int64, message: String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .unknownModel(let id): return "Unknown model: \(id)"
        case .unownedSession(let id): return "Unknown session: \(id)"
        case .authRequired(let hint): return hint
        case .unsupportedOperation(let hint): return hint
        case .rpc(_, let message): return message
        case .transport(let message): return message
        default: return String(describing: self)
        }
    }
}

/// Lifecycle broadcast for bridge state. Session content itself stays in each
/// provider's own event store; this only carries connection facts.
public enum ProviderBridgeEvent: Equatable, Sendable {
    case connected(ProviderID)
    case disconnected(ProviderID)
    case failed(ProviderID, String)
    case diagnostic(String)
}

/// Provider-neutral session contract. Conformations wrap the existing
/// `CodexAppServer` / OpenCode ACP transports; neither is rewritten here.
///
/// All session calls are explicit and manual: connect never starts a session
/// or sends a prompt, and server-initiated requests never receive an
/// automatic reply.
@MainActor
public protocol ProviderBridge: AnyObject {
    var providerID: ProviderID { get }
    var connectionState: CodexConnectionState { get }
    var advertisedModels: [ProviderModel] { get }
    var events: AsyncStream<ProviderBridgeEvent> { get }
    func connect() async throws
    func disconnect()
    func startSession(project: String) async throws -> String
    func sendPrompt(session: String, text: String) async throws -> String
    func interrupt(session: String) async throws
    func setModel(session: String, model: String) async throws
}

/// Maps wire/transport failures into the shared bridge vocabulary.
func providerBridgeError(_ error: Error) -> ProviderBridgeError {
    if let bridged = error as? ProviderBridgeError { return bridged }
    guard let wire = error as? CodexBridgeError else {
        return .transport(error.localizedDescription)
    }
    switch wire {
    case .invalidMessage: return .invalidMessage
    case .lineTooLarge: return .lineTooLarge
    case .pendingLimit: return .pendingLimit
    case .timeout: return .timeout
    case .disconnected: return .disconnected
    case .unownedThread: return .unownedSession("")
    case .unknownRequest: return .transport("Unknown server request")
    case .invalidProject: return .invalidProject
    case .alreadyConnected: return .alreadyConnected
    case .rpc(let code, let message): return .rpc(code: code, message: message)
    case .transport(let message): return .transport(message)
    }
}

/// Wraps the existing `CodexAppServer` without changing its behavior: no new
/// turns, no model renegotiation, no cross-provider session reuse.
@MainActor
public final class CodexBridge: ObservableObject, ProviderBridge {
    public let codex: CodexAppServer
    public var defaultMode: CodexMode

    public let events: AsyncStream<ProviderBridgeEvent>
    private let eventContinuation: AsyncStream<ProviderBridgeEvent>.Continuation
    private var subscriptions = Set<AnyCancellable>()
    private var sessions: Set<String> = []
    private var activeTurns: [String: String] = [:]

    public init(codex: CodexAppServer? = nil, defaultMode: CodexMode = .assist) {
        self.codex = codex ?? CodexAppServer()
        self.defaultMode = defaultMode
        let (stream, continuation) = AsyncStream.makeStream(of: ProviderBridgeEvent.self)
        self.events = stream
        self.eventContinuation = continuation
        self.codex.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &subscriptions)
    }

    deinit { eventContinuation.finish() }

    public var providerID: ProviderID { .codex }
    public var connectionState: CodexConnectionState { codex.state }
    public var advertisedModels: [ProviderModel] {
        codex.models.compactMap { entry in
            guard let id = entry["model"].string, !id.isEmpty else { return nil }
            return ProviderModel(provider: .codex, id: id, label: id)
        }
    }

    /// Manual connect only. Delegates to the wrapped app server; no thread,
    /// session or turn is started here.
    public func connect() async throws {
        guard codex.state != .connected, codex.state != .connecting else {
            throw ProviderBridgeError.alreadyConnected
        }
        do {
            try await codex.connect()
            eventContinuation.yield(.connected(.codex))
        } catch {
            let bridged = providerBridgeError(error)
            eventContinuation.yield(.failed(.codex, bridged.localizedDescription))
            throw bridged
        }
    }

    public func disconnect() {
        codex.disconnect()
        sessions.removeAll()
        activeTurns.removeAll()
        eventContinuation.yield(.disconnected(.codex))
    }

    public func startSession(project: String) async throws -> String {
        do {
            let id = try await codex.startThread(project: project, model: nil, mode: defaultMode)
            sessions.insert(id)
            return id
        } catch {
            throw providerBridgeError(error)
        }
    }

    public func sendPrompt(session: String, text: String) async throws -> String {
        guard sessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        do {
            let turn = try await codex.startTurn(threadID: session, text: text)
            activeTurns[session] = turn
            return turn
        } catch {
            throw providerBridgeError(error)
        }
    }

    public func interrupt(session: String) async throws {
        guard sessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        guard let turn = activeTurns[session] else {
            throw ProviderBridgeError.unsupportedOperation("Codex interrupt needs the active turn; send a prompt first.")
        }
        do {
            try await codex.interrupt(turnID: turn, threadID: session)
        } catch {
            throw providerBridgeError(error)
        }
    }

    public func setModel(session: String, model: String) async throws {
        guard sessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        _ = model
        throw ProviderBridgeError.unsupportedOperation("Codex keeps the model chosen at session start; start a new session to change it.")
    }
}

extension CodexSettings {
    /// Registry convenience for `CockpitModel.codexThreadSettings`.
    ///
    /// Thread settings record the model/policy applied to a Codex thread.
    /// Project identity itself is resolved authoritatively through
    /// `GET /v0.1/projects/{id}` at session start and is not cached here, so
    /// this initializer only supplies the default read-only policy triple.
    /// (A stored `project` field would touch `CodexAppServer.swift`, which is
    /// outside this task's owned files.)
    public init(project: String) {
        _ = project
        self.init(model: "", effort: "medium", sandbox: "read-only", approvalPolicy: "never")
    }
}
