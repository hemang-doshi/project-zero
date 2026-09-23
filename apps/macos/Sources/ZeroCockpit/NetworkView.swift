import SwiftUI
import ZeroKit

enum NetworkLayout {
    case compact, regular, wide

    static func mode(for width: CGFloat) -> Self {
        if width >= 1_080 { return .wide }
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

struct NetworkEvidenceRow: Identifiable, Equatable {
    let evidenceID: String
    let source: String
    let target: String
    let capability: String
    let deadline: String
    let status: String
    let attempts: String

    var id: String { evidenceID }
}

struct NetworkDelivery {
    let label: String
    let detail: String
    let tone: ZeroTone
}

struct NetworkTargetPresentation {
    static let width: CGFloat = 280
    static let wrapsFullIdentity = true

    static func accessibilityValue(_ target: String) -> String { target }
}

struct NetworkFacts {
    let snapshot: CockpitSnapshot?
    let connection: RuntimeConnectionState
    let nodes: [CockpitNode]
    let evidenceRows: [NetworkEvidenceRow]
    /// First display-capable evidence row per target node. Replaces the
    /// previous per-node linear scan of `evidenceRows` (O(nodes × rows)
    /// per topology render); first-in-row-order wins, exactly as before.
    private let deliveryIndex: [String: NetworkEvidenceRow]
    /// Node profiles by node id; first-in-snapshot-order wins, as before.
    private let profileIndex: [String: RuntimeRecord]

    init(snapshot: CockpitSnapshot?, connection: RuntimeConnectionState) {
        self.snapshot = snapshot
        self.connection = connection
        nodes = snapshot?.nodes ?? []
        evidenceRows = snapshot?.invocations.compactMap { record in
            guard let id = networkRuntimeText(record, keys: ["id"]),
                  let target = networkRuntimeText(record, keys: ["node"]),
                  let capability = networkRuntimeText(record, keys: ["capability"]) else { return nil }
            return NetworkEvidenceRow(
                evidenceID: id,
                source: networkRuntimeText(record, keys: ["principal"]) ?? "Unavailable",
                target: target,
                capability: capability,
                deadline: networkRuntimeText(record, keys: ["deadline"]) ?? "Unavailable",
                status: networkRuntimeText(record, keys: ["status"]) ?? "UNKNOWN",
                attempts: networkRuntimeText(record, keys: ["attempts"]) ?? "Unavailable"
            )
        } ?? []
        var deliveryIndex: [String: NetworkEvidenceRow] = [:]
        deliveryIndex.reserveCapacity(evidenceRows.count)
        for row in evidenceRows {
            if (row.capability == "display.render" || row.capability == "display.clear"),
               deliveryIndex[row.target] == nil {
                deliveryIndex[row.target] = row
            }
        }
        self.deliveryIndex = deliveryIndex
        var profileIndex: [String: RuntimeRecord] = [:]
        if let profiles = snapshot?.nodeProfiles {
            profileIndex.reserveCapacity(profiles.count)
            for record in profiles {
                if let id = networkRuntimeText(record, keys: ["id"]), profileIndex[id] == nil {
                    profileIndex[id] = record
                }
            }
        }
        self.profileIndex = profileIndex
    }

    @MainActor
    init(model: CockpitModel) {
        self.init(snapshot: model.snapshot, connection: model.runtimeConnection)
    }

    var isLive: Bool { connection == .live && snapshot != nil }
    var activeNodeCount: Int { nodes.filter { !$0.revoked }.count }
    var revokedNodeCount: Int { nodes.filter(\.revoked).count }
    var onlineNodeCount: Int { nodes.filter { !$0.revoked && $0.status == "ONLINE" }.count }
    var capabilityCount: Int { Set(nodes.flatMap(\.capabilities)).count }
    var registeredNodeCountLabel: String {
        guard snapshot != nil else { return "Unavailable" }
        return "\(nodes.count)\(snapshot?.truncated["nodes"] == true ? "+" : "")"
    }
    var freshnessLabel: String {
        guard let snapshot else { return "NO SNAPSHOT" }
        return isLive ? "LIVE · REV \(snapshot.revision)" : "CACHED · \(snapshot.timestamp)"
    }
    var topologyNotice: String {
        guard let snapshot else { return "Topology is unavailable until the owner-local runtime provides a snapshot." }
        let lifecycle = "including \(revokedNodeCount) revoked"
        if snapshot.truncated["nodes"] == true {
            return "Showing \(nodes.count) registered nodes, \(lifecycle), as a lower bound from the bounded snapshot."
        }
        return "Showing all \(nodes.count) registered nodes, \(lifecycle), in the current bounded snapshot."
    }
    var evidenceNotice: String {
        guard let snapshot else { return "Capability evidence is unavailable." }
        if snapshot.truncated["invocations"] == true {
            return "Showing the newest \(evidenceRows.count) invocation records; the total is a lower bound."
        }
        return "Showing \(evidenceRows.count) invocation records. Standing capability leases are not projected."
    }

    func profile(for node: CockpitNode) -> RuntimeRecord? {
        profileIndex[node.id]
    }

    func lifecycleStatus(for node: CockpitNode) -> String {
        node.revoked ? "REVOKED" : node.status
    }

    func delivery(for node: CockpitNode) -> NetworkDelivery {
        if node.revoked {
            return NetworkDelivery(
                label: "Revoked",
                detail: "Registration is retained as lifecycle evidence; this node has no active delivery authority.",
                tone: .error
            )
        }
        guard isLive else {
            return NetworkDelivery(label: "Stale or uncertain", detail: "Snapshot retained while the stream is not live.", tone: .attention)
        }
        guard node.status == "ONLINE" else {
            if node.status == "SUSPECT" {
                return NetworkDelivery(label: "Stale or uncertain", detail: "The daemon reports this node as suspect.", tone: .attention)
            }
            return NetworkDelivery(label: node.status, detail: "No live delivery evidence is available.", tone: .error)
        }
        guard node.capabilities.contains("display.render") || node.capabilities.contains("display.clear") else {
            return NetworkDelivery(label: "Connected", detail: "The daemon reports this node online.", tone: .healthy)
        }
        guard let row = deliveryIndex[node.id] else {
            return NetworkDelivery(label: "Connected", detail: "Online; no projected display invocation proves delivery.", tone: .healthy)
        }
        switch row.status.uppercased() {
        case "SUCCEEDED":
            return NetworkDelivery(label: "Delivered", detail: "The invocation succeeded; rendered pixels are unconfirmed.", tone: .healthy)
        case "DISPATCHED":
            return NetworkDelivery(label: "Awaiting delivery", detail: "Dispatched without a matching success result yet.", tone: .attention)
        case "QUEUED", "WAITING_APPROVAL":
            return NetworkDelivery(label: "Queued", detail: "Committed and waiting for dispatch authority or connectivity.", tone: .attention)
        default:
            return NetworkDelivery(label: "Stale or uncertain", detail: "Latest projected invocation: \(row.status).", tone: .attention)
        }
    }
}

public struct NetworkView: View {
    @ObservedObject private var model: CockpitModel

    public init(model: CockpitModel) {
        self.model = model
    }

    public var body: some View {
        GeometryReader { proxy in
            let layout = NetworkLayout.mode(for: proxy.size.width)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header(layout: layout)
                    metrics(layout: layout)
                    topology(layout: layout)
                    capabilityEvidence
                }
                .padding(layout == .compact ? 14 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Network topology and node authority")
    }

    private var facts: NetworkFacts {
        ProjectionCache.shared.networkFacts(snapshot: model.snapshot, connection: model.runtimeConnection)
    }

    @ViewBuilder
    private func header(layout: NetworkLayout) -> some View {
        let title = VStack(alignment: .leading, spacing: 8) {
            Text("Network: Spatial Topology & Node Authority")
                .font(.zero(size: layout == .compact ? 27 : 35, weight: .black))
                .tracking(-1.05)
                .minimumScaleFactor(0.68)
                .lineLimit(2)
            HStack(spacing: 7) {
                Text("This Mac:")
                Text(facts.isLive ? "Authoritative Ring-0 Runtime" : "Authority Snapshot Retained")
                    .padding(.horizontal, 5)
                    .background(ZeroTheme.markerYellow.opacity(0.78))
                    .rotationEffect(.degrees(-0.7))
            }
            .font(.zero(size: 12, weight: .bold))
            Text("Local node registration, projected capabilities, lifecycle freshness, and delivery evidence. No public relay or unsupported bus operation is inferred.")
                .font(.zero(size: 12, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }

        if layout == .wide {
            HStack(alignment: .bottom, spacing: 20) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 7) {
                    ZeroStatusBadge(facts.freshnessLabel,
                                    symbol: facts.isLive ? "lock.shield.fill" : "clock.badge.questionmark",
                                    tone: facts.isLive ? .healthy : .attention).equatable()
                    Text("Enrollment changes are unavailable in this display projection.")
                        .font(.zeroMono(size: 9, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                title
                ZeroStatusBadge(facts.freshnessLabel,
                                symbol: facts.isLive ? "lock.shield.fill" : "clock.badge.questionmark",
                                tone: facts.isLive ? .healthy : .attention).equatable()
                Text("Enrollment changes are unavailable in this display projection.")
                    .font(.zeroMono(size: 9, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }
        }
    }

    private func metrics(layout: NetworkLayout) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: layout.metricColumns)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            NetworkFlightMetricCard(
                label: "Registered nodes",
                value: facts.registeredNodeCountLabel,
                detail: facts.snapshot == nil ? "No node projection" : "\(facts.activeNodeCount) active · \(facts.onlineNodeCount) online · \(facts.revokedNodeCount) revoked",
                badge: facts.isLive ? "LIVE" : "CACHED",
                tone: facts.isLive ? .healthy : .attention
            )
            NetworkFlightMetricCard(
                label: "Mesh latency",
                value: "Unavailable",
                detail: "Latency and jitter are not projected",
                badge: "NO METRIC",
                tone: .neutral
            )
            NetworkFlightMetricCard(
                label: "Authority state",
                value: facts.isLive ? "Owner-local" : "Unconfirmed",
                detail: facts.isLive ? "zerod is the committed-state authority" : "Transport is not live",
                badge: facts.isLive ? "RING-0" : "STALE",
                tone: facts.isLive ? .authority : .attention
            )
            NetworkFlightMetricCard(
                label: "Capabilities",
                value: facts.snapshot == nil ? "Unavailable" : "\(facts.capabilityCount) projected",
                detail: "Across active and revoked registrations; not lease count",
                badge: "BOUNDED",
                tone: .neutral
            )
        }
    }

    private func topology(layout: NetworkLayout) -> some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 14) {
                NetworkFlightSectionHeader("Spatial Topology Grid", badge: facts.isLive ? "OWNER-LOCAL LIVE" : "HISTORICAL SNAPSHOT").equatable()
                Text(facts.topologyNotice)
                    .font(.zeroMono(size: 10, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                TopologySceneView(nodes: buildTopologyNodes(snapshotNodes: facts.nodes)).equatable()
                if layout == .wide {
                    HStack(alignment: .top, spacing: 12) {
                        authorityCard
                            .frame(maxWidth: .infinity)
                            .layoutPriority(2)
                        if let first = facts.nodes.first {
                            nodeCard(first)
                                .frame(width: 320)
                        }
                    }
                    if facts.nodes.count > 1 {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), alignment: .leading, spacing: 12) {
                            ForEach(Array(facts.nodes.dropFirst())) { node in nodeCard(node) }
                        }
                    }
                } else {
                    LazyVStack(spacing: 12) {
                        authorityCard
                        ForEach(facts.nodes) { node in nodeCard(node) }
                    }
                }
            }
        }
    }

    private var authorityCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "desktopcomputer")
                    .font(.zero(size: 22, weight: .semibold))
                    .foregroundStyle(ZeroTheme.orangePressed)
                    .frame(width: 42, height: 42)
                    .background(ZeroTheme.orange.opacity(0.11), in: RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 3) {
                    Text("This Mac").font(.zero(size: 17, weight: .black))
                    Text("OWNER-LOCAL RUNTIME AUTHORITY")
                        .font(.zeroMono(size: 9, weight: .bold))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                }
                Spacer()
                ZeroStatusBadge(facts.isLive ? "AUTHORITATIVE" : "UNCONFIRMED",
                                symbol: facts.isLive ? "checkmark.seal.fill" : "clock.badge.questionmark",
                                tone: facts.isLive ? .authority : .attention).equatable()
            }
            NetworkFlightEvidenceRows(rows: [
                ("Runtime", facts.snapshot?.runtimeVersion ?? "Unavailable"),
                ("Revision", facts.snapshot.map { String($0.revision) } ?? "Unavailable"),
                ("Observed", facts.snapshot?.timestamp ?? "Unavailable"),
                ("Transport", facts.connection.rawValue.uppercased())
            ])
            Text("The snapshot does not project host latency, key-enclave state, or authority transfer. Those claims are intentionally absent.")
                .font(.zero(size: 10, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.orange.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(ZeroTheme.orange.opacity(0.42), lineWidth: 1.5))
    }

