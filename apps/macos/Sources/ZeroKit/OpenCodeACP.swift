import Combine
import Foundation

/// Shared OpenCode ACP constants: identity, executable discovery, and the
/// authentication-error mapping. Nothing here logs or retains credentials.
public enum OpenCodeACP {
    /// Task 0 ledger: opencode 1.18.30 at this path, ACP protocolVersion 1.
    public static let defaultExecutablePaths = ["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"]
    public static let loginHint = "Run `opencode auth login` in a terminal, then reconnect."
    public static let clientName = "project_zero"

    public static func resolveExecutablePath(_ override: String?) -> String? {
        if let override, !override.isEmpty { return override }
        return defaultExecutablePaths.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// Anything shaped like an authentication failure becomes `.authRequired`
    /// with the login hint so the UI can show it instead of hanging.
    public static func rpcError(code: Int64, message: String) -> ProviderBridgeError {
        if code == 401 || message.range(of: "auth", options: .caseInsensitive) != nil {
            return .authRequired(loginHint)
        }
        return .rpc(code: code, message: message)
    }
}

/// Per-session registry entry for OpenCode. Kept in a separate namespace
/// from `CodexSettings`: an ID valid in one provider is never valid in the
/// other, and projects resolve through the same authoritative
/// `GET /v0.1/projects/{id}` path for both before a session starts.
public struct OpenCodeThreadSettings: Equatable, Sendable {
    public var project: String
    public var model: String

    public init(project: String, model: String = "") {
        self.project = project
        self.model = model
    }
}

/// Launches the configured local `opencode` executable directly with
/// `acp` on stdio: no shell, no remote endpoint. Mirrors the reviewed
/// `CodexProcessTransport` discipline exactly — one bounded JSON object per
/// line, stderr as truncated diagnostics, process exit as a visible event.
@MainActor
public final class OpenCodeProcessTransport: CodexTransport {
    public let executablePath: String
    public let workingDirectory: String?
    public let arguments = ["acp"]
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errors: FileHandle?
    private var receive: ((CodexTransportEvent) -> Void)?
    private var generation = UUID()
    private var queuedWrites = 0
    private let writer = DispatchQueue(label: "dev.projectzero.opencode.stdin")

    public init(executablePath: String? = nil, workingDirectory: String? = nil) {
        self.executablePath = executablePath
            ?? OpenCodeACP.resolveExecutablePath(nil)
            ?? OpenCodeACP.defaultExecutablePaths[0]
        self.workingDirectory = workingDirectory
    }

    public func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        guard process == nil else { throw CodexBridgeError.alreadyConnected }
        guard FileManager.default.isExecutableFile(atPath: executablePath) else {
            throw CodexBridgeError.transport(
                "Configured local OpenCode executable is unavailable (\(executablePath)). Install opencode, then reconnect."
            )
        }
        let child = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        child.executableURL = URL(fileURLWithPath: executablePath)
        child.arguments = arguments
        if let workingDirectory {
            child.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }
        child.standardInput = stdin
        child.standardOutput = stdout
        child.standardError = stderr
        self.receive = receive
        generation = UUID()
        let session = generation
        input = stdin.fileHandleForWriting
        output = stdout.fileHandleForReading
        errors = stderr.fileHandleForReading
        process = child
        do { try child.run() } catch { stop(); throw error }
        let errorHandle = stderr.fileHandleForReading
        let diagnostics = Task.detached(priority: .utility) { [weak self] in
            do {
                while let data = try errorHandle.read(upToCount: 4096), !data.isEmpty {
                    let message = String(decoding: data, as: UTF8.self)
                    guard await self?.deliver(.diagnostic(message), session: session) == true else { return }
                }
            } catch {
                _ = await self?.deliver(.failed(error.localizedDescription), session: session)
            }
        }
        let outputHandle = stdout.fileHandleForReading
        Task.detached(priority: .utility) { [weak self] in
            do {
                // One reader awaits delivery of each chunk. No termination callback
                // can overtake buffered stdout or enqueue an unbounded stream.
                while let data = try outputHandle.read(upToCount: 16_384), !data.isEmpty {
                    guard await self?.deliver(.data(data), session: session) == true else { return }
                }
                child.waitUntilExit()
                await diagnostics.value
                _ = await self?.deliver(.exited(child.terminationStatus), session: session)
            } catch {
                _ = await self?.deliver(.failed(error.localizedDescription), session: session)
            }
        }
    }

