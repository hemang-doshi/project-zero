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
                ZeroStatusBadge(item.decision, tone: .attention)
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
                Text("AUTHORITATIVE ROUTING FIELDS")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(ZeroTheme.secondaryInk)
                inspectorDatum("Action", item.action, authoritative: true)
                inspectorDatum("Target", item.target, authoritative: true)
                inspectorDatum("Source", item.source, authoritative: true)
                inspectorDatum("Deadline", item.deadline, authoritative: true)
                inspectorDatum("Decision", item.decision, authoritative: true)
            }

            Divider().overlay(ZeroTheme.line)

            VStack(alignment: .leading, spacing: 7) {
                Text("BOUNDED DISPLAY EVIDENCE")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(ZeroTheme.secondaryInk)
                ForEach(Array(item.evidence.enumerated()), id: \.offset) { _, field in
                    if !["Request ID", "Action", "Target", "Source", "Deadline", "Decision"].contains(field.label) {
                        inspectorDatum(field.label, field.value, authoritative: field.isAuthoritative)
                    }
                }
                if item.evidence.allSatisfy({ ["Request ID", "Action", "Target", "Source", "Deadline", "Decision"].contains($0.label) }) {
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
                    title: "Visible evidence is truncated",
                    detail: "The action response contains no clipped display text. Review the originating work surface if the missing context matters."
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