    private func nodeCard(_ node: CockpitNode) -> some View {
        let delivery = facts.delivery(for: node)
        let profile = facts.profile(for: node)
        let lifecycleStatus = facts.lifecycleStatus(for: node)
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: node.capabilities.contains(where: { $0.hasPrefix("display.") }) ? "display" : "point.3.connected.trianglepath.dotted")
                    .font(.zero(size: 16, weight: .semibold))
                    .foregroundStyle(delivery.tone.color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.id)
                        .font(.zeroMono(size: 12, weight: .black))
                        .textSelection(.enabled)
                    Text(profileSummary(profile))
                        .font(.zeroMono(size: 9, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .lineLimit(2)
                }
                Spacer(minLength: 4)
                ZeroStatusBadge(lifecycleStatus, tone: networkTone(lifecycleStatus))
            }
            NetworkFlightEvidenceRows(rows: [
                ("Lifecycle", lifecycleStatus),
                ("Daemon status", node.status),
                ("Last seen", node.lastSeen ?? "Unavailable"),
                ("Delivery", delivery.label)
            ])
            Text(delivery.detail)
                .font(.zero(size: 9, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
            if node.capabilities.isEmpty {
                Text("NO PROJECTED CAPABILITIES")
                    .font(.zeroMono(size: 9, weight: .bold))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            } else {
                FlowChips(values: node.capabilities)
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(networkTone(lifecycleStatus).color.opacity(0.28)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Node \(node.id), lifecycle \(lifecycleStatus)")
        .accessibilityValue("Daemon status \(node.status); \(node.capabilities.count) projected capabilities; last seen \(node.lastSeen ?? "unavailable"); delivery \(delivery.label)")
    }

    private var capabilityEvidence: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                NetworkFlightSectionHeader("Capability Invocation & Delivery Evidence", badge: facts.snapshot?.truncated["invocations"] == true ? "LOWER BOUND" : "BOUNDED").equatable()
                Text(facts.evidenceNotice)
                    .font(.zero(size: 10, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                if facts.evidenceRows.isEmpty {
                    NetworkFlightEmptyState(
                        symbol: facts.snapshot == nil ? "wifi.slash" : "tray",
                        title: facts.snapshot == nil ? "Evidence unavailable" : "No projected capability invocation",
                        detail: facts.snapshot == nil ? "Reconnect to load a bounded snapshot." : "No standing lease or invocation row is present in the current projection."
                    )
                } else {
                    ScrollView(.horizontal, showsIndicators: true) {
                        LazyVStack(spacing: 0) {
                            networkEvidenceHeader
                            ForEach(facts.evidenceRows.prefix(100)) { row in networkEvidenceRow(row) }
                            if facts.evidenceRows.count > 100 {
                                Text("+\(facts.evidenceRows.count - 100) more rows in the bounded snapshot")
                                    .font(.zeroMono(size: 9, weight: .medium))
                                    .foregroundStyle(ZeroTheme.secondaryInk)
                                    .padding(.vertical, 6)
                            }
                        }
                        .frame(minWidth: 1_030)
                    }
                }
            }
        }
    }

    private var networkEvidenceHeader: some View {
        HStack(spacing: 0) {
            networkCell("SOURCE", width: 130, header: true)
            networkTargetCell("TARGET NODE", header: true)
            networkCell("CAPABILITY SCOPE", width: 210, header: true)
            networkCell("DEADLINE", width: 210, header: true)
            networkCell("STATUS", width: 130, header: true)
            networkCell("ATTEMPTS", width: 90, header: true)
            networkCell("EVIDENCE ID", width: 190, header: true)
        }
        .background(ZeroTheme.navigation)
    }

    private func networkEvidenceRow(_ row: NetworkEvidenceRow) -> some View {
        HStack(spacing: 0) {
            networkCell(row.source, width: 130)
            networkTargetCell(row.target)
            networkCell(row.capability, width: 210)
            networkCell(row.deadline, width: 210)
            networkCell(row.status, width: 130, tone: invocationTone(row.status))
            networkCell(row.attempts, width: 90)
            networkCell(row.evidenceID, width: 190)
        }
        .overlay(alignment: .bottom) { ZeroTheme.line.opacity(0.7).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Invocation \(row.evidenceID), target node \(row.target)")
        .accessibilityValue("\(row.capability), \(row.status), \(row.attempts) attempts")
    }

    private func networkTargetCell(_ value: String, header: Bool = false) -> some View {
        Text(value)
            .font(.zeroMono(size: header ? 9 : 10, weight: header ? .bold : .medium))
            .foregroundStyle(header ? ZeroTheme.secondaryInk : ZeroTheme.ink)
            .textSelection(.enabled)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: NetworkTargetPresentation.width, alignment: .leading)
            .frame(minHeight: 38, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
            .accessibilityLabel(header ? "Target node column" : "Target node")
            .accessibilityValue(NetworkTargetPresentation.accessibilityValue(value))
            .help(value)
    }

    private func networkCell(_ value: String, width: CGFloat, header: Bool = false, tone: ZeroTone? = nil) -> some View {
        Text(value)
            .font(.zeroMono(size: header ? 9 : 10, weight: header ? .bold : .medium))
            .foregroundStyle(tone?.color ?? (header ? ZeroTheme.secondaryInk : ZeroTheme.ink))
            .textSelection(.enabled)
            .lineLimit(1)
            .frame(width: width, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
    }

    private func profileSummary(_ record: RuntimeRecord?) -> String {
        guard let record, case .object(let profile) = record["value"] else { return "REGISTERED NODE · PROFILE UNAVAILABLE" }
        let version = runtimeValueText(profile["version"] ?? .null)
        let build = runtimeValueText(profile["build"] ?? .null)
        let schema = runtimeValueText(profile["render_schema"] ?? .null)
        let parts = [version.map { "FW \($0)" }, build.map { "BUILD \($0)" }, schema.map { "SCHEMA \($0)" }].compactMap { $0 }
        return parts.isEmpty ? "REGISTERED NODE · PROFILE BOUNDED" : parts.joined(separator: " · ")
    }
}

struct NetworkFlightPanel<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        content
            .padding(17)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.line))
            .shadow(color: .black.opacity(0.065), radius: 8, x: 0, y: 4)
    }
}

