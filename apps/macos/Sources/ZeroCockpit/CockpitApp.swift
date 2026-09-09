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
        MenuBarExtra("Project Zero", systemImage: "circle.dotted") {
            MenuCompanion(model: model)
        }
        .menuBarExtraStyle(.window)
        Settings {
            CockpitSettings()
        }
        .commands {
            CockpitCommands()
        }
    }
}

private struct CockpitCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Open Project Zero") {
                openWindow(id: CockpitSceneID.main)
            }
            .keyboardShortcut("n", modifiers: .command)
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
            CockpitRoutePlaceholder(model: model)
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

private struct CockpitRoutePlaceholder: View {
    @ObservedObject var model: CockpitModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(model.selection.route.title)
                .font(.system(size: 28, weight: .black))
            ZeroStatusBadge(
                model.runtimeStatusLabel,
                symbol: model.runtimeConnection == .live ? "checkmark.circle.fill" : "wifi.slash",
                tone: model.runtimeStatusTone
            )
            Text("No durable \(model.selection.route.title.lowercased()) view is attached yet.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
            Text("Project Zero shows only committed runtime and explicitly connected Codex state.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ZeroTheme.workstation)
    }
}

private struct CockpitSettings: View {
    var body: some View {
        Text("Project Zero settings will appear here.")
            .padding()
            .background(ZeroTheme.panel)
    }
}
