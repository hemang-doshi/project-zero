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
    @State private var lifecycleRegistered = false

    var body: some View {
        CockpitShell(
            selection: $model.selection,
            status: model.runtimeStatusLabel,
            version: "v\(ZeroRelease.version) · \(ZeroRelease.build)"
        ) {
            CockpitRouteContent(model: model)
        }
        .frame(minWidth: 900, minHeight: 640)
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
}

private struct CockpitRouteContent: View {
    @ObservedObject var model: CockpitModel

    @ViewBuilder
    var body: some View {
        switch model.selection.route {
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

private struct CockpitSettings: View {
    var body: some View {
        Text("Project Zero settings will appear here.")
            .padding()
            .background(ZeroTheme.panel)
    }
}
