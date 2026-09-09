import SwiftUI
import ZeroKit

public struct RuntimeView: View {
    @ObservedObject private var model: CockpitModel

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let layout = DeskRuntimeLayout.mode(for: proxy.size.width)
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
            HStack(spacing: 7) {
                Text("Local Personal Runtime:")
                Text(facts.isLive ? "Authoritative" : "Unavailable")
                    .padding(.horizontal, 5)
                    .background(Color(red: 0.96, green: 0.67, blue: 0.18).opacity(0.82))
                    .rotationEffect(.degrees(-0.8))
            }
            .font(.system(size: layout == .compact ? 27 : 35, weight: .black))
            .tracking(-1.1)
            .minimumScaleFactor(0.65)
            .lineLimit(2)
            Text(facts.isLive
                ? "Committed state is streaming from the owner-local daemon. Actions remain exact, bounded, and owner initiated."
                : "The owner-local daemon is not currently providing an authoritative snapshot. No operational fact is inferred.")
                .font(.system(size: 12, weight: .medium))
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
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                    Spacer()
                    ZeroStatusBadge(facts.sessionState, tone: sessionTone(facts.sessionState))
                }
                Text(facts.activeProjectName)
                    .font(.system(size: 18, weight: .black))
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
                value: facts.isLive ? String(facts.attentionCount) : "Unavailable",
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
                    activity
                }
                .frame(maxWidth: .infinity, alignment: .top)

                VStack(spacing: 14) {
                    observation
                    topology
                    telemetry
                }
                .frame(width: 360, alignment: .top)
            }
        } else {
            VStack(spacing: 14) {
                missions
                observation
                activity
                topology
                telemetry
            }
        }
    }

    private var missions: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 0) {
                DeskRuntimeSectionHeader(
                    "Missions Requiring Attention & Active Goals",
                    badge: facts.isLive ? "\(runtimeWorkCount) VISIBLE" : "OFFLINE"
                )
                if !facts.isLive {
                    DeskRuntimeEmptyState(
                        symbol: "wifi.slash",
                        title: "Runtime work unavailable",
                        detail: "Reconnect before interpreting active goals or approval state."
                    )
                    .padding(.top, 12)
                } else if runtimeWorkCount == 0 {
                    DeskRuntimeEmptyState(
                        symbol: "checkmark.circle.fill",
                        title: "No active work in this projection",
                        detail: "There are no pending approvals, pending firings, or active focus sessions in the bounded snapshot."
                    )
                    .padding(.top, 12)
                } else {
                    VStack(spacing: 9) {
                        ForEach(Array((model.snapshot?.approvals.prefix(2) ?? []).enumerated()), id: \.offset) { _, record in
                            workRow(
                                status: "NEEDS INPUT",
                                title: runtimeText(record, keys: ["capability"]) ?? "Approval",
                                rows: safeEvidenceRows(record, keys: ["id", "node", "deadline", "hash"]),
                                tone: .error
                            )
                        }
                        ForEach(Array(pendingFirings.prefix(2).enumerated()), id: \.offset) { _, record in
                            workRow(
                                status: "PENDING",
                                title: runtimeText(record, keys: ["name", "automation", "id"]) ?? "Automation firing",
                                rows: safeEvidenceRows(record, keys: ["id", "state", "project_id", "scheduled_at"]),
                                tone: .attention
                            )
                        }
                        if let session = model.snapshot?.session, session.state != "IDLE" {
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
                .font(.system(size: 13, weight: .bold))
                .textSelection(.enabled)
            if !rows.isEmpty { DeskRuntimeEvidenceRows(rows: rows) }
        }
        .padding(11)
        .background(tone.color.opacity(0.055), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(tone.color.opacity(0.22)))
    }

    private var observation: some View {
        DeskRuntimeCard(accent: Color(red: 0.96, green: 0.67, blue: 0.18)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("OBSERVATION", systemImage: "bolt.fill")
                        .font(.system(size: 9, weight: .black, design: .monospaced))
                    Spacer()
                    ZeroStatusBadge(facts.attentionCount == 0 ? "CLEAR" : "REVIEW", tone: facts.attentionCount == 0 ? .healthy : .attention)
                }
                if !facts.isLive {
                    Text("No live observation")
                        .font(.system(size: 18, weight: .black))
                    Text("The runtime stream is offline. Cached absence is not treated as a clean bill of health.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                } else if let approval = model.snapshot?.approvals.first {
                    Text(runtimeText(approval, keys: ["capability"]) ?? "Pending runtime approval")
                        .font(.system(size: 18, weight: .black))
                    DeskRuntimeEvidenceRows(rows: safeEvidenceRows(approval, keys: ["id", "node", "deadline"]))
                    Button("Review in Airlock") { model.selection.route = .airlock }
                        .buttonStyle(ZeroButtonStyle(.authority))
                        .focusEffectDisabled()
                } else {
                    Text("No pending runtime approval")
                        .font(.system(size: 18, weight: .black))
                    Text(facts.attentionCount == 0
                        ? "The current bounded runtime and connected Codex state contain no active request."
                        : "Other attention is visible on its owning surface.")
                        .font(.system(size: 11, weight: .medium))
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
                    badge: model.snapshot?.truncated["events"] == true ? "TRUNCATED" : "BOUNDED"
                )
                if !facts.isLive {
                    DeskRuntimeEmptyState(
                        symbol: "clock.badge.questionmark",
                        title: "Activity unavailable",
                        detail: "The event projection is not live."
                    )
                    .padding(.top, 12)
                } else if let events = model.snapshot?.events, !events.isEmpty {
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
            .font(.system(size: header ? 9 : 10, weight: header ? .bold : .medium, design: .monospaced))
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
                } else if let nodes = model.snapshot?.nodes.filter({ !$0.revoked }), !nodes.isEmpty {
                    ForEach(nodes.prefix(5)) { node in
                        HStack(spacing: 9) {
                            Circle()
                                .fill(nodeTone(node.status).color)
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(node.id)
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .textSelection(.enabled)
                                Text(node.capabilities.isEmpty ? "No projected capabilities" : node.capabilities.joined(separator: " · "))
                                    .font(.system(size: 9, design: .monospaced))
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

    private var telemetry: some View {
        DeskRuntimeCard {
            VStack(alignment: .leading, spacing: 10) {
                DeskRuntimeSectionHeader("Machine Evidence", badge: "PROJECTED")
                DeskRuntimeEvidenceRows(rows: [
                    ("Runtime version", facts.runtimeVersion),
                    ("Snapshot revision", facts.revisionLabel),
                    ("Observed at", model.snapshot?.timestamp ?? "Unavailable"),
                    ("Release build", releaseBuild)
                ])
                Text("CPU, RAM, WAL rate, latency, and hardware attestation are not projected by this snapshot.")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var pendingFirings: [RuntimeRecord] {
        model.snapshot?.firings.filter { runtimeText($0, keys: ["state"]) == "PENDING" } ?? []
    }

    private var runtimeWorkCount: Int {
        guard facts.isLive else { return 0 }
        let activeSession = model.snapshot?.session.state == "IDLE" ? 0 : 1
        return (model.snapshot?.approvals.count ?? 0) + pendingFirings.count + activeSession
    }

    private var integrationDetail: String {
        guard facts.isLive, let integrations = model.snapshot?.integrations else {
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
        guard let release = model.snapshot?.release else { return "Unavailable" }
        return runtimeText(release, keys: ["build", "Build", "version", "Version"]) ?? "Unavailable"
    }

    private func nodeTone(_ status: String) -> ZeroTone {
        switch status {
        case "ONLINE": .healthy
        case "SUSPECT": .attention
        default: .error
        }
    }
}
