import AppKit
import SwiftUI
import ZeroKit

enum CockpitSceneID {
    static let main = "project-zero-cockpit"
}

@MainActor
public struct CockpitAppRoot: Scene {
    @StateObject private var model = CockpitModel()

    public init() {}

    public var body: some Scene {
        WindowGroup("Project Zero", id: CockpitSceneID.main) {
            CockpitWindow(model: model)
        }
        .defaultSize(width: 1450, height: 900)
        WindowGroup(
            Text(CockpitPopoutScene.title(for: .flightRecorder)),
            id: CockpitPopoutScene.sceneID(for: .flightRecorder),
            for: String.self
        ) { _ in
            InspectorPopout(model: model, kind: .flightRecorder)
        }
        .defaultSize(width: 1100, height: 750)
        WindowGroup(
            Text(CockpitPopoutScene.title(for: .airlock)),
            id: CockpitPopoutScene.sceneID(for: .airlock),
            for: String.self
        ) { _ in
            InspectorPopout(model: model, kind: .airlock)
        }
        .defaultSize(width: 1100, height: 750)
        WindowGroup(
            Text(CockpitPopoutScene.title(for: .zeroBot)),
            id: CockpitPopoutScene.sceneID(for: .zeroBot),
            for: String.self
        ) { _ in
            InspectorPopout(model: model, kind: .zeroBot)
        }
        .defaultSize(width: 1100, height: 750)
        MenuBarExtra("Project Zero", systemImage: "circle.dotted") {
            MenuCompanion(model: model)
        }
        .menuBarExtraStyle(.window)
        Settings {
            CockpitSettings()
        }
        .commands {
            CockpitCommands(model: model)
        }
    }
}

private struct CockpitCommands: Commands {
    @ObservedObject var model: CockpitModel
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Open Project Zero") {
                openWindow(id: CockpitSceneID.main)
            }
            .keyboardShortcut("n", modifiers: .command)
            Divider()
            ForEach(CockpitRoute.allCases) { route in
                Button("Open \(route.title)") {
                    model.selection.route = route
                }
                .keyboardShortcut(route.shortcut, modifiers: .command)
            }
        }
    }
}

private struct CockpitWindow: View {
    @ObservedObject var model: CockpitModel
    @StateObject private var windows = DesktopWindowManager()
    @State private var lifecycleRegistered = false

    var body: some View {
        // In-window desktop: owner wallpaper asset when supplied, grass/
        // dot-grid fallback otherwise. All open routes render as overlapping
        // DesktopCards; closed routes mount nothing. Local layout state only.
        DesktopCanvas {
            ZStack(alignment: .topLeading) {
                ForEach(desktopApps().filter { windows.isOpen($0.route) }) { app in
                    DesktopCard(
                        app: app,
                        selection: model.selection,
                        initialOrigin: windows.origin(for: app.route),
                        initialSize: windows.size(for: app.route),
                        onClose: { closeRoute(app.route) },
                        onFocus: {
                            windows.bringToFront(app.route)
                            model.selection.route = app.route
                        },
                        onMove: { windows.setOrigin($0, for: app.route) },
                        onResize: { windows.setSize($0, for: app.route) },
                        content: {
                            CockpitShell(
                                selection: $model.selection,
                                status: model.runtimeStatusLabel,
                                version: "v\(ZeroRelease.version) · \(ZeroRelease.build)",
                                transparentBackground: true
                            ) {
                                CockpitRouteView(route: app.route, model: model)
                            }
                        },
                        panel: { _ in EmptyView() }
                    )
                    .zIndex(zIndex(for: app.route))
                }
            }
            .padding(48)
            VStack {
                Spacer()
                dockStrip
            }
        }
        .frame(minWidth: 900, minHeight: 640)
        .onChange(of: model.selection.route) { route in
            // Route ALL selection writes (keyboard shortcuts, rail, tab
            // strip) through the window manager so a closed/background
            // route opens and fronts its window.
            windows.open(route)
        }
        .onAppear {
            guard !lifecycleRegistered else { return }
            lifecycleRegistered = true
            model.windowDidAppear()
        }
        .onDisappear {
            guard lifecycleRegistered else { return }
            lifecycleRegistered = false
            model.windowDidDisappear()
        }
    }

    private func zIndex(for route: CockpitRoute) -> Double {
        Double(windows.zOrder.firstIndex(of: route) ?? 0)
    }

    /// Close a window and repoint selection to the new front window, or to
    /// `.desk` (opened if needed) when nothing remains — something always mounts.
    private func closeRoute(_ route: CockpitRoute) {
        let fallback = desktopFallbackSelection(closed: route, zOrder: windows.zOrder)
        windows.close(route)
        if !windows.isOpen(fallback) {
            windows.open(fallback)
        }
        model.selection.route = fallback
    }

    private var dockStrip: some View {
        HStack(spacing: 8) {
            ForEach(CockpitRoute.allCases) { route in
                let isOpen = windows.isOpen(route)
                Button {
                    if isOpen {
                        closeRoute(route)
                    } else {
                        // New windows cascade by open count.
                        let cascade = desktopCascadeOffset(for: windows.openCount)
                        windows.setOrigin(CGPoint(x: cascade.width, y: cascade.height), for: route)
                        windows.open(route)
                        model.selection.route = route
                    }
                } label: {
                    Label(route.title, systemImage: route.symbol)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 18))
                        .frame(width: 44, height: 44)
                        .background(isOpen ? ZeroTheme.orange.opacity(0.25) : ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(ZeroButtonStyle(.quiet))
                .focusEffectDisabled()
                .help("\(isOpen ? "Close" : "Open") \(route.title)")
                .accessibilityLabel("\(isOpen ? "Close" : "Open") \(route.title)")
            }
        }
        .padding(8)
        .background(ZeroTheme.navigation.opacity(0.9), in: RoundedRectangle(cornerRadius: 14))
        .frame(maxWidth: .infinity)
    }
}

private struct CockpitRouteView: View {
    let route: CockpitRoute
    @ObservedObject var model: CockpitModel

    @ViewBuilder
    var body: some View {
        switch route {
        case .desk:
            DeskView(model: model)
        case .runtime:
            RuntimeView(model: model)
        case .network:
            NetworkView(model: model)
        case .flightRecorder:
            FlightRecorderView(model: model)
        case .airlock:
            AirlockView(model: model)
        case .zeroBot:
            ZeroBotView(model: model)
        case .skillLab:
            SkillLabView(model: model)
        }
    }
}

/// All seven desktop apps in rail order (desk/runtime/network/flightRecorder/
/// airlock/zeroBot/skillLab). Pure: no model, daemon, or layout state.
func desktopApps() -> [DesktopApp] {
    CockpitRoute.allCases.map { DesktopApp(id: $0.rawValue, title: $0.title, route: $0) }
}

private struct CockpitSettings: View {
    var body: some View {
        Text("Project Zero settings will appear here.")
            .padding()
            .background(ZeroTheme.panel)
    }
}
