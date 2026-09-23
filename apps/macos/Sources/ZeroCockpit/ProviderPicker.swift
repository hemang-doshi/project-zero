import SwiftUI
import ZeroKit

/// The unified provider → model dropdown. Only offers models the connected
/// provider advertised live; a provider with nothing advertised renders as a
/// disabled row with the reason instead of an empty or guessed list.
///
/// Built on the semantic `Menu` control with a custom themed label — no
/// stock picker styling.
public struct ProviderPicker: View {
    @Binding public var selection: ProviderSelection
    public var advertised: [ProviderModel]
    public var openCodeUnavailableReason: String?

    public init(
        selection: Binding<ProviderSelection>,
        advertised: [ProviderModel],
        openCodeUnavailableReason: String? = nil
    ) {
        self._selection = selection
        self.advertised = advertised
        self.openCodeUnavailableReason = openCodeUnavailableReason
    }

    public static let policies = ["ask", "on-request", "never"]

    public var body: some View {
        Menu {
            ForEach(ProviderID.allCases) { provider in
                Section(provider.displayName) {
                    let models = ProviderModel.models(for: provider, from: advertised)
                    if models.isEmpty {
                        Button(unavailableReason(for: provider)) {}.disabled(true)
                    } else {
                        ForEach(models, id: \.identifier) { model in
                            Button {
                                selection.provider = provider
                                selection.modelID = model.id
                            } label: {
                                HStack {
                                    Text(model.label)
                                    if selection.provider == provider, selection.modelID == model.id {
                                        Text("✓")
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Section("Policy") {
                ForEach(Self.policies, id: \.self) { policy in
                    Button {
                        selection.policy = policy
                    } label: {
                        HStack {
                            Text(policyLabel(policy))
                            if selection.policy == policy {
                                Text("✓")
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)
                Text(labelText)
                    .font(.zero(size: 12, weight: .semibold))
                    .foregroundStyle(ZeroTheme.primaryAuthority)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
        }
        .help(helpText)
        .accessibilityLabel("Provider and model")
        .accessibilityValue(labelText)
    }

    private var labelText: String {
        guard selection.isAdvertisedModel(in: advertised) else {
            return "Select provider • model"
        }
        return "\(selection.provider.displayName) • \(selection.modelID) • \(policyLabel(selection.policy))"
    }

    private var statusColor: Color {
        selection.isAdvertisedModel(in: advertised) ? ZeroTheme.statusGreen : ZeroTheme.errorRed
    }

    private var helpText: String {
        if selection.isAdvertisedModel(in: advertised) {
            return "Provider \(selection.provider.displayName), model \(selection.modelID), policy \(policyLabel(selection.policy))."
        }
        return "No advertised model is selected. Connect a provider first."
    }

    private func unavailableReason(for provider: ProviderID) -> String {
        switch provider {
        case .codex:
            return "Codex is not connected"
        case .opencode:
            return openCodeUnavailableReason ?? "OpenCode is not connected"
        }
    }

    private func policyLabel(_ policy: String) -> String {
        switch policy {
        case "on-request": return "On request"
        case "never": return "Never"
        case "ask": return "Ask"
        default: return policy
        }
    }
}
