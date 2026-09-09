import SwiftUI
import ZeroKit

enum DeskRuntimeLayout: Equatable {
    case compact
    case regular
    case wide

    static func mode(for width: CGFloat) -> Self {
        if width >= 1_020 { return .wide }
        if width >= 720 { return .regular }
        return .compact
    }

    var metricColumns: Int {
        switch self {
        case .wide: 4
        case .regular: 2
        case .compact: 1
        }
    }
}

struct DeskRuntimeFacts {
    let snapshot: CockpitSnapshot?
    let connection: RuntimeConnectionState
    let runtimeStatusLabel: String
    let runtimeStatusTone: ZeroTone
    let activeProjectName: String
    let focusElapsedLabel: String
    let deliveryState: DeliveryState
    let attentionCount: Int

    @MainActor
    init(model: CockpitModel) {
        snapshot = model.snapshot
        connection = model.runtimeConnection
        runtimeStatusLabel = model.runtimeStatusLabel
        runtimeStatusTone = model.runtimeStatusTone
        activeProjectName = model.activeProjectName
        focusElapsedLabel = model.focusElapsedLabel
        deliveryState = model.deliveryState
        attentionCount = model.attentionCount
    }

    init(
        snapshot: CockpitSnapshot?,
        connection: RuntimeConnectionState,
        runtimeStatusLabel: String,
        runtimeStatusTone: ZeroTone,
        activeProjectName: String,
        focusElapsedLabel: String,
        deliveryState: DeliveryState,
        attentionCount: Int
    ) {
        self.snapshot = snapshot
        self.connection = connection
        self.runtimeStatusLabel = runtimeStatusLabel
        self.runtimeStatusTone = runtimeStatusTone
        self.activeProjectName = activeProjectName
        self.focusElapsedLabel = focusElapsedLabel
        self.deliveryState = deliveryState
        self.attentionCount = attentionCount
    }

    var isLive: Bool { connection == .live && snapshot != nil }
    var sessionState: String { snapshot?.session.state ?? "UNAVAILABLE" }
    var runtimeVersion: String { snapshot?.runtimeVersion ?? "Unavailable" }
    var revisionLabel: String { snapshot.map { String($0.revision) } ?? "Unavailable" }
    var enabledIntegrationCount: Int { snapshot?.integrations.filter(\.enabled).count ?? 0 }
    var onlineNodeCount: Int { snapshot?.nodes.filter { !$0.revoked && $0.status == "ONLINE" }.count ?? 0 }
    var nodeCount: Int { snapshot?.nodes.filter { !$0.revoked }.count ?? 0 }
}

enum DeskEvidenceTab: String, CaseIterable, Hashable {
    case attention = "Attention"
    case delivery = "Delivery"
    case activity = "Recent evidence"
}