    private func deliver(_ event: CodexTransportEvent, session: UUID) -> Bool {
        guard generation == session else { return false }
        receive?(event)
        return generation == session
    }

    public func send(_ data: Data) throws {
        guard let input, process?.isRunning == true else { throw CodexBridgeError.disconnected }
        guard queuedWrites < 64 else { throw CodexBridgeError.pendingLimit }
        guard data.count <= CodexLineCodec.defaultMaximumLineBytes + 1 else { throw CodexBridgeError.lineTooLarge }
        queuedWrites += 1
        let session = generation
        writer.async { [weak self] in
            let failure: String?
            do { try input.write(contentsOf: data); failure = nil }
            catch { failure = error.localizedDescription }
            Task { @MainActor [weak self] in
                guard self?.generation == session else { return }
                self?.queuedWrites -= 1
                if let failure { self?.receive?(.failed(failure)) }
            }
        }
    }

    public func stop() {
        generation = UUID()
        receive = nil
        queuedWrites = 0
        if process?.isRunning == true { process?.terminate() }
        try? input?.close()
        try? output?.close()
        try? errors?.close()
        process = nil
        input = nil
        output = nil
        errors = nil
    }
}

/// The OpenCode ACP bridge: `initialize` → `session/new` (model discovery) →
/// per-project `session/new`, `session/prompt`, `session/cancel`
/// (notification), `session/set_config_option`.
///
/// Manual connect only: connect sends no prompt. Server-initiated requests
/// (permissions, questions) are recorded bounded in the store and never
/// receive an automatic reply — only an explicit owner action answers them.
@MainActor
public final class OpenCodeBridge: ObservableObject, ProviderBridge {
    @Published public private(set) var connectionState: CodexConnectionState = .disconnected
    @Published public private(set) var advertisedModels: [ProviderModel] = []
    @Published public private(set) var store = OpenCodeEventStore()
    @Published public private(set) var lastError: String?
    @Published public private(set) var lastDiagnostic: String?

    public let providerID: ProviderID = .opencode
    public let executablePath: String
    public let events: AsyncStream<ProviderBridgeEvent>
    private let eventContinuation: AsyncStream<ProviderBridgeEvent>.Continuation

    private let transport: CodexTransport
    private let maximumPendingRequests: Int
    private let requestTimeout: TimeInterval
    private var codec = CodexLineCodec()
    private var nextID: Int64 = 0
    private var generation = UUID()
    private struct Pending {
        let continuation: CheckedContinuation<CodexJSON, Error>
        let timeout: Task<Void, Never>
    }
    private var pending: [CodexRequestID: Pending] = [:]
    private var ownedSessions: Set<String> = []

    public init(
        transport: CodexTransport,
        executablePath: String = "/opt/homebrew/bin/opencode",
        maximumPendingRequests: Int = 64,
        requestTimeout: TimeInterval = 30
    ) {
        self.transport = transport
        self.executablePath = executablePath
        self.maximumPendingRequests = max(1, maximumPendingRequests)
        self.requestTimeout = requestTimeout.isFinite ? max(0.001, min(requestTimeout, 300)) : 30
        let (stream, continuation) = AsyncStream.makeStream(of: ProviderBridgeEvent.self)
        self.events = stream
        self.eventContinuation = continuation
    }

    public convenience init(
        executablePath: String? = nil,
        workingDirectory: String? = nil,
        maximumPendingRequests: Int = 64,
        requestTimeout: TimeInterval = 60
    ) {
        self.init(
            transport: OpenCodeProcessTransport(executablePath: executablePath, workingDirectory: workingDirectory),
            executablePath: executablePath
                ?? OpenCodeACP.resolveExecutablePath(nil)
                ?? OpenCodeACP.defaultExecutablePaths[0],
            maximumPendingRequests: maximumPendingRequests,
            requestTimeout: requestTimeout
        )
    }

    deinit { eventContinuation.finish() }

