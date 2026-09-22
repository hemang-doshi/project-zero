import Foundation
import Combine

public enum CodexConnectionState: Equatable, Sendable {
    case disconnected, connecting, connected, exited(Int32), failed(String)
}

public enum CodexMode: String, CaseIterable, Sendable {
    case assist, work
    public var settings: CodexSettings {
        CodexSettings(model: self == .assist ? "gpt-5.6-luna" : "gpt-5.6-sol", effort: "medium",
                      sandbox: self == .assist ? "read-only" : "workspace-write",
                      approvalPolicy: self == .assist ? "never" : "on-request")
    }
}

/// The UI can present this policy before calling either explicit start action.
public struct CodexSettings: Equatable, Sendable {
    public var model: String
    public let effort: String
    public let sandbox: String
    public let approvalPolicy: String
}

public enum CodexTransportEvent: Sendable {
    case data(Data), diagnostic(String), exited(Int32), failed(String)
}

@MainActor
public protocol CodexTransport: AnyObject {
    func start(receive: @escaping (CodexTransportEvent) -> Void) throws
    func send(_ data: Data) throws
    func stop()
}

/// Launches the configured local executable directly; no shell, remote endpoint,
/// desktop IPC or private Codex storage is opened by this transport.
@MainActor
public final class CodexProcessTransport: CodexTransport {
    public let executableURL: URL
    public let arguments = ["app-server", "--stdio"]
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errors: FileHandle?
    private var receive: ((CodexTransportEvent) -> Void)?
    private var generation = UUID()
    private var queuedWrites = 0
    private let writer = DispatchQueue(label: "dev.projectzero.codex.stdin")

    public init(executableURL: URL = URL(fileURLWithPath: "/opt/homebrew/bin/codex")) {
        self.executableURL = executableURL
    }

    public func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        guard process == nil else { throw CodexBridgeError.alreadyConnected }
        guard executableURL.isFileURL, executableURL.path.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            throw CodexBridgeError.transport("Configured local Codex executable is unavailable")
        }
        let child = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        child.executableURL = executableURL
        child.arguments = arguments
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

@MainActor
public final class CodexAppServer: ObservableObject {
    @Published public private(set) var state: CodexConnectionState = .disconnected
    @Published public private(set) var store = CodexEventStore()
    @Published public private(set) var models: [CodexJSON] = []
    @Published public private(set) var lastError: String?
    @Published public private(set) var lastDiagnostic: String?
    @Published public private(set) var threadSettings: [String: CodexSettings] = [:]
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
    private var serverRequests: Set<CodexRequestID> = []

    public init(transport: CodexTransport, maximumPendingRequests: Int = 64, requestTimeout: TimeInterval = 30) {
        self.transport = transport
        self.maximumPendingRequests = max(1, maximumPendingRequests)
        self.requestTimeout = requestTimeout.isFinite ? max(0.001, min(requestTimeout, 300)) : 30
    }

    public convenience init() { self.init(transport: CodexProcessTransport()) }

    /// Manual discovery only. This never starts a thread, resumes a session or sends a turn.
    public func connect() async throws {
        guard state != .connected, state != .connecting else { throw CodexBridgeError.alreadyConnected }
        codec = CodexLineCodec()
        serverRequests.removeAll()
        threadSettings.removeAll()
        store = CodexEventStore()
        models = []
        generation = UUID()
        let session = generation
        state = .connecting
        lastError = nil
        do {
            try transport.start { [weak self] event in
                guard self?.generation == session else { return }
                self?.receive(event)
            }
            _ = try await request("initialize", params: .object([
                "clientInfo": .object(["name": .string("project_zero"), "title": .string("Project Zero"), "version": .string(ZeroRelease.version)]),
                "capabilities": .object(["experimentalApi": .bool(false)])
            ]))
            try transport.send(CodexLineCodec.encode(.object(["method": .string("initialized")])))
            let modelList = try await request("model/list", params: .object(["limit": .integer(100)]))
            models = modelList["data"].array
            let threadList = try await request("thread/list", params: .object(["limit": .integer(100)]))
            for thread in threadList["data"].array {
                reduce(.notification(method: "thread/started", params: .object(["thread": thread])))
            }
            guard state == .connecting else { throw CodexBridgeError.disconnected }
            state = .connected
        } catch {
            if generation == session, state == .connecting { fail(error.localizedDescription) }
            throw error
        }
    }

    public func disconnect() {
        generation = UUID()
        transport.stop()
        failPending(CodexBridgeError.disconnected)
        serverRequests.removeAll()
        threadSettings.removeAll()
        store = CodexEventStore()
        models = []
        state = .disconnected
    }

    public func startThread(project: String, model: String? = nil, mode: CodexMode) async throws -> String {
        try requireConnected()
        guard project.hasPrefix("/") else { throw CodexBridgeError.invalidProject }
        var settings = mode.settings
        if let model { settings.model = model }
        let result = try await request("thread/start", params: .object([
            "cwd": .string(project), "model": .string(settings.model), "sandbox": .string(settings.sandbox),
            "approvalPolicy": .string(settings.approvalPolicy),
            "config": .object(["model_reasoning_effort": .string(settings.effort)])
        ]))
        guard let id = result["thread"]["id"].string else { throw CodexBridgeError.invalidMessage }
        if state == .connected { threadSettings[id] = settings }
        reduce(.notification(method: "thread/started", params: result))
        return id
    }