public struct DeskView: View {
    @ObservedObject private var model: CockpitModel
    @State private var evidenceTab: DeskEvidenceTab = .attention

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let layout = DeskRuntimeLayout.mode(for: proxy.size.width)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    hero(layout: layout)
                    evidenceShowcase(layout: layout)
                }
                .padding(layout == .compact ? 16 : 28)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Desk overview")
    }

    @ViewBuilder
    private func hero(layout: DeskRuntimeLayout) -> some View {
        let facts = DeskRuntimeFacts(model: model)
        if layout == .wide {
            HStack(alignment: .top, spacing: 28) {
                heroCopy(facts: facts).frame(maxWidth: .infinity, alignment: .leading)
                focusCard(facts: facts).frame(width: 380)
            }
        } else {
            VStack(alignment: .leading, spacing: 20) {
                heroCopy(facts: facts)
                focusCard(facts: facts)
            }
        }
    }

    private func heroCopy(facts: DeskRuntimeFacts) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("PROJECT ZERO", systemImage: "square.grid.2x2.fill")
                .font(.system(size: 11, weight: .black, design: .monospaced))
            VStack(alignment: .leading, spacing: 2) {
                Text("Make your runtime")
                Text("personally sovereign")
                    .padding(.horizontal, 5)
                    .background(Color(red: 0.73, green: 0.93, blue: 0.96))
                    .rotationEffect(.degrees(-0.6))
            }
            .font(.system(size: 42, weight: .black))
            .tracking(-1.5)
            .minimumScaleFactor(0.75)
            .fixedSize(horizontal: false, vertical: true)

            Text("One local cockpit for committed runtime state, explicit authority, and owner-started Codex work.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ZeroStatusBadge(
                    facts.runtimeStatusLabel,
                    symbol: facts.isLive ? "checkmark.circle.fill" : "wifi.slash",
                    tone: facts.runtimeStatusTone
                )
                Text(facts.isLive ? "Revision \(facts.revisionLabel)" : "Committed state unavailable")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }

            Text("THE MACHINE IS THE INTERFACE; THE EVIDENCE IS THE TRUTH.")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color(red: 0.98, green: 0.87, blue: 0.52).opacity(0.75))
        }
    }

    private func focusCard(facts: DeskRuntimeFacts) -> some View {
        DeskRuntimeCard(accent: ZeroTheme.orange) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Local focus")
                        .font(.system(size: 20, weight: .black))
                    Spacer()
                    ZeroStatusBadge(facts.sessionState, tone: sessionTone(facts.sessionState))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(facts.activeProjectName)
                        .font(.system(size: 17, weight: .bold))
                        .textSelection(.enabled)
                    Text(facts.focusElapsedLabel)
                        .font(.system(size: 32, weight: .black, design: .monospaced))
                        .monospacedDigit()
                    Text(facts.deliveryState.presentation.detail)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider().overlay(ZeroTheme.line)
                DeskRuntimeFocusControls(model: model, showProjects: facts.sessionState == "IDLE")
                DeskRuntimeCommandEvidence(model: model)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Current focus")
    }

    private func evidenceShowcase(layout: DeskRuntimeLayout) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                ZeroSegmentedChoice(
                    "Desk evidence",
                    values: DeskEvidenceTab.allCases,
                    selection: $evidenceTab
                ) { tab in
                    Text(tab.rawValue).fixedSize()
                }
            }
            .padding(.bottom, 8)

            Group {
                switch evidenceTab {
                case .attention: attentionEvidence(layout: layout)
                case .delivery: deliveryEvidence(layout: layout)
                case .activity: activityEvidence(layout: layout)
                }
            }
            .padding(layout == .compact ? 16 : 20)
            .frame(maxWidth: .infinity, minHeight: 250, alignment: .topLeading)
            .background(Color.white)
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.orange, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder
    private func attentionEvidence(layout: DeskRuntimeLayout) -> some View {
        if layout == .wide {
            HStack(alignment: .top, spacing: 22) {
                attentionRecord.frame(maxWidth: .infinity, alignment: .leading)
                evidenceExplanation(
                    title: "Authority stays explicit",
                    detail: "Review the exact pending target and evidence in Airlock before making a decision."
                )
                .frame(width: 330)
            }
        } else {
            VStack(alignment: .leading, spacing: 18) {
                attentionRecord
                evidenceExplanation(
                    title: "Authority stays explicit",
                    detail: "Review the exact pending target and evidence in Airlock before making a decision."
                )
            }
        }
    }

    @ViewBuilder
    private var attentionRecord: some View {
        if model.runtimeConnection != .live || model.snapshot == nil {
            DeskRuntimeEmptyState(
                symbol: "wifi.slash",
                title: "Attention evidence unavailable",
                detail: "The runtime is not live. No pending request is inferred from cached or missing state."
            )
        } else if let approval = model.snapshot?.approvals.first {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    ZeroStatusBadge("PENDING APPROVAL", symbol: "exclamationmark.shield.fill", tone: .error)
                    Spacer()
                    DeskRuntimeMonoValue(runtimeText(approval, keys: ["deadline"]) ?? "Deadline unavailable")
                }
                Text(runtimeText(approval, keys: ["capability"]) ?? "Capability unavailable")
                    .font(.system(size: 20, weight: .black))
                    .textSelection(.enabled)
                DeskRuntimeEvidenceRows(rows: [
                    ("Approval ID", runtimeText(approval, keys: ["id"]) ?? "Unavailable"),
                    ("Target node", runtimeText(approval, keys: ["node"]) ?? "Unavailable"),
                    ("Evidence hash", runtimeText(approval, keys: ["hash"]) ?? "Unavailable")
                ])
                Button("Review exact request in Airlock") { model.selection.route = .airlock }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
            }
        } else if let firing = model.snapshot?.firings.first(where: { runtimeText($0, keys: ["state"]) == "PENDING" }) {
            VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("PENDING FIRING", symbol: "bolt.badge.clock", tone: .attention)
                Text(runtimeText(firing, keys: ["name", "automation", "id"]) ?? "Automation requires attention")
                    .font(.system(size: 20, weight: .black))
                DeskRuntimeEvidenceRows(rows: safeEvidenceRows(firing, keys: ["id", "state", "scheduled_at", "project_id"]))
            }
        } else if model.codex.store.approvals.isEmpty {
            DeskRuntimeEmptyState(
                symbol: "checkmark.shield.fill",
                title: "No pending authority request",
                detail: "The current bounded runtime and connected Codex state contain no active approval."
            )
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("CODEX APPROVAL", symbol: "terminal.fill", tone: .attention)
                Text("\(model.codex.store.approvals.count) connected Codex request\(model.codex.store.approvals.count == 1 ? "" : "s") need review.")
                    .font(.system(size: 18, weight: .bold))
                Button("Open Zero Bot") { model.selection.route = .zeroBot }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
            }
        }
    }

    @ViewBuilder
    private func deliveryEvidence(layout: DeskRuntimeLayout) -> some View {
        let delivery = model.deliveryState.presentation
        let displayNodes = model.snapshot?.nodes.filter {
            !$0.revoked && ($0.capabilities.contains("display.render") || $0.capabilities.contains("display.clear"))
        } ?? []
        if layout == .wide {
            HStack(alignment: .top, spacing: 22) {
                deliveryDetails(delivery: delivery, displayNodes: displayNodes)
                    .frame(maxWidth: .infinity, alignment: .leading)
                evidenceExplanation(
                    title: "Delivery is not rendering",
                    detail: "A successful invocation can prove delivery. Only a matching render receipt may prove the frame appeared."
                )
                .frame(width: 330)
            }
        } else {
            VStack(alignment: .leading, spacing: 18) {
                deliveryDetails(delivery: delivery, displayNodes: displayNodes)
                evidenceExplanation(
                    title: "Delivery is not rendering",
                    detail: "A successful invocation can prove delivery. Only a matching render receipt may prove the frame appeared."
                )
            }
        }
    }

    private func deliveryDetails(
        delivery: (label: String, symbol: String, detail: String, tone: ZeroTone),
        displayNodes: [CockpitNode]
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ZeroStatusBadge(delivery.label, symbol: delivery.symbol, tone: delivery.tone)
            Text(delivery.detail)
                .font(.system(size: 18, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            if displayNodes.isEmpty {
                DeskRuntimeMonoValue("No registered display capability in the current snapshot")
            } else {
                ForEach(displayNodes) { node in
                    DeskRuntimeEvidenceRows(rows: [
                        ("Node", node.id),
                        ("Lifecycle", node.status),
                        ("Last seen", node.lastSeen ?? "Unavailable")
                    ])
                }
            }
        }
    }

    @ViewBuilder
    private func activityEvidence(layout: DeskRuntimeLayout) -> some View {
        if model.runtimeConnection != .live || model.snapshot == nil {
            DeskRuntimeEmptyState(
                symbol: "clock.badge.questionmark",
                title: "Recent evidence unavailable",
                detail: "Reconnect to load the runtime's bounded chronological projection."
            )
        } else if let event = model.snapshot?.events.first {
            let content = VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("DURABLE RUNTIME EVENT", symbol: "checkmark.seal.fill", tone: .healthy)
                Text(runtimeText(event, keys: ["kind"]) ?? "Event")
                    .font(.system(size: 20, weight: .black))
                DeskRuntimeEvidenceRows(rows: safeEvidenceRows(event, keys: ["seq", "id", "time", "kind"]))
            }
            if layout == .wide {
                HStack(alignment: .top, spacing: 22) {
                    content.frame(maxWidth: .infinity, alignment: .leading)
                    evidenceExplanation(
                        title: "Bounded, durable evidence",
                        detail: truncationNote(for: "events")
                    )
                    .frame(width: 330)
                }
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    content
                    evidenceExplanation(title: "Bounded, durable evidence", detail: truncationNote(for: "events"))
                }
            }
        } else {
            DeskRuntimeEmptyState(
                symbol: "tray",
                title: "No recent runtime events",
                detail: "The current bounded projection contains no event rows."
            )
        }
    }

    private func evidenceExplanation(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Project Zero evidence", systemImage: "shield.lefthalf.filled")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.orangePressed)
            Text(title).font(.system(size: 23, weight: .black))
            Text(detail)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(ZeroTheme.navigation.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
    }

    private func truncationNote(for collection: String) -> String {
        model.snapshot?.truncated[collection] == true
            ? "The runtime marked this projection as truncated. Open the dedicated evidence surface before drawing historical conclusions."
            : "This is the newest row in the runtime's bounded display projection."
    }
}