struct NetworkFlightMetricCard: View, Equatable {
    let label: String
    let value: String
    let detail: String
    let badge: String
    let tone: ZeroTone

    var body: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top) {
                    Text(label.uppercased())
                        .font(.zeroMono(size: 9, weight: .bold))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                    Spacer()
                    ZeroStatusBadge(badge, tone: tone).equatable()
                }
                Text(value)
                    .font(.zero(size: 21, weight: .black))
                    .minimumScaleFactor(0.65)
                    .lineLimit(1)
                Text(detail)
                    .font(.zero(size: 10, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct NetworkFlightSectionHeader: View, Equatable {
    let title: String
    let badge: String?

    init(_ title: String, badge: String? = nil) {
        self.title = title
        self.badge = badge
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.zero(size: 15, weight: .black))
            Spacer()
            if let badge {
                Text(badge)
                    .font(.zeroMono(size: 9, weight: .bold))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(ZeroTheme.navigation.opacity(0.72))
    }
}

struct NetworkFlightEvidenceRows: View, Equatable {
    let rows: [(String, String)]

    static func == (lhs: NetworkFlightEvidenceRows, rhs: NetworkFlightEvidenceRows) -> Bool {
        guard lhs.rows.count == rhs.rows.count else { return false }
        return zip(lhs.rows, rhs.rows).allSatisfy { $0 == $1 }
    }

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(rows.prefix(100).enumerated()), id: \.offset) { index, row in
                HStack(alignment: .top, spacing: 10) {
                    Text(row.0.uppercased())
                        .font(.zeroMono(size: 8, weight: .bold))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .frame(width: 76, alignment: .leading)
                    Text(row.1)
                        .font(.zeroMono(size: 9, weight: .medium))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 6)
                if index < rows.count - 1 { Divider().overlay(ZeroTheme.line.opacity(0.7)) }
            }
        }
        .padding(.horizontal, 9)
        .background(ZeroTheme.navigation.opacity(0.45), in: RoundedRectangle(cornerRadius: 6))
    }
}

