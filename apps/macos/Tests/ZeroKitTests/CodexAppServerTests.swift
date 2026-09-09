import XCTest
@testable import ZeroKit

@MainActor
final class CodexAppServerTests: XCTestCase {
    func testConnectionDoesNotStartATurn() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        XCTAssertEqual(client.state, .disconnected)
        XCTAssertTrue(transport.messages.isEmpty)
        try await client.connect()
        XCTAssertEqual(transport.methods, ["initialize", "model/list", "thread/list"])
        XCTAssertEqual(client.state, .connected)
        XCTAssertEqual(client.models.first?["model"].string, "gpt-5.6-luna")
        XCTAssertEqual(client.store.thread(id: "listed")?.title, "Listed thread")
        client.disconnect()
        XCTAssertEqual(client.state, .disconnected)
    }

    func testCodecFramesSplitLinesAndRejectsOversizeAndNonObjects() throws {
        var codec = CodexLineCodec(maximumLineBytes: 64)
        XCTAssertEqual(try codec.append(Data("{\"id\":7,".utf8)), [])
        let values = try codec.append(Data("\"result\":null}\n{\"method\":\"future\"}\n".utf8))
        XCTAssertEqual(values.count, 2)
        XCTAssertEqual(values.first?["id"], .integer(7))
        XCTAssertThrowsError(try codec.append(Data("[]\n".utf8)))
        XCTAssertThrowsError(try CodexLineCodec.encode(.array([])))
        XCTAssertThrowsError(try codec.append(Data(repeating: 65, count: 65)))
        let line = try CodexLineCodec.encode(.object(["text": .string("hello\nworld")]))
        XCTAssertEqual(line.filter { $0 == 10 }.count, 1)
    }

    func testResponsesCorrelateByIDOutOfOrder() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        transport.automatic = false
        let first = Task { try await client.startThread(project: "/tmp/zero-a", mode: .assist) }
        let second = Task { try await client.startThread(project: "/tmp/zero-b", mode: .work) }
        await transport.waitForCount(5)
        let requests = Array(transport.messages.suffix(2))
        transport.respond(to: requests[1], result: .object(["thread": .object(["id": .string("second")])]))
        transport.respond(to: requests[0], result: .object(["thread": .object(["id": .string("first")])]))
        let firstID = try await first.value
        let secondID = try await second.value
        XCTAssertEqual(firstID, "first")
        XCTAssertEqual(secondID, "second")
        client.disconnect()
    }

    func testExplicitActionsCarryVisibleModePolicyAndRejectUnownedThread() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        for mode in [CodexMode.assist, .work] {
            let settings = mode.settings
            let id = try await client.startThread(project: "/tmp/zero", mode: mode)
            let request = try XCTUnwrap(transport.messages.last)
            XCTAssertEqual(request["params"]["model"].string, mode == .assist ? "gpt-5.6-luna" : "gpt-5.6-sol")
            XCTAssertEqual(request["params"]["sandbox"].string, mode == .assist ? "read-only" : "workspace-write")
            XCTAssertEqual(request["params"]["approvalPolicy"].string, mode == .assist ? "never" : "on-request")
            XCTAssertEqual(settings.effort, "medium")
            _ = try await client.startTurn(threadID: id, text: "Explicit request")
            XCTAssertEqual(transport.messages.last?["params"]["effort"], .string("medium"))
            try await client.interrupt(turnID: "turn", threadID: id)
            XCTAssertEqual(transport.messages.last?["method"], .string("turn/interrupt"))
        }
        do { _ = try await client.startTurn(threadID: "listed", text: "unsafe"); XCTFail("Unowned thread accepted") }
        catch { XCTAssertEqual(error as? CodexBridgeError, .unownedThread) }
        client.disconnect()
    }

    func testExitFailsPendingRequestAndIsVisible() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        transport.automatic = false
        let request = Task { try await client.startThread(project: "/tmp/zero", mode: .work) }
        await transport.waitForCount(4)
        transport.receive?(.exited(9))
        do { _ = try await request.value; XCTFail("Exit did not fail pending call") } catch {}
        XCTAssertEqual(client.state, .exited(9))
    }

    func testProcessLaunchAndMalformedProtocolFailuresAreVisible() async throws {
        let client = CodexAppServer(transport: CodexProcessTransport(executableURL: URL(fileURLWithPath: "/missing/zero-codex")))
        do { try await client.connect(); XCTFail("Missing executable accepted") } catch {}
        guard case .failed = client.state else { return XCTFail("Missing visible launch failure") }
        let transport = RecordingTransport()
        let other = CodexAppServer(transport: transport)
        try await other.connect()
        transport.receive?(.data(Data("not json\n".utf8)))
        guard case .failed = other.state else { return XCTFail("Missing visible decode failure") }
    }

    func testPendingLimitTimeoutAndRPCError() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport, maximumPendingRequests: 1, requestTimeout: 0.05)
        try await client.connect()
        transport.automatic = false
        let pending = Task { try await client.startThread(project: "/tmp/zero", mode: .work) }
        await transport.waitForCount(4)
        do { _ = try await client.startThread(project: "/tmp/zero", mode: .assist); XCTFail("Limit ignored") }
        catch { XCTAssertEqual(error as? CodexBridgeError, .pendingLimit) }
        do { _ = try await pending.value; XCTFail("Request did not time out") }
        catch { XCTAssertEqual(error as? CodexBridgeError, .timeout) }
        let failed = Task { try await client.startThread(project: "/tmp/zero", mode: .work) }
        await transport.waitForCount(5)
        transport.emit(.object(["id": transport.messages.last!["id"], "error": .object(["code": .integer(-1), "message": .string("Denied")])]))
        do { _ = try await failed.value; XCTFail("RPC error ignored") }
        catch { XCTAssertEqual(error as? CodexBridgeError, .rpc(code: -1, message: "Denied")) }
        XCTAssertEqual(client.lastError, "Denied")
        client.disconnect()
    }

    func testAgentDeltaAppendsToMatchingItem() {
        var store = CodexEventStore()
        store.reduce(.notification(method: "item/agentMessage/delta", params: params(delta: "hello")))
        store.reduce(.notification(method: "item/agentMessage/delta", params: params(delta: " world")))
        XCTAssertEqual(store.thread(id: "t")?.item(id: "i")?.text, "hello world")
        XCTAssertEqual(store.thread(id: "t")?.item(id: "i")?.turnID, "u")
    }

    func testDisconnectAfterResponseCannotReviveConnection() async throws {
        let transport = RecordingTransport()
        transport.automatic = false
        let client = CodexAppServer(transport: transport)
        let connection = Task { try await client.connect() }
        for count in 1...3 {
            await transport.waitForCount(count)
            transport.respond(to: transport.messages.last!, result: .object(["data": .array([])]))
        }
        client.disconnect()
        do { try await connection.value; XCTFail("Disconnected connection revived") } catch {}
        XCTAssertEqual(client.state, .disconnected)
    }

    func testDisconnectAfterThreadResponseCannotRestoreAuthority() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        transport.automatic = false
        let request = Task { try await client.startThread(project: "/tmp/zero", mode: .work) }
        await transport.waitForCount(4)
        transport.respond(to: transport.messages.last!, result: .object(["thread": .object(["id": .string("late")])]))
        client.disconnect()
        do { _ = try await request.value; XCTFail("Late thread accepted") } catch {}
        XCTAssertTrue(client.threadSettings.isEmpty)
    }

    func testReconnectDropsOldThreadAuthorityAndWriteFailureIsVisible() async throws {
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        _ = try await client.startThread(project: "/tmp/zero", mode: .work)
        transport.receive?(.exited(1))
        try await client.connect()
        XCTAssertTrue(client.threadSettings.isEmpty)
        transport.writeFailure = true
        do { _ = try await client.startThread(project: "/tmp/zero", mode: .assist); XCTFail("Write failure ignored") } catch {}
        guard case .failed = client.state else { return XCTFail("Write failure missing from connection state") }
    }

    func testCompletedFailedCommandKeepsItsFailureStatus() {
        var store = CodexEventStore()
        store.reduce(.notification(method: "item/completed", params: .object([
            "threadId": .string("t"), "turnId": .string("u"),
            "item": .object(["id": .string("i"), "type": .string("commandExecution"), "status": .string("failed")])
        ])))
        XCTAssertEqual(store.thread(id: "t")?.item(id: "i")?.status, "failed")
    }

    func testTypedLifecycleDiffPlanOutputTokensAndApprovalReduction() {
        var store = CodexEventStore()
        store.reduce(.notification(method: "thread/started", params: .object(["thread": .object(["id": .string("t"), "name": .string("Task")])])))
        store.reduce(.notification(method: "turn/started", params: .object(["threadId": .string("t"), "turn": .object(["id": .string("u"), "status": .string("inProgress")])])))
        store.reduce(.notification(method: "item/started", params: .object(["threadId": .string("t"), "turnId": .string("u"), "item": .object(["id": .string("i"), "type": .string("commandExecution")])])))
        store.reduce(.notification(method: "item/commandExecution/outputDelta", params: params(delta: "output")))
        store.reduce(.notification(method: "turn/diff/updated", params: .object(["threadId": .string("t"), "turnId": .string("u"), "diff": .string("+line")])))
        store.reduce(.notification(method: "turn/plan/updated", params: .object(["threadId": .string("t"), "turnId": .string("u"), "plan": .array([.object(["step": .string("Test"), "status": .string("completed")])]) ])))
        store.reduce(.notification(method: "thread/tokenUsage/updated", params: .object(["threadId": .string("t"), "tokenUsage": .object(["total": .object(["totalTokens": .integer(42)])]) ])))
        store.reduce(.request(id: .string("approval"), method: "item/commandExecution/requestApproval", params: params(delta: "")))
        XCTAssertEqual(store.approvals.count, 1)
        store.reduce(.notification(method: "serverRequest/resolved", params: .object(["threadId": .string("t"), "requestId": .string("approval")])))
        store.reduce(.notification(method: "turn/completed", params: .object(["threadId": .string("t"), "turn": .object(["id": .string("u"), "status": .string("completed")])])))
        XCTAssertTrue(store.approvals.isEmpty)
        XCTAssertEqual(store.thread(id: "t")?.title, "Task")
        XCTAssertEqual(store.thread(id: "t")?.turns["u"]?.status, "completed")
        XCTAssertEqual(store.thread(id: "t")?.turns["u"]?.diff, "+line")
        XCTAssertEqual(store.thread(id: "t")?.turns["u"]?.plan.first?.step, "Test")
        XCTAssertEqual(store.thread(id: "t")?.item(id: "i")?.output, "output")
        XCTAssertEqual(store.thread(id: "t")?.tokenUsage["total"]["totalTokens"], .integer(42))
    }

    func testUnknownRetentionIsBoundedAndRequestsNeverAutoReply() async throws {
        var store = CodexEventStore(maximumUnknownEvents: 2)
        for n in 0..<3 { store.reduce(.notification(method: "future/\(n)", params: .object([:]))) }
        XCTAssertEqual(store.unknownEvents.count, 2)
        XCTAssertEqual(store.unknownEvents.first?.method, "future/1")
        let transport = RecordingTransport()
        let client = CodexAppServer(transport: transport)
        try await client.connect()
        transport.emit(.object(["id": .integer(88), "method": .string("item/commandExecution/requestApproval"), "params": params(delta: "")]))
        XCTAssertEqual(transport.messages.count, 3)
        XCTAssertEqual(client.store.approvals.count, 1)
        try client.reply(to: .integer(88), response: .object(["decision": .string("decline")]))
        XCTAssertEqual(transport.messages.last?["result"]["decision"], .string("decline"))
        XCTAssertTrue(client.store.approvals.isEmpty)
        XCTAssertThrowsError(try client.reply(to: .integer(88), response: .null))
        client.disconnect()
    }

    private func params(delta: String) -> CodexJSON {
        .object(["threadId": .string("t"), "turnId": .string("u"), "itemId": .string("i"), "delta": .string(delta)])
    }
}

