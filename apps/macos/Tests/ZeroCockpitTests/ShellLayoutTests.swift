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

    // MARK: - Desktop window manager

    func testDesktopManagerDefaultsOpenDeskAndRuntime() {
        let defaults = trackSuite("ShellLayoutTests.desktopDefaults")
        let manager = DesktopWindowManager(defaults: defaults)
        XCTAssertEqual(manager.openRoutes, [.desk, .runtime])
    }

    func testDesktopManagerOpenCloseToggle() {
        let defaults = trackSuite("ShellLayoutTests.desktopOpen")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        XCTAssertTrue(manager.openRoutes.contains(.network))
        manager.close(.network)
        XCTAssertFalse(manager.openRoutes.contains(.network))
        manager.toggle(.airlock)
        XCTAssertTrue(manager.openRoutes.contains(.airlock))
        manager.toggle(.airlock)
        XCTAssertFalse(manager.openRoutes.contains(.airlock))
    }

    func testDesktopManagerBringToFront() {
        let defaults = trackSuite("ShellLayoutTests.desktopFront")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.bringToFront(.desk)
        XCTAssertEqual(manager.zOrder.last, .desk)
        manager.bringToFront(.network)
        XCTAssertEqual(manager.zOrder.last, .network)
    }

    func testDesktopManagerSanitizesUnknownIDs() {
        let defaults = trackSuite("ShellLayoutTests.desktopSanitize")
        defaults.set(["desk", "bogus-route", "runtime"], forKey: "zero.desktop.open")
        defaults.set(["bogus-route", "desk"], forKey: "zero.desktop.zorder")
        let manager = DesktopWindowManager(defaults: defaults)
        XCTAssertFalse(manager.openRoutes.contains(where: { $0.rawValue == "bogus-route" }))
        XCTAssertTrue(manager.openRoutes.contains(.desk))
        XCTAssertFalse(manager.zOrder.contains(where: { $0.rawValue == "bogus-route" }))
    }

    func testDesktopManagerOriginClampsNegative() {
        let defaults = trackSuite("ShellLayoutTests.desktopOrigin")
        defaults.set(["x": -40.0, "y": -5.0], forKey: "zero.desktop.origin.desk")
        let manager = DesktopWindowManager(defaults: defaults)
        let origin = manager.origin(for: .desk)
        XCTAssertGreaterThanOrEqual(origin.x, 0)
        XCTAssertGreaterThanOrEqual(origin.y, 0)
    }
}
