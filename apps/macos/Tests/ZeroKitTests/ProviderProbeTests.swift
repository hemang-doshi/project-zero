import XCTest
@testable import ZeroKit

/// Task 0 provider probes — offline fixtures only.
///
/// No subprocess is spawned here. The live bounded `opencode acp` handshake
/// (initialize only, no prompt, terminated promptly) is recorded in
/// `.superpowers/sdd/2026-09-10-cockpit-v2-desktop/task-0-report.md`.
/// These tests pin the request/response shapes later tasks build against and
/// fail on missing API.
@MainActor
final class ProviderProbeTests: XCTestCase {
    func testCodexHandshakeMethodOrder() async throws {
        let transport = ProbeTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        XCTAssertEqual(transport.methods, ["initialize", "initialized", "model/list", "thread/list"])
        XCTAssertEqual(client.state, .connected)
        client.disconnect()
    }

    func testCodexInitializeCarriesProjectZeroIdentity() async throws {
        let transport = ProbeTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        let initialize = try XCTUnwrap(transport.messages.first)
        XCTAssertEqual(initialize["method"], .string("initialize"))
        XCTAssertEqual(initialize["params"]["clientInfo"]["name"], .string("project_zero"))
        client.disconnect()
    }

    /// `thread/start` is the Codex provider's "new session" shape.
    func testThreadStartCarriesNewSessionShape() async throws {
        let transport = ProbeTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        let id = try await client.startThread(project: "/tmp/zero", mode: .work)
        XCTAssertEqual(id, "probe-thread")
        let request = try XCTUnwrap(transport.messages.last)
        XCTAssertEqual(request["method"], .string("thread/start"))
        XCTAssertEqual(request["params"]["cwd"], .string("/tmp/zero"))
        XCTAssertEqual(request["params"]["model"], .string("gpt-5.6-sol"))
        XCTAssertEqual(request["params"]["sandbox"], .string("workspace-write"))
        XCTAssertEqual(request["params"]["approvalPolicy"], .string("on-request"))
        XCTAssertEqual(request["params"]["config"]["model_reasoning_effort"], .string("medium"))
        client.disconnect()
    }

    /// `turn/start` is the Codex provider's "prompt" shape.
    func testTurnStartCarriesPromptShape() async throws {
        let transport = ProbeTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        _ = try await client.startThread(project: "/tmp/zero", mode: .work)
        let turnID = try await client.startTurn(threadID: "probe-thread", text: "Probe text")
        XCTAssertEqual(turnID, "probe-turn")
        let request = try XCTUnwrap(transport.messages.last)
        XCTAssertEqual(request["method"], .string("turn/start"))
        XCTAssertEqual(request["params"]["threadId"], .string("probe-thread"))
        XCTAssertEqual(request["params"]["effort"], .string("medium"))
        XCTAssertEqual(request["params"]["input"].array.first?["type"], .string("text"))
        XCTAssertEqual(request["params"]["input"].array.first?["text"], .string("Probe text"))
        client.disconnect()
    }

    /// Exact ACP `initialize` request bytes sent to `opencode acp` over
    /// newline-delimited JSON-RPC on stdio (verified live, opencode 1.18.30).
    func testAcpInitializeRequestShape() {
        XCTAssertEqual(acpInitializeRequest["jsonrpc"], .string("2.0"))
        XCTAssertEqual(acpInitializeRequest["id"], .integer(1))
        XCTAssertEqual(acpInitializeRequest["method"], .string("initialize"))
        XCTAssertEqual(acpInitializeRequest["params"]["protocolVersion"], .integer(1))
        XCTAssertEqual(acpInitializeRequest["params"]["clientInfo"]["name"], .string("project_zero"))
    }

