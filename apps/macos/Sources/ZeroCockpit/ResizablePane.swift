import AppKit
import SwiftUI

/// Persistent width state for one resizable inspector/explorer column.
///
/// Widths persist in `UserDefaults` under `zero.pane.<key>` (brief:
/// `zero.pane.<route>.<pane>`) and restore on launch. Every read and write
/// is clamped to the pane's bounds: inspectors 280–560, explorers 200–400.
struct ResizablePaneState {
    /// Inspector columns (Airlock 390, Flight Recorder 410, Zero Bot 330).
    static let inspectorMinWidth: CGFloat = 280
    static let inspectorMaxWidth: CGFloat = 560
    /// Explorer columns (Zero Bot 250).
    static let explorerMinWidth: CGFloat = 200
    static let explorerMaxWidth: CGFloat = 400

    let key: String
    let defaultWidth: CGFloat
    let minWidth: CGFloat
    let maxWidth: CGFloat
    private let defaults: UserDefaults

    init(
        key: String,
        defaultWidth: CGFloat,
        minWidth: CGFloat = inspectorMinWidth,
        maxWidth: CGFloat = inspectorMaxWidth,
        defaults: UserDefaults = .standard
    ) {
        self.key = key
        self.defaultWidth = defaultWidth
        self.minWidth = minWidth
        self.maxWidth = maxWidth
        self.defaults = defaults
    }

    static func inspector(key: String, defaultWidth: CGFloat, defaults: UserDefaults = .standard) -> Self {
        Self(key: key, defaultWidth: defaultWidth,
             minWidth: inspectorMinWidth, maxWidth: inspectorMaxWidth, defaults: defaults)
    }

    static func explorer(key: String, defaultWidth: CGFloat, defaults: UserDefaults = .standard) -> Self {
        Self(key: key, defaultWidth: defaultWidth,
             minWidth: explorerMinWidth, maxWidth: explorerMaxWidth, defaults: defaults)
    }

    private var defaultsKey: String { "zero.pane.\(key)" }

    var width: CGFloat {
        nonmutating get {
            let stored = defaults.object(forKey: defaultsKey) as? Double
            return clamp(stored.map { CGFloat($0) } ?? defaultWidth)
        }
        nonmutating set { defaults.set(Double(clamp(newValue)), forKey: defaultsKey) }
    }

    private func clamp(_ value: CGFloat) -> CGFloat {
        min(max(value, minWidth), maxWidth)
    }
}

/// Persistent collapsed flag for one environment rail.
///
/// The shell keeps its existing collapse breakpoint; this flag is the
/// explicit toggle the shell binds. Persisted under
/// `zero.rails.collapsed.<key>`. Shell wiring stays in the owning lane
/// (`CockpitShell.swift`); this type is the persistence contract plus tests.
struct RailCollapseState {
    let key: String
    private let defaults: UserDefaults

    init(key: String = "environment", defaults: UserDefaults = .standard) {
        self.key = key
        self.defaults = defaults
    }

    private var defaultsKey: String { "zero.rails.collapsed.\(key)" }

    var isCollapsed: Bool {
        nonmutating get { defaults.object(forKey: defaultsKey) as? Bool ?? false }
        nonmutating set { defaults.set(newValue, forKey: defaultsKey) }
    }

    func toggle() { isCollapsed = !isCollapsed }
}

/// Persistent environment-rail order (route IDs, front = top of rail).
///
/// Persisted under `zero.rails.order`. Unknown IDs are dropped and missing
/// routes are appended in canonical order, so a stale or partial stored
/// value can never lose a destination. Shell wiring stays in the owning
/// lane; this type is the persistence contract plus tests.
struct RailOrderState {
    private let defaults: UserDefaults
    private let defaultOrder: [String]

    init(defaults: UserDefaults = .standard, defaultOrder: [String] = CockpitRoute.allCases.map(\.rawValue)) {
        self.defaults = defaults
        self.defaultOrder = defaultOrder
    }

    private var defaultsKey: String { "zero.rails.order" }

    var order: [String] {
        nonmutating get { sanitize(defaults.stringArray(forKey: defaultsKey)) }
        nonmutating set { defaults.set(sanitize(newValue), forKey: defaultsKey) }
    }

    func move(routeID: String, to index: Int) {
        var current = order.filter { $0 != routeID }
        current.insert(routeID, at: min(max(index, 0), current.count))
        order = current
    }

    func reset() { defaults.removeObject(forKey: defaultsKey) }

    private func sanitize(_ stored: [String]?) -> [String] {
        guard let stored else { return defaultOrder }
        let known = stored.filter { defaultOrder.contains($0) }
        return known + defaultOrder.filter { !known.contains($0) }
    }
}

/// Semantic resizable column: content plus a 6 pt drag handle.
///
/// - Drag the handle (hover shows the resize cursor) to resize.
/// - Focus the handle and press ⌥←/→, or use the VoiceOver rotor actions,
///   to adjust by 10 pt.
/// - The handle's `accessibilityValue` announces the current width.
/// - Width persists through `ResizablePaneState` on drag end and on every
///   keyboard/rotor adjustment. No borderless windows, no private API.
struct ResizablePane<Content: View>: View {
    private let state: ResizablePaneState
    private let handleEdge: HorizontalEdge
    private let content: () -> Content
    @State private var width: CGFloat
    @State private var dragStart: CGFloat?
    @State private var hovering = false

    init(
        _ state: ResizablePaneState,
        handleEdge: HorizontalEdge = .leading,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.state = state
        self.handleEdge = handleEdge
        self.content = content
        _width = State(initialValue: state.width)
    }

    var body: some View {
        HStack(spacing: 0) {
            if handleEdge == .trailing {
                paneBody
                handle
            } else {
                handle
                paneBody
            }
        }
    }

    private var paneBody: some View {
        content()
            .frame(width: width)
    }

    private var handle: some View {
        Rectangle()
            .fill(hovering ? ZeroTheme.orange.opacity(0.35) : Color.clear)
            .frame(width: 6)
            .contentShape(Rectangle())
            .onHover { isHovering in
                hovering = isHovering
                if isHovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        if dragStart == nil { dragStart = width }
                        let delta = value.translation.width * (handleEdge == .leading ? -1 : 1)
                        width = min(max(dragStart! + delta, state.minWidth), state.maxWidth)
                    }
                    .onEnded { _ in
                        state.width = width
                        dragStart = nil
                    }
            )
            .focusable()
            .accessibilityLabel("Resize pane")
            .accessibilityValue("\(Int(width)) points wide")
            .accessibilityAdjustableAction { direction in
                adjust(by: direction == .increment ? 10 : -10)
            }
            .onKeyPress(phases: .down) { press in
                guard press.modifiers.contains(.option) else { return .ignored }
                switch press.key {
                case .leftArrow: adjust(by: -10); return .handled
                case .rightArrow: adjust(by: 10); return .handled
                default: return .ignored
                }
            }
    }

    private func adjust(by delta: CGFloat) {
        width = min(max(width + delta, state.minWidth), state.maxWidth)
        state.width = width
    }
}