struct NetworkFlightEmptyState: View, Equatable {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: symbol)
                .font(.zero(size: 23, weight: .semibold))
                .foregroundStyle(ZeroTheme.secondaryInk)
            Text(title).font(.zero(size: 16, weight: .bold))
            Text(detail)
                .font(.zero(size: 11, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.navigation.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct FlowChips: View {
    let values: [String]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 5) { chips }
            VStack(alignment: .leading, spacing: 5) { chips }
        }
    }

    @ViewBuilder private var chips: some View {
        ForEach(values, id: \.self) { value in
            Text(value)
                .font(.zeroMono(size: 8, weight: .bold))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .background(ZeroTheme.frameBand.opacity(0.55), in: RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(ZeroTheme.line))
                .textSelection(.enabled)
        }
    }
}

func networkTone(_ status: String) -> ZeroTone {
    switch status.uppercased() {
    case "ONLINE", "CONNECTED", "SUCCEEDED", "ALLOW", "ALLOWED": .healthy
    case "SUSPECT", "QUEUED", "DISPATCHED", "WAITING_APPROVAL": .attention
    case "REVOKED", "OFFLINE", "FAILED", "REJECTED", "DENY", "DENIED", "CANCELLED": .error
    default: .neutral
    }
}

func invocationTone(_ status: String) -> ZeroTone { networkTone(status) }

func runtimeValueText(_ value: RuntimeValue) -> String? {
    switch value {
    case .string(let text): return text.isEmpty ? nil : text
    case .integer(let number): return String(number)
    case .number(let number): return String(number)
    case .bool(let value): return value ? "true" : "false"
    default: return nil
    }
}

func networkRuntimeText(_ record: RuntimeRecord, keys: [String]) -> String? {
    for key in keys {
        if let value = runtimeValueText(record[key]) { return value }
    }
    return nil
}

func networkSafeEvidenceRows(_ record: RuntimeRecord, keys: [String]) -> [(String, String)] {
    keys.compactMap { key in
        networkRuntimeText(record, keys: [key]).map {
            (key.replacingOccurrences(of: "_", with: " "), $0)
        }
    }
}
