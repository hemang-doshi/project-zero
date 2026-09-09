import SwiftUI
import ZeroKit

enum AirlockOrigin: String, Equatable, Sendable {
    case runtime = "PROJECT ZERO"
    case codex = "CODEX"
}

enum AirlockAuthority: Equatable, Sendable {
    case runtime(id: String)
    case codex(id: CodexRequestID)
}

struct AirlockEvidenceField: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let value: String
    let isAuthoritative: Bool

    init(_ label: String, _ value: String, authoritative: Bool = false, ordinal: Int = 0) {
        self.id = "\(label)-\(ordinal)"
        self.label = label
        self.value = value
        self.isAuthoritative = authoritative
    }
}

struct AirlockApprovalItem: Identifiable, Equatable, Sendable {
    let id: String
    let origin: AirlockOrigin
    let requestID: String
    let action: String
    let target: String
    let source: String
    let deadline: String
    let decision: String
    let detail: String
    let authority: AirlockAuthority?
    let evidence: [AirlockEvidenceField]
    let inputOmitted: Bool
    let displayTruncated: Bool
    let responseUnavailableReason: String?
}

struct AirlockAuditEntry: Identifiable, Equatable, Sendable {
    let id: String
    let time: String
    let action: String
    let target: String
    let actor: String
    let decision: String
    let evidence: String
}

struct AirlockPolicyItem: Identifiable, Equatable, Sendable {
    let id: String
    let status: String
    let enabled: Bool
}

struct AirlockProjection {
    let snapshot: CockpitSnapshot?
    let runtimeConnection: RuntimeConnectionState
    let codexConnection: CodexConnectionState
    let approvals: [AirlockApprovalItem]
    let audit: [AirlockAuditEntry]
    let policies: [AirlockPolicyItem]

    @MainActor
    init(model: CockpitModel) {
        self.init(
            snapshot: model.snapshot,
            runtimeConnection: model.runtimeConnection,
            codexStore: model.codex.store,
            codexConnection: model.codexConnection
        )
    }

    init(
        snapshot: CockpitSnapshot?,
        runtimeConnection: RuntimeConnectionState,
        codexStore: CodexEventStore,
        codexConnection: CodexConnectionState
    ) {
        self.snapshot = snapshot
        self.runtimeConnection = runtimeConnection
        self.codexConnection = codexConnection
        approvals = Self.runtimeApprovals(snapshot) + Self.codexApprovals(codexStore)
        audit = Self.auditEntries(snapshot)
        policies = Self.policyEntries(snapshot)
    }

    var runtimeApprovalCount: Int { approvals.filter { $0.origin == .runtime }.count }
    var codexApprovalCount: Int { approvals.filter { $0.origin == .codex }.count }
    var approvalCountLabel: String {
        "\(approvals.count)\(snapshot?.truncated["approvals"] == true ? "+" : "")"
    }
    var runtimeIsLive: Bool { runtimeConnection == .live }
    var codexIsConnected: Bool { codexConnection == .connected }

    func item(selectionID: String?) -> AirlockApprovalItem? {
        guard let selectionID else { return nil }
        return approvals.first { $0.id == selectionID }
    }

    func canResolve(_ item: AirlockApprovalItem) -> Bool {
        guard item.responseUnavailableReason == nil else { return false }
        switch item.authority {
        case .runtime: return runtimeIsLive
        case .codex: return codexIsConnected
        case nil: return false
        }
    }

    static func codexDecisionResponse(method: String, approve: Bool) -> CodexJSON? {
        switch method {
        case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
            return .object(["decision": .string(approve ? "accept" : "decline")])
        default:
            // Permission profiles and user-input requests have different response
            // schemas. Airlock must not synthesize one from display metadata.
            return nil
        }
    }

