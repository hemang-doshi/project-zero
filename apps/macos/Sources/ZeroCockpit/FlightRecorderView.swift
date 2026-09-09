import SwiftUI
import ZeroKit

enum FlightOrigin: String, Equatable {
    case runtime = "ZEROD DURABLE"
    case codex = "CODEX LIVE MEMORY"
}

enum FlightCategory: String, CaseIterable, Hashable {
    case all = "All records"
    case events = "Events"
    case audit = "Audit"
    case invocations = "Invocations"
    case codex = "Codex"
}

enum FlightOutcomeFilter: String, CaseIterable, Hashable {
    case all = "Any outcome"
    case attention = "Attention"
    case success = "Succeeded"
}

enum FlightClassification: Equatable {
    case neutral, attention, success
}

struct FlightRecord: Identifiable {
    let id: String
    let origin: FlightOrigin
    let category: FlightCategory
    let timestamp: String
    let channel: String
    let actor: String
    let evidence: String
    let outcome: String
    let reference: String
    let fields: [(String, String)]
    let classification: FlightClassification

    var searchableText: String {
        ([id, origin.rawValue, category.rawValue, timestamp, channel, actor, evidence, outcome, reference]
            + fields.flatMap { [$0.0, $0.1] }).joined(separator: " ").lowercased()
    }
}

struct FlightProjection {
    let snapshot: CockpitSnapshot?
    let runtimeConnection: RuntimeConnectionState
    let codexConnection: CodexConnectionState
    let codexStore: CodexEventStore
    let records: [FlightRecord]

    init(snapshot: CockpitSnapshot?, runtimeConnection: RuntimeConnectionState,
         codexStore: CodexEventStore, codexConnection: CodexConnectionState) {
        self.snapshot = snapshot
        self.runtimeConnection = runtimeConnection
        self.codexConnection = codexConnection
        self.codexStore = codexStore
        records = Self.orderByProjectedTime(Self.runtimeRecords(snapshot) + Self.codexRecords(codexStore))
    }

    @MainActor
    init(model: CockpitModel) {
        self.init(snapshot: model.snapshot, runtimeConnection: model.runtimeConnection,
                  codexStore: model.codex.store, codexConnection: model.codexConnection)
    }

    var isRuntimeLive: Bool { runtimeConnection == .live && snapshot != nil }
    var runtimeEventCountLabel: String {
        guard let snapshot else { return "Unavailable" }
        return "\(snapshot.events.count)\(snapshot.truncated["events"] == true ? "+" : "")"
    }
    var interceptedCountLabel: String {
        guard snapshot != nil else { return "Unavailable" }
        let count = records.filter { $0.origin == .runtime && $0.classification == .attention }.count
        let incomplete = ["audit", "invocations"].contains { snapshot?.truncated[$0] == true }
        return "\(count)\(incomplete ? "+" : "")"
    }
    var historyNotice: String {
        var notices: [String] = []
        if let snapshot {
            let bounded = ["events", "audit", "invocations"].filter { snapshot.truncated[$0] == true }
            if bounded.isEmpty {
                notices.append("Runtime rows are the complete current bounded projection, observed \(snapshot.timestamp).")
            } else {
                notices.append("Runtime \(bounded.joined(separator: ", ")) history is truncated; visible counts are a lower bound.")
            }
        } else {
            notices.append("No runtime snapshot is available.")
        }
        let codexDrops = codexStore.truncation.threads + codexStore.truncation.turns + codexStore.truncation.items + codexStore.truncation.unknownEvents
        if codexDrops > 0 || codexStore.truncation.metadata {
            notices.append("Codex memory history is bounded and has dropped or clipped content.")
        } else {
            notices.append("Codex rows are bounded in memory; they are not durable runtime evidence.")
        }
        return notices.joined(separator: " ")
    }

