import SwiftUI

public enum CockpitRoute: String, CaseIterable, Identifiable, Sendable {
    case desk, runtime, network, flightRecorder, airlock, zeroBot, skillLab

    public var id: Self { self }
    public var title: String {
        switch self {
        case .desk: "Desk"
        case .runtime: "Runtime"
        case .network: "Network"
        case .flightRecorder: "Flight Recorder"
        case .airlock: "Airlock"
        case .zeroBot: "Zero Bot"
        case .skillLab: "Skill Lab"
        }
    }
    public var symbol: String {
        switch self {
        case .desk: "house"
        case .runtime: "cpu"
        case .network: "point.3.connected.trianglepath.dotted"
        case .flightRecorder: "list.bullet.rectangle"
        case .airlock: "lock.shield"
        case .zeroBot: "terminal"
        case .skillLab: "square.stack.3d.up"
        }
    }
    public var shortcut: KeyEquivalent {
        switch self {
        case .desk: "1"
        case .runtime: "2"
        case .network: "3"
        case .flightRecorder: "4"
        case .airlock: "5"
        case .zeroBot: "6"
        case .skillLab: "7"
        }
    }
}

public struct CockpitSelection: Equatable, Sendable {
    public var route: CockpitRoute
    public var projectID: String?
    public var inspectionID: String?

    public init(route: CockpitRoute = .desk, projectID: String? = nil, inspectionID: String? = nil) {
        self.route = route
        self.projectID = projectID
        self.inspectionID = inspectionID
    }
}

public struct ZeroRailItem: View {
    private let route: CockpitRoute
    private let selected: Bool
    private let action: () -> Void

    public init(_ route: CockpitRoute, selected: Bool, action: @escaping () -> Void) {
        self.route = route
        self.selected = selected
        self.action = action
    }

    public var body: some View {
        let presentation = ZeroRailPresentation(selected: selected)
        return Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: route.symbol)
                    .font(.zero(size: 22, weight: .medium))
                    .frame(width: 44, height: 44)
                    .background(presentation.background, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(presentation.border))
                Text(route.title)
                    .font(.zero(size: 10, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 62)
            .padding(.vertical, 5)
        }
        .buttonStyle(ZeroButtonStyle(.quiet, selected: selected))
        .focusEffectDisabled()
        .accessibilityLabel(route.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help("Open \(route.title)")
    }
}

public struct ZeroTabStrip: View {
    @Binding private var route: CockpitRoute

    public init(route: Binding<CockpitRoute>) { _route = route }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(CockpitRoute.allCases) { item in
                    Button { route = item } label: {
                        Label(item.title, systemImage: item.symbol)
                            .fixedSize()
                    }
                    .buttonStyle(ZeroButtonStyle(item == route ? .authority : .quiet))
                    .focusEffectDisabled()
                    .keyboardShortcut(item.shortcut, modifiers: .command)
                    .accessibilityAddTraits(item == route ? .isSelected : [])
                    .accessibilityValue(item == route ? "Selected" : "Not selected")
                }
            }
            .padding(8)
        }
        .background(ZeroTheme.navigation)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Workspace navigation")
    }
}

/// Value-stable shell chrome: status text only changes on connection
/// transitions, so an unchanged header skips layout on each invalidation.
struct CockpitGlobalHeader: View, Equatable {
    let status: String

    var body: some View {
        HStack(spacing: 12) {
            Text("Z0")
                .font(.zeroMono(size: 16, weight: .black))
                .foregroundStyle(ZeroTheme.navigation)
                .padding(6)
                .background(ZeroTheme.ink, in: RoundedRectangle(cornerRadius: 5))
                .accessibilityHidden(true)
            Text("Project Zero").font(.zero(size: 16, weight: .bold))
            Spacer(minLength: 16)
            Text(status)
                .font(.zeroMono(size: 10, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .lineLimit(2)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(ZeroTheme.workstation)
        .overlay(alignment: .bottom) { ZeroTheme.line.frame(height: 1) }
    }
}

/// Value-stable shell chrome: only the route title varies, on navigation.
struct CockpitFooter: View, Equatable {
    let routeTitle: String

    var body: some View {
        HStack {
            Text("Project Zero / Personal local runtime")
            Spacer()
            Text(routeTitle)
        }
        .font(.zeroMono(size: 9, weight: .medium))
        .padding(.horizontal, 20)
        .padding(.vertical, 6)
        .background(ZeroTheme.navigation)
    }
}
/// The system owns the real titlebar. This frame is the Stitch workstation inside it.
public struct CockpitShell<Content: View, Instruments: View>: View {
    @Binding private var selection: CockpitSelection
    private let status: String
    private let version: String
    private let content: () -> Content
    private let instruments: () -> Instruments
    /// When true, skips the opaque dot-wallpaper backing so an outer
    /// `DesktopCanvas` wallpaper shows through the shell padding. Defaults to
    /// false: every existing call site renders exactly as before.
    private let transparentBackground: Bool

    public init(selection: Binding<CockpitSelection>, status: String, version: String,
                transparentBackground: Bool = false,
                @ViewBuilder content: @escaping () -> Content,
                @ViewBuilder instruments: @escaping () -> Instruments) {
        _selection = selection
        self.status = status
        self.version = version
        self.transparentBackground = transparentBackground
        self.content = content
        self.instruments = instruments
    }

    public var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                CockpitGlobalHeader(status: status).equatable()
                HStack(alignment: .top, spacing: 16) {
                    if geometry.size.width >= 1000 { environmentRail }
                    workstation
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if geometry.size.width >= 1280 && Instruments.self != EmptyView.self {
                        instruments()
                            .frame(width: 112)
                            .padding(.top, 8)
                    }
                }
                .padding(geometry.size.width >= 1000 ? 20 : 12)
                CockpitFooter(routeTitle: selection.route.title).equatable()
            }
        }
        .background {
            if !transparentBackground { DotWallpaper() }
        }
        .foregroundStyle(ZeroTheme.ink)
        .tint(ZeroTheme.orange)
        .preferredColorScheme(.light)
    }

    private var environmentRail: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 10) {
                ForEach(CockpitRoute.allCases) { route in
                    ZeroRailItem(route, selected: selection.route == route) { selection.route = route }
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 3)
        }
        .frame(width: 94)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Desktop shortcuts")
    }

    private var workstation: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "circle.dotted").accessibilityHidden(true)
                Text("zero-runtime-os")
                Spacer()
                Text(version)
            }
            .font(.zeroMono(size: 10, weight: .medium))
            .foregroundStyle(ZeroTheme.secondaryInk)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(ZeroTheme.frameBand)
            ZeroTabStrip(route: $selection.route)
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(ZeroTheme.workstation)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(ZeroTheme.ink.opacity(0.2)))
        .shadow(color: .black.opacity(0.18), radius: 18, x: 0, y: 10)
    }
}

public extension CockpitShell where Instruments == EmptyView {
    init(selection: Binding<CockpitSelection>, status: String, version: String,
         transparentBackground: Bool = false,
         @ViewBuilder content: @escaping () -> Content) {
        self.init(selection: selection, status: status, version: version, transparentBackground: transparentBackground, content: content, instruments: { EmptyView() })
    }
}

private struct DotWallpaper: View {
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