    /// Manual discovery only. Sends `initialize`, then one `session/new`
    /// probe (no prompt) so the dropdown only offers models the provider
    /// advertised with `configOptions` (category `model`).
    public func connect() async throws {
        guard connectionState != .connected, connectionState != .connecting else {
            throw ProviderBridgeError.alreadyConnected
        }
        codec = CodexLineCodec()
        ownedSessions.removeAll()
        store = OpenCodeEventStore()
        advertisedModels = []
        lastError = nil
        generation = UUID()
        let session = generation
        connectionState = .connecting
        do {
            try transport.start { [weak self] event in
                guard self?.generation == session else { return }
                self?.receive(event)
            }
            _ = try await request("initialize", params: .object([
                "protocolVersion": .integer(1),
                "clientCapabilities": .object([:]),
                "clientInfo": .object([
                    "name": .string(OpenCodeACP.clientName),
                    "version": .string(ZeroRelease.version),
                ]),
            ]))
            let probe = try await request("session/new", params: .object([
                "cwd": .string(FileManager.default.temporaryDirectory.path),
                "mcpServers": .array([]),
            ]))
            try registerSession(probe)
            guard connectionState == .connecting else { throw ProviderBridgeError.disconnected }
            connectionState = .connected
            eventContinuation.yield(.connected(.opencode))
        } catch {
            let bridged = providerBridgeError(error)
            if generation == session, connectionState == .connecting {
                fail(bridged.localizedDescription)
            }
            throw bridged
        }
    }

    public func disconnect() {
        generation = UUID()
        transport.stop()
        failPending(ProviderBridgeError.disconnected)
        ownedSessions.removeAll()
        advertisedModels = []
        store = OpenCodeEventStore()
        lastError = nil
        connectionState = .disconnected
        eventContinuation.yield(.disconnected(.opencode))
    }

    public func startSession(project: String) async throws -> String {
        try requireConnected()
        guard project.hasPrefix("/") else { throw ProviderBridgeError.invalidProject }
        do {
            let result = try await request("session/new", params: .object([
                "cwd": .string(project),
                "mcpServers": .array([]),
            ]))
            return try registerSession(result)
        } catch {
            throw providerBridgeError(error)
        }
    }

    public func sendPrompt(session: String, text: String) async throws -> String {
        try requireConnected()
        guard ownedSessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        do {
            let result = try await request("session/prompt", params: .object([
                "sessionId": .string(session),
                "prompt": .array([.object(["type": .string("text"), "text": .string(text)])]),
            ]))
            return result["stopReason"].string ?? "end_turn"
        } catch {
            throw providerBridgeError(error)
        }
    }

    /// `session/cancel` is a notification: no request ID, correlated purely
    /// by the owned session ID.
    public func interrupt(session: String) async throws {
        try requireConnected()
        guard ownedSessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        do {
            try transport.send(CodexLineCodec.encode(.object([
                "jsonrpc": .string("2.0"),
                "method": .string("session/cancel"),
                "params": .object(["sessionId": .string(session)]),
            ])))
        } catch {
            throw providerBridgeError(error)
        }
    }

    /// Only a model the provider advertised can be selected; anything else is
    /// rejected before a single byte is written.
    public func setModel(session: String, model: String) async throws {
        try requireConnected()
        guard ownedSessions.contains(session) else { throw ProviderBridgeError.unownedSession(session) }
        guard advertisedModels.contains(where: { $0.provider == .opencode && $0.id == model }) else {
            throw ProviderBridgeError.unknownModel(model)
        }
        do {
            _ = try await request("session/set_config_option", params: .object([
                "sessionId": .string(session),
                "configId": .string("model"),
                "value": .string(model),
            ]))
        } catch {
            throw providerBridgeError(error)
        }
    }

    /// Models advertised with `session/new`: current `configOptions` shape
    /// (category `model`), falling back to the legacy top-level `models`
    /// list. Anything else advertises nothing rather than guessing.
    static func models(from result: CodexJSON) -> [ProviderModel] {
        var ids: [(id: String, label: String)] = []
        for option in result["configOptions"].array {
            guard option["category"].string == "model" else { continue }
            for choice in option["options"].array {
                guard let value = choice["value"].string, !value.isEmpty else { continue }
                ids.append((value, choice["name"].string ?? value))
            }
        }
        if ids.isEmpty {
            for entry in result["models"].array {
                guard let value = entry["value"].string, !value.isEmpty else { continue }
                ids.append((value, entry["name"].string ?? value))
            }
        }
        return ids.map { ProviderModel(provider: .opencode, id: $0.id, label: $0.label) }
    }

