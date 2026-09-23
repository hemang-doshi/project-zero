import SwiftUI

/// Pure window-size math: clamp to 320–1100 × 240–900.
func desktopClampSize(_ size: CGSize) -> CGSize {
    CGSize(
        width: min(max(size.width, 320), 1100),
        height: min(max(size.height, 240), 900)
    )
}

/// Pure cascade offset: 28 pt steps, wrapping every 8 windows.
func desktopCascadeOffset(for index: Int) -> CGSize {
    let step: CGFloat = 28
    let slot = index % 8
    return CGSize(width: CGFloat(slot) * step, height: CGFloat(slot) * step)
}

/// Pure initial origin: stored origin wins as-is (free movement, including
/// partially off-canvas); when there is no stored origin, cascade by open
/// count so cards never share 0,0.
func desktopInitialOrigin(for openCount: Int, stored: CGPoint?) -> CGPoint {
    guard let stored else {
        let cascade = desktopCascadeOffset(for: openCount)
        return CGPoint(x: cascade.width, y: cascade.height)
    }
    return stored
}

/// Pure launch stagger: distinct cascade origins by index in
/// `desktopApps()` order for routes lacking stored origins.
func desktopLaunchOrigins(count: Int) -> [CGPoint] {
    (0..<count).map {
        let cascade = desktopCascadeOffset(for: $0)
        return CGPoint(x: cascade.width, y: cascade.height)
    }
}
func desktopSanitizeRoutes(_ stored: [String]?) -> [CockpitRoute] {
    guard let stored else { return [] }
    return stored.compactMap { CockpitRoute(rawValue: $0) }
}

/// Pure fallback: after closing a route, selection repoints to the new
/// front window (`zOrder.last`), or `.desk` when nothing remains open.
/// Minimized routes are skipped for the fallback target where supplied.
func desktopFallbackSelection(closed: CockpitRoute, zOrder: [CockpitRoute], minimized: Set<CockpitRoute> = []) -> CockpitRoute {
    zOrder.filter { $0 != closed && !minimized.contains($0) }.last ?? .desk
}

/// Per-window origin + size state, persisted locally in UserDefaults.
struct DesktopWindowGeometry {
    let route: CockpitRoute
    private let defaults: UserDefaults

    static let defaultSize = CGSize(width: 560, height: 480)

    init(route: CockpitRoute, defaults: UserDefaults = .standard) {
        self.route = route
        self.defaults = defaults
    }

    private var originKey: String { "zero.desktop.origin.\(route.rawValue)" }
    private var widthKey: String { "zero.desktop.size.\(route.rawValue).w" }
    private var heightKey: String { "zero.desktop.size.\(route.rawValue).h" }

    var origin: CGPoint {
        get {
            guard let dict = defaults.dictionary(forKey: originKey) else { return .zero }
            let x = (dict["x"] as? Double) ?? 0
            let y = (dict["y"] as? Double) ?? 0
            return CGPoint(x: x, y: y)
        }
        nonmutating set {
            defaults.set(["x": newValue.x, "y": newValue.y], forKey: originKey)
        }
    }

    /// Stored origin, or nil when never persisted (distinct from `.zero`).
    var storedOrigin: CGPoint? {
        defaults.dictionary(forKey: originKey) == nil ? nil : origin
    }

    var size: CGSize {
        get {
            let w = defaults.object(forKey: widthKey) as? Double
            let h = defaults.object(forKey: heightKey) as? Double
            return desktopClampSize(CGSize(
                width: CGFloat(w ?? Self.defaultSize.width),
                height: CGFloat(h ?? Self.defaultSize.height)
            ))
        }
        nonmutating set {
            let clamped = desktopClampSize(newValue)
            defaults.set(Double(clamped.width), forKey: widthKey)
            defaults.set(Double(clamped.height), forKey: heightKey)
        }
    }
}

/// Multi-window open/z-order state for the in-window desktop.
///
/// `openRoutes` persists under `zero.desktop.open` ([String] rawValues);
/// `zOrder` under `zero.desktop.zorder`. Unknown IDs are dropped on load
/// (mirrors `RailOrderState`). Default open = [.desk, .runtime].
@MainActor
final class DesktopWindowManager: ObservableObject {
    private let defaults: UserDefaults
    private static let openKey = "zero.desktop.open"
    private static let zOrderKey = "zero.desktop.zorder"
    private static let minimizedKey = "zero.desktop.minimized"
    private static let defaultOpen: [CockpitRoute] = [.desk, .runtime]

