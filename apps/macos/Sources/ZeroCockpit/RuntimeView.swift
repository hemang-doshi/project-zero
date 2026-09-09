import SwiftUI
import ZeroKit

public struct RuntimeView: View {
    @ObservedObject private var model: CockpitModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let layout = DeskRuntimeLayout.mode(for: proxy.size.width, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    daemonStrip
                    runtimeHero(layout: layout)
                    focusDispatch
                    metrics(layout: layout)
                    dashboard(layout: layout)
                }
                .padding(layout == .compact ? 14 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Runtime dashboard")
    }

    private var facts: DeskRuntimeFacts { DeskRuntimeFacts(model: model) }

    private var daemonStrip: some View {
        HStack(spacing: 10) {
            ZeroStatusBadge(
                facts.runtimeStatusLabel,
                symbol: facts.isLive ? "checkmark.circle.fill" : "wifi.slash",
                tone: facts.runtimeStatusTone
            )
            Spacer(minLength: 8)
            DeskRuntimeMonoValue("runtime \(facts.runtimeVersion)")
            DeskRuntimeMonoValue("rev \(facts.revisionLabel)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ZeroTheme.line))
    }

    @ViewBuilder
    private func runtimeHero(layout: DeskRuntimeLayout) -> some View {
        let title = VStack(alignment: .leading, spacing: 7) {
            ViewThatFits(in: .horizontal) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) {
                        Text("Local Personal Runtime:")
                        Text("Authoritative")
                            .padding(.horizontal, 5)
                            .background(Color(red: 0.96, green: 0.67, blue: 0.18).opacity(0.82))
                            .rotationEffect(.degrees(-0.8))
                    }
                    Text("& Operational")
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Local Personal Runtime:")
                    Text("Authoritative")
                        .padding(.horizontal, 5)
                        .background(Color(red: 0.96, green: 0.67, blue: 0.18).opacity(0.82))
                        .rotationEffect(.degrees(-0.8))
                    Text("& Operational")
                }
            }
            .font(layout == .compact
                ? .system(.title2, design: .default).weight(.black)
                : DeskRuntimeType.hero)
            .fixedSize(horizontal: false, vertical: true)
            if !facts.isLive {
                Label(
                    facts.hasCachedSnapshot ? "Runtime offline · retained evidence is cached" : "Runtime offline · evidence unavailable",
                    systemImage: facts.hasCachedSnapshot ? "archivebox" : "wifi.slash"
                )
                .font(DeskRuntimeType.evidence)
                .foregroundStyle(ZeroTone.error.color)
            }
            Text(facts.isLive
                ? "Committed state is streaming from the owner-local daemon. Actions remain exact, bounded, and owner initiated."
                : "The owner-local daemon is not currently providing an authoritative snapshot. No operational fact is inferred.")
                .font(DeskRuntimeType.callout)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }

        if layout == .wide {
            HStack(alignment: .bottom, spacing: 20) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                ZeroStatusBadge(
                    facts.isLive ? "OWNER-LOCAL" : "OFFLINE",
                    symbol: "lock.shield.fill",
                    tone: facts.isLive ? .healthy : .error
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                title
                ZeroStatusBadge(
                    facts.isLive ? "OWNER-LOCAL" : "OFFLINE",
                    symbol: "lock.shield.fill",
                    tone: facts.isLive ? .healthy : .error
                )
            }
        }
    }

    private var focusDispatch: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("FOCUS COMMAND SURFACE", systemImage: "bolt.fill")
                        .font(DeskRuntimeType.micro)
                    Spacer()
                    ZeroStatusBadge(facts.sessionState, tone: sessionTone(facts.sessionState))
                }
                Text(facts.activeProjectName)
                    .font(DeskRuntimeType.title)
                    .textSelection(.enabled)
                DeskRuntimeFocusControls(model: model, showProjects: facts.sessionState == "IDLE")
                DeskRuntimeCommandEvidence(model: model)
            }
        }
    }

    private func metrics(layout: DeskRuntimeLayout) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: layout.metricColumns)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            DeskRuntimeMetricCard(
                label: "Focus state",
                value: facts.focusElapsedLabel,
                detail: facts.activeProjectName,
                badge: facts.sessionState,
                tone: sessionTone(facts.sessionState)
            )
            DeskRuntimeMetricCard(
                label: "Integrations",
                value: facts.isLive ? "\(facts.enabledIntegrationCount) enabled" : "Unavailable",
                detail: integrationDetail,
                badge: facts.isLive ? "LOCAL DATA" : "OFFLINE",
                tone: facts.isLive ? .healthy : .error
            )
            DeskRuntimeMetricCard(
                label: "Registered nodes",
                value: facts.isLive ? "\(facts.onlineNodeCount) / \(facts.nodeCount) online" : "Unavailable",
                detail: nodeDetail,
                badge: facts.deliveryState.presentation.label.uppercased(),
                tone: facts.deliveryState.presentation.tone
            )
            DeskRuntimeMetricCard(
                label: "Attention",
                value: facts.isLive ? facts.attentionLabel : "Unavailable",
                detail: attentionDetail,
                badge: facts.attentionCount == 0 && facts.isLive ? "CLEAR" : "REVIEW",
                tone: !facts.isLive ? .error : (facts.attentionCount == 0 ? .healthy : .attention)
            )
        }
    }

    @ViewBuilder
    private func dashboard(layout: DeskRuntimeLayout) -> some View {
        if layout == .wide {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 14) {
                    missions
                    automationFirings
                    activity
                }
                .frame(maxWidth: .infinity, alignment: .top)

                VStack(spacing: 14) {
                    observation
                    topology
                    policies
                    contextSummary
                    telemetry
                }
                .frame(width: 360, alignment: .top)
            }
        } else {
            VStack(spacing: 14) {
                missions
                automationFirings
                observation
                activity
                topology
                policies
                contextSummary
                telemetry
            }
        }
    }

    private var missions: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 0) {
                DeskRuntimeSectionHeader(
                    "Missions Requiring Attention & Active Goals",
                    badge: facts.isLive ? "\(facts.runtimeWorkLabel) TOTAL" : "OFFLINE"
                )
                if !facts.isLive {
                    DeskRuntimeEmptyState(
                        symbol: "wifi.slash",
                        title: "Runtime work unavailable",
                        detail: "Reconnect before interpreting active goals or approval state."
                    )
                    .padding(.top, 12)
                } else if facts.runtimeWorkTotal == 0 {
                    DeskRuntimeEmptyState(
                        symbol: "checkmark.circle.fill",
                        title: "No active work in this projection",
                        detail: "There are no pending approvals, pending firings, or active focus sessions in the bounded snapshot."
                    )
                    .padding(.top, 12)
                } else {
                    VStack(spacing: 9) {
                        ForEach(Array((facts.authoritativeSnapshot?.approvals.prefix(2) ?? []).enumerated()), id: \.offset) { _, record in
                            workRow(
                                status: "NEEDS INPUT",
                                title: runtimeText(record, keys: ["capability"]) ?? "Approval",
                                rows: safeEvidenceRows(record, keys: ["id", "node", "deadline", "hash"]),
                                tone: .error
                            )
                        }
                        if let count = facts.authoritativeSnapshot?.approvals.count, count > 2 {
                            DeskRuntimeMonoValue("\(count - 2) more approval request\(count - 2 == 1 ? "" : "s") · inspect in Airlock")
                        }
                        if let session = facts.authoritativeSnapshot?.session, session.state != "IDLE" {
                            workRow(
                                status: session.state,
                                title: session.project.isEmpty ? "Focus session" : session.project,
                                rows: [("Session ID", session.id ?? "Unavailable"), ("Elapsed", model.focusElapsedLabel)],
                                tone: sessionTone(session.state)
                            )
                        }
                    }
                    .padding(.top, 12)
                }
            }
        }
    }

    private func workRow(status: String, title: String, rows: [(String, String)], tone: ZeroTone) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ZeroStatusBadge(status, tone: tone)
                Spacer()
            }
            Text(title)
                .font(DeskRuntimeType.callout.weight(.bold))
                .textSelection(.enabled)
            if !rows.isEmpty { DeskRuntimeEvidenceRows(rows: rows) }
        }
        .padding(11)
        .background(tone.color.opacity(0.055), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(tone.color.opacity(0.22)))
    }

    private var automationFirings: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 10) {
                DeskRuntimeSectionHeader(
                    "Automation Firings",
                    badge: facts.isLive ? firingCountLabel : "OFFLINE"
                )
                if !facts.isLive {
                    DeskRuntimeEmptyState(
                        symbol: "bolt.badge.clock",
                        title: "Firing state unavailable",
                        detail: "Cached firings are not presented as current automation state."
                    )
                } else if let firings = facts.authoritativeSnapshot?.firings, !firings.isEmpty {
                    firingStateSummary
                    ForEach(Array(firings.enumerated()), id: \.offset) { _, record in
                        let state = runtimeText(record, keys: ["state"])?.uppercased() ?? "UNKNOWN"
                        workRow(
                            status: state,
                            title: runtimeText(record, keys: ["name", "automation", "id"]) ?? "Automation firing",
                            rows: safeEvidenceRows(record, keys: ["id", "state", "project_id", "scheduled_at", "updated_at", "error"]),
                            tone: firingTone(state)
                        )
                    }
                } else {
                    DeskRuntimeEmptyState(
                        symbol: "tray",
                        title: "No automation firings",
                        detail: "The current bounded projection contains no firing record."
                    )
                }
            }
        }
    }

    private var firingStateSummary: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(facts.firingStateCounts.keys.sorted(), id: \.self) { state in
                    ZeroStatusBadge("\(facts.firingStateCounts[state, default: 0]) \(state)", tone: firingTone(state))
                }
            }
        }
        .accessibilityLabel("Projected automation firing states")
    }

    private var observation: some View {
        DeskRuntimeCard(accent: Color(red: 0.96, green: 0.67, blue: 0.18)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("OBSERVATION", systemImage: "bolt.fill")
                        .font(DeskRuntimeType.micro)
                    Spacer()
                    ZeroStatusBadge(
                        facts.isLive ? (facts.attentionCount == 0 ? "CLEAR" : "REVIEW") : "OFFLINE",
                        tone: facts.isLive ? (facts.attentionCount == 0 ? .healthy : .attention) : .error
                    )
                }
                if !facts.isLive {
                    Text("No live observation")
                        .font(DeskRuntimeType.title)
                    Text("The runtime stream is offline. Cached absence is not treated as a clean bill of health.")
                        .font(DeskRuntimeType.caption)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                } else if let approval = facts.authoritativeSnapshot?.approvals.first {
                    Text(runtimeText(approval, keys: ["capability"]) ?? "Pending runtime approval")
                        .font(DeskRuntimeType.title)
                    DeskRuntimeEvidenceRows(rows: safeEvidenceRows(approval, keys: ["id", "node", "deadline"]))
                    Button("Review in Airlock") { model.selection.route = .airlock }
                        .buttonStyle(ZeroButtonStyle(.authority))
                        .focusEffectDisabled()
                } else {
                    Text("No pending runtime approval")
                        .font(DeskRuntimeType.title)
                    Text(facts.attentionCount == 0
                        ? "The current bounded runtime and connected Codex state contain no active request."
                        : "Other attention is visible on its owning surface.")
                        .font(DeskRuntimeType.caption)
                        .foregroundStyle(ZeroTheme.secondaryInk)
                }
            }
        }
    }

    private var activity: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 0) {
                DeskRuntimeSectionHeader(
                    "Chronological Flight Activity",
                    badge: !facts.isLive ? "OFFLINE" : (facts.authoritativeSnapshot?.truncated["events"] == true ? "TRUNCATED" : "BOUNDED")
                )
                if !facts.isLive {
                    DeskRuntimeEmptyState(
                        symbol: "clock.badge.questionmark",
                        title: "Activity unavailable",
                        detail: "The event projection is not live."
                    )
                    .padding(.top, 12)
                } else if let events = facts.authoritativeSnapshot?.events, !events.isEmpty {
                    ScrollView(.horizontal, showsIndicators: true) {
                        VStack(spacing: 0) {
                            activityHeader
                            ForEach(Array(events.prefix(8).enumerated()), id: \.offset) { _, event in
                                activityRow(event)
                            }
                        }
                        .frame(minWidth: 650)
                    }
                    .padding(.top, 10)
                } else {
                    DeskRuntimeEmptyState(
                        symbol: "tray",
                        title: "No recent runtime events",
                        detail: "The current bounded projection contains no rows."
                    )
                    .padding(.top, 12)
                }
            }
        }
    }

    private var activityHeader: some View {
        HStack(spacing: 0) {
            tableCell("TIMESTAMP", width: 180, header: true)
            tableCell("CHANNEL", width: 170, header: true)
            tableCell("EVENT ID", width: 220, header: true)
            tableCell("SEQ", width: 80, header: true)
        }
        .background(ZeroTheme.navigation)
    }

    private func activityRow(_ event: RuntimeRecord) -> some View {
        HStack(spacing: 0) {
            tableCell(runtimeText(event, keys: ["time"]) ?? "Unavailable", width: 180)
            tableCell(runtimeText(event, keys: ["kind"]) ?? "Unavailable", width: 170)
            tableCell(runtimeText(event, keys: ["id"]) ?? "Unavailable", width: 220)
            tableCell(runtimeText(event, keys: ["seq"]) ?? "Unavailable", width: 80)
        }
        .overlay(alignment: .bottom) { ZeroTheme.line.opacity(0.7).frame(height: 1) }
    }

    private func tableCell(_ value: String, width: CGFloat, header: Bool = false) -> some View {
        Text(value)
            .font(header ? DeskRuntimeType.micro : DeskRuntimeType.evidence)
            .foregroundStyle(header ? ZeroTheme.secondaryInk : ZeroTheme.ink)
            .textSelection(.enabled)
            .lineLimit(1)
            .frame(width: width, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
    }

    private var topology: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 11) {
                DeskRuntimeSectionHeader(
                    "Node Topology",
                    badge: facts.isLive ? "\(facts.onlineNodeCount) ONLINE" : "OFFLINE"
                )
                if !facts.isLive {
                    DeskRuntimeMonoValue("Node lifecycle unavailable")
                } else if let nodes = facts.authoritativeSnapshot?.nodes.filter({ !$0.revoked }), !nodes.isEmpty {
                    ForEach(nodes.prefix(5)) { node in
                        HStack(spacing: 9) {
                            Circle()
                                .fill(nodeTone(node.status).color)
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(node.id)
                                    .font(DeskRuntimeType.evidence.weight(.bold))
                                    .textSelection(.enabled)
                                Text(node.capabilities.isEmpty ? "No projected capabilities" : node.capabilities.joined(separator: " · "))
                                    .font(DeskRuntimeType.micro)
                                    .foregroundStyle(ZeroTheme.secondaryInk)
                                    .lineLimit(2)
                            }
                            Spacer()
                            ZeroStatusBadge(node.status, tone: nodeTone(node.status))
                        }
                        .padding(9)
                        .background(ZeroTheme.navigation.opacity(0.42), in: RoundedRectangle(cornerRadius: 6))
                    }
                } else {
                    DeskRuntimeMonoValue("No registered node in the current snapshot")
                }
            }
        }
    }

    private var policies: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 10) {
                DeskRuntimeSectionHeader(
                    "Runtime Policies",
                    badge: projectionCountLabel(collection: "policies", count: facts.policyCount)
                )
                if !facts.isLive {
                    DeskRuntimeMonoValue("Policy state unavailable; retained records are cached")
                } else if let policies = facts.authoritativeSnapshot?.policies, !policies.isEmpty {
                    ForEach(Array(policies.prefix(6).enumerated()), id: \.offset) { _, policy in
                        let state = runtimeText(policy, keys: ["status", "state", "effect"]) ?? "PROJECTED"
                        VStack(alignment: .leading, spacing: 7) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(runtimeText(policy, keys: ["name", "id", "rule"]) ?? "Policy")
                                    .font(DeskRuntimeType.callout.weight(.bold))
                                    .textSelection(.enabled)
                                Spacer()
                                ZeroStatusBadge(state.uppercased(), tone: policyTone(state))
                            }
                            DeskRuntimeEvidenceRows(rows: projectedRows(policy, maximum: 6))
                        }
                        .padding(9)
                        .background(ZeroTheme.navigation.opacity(0.42), in: RoundedRectangle(cornerRadius: 6))
                    }
                    if policies.count > 6 {
                        DeskRuntimeMonoValue("Showing 6 of \(policies.count) projected policies")
                    }
                } else {
                    DeskRuntimeMonoValue("No policy record in the current bounded snapshot")
                }
            }
        }
    }

    private var contextSummary: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 10) {
                DeskRuntimeSectionHeader(
                    "Committed State Summary",
                    badge: projectionCountLabel(collection: "context", count: facts.contextCount)
                )
                if !facts.isLive {
                    DeskRuntimeMonoValue("Context state unavailable; retained values are cached")
                } else if let context = facts.authoritativeSnapshot?.context, !context.isEmpty {
                    ForEach(Array(context.keys.sorted().prefix(8)), id: \.self) { key in
                        if let record = context[key] {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(key.uppercased())
                                    .font(DeskRuntimeType.micro)
                                    .foregroundStyle(ZeroTheme.secondaryInk)
                                    .textSelection(.enabled)
                                DeskRuntimeEvidenceRows(rows: projectedRows(record, maximum: 6))
                            }
                        }
                    }
                    if context.count > 8 {
                        DeskRuntimeMonoValue("Showing 8 of \(context.count) committed context groups")
                    }
                } else {
                    DeskRuntimeMonoValue("No committed context group in the current bounded snapshot")
                }
            }
        }
    }

    private var telemetry: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 10) {
                DeskRuntimeSectionHeader("Machine Evidence", badge: facts.isLive ? "PROJECTED" : "OFFLINE")
                DeskRuntimeEvidenceRows(rows: [
                    ("Runtime version", facts.runtimeVersion),
                    ("Snapshot revision", facts.revisionLabel),
                    ("Observed at", facts.authoritativeSnapshot?.timestamp ?? "Unavailable"),
                    ("Release build", releaseBuild)
                ])
                Text("CPU, RAM, WAL rate, latency, and hardware attestation are not projected by this snapshot.")
                    .font(DeskRuntimeType.caption)
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var integrationDetail: String {
        guard facts.isLive, let integrations = facts.authoritativeSnapshot?.integrations else {
            return "No live integration evidence"
        }
        guard !integrations.isEmpty else { return "No integrations in the current snapshot" }
        return integrations.prefix(3).map { "\($0.id): \($0.status)" }.joined(separator: " · ")
    }

    private var nodeDetail: String {
        guard facts.isLive else { return "No live node evidence" }
        return facts.nodeCount == 0 ? "No registered nodes" : facts.deliveryState.presentation.detail
    }

    private var attentionDetail: String {
        guard facts.isLive else { return "Pending work cannot be assessed offline" }
        return facts.attentionCount == 0 ? "No current approval, firing, or uncertain command" : "Open the owning surface for exact action authority"
    }

    private var releaseBuild: String {
        guard let release = facts.authoritativeSnapshot?.release else { return "Unavailable" }
        return runtimeText(release, keys: ["build", "Build", "version", "Version"]) ?? "Unavailable"
    }

    private var firingCountLabel: String {
        guard let snapshot = facts.authoritativeSnapshot else { return "OFFLINE" }
        return "\(snapshot.firings.count)\(snapshot.truncated["firings"] == true ? "+" : "") PROJECTED"
    }

    private func projectionCountLabel(collection: String, count: Int) -> String {
        guard let snapshot = facts.authoritativeSnapshot else { return "OFFLINE" }
        return "\(count)\(snapshot.truncated[collection] == true ? "+" : "") PROJECTED"
    }

    private func projectedRows(_ record: RuntimeRecord, maximum: Int) -> [(String, String)] {
        Array(record.fields.keys.sorted().compactMap { key -> (String, String)? in
            guard let value = runtimeProjectionText(record[key]) else { return nil }
            return (key.replacingOccurrences(of: "_", with: " "), value)
        }.prefix(maximum))
    }

    private func runtimeProjectionText(_ value: RuntimeValue) -> String? {
        switch value {
        case .string(let text): return text.isEmpty ? nil : text
        case .integer(let number): return String(number)
        case .number(let number): return String(number)
        case .bool(let flag): return flag ? "true" : "false"
        case .array(let values): return "\(values.count) value\(values.count == 1 ? "" : "s")"
        case .object(let values): return "\(values.count) field\(values.count == 1 ? "" : "s")"
        case .null: return nil
        }
    }

    private func policyTone(_ state: String) -> ZeroTone {
        switch state.uppercased() {
        case "ACTIVE", "ALLOW", "ALLOWED", "READY": .healthy
        case "CHALLENGE", "PENDING", "REVIEW": .attention
        case "DENY", "DROP", "FAILED", "BLOCKED": .error
        default: .neutral
        }
    }

    private func firingTone(_ state: String) -> ZeroTone {
        switch state.uppercased() {
        case "SUCCEEDED", "COMPLETED", "REVIEWED": .healthy
        case "PENDING", "QUEUED", "DELIVERING", "RUNNING", "EXECUTING": .attention
        case "FAILED", "REJECTED", "EXPIRED", "TIMED_OUT", "BLOCKED", "OFFLINE": .error
        default: .neutral
        }
    }

    private func nodeTone(_ status: String) -> ZeroTone {
        switch status {
        case "ONLINE": .healthy
        case "SUSPECT": .attention
        default: .error
        }
    }
}
