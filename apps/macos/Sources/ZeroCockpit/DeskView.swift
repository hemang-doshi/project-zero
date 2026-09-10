import SwiftUI
import ZeroKit

enum DeskRuntimeLayout: Equatable {
    case compact
    case regular
    case wide

    static func mode(for width: CGFloat, accessibilitySize: Bool = false) -> Self {
        if accessibilitySize { return .compact }
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
    private let reportedActiveProjectName: String
    private let reportedFocusElapsedLabel: String
    private let reportedDeliveryState: DeliveryState
    private let reportedAttentionCount: Int
    let codexApprovalCount: Int
    let hasUncertainCommand: Bool

    @MainActor
    init(model: CockpitModel) {
        let codex = DeskCodexFacts(state: model.codexConnection, store: model.codex.store)
        snapshot = model.snapshot
        connection = model.runtimeConnection
        runtimeStatusLabel = model.runtimeStatusLabel
        runtimeStatusTone = model.runtimeStatusTone
        reportedActiveProjectName = model.activeProjectName
        reportedFocusElapsedLabel = model.focusElapsedLabel
        reportedDeliveryState = model.deliveryState
        // CockpitModel intentionally retains the bridge store across natural exits.
        // Replace its raw retained approval count with this transport-gated count
        // before presenting a current attention total.
        reportedAttentionCount = max(0, model.attentionCount - model.codex.store.approvals.count + codex.approvalCount)
        codexApprovalCount = codex.approvalCount
        hasUncertainCommand = model.hasUncertainRuntimeCommand
    }

    init(
        snapshot: CockpitSnapshot?,
        connection: RuntimeConnectionState,
        runtimeStatusLabel: String,
        runtimeStatusTone: ZeroTone,
        activeProjectName: String,
        focusElapsedLabel: String,
        deliveryState: DeliveryState,
        attentionCount: Int,
        codexApprovalCount: Int = 0,
        hasUncertainCommand: Bool = false
    ) {
        self.snapshot = snapshot
        self.connection = connection
        self.runtimeStatusLabel = runtimeStatusLabel
        self.runtimeStatusTone = runtimeStatusTone
        reportedActiveProjectName = activeProjectName
        reportedFocusElapsedLabel = focusElapsedLabel
        reportedDeliveryState = deliveryState
        reportedAttentionCount = attentionCount
        self.codexApprovalCount = codexApprovalCount
        self.hasUncertainCommand = hasUncertainCommand
    }

    var isLive: Bool { connection == .live && snapshot != nil }
    var hasCachedSnapshot: Bool { !isLive && snapshot != nil }
    var authoritativeSnapshot: CockpitSnapshot? { isLive ? snapshot : nil }
    var sessionState: String { authoritativeSnapshot?.session.state ?? "UNAVAILABLE" }
    var activeProjectName: String { isLive ? reportedActiveProjectName : "Unavailable" }
    var focusElapsedLabel: String { isLive ? reportedFocusElapsedLabel : "Unavailable" }
    var deliveryState: DeliveryState { isLive ? reportedDeliveryState : .offline }
    var runtimeVersion: String { authoritativeSnapshot?.runtimeVersion ?? "Unavailable" }
    var revisionLabel: String { authoritativeSnapshot.map { String($0.revision) } ?? "Unavailable" }
    var enabledIntegrationCount: Int { authoritativeSnapshot?.integrations.filter(\.enabled).count ?? 0 }
    var onlineNodeCount: Int { authoritativeSnapshot?.nodes.filter { !$0.revoked && $0.status == "ONLINE" }.count ?? 0 }
    var nodeCount: Int { authoritativeSnapshot?.nodes.filter { !$0.revoked }.count ?? 0 }
    var policyCount: Int { authoritativeSnapshot?.policies.count ?? 0 }
    var contextCount: Int { authoritativeSnapshot?.context.count ?? 0 }
    var firingStateCounts: [String: Int] {
        guard let firings = authoritativeSnapshot?.firings else { return [:] }
        return firings.reduce(into: [:]) { counts, firing in
            let state = runtimeText(firing, keys: ["state"])?.uppercased() ?? "UNKNOWN"
            counts[state, default: 0] += 1
        }
    }
    var activeFirings: [RuntimeRecord] {
        guard let firings = authoritativeSnapshot?.firings else { return [] }
        return firings.filter(Self.firingRequiresActiveMission)
    }
    var activeFiringCount: Int { activeFirings.count }
    var runtimeWorkTotal: Int {
        guard let snapshot = authoritativeSnapshot else { return 0 }
        return snapshot.approvals.count + activeFiringCount + (snapshot.session.state == "IDLE" ? 0 : 1)
    }
    var runtimeWorkLabel: String {
        guard let snapshot = authoritativeSnapshot else { return "OFFLINE" }
        let lowerBound = snapshot.truncated["approvals"] == true || snapshot.truncated["firings"] == true
        return "\(runtimeWorkTotal)\(lowerBound ? "+" : "")"
    }
    var attentionCount: Int {
        isLive ? reportedAttentionCount : codexApprovalCount + (hasUncertainCommand ? 1 : 0)
    }
    var attentionLabel: String {
        let lowerBound = authoritativeSnapshot?.truncated["approvals"] == true
            || authoritativeSnapshot?.truncated["firings"] == true
        return "\(attentionCount)\(lowerBound ? "+" : "")"
    }
    var attentionSource: DeskAttentionSource {
        if let snapshot = authoritativeSnapshot {
            if !snapshot.approvals.isEmpty { return .runtimeApproval }
            if snapshot.firings.contains(where: { runtimeText($0, keys: ["state"])?.uppercased() == "PENDING" }) {
                return .runtimeFiring
            }
        }
        if codexApprovalCount > 0 { return .codexApproval }
        return isLive ? .clear : .runtimeUnavailable
    }
    var cachedSnapshotLabel: String? {
        guard hasCachedSnapshot, let timestamp = snapshot?.timestamp else { return nil }
        return "Cached at \(timestamp) · not current authority"
    }

    private static func firingRequiresActiveMission(_ firing: RuntimeRecord) -> Bool {
        // These are the only non-terminal firing states currently emitted by zerod.
        // Unknown or future states stay visible in firing history but are not promoted
        // to active authority without an explicit contract update.
        switch runtimeText(firing, keys: ["state"])?.uppercased() {
        case "PENDING", "DELIVERING": true
        default: false
        }
    }
}

enum DeskAttentionSource: Equatable {
    case runtimeApproval, runtimeFiring, codexApproval, runtimeUnavailable, clear
}

struct DeskCodexFacts: Equatable {
    let connectionLabel: String
    let isConnected: Bool
    let threadCount: Int
    let activeTurnCount: Int
    let activeItemCount: Int
    let approvalCount: Int
    let retainedActiveTurnCount: Int
    let retainedActiveItemCount: Int
    let retainedApprovalCount: Int

