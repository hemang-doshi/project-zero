import AppKit
import SwiftUI

/// One 24 pt tile of the grass/dot-grid wallpaper, built once. Tiling a cached
/// bitmap is a GPU blit instead of a per-redraw CPU dot loop.
private let desktopWallpaperTile: NSImage = {
    let tile = NSSize(width: 24, height: 24)
    let image = NSImage(size: tile)
    image.lockFocus()
    NSColor(ZeroTheme.wallpaper).setFill()
    NSRect(origin: .zero, size: tile).fill()
    NSColor(ZeroTheme.wallpaperDot).setFill()
    NSBezierPath(ovalIn: NSRect(x: 12, y: 12, width: 2, height: 2)).fill()
    image.unlockFocus()
    return image
}()

/// Grass/dot-grid fallback when no owner wallpaper asset is supplied.
///
/// Mirrors the shell's dot wallpaper: grass `ZeroTheme.wallpaper` base with a
/// `ZeroTheme.wallpaperDot` grid. Missing asset degrades here, never crashes.
struct DesktopWallpaper: View {
    var body: some View {
        Image(nsImage: desktopWallpaperTile)
            .resizable(resizingMode: .tile)
            .ignoresSafeArea()
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }
}

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
            // Anchor card coordinates to the canvas top-left. Without this the
            // content stack sizes to the largest card and centers, so one
            // card's resize/open would shift every other card's screen spot.
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
                .frame(width: 18, height: 18)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focusEffectDisabled()
        .help(label)
        .accessibilityLabel(label)
        .disabled(action == nil)
    }
}

/// Hoisted crosshair cursor so gesture-driven card body evaluations don't
/// allocate a cursor per corner per event. Initialized on first card layout
/// (main thread).
private let desktopCornerCursor = NSCursor(image: NSCursor.crosshair.image, hotSpot: .zero)

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
    /// Live drag translation. `@GestureState` resets on end/cancel, so a
    /// cancelled drag can never leave a card offset from its committed spot.
    @GestureState private var dragTranslation: CGSize = .zero
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

    /// Live resize gesture: translation plus the handle's fixed-corner anchor.
    /// `@GestureState` resets automatically when the gesture ends or is
    /// cancelled, so a preview can never get stuck.
    @GestureState private var resizeSession: ResizeSession? = nil

    private struct ResizeSession: Equatable {
        var translation: CGSize
        var anchor: UnitPoint
    }

    /// Target rect for the active gesture, computed from the committed rect.
    /// `anchor` names the fixed corner; moving edges invert their delta sign
    /// and the origin moves so the fixed corner stays put.
    private func resizeRect(dx: CGFloat, dy: CGFloat, anchor: UnitPoint) -> (origin: CGPoint, size: CGSize) {
        let fixedRight = anchor == .topTrailing || anchor == .bottomTrailing
        let fixedBottom = anchor == .bottomLeading || anchor == .bottomTrailing
        let width = min(max(windowSize.width + (fixedRight ? -dx : dx), 320), 1100)
        let height = min(max(windowSize.height + (fixedBottom ? -dy : dy), 240), 900)
        var x = origin.x
        var y = origin.y
        if fixedRight { x = origin.x + (windowSize.width - width) }
        if fixedBottom { y = origin.y + (windowSize.height - height) }
        return (CGPoint(x: x, y: y), CGSize(width: width, height: height))
    }

    /// Target rect during a gesture; committed rect otherwise.
    private var resizeTarget: (origin: CGPoint, size: CGSize) {
        guard let session = resizeSession else { return (origin, windowSize) }
        return resizeRect(dx: session.translation.width, dy: session.translation.height, anchor: session.anchor)
    }

    private var resizeAnchor: UnitPoint { resizeSession?.anchor ?? .topLeading }

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
                    // Live preview is a pure transform. The layout footprint
                    // stays at the committed size until release, so pointer
                    // events never re-layout the card, its route content, or
                    // the canvas — one scale change per event, nothing more.
                    .scaleEffect(
                        x: resizeTarget.size.width / max(windowSize.width, 1),
                        y: resizeTarget.size.height / max(windowSize.height, 1),
                        anchor: resizeAnchor
                    )
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
    }

    /// 4 edges + 4 corners. Each handle names the fixed corner; drags are
    /// measured in global space so the moving preview cannot distort them.
    private var resizeHandles: some View {
        ZStack {
            edgeHandle(id: "trailing", cursor: .resizeLeftRight, alignment: .trailing, size: CGSize(width: 8, height: 60), anchor: .topLeading)
            edgeHandle(id: "leading", cursor: .resizeLeftRight, alignment: .leading, size: CGSize(width: 8, height: 60), anchor: .topTrailing)
            edgeHandle(id: "bottom", cursor: .resizeUpDown, alignment: .bottom, size: CGSize(width: 60, height: 8), anchor: .topLeading)
            edgeHandle(id: "top", cursor: .resizeUpDown, alignment: .top, size: CGSize(width: 60, height: 8), anchor: .bottomLeading)
            ForEach(cornerSpecs, id: \.id) { spec in
                edgeHandle(id: spec.id, cursor: spec.cursor, alignment: spec.alignment, size: CGSize(width: 14, height: 14), anchor: spec.anchor)
            }
        }
    }

    private struct CornerSpec { let id: String; let cursor: NSCursor; let alignment: Alignment; let anchor: UnitPoint }

    private var cornerSpecs: [CornerSpec] {
        [
            CornerSpec(id: "topLeading", cursor: desktopCornerCursor, alignment: .topLeading, anchor: .bottomTrailing),
            CornerSpec(id: "topTrailing", cursor: desktopCornerCursor, alignment: .topTrailing, anchor: .bottomLeading),
            CornerSpec(id: "bottomLeading", cursor: desktopCornerCursor, alignment: .bottomLeading, anchor: .topTrailing),
            CornerSpec(id: "bottomTrailing", cursor: desktopCornerCursor, alignment: .bottomTrailing, anchor: .topLeading),
        ]
    }

    private func edgeHandle(id: String, cursor: NSCursor, alignment: Alignment, size: CGSize, anchor: UnitPoint) -> some View {
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
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .updating($resizeSession) { value, state, _ in
                        state = ResizeSession(translation: value.translation, anchor: anchor)
                    }
                    .onEnded { value in
                        let rect = resizeRect(dx: value.translation.width, dy: value.translation.height, anchor: anchor)
                        origin = rect.origin
                        windowSize = rect.size
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
                .allowsHitTesting(false)
            Text(app.title)
                .font(.zero(size: 13, weight: .semibold))
                .allowsHitTesting(false)
            Spacer(minLength: 8)
            if let kind = InspectorPopoutKind(desktopRoute: app.route) {
                InspectorPopoutButton(kind: kind)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(ZeroTheme.frameBand)
        // The whole band is the drag surface. The shape is defined on the
        // header itself (not the background child) so the Spacer/padding area
        // always hit-tests; the traffic lights and Pop-out keep their clicks
        // as child views. Tap and drag are one gesture: a release with no
        // movement focuses, any movement moves the card.
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .updating($dragTranslation) { value, state, _ in state = value.translation }
                .onEnded { value in
                    if value.translation != .zero {
                        origin = CGPoint(
                            x: origin.x + value.translation.width,
                            y: origin.y + value.translation.height
                        )
                        onMove?(origin)
                    }
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
                    .font(.zero(size: 13, weight: .semibold))
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
