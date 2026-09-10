import SwiftUI

/// One app tile on the in-window desktop canvas.
///
/// Local layout state only: nothing here writes to the daemon. Card widths
/// persist via `ResizablePaneState` (`zero.pane.<id>`, local
/// `UserDefaults` only); drag offsets, fullscreen flags, and panel picks are
/// in-memory `@State`.
public struct DesktopApp: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let route: CockpitRoute

    public init(id: String, title: String, route: CockpitRoute) {
        self.id = id
        self.title = title
        self.route = route
    }
}

/// Grass/dot-grid fallback when no owner wallpaper asset is supplied.
///
/// Mirrors the shell's dot wallpaper: grass `ZeroTheme.wallpaper` base with a
/// `ZeroTheme.wallpaperDot` grid. Missing asset degrades here, never crashes.
struct DesktopWallpaper: View {
    var body: some View {
        Canvas { context, size in
            for x in stride(from: 12.0, through: size.width, by: 24) {
                for y in stride(from: 12.0, through: size.height, by: 24) {
                    context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 2, height: 2)), with: .color(ZeroTheme.wallpaperDot))
                }
            }
        }
        .background(ZeroTheme.wallpaper)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

/// In-window desktop canvas: owner wallpaper asset when supplied, grass/
/// dot-grid fallback otherwise; app cards float above via `content()`.
///
/// Side-by-side cards compose in an `HStack` at the call site. No daemon
/// writes; layout state stays local.
public struct DesktopCanvas<Content: View>: View {
    private let wallpaper: Image?
    private let content: () -> Content

    public init(wallpaper: Image? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.wallpaper = wallpaper
        self.content = content
    }

    public var body: some View {
        ZStack {
            Group {
                if let wallpaper {
                    wallpaper
                        .resizable()
                        .scaledToFill()
                } else {
                    DesktopWallpaper()
                }
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
            content()
        }
    }
}

/// Pure drag math: committed base plus live gesture translation.
///
/// Each new drag's `translation` restarts at zero, so the gesture accumulates
/// onto the committed base on end instead of replacing it.
func accumulatedOffset(_ base: CGSize, _ translation: CGSize) -> CGSize {
    CGSize(width: base.width + translation.width, height: base.height + translation.height)
}

extension InspectorPopoutKind {
    /// Native pop-out target for routes that own one; other apps live
    /// in-canvas (and fullscreen) only.
    init?(desktopRoute route: CockpitRoute) {
        switch route {
        case .flightRecorder: self = .flightRecorder
        case .airlock: self = .airlock
        case .zeroBot: self = .zeroBot
        case .desk, .runtime, .network, .skillLab: return nil
        }
    }
}

/// macOS traffic lights: red close, yellow minimize, green in-canvas
/// fullscreen toggle. Dimmed to gray when the window is not front/active.
struct DesktopTrafficLights: View {
    let isActive: Bool
    let title: String
    var onClose: (() -> Void)? = nil
    var onMinimize: (() -> Void)? = nil
    var onZoom: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            light(color: Color(red: 1.0, green: 0.373, blue: 0.341), label: "Close \(title)", action: onClose)
            light(color: Color(red: 0.996, green: 0.737, blue: 0.180), label: "Minimize \(title)", action: onMinimize)
            light(color: Color(red: 0.157, green: 0.784, blue: 0.251), label: "Toggle \(title) fullscreen", action: onZoom)
        }
    }

    private func light(color: Color, label: String, action: (() -> Void)?) -> some View {
        Button { action?() } label: {
            Circle()
                .fill(isActive ? color : Color.gray.opacity(0.4))
                .frame(width: 12, height: 12)
        }
        .buttonStyle(.plain)
        .focusEffectDisabled()
        .help(label)
        .accessibilityLabel(label)
        .disabled(action == nil)
    }
}

/// One draggable/resizable/fullscreen app card on the desktop canvas.
///
/// - Drag the header to move (in-memory offset, no daemon write).
/// - Drag the trailing handle to resize (`ResizablePane`, persists locally
///   under `zero.pane.<id>`).
/// - Fullscreen expands the card to fill the canvas in place
///   (`.fullScreenCover` is iOS-only and unavailable on macOS); native
///   window pop-out stays on the existing `InspectorPopoutButton` scenes
///   where the route owns one.
/// - An optional `PanelHost` slot docks a single side panel beside the card;
///   its pick is local `@State`, persisted per-window only.
struct DesktopCard<Content: View, Panel: View>: View {
    let app: DesktopApp
    let selection: CockpitSelection
    let panelOptions: [PanelSelection]
    let content: () -> Content
    let panel: (PanelSelection) -> Panel
    var onClose: (() -> Void)? = nil
    var onMinimize: (() -> Void)? = nil
    var onFocus: (() -> Void)? = nil
    var onMove: ((CGPoint) -> Void)? = nil
    var onResize: ((CGSize) -> Void)? = nil