    init(state: CodexConnectionState, store: CodexEventStore) {
        threadCount = store.threads.count
        retainedActiveTurnCount = store.threads.values.reduce(0) { count, thread in
            count + thread.turns.values.filter { Self.isActive($0.status) }.count
        }
        retainedActiveItemCount = store.threads.values.reduce(0) { count, thread in
            count + thread.items.filter { Self.isActive($0.status) }.count
        }
        retainedApprovalCount = store.approvals.count
        switch state {
        case .disconnected:
            connectionLabel = "Codex disconnected"
            isConnected = false
        case .connecting:
            connectionLabel = "Codex connecting"
            isConnected = false
        case .connected:
            connectionLabel = "Codex connected"
            isConnected = true
        case .exited(let code):
            connectionLabel = "Codex exited (\(code))"
            isConnected = false
        case .failed:
            connectionLabel = "Codex failed"
            isConnected = false
        }
        activeTurnCount = isConnected ? retainedActiveTurnCount : 0
        activeItemCount = isConnected ? retainedActiveItemCount : 0
        approvalCount = isConnected ? retainedApprovalCount : 0
    }

    var hasRetainedEvidence: Bool {
        !isConnected && (threadCount > 0 || retainedActiveTurnCount > 0 || retainedActiveItemCount > 0 || retainedApprovalCount > 0)
    }

