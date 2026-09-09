import XCTest
@testable import ZeroCockpit

final class ThemeStateTests: XCTestCase {
    func testDeliveryStatesRemainDistinctAndDoNotImplyRendering() {
        XCTAssertEqual(DeliveryState.offline.presentation.label, "Offline")
        XCTAssertEqual(DeliveryState.awaitingDelivery.presentation.label, "Awaiting delivery")
        XCTAssertEqual(DeliveryState.delivered.presentation.label, "Delivered")
        XCTAssertNotEqual(DeliveryState.delivered.presentation.detail, DeliveryState.rendered.presentation.detail)
        XCTAssertEqual(Set(DeliveryState.allCases.map { $0.presentation.label }).count, 7)
    }

    func testNavigationOrderAndSelectionPreserveInspectedProject() {
        XCTAssertEqual(CockpitRoute.allCases.map(\.title), ["Desk", "Runtime", "Network", "Flight Recorder", "Airlock", "Zero Bot"])
        var selection = CockpitSelection(projectID: "project-zero")
        selection.route = .airlock
        XCTAssertEqual(selection.projectID, "project-zero")
        XCTAssertEqual(selection.route, .airlock)
    }

    func testReducedMotionNeverMovesControls() {
        XCTAssertEqual(ZeroControlMotion.pressScale(reduceMotion: true, isPressed: true), 1)
        XCTAssertEqual(ZeroControlMotion.pressScale(reduceMotion: false, isPressed: false), 1)
        XCTAssertLessThan(ZeroControlMotion.pressScale(reduceMotion: false, isPressed: true), 1)
    }
}