    /// Captured `opencode acp` 1.18.30 `initialize` result, parsed offline.
    func testAcpInitializeResultFixture() throws {
        let value = try JSONDecoder().decode(CodexJSON.self, from: Data(acpInitializeResultFixture.utf8))
        XCTAssertEqual(value["jsonrpc"], .string("2.0"))
        XCTAssertEqual(value["result"]["protocolVersion"], .integer(1))
        let capabilities = value["result"]["agentCapabilities"]
        XCTAssertEqual(capabilities["loadSession"], .bool(true))
        XCTAssertEqual(capabilities["promptCapabilities"]["embeddedContext"], .bool(true))
        XCTAssertEqual(capabilities["promptCapabilities"]["image"], .bool(true))
        XCTAssertEqual(capabilities["mcpCapabilities"]["http"], .bool(true))
        XCTAssertEqual(capabilities["mcpCapabilities"]["sse"], .bool(true))
        for key in ["close", "fork", "list", "resume"] {
            XCTAssertEqual(capabilities["sessionCapabilities"][key], .object([:]), "missing session capability \(key)")
        }
        XCTAssertEqual(value["result"]["agentInfo"]["name"], .string("OpenCode"))
        XCTAssertEqual(value["result"]["agentInfo"]["version"], .string("1.18.30"))
        XCTAssertEqual(value["result"]["authMethods"].array.count, 1)
        XCTAssertEqual(value["result"]["authMethods"].array.first?["id"], .string("opencode-login"))
    }

    /// ACP session envelopes the cockpit will use. Shapes follow the ACP
    /// schema; Task 5 verifies them live (no session is created by probes —
    /// `session/new` allocates server-side session state).
    func testAcpSessionEnvelopeShapes() {
        XCTAssertEqual(acpSessionNewEnvelope["method"], .string("session/new"))
        XCTAssertNotNil(acpSessionNewEnvelope["params"]["cwd"].string)
        XCTAssertEqual(acpSessionPromptEnvelope["method"], .string("session/prompt"))
        XCTAssertEqual(acpSessionCancelNotification["method"], .string("session/cancel"))
        XCTAssertNil(acpSessionCancelNotification["id"].string)
    }

    private var acpInitializeRequest: CodexJSON {
        .object([
            "jsonrpc": .string("2.0"), "id": .integer(1), "method": .string("initialize"),
            "params": .object([
                "protocolVersion": .integer(1),
                "clientCapabilities": .object([:]),
                "clientInfo": .object(["name": .string("project_zero"), "version": .string("0.2.0")])
            ])
        ])
    }

    private var acpSessionNewEnvelope: CodexJSON {
        .object([
            "jsonrpc": .string("2.0"), "id": .integer(2), "method": .string("session/new"),
            "params": .object(["cwd": .string("/tmp/zero"), "mcpServers": .array([])])
        ])
    }

    private var acpSessionPromptEnvelope: CodexJSON {
        .object([
            "jsonrpc": .string("2.0"), "id": .integer(3), "method": .string("session/prompt"),
            "params": .object([
                "sessionId": .string("probe-session"),
                "prompt": .array([.object(["type": .string("text"), "text": .string("Probe text")])])
            ])
        ])
    }

    private var acpSessionCancelNotification: CodexJSON {
        .object([
            "jsonrpc": .string("2.0"), "method": .string("session/cancel"),
            "params": .object(["sessionId": .string("probe-session")])
        ])
    }

    private let acpInitializeResultFixture = """
    {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,\
    "agentCapabilities":{"loadSession":true,\
    "mcpCapabilities":{"http":true,"sse":true},\
    "promptCapabilities":{"embeddedContext":true,"image":true},\
    "sessionCapabilities":{"close":{},"fork":{},"list":{},"resume":{}}},\
    "authMethods":[{"description":"Run `opencode auth login` in the terminal",\
    "name":"Login with opencode","id":"opencode-login"}],\
    "agentInfo":{"name":"OpenCode","version":"1.18.30"}}}
    """
}

@MainActor
private final class ProbeTransport: CodexTransport {
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
            respond(to: message, result: .object([:]))
        case "model/list":
            respond(to: message, result: .object([
                "data": .array([.object(["model": .string("probe-model")])])
            ]))
        case "thread/list":
            respond(to: message, result: .object(["data": .array([])]))
        case "thread/start":
            respond(to: message, result: .object(["thread": .object(["id": .string("probe-thread")])]))
        case "turn/start":
            respond(to: message, result: .object(["turn": .object(["id": .string("probe-turn")])]))
        default:
            respond(to: message, result: .object([:]))
        }
    }

    func stop() { receive = nil }

    private func respond(to message: CodexJSON, result: CodexJSON) {
        receive?(.data(try! CodexLineCodec.encode(.object(["id": message["id"], "result": result]))))
    }
}