    @Published private(set) var openRoutes: Set<CockpitRoute>
    @Published private(set) var zOrder: [CockpitRoute]
    @Published private(set) var minimized: Set<CockpitRoute>

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let resolvedOpen: Set<CockpitRoute>
        if defaults.object(forKey: Self.openKey) == nil {
            resolvedOpen = Set(Self.defaultOpen)
        } else {
            let sanitized = desktopSanitizeRoutes(defaults.stringArray(forKey: Self.openKey))
            resolvedOpen = sanitized.isEmpty ? Set(Self.defaultOpen) : Set(sanitized)
        }
        self.openRoutes = resolvedOpen
        self.minimized = Set(desktopSanitizeRoutes(defaults.stringArray(forKey: Self.minimizedKey)).filter { resolvedOpen.contains($0) })
        if defaults.object(forKey: Self.zOrderKey) == nil {
            self.zOrder = Array(Self.defaultOpen)
        } else {
            let sanitized = desktopSanitizeRoutes(defaults.stringArray(forKey: Self.zOrderKey))
            let front = sanitized.filter { resolvedOpen.contains($0) }
            let rest = CockpitRoute.allCases.filter { resolvedOpen.contains($0) && !front.contains($0) }
            self.zOrder = front + rest
        }
        // Launch stagger: stored-open routes lacking stored origins get
        // distinct cascade origins by index in desktopApps() order.
        let ordered = CockpitRoute.allCases.filter { resolvedOpen.contains($0) }
        let stagger = desktopLaunchOrigins(count: ordered.count)
        for (index, route) in ordered.enumerated() {
            if defaults.object(forKey: "zero.desktop.origin.\(route.rawValue)") == nil {
                DesktopWindowGeometry(route: route, defaults: defaults).origin = stagger[index]
            }
        }
        // One-time layout repair for origins written before canvas-anchored
        // placement: those builds stored the same near-corner origin for every
        // route, so all windows opened stacked in the top-left.
        migrateStackedOriginsIfNeeded()
    }

    /// Keeps the first route of each origin cluster and moves the rest to free
    /// cascade slots (32 pt inset, 48 pt steps, so every header stays
    /// grabbable). Runs once per layout version; later drags persist.
    private func migrateStackedOriginsIfNeeded() {
        let key = "zero.desktop.layout.version"
        guard (defaults.object(forKey: key) as? Int ?? 0) < 2 else { return }
        defaults.set(2, forKey: key)

        let tolerance: CGFloat = 40
        let spacing: CGFloat = 48
        var occupied: [CGPoint] = []
        var nextSlot = 0

        for route in CockpitRoute.allCases {
            let geometry = DesktopWindowGeometry(route: route, defaults: defaults)
            guard let stored = geometry.storedOrigin else { continue }
            let collides = occupied.contains {
                abs($0.x - stored.x) < tolerance && abs($0.y - stored.y) < tolerance
            }
            guard collides else {
                occupied.append(stored)
                continue
            }
            var candidate = CGPoint(x: 32 + CGFloat(nextSlot) * spacing, y: 32 + CGFloat(nextSlot) * spacing)
            while occupied.contains(where: {
                abs($0.x - candidate.x) < tolerance && abs($0.y - candidate.y) < tolerance
            }) {
                nextSlot += 1
                candidate = CGPoint(x: 32 + CGFloat(nextSlot) * spacing, y: 32 + CGFloat(nextSlot) * spacing)
            }
            geometry.origin = candidate
            occupied.append(candidate)
            nextSlot += 1
        }
    }

    var openCount: Int { openRoutes.count }

    func isOpen(_ route: CockpitRoute) -> Bool { openRoutes.contains(route) }

    func open(_ route: CockpitRoute) {
        var changed = false
        if !openRoutes.contains(route) {
            if !hasStoredOrigin(for: route) {
                setOrigin(desktopInitialOrigin(for: openRoutes.count, stored: nil), for: route)
            }
            openRoutes.insert(route)
            changed = true
        }
        if minimized.contains(route) {
            minimized.remove(route)
            changed = true
        }
        if !zOrder.contains(route) {
            zOrder.append(route)
            changed = true
        } else if zOrder.last != route {
            zOrder.removeAll { $0 == route }
            zOrder.append(route)
            changed = true
        }
        // Skip the publish/persist when nothing moved: focusing an already
        // front window must not re-render every open route.
        if changed { persist() }
    }

    func close(_ route: CockpitRoute) {
        openRoutes.remove(route)
        minimized.remove(route)
        zOrder.removeAll { $0 == route }
        persist()
    }

    func toggle(_ route: CockpitRoute) {
        if openRoutes.contains(route) { close(route) } else { open(route) }
    }

    func bringToFront(_ route: CockpitRoute) {
        guard zOrder.last != route else { return }
        zOrder.removeAll { $0 == route }
        zOrder.append(route)
        persist()
    }

    func isMinimized(_ route: CockpitRoute) -> Bool { minimized.contains(route) }

    func minimize(_ route: CockpitRoute) {
        guard openRoutes.contains(route) else { return }
        minimized.insert(route)
        persist()
    }

    func unminimize(_ route: CockpitRoute) {
        minimized.remove(route)
        if !zOrder.contains(route) { zOrder.append(route) } else { bringToFront(route); return }
        persist()
    }

    func origin(for route: CockpitRoute) -> CGPoint {
        desktopInitialOrigin(for: 0, stored: rawStoredOrigin(for: route))
    }

    /// Raw stored origin (nil when never persisted); `origin(for:)` returns
    /// it as-is so free drag positions survive relaunch. A nil stored
    /// origin resolves to the index-0 cascade, which is `.zero`.
    private func rawStoredOrigin(for route: CockpitRoute) -> CGPoint? {
        guard let dict = defaults.dictionary(forKey: "zero.desktop.origin.\(route.rawValue)") else { return nil }
        let x = (dict["x"] as? Double) ?? 0
        let y = (dict["y"] as? Double) ?? 0
        return CGPoint(x: x, y: y)
    }

    func hasStoredOrigin(for route: CockpitRoute) -> Bool {
        defaults.object(forKey: "zero.desktop.origin.\(route.rawValue)") != nil
    }

    func setOrigin(_ point: CGPoint, for route: CockpitRoute) {
        DesktopWindowGeometry(route: route, defaults: defaults).origin = point
    }

    func size(for route: CockpitRoute) -> CGSize {
        DesktopWindowGeometry(route: route, defaults: defaults).size
    }

    func setSize(_ size: CGSize, for route: CockpitRoute) {
        DesktopWindowGeometry(route: route, defaults: defaults).size = size
    }

    private func persist() {
        defaults.set(openRoutes.map(\.rawValue).sorted(), forKey: Self.openKey)
        defaults.set(zOrder.map(\.rawValue), forKey: Self.zOrderKey)
        defaults.set(minimized.map(\.rawValue).sorted(), forKey: Self.minimizedKey)
    }
}
