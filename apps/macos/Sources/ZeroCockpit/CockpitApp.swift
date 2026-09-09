import AppKit
import SwiftUI

public struct CockpitAppRoot: Scene {
    public init() {}

    public var body: some Scene {
        WindowGroup("Project Zero") {
            CockpitWindow()
        }
        MenuBarExtra("Project Zero", systemImage: "circle.dotted") {
            Button("Open Project Zero") {
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            Divider()
            Button("Quit Zero") {
                NSApplication.shared.terminate(nil)
            }
        }
        Settings {
            CockpitSettings()
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Activate Project Zero") {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
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