    func filtered(category: FlightCategory, outcome: FlightOutcomeFilter, query: String) -> [FlightRecord] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return records.filter { record in
            let categoryMatches = category == .all || record.category == category
            let outcomeMatches: Bool
            switch outcome {
            case .all: outcomeMatches = true
            case .attention: outcomeMatches = record.classification == .attention
            case .success: outcomeMatches = record.classification == .success
            }
            return categoryMatches && outcomeMatches && (needle.isEmpty || record.searchableText.contains(needle))
        }
    }

    private static func runtimeRecords(_ snapshot: CockpitSnapshot?) -> [FlightRecord] {
        guard let snapshot else { return [] }
        let events = snapshot.events.compactMap { record -> FlightRecord? in
            guard let id = networkRuntimeText(record, keys: ["id"]),
                  let channel = networkRuntimeText(record, keys: ["kind"]) else { return nil }
            let sequence = networkRuntimeText(record, keys: ["seq"]) ?? "Unavailable"
            return FlightRecord(
                id: "runtime-event-\(id)", origin: .runtime, category: .events,
                timestamp: networkRuntimeText(record, keys: ["time"]) ?? "Unavailable",
                channel: channel, actor: "zerod", evidence: id, outcome: "RECORDED",
                reference: "SEQ \(sequence)",
                fields: networkSafeEvidenceRows(record, keys: ["seq", "id", "kind", "time"]),
                classification: .neutral
            )
        }
        let audit = snapshot.audit.compactMap { record -> FlightRecord? in
            guard let sequence = networkRuntimeText(record, keys: ["seq"]) else { return nil }
            let decision = networkRuntimeText(record, keys: ["decision"]) ?? "UNKNOWN"
            let hash = networkRuntimeText(record, keys: ["hash"])
            return FlightRecord(
                id: "runtime-audit-\(sequence)", origin: .runtime, category: .audit,
                timestamp: networkRuntimeText(record, keys: ["time"]) ?? "Unavailable",
                channel: networkRuntimeText(record, keys: ["action"]) ?? "audit",
                actor: networkRuntimeText(record, keys: ["principal"]) ?? "Unavailable",
                evidence: hash ?? networkRuntimeText(record, keys: ["correlation"]) ?? "Unavailable",
                outcome: decision,
                reference: networkRuntimeText(record, keys: ["target"]) ?? "Unavailable",
                fields: networkSafeEvidenceRows(record, keys: ["seq", "principal", "action", "target", "decision", "correlation", "time", "previous_hash", "hash"]),
                classification: classify(decision)
            )
        }
        let invocations = snapshot.invocations.compactMap { record -> FlightRecord? in
            guard let id = networkRuntimeText(record, keys: ["id"]),
                  let capability = networkRuntimeText(record, keys: ["capability"]) else { return nil }
            let status = networkRuntimeText(record, keys: ["status"]) ?? "UNKNOWN"
            return FlightRecord(
                id: "runtime-invocation-\(id)", origin: .runtime, category: .invocations,
                timestamp: "Not projected", channel: capability,
                actor: networkRuntimeText(record, keys: ["principal"]) ?? "Unavailable",
                evidence: id, outcome: status,
                reference: networkRuntimeText(record, keys: ["node"]) ?? "Unavailable",
                fields: networkSafeEvidenceRows(record, keys: ["id", "principal", "node", "capability", "status", "approved", "deadline", "attempts"]),
                classification: classify(status)
            )
        }
        return events + audit + invocations
    }

    private static func codexRecords(_ store: CodexEventStore) -> [FlightRecord] {
        var rows: [FlightRecord] = []
        for thread in store.threads.values.sorted(by: { $0.id < $1.id }) {
            let status = codexScalar(thread.status) ?? "STATE AVAILABLE"
            rows.append(FlightRecord(
                id: "codex-thread-\(thread.id)", origin: .codex, category: .codex,
                timestamp: "Not projected", channel: "thread/state", actor: "Codex app-server",
                evidence: thread.id, outcome: status,
                reference: thread.title.isEmpty ? "Untitled thread" : thread.title,
                fields: [("thread id", thread.id), ("title", thread.title.isEmpty ? "Unavailable" : thread.title), ("status", status)],
                classification: classify(status)
            ))
            for turn in thread.turns.values.sorted(by: { $0.id < $1.id }) {
                rows.append(FlightRecord(
                    id: "codex-turn-\(thread.id)-\(turn.id)", origin: .codex, category: .codex,
                    timestamp: "Not projected", channel: "turn/state", actor: "Codex app-server",
                    evidence: turn.id, outcome: turn.status, reference: thread.id,
                    fields: [("thread id", thread.id), ("turn id", turn.id), ("status", turn.status),
                             ("content", turn.contentTruncated ? "Truncated" : "Bounded")],
                    classification: classify(turn.status)
                ))
            }
            for item in thread.items {
                rows.append(FlightRecord(
                    id: "codex-item-\(thread.id)-\(item.id)", origin: .codex, category: .codex,
                    timestamp: "Not projected", channel: "item/\(item.kind)", actor: "Codex app-server",
                    evidence: item.id, outcome: item.status, reference: item.turnID,
                    fields: [("thread id", thread.id), ("turn id", item.turnID), ("item id", item.id),
                             ("type", item.kind), ("status", item.status),
                             ("content", item.textTruncated || item.outputTruncated || item.metadataTruncated ? "Truncated" : "Bounded")],
                    classification: classify(item.status)
                ))
            }
        }
        for (index, event) in store.unknownEvents.enumerated() {
            let params = event.params
            let status = params["status"].string ?? params["turn"]["status"].string ?? "UNHANDLED"
            var fields: [(String, String)] = [("method", event.method)]
            for key in ["threadId", "turnId", "itemId", "status", "type", "model"] {
                if let value = codexScalar(params[key]) { fields.append((key, value)) }
            }
            if case .request(let id, _, _) = event { fields.append(("request id", codexRequestIDLabel(id))) }
            rows.append(FlightRecord(
                id: "codex-unknown-\(index)-\(event.method)", origin: .codex, category: .codex,
                timestamp: "Not projected", channel: event.method, actor: "Codex app-server",
                evidence: fields.first(where: { $0.0 == "itemId" || $0.0 == "turnId" || $0.0 == "threadId" })?.1 ?? "Redacted metadata",
                outcome: status, reference: "UNHANDLED PROTOCOL EVENT", fields: fields,
                classification: classify(status)
            ))
        }
        return rows
    }

    private static func orderByProjectedTime(_ records: [FlightRecord]) -> [FlightRecord] {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let wholeSecond = ISO8601DateFormatter()
        wholeSecond.formatOptions = [.withInternetDateTime]
        func date(_ value: String) -> Date? {
            fractional.date(from: value) ?? wholeSecond.date(from: value)
        }
        return records.enumerated().sorted { lhs, rhs in
            switch (date(lhs.element.timestamp), date(rhs.element.timestamp)) {
            case let (left?, right?) where left != right: return left > right
            case (_?, nil): return true
            case (nil, _?): return false
            default: return lhs.offset < rhs.offset
            }
        }.map(\.element)
    }
}

