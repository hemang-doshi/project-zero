import XCTest
@testable import ZeroCockpit
import ZeroKit

final class AirlockInspectorViewTests: XCTestCase {
    func testRuntimeApprovalKeepsAuthoritySeparateFromOmittedDisplayInput() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertEqual(approval.id, "runtime:runtime-approval-7")
        XCTAssertEqual(approval.requestID, "runtime-approval-7")
        XCTAssertEqual(approval.action, "capabilities.invoke")
        XCTAssertEqual(approval.target, "desk-node")
        XCTAssertEqual(approval.source, "Project Zero · zerod")
        XCTAssertEqual(approval.deadline, "2026-09-10T03:00:00Z")
        XCTAssertEqual(approval.decision, "WAITING_APPROVAL")
        XCTAssertTrue(approval.inputOmitted)
        XCTAssertEqual(approval.authority, .runtime(id: "runtime-approval-7"))
        XCTAssertTrue(projection.canResolve(approval))
    }

    func testRuntimeApprovalWithoutExactIdentityIsVisibleButNotActionable() throws {
        let malformed = snapshotJSON.replacingOccurrences(of: #""id":"runtime-approval-7""#, with: #""id":"""#)
        let snapshot = try CockpitSnapshot.decode(Data(malformed.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertNil(approval.authority)
        XCTAssertFalse(projection.canResolve(approval))
        XCTAssertEqual(approval.requestID, "Unavailable")
    }

    func testRuntimeApprovalWithoutExactDeadlineIsNotActionable() throws {
        let malformed = snapshotJSON.replacingOccurrences(
            of: ",\"deadline\":\"2026-09-10T03:00:00Z\"",
            with: ""
        )
        let snapshot = try CockpitSnapshot.decode(Data(malformed.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertEqual(approval.deadline, "Unavailable")
        XCTAssertNil(approval.authority)
        XCTAssertFalse(projection.canResolve(approval))
    }

    func testCodexApprovalRemainsActionableWhenRuntimeIsOffline() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        var codex = CodexEventStore()
        codex.reduce(.request(
            id: .integer(88),
            method: "item/commandExecution/requestApproval",
            params: .object([
                "threadId": .string("thread-1"),
                "turnId": .string("turn-2"),
                "itemId": .string("item-3"),
                "command": .string("swift test"),
                "cwd": .string("/project-zero"),
                "startedAtMs": .integer(1_789_000_000_000)
            ])
        ))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .offline,
            codexStore: codex,
            codexConnection: .connected
        )

        let runtime = try XCTUnwrap(projection.approvals.first { $0.origin == .runtime })
        let codexApproval = try XCTUnwrap(projection.approvals.first { $0.origin == .codex })
        XCTAssertFalse(projection.canResolve(runtime))
        XCTAssertTrue(projection.canResolve(codexApproval))
        XCTAssertEqual(codexApproval.authority, .codex(id: .integer(88)))
        XCTAssertEqual(codexApproval.target, "swift test")
    }

    func testCodexDecisionPayloadExistsOnlyForMatchingDecisionProtocols() {
        XCTAssertEqual(
            AirlockProjection.codexDecisionResponse(
                method: "item/commandExecution/requestApproval",
                approve: true
            ),
            .object(["decision": .string("accept")])
        )
        XCTAssertEqual(
            AirlockProjection.codexDecisionResponse(
                method: "item/fileChange/requestApproval",
                approve: false
            ),
            .object(["decision": .string("decline")])
        )
        XCTAssertNil(AirlockProjection.codexDecisionResponse(
            method: "item/permissions/requestApproval",
            approve: true
        ))
        XCTAssertNil(AirlockProjection.codexDecisionResponse(
            method: "item/tool/requestUserInput",
            approve: false
        ))
    }

    func testInspectorSelectionUsesExactOriginQualifiedIdentity() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        var codex = CodexEventStore()
        codex.reduce(.request(
            id: .string("runtime-approval-7"),
            method: "item/fileChange/requestApproval",
            params: .object([
                "threadId": .string("thread-1"),
                "turnId": .string("turn-2"),
                "itemId": .string("item-3"),
                "grantRoot": .string("/project-zero")
            ])
        ))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: codex,
            codexConnection: .connected
        )

        XCTAssertEqual(projection.item(selectionID: "runtime:runtime-approval-7")?.origin, .runtime)
        XCTAssertEqual(projection.item(selectionID: "codex:s:runtime-approval-7")?.origin, .codex)
        XCTAssertNil(projection.item(selectionID: "runtime-approval-7"))
    }

    private let snapshotJSON = #"""
    {
      "version":"0.1","revision":42,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",
      "release":{"version":"0.2.0","build":"7"},
      "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":1,"since_ms":0,"revision":3},
      "integrations":[],
      "policies":[{"id":"git-refresh","enabled":true,"status":"READY"}],
      "context":{},
      "projects":[{"id":"p","name":"Project Zero","path":"/display/path","removed":false}],
      "nodes":[],"node_profiles":[],
      "approvals":[{
        "id":"runtime-approval-7","node":"desk-node","capability":"capabilities.invoke",
        "input":{"project_id":"p","state":"RUNNING"},"input_omitted":true,
        "hash":"hash-7","status":"WAITING_APPROVAL","deadline":"2026-09-10T03:00:00Z"
      }],
      "firings":[],"invocations":[],"events":[],
      "audit":[{"seq":8,"principal":"owner","action":"approvals.approve","target":"runtime-approval-1","decision":"ALLOW","correlation":"event-9","time":"2026-09-10T00:01:00Z","previous_hash":"prev","hash":"hash"}],
      "truncated":{"approvals":true,"audit":false}
    }
    """#
}