    @discardableResult
    public func startTurn(threadID: String, text: String) async throws -> String {
        try requireConnected()
        guard let settings = threadSettings[threadID] else { throw CodexBridgeError.unownedThread }
        let result = try await request("turn/start", params: .object([
            "threadId": .string(threadID), "model": .string(settings.model), "effort": .string(settings.effort),
            "approvalPolicy": .string(settings.approvalPolicy),
            "input": .array([.object(["type": .string("text"), "text": .string(text), "text_elements": .array([])])])
        ]))
        guard let id = result["turn"]["id"].string else { throw CodexBridgeError.invalidMessage }
        reduce(.notification(method: "turn/started", params: .object(["threadId": .string(threadID), "turn": result["turn"]])))
        return id
    }

    public func interrupt(turnID: String, threadID: String) async throws {
        try requireConnected()
        guard threadSettings[threadID] != nil else { throw CodexBridgeError.unownedThread }
        _ = try await request("turn/interrupt", params: .object(["threadId": .string(threadID), "turnId": .string(turnID)]))
    }

    /// No approval request (including an unknown one) receives an automatic reply.
    public func reply(to id: CodexRequestID, response: CodexJSON) throws {
        try requireConnected()
        guard serverRequests.contains(id) else { throw CodexBridgeError.unknownRequest }
        try transport.send(CodexLineCodec.encode(.object(["id": id.json, "result": response])))
        serverRequests.remove(id)
        store.resolve(id)
    }

    private func requireConnected() throws {
        guard state == .connected else { throw CodexBridgeError.disconnected }
    }

    private func request(_ method: String, params: CodexJSON) async throws -> CodexJSON {
        guard state == .connecting || state == .connected else { throw CodexBridgeError.disconnected }
        guard pending.count < maximumPendingRequests else { throw CodexBridgeError.pendingLimit }
        nextID += 1
        let id = CodexRequestID.integer(nextID)
        let data = try CodexLineCodec.encode(.object(["id": id.json, "method": .string(method), "params": params]))
        let session = generation
        let result: CodexJSON = try await withCheckedThrowingContinuation { continuation in
            let timeout = Task { [weak self, requestTimeout] in
                do { try await Task.sleep(nanoseconds: UInt64(requestTimeout * 1_000_000_000)) } catch { return }
                self?.finish(id, result: .failure(CodexBridgeError.timeout))
            }
            pending[id] = Pending(continuation: continuation, timeout: timeout)
            do { try transport.send(data) }
            catch { fail(error.localizedDescription) }
        }
        // A response already delivered before a natural process exit remains
        // valid. Explicit disconnect/reconnect or failure still fences it out.
        guard generation == session else { throw CodexBridgeError.disconnected }
        return result
    }

    private func receive(_ event: CodexTransportEvent) {
        switch event {
        case .diagnostic(let message): lastDiagnostic = String(message.suffix(4096))
        case .failed(let message): fail(message)
        case .exited(let code):
            transport.stop()
            failPending(CodexBridgeError.transport("Codex exited with status \(code)"))
            serverRequests.removeAll()
            threadSettings.removeAll()
            state = .exited(code)
        case .data(let data):
            do { for value in try codec.append(data) { try receiveMessage(value) } }
            catch { fail(error.localizedDescription) }
        }
    }

    private func receiveMessage(_ value: CodexJSON) throws {
        if let method = value["method"].string {
            if let id = CodexRequestID(value["id"]) {
                guard serverRequests.count < maximumPendingRequests else { throw CodexBridgeError.pendingLimit }
                serverRequests.insert(id)
                reduce(.request(id: id, method: method, params: value["params"]))
            } else if value["id"] == .null {
                if method == "serverRequest/resolved", let id = CodexRequestID(value["params"]["requestId"]) { serverRequests.remove(id) }
                reduce(.notification(method: method, params: value["params"]))
            } else { throw CodexBridgeError.invalidMessage }
            return
        }
        guard case .object(let fields) = value, let id = CodexRequestID(value["id"]),
              (fields["result"] != nil) != (fields["error"] != nil) else { throw CodexBridgeError.invalidMessage }
        if fields["error"] != nil {
            guard let code = value["error"]["code"].integer, let message = value["error"]["message"].string else { throw CodexBridgeError.invalidMessage }
            lastError = message
            finish(id, result: .failure(CodexBridgeError.rpc(code: code, message: message)))
        } else { finish(id, result: .success(value["result"])) }
    }

    private func finish(_ id: CodexRequestID, result: Result<CodexJSON, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timeout.cancel()
        request.continuation.resume(with: result)
    }

    private func reduce(_ event: CodexEvent) {
        store.reduce(event)
        threadSettings = threadSettings.filter { store.threads[$0.key] != nil }
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
        failPending(CodexBridgeError.transport(message))
        state = .failed(message)
    }
}