struct DeskRuntimeFocusControls: View {
    @ObservedObject var model: CockpitModel
    let showProjects: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showProjects {
                if let projects = model.snapshot?.projects, !projects.isEmpty {
                    Text("REGISTERED PROJECT")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 5) {
                            ForEach(projects) { project in
                                ZeroFilterChip(project.name, selected: model.selection.projectID == project.id) {
                                    model.selection.projectID = project.id
                                }
                                .help(project.path)
                            }
                        }
                    }
                    Button("Start focus") {
                        guard let projectID = model.selection.projectID else { return }
                        Task { await model.startFocus(projectID: projectID) }
                    }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .disabled(!canStart)
                    .help(canStart ? "Start a focus session for the selected project" : startDisabledReason)
                } else {
                    DeskRuntimeMonoValue(model.runtimeConnection == .live
                        ? "No registered project is available"
                        : "Projects unavailable while runtime is offline")
                }
            } else {
                HStack(spacing: 8) {
                    if model.snapshot?.session.state == "RUNNING" {
                        Button("Pause focus") { Task { await model.pauseFocus() } }
                            .buttonStyle(ZeroButtonStyle(.authority))
                            .focusEffectDisabled()
                            .disabled(!model.canPauseOrResume)
                    } else if model.snapshot?.session.state == "PAUSED" {
                        Button("Resume focus") { Task { await model.resumeFocus() } }
                            .buttonStyle(ZeroButtonStyle(.authority))
                            .focusEffectDisabled()
                            .disabled(!model.canPauseOrResume)
                    }
                    Button("End focus") { Task { await model.endFocus() } }
                        .buttonStyle(ZeroButtonStyle())
                        .focusEffectDisabled()
                        .disabled(!model.canEndFocus)
                }
            }
        }
    }

    private var canStart: Bool {
        guard model.canIssueRuntimeCommand,
              model.snapshot?.session.state == "IDLE",
              let selected = model.selection.projectID else { return false }
        return model.snapshot?.projects.contains(where: { $0.id == selected }) == true
    }

    private var startDisabledReason: String {
        if model.runtimeConnection != .live { return "Runtime must be live" }
        if model.selection.projectID == nil { return "Select a registered project" }
        if model.snapshot?.session.state != "IDLE" { return "A focus session is already active" }
        return "Action unavailable"
    }
}

