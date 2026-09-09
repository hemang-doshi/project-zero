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
    }

    private let snapshotJSON = #"""
    {
      "version":"0.1","revision":42,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",
      "release":{"version":"0.2.0","build":"7"},
      "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":3661000,"since_ms":0,"revision":3},
      "integrations":[{"id":"git","enabled":true,"status":"READY","observed_at":"2026-09-10T00:00:00Z","data":{}}],
      "policies":[],"context":{},
      "projects":[{"id":"p","name":"Project Zero","path":"/display/path","removed":false}],
      "nodes":[
        {"id":"desk","revoked":false,"capabilities":["display.render"],"last_seen":"2026-09-10T00:00:00Z","status":"ONLINE"},
        {"id":"sensor","revoked":false,"capabilities":[],"status":"OFFLINE"},
        {"id":"old","revoked":true,"capabilities":[],"status":"OFFLINE"}
      ],
      "node_profiles":[],"approvals":[],"firings":[],"invocations":[],"events":[],"audit":[],"truncated":{}
    }
    """#
}
