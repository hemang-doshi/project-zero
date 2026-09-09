import AppKit
import SwiftUI

public struct MenuCompanion: View {
    @ObservedObject private var model: CockpitModel
    @Environment(\.openWindow) private var openWindow

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            statusRow(
                title: "Runtime",
                value: model.runtimeStatusLabel,
                symbol: model.runtimeConnection == .live ? "checkmark.circle.fill" : "wifi.slash",
                tone: model.runtimeStatusTone
            )
            statusRow(
                title: "Focus",
                value: focusSummary,
                symbol: "timer",
                tone: model.runtimeConnection == .live && model.snapshot?.session.state == "RUNNING" ? .healthy : .neutral
            )
            let delivery = model.deliveryState.presentation
            statusRow(title: "Delivery", value: delivery.label, symbol: delivery.symbol, tone: delivery.tone)
            statusRow(
                title: "Attention",
                value: model.attentionLabel,
                symbol: model.attentionCount == 0 ? "checkmark.shield" : "exclamationmark.triangle",
                tone: model.attentionCount == 0 ? .healthy : .attention
            )

            ZeroTheme.line.frame(height: 1)

            HStack(spacing: 8) {
                Button {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    openWindow(id: CockpitSceneID.main)
                } label: {
                    Label("Open Zero", systemImage: "macwindow")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ZeroButtonStyle(.authority))
                .focusEffectDisabled()
                .keyboardShortcut("o", modifiers: .command)
                .accessibilityHint("Opens the Project Zero cockpit window")

                Button {
                    NSApplication.shared.terminate(nil)
                } label: {
                    Label("Quit", systemImage: "power")
                }
                .buttonStyle(ZeroButtonStyle(.quiet))
                .focusEffectDisabled()
                .keyboardShortcut("q", modifiers: .command)
                .accessibilityLabel("Quit Project Zero")
            }
        }
        .padding(16)
        .frame(width: 320)
        .background(ZeroTheme.workstation)
        .foregroundStyle(ZeroTheme.ink)
        .preferredColorScheme(.light)
        .onAppear { model.applicationDidStart() }
    }

    private var focusSummary: String {
        let summary = "\(model.activeProjectName) · \(model.focusElapsedLabel)"
        if model.runtimeConnection == .live { return summary }
        return model.snapshot == nil ? "Unavailable · 0:00:00" : "Last known: \(summary)"
    }

    private func statusRow(title: String, value: String, symbol: String, tone: ZeroTone) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .frame(width: 62, alignment: .leading)
            ZeroStatusBadge(value, symbol: symbol, tone: tone)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