struct DeskRuntimeCommandEvidence: View {
    @ObservedObject var model: CockpitModel

    var body: some View {
        switch model.commandState {
        case .idle:
            let delivery = model.deliveryState.presentation
            ZeroStatusBadge(delivery.label, symbol: delivery.symbol, tone: delivery.tone)
        case .submitting(_, let operation):
            ZeroStatusBadge("Submitting \(operation)", symbol: "arrow.triangle.2.circlepath", tone: .attention)
        case .uncertain(let id, let operation, let message):
            VStack(alignment: .leading, spacing: 8) {
                ZeroStatusBadge("CONFIRMATION UNCERTAIN", symbol: "questionmark.diamond.fill", tone: .error)
                DeskRuntimeMonoValue("\(operation) · \(id)")
                Text(message).font(.system(size: 11)).foregroundStyle(ZeroTheme.secondaryInk)
                Button("Retry same request") { Task { await model.retryPendingRuntimeCommand() } }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .disabled(model.runtimeConnection != .live)
            }
        case .blocked(let operation, let message), .rejected(let operation, let message):
            VStack(alignment: .leading, spacing: 5) {
                ZeroStatusBadge("\(operation) NOT SENT", symbol: "xmark.octagon.fill", tone: .error)
                Text(message).font(.system(size: 11)).foregroundStyle(ZeroTheme.secondaryInk)
            }
        }
    }
}