    @State private var origin: CGPoint
    @State private var dragTranslation = CGSize.zero
    @State private var windowSize: CGSize
    @State private var isFullscreen = false
    @State private var panelSelection: PanelSelection = .primary
    @State private var hoveringHandle: String? = nil

    init(
        app: DesktopApp,
        selection: CockpitSelection,
        panelOptions: [PanelSelection] = [.primary],
        initialOrigin: CGPoint = .zero,
        initialSize: CGSize = CGSize(width: 560, height: 480),
        onClose: (() -> Void)? = nil,
        onMinimize: (() -> Void)? = nil,
        onFocus: (() -> Void)? = nil,
        onMove: ((CGPoint) -> Void)? = nil,
        onResize: ((CGSize) -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder panel: @escaping (PanelSelection) -> Panel
    ) {
        self.app = app
        self.selection = selection
        self.panelOptions = panelOptions
        self.content = content
        self.panel = panel
        self.onClose = onClose
        self.onMinimize = onMinimize
        self.onFocus = onFocus
        self.onMove = onMove
        self.onResize = onResize
        _origin = State(initialValue: initialOrigin)
        _windowSize = State(initialValue: desktopClampSize(initialSize))
    }

    @State private var resizeBase: (origin: CGPoint, size: CGSize)? = nil

    private func resize(trailingBy dx: CGFloat) {
        let base = resizeBase ?? (origin, windowSize)
        windowSize.width = desktopClampSize(CGSize(width: base.size.width + dx, height: base.size.height)).width
    }

    private func resize(leadingBy dx: CGFloat) {
        let base = resizeBase ?? (origin, windowSize)
        let newWidth = min(max(base.size.width - dx, 320), 1100)
        origin.x = base.origin.x + (base.size.width - newWidth)
        windowSize.width = newWidth
    }

    private func resize(bottomBy dy: CGFloat) {
        let base = resizeBase ?? (origin, windowSize)
        windowSize.height = desktopClampSize(CGSize(width: base.size.width, height: base.size.height + dy)).height
    }

    private func resize(topBy dy: CGFloat) {
        let base = resizeBase ?? (origin, windowSize)
        let newHeight = min(max(base.size.height - dy, 240), 900)
        origin.y = base.origin.y + (base.size.height - newHeight)
        windowSize.height = newHeight
    }

    private func adjustSize(by delta: CGSize) {
        windowSize = desktopClampSize(CGSize(width: windowSize.width + delta.width, height: windowSize.height + delta.height))
        onResize?(windowSize)
    }

    private var isActive: Bool { selection.route == app.route }

    private var displayOrigin: CGPoint {
        CGPoint(x: origin.x + dragTranslation.width, y: origin.y + dragTranslation.height)
    }

    var body: some View {
        Group {
            if isFullscreen {
                fullscreenBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        header
                        content()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                    .frame(width: windowSize.width, height: windowSize.height)
                    .background(ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(isActive ? ZeroTheme.orange : ZeroTheme.ink.opacity(0.2), lineWidth: isActive ? 2 : 1)
                    )
                    .overlay(resizeHandles)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("\(app.title) window")
                    .accessibilityValue("\(Int(windowSize.width)) by \(Int(windowSize.height)) points")
                    .accessibilityAdjustableAction { direction in
                        adjustSize(by: CGSize(width: 0, height: direction == .increment ? 10 : -10))
                    }
                    .onKeyPress(phases: .down) { press in
                        guard press.modifiers.contains(.option) else { return .ignored }
                        switch press.key {
                        case .leftArrow: adjustSize(by: CGSize(width: -10, height: 0)); return .handled
                        case .rightArrow: adjustSize(by: CGSize(width: 10, height: 0)); return .handled
                        case .upArrow: adjustSize(by: CGSize(width: 0, height: -10)); return .handled
                        case .downArrow: adjustSize(by: CGSize(width: 0, height: 10)); return .handled
                        default: return .ignored
                        }
                    }
                    if Panel.self != EmptyView.self {
                        PanelHost(selected: $panelSelection, options: panelOptions, panel: panel)
                            .frame(width: 280)
                    }
                }
                .offset(x: displayOrigin.x, y: displayOrigin.y)
            }
        }
        .onTapGesture { onFocus?() }
    }

