import SwiftUI

public struct InspectorView: View {
    @ObservedObject private var model: CockpitModel

    public init(model: CockpitModel) { self.model = model }

    private var projection: AirlockProjection { AirlockProjection(model: model) }
    private var selectedItem: AirlockApprovalItem? {
        projection.item(selectionID: model.selection.inspectionID)
    }

    public var body: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                header
                if let selectedItem {
                    selectedApproval(selectedItem)
                } else if let inspectionID = model.selection.inspectionID {
                    staleSelection(inspectionID)
                } else {
                    emptySelection
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Evidence inspector")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Label("Evidence Inspector", systemImage: "sidebar.right")
                    .font(.headline.weight(.black))
                Spacer()
                ZeroStatusBadge(model.selection.route.title.uppercased(), tone: .neutral)
            }
            Text("Selection is exact and origin-qualified. No nearest match or prefix fallback is used.")
                .font(.caption)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(ZeroTheme.navigation.opacity(0.72), in: RoundedRectangle(cornerRadius: 7))
    }

    private func selectedApproval(_ item: AirlockApprovalItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.origin.rawValue)
                        .font(.caption2.weight(.bold).monospaced())
                        .foregroundStyle(ZeroTheme.orangePressed)
                    Text(item.action)
                        .font(.headline.monospaced())
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 5) {
                    ZeroStatusBadge(item.decision, tone: .attention)
                    ZeroStatusBadge(freshnessLabel(item), tone: freshnessTone(item))
                }
            }

            HStack(spacing: 7) {
                Image(systemName: "scope")
                    .foregroundStyle(ZeroTheme.orangePressed)
                    .accessibilityHidden(true)
                ScrollView(.horizontal, showsIndicators: true) {
                    Text(item.requestID)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                        .fixedSize()
                }
            }
            .padding(9)
            .background(Color(red: 1.0, green: 0.90, blue: 0.84), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(ZeroTheme.orange.opacity(0.45)))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Authoritative request ID")
            .accessibilityValue(item.requestID)

            VStack(alignment: .leading, spacing: 7) {
                Text("ACTION ROUTING AUTHORITY")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(ZeroTheme.secondaryInk)
                ForEach(item.evidence.filter { $0.isAuthoritative && $0.label != "Request ID" }) { field in
                    inspectorDatum(field.label, field.value, authoritative: true)
                }
                if item.evidence.allSatisfy({ !$0.isAuthoritative || $0.label == "Request ID" }) {
                    Text("Only the exact request ID routes this action. All summaries below are display evidence.")
                        .font(.caption)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Divider().overlay(ZeroTheme.line)

            VStack(alignment: .leading, spacing: 7) {
                Text("DISPLAY EVIDENCE · NEVER ROUTING AUTHORITY")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(ZeroTheme.secondaryInk)
                ForEach(item.evidence.filter { !$0.isAuthoritative }) { field in
                    inspectorDatum(field.label, field.value, authoritative: false)
                }
                if item.evidence.allSatisfy(\.isAuthoritative) {
                    Text("No additional display-safe evidence was projected.")
                        .font(.caption)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                }
            }

            if item.inputOmitted {
                warning(
                    title: "Input omitted by daemon projection",
                    detail: "One or more original invocation inputs are intentionally absent here. Approve and Deny route only the original request ID; this UI does not reconstruct those inputs."
                )
            }
            if item.displayTruncated {
                warning(
                    title: "Summary field is abbreviated",
                    detail: "The full exact request parameters remain visible above as display evidence. No abbreviated text becomes part of the response."
                )
            }
            if let reason = item.responseUnavailableReason {
                warning(title: "No binary action available", detail: reason, neutral: true)
            }

            AirlockDecisionControls(model: model, projection: projection, item: item)
        }
    }

    private func inspectorDatum(_ label: String, _ value: String, authoritative: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Text(label.uppercased())
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(ZeroTheme.secondaryInk)
                if authoritative {
                    Text("ROUTING")
                        .font(.caption2.weight(.black).monospaced())
                        .foregroundStyle(ZeroTheme.orangePressed)
                }
            }
            ScrollView(.horizontal, showsIndicators: true) {
                Text(value)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(authoritative ? ZeroTheme.navigation.opacity(0.52) : Color.white, in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(ZeroTheme.line.opacity(0.8)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label)
        .accessibilityValue(value)
    }

    private func freshnessLabel(_ item: AirlockApprovalItem) -> String {
        switch item.freshness {
        case .live: return "LIVE"
        case .retained: return "CACHED · ACTIONS DISABLED"
        case .expired: return "EXPIRED · APPROVE DISABLED"
        }
    }

    private func freshnessTone(_ item: AirlockApprovalItem) -> ZeroTone {
        switch item.freshness {
        case .live: return .healthy
        case .retained: return .neutral
        case .expired: return .error
        }
    }

    private func warning(title: String, detail: String, neutral: Bool = false) -> some View {
        let tone = neutral ? ZeroTone.neutral : ZeroTone.attention
        return VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: neutral ? "info.circle.fill" : "exclamationmark.triangle.fill")
                .font(.caption.weight(.bold))
            Text(detail)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(tone.color)
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(tone.color.opacity(0.25)))
    }

    private var emptySelection: some View {
        NetworkFlightEmptyState(
            symbol: "doc.text.magnifyingglass",
            title: "Select an exact request",
            detail: "Choose Inspect evidence on a Project Zero or Codex approval. The inspector does not guess which item you intended."
        )
    }

    private func staleSelection(_ inspectionID: String) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: "checkmark.shield")
                .font(.title2.weight(.semibold))
                .foregroundStyle(ZeroTone.healthy.color)
                .accessibilityHidden(true)
            Text("Selected request is no longer pending")
                .font(.headline)
            Text("It may have resolved, expired, or left the bounded projection. Airlock will not substitute another request.")
                .font(.caption)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView(.horizontal, showsIndicators: true) {
                Text(inspectionID)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .fixedSize()
            }
            Button {
                model.selection.inspectionID = nil
            } label: {
                Label("Clear selection", systemImage: "xmark")
            }
            .buttonStyle(ZeroButtonStyle(.standard))
            .focusEffectDisabled()
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.navigation.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}
