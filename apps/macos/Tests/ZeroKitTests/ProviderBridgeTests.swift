import XCTest
@testable import ZeroKit

/// Task 5 bridge + ACP codec tests (offline transcripts only).
///
/// No subprocess is spawned here. Shapes follow ACP v1
/// (agentclientprotocol.com/protocol/v1): `initialize` carries
/// `protocolVersion:1`; models arrive with `session/new` as `configOptions`
/// (category `model`); model changes use `session/set_config_option`;
/// `session/cancel` is a notification. The one bounded live probe
/// (connect → list models → disconnect, no prompt) is env-gated at the
/// bottom of this file and skipped by default.
@MainActor
final class ProviderBridgeTests: XCTestCase {
    func testOpenCodeConnectListsModelsWithoutPrompting() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        XCTAssertEqual(transport.startCount, 0)
        try await bridge.connect()
        XCTAssertEqual(transport.sentMethods, ["initialize", "session/new"])
        XCTAssertTrue(transport.prompts.isEmpty)
        XCTAssertEqual(bridge.connectionState, .connected)
        XCTAssertEqual(bridge.advertisedModels.map(\.id), ["gpt-5-mini"])
        XCTAssertEqual(bridge.advertisedModels.first?.provider, .opencode)
        bridge.disconnect()
        XCTAssertEqual(bridge.connectionState, .disconnected)
    }

    func testOpenCodeInitializeCarriesProjectZeroIdentity() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        let initialize = try XCTUnwrap(transport.messages.first)
        XCTAssertEqual(initialize["jsonrpc"], .string("2.0"))
        XCTAssertEqual(initialize["method"], .string("initialize"))
        XCTAssertEqual(initialize["params"]["protocolVersion"], .integer(1))
        XCTAssertEqual(initialize["params"]["clientInfo"]["name"], .string("project_zero"))
        let sessionNew = try XCTUnwrap(transport.messages.last)
        XCTAssertEqual(sessionNew["method"], .string("session/new"))
        XCTAssertFalse(sessionNew["params"]["cwd"].string?.isEmpty ?? true)
        XCTAssertEqual(sessionNew["params"]["mcpServers"], .array([]))
        bridge.disconnect()
    }

    func testOpenCodeLegacyModelListFallsBack() async throws {
        let transport = RecordingACPTransport(handshake: .legacy(models: ["legacy-model"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        XCTAssertEqual(bridge.advertisedModels.map(\.id), ["legacy-model"])
        bridge.disconnect()
    }

    func testOpenCodeSetModelUsesAdvertisedConfigOption() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini", "gpt-5"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        let session = try await bridge.startSession(project: "/tmp/zero")
        try await bridge.setModel(session: session, model: "gpt-5")
        let set = try XCTUnwrap(transport.messages.last)
        XCTAssertEqual(set["method"], .string("session/set_config_option"))
        XCTAssertEqual(set["params"]["sessionId"], .string(session))
        XCTAssertEqual(set["params"]["configId"], .string("model"))
        XCTAssertEqual(set["params"]["value"], .string("gpt-5"))
        do {
            try await bridge.setModel(session: session, model: "unadvertised-model")
            XCTFail("Unadvertised model accepted")
        } catch {
            XCTAssertEqual(error as? ProviderBridgeError, .unknownModel("unadvertised-model"))
        }
        bridge.disconnect()
    }

    func testOpenCodePromptCancelCorrelateBySessionID() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        let first = try await bridge.startSession(project: "/tmp/zero-a")
        let second = try await bridge.startSession(project: "/tmp/zero-b")
        XCTAssertNotEqual(first, second)
        _ = try await bridge.sendPrompt(session: first, text: "First prompt")
        let prompt = try XCTUnwrap(transport.messages.last)
        XCTAssertEqual(prompt["method"], .string("session/prompt"))
        XCTAssertEqual(prompt["params"]["sessionId"], .string(first))
        XCTAssertEqual(prompt["params"]["prompt"].array.first?["type"], .string("text"))
        XCTAssertEqual(prompt["params"]["prompt"].array.first?["text"], .string("First prompt"))
        try await bridge.interrupt(session: first)
        XCTAssertEqual(transport.cancels, [first])
        let cancel = try XCTUnwrap(transport.notifications.last)
        XCTAssertEqual(cancel["method"], .string("session/cancel"))
        XCTAssertNil(cancel["id"].string)
        XCTAssertNil(cancel["id"].integer)
        XCTAssertEqual(cancel["params"]["sessionId"], .string(first))
        bridge.disconnect()
    }

    func testOpenCodeRejectsUnknownSessionAndRelativeProject() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        do { _ = try await bridge.startSession(project: "relative/path"); XCTFail("Relative project accepted") }
        catch { XCTAssertEqual(error as? ProviderBridgeError, .invalidProject) }
        do { _ = try await bridge.sendPrompt(session: "no-such-session", text: "hi"); XCTFail("Unknown session accepted") }
        catch { XCTAssertEqual(error as? ProviderBridgeError, .unownedSession("no-such-session")) }
        do { try await bridge.interrupt(session: "no-such-session"); XCTFail("Unknown session interrupt accepted") }
        catch { XCTAssertEqual(error as? ProviderBridgeError, .unownedSession("no-such-session")) }
        // A Codex thread ID is never valid for OpenCode and vice versa.
        do { _ = try await bridge.sendPrompt(session: "codex-thread-id", text: "hi"); XCTFail("Cross-provider session accepted") }
        catch { XCTAssertEqual(error as? ProviderBridgeError, .unownedSession("codex-thread-id")) }
        bridge.disconnect()
    }

    func testOpenCodeUnknownEventsAreBoundedAndChunksReduce() throws {
        var store = OpenCodeEventStore(maximumUnknownEvents: 2)
        for n in 0..<3 {
            store.reduce(OpenCodeEvent(method: "future/\(n)", params: .object([:]), sessionID: nil))
        }
        XCTAssertEqual(store.unknownEvents.count, 2)
        XCTAssertEqual(store.unknownEvents.first?.method, "future/1")
        XCTAssertEqual(store.truncation.unknownEvents, 1)
        store.reduce(OpenCodeEvent(
            method: "session/update",
            params: .object(["update": .object([
                "sessionUpdate": .string("agent_message_chunk"),
                "content": .object(["type": .string("text"), "text": .string("hello")])
            ])]),
            sessionID: "s1"
        ))
        store.reduce(OpenCodeEvent(
            method: "session/update",
            params: .object(["update": .object([
                "sessionUpdate": .string("agent_message_chunk"),
                "content": .object(["type": .string("text"), "text": .string(" world")])
            ])]),
            sessionID: "s1"
        ))
        XCTAssertEqual(store.session(id: "s1")?.transcript, "hello world")
    }

    func testOpenCodeServerRequestsNeverAutoReply() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        try await bridge.connect()
        let writes = transport.messages.count
        transport.emit(.object([
            "jsonrpc": .string("2.0"), "id": .integer(99),
            "method": .string("session/request_permission"),
            "params": .object(["sessionId": .string("s1")])
        ]))
        await Task.yield()
        XCTAssertEqual(transport.messages.count, writes)
        XCTAssertTrue(bridge.store.unknownEvents.contains { $0.method == "session/request_permission" })
        bridge.disconnect()
    }

    func testOpenCodeAuthFailureAbortsCleanlyWithLoginHint() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: []))
        transport.sessionNewError = .object(["code": .integer(401), "message": .string("Not authenticated")])
        let bridge = OpenCodeBridge(transport: transport, executablePath: "/usr/bin/false")
        do {
            try await bridge.connect()
            XCTFail("Unauthenticated connect accepted")
        } catch {
            XCTAssertEqual(error as? ProviderBridgeError, .authRequired("Run `opencode auth login` in a terminal, then reconnect."))
        }
        guard case .failed(let message) = bridge.connectionState else {
            return XCTFail("Missing visible auth failure")
        }
        XCTAssertTrue(message.contains("opencode auth login"))
        XCTAssertTrue(transport.prompts.isEmpty)
        bridge.disconnect()
    }

    func testOpenCodePendingLimit() async throws {
        let transport = RecordingACPTransport(handshake: .v1(models: ["gpt-5-mini"]))
        let bridge = OpenCodeBridge(
            transport: transport, executablePath: "/usr/bin/false",
            maximumPendingRequests: 1, requestTimeout: 30
        )
        try await bridge.connect()
        // The harness only answers while automatic; freezing it after connect
        // leaves the next session/new in flight so the limit is exercised.
        transport.automatic = false
        let pending = Task { try await bridge.startSession(project: "/tmp/zero") }
        await transport.waitForRequests(3)
        do { _ = try await bridge.startSession(project: "/tmp/zero"); XCTFail("Limit ignored") }
        catch { XCTAssertEqual(error as? ProviderBridgeError, .pendingLimit) }
        transport.respondToLast(result: .object(["sessionId": .string("late-session")]))
        let session = try await pending.value
        XCTAssertEqual(session, "late-session")
        bridge.disconnect()
    }

    func testCodexBridgeWrapsAppServerWithoutNewTurns() async throws {
        let transport = RecordingCodexBridgeTransport()
        let codex = CodexAppServer(transport: transport)
        let bridge = CodexBridge(codex: codex)
        XCTAssertEqual(bridge.providerID, .codex)
        XCTAssertEqual(bridge.connectionState, .disconnected)
        try await bridge.connect()
        XCTAssertEqual(bridge.connectionState, .connected)
        XCTAssertEqual(transport.methods, ["initialize", "initialized", "model/list", "thread/list"])
        XCTAssertTrue(bridge.advertisedModels.contains { $0.provider == .codex && $0.id == "gpt-5.6-luna" })
        bridge.defaultMode = .work
        let session = try await bridge.startSession(project: "/tmp/zero")
        let turn = try await bridge.sendPrompt(session: session, text: "Explicit request")
        XCTAssertEqual(turn, "bridge-turn")
        try await bridge.interrupt(session: session)
        XCTAssertEqual(transport.methods.last, "turn/interrupt")
        bridge.disconnect()
        XCTAssertEqual(bridge.connectionState, .disconnected)
    }

    func testCodexBridgeInterruptWithoutPromptIsHonest() async throws {
        let transport = RecordingCodexBridgeTransport()
        let bridge = CodexBridge(codex: CodexAppServer(transport: transport))
        try await bridge.connect()
        let session = try await bridge.startSession(project: "/tmp/zero")
        do {
            try await bridge.interrupt(session: session)
            XCTFail("Interrupt without a prompt accepted")
        } catch {
            XCTAssertEqual(
                error as? ProviderBridgeError,
                .unsupportedOperation("Codex interrupt needs the active turn; send a prompt first.")
            )
        }
        do {
            try await bridge.setModel(session: session, model: "gpt-5.6-luna")
            XCTFail("Post-hoc Codex model change accepted")
        } catch {
            XCTAssertEqual(
                error as? ProviderBridgeError,
                .unsupportedOperation("Codex keeps the model chosen at session start; start a new session to change it.")
            )
        }
        bridge.disconnect()
    }

    func testSelectionOnlyAdvertisesListedModels() {
        let advertised = [
            ProviderModel(provider: .codex, id: "gpt-5.6-luna", label: "Luna"),
            ProviderModel(provider: .opencode, id: "gpt-5-mini", label: "Mini"),
        ]
        XCTAssertEqual(ProviderModel.models(for: .codex, from: advertised).map(\.id), ["gpt-5.6-luna"])
        XCTAssertEqual(ProviderModel.models(for: .opencode, from: advertised).map(\.id), ["gpt-5-mini"])
        let selection = ProviderSelection(provider: .opencode, modelID: "gpt-5-mini", policy: "ask")
        XCTAssertTrue(selection.isAdvertisedModel(in: advertised))
        XCTAssertFalse(selection.with(provider: .codex).isAdvertisedModel(in: advertised))
    }

    /// Bounded live probe: connect → list models → disconnect. Sends no
    /// prompt. Runs only with `ZERO_LIVE_PROBE=1`; skipped by default so the
    /// suite stays offline and side-effect free.
    func testLiveProbeConnectListsModelsAndDisconnects() async throws {
        guard ProcessInfo.processInfo.environment["ZERO_LIVE_PROBE"] == "1" else {
            throw XCTSkip("Live OpenCode probe is opt-in via ZERO_LIVE_PROBE=1")
        }
        let bridge = OpenCodeBridge(requestTimeout: 60)
        do {
            try await withTimeout(seconds: 90) { try await bridge.connect() }
        } catch {
            throw XCTSkip("Live probe could not connect (recorded in task report): \(error)")
        }
        XCTAssertEqual(bridge.connectionState, .connected)
        XCTAssertFalse(bridge.advertisedModels.isEmpty, "Live probe found no models")
        bridge.disconnect()
        XCTAssertEqual(bridge.connectionState, .disconnected)
    }
}