    private func registerSession(_ result: CodexJSON) throws -> String {
        guard let id = result["sessionId"].string, !id.isEmpty else {
            throw ProviderBridgeError.invalidMessage
        }
        ownedSessions.insert(id)
        let models = Self.models(from: result)
        if !models.isEmpty { advertisedModels = models }
        return id
    }

    private func requireConnected() throws {
        guard connectionState == .connected else { throw ProviderBridgeError.disconnected }
    }

    private func request(_ method: String, params: CodexJSON) async throws -> CodexJSON {
        guard connectionState == .connecting || connectionState == .connected else {
            throw ProviderBridgeError.disconnected
        }
        guard pending.count < maximumPendingRequests else { throw ProviderBridgeError.pendingLimit }
        nextID += 1
        let id = CodexRequestID.integer(nextID)
        let data = try CodexLineCodec.encode(.object([
            "jsonrpc": .string("2.0"),
            "id": id.json,
            "method": .string(method),
            "params": params,
        ]))
        let session = generation
        let result: CodexJSON = try await withCheckedThrowingContinuation { continuation in
            let timeout = Task { [weak self, requestTimeout] in
                do { try await Task.sleep(nanoseconds: UInt64(requestTimeout * 1_000_000_000)) } catch { return }
                self?.finish(id, result: .failure(ProviderBridgeError.timeout))
            }
            pending[id] = Pending(continuation: continuation, timeout: timeout)
            do { try transport.send(data) }
            catch { fail(providerBridgeError(error).localizedDescription) }
        }
        // A response already delivered before a natural process exit remains
        // valid. Explicit disconnect/reconnect or failure still fences it out.
        guard generation == session else { throw ProviderBridgeError.disconnected }
        return result
    }

    private func receive(_ event: CodexTransportEvent) {
        switch event {
        case .diagnostic(let message):
            lastDiagnostic = String(message.suffix(4096))
            eventContinuation.yield(.diagnostic(String(message.suffix(512))))
        case .failed(let message): fail(message)
        case .exited(let code):
            transport.stop()
            failPending(ProviderBridgeError.transport("OpenCode exited with status \(code)"))
            ownedSessions.removeAll()
            connectionState = .exited(code)
            eventContinuation.yield(.disconnected(.opencode))
        case .data(let data):
            do { for value in try codec.append(data) { try receiveMessage(value) } }
            catch { fail(providerBridgeError(error).localizedDescription) }
        }
    }

    private func receiveMessage(_ value: CodexJSON) throws {
        if let method = value["method"].string {
            if CodexRequestID(value["id"]) != nil {
                // Server-initiated request (permission, question, ...). Never
                // auto-reply: retain it bounded and wait for an explicit
                // owner action through a future task.
                store.reduce(OpenCodeEvent(
                    method: method,
                    params: value["params"],
                    sessionID: value["params"]["sessionId"].string ?? value["params"]["sessionID"].string
                ))
            } else if value["id"] == .null {
                store.reduce(OpenCodeEvent(
                    method: method,
                    params: value["params"],
                    sessionID: value["params"]["sessionId"].string ?? value["params"]["sessionID"].string
                ))
            } else {
                throw ProviderBridgeError.invalidMessage
            }
            return
        }
        guard case .object(let fields) = value,
              let id = CodexRequestID(value["id"]),
              (fields["result"] != nil) != (fields["error"] != nil) else {
            throw ProviderBridgeError.invalidMessage
        }
        if fields["error"] != nil {
            guard let code = value["error"]["code"].integer,
                  let message = value["error"]["message"].string else {
                throw ProviderBridgeError.invalidMessage
            }
            lastError = message
            finish(id, result: .failure(OpenCodeACP.rpcError(code: code, message: message)))
        } else {
            finish(id, result: .success(value["result"]))
        }
    }

    private func finish(_ id: CodexRequestID, result: Result<CodexJSON, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timeout.cancel()
        request.continuation.resume(with: result)
    }

    private func failPending(_ error: Error) {
        let requests = pending
        pending.removeAll()
        for request in requests.values {
            request.timeout.cancel()
            request.continuation.resume(throwing: error)
        }
    }

    private func fail(_ message: String) {
        generation = UUID()
        lastError = message
        transport.stop()
        failPending(ProviderBridgeError.transport(message))
        connectionState = .failed(message)
        eventContinuation.yield(.failed(.opencode, message))
    }
}