struct DeskRuntimeCard<Content: View>: View {
    let accent: Color?
    @ViewBuilder let content: Content

    init(accent: Color? = nil, @ViewBuilder content: () -> Content) {
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .top) {
                if let accent { accent.frame(height: 4).clipShape(UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10)) }
            }
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.line))
            .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 4)
    }
}

struct DeskRuntimeMetricCard: View {
    let label: String
    let value: String
    let detail: String
    let badge: String
    let tone: ZeroTone

    var body: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top) {
                    Text(label.uppercased())
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                    Spacer()
                    ZeroStatusBadge(badge, tone: tone)
                }
                Text(value)
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .minimumScaleFactor(0.72)
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct DeskRuntimeSectionHeader: View {
    let title: String
    let badge: String?

    init(_ title: String, badge: String? = nil) {
        self.title = title
        self.badge = badge
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(size: 15, weight: .black))
            Spacer()
            if let badge { DeskRuntimeMonoValue(badge) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(ZeroTheme.navigation.opacity(0.75))
    }
}

struct DeskRuntimeEmptyState: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(ZeroTheme.secondaryInk)
            Text(title).font(.system(size: 17, weight: .bold))
            Text(detail)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.navigation.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct DeskRuntimeMonoValue: View {
    let value: String

    init(_ value: String) { self.value = value }

    var body: some View {
        Text(value)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(ZeroTheme.secondaryInk)
            .textSelection(.enabled)
    }
}

struct DeskRuntimeEvidenceRows: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(alignment: .top, spacing: 12) {
                    Text(row.0.uppercased())
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .frame(width: 100, alignment: .leading)
                    Text(row.1)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 7)
                if index < rows.count - 1 { Divider().overlay(ZeroTheme.line.opacity(0.7)) }
            }
        }
        .padding(.horizontal, 10)
        .background(Color(red: 0.95, green: 0.95, blue: 0.97), in: RoundedRectangle(cornerRadius: 6))
    }
}

func sessionTone(_ state: String) -> ZeroTone {
    switch state {
    case "RUNNING": .healthy
    case "PAUSED": .attention
    case "IDLE": .neutral
    default: .error
    }
}

func runtimeText(_ record: RuntimeRecord, keys: [String]) -> String? {
    for key in keys {
        let value = record[key]
        switch value {
        case .string(let text) where !text.isEmpty: return text
        case .integer(let number): return String(number)
        case .number(let number): return String(number)
        case .bool(let flag): return flag ? "true" : "false"
        default: continue
        }
    }
    return nil
}

func safeEvidenceRows(_ record: RuntimeRecord, keys: [String]) -> [(String, String)] {
    keys.compactMap { key in runtimeText(record, keys: [key]).map { (key.replacingOccurrences(of: "_", with: " "), $0) } }
}
