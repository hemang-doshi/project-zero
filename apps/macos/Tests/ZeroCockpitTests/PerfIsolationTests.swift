import XCTest
@testable import ZeroCockpit
import ZeroKit

/// Second-wave perf: isolate layout cost and ticking publishers.
///
/// Red-first pins: static chrome is Equatable (unchanged subtrees skip
/// layout), the 1Hz tick publishes only through the narrow clock source (the
/// model itself stays quiet), the SceneKit scene is paused, and the main
/// chronology list stays lazy + capped with overflow disclosure.
final class PerfIsolationTests: XCTestCase {
    // MARK: - Equatable static chrome

    func testZeroStatusBadgeEquatableSkipsUnchangedSubtree() {
        XCTAssertEqual(
            ZeroStatusBadge("LIVE", symbol: "checkmark.circle.fill", tone: .healthy),
            ZeroStatusBadge("LIVE", symbol: "checkmark.circle.fill", tone: .healthy)
        )
        XCTAssertNotEqual(
            ZeroStatusBadge("LIVE", tone: .healthy),
            ZeroStatusBadge("OFFLINE", tone: .error)
        )
    }

    func testDeskMetricCardEquatable() {
        let card = DeskRuntimeMetricCard(label: "L", value: "V", detail: "D", badge: "B", tone: .neutral)
        XCTAssertEqual(card, DeskRuntimeMetricCard(label: "L", value: "V", detail: "D", badge: "B", tone: .neutral))
        XCTAssertNotEqual(card, DeskRuntimeMetricCard(label: "L", value: "CHANGED", detail: "D", badge: "B", tone: .neutral))
    }

    func testDeskSectionHeaderMonoValueEmptyStateEquatable() {
        XCTAssertEqual(DeskRuntimeSectionHeader("T", badge: "B"), DeskRuntimeSectionHeader("T", badge: "B"))
        XCTAssertNotEqual(DeskRuntimeSectionHeader("T"), DeskRuntimeSectionHeader("T", badge: "B"))
        XCTAssertEqual(DeskRuntimeMonoValue("rev 3"), DeskRuntimeMonoValue("rev 3"))
        XCTAssertNotEqual(DeskRuntimeMonoValue("rev 3"), DeskRuntimeMonoValue("rev 4"))
        XCTAssertEqual(
            DeskRuntimeEmptyState(symbol: "s", title: "t", detail: "d"),
            DeskRuntimeEmptyState(symbol: "s", title: "t", detail: "d")
        )
        XCTAssertEqual(
            DeskRuntimeEvidenceRows(rows: [("A", "1")]),
            DeskRuntimeEvidenceRows(rows: [("A", "1")])
        )
        XCTAssertNotEqual(
            DeskRuntimeEvidenceRows(rows: [("A", "1")]),
            DeskRuntimeEvidenceRows(rows: [("A", "2")])
        )
    }

    func testNetworkChromeEquatable() {
        XCTAssertEqual(
            NetworkFlightMetricCard(label: "L", value: "V", detail: "D", badge: "B", tone: .neutral),
            NetworkFlightMetricCard(label: "L", value: "V", detail: "D", badge: "B", tone: .neutral)
        )
        XCTAssertEqual(
            NetworkFlightSectionHeader("T", badge: "B"),
            NetworkFlightSectionHeader("T", badge: "B")
        )
        XCTAssertNotEqual(
            NetworkFlightSectionHeader("T", badge: "B"),
            NetworkFlightSectionHeader("T", badge: "C")
        )
        XCTAssertEqual(
            NetworkFlightEvidenceRows(rows: [("A", "1"), ("B", "2")]),
            NetworkFlightEvidenceRows(rows: [("A", "1"), ("B", "2")])
        )
        XCTAssertEqual(
            NetworkFlightEmptyState(symbol: "s", title: "t", detail: "d"),
            NetworkFlightEmptyState(symbol: "s", title: "t", detail: "d")
        )
    }

    func testTopologySceneViewEquatable() {
        let nodes = [TopologyNode(id: "zero-core", kind: .core, status: "ONLINE")]
        XCTAssertEqual(TopologySceneView(nodes: nodes), TopologySceneView(nodes: nodes))
        XCTAssertNotEqual(
            TopologySceneView(nodes: nodes),
            TopologySceneView(nodes: nodes + [TopologyNode(id: "x", kind: .macbook, status: "ONLINE")])
        )
        XCTAssertEqual(TopologyFallbackList(nodes: nodes), TopologyFallbackList(nodes: nodes))
    }

    func testShellChromeEquatable() {
        XCTAssertEqual(CockpitGlobalHeader(status: "S"), CockpitGlobalHeader(status: "S"))
        XCTAssertNotEqual(CockpitGlobalHeader(status: "A"), CockpitGlobalHeader(status: "B"))
        XCTAssertEqual(CockpitFooter(routeTitle: "Desk"), CockpitFooter(routeTitle: "Desk"))
    }

    // MARK: - Publisher scoping

    /// The 1Hz tick must not publish the model: a model subscriber sees zero
    /// events when the clock source fires, while a clock-source subscriber
    /// sees exactly one. This is what stops whole-window re-layout per tick.
    @MainActor
    func testClockTickDoesNotPublishModel() {
        let model = CockpitModel.preview()
        var modelEvents = 0
        var clockEvents = 0
        let modelSub = model.objectWillChange.sink { _ in modelEvents += 1 }
        let clockSub = model.clockSource.objectWillChange.sink { _ in clockEvents += 1 }
        _ = (modelSub, clockSub)
        model.clockSource.now = Date().addingTimeInterval(1)
        XCTAssertEqual(modelEvents, 0, "tick must not invalidate model subscribers")
        XCTAssertEqual(clockEvents, 1, "tick must reach narrow clock subscribers")
    }

    @MainActor
    func testFocusElapsedLabelAtMatchesClock() {
        let model = CockpitModel.preview()
        XCTAssertEqual(model.focusElapsedLabel, model.focusElapsedLabel(at: model.clock))
    }

    // MARK: - SceneKit stillness

    func testTopologySceneIsPaused() {
        let scene = TopologySceneBuilder.scene(nodes: [
            TopologyNode(id: "zero-core", kind: .core, status: "ONLINE")
        ])
        XCTAssertTrue(scene.isPaused, "static topology must not drive per-frame SceneKit work")
    }

    // MARK: - FlightRecorder main list laziness bound

    func testChronologyRenderCapWithOverflow() {
        XCTAssertEqual(FlightChronology.maxRenderedRows, 100)
        let rows = (0..<250).map { "row-\($0)" }
        let rendered = Array(rows.prefix(FlightChronology.maxRenderedRows))
        XCTAssertEqual(rendered.count, 100)
        XCTAssertEqual(rows.count - rendered.count, 150, "remainder collapses into overflow disclosure")
    }
}
