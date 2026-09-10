import SwiftUI
import ZeroKit

/// Skill Lab: the Zero-owned shared-skills route.
///
/// Lists skills from the owner-controlled skills directory with their source
/// (learned-in-Codex / learned-in-OpenCode / authored), enable state, and the
/// exact per-provider injection contract shown verbatim before use. Skills
/// enabled once apply to both providers' future sessions (shared); the view
/// only reads `CockpitModel` (for the active-provider preview default) and
/// never executes skill code.
public struct SkillLabView: View {
    @ObservedObject private var model: CockpitModel
    @State private var store: SkillStore
    @State private var selectedID: String?
    @State private var previewProvider: ProviderID

    public init(model: CockpitModel) {
        self.model = model
        _store = State(initialValue: SkillStore.load())
        _previewProvider = State(initialValue: model.activeProvider)
    }

    private var selectedSkill: ZeroSkill? {
        store.skills.first(where: { $0.id == (selectedID ?? store.skills.first?.id) })
    }

    public var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 1_050
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if store.skills.isEmpty {
                        emptyState
                    } else if wide {
                        HStack(alignment: .top, spacing: 14) {
                            listPanel.frame(maxWidth: .infinity, alignment: .top)
                            ResizablePane(.inspector(key: "skillLab.inspector", defaultWidth: 380)) {
                                detailPanel
                            }
                        }
                    } else {
                        VStack(spacing: 14) { listPanel; detailPanel }
                    }
                }
                .padding(proxy.size.width < 720 ? 14 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Skill Lab shared provider skills")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Skill Lab: Shared Provider Skills")
                .font(.system(size: 27, weight: .black))
                .tracking(-0.8)
                .minimumScaleFactor(0.7)
                .lineLimit(2)
            HStack(spacing: 8) {
                ZeroStatusBadge("SHARED BY BOTH PROVIDERS", symbol: "square.stack.3d.up", tone: .neutral)
                ZeroStatusBadge(
                    "\(store.enabledSkills.count) ENABLED",
                    symbol: store.enabledSkills.isEmpty ? "circle" : "checkmark.circle",
                    tone: store.enabledSkills.isEmpty ? .neutral : .healthy
                )
            }
            Text("Zero-owned skills from the owner-controlled skills directory. Skills enabled once apply to both providers' future sessions; threads and projects stay namespaced per provider. Nothing here executes skill code.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZeroStatusBadge("NO SKILLS FOUND", symbol: "tray", tone: .attention)
            Text("No skills in \(SkillStore.defaultDirectory.path). Add a skill folder with a SKILL.md to make it appear here; this view never creates the directory.")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(14)
        .background(ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ZeroTheme.line))
        .accessibilityLabel("No skills found")
    }

    private var listPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("ZERO-OWNED SKILLS", systemImage: "square.stack.3d.up")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
            ForEach(store.skills) { skill in
                skillRow(skill)
            }
        }
        .padding(14)
        .background(ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ZeroTheme.line))
    }

    private func skillRow(_ skill: ZeroSkill) -> some View {
        let selected = selectedSkill?.id == skill.id
        return HStack(spacing: 10) {
            Button {
                selectedID = skill.id
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(skill.name)
                            .font(.system(size: 13, weight: .semibold))
                        ZeroStatusBadge(
                            skill.isUsable ? skill.source.displayName.uppercased() : "UNUSABLE",
                            symbol: skill.isUsable ? "checkmark.circle" : "exclamationmark.triangle",
                            tone: skill.isUsable ? .neutral : .error
                        )
                    }
                    Text(skill.isUsable ? skill.summary : (skill.rejectionReason ?? "Unusable skill."))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(ZeroButtonStyle(.quiet, selected: selected))
            .focusEffectDisabled()
            .accessibilityLabel("Select skill \(skill.name)")
            .accessibilityAddTraits(selected ? .isSelected : [])
            Button {
                store.setEnabled(skill.id, !skill.enabled)
            } label: {
                Text(skill.enabled ? "Enabled ✓" : "Disabled")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
            }
            .buttonStyle(ZeroButtonStyle(.quiet, selected: skill.enabled))
            .focusEffectDisabled()
            .disabled(!skill.isUsable)
            .accessibilityLabel("\(skill.enabled ? "Disable" : "Enable") skill \(skill.name)")
            .help(skill.isUsable ? "Skills apply to both providers' future sessions" : (skill.rejectionReason ?? "Skill is unusable"))
        }
        .padding(8)
        .background(selected ? ZeroTheme.navigation : .clear, in: RoundedRectangle(cornerRadius: 6))
    }

    private var detailPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("SKILL DETAIL + INJECTION PREVIEW", systemImage: "doc.text.magnifyingglass")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
            if let skill = selectedSkill {
                VStack(alignment: .leading, spacing: 6) {
                    Text(skill.name)
                        .font(.system(size: 16, weight: .bold))
                    HStack(spacing: 6) {
                        ZeroStatusBadge(skill.source.displayName.uppercased(), tone: .neutral)
                        ZeroStatusBadge(
                            skill.isUsable ? (skill.enabled ? "ENABLED" : "DISABLED") : "REJECTED",
                            symbol: skill.isUsable ? (skill.enabled ? "checkmark.circle" : "circle") : "xmark.circle",
                            tone: skill.isUsable ? (skill.enabled ? .healthy : .neutral) : .error
                        )
                    }
                    if let reason = skill.rejectionReason, !skill.isUsable {
                        Text(reason)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(ZeroTone.error.color)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    } else if !skill.summary.isEmpty {
                        Text(skill.summary)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(ZeroTheme.secondaryInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                ZeroSegmentedChoice("Preview provider", values: ProviderID.allCases, selection: $previewProvider) { provider in
                    Text(provider.displayName)
                        .font(.system(size: 11, weight: .semibold))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("INJECTION CONTRACT — SHOWN BEFORE USE")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                    Text(SkillStore.injectionContract(for: previewProvider))
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("SESSION CONTEXT PREVIEW (\(previewProvider.displayName))")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                    let preview = store.injectionContext(for: previewProvider)
                    Text(preview.isEmpty ? "Nothing would be injected: no enabled, usable skill exists." : preview)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            } else {
                Text("Select a skill to inspect its injection contract.")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }
        }
        .padding(14)
        .background(ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ZeroTheme.line))
    }
}