    var workLabel: String {
        if hasRetainedEvidence {
            var evidence = ["\(threadCount) retained thread\(threadCount == 1 ? "" : "s")"]
            if retainedActiveTurnCount > 0 {
                evidence.append("\(retainedActiveTurnCount) retained turn\(retainedActiveTurnCount == 1 ? "" : "s")")
            }
            if retainedActiveItemCount > 0 {
                evidence.append("\(retainedActiveItemCount) retained item\(retainedActiveItemCount == 1 ? "" : "s")")
            }
            if retainedApprovalCount > 0 {
                evidence.append("\(retainedApprovalCount) retained approval\(retainedApprovalCount == 1 ? "" : "s")")
            }
            return "Retained while Codex is unavailable · \(evidence.joined(separator: " · ")) · not actionable"
        }
        if !isConnected { return "No retained Project Zero-owned Codex evidence" }
        if activeTurnCount > 0 || activeItemCount > 0 {
            return "\(activeTurnCount) active turn\(activeTurnCount == 1 ? "" : "s") · \(activeItemCount) streaming item\(activeItemCount == 1 ? "" : "s")"
        }
        return threadCount == 0 ? "No Project Zero-owned Codex threads" : "\(threadCount) thread\(threadCount == 1 ? "" : "s") · no active turn"
    }

    private static func isActive(_ status: String) -> Bool {
        let normalized = status.lowercased().filter(\.isLetter)
        return normalized == "inprogress" || normalized == "running" || normalized == "streaming"
    }
}

enum DeskTypeScale {
    static let bodyPointSize: CGFloat = 15
    static let headerPointSize: CGFloat = 24
    static let bodyFontName = ZeroType.bodyFontName
}

enum DeskRuntimeType {
    static let hero = Font.system(.largeTitle, design: .default).weight(.black)
    static let title = Font.system(size: 24, weight: .black, design: .default)
    static let heading = Font.system(.headline, design: .default).weight(.black)
    static let body = Font.system(size: 15, weight: .medium, design: .default)
    static let callout = Font.system(.callout, design: .default).weight(.medium)
    static let caption = Font.system(.caption, design: .default).weight(.medium)
    static let micro = Font.system(.caption2, design: .monospaced).weight(.bold)
    static let evidence = Font.system(.caption, design: .monospaced).weight(.medium)
}

enum DeskEvidenceTab: String, CaseIterable, Hashable {
    case attention = "Attention"
    case delivery = "Delivery"
    case activity = "Recent evidence"
}

public struct DeskView: View {
    @ObservedObject private var model: CockpitModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var evidenceTab: DeskEvidenceTab = .attention

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let layout = DeskRuntimeLayout.mode(for: proxy.size.width, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
            // One facts build per evaluation: every helper below takes this
            // value instead of rebuilding from the model. The evaluation is
            // synchronous on the main actor, so the value cannot go stale
            // mid-evaluation; the next model change re-evaluates and rebuilds.
            let facts = DeskRuntimeFacts(model: model)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    hero(facts: facts, layout: layout)
                    evidenceShowcase(facts: facts, layout: layout)
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
    private func hero(facts: DeskRuntimeFacts, layout: DeskRuntimeLayout) -> some View {
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
                .font(DeskRuntimeType.micro)
            VStack(alignment: .leading, spacing: 2) {
                Text("Make your runtime")
                Text("completely")
                Text("self-governing")
                    .padding(.horizontal, 5)
                    .background(ZeroTheme.highlightBlue)
                    .rotationEffect(.degrees(-0.6))
            }
            .font(DeskRuntimeType.hero)
            .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 4) {
                Text("One local cockpit for committed runtime state, explicit authority, and owner-started Codex work.")
                Text("Zero cognitive friction; no invented evidence.")
                    .padding(.horizontal, 4)
                    .background(ZeroTheme.markerYellow.opacity(0.75))
            }
            .font(DeskRuntimeType.body)
            .foregroundStyle(ZeroTheme.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ZeroStatusBadge(
                    facts.runtimeStatusLabel,
                    symbol: facts.isLive ? "checkmark.circle.fill" : "wifi.slash",
                    tone: facts.runtimeStatusTone
                ).equatable()
                Text(facts.isLive ? "Revision \(facts.revisionLabel)" : "Committed state unavailable")
                    .font(DeskRuntimeType.evidence)
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }

            if let cached = facts.cachedSnapshotLabel {
                Label(cached, systemImage: "archivebox")
                    .font(DeskRuntimeType.evidence)
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .accessibilityLabel("Cached runtime evidence. \(cached)")
            }

            Text("THE MACHINE IS THE INTERFACE; THE EVIDENCE IS THE TRUTH.")
                .font(DeskRuntimeType.micro)
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
                        .font(DeskRuntimeType.title)
                    Spacer()
                    ZeroStatusBadge(facts.sessionState, tone: sessionTone(facts.sessionState)).equatable()
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(facts.activeProjectName)
                        .font(DeskRuntimeType.heading)
                        .textSelection(.enabled)
                    FocusElapsedText(model: model)
                        .font(.system(.title, design: .monospaced).weight(.black))
                        .monospacedDigit()
                    Text(facts.deliveryState.presentation.detail)
                        .font(DeskRuntimeType.caption)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider().overlay(ZeroTheme.line)
                DeskRuntimeFocusControls(model: model, showProjects: facts.sessionState == "IDLE")
                DeskRuntimeCommandEvidence(model: model)
                Divider().overlay(ZeroTheme.line)
                codexSummary
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Current focus")
    }