public struct FlightRecorderView: View {
    @ObservedObject private var model: CockpitModel
    @State private var category: FlightCategory = .all
    @State private var outcome: FlightOutcomeFilter = .all
    @State private var query = ""
    @State private var selectedID: String?

    public init(model: CockpitModel) { self.model = model }

    public var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 1_050
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(wide: wide)
                    metrics(columns: wide ? 4 : (proxy.size.width >= 720 ? 2 : 1))
                    filters
                    chronology(wide: wide)
                }
                .padding(proxy.size.width < 720 ? 14 : 22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Flight Recorder event and evidence explorer")
    }

    private var projection: FlightProjection { FlightProjection(model: model) }
    private var visibleRecords: [FlightRecord] { projection.filtered(category: category, outcome: outcome, query: query) }
    private var selectedRecord: FlightRecord? {
        if let selectedID, let selected = visibleRecords.first(where: { $0.id == selectedID }) { return selected }
        return visibleRecords.first
    }

    @ViewBuilder
    private func header(wide: Bool) -> some View {
        let title = VStack(alignment: .leading, spacing: 8) {
            Text("Flight Recorder: Chronological Event & Evidence Explorer")
                .font(.system(size: wide ? 35 : 27, weight: .black))
                .tracking(-1.05)
                .minimumScaleFactor(0.68)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text("Deterministic Event Ledger")
                    .font(.system(size: 12, weight: .bold))
                    .padding(.horizontal, 5)
                    .background(Color(red: 0.96, green: 0.75, blue: 0.28).opacity(0.78))
                    .rotationEffect(.degrees(-0.7))
                ZeroStatusBadge(projection.isRuntimeLive ? "RING-0 LIVE" : "HISTORICAL / OFFLINE",
                                symbol: projection.isRuntimeLive ? "record.circle" : "clock.badge.questionmark",
                                tone: projection.isRuntimeLive ? .healthy : .attention)
            }
            Text("Dense bounded runtime evidence and separately identified Codex bridge state. Missing timestamps, payloads, and proof are labelled rather than inferred.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }

        if wide {
            HStack(alignment: .bottom, spacing: 20) {
                title.frame(maxWidth: .infinity, alignment: .leading)
                unavailableOperations
            }
        } else {
            VStack(alignment: .leading, spacing: 12) { title; unavailableOperations }
        }
    }

    private var unavailableOperations: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ZeroStatusBadge("READ-ONLY EVIDENCE", symbol: "eye.fill", tone: .neutral)
            Text("No verify, export, audit, or recording-control primitive is exposed.")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
        }
    }

    private func metrics(columns: Int) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), alignment: .leading, spacing: 10) {
            NetworkFlightMetricCard(
                label: "Runtime events", value: projection.runtimeEventCountLabel,
                detail: projection.isRuntimeLive ? "Current durable event projection" : "Retained snapshot, not live",
                badge: projection.snapshot?.truncated["events"] == true ? "LOWER BOUND" : "BOUNDED",
                tone: projection.isRuntimeLive ? .healthy : .attention
            )
            NetworkFlightMetricCard(
                label: "WAL storage rate", value: "Unavailable",
                detail: "Storage throughput is not projected", badge: "NO METRIC", tone: .neutral
            )
            NetworkFlightMetricCard(
                label: "Attention outcomes", value: projection.interceptedCountLabel,
                detail: "Denied, failed, queued, or approval-waiting runtime rows", badge: "PROJECTED", tone: .attention
            )
            NetworkFlightMetricCard(
                label: "Causal verification", value: "Unavailable",
                detail: "No Merkle verification result in snapshot", badge: "NO PROOF", tone: .neutral
            )
        }
    }

    private var filters: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("EVIDENCE FILTER SCRUBBER", systemImage: "line.3.horizontal.decrease.circle")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                    Spacer()
                    ZeroStatusBadge("CURRENT BOUNDED PROJECTION", tone: .neutral)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(FlightCategory.allCases, id: \.self) { value in
                            ZeroFilterChip(value.rawValue, selected: category == value) { category = value }
                        }
                    }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(FlightOutcomeFilter.allCases, id: \.self) { value in
                            ZeroFilterChip(value.rawValue, selected: outcome == value) { outcome = value }
                        }
                    }
                }
                HStack(spacing: 9) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .accessibilityHidden(true)
                    TextField("Filter actor, channel, target, ID, or outcome", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .accessibilityLabel("Filter flight records")
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(ZeroButtonStyle(.quiet))
                            .focusEffectDisabled()
                            .accessibilityLabel("Clear record filter")
                    }
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 36)
                .background(ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(ZeroTheme.line))
                Text(projection.historyNotice)
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func chronology(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                recordsPanel.frame(maxWidth: .infinity, alignment: .top)
                inspector.frame(width: 410, alignment: .top)
            }
        } else {
            VStack(spacing: 14) { recordsPanel; inspector }
        }
    }

    private var recordsPanel: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                NetworkFlightSectionHeader("Ring-0 Event Chronology", badge: "\(visibleRecords.count) VISIBLE")
                if visibleRecords.isEmpty {
                    NetworkFlightEmptyState(
                        symbol: projection.records.isEmpty ? "tray" : "line.3.horizontal.decrease.circle",
                        title: projection.records.isEmpty ? "No projected evidence" : "No record matches these filters",
                        detail: projection.records.isEmpty ? "Connect to zerod or Codex to populate their separately identified evidence surfaces." : "Change a custom category, outcome, or text filter."
                    )
                } else {
                    ScrollView(.horizontal, showsIndicators: true) {
                        LazyVStack(spacing: 0) {
                            flightHeader
                            ForEach(visibleRecords) { record in flightRow(record) }
                        }
                        .frame(minWidth: 820)
                    }
                }
            }
        }
    }

    private var flightHeader: some View {
        HStack(spacing: 0) {
            flightCell("TIMESTAMP", width: 170, header: true)
            flightCell("ORIGIN / CHANNEL", width: 210, header: true)
            flightCell("ACTOR", width: 150, header: true)
            flightCell("EVIDENCE", width: 170, header: true)
            flightCell("OUTCOME", width: 120, header: true)
        }
        .background(ZeroTheme.navigation)
    }

    private func flightRow(_ record: FlightRecord) -> some View {
        let selected = selectedRecord?.id == record.id
        return Button { selectedID = record.id } label: {
            HStack(spacing: 0) {
                flightCell(record.timestamp, width: 170)
                flightCell("\(record.origin.rawValue)\n\(record.channel)", width: 210, lines: 2)
                flightCell(record.actor, width: 150)
                flightCell(record.evidence, width: 170)
                flightCell(record.outcome, width: 120, tone: flightTone(record.classification))
            }
            .contentShape(Rectangle())
            .background(selected ? ZeroTheme.orange.opacity(0.085) : Color.clear)
            .overlay(alignment: .leading) {
                if selected { ZeroTheme.orange.frame(width: 3) }
            }
            .overlay(alignment: .bottom) { ZeroTheme.line.opacity(0.7).frame(height: 1) }
        }
        .buttonStyle(.plain)
        .focusEffectDisabled()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(record.channel), \(record.outcome), \(record.origin.rawValue)")
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func flightCell(_ value: String, width: CGFloat, header: Bool = false, lines: Int = 1, tone: ZeroTone? = nil) -> some View {
        Text(value)
            .font(.system(size: header ? 9 : 10, weight: header ? .bold : .medium, design: .monospaced))
            .foregroundStyle(tone?.color ?? (header ? ZeroTheme.secondaryInk : ZeroTheme.ink))
            .multilineTextAlignment(.leading)
            .textSelection(.enabled)
            .lineLimit(lines)
            .frame(width: width, alignment: .leading)
            .frame(minHeight: 38, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
    }

    private var inspector: some View {
        NetworkFlightPanel {
            if let record = selectedRecord {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(record.evidence)
                                .font(.system(size: 17, weight: .black, design: .monospaced))
                                .textSelection(.enabled)
                            Text(record.timestamp)
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(ZeroTheme.secondaryInk)
                                .textSelection(.enabled)
                        }
                        Spacer(minLength: 8)
                        ZeroStatusBadge(record.outcome, tone: flightTone(record.classification))
                    }
                    HStack(spacing: 7) {
                        ZeroStatusBadge(record.origin.rawValue,
                                        symbol: record.origin == .runtime ? "externaldrive.badge.checkmark" : "memorychip",
                                        tone: record.origin == .runtime ? .authority : .attention)
                        ZeroStatusBadge(record.category.rawValue.uppercased(), tone: .neutral)
                    }
                    NetworkFlightEvidenceRows(rows: [
                        ("Channel", record.channel),
                        ("Actor", record.actor),
                        ("Reference", record.reference)
                    ])
                    VStack(alignment: .leading, spacing: 8) {
                        Label("SAFE EVIDENCE FIELDS", systemImage: "doc.text.magnifyingglass")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                        ScrollView(.horizontal, showsIndicators: true) {
                            NetworkFlightEvidenceRows(rows: record.fields.isEmpty ? [("Fields", "No allowlisted field projected")] : record.fields)
                                .frame(minWidth: 360)
                        }
                        Text(record.origin == .runtime
                            ? "The owner-local snapshot omits raw event payloads and results. Full evidence requires an authorized runtime operation not exposed here."
                            : "Only allowlisted identifiers and state are shown. Unknown Codex parameters are not rendered as raw payloads.")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(ZeroTheme.secondaryInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .background(Color(red: 0.95, green: 0.95, blue: 0.97), in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ZeroTheme.line))
                    Text("Mark audited, verify tree, export, and replay are unavailable because this projection supplies no exact owner-authorized primitive.")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                NetworkFlightEmptyState(symbol: "cursorarrow.click.2", title: "No record selected", detail: "Select a visible evidence row to inspect its bounded fields.")
            }
        }
    }
}

private func classify(_ status: String) -> FlightClassification {
    let value = status.uppercased()
    if ["ALLOW", "ALLOWED", "APPROVED", "APPROVED_EXECUTION", "SUCCEEDED", "SUCCESS", "PASS", "PASSED", "COMPLETED"].contains(value) {
        return .success
    }
    if ["DENY", "DENIED", "REJECTED", "FAILED", "CANCELLED", "EXPIRED", "TIMED_OUT", "QUEUED", "DISPATCHED", "WAITING", "WAITING_APPROVAL", "QUARANTINE", "QUARANTINED"].contains(value) {
        return .attention
    }
    return .neutral
}

private func flightTone(_ classification: FlightClassification) -> ZeroTone {
    switch classification {
    case .neutral: .neutral
    case .attention: .attention
    case .success: .healthy
    }
}

private func codexScalar(_ value: CodexJSON) -> String? {
    switch value {
    case .string(let text): return text.isEmpty ? nil : text
    case .integer(let number): return String(number)
    case .number(let number): return String(number)
    case .bool(let value): return value ? "true" : "false"
    default: return nil
    }
}

private func codexRequestIDLabel(_ id: CodexRequestID) -> String {
    switch id {
    case .string(let value): value
    case .integer(let value): String(value)
    }
}
