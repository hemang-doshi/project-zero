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
            runtimeConnection: .live,
            connection: .connected,
            store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()],
            models: []
        )

        XCTAssertTrue(projection.canSend(threadID: "owned", selectedProjectID: "project-zero", text: "Run the tests"))
        XCTAssertEqual(projection.settings(threadID: "owned"), CodexMode.work.settings)
        XCTAssertNil(projection.settings(threadID: "history"))
        XCTAssertFalse(projection.canSend(threadID: "owned", selectedProjectID: "project-zero", text: "  \n"))
        XCTAssertFalse(projection.canSend(threadID: "history", selectedProjectID: "project-zero", text: "Run the tests"))
        XCTAssertFalse(projection.canSend(threadID: nil, selectedProjectID: "project-zero", text: "Run the tests"))
        XCTAssertFalse(projection.canSend(threadID: "owned", selectedProjectID: "removed", text: "Run the tests"))

        let disconnected = ZeroBotProjection(
            snapshot: try snapshot(),
            connection: .disconnected,
            store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()],
            models: []
        )
        XCTAssertFalse(disconnected.canSend(threadID: "owned", selectedProjectID: "project-zero", text: "Run the tests"))
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

        let offline = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .offline, connection: .connected,
            store: CodexEventStore(), threadSettings: [:], models: [.object(["id": .string("gpt-5.6-sol")])]
        )
        XCTAssertFalse(offline.canStartThread(projectID: "project-zero", modelID: "gpt-5.6-sol"))
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
            threadProjects: ["owned": projectBinding()],
            models: []
        )

        let turn = try XCTUnwrap(projection.activeTurn(in: projection.thread(id: "owned")))
        XCTAssertEqual(turn.id, "turn-7")
        XCTAssertTrue(projection.canInterrupt(threadID: "owned", turnID: turn.id))
        XCTAssertFalse(projection.canInterrupt(threadID: "history", turnID: turn.id))
        XCTAssertFalse(projection.canInterrupt(threadID: "owned", turnID: nil))
    }

    func testApprovalRequiresExactSelectedOwnedActiveThreadTurnAndItem() throws {
        var store = CodexEventStore()
        addActiveCommand(threadID: "owned", turnID: "turn-7", itemID: "item-9", to: &store)
        addActiveCommand(threadID: "other", turnID: "turn-8", itemID: "item-10", to: &store)
        addActiveCommand(threadID: "owned", turnID: "turn-other", itemID: "item-other", to: &store)
        store.reduce(.request(id: .integer(12), method: "item/commandExecution/requestApproval", params: approvalParams()))
        store.reduce(.request(id: .integer(13), method: "item/commandExecution/requestApproval", params: approvalParams(threadID: "other", turnID: "turn-8", itemID: "item-10")))
        store.reduce(.request(id: .integer(14), method: "item/commandExecution/requestApproval", params: approvalParams(threadID: "", turnID: "turn-7", itemID: "item-9")))
        store.reduce(.request(id: .integer(15), method: "item/commandExecution/requestApproval", params: approvalParams(threadID: "owned", turnID: "missing", itemID: "item-9")))
        store.reduce(.request(id: .integer(16), method: "item/commandExecution/requestApproval", params: approvalParams(threadID: "owned", turnID: "turn-7", itemID: "missing")))
        store.reduce(.request(id: .integer(17), method: "item/fileChange/requestApproval", params: approvalParams()))
        store.reduce(.request(id: .integer(18), method: "item/commandExecution/requestApproval", params: approvalParams(threadID: "owned", turnID: "turn-7", itemID: "item-other")))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )
        let valid = try XCTUnwrap(store.approvals.first { $0.id == .integer(12) })
        XCTAssertEqual(projection.approvalAvailability(valid, selectedThreadID: "owned"), .actionable)

        XCTAssertNotEqual(projection.approvalAvailability(valid, selectedThreadID: "other"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(13) }), selectedThreadID: "other"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(14) }), selectedThreadID: "owned"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(15) }), selectedThreadID: "owned"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(16) }), selectedThreadID: "owned"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(17) }), selectedThreadID: "owned"), .actionable)
        XCTAssertNotEqual(projection.approvalAvailability(try XCTUnwrap(store.approvals.first { $0.id == .integer(18) }), selectedThreadID: "owned"), .actionable)

        var terminalStore = store
        terminalStore.reduce(.notification(method: "turn/completed", params: .object([
            "threadId": .string("owned"),
            "turn": .object(["id": .string("turn-7"), "status": .string("completed")])
        ])))
        let terminalProjection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: terminalStore,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )
        XCTAssertNotEqual(terminalProjection.approvalAvailability(valid, selectedThreadID: "owned"), .actionable)

        var resolvedStore = store
        resolvedStore.resolve(valid.id)
        let resolvedProjection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: resolvedStore,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )
        XCTAssertNotEqual(resolvedProjection.approvalAvailability(valid, selectedThreadID: "owned"), .actionable)

    }

    func testErrorsBecomeBoundedSelectableEvidence() throws {
        var store = CodexEventStore()
        store.reduce(.notification(method: "error", params: .object([
            "code": .integer(-32000), "message": .string("server pipeline failed")
        ])))
        store.reduce(.notification(method: "turn/completed", params: .object([
            "threadId": .string("owned"),
            "turn": .object([
                "id": .string("turn-7"), "status": .string("failed"),
                "error": .object(["message": .string("tool invocation failed")])
            ])
        ])))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )

        let protocolError = try XCTUnwrap(projection.protocolErrorEvidence)
        XCTAssertEqual(protocolError.title, "APP-SERVER ERROR")
        XCTAssertTrue(protocolError.content.contains("server pipeline failed"))
        let turn = try XCTUnwrap(store.thread(id: "owned")?.turns["turn-7"])
        let turnError = try XCTUnwrap(projection.turnErrorEvidence(turn))
        XCTAssertEqual(turnError.title, "TURN ERROR")
        XCTAssertTrue(turnError.content.contains("tool invocation failed"))
    }

    func testFailedConnectionNeverPresentsRetainedStateAsLiveHealthyOrOwned() throws {
        var store = CodexEventStore()
        addActiveCommand(threadID: "owned", turnID: "turn-7", itemID: "item-9", to: &store)
        store.reduce(.notification(method: "thread/tokenUsage/updated", params: .object([
            "threadId": .string("owned"), "tokenUsage": .object(["totalTokens": .integer(42)])
        ])))
        store.reduce(.request(id: .integer(12), method: "item/commandExecution/requestApproval", params: approvalParams()))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .failed("pipe closed"), store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )

        XCTAssertEqual(projection.threadPresentation(threadID: "owned").label, "RETAINED EVIDENCE")
        XCTAssertEqual(projection.threadPresentation(threadID: "owned").tone, .neutral)
        XCTAssertEqual(projection.evidenceTone(.healthy), .neutral)
        XCTAssertEqual(projection.tokenUsageBadge(truncated: false), "RETAINED")
        XCTAssertEqual(projection.approvalCountLabel, "1 RETAINED")
        XCTAssertNotEqual(projection.approvalAvailability(store.approvals[0], selectedThreadID: "owned"), .actionable)
        XCTAssertEqual(projection.retainedConnectionEvidence, "pipe closed")
    }

    func testCommandOutputStillProjectsExactExecutionMetadataAndRawEvidence() throws {
        var store = CodexEventStore()
        store.reduce(.notification(method: "item/completed", params: .object([
            "threadId": .string("owned"), "turnId": .string("turn-7"),
            "item": .object([
                "id": .string("item-9"), "type": .string("commandExecution"), "status": .string("completed"),
                "command": .string("swift test --filter ZeroBotViewTests"),
                "cwd": .string("/bounded/project-zero"), "processId": .string("842"),
                "exitCode": .integer(0), "durationMs": .integer(731),
                "commandActions": .array([.object(["type": .string("test")])]),
                "aggregatedOutput": .string("All tests passed")
            ])
        ])))
        let projection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )
        let item = try XCTUnwrap(store.thread(id: "owned")?.item(id: "item-9"))
        let fields = projection.itemMetadataFields(item)
        XCTAssertEqual(fields.first { $0.label == "COMMAND" }?.value, "swift test --filter ZeroBotViewTests")
        XCTAssertEqual(fields.first { $0.label == "WORKING DIRECTORY" }?.value, "/bounded/project-zero")
        XCTAssertEqual(fields.first { $0.label == "EXIT CODE" }?.value, "0")
        XCTAssertEqual(fields.first { $0.label == "DURATION" }?.value, "731 ms")
        XCTAssertEqual(fields.first { $0.label == "PROCESS" }?.value, "842")
        XCTAssertTrue(fields.first { $0.label == "PARSED ACTIONS" }?.value.contains("test") == true)
        XCTAssertTrue(try XCTUnwrap(projection.itemMetadataEvidence(item)).content.contains("commandActions"))
        XCTAssertEqual(item.output, "All tests passed")
    }

    func testOwnedThreadProjectBindingIsVisibleAndDraftMismatchBlocksSend() throws {
        var store = CodexEventStore()
        addThread("owned", to: &store)
        let projection = ZeroBotProjection(
            snapshot: try snapshot(), runtimeConnection: .live, connection: .connected, store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )

        XCTAssertEqual(projection.projectBinding(threadID: "owned")?.projectID, "project-zero")
        XCTAssertEqual(projection.projectBinding(threadID: "owned")?.path, "/bounded/project-zero")
        XCTAssertTrue(projection.canSend(threadID: "owned", selectedProjectID: "project-zero", text: "continue"))
        XCTAssertFalse(projection.canSend(threadID: "owned", selectedProjectID: "another-project", text: "continue"))
        XCTAssertTrue(projection.projectSelectionMismatch(threadID: "owned", selectedProjectID: "another-project"))

        let changedPathSnapshot = try CockpitSnapshot.decode(Data(snapshotJSON.replacingOccurrences(
            of: "/bounded/project-zero", with: "/bounded/moved-project-zero"
        ).utf8))
        let stale = ZeroBotProjection(
            snapshot: changedPathSnapshot, runtimeConnection: .live, connection: .connected, store: store,
            threadSettings: ["owned": CodexMode.work.settings],
            threadProjects: ["owned": projectBinding()], models: []
        )
        XCTAssertFalse(stale.canSend(threadID: "owned", selectedProjectID: "project-zero", text: "continue"))
    }

    func testProjectBindingSurvivesSceneRecreationButDoesNotTrustMalformedState() {
        let bindings = ["owned": projectBinding()]
        let encoded = ZeroBotProjectBindingCodec.encode(bindings)

        XCTAssertFalse(encoded.isEmpty)
        XCTAssertEqual(ZeroBotProjectBindingCodec.decode(encoded), bindings)
        XCTAssertTrue(ZeroBotProjectBindingCodec.decode("not-json").isEmpty)
    }

    func testZeroBotTypographyUsesDynamicTypeRelativeTextStyles() {
        XCTAssertTrue(ZeroBotTypography.usesDynamicTypeRelativeStyles)
        XCTAssertEqual(ZeroBotTypography.minimumProminentStyle, .caption2)
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
        XCTAssertFalse(projection.canSend(threadID: "history", selectedProjectID: "project-zero", text: "continue"))
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

    private func addActiveCommand(threadID: String, turnID: String, itemID: String, to store: inout CodexEventStore) {
        addThread(threadID, to: &store)
        store.reduce(.notification(method: "turn/started", params: .object([
            "threadId": .string(threadID),
            "turn": .object(["id": .string(turnID), "status": .string("inProgress")])
        ])))
        store.reduce(.notification(method: "item/started", params: .object([
            "threadId": .string(threadID), "turnId": .string(turnID),
            "item": .object(["id": .string(itemID), "type": .string("commandExecution"), "status": .string("inProgress")])
        ])))
    }

    private func approvalParams(
        threadID: String = "owned", turnID: String = "turn-7", itemID: String = "item-9"
    ) -> CodexJSON {
        .object([
            "threadId": .string(threadID), "turnId": .string(turnID), "itemId": .string(itemID),
            "startedAtMs": .integer(1), "command": .string("swift test"), "cwd": .string("/bounded/project-zero")
        ])
    }

    private func projectBinding() -> ZeroBotProjectBinding {
        ZeroBotProjectBinding(projectID: "project-zero", name: "Project Zero", path: "/bounded/project-zero")
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
