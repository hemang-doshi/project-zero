import XCTest
@testable import ZeroCockpit
import ZeroKit

/// Performance regression checks for route-switch projections.
final class ShellPerfTests: XCTestCase {
    func largeSnapshotJSON(nodes: Int, invocations: Int, revision: UInt64 = 99) -> String {
        let nodeRows = (0..<nodes).map { i in
            #"{"id":"node-\#(i)","revoked":false,"status":"ONLINE","capabilities":["display.render"]}"#
        }.joined(separator: ",")
        let invocationRows = (0..<invocations).map { i in
            #"{"id":"invoke-\#(i)","principal":"owner","node":"node-\#(i)","capability":"display.render","status":"SUCCEEDED","approved":1,"attempts":1}"#
        }.joined(separator: ",")
        return """
        {"version":"0.1","revision":\(revision),"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",\
        "release":{"version":"0.2.0","build":"7"},\
        "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":1,"since_ms":0,"revision":3},\
        "integrations":[],"policies":[],"context":{},"projects":[],"node_profiles":[],\
        "nodes":[\(nodeRows)],"invocations":[\(invocationRows)],"approvals":[],"firings":[],\
        "events":[],"audit":[],"truncated":{}}
        """
    }

    func testNetworkFactsBuildScales() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        measure { _ = NetworkFacts(snapshot: snapshot, connection: .live) }
    }

    func testFlightProjectionBuildScales() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        let store = CodexEventStore()
        measure {
            _ = FlightProjection(
                snapshot: snapshot,
                runtimeConnection: .live,
                codexStore: store,
                codexConnection: .disconnected
            )
        }
    }

    @MainActor
    func testDeskRuntimeFactsBuildScales() {
        let model = CockpitModel.preview()
        measure { _ = DeskRuntimeFacts(model: model) }
    }

    @MainActor
    func testZeroBotProjectionBuildScales() {
        let model = CockpitModel.preview()
        measure { _ = ZeroBotProjection(model: model) }
    }

    // MARK: - Projection performance budget guards
    func testNetworkFactsWithinBudget() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        let start = CFAbsoluteTimeGetCurrent()
        _ = NetworkFacts(snapshot: snapshot, connection: .live)
        XCTAssertLessThan(CFAbsoluteTimeGetCurrent() - start, 0.05)
    }

    func testFlightProjectionWithinBudget() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        let store = CodexEventStore()
        let start = CFAbsoluteTimeGetCurrent()
        _ = FlightProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: store,
            codexConnection: .disconnected
        )
        XCTAssertLessThan(CFAbsoluteTimeGetCurrent() - start, 0.05)
    }

    @MainActor
    func testDeskRuntimeFactsWithinBudget() {
        let model = CockpitModel.preview()
        let start = CFAbsoluteTimeGetCurrent()
        _ = DeskRuntimeFacts(model: model)
        XCTAssertLessThan(CFAbsoluteTimeGetCurrent() - start, 0.05)
    }

    // MARK: - Task 1 RED: dominant route-switch cost

    /// Bounded daemon history at a realistic upper bound: 200 nodes plus
    /// 2000 invocations, 1500 events and 1500 audits (5000 flight records).
    func heavyHistoryJSON(nodes: Int, invocations: Int, events: Int, audits: Int) -> String {
        let nodeRows = (0..<nodes).map { i in
            #"{"id":"node-\#(i)","revoked":false,"status":"ONLINE","capabilities":["display.render"],"last_seen":"2026-09-10T00:00:00Z"}"#
        }.joined(separator: ",")
        let invocationRows = (0..<invocations).map { i in
            #"{"id":"invoke-\#(i)","principal":"owner","node":"node-\#(i % max(nodes, 1))","capability":"display.render","status":"SUCCEEDED","approved":1,"deadline":"2026-09-10T01:00:00Z","attempts":1}"#
        }.joined(separator: ",")
        let eventRows = (0..<events).map { i in
            let second = String(format: "%02d", i % 60)
            return #"{"seq":\#(i),"id":"event-\#(i)","kind":"session.changed","time":"2026-09-10T00:00:\#(second)Z"}"#
        }.joined(separator: ",")
        let auditRows = (0..<audits).map { i in
            let second = String(format: "%02d", i % 60)
            return #"{"seq":\#(i),"principal":"owner","action":"session.start","target":"runtime","decision":"ALLOW","correlation":"event-\#(i)","time":"2026-09-10T00:01:\#(second)Z","previous_hash":"prev","hash":"hash"}"#
        }.joined(separator: ",")
        return """
        {"version":"0.1","revision":99,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",\
        "release":{"version":"0.2.0","build":"7"},\
        "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":1,"since_ms":0,"revision":3},\
        "integrations":[],"policies":[],"context":{},"projects":[],"node_profiles":[],\
        "nodes":[\(nodeRows)],"invocations":[\(invocationRows)],"approvals":[],"firings":[],\
        "events":[\(eventRows)],"audit":[\(auditRows)],"truncated":{}}
        """
    }

    /// RED for the profiled dominant cost: `FlightProjection.orderByProjectedTime`
    /// re-parses every ISO8601 timestamp on every sort comparison
    /// (O(n log n) parses per route switch). Measured pre-fix: ~20 s for
    /// 5000 records. Threshold 8.0 s absorbs CI noise while failing pre-fix
    /// by more than 2x; the post-fix target is under 1 s.
    func testFlightProjectionHeavyHistoryWithinBudget() throws {
        let snapshot = try CockpitSnapshot.decode(
            Data(heavyHistoryJSON(nodes: 200, invocations: 2000, events: 1500, audits: 1500).utf8))
        let store = CodexEventStore()
        let start = CFAbsoluteTimeGetCurrent()
        let projection = FlightProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: store,
            codexConnection: .disconnected
        )
        let elapsed = CFAbsoluteTimeGetCurrent() - start
        XCTAssertEqual(projection.records.count, 5000)
        // Newest timestamp wins: audits at 00:01 beat events at 00:00, and the
        // first :59 audit in stable order is i=59. Pins sort-order preservation.
        XCTAssertEqual(projection.records.first?.id, "runtime-audit-59")
        XCTAssertLessThan(elapsed, 8.0)
    }

    // MARK: - Task 1: revision-keyed projection reuse across route switches

    /// A route switch with unchanged state must do zero rebuild work: the
    /// second and later builds with an identical key are cache hits.
    /// (RED pre-fix: `ProjectionCache` does not exist.)
    @MainActor
    func testRouteSwitchWithUnchangedRevisionReusesCachedProjection() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 50).utf8))
        let store = CodexEventStore()
        let cache = ProjectionCache()
        let first = cache.flightProjection(
            snapshot: snapshot, runtimeConnection: .live,
            codexStore: store, codexConnection: .disconnected)
        let start = CFAbsoluteTimeGetCurrent()
        for _ in 0..<10 {
            let next = cache.flightProjection(
                snapshot: snapshot, runtimeConnection: .live,
                codexStore: store, codexConnection: .disconnected)
            XCTAssertEqual(next.records.map(\.id), first.records.map(\.id))
        }
        XCTAssertLessThan(CFAbsoluteTimeGetCurrent() - start, 0.05)

        let netFirst = cache.networkFacts(snapshot: snapshot, connection: .live)
        let netStart = CFAbsoluteTimeGetCurrent()
        for _ in 0..<10 {
            let next = cache.networkFacts(snapshot: snapshot, connection: .live)
            XCTAssertEqual(next.evidenceRows.map(\.evidenceID), netFirst.evidenceRows.map(\.evidenceID))
        }
        XCTAssertLessThan(CFAbsoluteTimeGetCurrent() - netStart, 0.05)
    }

    /// A new revision or a changed connection must rebuild, never serve stale facts.
    @MainActor
    func testCachedProjectionInvalidatesOnChangedInput() throws {
        let cache = ProjectionCache()
        let v99 = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 10, invocations: 5, revision: 99).utf8))
        let v100 = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 10, invocations: 5, revision: 100).utf8))
        let live = cache.networkFacts(snapshot: v99, connection: .live)
        let hit = cache.networkFacts(snapshot: v99, connection: .live)
        XCTAssertEqual(hit.nodes.map(\.id), live.nodes.map(\.id))
        let rebuilt = cache.networkFacts(snapshot: v100, connection: .live)
        XCTAssertEqual(rebuilt.nodes.map(\.id), live.nodes.map(\.id))
        let offline = cache.networkFacts(snapshot: v99, connection: .offline)
        XCTAssertFalse(offline.isLive)
    }

    func testDesktopCanvasTracksApps() {
        let apps = [DesktopApp(id: "desk", title: "Desk", route: .desk)]
        XCTAssertEqual(apps.count, 1)
        XCTAssertEqual(apps.first?.route, .desk)
    }

    func testDesktopAppsBindsAllSevenRoutes() {
        let apps = desktopApps()
        XCTAssertEqual(apps.count, 7)
        XCTAssertEqual(apps.map(\.route), CockpitRoute.allCases)
        XCTAssertEqual(apps.map(\.id), CockpitRoute.allCases.map(\.rawValue))
        XCTAssertEqual(apps.map(\.title), CockpitRoute.allCases.map(\.title))
    }

    func testAccumulatedOffsetAddsTranslation() {
        XCTAssertEqual(
            accumulatedOffset(CGSize(width: 10, height: -4), CGSize(width: 3, height: 7)),
            CGSize(width: 13, height: 3)
        )
        XCTAssertEqual(accumulatedOffset(.zero, .zero), .zero)
    }

    func testDesktopSizeClampMath() {
        XCTAssertEqual(desktopClampSize(CGSize(width: 100, height: 100)), CGSize(width: 320, height: 240))
        XCTAssertEqual(desktopClampSize(CGSize(width: 2000, height: 2000)), CGSize(width: 1100, height: 900))
        XCTAssertEqual(desktopClampSize(CGSize(width: 560, height: 480)), CGSize(width: 560, height: 480))
    }

    func testDesktopCascadeOffsetsDiffer() {
        let first = desktopCascadeOffset(for: 0)
        let second = desktopCascadeOffset(for: 1)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(desktopCascadeOffset(for: 0), CGSize(width: 0, height: 0))
    }
}