    private var codexSummary: some View {
        let codex = DeskCodexFacts(state: model.codexConnection, store: model.codex.store)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PROJECT ZERO CODEX")
                    .font(DeskRuntimeType.micro)
                    .foregroundStyle(ZeroTheme.secondaryInk)
                Spacer()
                ZeroStatusBadge(
                    codex.connectionLabel,
                    symbol: codex.isConnected ? "terminal.fill" : "terminal",
                    tone: codex.isConnected ? .healthy : .neutral
                ).equatable()
            }
            Text(codex.workLabel)
                .font(DeskRuntimeType.callout)
                .textSelection(.enabled)
            if codex.approvalCount > 0 {
                Text("\(codex.approvalCount) Codex approval request\(codex.approvalCount == 1 ? "" : "s") waiting")
                    .font(DeskRuntimeType.caption)
                    .foregroundStyle(ZeroTone.attention.color)
            } else if codex.retainedApprovalCount > 0 {
                Text("\(codex.retainedApprovalCount) retained Codex approval record\(codex.retainedApprovalCount == 1 ? "" : "s") · Codex unavailable, not actionable")
                    .font(DeskRuntimeType.caption)
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }
            Button("Open Zero Bot") { model.selection.route = .zeroBot }
                .buttonStyle(ZeroButtonStyle(.quiet))
                .focusEffectDisabled()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Codex work, \(codex.connectionLabel), \(codex.workLabel), \(codex.approvalCount) actionable approvals, \(codex.retainedApprovalCount) retained approval records")
    }

