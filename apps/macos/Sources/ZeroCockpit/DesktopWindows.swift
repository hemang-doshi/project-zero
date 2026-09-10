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

/// Pure sanitize: keep known route IDs, drop unknowns.
func desktopSanitizeRoutes(_ stored: [String]?) -> [CockpitRoute] {
    guard let stored else { return [] }
    return stored.compactMap { CockpitRoute(rawValue: $0) }
}

/// Pure fallback: after closing a route, selection repoints to the new
/// front window (`zOrder.last`), or `.desk` when nothing remains open.
func desktopFallbackSelection(closed: CockpitRoute, zOrder: [CockpitRoute]) -> CockpitRoute {
    zOrder.filter { $0 != closed }.last ?? .desk
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
            let x = max((dict["x"] as? Double) ?? 0, 0)
            let y = max((dict["y"] as? Double) ?? 0, 0)
            return CGPoint(x: x, y: y)
        }
        nonmutating set {
            defaults.set(["x": max(newValue.x, 0), "y": max(newValue.y, 0)], forKey: originKey)
        }
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
    private static let defaultOpen: [CockpitRoute] = [.desk, .runtime]

    @Published private(set) var openRoutes: Set<CockpitRoute>
    @Published private(set) var zOrder: [CockpitRoute]

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
        if defaults.object(forKey: Self.zOrderKey) == nil {
            self.zOrder = Array(Self.defaultOpen)
        } else {
            let sanitized = desktopSanitizeRoutes(defaults.stringArray(forKey: Self.zOrderKey))
            let front = sanitized.filter { resolvedOpen.contains($0) }
            let rest = CockpitRoute.allCases.filter { resolvedOpen.contains($0) && !front.contains($0) }
            self.zOrder = front + rest
        }
    }

    var openCount: Int { openRoutes.count }

    func isOpen(_ route: CockpitRoute) -> Bool { openRoutes.contains(route) }

    func open(_ route: CockpitRoute) {
        openRoutes.insert(route)
        if !zOrder.contains(route) { zOrder.append(route) } else { bringToFront(route) }
        persist()
    }

    func close(_ route: CockpitRoute) {
        openRoutes.remove(route)
        zOrder.removeAll { $0 == route }
        persist()
    }

    func toggle(_ route: CockpitRoute) {
        if openRoutes.contains(route) { close(route) } else { open(route) }
    }

    func bringToFront(_ route: CockpitRoute) {
        zOrder.removeAll { $0 == route }
        zOrder.append(route)
        persist()
    }

    func origin(for route: CockpitRoute) -> CGPoint {
        DesktopWindowGeometry(route: route, defaults: defaults).origin
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
    }
}
