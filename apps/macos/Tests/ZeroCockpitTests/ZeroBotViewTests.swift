import XCTest
@testable import ZeroCockpit
import ZeroKit

final class ZeroBotViewTests: XCTestCase {
    func testSendRequiresConnectedProjectZeroOwnedThreadAndNonemptyIntent() throws {
        var store = CodexEventStore()
        addThread("owned", to: &store)
        addThread("history", to: &store)
        let projection = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .connected,
            store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            models: []
        )

        XCTAssertTrue(projection.canSend(threadID: "owned", text: "Run the tests"))
        XCTAssertEqual(projection.settings(threadID: "owned"), CodexMode.work.settings)
        XCTAssertNil(projection.settings(threadID: "history"))
        XCTAssertFalse(projection.canSend(threadID: "owned", text: "  \n"))
        XCTAssertFalse(projection.canSend(threadID: "history", text: "Run the tests"))
        XCTAssertFalse(projection.canSend(threadID: nil, text: "Run the tests"))

        let disconnected = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .disconnected,
            store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            models: []
        )
        XCTAssertFalse(disconnected.canSend(threadID: "owned", text: "Run the tests"))
    }

    func testStartingThreadRequiresExplicitRegisteredProjectAndModel() throws {
        let projection = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .connected,
            store: CodexEventStore(),
            threadSettings: [:],
            models: [.object(["id": .string("gpt-5.6-sol")])]
        )

        XCTAssertTrue(projection.canStartThread(projectID: "project-zero", modelID: "gpt-5.6-sol"))
        XCTAssertFalse(projection.canStartThread(projectID: nil, modelID: "gpt-5.6-sol"))
        XCTAssertFalse(projection.canStartThread(projectID: "removed", modelID: "gpt-5.6-sol"))
        XCTAssertFalse(projection.canStartThread(projectID: "project-zero", modelID: ""))
        XCTAssertFalse(projection.canStartThread(projectID: "project-zero", modelID: "not-advertised"))
        XCTAssertEqual(projection.registeredProjects.map(\.id), ["project-zero"])
    }

    func testActiveTurnAndInterruptRemainBoundToExactOwnedThread() throws {
        var store = CodexEventStore()
        addThread("owned", to: &store)
        store.reduce(.notification(method: "turn/started", params: .object([
            "threadId": .string("owned"),
            "turn": .object(["id": .string("turn-7"), "status": .string("inProgress")])
        ])))
        store.reduce(.notification(method: "item/started", params: .object([
            "threadId": .string("owned"),
            "turnId": .string("turn-7"),
            "item": .object(["id": .string("item-9"), "type": .string("commandExecution"), "status": .string("inProgress")])
        ])))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .connected,
            store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            models: []
        )

        let turn = try XCTUnwrap(projection.activeTurn(in: projection.thread(id: "owned")))
        XCTAssertEqual(turn.id, "turn-7")
        XCTAssertTrue(projection.canInterrupt(threadID: "owned", turnID: turn.id))
        XCTAssertFalse(projection.canInterrupt(threadID: "history", turnID: turn.id))
        XCTAssertFalse(projection.canInterrupt(threadID: "owned", turnID: nil))
    }

    func testApprovalPayloadsExistOnlyForImplementedBinaryProtocols() {
        XCTAssertEqual(
            ZeroBotProjection.approvalResponse(method: "item/commandExecution/requestApproval", approve: true),
            .object(["decision": .string("accept")])
        )
        XCTAssertEqual(
            ZeroBotProjection.approvalResponse(method: "item/fileChange/requestApproval", approve: false),
            .object(["decision": .string("decline")])
        )
        XCTAssertNil(ZeroBotProjection.approvalResponse(method: "item/tool/requestUserInput", approve: true))
        XCTAssertNil(ZeroBotProjection.approvalResponse(method: "item/permissions/requestApproval", approve: true))
        XCTAssertNil(ZeroBotProjection.approvalResponse(method: "future/requestApproval", approve: true))
    }

    func testModelOptionsDistinguishPolicyDefaultFromAdvertisedModels() throws {
        let projection = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .connected,
            store: CodexEventStore(),
            threadSettings: [:],
            models: [
                .object(["id": .string("gpt-5.6-luna"), "displayName": .string("Luna")]),
                .object(["model": .string("gpt-6-astra"), "name": .string("Astra")])
            ]
        )

        XCTAssertEqual(projection.modelOptions(mode: .assist), [
            ZeroBotModelOption(id: "gpt-5.6-luna", label: "Luna", advertised: true),
            ZeroBotModelOption(id: "gpt-6-astra", label: "Astra", advertised: true)
        ])
        XCTAssertFalse(projection.modelOptions(mode: .work).contains { $0.id == "gpt-5.6-sol" })
        XCTAssertFalse(projection.isAdvertisedModel("gpt-5.6-sol"))

        let beforeDiscovery = ZeroBotProjection(
            snapshot: try snapshot(), connection: .disconnected, store: CodexEventStore(),
            threadSettings: [:], models: []
        )
        XCTAssertEqual(beforeDiscovery.modelOptions(mode: .work).first,
                       ZeroBotModelOption(id: "gpt-5.6-sol", label: "gpt-5.6-sol", advertised: false))
    }

    func testKnownItemKindsHaveDistinctCategoriesAndUnknownRemainsGeneric() {
        XCTAssertEqual(ZeroBotItemCategory(kind: "userMessage"), .operatorMessage)
        XCTAssertEqual(ZeroBotItemCategory(kind: "agentMessage"), .agentMessage)
        XCTAssertEqual(ZeroBotItemCategory(kind: "reasoning"), .reasoning)
        XCTAssertEqual(ZeroBotItemCategory(kind: "plan"), .plan)
        XCTAssertEqual(ZeroBotItemCategory(kind: "commandExecution"), .command)
        XCTAssertEqual(ZeroBotItemCategory(kind: "fileChange"), .fileChange)
        XCTAssertEqual(ZeroBotItemCategory(kind: "mcpToolCall"), .tool)
        XCTAssertEqual(ZeroBotItemCategory(kind: "futureThing"), .other)
    }

    func testUnknownJSONIsInspectableAndFurtherRenderingIsBounded() {
        let value: CodexJSON = .object([
            "method": .string("future/event"),
            "params": .object(["value": .string(String(repeating: "x", count: 400))])
        ])

        let complete = ZeroBotProjection.jsonText(value, limit: 2_000)
        XCTAssertFalse(complete.truncated)
        XCTAssertTrue(complete.text.contains("future/event"))

        let clipped = ZeroBotProjection.jsonText(value, limit: 64)
        XCTAssertTrue(clipped.truncated)
        XCTAssertTrue(clipped.text.hasPrefix("…\n"))
    }

    func testDisconnectedCodexStateMarksRetainedWorkAndApprovalsNonLive() throws {
        var store = CodexEventStore()
        addThread("history", to: &store)
        store.reduce(.request(
            id: .integer(12),
            method: "item/commandExecution/requestApproval",
            params: .object(["threadId": .string("history"), "command": .string("swift test")])
        ))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .exited(1),
            store: store,
            threadSettings: ["history": CodexMode.work.settings],
            models: []
        )

        XCTAssertTrue(projection.retainedOnly)
        XCTAssertEqual(projection.evidenceStatus("inProgress"), "RETAINED · INPROGRESS")
        XCTAssertEqual(projection.approvalCountLabel, "1 RETAINED")
        XCTAssertTrue(projection.historyNotice.contains("not a live or actionable run"))
        XCTAssertFalse(projection.canSend(threadID: "history", text: "continue"))
        XCTAssertFalse(projection.canInterrupt(threadID: "history", turnID: "turn-1"))
    }

    @MainActor
    func testConstructingViewDoesNotConnectCodexOrStartWork() {
        let model = CockpitModel.preview()
        _ = ZeroBotView(model: model)

        XCTAssertEqual(model.codexConnection, .disconnected)
        XCTAssertTrue(model.codex.store.threads.isEmpty)
        XCTAssertTrue(model.codex.store.approvals.isEmpty)
    }

    private func addThread(_ id: String, to store: inout CodexEventStore) {
        store.reduce(.notification(method: "thread/started", params: .object([
            "thread": .object(["id": .string(id), "name": .string("Thread \(id)")])
        ])))
    }

    private func snapshot() throws -> CockpitSnapshot {
        try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
    }

    private let snapshotJSON = #"""
    {
      "version":"0.1","revision":9,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",
      "release":{"version":"0.2.0","build":"7"},
      "session":{"id":null,"project_id":null,"project":"","state":"IDLE","elapsed_ms":0,"since_ms":0,"revision":0},
      "integrations":[],"policies":[],"context":{},
      "projects":[
        {"id":"project-zero","name":"Project Zero","path":"/bounded/project-zero","removed":false},
        {"id":"removed","name":"Removed","path":"/bounded/removed","removed":true}
      ],
      "nodes":[],"node_profiles":[],"approvals":[],"firings":[],"invocations":[],"events":[],"audit":[],"truncated":{}
    }
    """#
}
