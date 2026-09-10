import SwiftUI

/// One app tile on the in-window desktop canvas.
///
/// Local layout state only: nothing here writes to the daemon. Card widths
/// persist via `ResizablePaneState` (`zero.desktop.<id>`, local
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

/// One draggable/resizable/fullscreen app card on the desktop canvas.
///
/// - Drag the header to move (in-memory offset, no daemon write).
/// - Drag the trailing handle to resize (`ResizablePane`, persists locally
///   under `zero.desktop.<id>`).
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

    @State private var offset = CGSize.zero
    @State private var isFullscreen = false
    @State private var panelSelection: PanelSelection = .primary

    init(
        app: DesktopApp,
        selection: CockpitSelection,
        panelOptions: [PanelSelection] = [.primary],
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder panel: @escaping (PanelSelection) -> Panel
    ) {
        self.app = app
        self.selection = selection
        self.panelOptions = panelOptions
        self.content = content
        self.panel = panel
    }

    private var paneState: ResizablePaneState {
        ResizablePaneState(
            key: "zero.desktop.\(app.id)",
            defaultWidth: 560,
            minWidth: 320,
            maxWidth: 1100
        )
    }

    private var isActive: Bool { selection.route == app.route }

    var body: some View {
        Group {
            if isFullscreen {
                fullscreenBody
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    ResizablePane(paneState, handleEdge: .trailing) {
                        VStack(spacing: 0) {
                            header
                            content()
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        }
                        .background(ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(isActive ? ZeroTheme.orange : ZeroTheme.ink.opacity(0.2), lineWidth: isActive ? 2 : 1)
                        )
                        .offset(offset)
                    }
                    if Panel.self != EmptyView.self {
                        PanelHost(selected: $panelSelection, options: panelOptions, panel: panel)
                            .frame(width: 280)
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: app.route.symbol)
                .accessibilityHidden(true)
            Text(app.title)
                .font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 8)
            if let kind = InspectorPopoutKind(desktopRoute: app.route) {
                InspectorPopoutButton(kind: kind)
            }
            Button {
                isFullscreen = true
            } label: {
                Label("Fullscreen", systemImage: "arrow.up.left.and.arrow.down.right")
            }
            .buttonStyle(ZeroButtonStyle(.quiet))
            .focusEffectDisabled()
            .help("Show \(app.title) fullscreen")
            .accessibilityLabel("Show \(app.title) fullscreen")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(ZeroTheme.frameBand)
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { value in offset = value.translation }
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