    private static func runtimeApprovals(_ snapshot: CockpitSnapshot?) -> [AirlockApprovalItem] {
        guard let snapshot else { return [] }
        return snapshot.approvals.enumerated().map { index, record in
            let rawID = networkRuntimeText(record, keys: ["id"])
            let authorityID = rawID.flatMap { $0.isEmpty ? nil : $0 }
            let requestID = authorityID ?? "Unavailable"
            let action = networkRuntimeText(record, keys: ["capability"]) ?? "Unavailable"
            let target = networkRuntimeText(record, keys: ["node"]) ?? "Unavailable"
            let deadline = networkRuntimeText(record, keys: ["deadline"]) ?? "Unavailable"
            let decision = networkRuntimeText(record, keys: ["status"]) ?? "Unavailable"
            let omitted = record["input_omitted"].bool == true
            let identityIsComplete = authorityID != nil
                && action != "Unavailable"
                && target != "Unavailable"
                && deadline != "Unavailable"
                && decision == "WAITING_APPROVAL"
            var evidence = [
                AirlockEvidenceField("Request ID", requestID, authoritative: true),
                AirlockEvidenceField("Action", action, authoritative: true),
                AirlockEvidenceField("Target", target, authoritative: true),
                AirlockEvidenceField("Source", "Project Zero · zerod", authoritative: true),
                AirlockEvidenceField("Deadline", deadline, authoritative: true),
                AirlockEvidenceField("Decision", decision, authoritative: true)
            ]
            if let hash = networkRuntimeText(record, keys: ["hash"]) {
                evidence.append(AirlockEvidenceField("Invocation hash", hash, authoritative: true))
            }
            if case .object(let input) = record["input"] {
                for (ordinal, key) in input.keys.sorted().enumerated() {
                    if let value = runtimeValueText(input[key] ?? .null) {
                        evidence.append(AirlockEvidenceField("Input · \(key)", value, ordinal: ordinal))
                    }
                }
            }
            return AirlockApprovalItem(
                id: authorityID.map { "runtime:\($0)" } ?? "runtime:unidentified-\(index)",
                origin: .runtime,
                requestID: requestID,
                action: action,
                target: target,
                source: "Project Zero · zerod",
                deadline: deadline,
                decision: decision,
                detail: omitted
                    ? "The daemon retained the full invocation. This bounded display projection omits one or more input fields."
                    : "The daemon is holding this exact invocation for an explicit owner decision.",
                authority: identityIsComplete ? authorityID.map(AirlockAuthority.runtime(id:)) : nil,
                evidence: evidence,
                inputOmitted: omitted,
                displayTruncated: false,
                responseUnavailableReason: identityIsComplete ? nil : "Required authoritative identity fields are unavailable."
            )
        }
    }

    private static func codexApprovals(_ store: CodexEventStore) -> [AirlockApprovalItem] {
        store.approvals.map { approval in
            let requestID = codexRequestLabel(approval.id)
            let params = approval.params
            let threadID = codexScalarText(params["threadId"])
            let turnID = codexScalarText(params["turnId"])
            let itemID = codexScalarText(params["itemId"])
            let command = boundedCodexText(params["command"].string)
            let cwd = boundedCodexText(params["cwd"].string)
            let grantRoot = boundedCodexText(params["grantRoot"].string)
            let reason = boundedCodexText(params["reason"].string)
            let target = command.value ?? grantRoot.value ?? cwd.value ?? itemID ?? "Unavailable"
            let source = threadID.map { "Codex app-server · thread \($0)" } ?? "Codex app-server"
            var evidence = [
                AirlockEvidenceField("Request ID", requestID, authoritative: true),
                AirlockEvidenceField("Action", approval.method, authoritative: true),
                AirlockEvidenceField("Target", target, authoritative: true),
                AirlockEvidenceField("Source", source, authoritative: true),
                AirlockEvidenceField("Deadline", "Not supplied by app-server", authoritative: true),
                AirlockEvidenceField("Decision", "AWAITING_RESPONSE", authoritative: true)
            ]
            for (label, value) in [
                ("Thread ID", threadID), ("Turn ID", turnID), ("Item ID", itemID),
                ("Working directory", cwd.value), ("Grant root", grantRoot.value),
                ("Command", command.value), ("Reason", reason.value),
                ("Kind", codexScalarText(params["kind"])),
                ("Approval callback", codexScalarText(params["approvalId"])),
                ("Network host", codexScalarText(params["networkApprovalContext"]["host"]))
            ] {
                if let value { evidence.append(AirlockEvidenceField(label, value)) }
            }
            let truncated = command.truncated || cwd.truncated || grantRoot.truncated || reason.truncated
            let supportsBinaryDecision = codexDecisionResponse(method: approval.method, approve: true) != nil
            let canAnswer = supportsBinaryDecision
                && target != "Unavailable"
                && !truncated
            let unavailableReason: String?
            if truncated {
                unavailableReason = "Open the originating Zero Bot item to review the complete request before responding."
            } else if target == "Unavailable" {
                unavailableReason = "The request target is unavailable, so Airlock cannot present a safe decision."
            } else if !canAnswer {
                unavailableReason = "Respond in Zero Bot with the method-specific workflow."
            } else {
                unavailableReason = nil
            }
            return AirlockApprovalItem(
                id: codexSelectionID(approval.id),
                origin: .codex,
                requestID: requestID,
                action: approval.method,
                target: target,
                source: source,
                deadline: "Not supplied by app-server",
                decision: "AWAITING_RESPONSE",
                detail: supportsBinaryDecision
                    ? "Codex is paused at this exact JSON-RPC request until the owner answers."
                    : "This request uses a method-specific response schema and cannot be safely answered by Airlock's binary decision controls.",
                authority: .codex(id: approval.id),
                evidence: evidence,
                inputOmitted: false,
                displayTruncated: truncated,
                responseUnavailableReason: unavailableReason
            )
        }
    }

