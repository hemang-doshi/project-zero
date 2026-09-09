import AppKit
import SwiftUI

private let cockpitWindowID = "project-zero-cockpit"

public struct CockpitAppRoot: Scene {
    public init() {}

    public var body: some Scene {
        WindowGroup("Project Zero", id: cockpitWindowID) {
            CockpitWindow()
        }
        MenuBarExtra("Project Zero", systemImage: "circle.dotted") {
            OpenCockpitWindowButton()
            Divider()
            Button("Quit Zero") {
                NSApplication.shared.terminate(nil)
            }
        }
        Settings {
            CockpitSettings()
        }
        .commands {
            CockpitCommands()
        }
    }
}

private struct OpenCockpitWindowButton: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Open Project Zero") {
            openWindow(id: cockpitWindowID)
        }
    }
}

private struct CockpitCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Open Project Zero") {
                openWindow(id: cockpitWindowID)
            }
            .keyboardShortcut("n", modifiers: .command)
        }
    }
}

private struct CockpitWindow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Project Zero")
                .font(.title.bold())
            Text("Cockpit controls are loading.")
                .foregroundStyle(.secondary)
        }
        .padding(32)
        .frame(minWidth: 720, minHeight: 480)
        .background(ZeroTheme.environment)
    }
}

private struct CockpitSettings: View {
    var body: some View {
        Text("Project Zero settings will appear here.")
            .padding()
            .background(ZeroTheme.panel)
    }
}