    /// 4 edges + 4 corners. Edge drag resizes one axis with anchor math
    /// (leading/top edges move the origin); corners resize both axes.
    private var resizeHandles: some View {
        ZStack {
            edgeHandle(id: "trailing", cursor: .resizeLeftRight, alignment: .trailing, size: CGSize(width: 8, height: 60)) { t in
                resize(trailingBy: t.width)
            }
            edgeHandle(id: "leading", cursor: .resizeLeftRight, alignment: .leading, size: CGSize(width: 8, height: 60)) { t in
                resize(leadingBy: t.width)
            }
            edgeHandle(id: "bottom", cursor: .resizeUpDown, alignment: .bottom, size: CGSize(width: 60, height: 8)) { t in
                resize(bottomBy: t.height)
            }
            edgeHandle(id: "top", cursor: .resizeUpDown, alignment: .top, size: CGSize(width: 60, height: 8)) { t in
                resize(topBy: t.height)
            }
            ForEach(cornerSpecs, id: \.id) { spec in
                edgeHandle(id: spec.id, cursor: spec.cursor, alignment: spec.alignment, size: CGSize(width: 14, height: 14)) { t in
                    switch spec.id {
                    case "topLeading": resize(leadingBy: t.width); resize(topBy: t.height)
                    case "topTrailing": resize(trailingBy: t.width); resize(topBy: t.height)
                    case "bottomLeading": resize(leadingBy: t.width); resize(bottomBy: t.height)
                    default: resize(trailingBy: t.width); resize(bottomBy: t.height)
                    }
                }
            }
        }
    }

    private struct CornerSpec { let id: String; let cursor: NSCursor; let alignment: Alignment }

    private var cornerSpecs: [CornerSpec] {
        [
            CornerSpec(id: "topLeading", cursor: .init(image: NSCursor.crosshair.image, hotSpot: .zero), alignment: .topLeading),
            CornerSpec(id: "topTrailing", cursor: .init(image: NSCursor.crosshair.image, hotSpot: .zero), alignment: .topTrailing),
            CornerSpec(id: "bottomLeading", cursor: .init(image: NSCursor.crosshair.image, hotSpot: .zero), alignment: .bottomLeading),
            CornerSpec(id: "bottomTrailing", cursor: .init(image: NSCursor.crosshair.image, hotSpot: .zero), alignment: .bottomTrailing),
        ]
    }

    private func edgeHandle(id: String, cursor: NSCursor, alignment: Alignment, size: CGSize, onDrag: @escaping (CGSize) -> Void) -> some View {
        Rectangle()
            .fill(hoveringHandle == id ? ZeroTheme.orange.opacity(0.35) : Color.clear)
            .frame(width: size.width, height: size.height)
            .contentShape(Rectangle())
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .onHover { hovering in
                hoveringHandle = hovering ? id : nil
                if hovering { cursor.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged {
                        if resizeBase == nil { resizeBase = (origin, windowSize) }
                        onDrag($0.translation)
                    }
                    .onEnded { _ in
                        resizeBase = nil
                        onResize?(windowSize)
                        onMove?(origin)
                    }
            )
            .focusable()
            .accessibilityLabel("Resize \(app.title) \(id)")
    }

    private var header: some View {
        HStack(spacing: 8) {
            DesktopTrafficLights(
                isActive: isActive,
                title: app.title,
                onClose: onClose,
                onMinimize: onMinimize,
                onZoom: { isFullscreen.toggle() }
            )
            Image(systemName: app.route.symbol)
                .accessibilityHidden(true)
            Text(app.title)
                .font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 8)
            if let kind = InspectorPopoutKind(desktopRoute: app.route) {
                InspectorPopoutButton(kind: kind)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(ZeroTheme.frameBand)
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { value in
                    dragTranslation = value.translation
                }
                .onEnded { value in
                    let end = CGPoint(x: origin.x + value.translation.width, y: origin.y + value.translation.height)
                    origin = CGPoint(x: max(end.x, 0), y: max(end.y, 0))
                    dragTranslation = .zero
                    onMove?(origin)
                    onFocus?()
                }
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(app.title) card. Drag header to move.")
    }

    private var fullscreenBody: some View {
        VStack(spacing: 0) {
            HStack {
                Text(app.title)
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Button("Done") { isFullscreen = false }
                    .buttonStyle(ZeroButtonStyle(.standard))
                    .focusEffectDisabled()
                    .accessibilityLabel("Exit \(app.title) fullscreen")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(ZeroTheme.frameBand)
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(ZeroTheme.workstation)
    }
}

extension DesktopCard where Panel == EmptyView {
    init(app: DesktopApp, selection: CockpitSelection, @ViewBuilder content: @escaping () -> Content) {
        self.init(app: app, selection: selection, panelOptions: [], content: content, panel: { _ in EmptyView() })
    }
}