@MainActor
private final class RecordingTransport: CodexTransport {
    var receive: ((CodexTransportEvent) -> Void)?
    var messages: [CodexJSON] = []
    var automatic = true
    var writeFailure = false
    var methods: [String] { messages.compactMap { $0["method"].string } }
    func start(receive: @escaping (CodexTransportEvent) -> Void) throws { self.receive = receive }
    func send(_ data: Data) throws {
        if writeFailure { throw CodexBridgeError.transport("Write failed") }
        let message = try JSONDecoder().decode(CodexJSON.self, from: data)
        messages.append(message)
        guard automatic, message["id"] != .null, message["method"].string != nil else { return }
        switch message["method"].string {
        case "model/list": respond(to: message, result: .object(["data": .array([.object(["model": .string("gpt-5.6-luna")])]), "nextCursor": .null]))
        case "thread/list": respond(to: message, result: .object(["data": .array([.object(["id": .string("listed"), "name": .string("Listed thread")])]), "nextCursor": .null]))
        case "thread/start": respond(to: message, result: .object(["thread": .object(["id": .string("owned-\(messages.count)")])]))
        case "turn/start": respond(to: message, result: .object(["turn": .object(["id": .string("turn")])]))
        default: respond(to: message, result: .object([:]))
        }
    }
    func stop() { receive = nil }
    func respond(to message: CodexJSON, result: CodexJSON) { emit(.object(["id": message["id"], "result": result])) }
    func emit(_ value: CodexJSON) { receive?(.data(try! CodexLineCodec.encode(value))) }
    func waitForCount(_ count: Int) async {
        for _ in 0..<10_000 { if messages.count >= count { return }; await Task.yield() }
        XCTFail("Timed out waiting for bridge writes")
    }
}
