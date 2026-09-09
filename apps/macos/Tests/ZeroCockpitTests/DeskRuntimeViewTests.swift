import CoreGraphics
import XCTest
@testable import ZeroCockpit
import ZeroKit

final class DeskRuntimeViewTests: XCTestCase {
    func testLayoutBreakpointsPreserveWideDashboardAndCompactStack() {
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 1_020), .wide)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 1_019), .regular)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 720), .regular)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 719), .compact)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 1_200).metricColumns, 4)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 800).metricColumns, 2)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 500).metricColumns, 1)
        XCTAssertEqual(DeskRuntimeLayout.mode(for: 1_200, accessibilitySize: true), .compact)
    }

    func testOfflineFactsNeverClaimRuntimeState() {
        let facts = DeskRuntimeFacts(
            snapshot: nil,
            connection: .offline,
            runtimeStatusLabel: "Runtime offline",
            runtimeStatusTone: .error,
            activeProjectName: "No active project",
            focusElapsedLabel: "0:00:00",
            deliveryState: .offline,
            attentionCount: 0
        )

        XCTAssertFalse(facts.isLive)
        XCTAssertEqual(facts.sessionState, "UNAVAILABLE")
        XCTAssertEqual(facts.runtimeVersion, "Unavailable")
        XCTAssertEqual(facts.revisionLabel, "Unavailable")
        XCTAssertEqual(facts.nodeCount, 0)
        XCTAssertEqual(facts.deliveryState.presentation.label, "Offline")
    }

    func testRetainedSnapshotIsCachedAndNeverPresentedAsCurrentAfterTransportLoss() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let facts = DeskRuntimeFacts(
            snapshot: snapshot,
            connection: .reconnecting,
            runtimeStatusLabel: "Reconnecting",
            runtimeStatusTone: .attention,
            activeProjectName: "Project Zero",
            focusElapsedLabel: "1:01:01",
            deliveryState: .delivered,
            attentionCount: 3,
            codexApprovalCount: 1,
            hasUncertainCommand: false
        )

        XCTAssertFalse(facts.isLive)
        XCTAssertTrue(facts.hasCachedSnapshot)
        XCTAssertNil(facts.authoritativeSnapshot)
        XCTAssertEqual(facts.sessionState, "UNAVAILABLE")
        XCTAssertEqual(facts.activeProjectName, "Unavailable")
        XCTAssertEqual(facts.focusElapsedLabel, "Unavailable")
        XCTAssertEqual(facts.runtimeVersion, "Unavailable")
        XCTAssertEqual(facts.revisionLabel, "Unavailable")
        XCTAssertEqual(facts.enabledIntegrationCount, 0)
        XCTAssertEqual(facts.nodeCount, 0)
        XCTAssertEqual(facts.attentionCount, 1)
        XCTAssertEqual(facts.deliveryState, .offline)
    }

    func testCodexAttentionRemainsVisibleWhenRuntimeIsOffline() {
        let facts = DeskRuntimeFacts(
            snapshot: nil,
            connection: .offline,
            runtimeStatusLabel: "Runtime offline",
            runtimeStatusTone: .error,
            activeProjectName: "No active project",
            focusElapsedLabel: "0:00:00",
            deliveryState: .offline,
            attentionCount: 2,
            codexApprovalCount: 2,
            hasUncertainCommand: false
        )

        XCTAssertEqual(facts.attentionSource, .codexApproval)
        XCTAssertEqual(facts.attentionCount, 2)
    }

    func testCodexFactsExposeConnectedActiveWorkAndApprovals() {
        let store = codexStoreWithActiveWork()
        let facts = DeskCodexFacts(state: .connected, store: store)

        XCTAssertEqual(facts.connectionLabel, "Codex connected")
        XCTAssertEqual(facts.threadCount, 1)
        XCTAssertEqual(facts.activeTurnCount, 1)
        XCTAssertEqual(facts.activeItemCount, 1)
        XCTAssertEqual(facts.approvalCount, 1)
        XCTAssertEqual(facts.workLabel, "1 active turn · 1 streaming item")
    }

    func testCodexExitOrFailureMakesRetainedWorkNonActionableEvidence() {
        let store = codexStoreWithActiveWork()

        for state in [CodexConnectionState.exited(9), .failed("transport closed")] {
            let facts = DeskCodexFacts(state: state, store: store)

            XCTAssertFalse(facts.isConnected)
            XCTAssertEqual(facts.activeTurnCount, 0)
            XCTAssertEqual(facts.activeItemCount, 0)
            XCTAssertEqual(facts.approvalCount, 0)
            XCTAssertTrue(facts.hasRetainedEvidence)
            XCTAssertEqual(facts.retainedActiveTurnCount, 1)
            XCTAssertEqual(facts.retainedActiveItemCount, 1)
            XCTAssertEqual(facts.retainedApprovalCount, 1)
            XCTAssertTrue(facts.workLabel.localizedCaseInsensitiveContains("retained"))
            XCTAssertTrue(facts.workLabel.localizedCaseInsensitiveContains("not actionable"))
        }
    }

    func testRuntimeFactsReflectOnlyDecodedSnapshotCounts() throws {
        let data = Data(snapshotJSON.utf8)
        let snapshot = try CockpitSnapshot.decode(data)
        let facts = DeskRuntimeFacts(
            snapshot: snapshot,
            connection: .live,
            runtimeStatusLabel: "Runtime live",
            runtimeStatusTone: .healthy,
            activeProjectName: "Project Zero",
            focusElapsedLabel: "1:01:01",
            deliveryState: .delivered,
            attentionCount: 1
        )

        XCTAssertTrue(facts.isLive)
        XCTAssertEqual(facts.sessionState, "RUNNING")
        XCTAssertEqual(facts.runtimeVersion, "0.2.0")
        XCTAssertEqual(facts.revisionLabel, "42")
        XCTAssertEqual(facts.enabledIntegrationCount, 1)
        XCTAssertEqual(facts.onlineNodeCount, 1)
        XCTAssertEqual(facts.nodeCount, 2)
        XCTAssertEqual(facts.attentionCount, 1)
        XCTAssertEqual(facts.attentionLabel, "1+")
        XCTAssertEqual(facts.policyCount, 2)
        XCTAssertEqual(facts.contextCount, 2)
        XCTAssertEqual(facts.firingStateCounts, ["CANCELLED": 1, "DELIVERING": 1, "FAILED": 1, "PENDING": 1, "REVIEWED": 1])
        XCTAssertEqual(facts.activeFiringCount, 2)
        XCTAssertEqual(facts.runtimeWorkTotal, 4)
        XCTAssertEqual(facts.runtimeWorkLabel, "4+")
    }

    func testTerminalFiringHistoryDoesNotCreateAnActiveMission() throws {
        var payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(snapshotJSON.utf8)) as? [String: Any])
        payload["session"] = [
            "id": NSNull(), "project_id": NSNull(), "project": "", "state": "IDLE",
            "elapsed_ms": 0, "since_ms": 0, "revision": 4
        ]
        payload["approvals"] = []
        payload["firings"] = [
            ["id": "failed", "state": "FAILED"],
            ["id": "cancelled", "state": "CANCELLED"],
            ["id": "reviewed", "state": "REVIEWED"]
        ]
        payload["truncated"] = ["approvals": false, "firings": false]
        let snapshot = try CockpitSnapshot.decode(JSONSerialization.data(withJSONObject: payload))
        let facts = DeskRuntimeFacts(
            snapshot: snapshot,
            connection: .live,
            runtimeStatusLabel: "Runtime live",
            runtimeStatusTone: .healthy,
            activeProjectName: "No active project",
            focusElapsedLabel: "0:00:00",
            deliveryState: .delivered,
            attentionCount: 0
        )

        XCTAssertEqual(facts.firingStateCounts, ["CANCELLED": 1, "FAILED": 1, "REVIEWED": 1])
        XCTAssertEqual(facts.activeFiringCount, 0)
        XCTAssertEqual(facts.runtimeWorkTotal, 0)
        XCTAssertEqual(facts.runtimeWorkLabel, "0")
    }

    private func codexStoreWithActiveWork() -> CodexEventStore {
        var store = CodexEventStore()
        store.reduce(.notification(method: "thread/started", params: .object([
            "thread": .object(["id": .string("thread-1"), "name": .string("Cockpit work")])
        ])))
        store.reduce(.notification(method: "turn/started", params: .object([
            "threadId": .string("thread-1"),
            "turn": .object(["id": .string("turn-1"), "status": .string("inProgress")])
        ])))
        store.reduce(.notification(method: "item/started", params: .object([
            "threadId": .string("thread-1"), "turnId": .string("turn-1"),
            "item": .object(["id": .string("item-1"), "type": .string("commandExecution"), "status": .string("inProgress")])
        ])))
        store.reduce(.request(id: .integer(7), method: "item/commandExecution/requestApproval", params: .object([
            "threadId": .string("thread-1"), "turnId": .string("turn-1")
        ])))
        return store
    }

    private let snapshotJSON = #"""
    {
      "version":"0.1","revision":42,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",
      "release":{"version":"0.2.0","build":"7"},
      "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":3661000,"since_ms":0,"revision":3},
      "integrations":[{"id":"git","enabled":true,"status":"READY","observed_at":"2026-09-10T00:00:00Z","data":{}}],
      "policies":[
        {"id":"policy-1","status":"ACTIVE","effect":"ALLOW"},
        {"id":"policy-2","status":"FAIL-CLOSED","effect":"CHALLENGE"}
      ],
      "context":{
        "focus":{"value":"deep-work","revision":2},
        "presence":{"value":"available","revision":3}
      },
      "projects":[{"id":"p","name":"Project Zero","path":"/display/path","removed":false}],
      "nodes":[
        {"id":"desk","revoked":false,"capabilities":["display.render"],"last_seen":"2026-09-10T00:00:00Z","status":"ONLINE"},
        {"id":"sensor","revoked":false,"capabilities":[],"status":"OFFLINE"},
        {"id":"old","revoked":true,"capabilities":[],"status":"OFFLINE"}
      ],
      "node_profiles":[],"approvals":[{"id":"approval-1","status":"WAITING_APPROVAL"}],
      "firings":[
        {"id":"firing-1","state":"PENDING"},
        {"id":"firing-2","state":"DELIVERING"},
        {"id":"firing-3","state":"FAILED"},
        {"id":"firing-4","state":"CANCELLED"},
        {"id":"firing-5","state":"REVIEWED"}
      ],
      "invocations":[],"events":[],"audit":[],"truncated":{"approvals":true,"firings":true}
    }
    """#
}