    private static func auditEntries(_ snapshot: CockpitSnapshot?) -> [AirlockAuditEntry] {
        guard let snapshot else { return [] }
        return snapshot.audit.compactMap { record in
            guard let sequence = networkRuntimeText(record, keys: ["seq"]),
                  let action = networkRuntimeText(record, keys: ["action"]),
                  action.hasPrefix("approvals.") else { return nil }
            return AirlockAuditEntry(
                id: sequence,
                time: networkRuntimeText(record, keys: ["time"]) ?? "Unavailable",
                action: action,
                target: networkRuntimeText(record, keys: ["target"]) ?? "Unavailable",
                actor: networkRuntimeText(record, keys: ["principal"]) ?? "Unavailable",
                decision: networkRuntimeText(record, keys: ["decision"]) ?? "Unavailable",
                evidence: networkRuntimeText(record, keys: ["hash", "correlation"]) ?? "Unavailable"
            )
        }
    }

    private static func policyEntries(_ snapshot: CockpitSnapshot?) -> [AirlockPolicyItem] {
        guard let snapshot else { return [] }
        return snapshot.policies.enumerated().map { index, record in
            let id = networkRuntimeText(record, keys: ["id"]) ?? "policy-\(index)"
            return AirlockPolicyItem(
                id: id,
                status: networkRuntimeText(record, keys: ["status"]) ?? "Unavailable",
                enabled: record["enabled"].bool == true
            )
        }
    }

    private static func codexRequestLabel(_ id: CodexRequestID) -> String {
        switch id {
        case .string(let value): value
        case .integer(let value): String(value)
        }
    }

    private static func codexSelectionID(_ id: CodexRequestID) -> String {
        switch id {
        case .string(let value): return "codex:s:\(value)"
        case .integer(let value): return "codex:i:\(value)"
        }
    }

    private static func codexScalarText(_ value: CodexJSON) -> String? {
        switch value {
        case .string(let text): return text.isEmpty ? nil : text
        case .integer(let number): return String(number)
        case .number(let number): return String(number)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }

    private static func boundedCodexText(_ value: String?, limit: Int = 8_192) -> (value: String?, truncated: Bool) {
        guard let value, !value.isEmpty else { return (nil, false) }
        guard value.utf8.count > limit else { return (value, false) }
        var bytes = Array(value.utf8.suffix(limit))
        while let first = bytes.first, first & 0xC0 == 0x80 { bytes.removeFirst() }
        return ("…\(String(decoding: bytes, as: UTF8.self))", true)
    }
}

public struct AirlockView: View {
    @ObservedObject private var model: CockpitModel

    public init(model: CockpitModel) { self.model = model }

    private var projection: AirlockProjection { AirlockProjection(model: model) }

    public var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 1_060
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(wide: wide)
                    metrics(columns: proxy.size.width >= 900 ? 4 : (proxy.size.width >= 620 ? 2 : 1))
                    approvalWorkspace(wide: wide)
                    lowerEvidence(wide: wide)
                }
                .padding(proxy.size.width < 680 ? 14 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Airlock boundary and approval gate")
    }