private func withTimeout(seconds: UInt64, operation: @escaping () async throws -> Void) async throws {
    try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            throw ProviderBridgeError.timeout
        }
        try await group.next()
        group.cancelAll()
    }
}

@MainActor
private final class RecordingACPTransport: CodexTransport {
    struct Handshake {
        var models: [String]
        var legacyModels = false
        static func v1(models: [String]) -> Handshake { Handshake(models: models) }
        static func legacy(models: [String]) -> Handshake { Handshake(models: models, legacyModels: true) }
    }

    var handshake: Handshake
    var automatic = true
    var sessionNewError: CodexJSON?
    var startCount = 0
    var stoppedCount = 0
    var messages: [CodexJSON] = []
    var notifications: [CodexJSON] = []
    var prompts: [CodexJSON] = []
    var cancels: [String] = []
    var receive: ((CodexTransportEvent) -> Void)?
    private var issuedSessions = 0

    init(handshake: Handshake) { self.handshake = handshake }

    var sentMethods: [String] { messages.compactMap { $0["method"].string } }

    func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        startCount += 1
        self.receive = receive
    }

    func send(_ data: Data) throws {
        let message = try JSONDecoder().decode(CodexJSON.self, from: data)
        guard let method = message["method"].string else { return }
        if message["id"] == .null {
            notifications.append(message)
            if method == "session/cancel", let session = message["params"]["sessionId"].string {
                cancels.append(session)
            }
            return
        }
        messages.append(message)
        if method == "session/prompt" { prompts.append(message["params"]) }
        guard automatic else { return }
        switch method {
        case "initialize":
            respond(to: message, result: .object([
                "protocolVersion": .integer(1),
                "agentCapabilities": .object([
                    "loadSession": .bool(true),
                    "promptCapabilities": .object(["embeddedContext": .bool(true), "image": .bool(true)]),
                    "mcpCapabilities": .object(["http": .bool(true), "sse": .bool(true)]),
                    "sessionCapabilities": .object([
                        "close": .object([:]), "fork": .object([:]),
                        "list": .object([:]), "resume": .object([:])
                    ])
                ]),
                "authMethods": .array([]),
                "agentInfo": .object(["name": .string("OpenCode"), "version": .string("test")])
            ]))
        case "session/new":
            if let error = sessionNewError {
                emit(.object(["jsonrpc": .string("2.0"), "id": message["id"], "error": error]))
                return
            }
            issuedSessions += 1
            let session = "open-session-\(issuedSessions)"
            if handshake.legacyModels {
                respond(to: message, result: .object([
                    "sessionId": .string(session),
                    "models": .array(handshake.models.map { .object(["value": .string($0), "name": .string($0)]) })
                ]))
            } else {
                respond(to: message, result: .object([
                    "sessionId": .string(session),
                    "configOptions": .array([modelOption(current: handshake.models.first ?? "")])
                ]))
            }
        case "session/prompt":
            respond(to: message, result: .object(["stopReason": .string("end_turn")]))
        case "session/set_config_option":
            respond(to: message, result: .object([
                "configOptions": .array([modelOption(current: message["params"]["value"].string ?? "")])
            ]))
        default:
            respond(to: message, result: .object([:]))
        }
    }

    func stop() {
        stoppedCount += 1
        receive = nil
    }

    func emit(_ value: CodexJSON) {
        receive?(.data(try! CodexLineCodec.encode(value)))
    }

    func respondToLast(result: CodexJSON) {
        guard let last = messages.last else { return }
        emit(.object(["jsonrpc": .string("2.0"), "id": last["id"], "result": result]))
    }

    private func respond(to message: CodexJSON, result: CodexJSON) {
        receive?(.data(try! CodexLineCodec.encode(.object(["id": message["id"], "result": result]))))
    }

    func waitForRequests(_ count: Int) async {
        for _ in 0..<10_000 {
            if messages.filter({ $0["id"] != .null }).count >= count { return }
            await Task.yield()
        }
        XCTFail("Timed out waiting for ACP writes")
    }

    private func modelOption(current: String) -> CodexJSON {
        .object([
            "id": .string("model"),
            "name": .string("Model"),
            "category": .string("model"),
            "type": .string("select"),
            "currentValue": .string(current),
            "options": .array(handshake.models.map {
                .object(["value": .string($0), "name": .string($0)])
            })
        ])
    }
}

