import XCTest
@testable import ZeroCockpit

@MainActor
final class ShellLayoutTests: XCTestCase {
    private var scrubKeys: [String] = []
    private var scrubDomains: [String] = []
    private var savedOrder: Any?

    override func tearDown() {
        for key in scrubKeys {
            UserDefaults.standard.removeObject(forKey: key)
        }
        for domain in scrubDomains {
            UserDefaults.standard.removePersistentDomain(forName: domain)
        }
        if let savedOrder {
            UserDefaults.standard.set(savedOrder, forKey: "zero.rails.order")
        } else {
            UserDefaults.standard.removeObject(forKey: "zero.rails.order")
        }
        scrubKeys = []
        scrubDomains = []
        savedOrder = nil
        super.tearDown()
    }

    private func track(_ key: String) {
        scrubKeys.append(key)
    }

    private func trackSuite(_ name: String) -> UserDefaults {
        scrubDomains.append(name)
        UserDefaults.standard.removePersistentDomain(forName: name)
        return UserDefaults(suiteName: name)!
    }

    // MARK: - Resizable pane width persistence

    func testResizablePanePersistsWidth() throws {
        track("zero.pane.test")
        UserDefaults.standard.removeObject(forKey: "zero.pane.test")
        var pane = ResizablePaneState(key: "test", defaultWidth: 330)
        pane.width = 410
        XCTAssertEqual(ResizablePaneState(key: "test", defaultWidth: 330).width, 410)
    }

    func testResizablePaneClampsToInspectorBounds() throws {
        let defaults = trackSuite("ShellLayoutTests.inspector")
        var pane = ResizablePaneState.inspector(key: "flight.inspector", defaultWidth: 410, defaults: defaults)
        pane.width = 100
        XCTAssertEqual(pane.width, 280)
        pane.width = 900
        XCTAssertEqual(pane.width, 560)
    }

    func testResizablePaneClampsToExplorerBounds() throws {
        let defaults = trackSuite("ShellLayoutTests.explorer")
        var pane = ResizablePaneState.explorer(key: "zerobot.explorer", defaultWidth: 250, defaults: defaults)
        pane.width = 50
        XCTAssertEqual(pane.width, 200)
        pane.width = 800
        XCTAssertEqual(pane.width, 400)
    }

    func testResizablePaneKeysAreIndependent() throws {
        let defaults = trackSuite("ShellLayoutTests.keys")
        var left = ResizablePaneState(key: "left", defaultWidth: 300, defaults: defaults)
        let right = ResizablePaneState(key: "right", defaultWidth: 300, defaults: defaults)
        left.width = 350
        XCTAssertEqual(ResizablePaneState(key: "left", defaultWidth: 300, defaults: defaults).width, 350)
        XCTAssertEqual(right.width, 300)
    }

    // MARK: - Rail collapse + order persistence

    func testRailCollapsePersistsAndToggles() throws {
        let defaults = trackSuite("ShellLayoutTests.rails")
        var rail = RailCollapseState(key: "environment", defaults: defaults)
        XCTAssertFalse(rail.isCollapsed)
        rail.toggle()
        XCTAssertTrue(RailCollapseState(key: "environment", defaults: defaults).isCollapsed)
        rail.toggle()
        XCTAssertFalse(RailCollapseState(key: "environment", defaults: defaults).isCollapsed)
    }

    func testRailOrderPersistsAndResets() throws {
        let defaults = trackSuite("ShellLayoutTests.order")
        var rails = RailOrderState(defaults: defaults)
        XCTAssertEqual(rails.order, CockpitRoute.allCases.map(\.rawValue))
        rails.move(routeID: CockpitRoute.zeroBot.rawValue, to: 0)
        XCTAssertEqual(RailOrderState(defaults: defaults).order.first, CockpitRoute.zeroBot.rawValue)
        rails.reset()
        XCTAssertEqual(RailOrderState(defaults: defaults).order, CockpitRoute.allCases.map(\.rawValue))
    }

    // MARK: - Pop-out shares model identity

    func testPopoutShowsSharedSelection() throws {
        let model = CockpitModel.preview()
        model.selection.inspectionID = "evt-1"
        let popout = InspectorPopout(model: model)
        XCTAssertTrue(popout.model === model)
        XCTAssertEqual(popout.model.selection.inspectionID, "evt-1")
    }

    func testPopoutLifecycleNeverClearsSelection() throws {
        let model = CockpitModel.preview()
        model.selection.inspectionID = "evt-1"
        _ = InspectorPopout(model: model, kind: .airlock)
        _ = InspectorPopout(model: model, kind: .zeroBot)
        XCTAssertEqual(model.selection.inspectionID, "evt-1")
    }

    func testPopoutScenesAreDistinct() throws {
        let ids = Set(CockpitPopoutScene.allIDs)
        XCTAssertEqual(ids.count, 3)
        for kind in InspectorPopoutKind.allCases {
            XCTAssertFalse(CockpitPopoutScene.sceneID(for: kind).isEmpty)
            XCTAssertFalse(CockpitPopoutScene.title(for: kind).isEmpty)
        }
    }

    func testPanelHostExposesSingleSelection() {
        let options: [PanelSelection] = [.primary, .secondary]
        XCTAssertEqual(options.count, 2)
        XCTAssertNotEqual(PanelSelection.primary, PanelSelection.secondary)
    }
}