    @ViewBuilder
    private func header(wide: Bool) -> some View {
        let heading = VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text("Airlock: Local Boundary & Outbound Egress Gate")
                    .font(.title2.weight(.black))
                    .tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                ZeroStatusBadge(
                    "EXPLICIT LOCAL AUTHORITY",
                    symbol: "lock.shield.fill",
                    tone: .error
                )
            }
            Text("Every pending runtime invocation and Codex approval remains attached to its original authority ID. Display-only summaries never become action payloads.")
                .font(.body)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        let statuses = HStack(spacing: 7) {
            ZeroStatusBadge(
                projection.runtimeIsLive ? "ZEROD LIVE" : "ZEROD OFFLINE",
                symbol: projection.runtimeIsLive ? "checkmark.circle.fill" : "wifi.slash",
                tone: projection.runtimeIsLive ? .healthy : .error
            )
            ZeroStatusBadge(
                projection.codexIsConnected ? "CODEX CONNECTED" : "CODEX DISCONNECTED",
                symbol: projection.codexIsConnected ? "bolt.horizontal.circle.fill" : "bolt.slash",
                tone: projection.codexIsConnected ? .healthy : .neutral
            )
        }
        if wide {
            HStack(alignment: .bottom, spacing: 16) {
                heading.frame(maxWidth: .infinity, alignment: .leading)
                statuses
            }
        } else {
            VStack(alignment: .leading, spacing: 12) { heading; statuses }
        }
    }

    private func metrics(columns: Int) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
            NetworkFlightMetricCard(
                label: "Pending requests",
                value: projection.approvalCountLabel,
                detail: projection.approvals.isEmpty ? "No exact owner decisions are waiting" : "Exact decisions currently requiring attention",
                badge: projection.approvals.isEmpty ? "CLEAR" : "LOCAL OWNER",
                tone: projection.approvals.isEmpty ? .healthy : .error
            )
            NetworkFlightMetricCard(
                label: "Project Zero",
                value: String(projection.runtimeApprovalCount),
                detail: projection.runtimeIsLive ? "Current zerod projection" : "Retained snapshot; actions disabled",
                badge: projection.runtimeIsLive ? "LIVE" : "OFFLINE",
                tone: projection.runtimeIsLive ? .healthy : .error
            )
            NetworkFlightMetricCard(
                label: "Codex callbacks",
                value: String(projection.codexApprovalCount),
                detail: projection.codexIsConnected ? "Independent live app-server requests" : "No connected Codex authority",
                badge: projection.codexIsConnected ? "CONNECTED" : "SEPARATE",
                tone: projection.codexIsConnected ? .attention : .neutral
            )
            NetworkFlightMetricCard(
                label: "Audited decisions",
                value: "\(projection.audit.count)\(projection.snapshot?.truncated["audit"] == true ? "+" : "")",
                detail: "Bounded durable approval decisions",
                badge: projection.snapshot?.truncated["audit"] == true ? "LOWER BOUND" : "BOUNDED",
                tone: .neutral
            )
        }
    }

    @ViewBuilder
    private func approvalWorkspace(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                approvalQueue.frame(maxWidth: .infinity, alignment: .top)
                InspectorView(model: model).frame(width: 390, alignment: .top)
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                approvalQueue
                InspectorView(model: model)
            }
        }
    }

    private var approvalQueue: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                NetworkFlightSectionHeader(
                    "Outbound & Tool Boundary Requests",
                    badge: projection.approvalCountLabel + " PENDING"
                )
                if projection.approvals.isEmpty {
                    NetworkFlightEmptyState(
                        symbol: "lock.shield",
                        title: "Boundary idle",
                        detail: emptyApprovalDetail
                    )
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(projection.approvals) { approvalCard($0) }
                    }
                }
                if projection.snapshot?.truncated["approvals"] == true {
                    disclosureNotice(
                        "The daemon reports additional approvals beyond this bounded projection. The visible count is a lower bound.",
                        tone: .attention
                    )
                }
            }
        }
    }

    private var emptyApprovalDetail: String {
        if !projection.runtimeIsLive && !projection.codexIsConnected {
            return "Both authority channels are disconnected. No pending decision can be inferred."
        }
        if !projection.runtimeIsLive {
            return "zerod is offline. Connected Codex approvals would still appear independently here."
        }
        return "No approval is present in the current bounded runtime or Codex projection."
    }

    private func approvalCard(_ item: AirlockApprovalItem) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: item.origin == .runtime ? "lock.shield.fill" : "terminal.fill")
                    .font(.headline)
                    .foregroundStyle(item.origin == .runtime ? ZeroTheme.orangePressed : ZeroTone.attention.color)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.action)
                        .font(.headline.monospaced())
                        .textSelection(.enabled)
                    Text(item.target)
                        .font(.caption.monospaced())
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                ZeroStatusBadge(item.origin.rawValue, tone: item.origin == .runtime ? .authority : .attention)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
                authorityDatum("REQUEST ID", item.requestID)
                authorityDatum("SOURCE", item.source)
                authorityDatum("DEADLINE", item.deadline)
                authorityDatum("DECISION", item.decision)
            }

            Text(item.detail)
                .font(.caption)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            if item.inputOmitted {
                disclosureNotice("INPUT OMITTED · The display summary is incomplete; the action still references only the original invocation ID.", tone: .attention)
            }
            if item.displayTruncated {
                disclosureNotice("DISPLAY TRUNCATED · Inspect the originating Codex request before deciding; no clipped text is sent back.", tone: .attention)
            }
            if let reason = item.responseUnavailableReason {
                disclosureNotice(reason, tone: .neutral)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { cardActions(item) }
                VStack(alignment: .leading, spacing: 8) { cardActions(item) }
            }
        }
        .padding(14)
        .background(
            model.selection.inspectionID == item.id
                ? Color(red: 1.0, green: 0.90, blue: 0.84)
                : Color.white,
            in: RoundedRectangle(cornerRadius: 9)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 9)
                .strokeBorder(model.selection.inspectionID == item.id ? ZeroTheme.orange : ZeroTheme.line,
                              lineWidth: model.selection.inspectionID == item.id ? 2 : 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(item.origin.rawValue) approval \(item.requestID), action \(item.action), target \(item.target)")
    }

    @ViewBuilder
    private func cardActions(_ item: AirlockApprovalItem) -> some View {
        Button {
            model.selection.inspectionID = item.id
        } label: {
            Label("Inspect evidence", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(ZeroButtonStyle(.standard, selected: model.selection.inspectionID == item.id))
        .focusEffectDisabled()

        AirlockDecisionControls(model: model, projection: projection, item: item)
    }

    private func authorityDatum(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(ZeroTheme.secondaryInk)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(value)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(ZeroTheme.navigation.opacity(0.5), in: RoundedRectangle(cornerRadius: 5))
    }

    @ViewBuilder
    private func lowerEvidence(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                auditLedger.frame(maxWidth: .infinity)
                policyPanel.frame(width: 330)
            }
        } else {
            VStack(alignment: .leading, spacing: 14) { auditLedger; policyPanel }
        }
    }

    private var auditLedger: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 10) {
                NetworkFlightSectionHeader("Historical Approval Ledger", badge: "\(projection.audit.count) VISIBLE")
                if projection.audit.isEmpty {
                    NetworkFlightEmptyState(
                        symbol: "clock.arrow.circlepath",
                        title: "No approval decisions in bounded history",
                        detail: projection.runtimeIsLive ? "The current snapshot contains no matching durable audit rows." : "Runtime history is unavailable while no retained snapshot is present."
                    )
                } else {
                    ScrollView(.horizontal, showsIndicators: true) {
                        LazyVStack(spacing: 0) {
                            auditRow(time: "TIME", action: "ACTION", target: "TARGET", actor: "ACTOR", decision: "OUTCOME", evidence: "EVIDENCE", header: true)
                            ForEach(projection.audit) {
                                auditRow(time: $0.time, action: $0.action, target: $0.target, actor: $0.actor, decision: $0.decision, evidence: $0.evidence)
                            }
                        }
                        .frame(minWidth: 800)
                    }
                }
            }
        }
    }

    private func auditRow(time: String, action: String, target: String, actor: String, decision: String, evidence: String, header: Bool = false) -> some View {
        HStack(spacing: 0) {
            auditCell(time, width: 165, header: header)
            auditCell(action, width: 145, header: header)
            auditCell(target, width: 145, header: header)
            auditCell(actor, width: 95, header: header)
            auditCell(decision, width: 95, header: header, tone: header ? nil : networkTone(decision))
            auditCell(evidence, width: 155, header: header)
        }
        .background(header ? ZeroTheme.navigation.opacity(0.75) : Color.white)
        .overlay(alignment: .bottom) { ZeroTheme.line.frame(height: 1) }
    }

    private func auditCell(_ text: String, width: CGFloat, header: Bool, tone: ZeroTone? = nil) -> some View {
        Text(text)
            .font(header ? .caption2.weight(.bold).monospaced() : .caption.monospaced())
            .foregroundStyle(tone?.color ?? (header ? ZeroTheme.secondaryInk : ZeroTheme.ink))
            .lineLimit(2)
            .textSelection(.enabled)
            .frame(width: width, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
    }

    private var policyPanel: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 10) {
                NetworkFlightSectionHeader("Runtime Policies", badge: "READ-ONLY")
                if projection.policies.isEmpty {
                    NetworkFlightEmptyState(
                        symbol: "checklist.unchecked",
                        title: "No policies projected",
                        detail: "Airlock does not fabricate boundary rules or expose an unsupported create-policy control."
                    )
                } else {
                    ForEach(projection.policies) { policy in
                        HStack(spacing: 9) {
                            Image(systemName: policy.enabled ? "checkmark.shield.fill" : "shield.slash")
                                .foregroundStyle(policy.enabled ? ZeroTone.healthy.color : ZeroTheme.secondaryInk)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(policy.id).font(.caption.weight(.bold).monospaced()).textSelection(.enabled)
                                Text(policy.status).font(.caption2.monospaced()).foregroundStyle(ZeroTheme.secondaryInk)
                            }
                            Spacer()
                            ZeroStatusBadge(policy.enabled ? "ENABLED" : policy.status, tone: policy.enabled ? .healthy : .neutral)
                        }
                        .padding(10)
                        .background(ZeroTheme.navigation.opacity(0.45), in: RoundedRectangle(cornerRadius: 7))
                    }
                }
            }
        }
    }

    private func disclosureNotice(_ message: String, tone: ZeroTone) -> some View {
        Label(message, systemImage: tone == .attention ? "exclamationmark.triangle.fill" : "info.circle.fill")
            .font(.caption)
            .foregroundStyle(tone.color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(tone.color.opacity(0.25)))
    }
}

