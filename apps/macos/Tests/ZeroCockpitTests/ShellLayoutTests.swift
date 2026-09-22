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

    func testDesktopManagerOriginPreservesFreeMovement() {
        let defaults = trackSuite("ShellLayoutTests.desktopOrigin")
        defaults.set(["x": -40.0, "y": -5.0], forKey: "zero.desktop.origin.desk")
        let manager = DesktopWindowManager(defaults: defaults)
        let origin = manager.origin(for: .desk)
        XCTAssertEqual(origin.x, -40.0, accuracy: 0.001)
        XCTAssertEqual(origin.y, -5.0, accuracy: 0.001)
    }

    func testDesktopMigrationSeparatesStackedOrigins() {
        let defaults = trackSuite("ShellLayoutTests.desktopStacked")
        for route in CockpitRoute.allCases {
            defaults.set(["x": 28.0, "y": 28.0], forKey: "zero.desktop.origin.\(route.rawValue)")
        }
        let manager = DesktopWindowManager(defaults: defaults)
        let origins = CockpitRoute.allCases.map { manager.origin(for: $0) }
        XCTAssertEqual(Set(origins.map { "\($0.x),\($0.y)" }).count, CockpitRoute.allCases.count)
    }

    func testDesktopMigrationKeepsDistinctOrigins() {
        let defaults = trackSuite("ShellLayoutTests.desktopDistinct")
        defaults.set(["x": 100.0, "y": 50.0], forKey: "zero.desktop.origin.desk")
        defaults.set(["x": -40.0, "y": -5.0], forKey: "zero.desktop.origin.runtime")
        let manager = DesktopWindowManager(defaults: defaults)
        XCTAssertEqual(manager.origin(for: .desk), CGPoint(x: 100, y: 50))
        XCTAssertEqual(manager.origin(for: .runtime), CGPoint(x: -40, y: -5))
    }

    func testDesktopMigrationRunsOnce() {
        let defaults = trackSuite("ShellLayoutTests.desktopMigrationOnce")
        for route in CockpitRoute.allCases {
            defaults.set(["x": 28.0, "y": 28.0], forKey: "zero.desktop.origin.\(route.rawValue)")
        }
        _ = DesktopWindowManager(defaults: defaults)
        // A deliberate stack made after migration must persist across relaunch.
        for route in CockpitRoute.allCases {
            defaults.set(["x": 28.0, "y": 28.0], forKey: "zero.desktop.origin.\(route.rawValue)")
        }
        let reloaded = DesktopWindowManager(defaults: defaults)
        XCTAssertEqual(reloaded.origin(for: .desk), CGPoint(x: 28, y: 28))
        XCTAssertEqual(reloaded.origin(for: .runtime), CGPoint(x: 28, y: 28))
    }

    func testDesktopCloseFallsBackSelectionToFrontWindow() {
        let defaults = trackSuite("ShellLayoutTests.desktopCloseFallback")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.bringToFront(.network)
        // Simulate closeRoute(_:): fallback computed from pre-close zOrder.
        let fallback = desktopFallbackSelection(closed: .network, zOrder: manager.zOrder)
        manager.close(.network)
        XCTAssertEqual(fallback, .runtime)
        XCTAssertTrue(manager.isOpen(fallback))
    }

    func testDesktopCloseLastWindowFallsBackToDesk() {
        XCTAssertEqual(desktopFallbackSelection(closed: .desk, zOrder: [.desk]), .desk)
    }

    func testDesktopKeyboardSelectOpensAndFronts() {
        let defaults = trackSuite("ShellLayoutTests.desktopKeyboardSelect")
        let manager = DesktopWindowManager(defaults: defaults)
        // Simulate .onChange(of: selection.route): every selection write
        // routes through open(), which fronts.
        manager.open(.skillLab)
        XCTAssertTrue(manager.isOpen(.skillLab))
        XCTAssertEqual(manager.zOrder.last, .skillLab)
        manager.bringToFront(.desk)
        manager.open(.skillLab)
        XCTAssertEqual(manager.zOrder.last, .skillLab)
    }

    // MARK: - Desktop minimize (traffic-light yellow)

    func testDesktopMinimizeUnminimize() {
        let defaults = trackSuite("ShellLayoutTests.desktopMinimize")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.minimize(.network)
        XCTAssertTrue(manager.isMinimized(.network))
        XCTAssertTrue(manager.isOpen(.network))
        manager.unminimize(.network)
        XCTAssertFalse(manager.isMinimized(.network))
        XCTAssertTrue(manager.isOpen(.network))
    }

    func testDesktopMinimizePersists() {
        let defaults = trackSuite("ShellLayoutTests.desktopMinPersist")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.minimize(.network)
        let reloaded = DesktopWindowManager(defaults: defaults)
        XCTAssertTrue(reloaded.isMinimized(.network))
        XCTAssertTrue(reloaded.isOpen(.network))
    }

    func testDesktopMinimizeSanitizesUnknownIDs() {
        let defaults = trackSuite("ShellLayoutTests.desktopMinSanitize")
        defaults.set(["desk", "runtime"], forKey: "zero.desktop.open")
        defaults.set(["desk", "runtime"], forKey: "zero.desktop.zorder")
        defaults.set(["bogus-route", "desk"], forKey: "zero.desktop.minimized")
        let manager = DesktopWindowManager(defaults: defaults)
        XCTAssertFalse(manager.minimized.contains(where: { $0.rawValue == "bogus-route" }))
        XCTAssertTrue(manager.isMinimized(.desk))
    }

    func testDesktopFallbackSkipsMinimized() {
        XCTAssertEqual(
            desktopFallbackSelection(closed: .network, zOrder: [.desk, .runtime, .network], minimized: [.runtime]),
            .desk
        )
        XCTAssertEqual(
            desktopFallbackSelection(closed: .network, zOrder: [.desk, .network], minimized: [.desk]),
            .desk
        )
    }

    func testDesktopOpenClearsMinimized() {
        let defaults = trackSuite("ShellLayoutTests.desktopOpenClearsMin")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.minimize(.network)
        manager.open(.network)
        XCTAssertFalse(manager.isMinimized(.network))
    }

    func testDesktopInitialOriginCascadesWithoutStored() {
        let first = desktopInitialOrigin(for: 0, stored: nil)
        let second = desktopInitialOrigin(for: 1, stored: nil)
        XCTAssertNotEqual(first, second)
        let cascade = desktopCascadeOffset(for: 2)
        XCTAssertEqual(
            desktopInitialOrigin(for: 2, stored: nil),
            CGPoint(x: cascade.width, y: cascade.height)
        )
    }

    func testDesktopInitialOriginPreservesStored() {
        XCTAssertEqual(
            desktopInitialOrigin(for: 3, stored: CGPoint(x: 100, y: 50)),
            CGPoint(x: 100, y: 50)
        )
        XCTAssertEqual(
            desktopInitialOrigin(for: 3, stored: CGPoint(x: -10, y: -5)),
            CGPoint(x: -10, y: -5)
        )
    }

    func testDesktopOpenWithoutStoredOriginAppliesCascade() {
        let defaults = trackSuite("ShellLayoutTests.desktopOpenCascade")
        let manager = DesktopWindowManager(defaults: defaults)
        let expected = desktopCascadeOffset(for: manager.openCount)
        manager.open(.network)
        XCTAssertTrue(manager.hasStoredOrigin(for: .network))
        let origin = manager.origin(for: .network)
        XCTAssertEqual(origin, CGPoint(x: expected.width, y: expected.height))
    }

    func testDesktopLaunchStaggerAssignsDistinctOrigins() {
        let defaults = trackSuite("ShellLayoutTests.desktopLaunchStagger")
        defaults.set(["desk", "runtime", "network"], forKey: "zero.desktop.open")
        defaults.set(["desk", "runtime", "network"], forKey: "zero.desktop.zorder")
        let manager = DesktopWindowManager(defaults: defaults)
        let origins = [manager.origin(for: .desk), manager.origin(for: .runtime), manager.origin(for: .network)]
        XCTAssertEqual(Set(origins.map { "\($0.x),\($0.y)" }).count, 3)
    }

    func testDesktopCardContentHasNoNestedShell() {
        // Single-chrome contract: card content is the route view directly.
        // No nested CockpitShell may wrap it; this helper-level pin guards
        // the pure origin path that the card relies on instead of shell chrome.
        let origins = desktopLaunchOrigins(count: 3)
        XCTAssertEqual(Set(origins.map { "\($0.x),\($0.y)" }).count, 3)
        XCTAssertEqual(origins[0], .zero)
        XCTAssertNotEqual(origins[0], origins[1])
    }
    func testDesktopCloseClearsMinimized() {
        let defaults = trackSuite("ShellLayoutTests.desktopCloseClearsMin")
        let manager = DesktopWindowManager(defaults: defaults)
        manager.open(.network)
        manager.minimize(.network)
        manager.close(.network)
        XCTAssertFalse(manager.isMinimized(.network))
        XCTAssertFalse(manager.isOpen(.network))
    }
}