@MainActor
private final class RecordingCodexBridgeTransport: CodexTransport {
    var receive: ((CodexTransportEvent) -> Void)?
    var messages: [CodexJSON] = []
    var methods: [String] { messages.compactMap { $0["method"].string } }

    func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        self.receive = receive
    }

    func send(_ data: Data) throws {
        let message = try JSONDecoder().decode(CodexJSON.self, from: data)
        messages.append(message)
        guard message["id"] != .null, let method = message["method"].string else { return }
        switch method {
        case "initialize":
            emit(.object(["id": message["id"], "result": .object([:])]))
        case "model/list":
            emit(.object(["id": message["id"], "result": .object([
                "data": .array([.object(["model": .string("gpt-5.6-luna")])])
            ])]))
        case "thread/list":
            emit(.object(["id": message["id"], "result": .object(["data": .array([])])]))
        case "thread/start":
            emit(.object(["id": message["id"], "result": .object(["thread": .object(["id": .string("bridge-thread")])])]))
        case "turn/start":
            emit(.object(["id": message["id"], "result": .object(["turn": .object(["id": .string("bridge-turn")])])]))
        case "turn/interrupt":
            emit(.object(["id": message["id"], "result": .object([:])]))
        default:
            emit(.object(["id": message["id"], "result": .object([:])]))
        }
    }

    func stop() { receive = nil }

    private func emit(_ value: CodexJSON) {
        receive?(.data(try! CodexLineCodec.encode(value)))
    }
}