struct AirlockDecisionControls: View {
    @ObservedObject var model: CockpitModel
    let projection: AirlockProjection
    let item: AirlockApprovalItem

    var body: some View {
        Button {
            resolve(approve: false)
        } label: {
            Label("Deny", systemImage: "xmark.circle.fill")
        }
        .buttonStyle(AirlockDenyButtonStyle())
        .focusEffectDisabled()
        .disabled(!projection.canResolve(item))
        .accessibilityLabel("Deny exact request \(item.requestID) for \(item.target)")

        Button {
            resolve(approve: true)
        } label: {
            Label("Approve exact request", systemImage: "lock.open.fill")
        }
        .buttonStyle(ZeroButtonStyle(.authority))
        .focusEffectDisabled()
        .disabled(!projection.canResolve(item))
        .accessibilityLabel("Approve exact request \(item.requestID) for \(item.target)")
    }

    private func resolve(approve: Bool) {
        switch item.authority {
        case .runtime(let id):
            Task { await model.resolveRuntimeApproval(id: id, approve: approve) }
        case .codex(let id):
            guard let response = AirlockProjection.codexDecisionResponse(method: item.action, approve: approve) else { return }
            _ = model.replyToCodexApproval(id: id, response: response)
        case nil:
            return
        }
    }
}

private struct AirlockDenyButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.semibold))
            .foregroundStyle(enabled ? Color.white : ZeroTheme.secondaryInk)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(enabled ? ZeroTone.error.color : ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(enabled ? ZeroTone.error.color : ZeroTheme.line))
            .overlay {
                if focused {
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(ZeroTheme.orangePressed, lineWidth: 2)
                        .padding(-3)
                }
            }
            .opacity(enabled ? 1 : 0.5)
            .scaleEffect(ZeroControlMotion.pressScale(reduceMotion: reduceMotion, isPressed: configuration.isPressed))
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 5))
    }
}