    private func evidenceShowcase(facts: DeskRuntimeFacts, layout: DeskRuntimeLayout) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(DeskEvidenceTab.allCases, id: \.self) { tab in
                        Button { evidenceTab = tab } label: {
                            Text(tab.rawValue).fixedSize()
                        }
                        .buttonStyle(ZeroButtonStyle(evidenceTab == tab ? .authority : .quiet, selected: evidenceTab == tab))
                        .focusEffectDisabled()
                        .accessibilityAddTraits(evidenceTab == tab ? .isSelected : [])
                        .accessibilityValue(evidenceTab == tab ? "Selected" : "Not selected")
                    }
                }
                .padding(3)
                .background(ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 7))
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Desk evidence")
            }
            .padding(.bottom, 8)

            Group {
                switch evidenceTab {
                case .attention: attentionEvidence(facts: facts, layout: layout)
                case .delivery: deliveryEvidence(facts: facts, layout: layout)
                case .activity: activityEvidence(facts: facts, layout: layout)
                }
            }
            .padding(layout == .compact ? 16 : 20)
            .frame(maxWidth: .infinity, minHeight: 250, alignment: .topLeading)
            .background(Color.white)
            .overlay(alignment: .top) { ZeroTheme.brandOrange.frame(height: 2).clipShape(UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10)) }
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder
    private func attentionEvidence(facts: DeskRuntimeFacts, layout: DeskRuntimeLayout) -> some View {
        let explanation = attentionExplanation(facts: facts)
        if layout == .wide {
            HStack(alignment: .top, spacing: 22) {
                attentionRecord(facts: facts).frame(maxWidth: .infinity, alignment: .leading)
                evidenceExplanation(
                    title: explanation.title,
                    detail: explanation.detail
                )
                .frame(width: 330)
            }
        } else {
            VStack(alignment: .leading, spacing: 18) {
                attentionRecord(facts: facts)
                evidenceExplanation(
                    title: explanation.title,
                    detail: explanation.detail
                )
            }
        }
    }

    private func attentionExplanation(facts: DeskRuntimeFacts) -> (title: String, detail: String) {
        switch facts.attentionSource {
        case .codexApproval:
            return ("Codex authority stays separate", "Review the exact Project Zero-owned Codex request in Zero Bot; it never crosses the zerod approval path.")
        case .runtimeApproval, .runtimeFiring:
            return ("Authority stays explicit", "Review the exact pending target and runtime evidence in Airlock before making a decision.")
        case .runtimeUnavailable:
            return ("Cached is not current", "Reconnect before interpreting runtime attention. Any independent live Codex request remains visible here.")
        case .clear:
            return ("No inferred request", "The live bounded sources contain no pending authority request; absence outside those bounds is not claimed.")
        }
    }

    @ViewBuilder
    private func attentionRecord(facts: DeskRuntimeFacts) -> some View {
        switch facts.attentionSource {
        case .runtimeApproval:
            if let approval = facts.authoritativeSnapshot?.approvals.first {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    ZeroStatusBadge("PENDING APPROVAL", symbol: "exclamationmark.shield.fill", tone: .error)
                    Spacer()
                    DeskRuntimeMonoValue(runtimeText(approval, keys: ["deadline"]) ?? "Deadline unavailable")
                }
                Text(runtimeText(approval, keys: ["capability"]) ?? "Capability unavailable")
                    .font(DeskRuntimeType.title)
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
            }
        case .runtimeFiring:
            if let firing = facts.authoritativeSnapshot?.firings.first(where: { runtimeText($0, keys: ["state"])?.uppercased() == "PENDING" }) {
            VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("PENDING FIRING", symbol: "bolt.badge.clock", tone: .attention)
                Text(runtimeText(firing, keys: ["name", "automation", "id"]) ?? "Automation requires attention")
                    .font(DeskRuntimeType.title)
                DeskRuntimeEvidenceRows(rows: safeEvidenceRows(firing, keys: ["id", "state", "scheduled_at", "project_id"]))
            }
            }
        case .codexApproval:
            VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("CODEX APPROVAL", symbol: "terminal.fill", tone: .attention)
                Text("\(facts.codexApprovalCount) connected Codex request\(facts.codexApprovalCount == 1 ? "" : "s") need review.")
                    .font(DeskRuntimeType.heading)
                Text(facts.isLive
                    ? "Codex authority is independent from the runtime approval queue."
                    : "The runtime is offline; this live Codex request still requires an explicit response in Zero Bot.")
                    .font(DeskRuntimeType.caption)
                    .foregroundStyle(ZeroTheme.secondaryInk)
                Button("Open Zero Bot") { model.selection.route = .zeroBot }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
            }
        case .runtimeUnavailable:
            DeskRuntimeEmptyState(
                symbol: "wifi.slash",
                title: "Runtime attention unavailable",
                detail: facts.hasCachedSnapshot
                    ? "A retained snapshot exists, but it is cached and is not used to infer current pending work."
                    : "The runtime is not live. No pending request is inferred from missing state."
            )
        case .clear:
            DeskRuntimeEmptyState(
                symbol: "checkmark.shield.fill",
                title: "No pending authority request",
                detail: "The current bounded runtime and connected Codex state contain no active approval."
            )
        }
    }

    @ViewBuilder
    private func deliveryEvidence(facts: DeskRuntimeFacts, layout: DeskRuntimeLayout) -> some View {
        let delivery = facts.deliveryState.presentation
        let displayNodes = facts.authoritativeSnapshot?.nodes.filter {
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
                .font(DeskRuntimeType.heading)
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
    private func activityEvidence(facts: DeskRuntimeFacts, layout: DeskRuntimeLayout) -> some View {
        if !facts.isLive {
            DeskRuntimeEmptyState(
                symbol: "clock.badge.questionmark",
                title: "Recent evidence unavailable",
                detail: "Reconnect to load the runtime's bounded chronological projection."
            )
        } else if let event = facts.authoritativeSnapshot?.events.first {
            let content = VStack(alignment: .leading, spacing: 12) {
                ZeroStatusBadge("DURABLE RUNTIME EVENT", symbol: "checkmark.seal.fill", tone: .healthy)
                Text(runtimeText(event, keys: ["kind"]) ?? "Event")
                    .font(DeskRuntimeType.title)
                DeskRuntimeEvidenceRows(rows: safeEvidenceRows(event, keys: ["seq", "id", "time", "kind"]))
            }
            if layout == .wide {
                HStack(alignment: .top, spacing: 22) {
                    content.frame(maxWidth: .infinity, alignment: .leading)
                    evidenceExplanation(
                        title: "Bounded, durable evidence",
                        detail: truncationNote(facts: facts, for: "events")
                    )
                    .frame(width: 330)
                }
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    content
                    evidenceExplanation(title: "Bounded, durable evidence", detail: truncationNote(facts: facts, for: "events"))
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
                .font(DeskRuntimeType.micro)
                .foregroundStyle(ZeroTheme.orangePressed)
            Text(title).font(DeskRuntimeType.title)
            Text(detail)
                .font(DeskRuntimeType.callout)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(ZeroTheme.navigation.opacity(0.75), in: RoundedRectangle(cornerRadius: 8))
    }

    private func truncationNote(facts: DeskRuntimeFacts, for collection: String) -> String {
        facts.authoritativeSnapshot?.truncated[collection] == true
            ? "The runtime marked this projection as truncated. Open the dedicated evidence surface before drawing historical conclusions."
            : "This is the newest row in the runtime's bounded display projection."
    }
}

struct DeskRuntimeFocusControls: View {
    @ObservedObject var model: CockpitModel
    let showProjects: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.runtimeConnection != .live || model.snapshot == nil {
                DeskRuntimeMonoValue(model.snapshot == nil
                    ? "Focus controls unavailable while runtime is offline"
                    : "Cached focus state is non-authoritative; reconnect to act")
            } else if showProjects {
                if let projects = model.snapshot?.projects, !projects.isEmpty {
                    Text("REGISTERED PROJECT")
                        .font(DeskRuntimeType.micro)
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
                Text(message).font(DeskRuntimeType.caption).foregroundStyle(ZeroTheme.secondaryInk)
                Button("Retry same request") { Task { await model.retryPendingRuntimeCommand() } }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .disabled(model.runtimeConnection != .live)
            }
        case .blocked(let operation, let message), .rejected(let operation, let message):
            VStack(alignment: .leading, spacing: 5) {
                ZeroStatusBadge("\(operation) NOT SENT", symbol: "xmark.octagon.fill", tone: .error)
                Text(message).font(DeskRuntimeType.caption).foregroundStyle(ZeroTheme.secondaryInk)
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

/// Narrow clock-reading leaf: the only Desk subtree that re-evaluates on the
/// 1Hz tick. The rest of DeskView subscribes to the model, which no longer
/// publishes per second.
struct FocusElapsedText: View {
    @ObservedObject var model: CockpitModel
    @ObservedObject var tick: CockpitClockSource

    init(model: CockpitModel) {
        self.model = model
        _tick = ObservedObject(wrappedValue: model.clockSource)
    }

    var body: some View {
        Text(model.focusElapsedLabel(at: tick.now))
    }
}

struct DeskRuntimeMetricCard: View, Equatable {
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
                        .font(DeskRuntimeType.micro)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                    Spacer()
                    ZeroStatusBadge(badge, tone: tone).equatable()
                }
                Text(value)
                    .font(.system(.title2, design: .rounded).weight(.black))
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(DeskRuntimeType.caption)
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct DeskRuntimeSectionHeader: View, Equatable {
    let title: String
    let badge: String?

    init(_ title: String, badge: String? = nil) {
        self.title = title
        self.badge = badge
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(DeskRuntimeType.heading)
                Spacer()
                if let badge { DeskRuntimeMonoValue(badge) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(DeskRuntimeType.heading)
                if let badge { DeskRuntimeMonoValue(badge) }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(ZeroTheme.navigation.opacity(0.75))
    }
}

struct DeskRuntimeEmptyState: View, Equatable {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(ZeroTheme.secondaryInk)
            Text(title).font(DeskRuntimeType.heading)
            Text(detail)
                .font(DeskRuntimeType.caption)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.navigation.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct DeskRuntimeMonoValue: View, Equatable {
    let value: String

    init(_ value: String) { self.value = value }

    var body: some View {
        Text(value)
            .font(DeskRuntimeType.evidence)
            .foregroundStyle(ZeroTheme.secondaryInk)
            .textSelection(.enabled)
    }
}

struct DeskRuntimeEvidenceRows: View, Equatable {
    let rows: [(String, String)]

    static func == (lhs: DeskRuntimeEvidenceRows, rhs: DeskRuntimeEvidenceRows) -> Bool {
        guard lhs.rows.count == rhs.rows.count else { return false }
        return zip(lhs.rows, rhs.rows).allSatisfy { $0 == $1 }
    }

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(rows.prefix(100).enumerated()), id: \.offset) { index, row in
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 12) {
                        evidenceLabel(row.0)
                            .frame(minWidth: 100, idealWidth: 116, maxWidth: 150, alignment: .leading)
                        evidenceValue(row.1)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        evidenceLabel(row.0)
                        evidenceValue(row.1)
                    }
                }
                .padding(.vertical, 7)
                if index < rows.count - 1 { Divider().overlay(ZeroTheme.line.opacity(0.7)) }
            }
        }
        .padding(.horizontal, 10)
        .background(ZeroTheme.cardCream, in: RoundedRectangle(cornerRadius: 6))
    }

    private func evidenceLabel(_ value: String) -> some View {
        Text(value.uppercased())
            .font(DeskRuntimeType.micro)
            .foregroundStyle(ZeroTheme.secondaryInk)
    }

    private func evidenceValue(_ value: String) -> some View {
        Text(value)
            .font(DeskRuntimeType.evidence)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
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
