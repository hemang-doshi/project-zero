import Foundation
import XCTest
@testable import ZeroCockpit
import ZeroKit

final class AirlockInspectorViewTests: XCTestCase {
    private let referenceNow = ISO8601DateFormatter().date(from: "2026-09-10T02:00:00Z")!

    func testRuntimeApprovalKeepsAuthoritySeparateFromOmittedDisplayInput() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected,
            now: referenceNow
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
        XCTAssertTrue(projection.canApprove(approval))
        XCTAssertTrue(projection.canDeny(approval))
        XCTAssertEqual(approval.freshness, .live)
    }

    func testRuntimeApprovalWithoutExactIdentityIsVisibleButNotActionable() throws {
        let malformed = snapshotJSON.replacingOccurrences(of: #""id":"runtime-approval-7""#, with: #""id":"""#)
        let snapshot = try CockpitSnapshot.decode(Data(malformed.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected,
            now: referenceNow
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertNil(approval.authority)
        XCTAssertFalse(projection.canApprove(approval))
        XCTAssertFalse(projection.canDeny(approval))
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
            codexConnection: .disconnected,
            now: referenceNow
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertEqual(approval.deadline, "Unavailable")
        XCTAssertNil(approval.authority)
        XCTAssertFalse(projection.canApprove(approval))
        XCTAssertFalse(projection.canDeny(approval))
    }

    func testRuntimeApprovalUsesStrictStringIdentityWithoutDisplayCoercion() throws {
        let malformed = snapshotJSON.replacingOccurrences(
            of: #""id":"runtime-approval-7""#,
            with: #""id":7"#
        )
        let snapshot = try CockpitSnapshot.decode(Data(malformed.utf8))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected,
            now: referenceNow
        )

        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertEqual(approval.requestID, "Unavailable")
        XCTAssertNil(approval.authority)
        XCTAssertFalse(projection.canApprove(approval))
        XCTAssertFalse(projection.canDeny(approval))
    }

    func testRuntimeApprovalExpiresAtDeadlineButExactDenyRemainsAvailable() throws {
        for (now, approveExpected, freshness) in [
            ("2026-09-10T02:59:59Z", true, AirlockEvidenceFreshness.live),
            ("2026-09-10T03:00:00Z", false, .expired),
            ("2026-09-10T03:00:01Z", false, .expired)
        ] {
            let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
            let projection = AirlockProjection(
                snapshot: snapshot,
                runtimeConnection: .live,
                codexStore: CodexEventStore(),
                codexConnection: .disconnected,
                now: try XCTUnwrap(ISO8601DateFormatter().date(from: now))
            )
            let approval = try XCTUnwrap(projection.approvals.first)
            XCTAssertEqual(projection.canApprove(approval), approveExpected, now)
            XCTAssertTrue(projection.canDeny(approval), now)
            XCTAssertEqual(approval.freshness, freshness, now)
        }
    }

    func testRuntimeConnectionProjectionDistinguishesLiveConnectingReconnectingAndCachedOffline() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let expected: [(RuntimeConnectionState, String, AirlockEvidenceFreshness)] = [
            (.live, "ZEROD LIVE", .live),
            (.connecting, "ZEROD CONNECTING · CACHED", .retained),
            (.reconnecting, "ZEROD RECONNECTING · CACHED", .retained),
            (.offline, "ZEROD OFFLINE · CACHED", .retained)
        ]
        for (state, label, freshness) in expected {
            let projection = AirlockProjection(
                snapshot: snapshot,
                runtimeConnection: state,
                codexStore: CodexEventStore(),
                codexConnection: .disconnected,
                now: referenceNow
            )
            XCTAssertEqual(projection.runtimeConnectionLabel, label)
            let approval = try XCTUnwrap(projection.approvals.first)
            XCTAssertEqual(approval.freshness, freshness)
            XCTAssertEqual(projection.canApprove(approval), state == .live)
            XCTAssertEqual(projection.canDeny(approval), state == .live)
        }
    }

    func testCodexApprovalShowsFullPermissionContextAndGatesAdvertisedDecisions() throws {
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
                "startedAtMs": .integer(1_789_000_000_000),
                "additionalPermissions": .object([
                    "fileSystem": .object(["write": .array([.string("/tmp/output")])]),
                    "network": .object(["enabled": .bool(true)])
                ]),
                "availableDecisions": .array([.string("decline")]),
                "commandActions": .array([.object([
                    "type": .string("unknown"), "command": .string("swift test")
                ])]),
                "proposedExecpolicyAmendment": .array([.string("prefix_rule(swift test)")]),
                "proposedNetworkPolicyAmendments": .array([.object([
                    "host": .string("example.test"), "action": .string("allow")
                ])]),
                "networkApprovalContext": .object([
                    "host": .string("example.test"), "protocol": .string("https")
                ])
            ])
        ))
        let projection = AirlockProjection(
            snapshot: snapshot,
            runtimeConnection: .offline,
            codexStore: codex,
            codexConnection: .connected,
            now: referenceNow
        )

        let runtime = try XCTUnwrap(projection.approvals.first { $0.origin == .runtime })
        let codexApproval = try XCTUnwrap(projection.approvals.first { $0.origin == .codex })
        XCTAssertFalse(projection.canApprove(runtime))
        XCTAssertFalse(projection.canDeny(runtime))
        XCTAssertFalse(projection.canApprove(codexApproval))
        XCTAssertTrue(projection.canDeny(codexApproval))
        XCTAssertEqual(codexApproval.authority, .codex(id: .integer(88)))
        XCTAssertEqual(codexApproval.target, "swift test")
        XCTAssertEqual(codexApproval.freshness, .live)
        let evidence = Dictionary(uniqueKeysWithValues: codexApproval.evidence.map { ($0.label, $0.value) })
        XCTAssertNotNil(evidence["Additional permissions"])
        XCTAssertNotNil(evidence["Available decisions"])
        XCTAssertNotNil(evidence["Command actions"])
        XCTAssertNotNil(evidence["Proposed execpolicy amendment"])
        XCTAssertNotNil(evidence["Proposed network policy amendments"])
        XCTAssertNotNil(evidence["Network approval context"])
        XCTAssertTrue(try XCTUnwrap(evidence["Full request parameters"]).contains("additionalPermissions"))
    }

    func testCodexApprovalRequiresExactMethodSpecificFieldsAndTypes() {
        let invalidParameters: [CodexJSON] = [
            .object([
                "threadId": .integer(1), "turnId": .string("turn"), "itemId": .string("item"),
                "startedAtMs": .integer(1), "command": .string("pwd")
            ]),
            .object([
                "threadId": .string("thread"), "turnId": .string("turn"), "itemId": .string("item"),
                "command": .string("pwd")
            ]),
            .object([
                "threadId": .string("thread"), "turnId": .string("turn"), "itemId": .string("item"),
                "startedAtMs": .integer(1), "command": .string("pwd"),
                "availableDecisions": .string("accept")
            ]),
            .object([
                "threadId": .string("thread"), "turnId": .string("turn"), "itemId": .string("item"),
                "startedAtMs": .integer(1), "command": .string("pwd"),
                "additionalPermissions": .object(["network": .string("yes")])
            ])
        ]

        for (index, params) in invalidParameters.enumerated() {
            var codex = CodexEventStore()
            codex.reduce(.request(
                id: .integer(Int64(index)),
                method: "item/commandExecution/requestApproval",
                params: params
            ))
            let projection = AirlockProjection(
                snapshot: nil,
                runtimeConnection: .offline,
                codexStore: codex,
                codexConnection: .connected,
                now: referenceNow
            )
            let approval = projection.approvals[0]
            XCTAssertNil(approval.authority, "case \(index)")
            XCTAssertFalse(projection.canApprove(approval), "case \(index)")
            XCTAssertFalse(projection.canDeny(approval), "case \(index)")
            XCTAssertNotNil(approval.responseUnavailableReason, "case \(index)")
        }
    }

    func testFileApprovalUsesSchemaDecisionSetAndMarksOnlyRoutingFieldsAuthoritative() throws {
        var codex = CodexEventStore()
        codex.reduce(.request(
            id: .string("file-1"),
            method: "item/fileChange/requestApproval",
            params: .object([
                "threadId": .string("thread-1"),
                "turnId": .string("turn-2"),
                "itemId": .string("item-3"),
                "startedAtMs": .integer(1_789_000_000_000),
                "grantRoot": .string("/project-zero"),
                "reason": .string("Apply reviewed patch")
            ])
        ))
        let projection = AirlockProjection(
            snapshot: nil,
            runtimeConnection: .offline,
            codexStore: codex,
            codexConnection: .connected,
            now: referenceNow
        )
        let approval = try XCTUnwrap(projection.approvals.first)
        XCTAssertTrue(projection.canApprove(approval))
        XCTAssertTrue(projection.canDeny(approval))
        XCTAssertEqual(Set(approval.evidence.filter(\.isAuthoritative).map(\.label)), ["Request ID", "Action"])
        XCTAssertFalse(try XCTUnwrap(approval.evidence.first { $0.label == "Target" }).isAuthoritative)
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
            codexConnection: .connected,
            now: referenceNow
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
