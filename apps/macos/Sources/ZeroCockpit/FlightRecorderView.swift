import SwiftUI
import ZeroKit

enum FlightOrigin: Equatable {
    case runtime
    case codex

    var defaultLabel: String {
        switch self {
        case .runtime: "ZEROD DURABLE"
        case .codex: "CODEX MEMORY"
        }
    }
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
    let originLabel: String
    let category: FlightCategory
    let timestamp: String
    let channel: String
    let actor: String
    let evidence: String
    let outcome: String
    let reference: String
    let fields: [(String, String)]
    let classification: FlightClassification
    /// Render/clock/SSE noise (display.*, clock.tick, sse.keepalive, ready)
    /// is hidden by default; the Show-all toggle reveals it.
    let isNoise: Bool

    init(id: String, origin: FlightOrigin, originLabel: String? = nil,
         category: FlightCategory, timestamp: String, channel: String,
         actor: String, evidence: String, outcome: String, reference: String,
         fields: [(String, String)], classification: FlightClassification,
         isNoise: Bool = false) {
        self.id = id
        self.origin = origin
        self.originLabel = originLabel ?? origin.defaultLabel
        self.category = category
        self.timestamp = timestamp
        self.channel = channel
        self.actor = actor
        self.evidence = evidence
        self.outcome = outcome
        self.reference = reference
        self.fields = fields
        self.classification = classification
        self.isNoise = isNoise
    }

    var searchableText: String {
        ([id, originLabel, category.rawValue, timestamp, channel, actor, evidence, outcome, reference]
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
        records = Self.orderByProjectedTime(
            Self.runtimeRecords(snapshot) + Self.codexRecords(codexStore, connection: codexConnection)
        )
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
    var codexEvidenceLabel: String {
        codexOriginLabel(for: codexConnection)
    }
    var codexConnectionNotice: String {
        switch codexConnection {
        case .connected:
            "Codex rows are live bounded memory; they are not durable runtime evidence."
        case .connecting:
            "Codex is connecting; any visible rows are retained bounded memory, not live evidence yet."
        case .disconnected:
            "Codex is disconnected; visible Codex rows are retained bounded memory, not live evidence."
        case .exited(let status):
            "Codex exited with status \(status); visible Codex rows are retained bounded memory, not live evidence."
        case .failed:
            "Codex failed; visible Codex rows are retained bounded memory, not live evidence."
        }
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
        let codexDrops = codexStore.truncation.threads + codexStore.truncation.turns + codexStore.truncation.items + codexStore.truncation.unknownEvents + codexStore.truncation.approvals
        if codexDrops > 0 || codexStore.truncation.metadata {
            notices.append("Codex memory history has dropped or clipped content.")
        }
        notices.append(codexConnectionNotice)
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
                classification: .neutral,
                isNoise: isNoiseRecord(record)
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

    private static func codexRecords(_ store: CodexEventStore, connection: CodexConnectionState) -> [FlightRecord] {
        var rows: [FlightRecord] = []
        let originLabel = codexOriginLabel(for: connection)
        for thread in store.threads.values.sorted(by: { $0.id < $1.id }) {
            let status = codexScalar(thread.status) ?? "STATE AVAILABLE"
            rows.append(FlightRecord(
                id: "codex-thread-\(thread.id)", origin: .codex, originLabel: originLabel, category: .codex,
                timestamp: "Not projected", channel: "thread/state", actor: "Codex app-server",
                evidence: thread.id, outcome: status,
                reference: thread.title.isEmpty ? "Untitled thread" : thread.title,
                fields: [("thread id", thread.id), ("title", thread.title.isEmpty ? "Unavailable" : thread.title), ("status", status)],
                classification: classify(status)
            ))
            for turn in thread.turns.values.sorted(by: { $0.id < $1.id }) {
                rows.append(FlightRecord(
                    id: "codex-turn-\(thread.id)-\(turn.id)", origin: .codex, originLabel: originLabel, category: .codex,
                    timestamp: "Not projected", channel: "turn/state", actor: "Codex app-server",
                    evidence: turn.id, outcome: turn.status, reference: thread.id,
                    fields: [("thread id", thread.id), ("turn id", turn.id), ("status", turn.status),
                             ("content", turn.contentTruncated ? "Truncated" : "Bounded")],
                    classification: classify(turn.status)
                ))
            }
            for item in thread.items {
                rows.append(FlightRecord(
                    id: "codex-item-\(thread.id)-\(item.id)", origin: .codex, originLabel: originLabel, category: .codex,
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
            let sequence = store.truncation.unknownEvents + index
            rows.append(FlightRecord(
                id: codexUnknownRecordID(event, sequence: sequence),
                origin: .codex, originLabel: originLabel, category: .codex,
                timestamp: "Not projected", channel: event.method, actor: "Codex app-server",
                evidence: fields.first(where: { $0.0 == "itemId" || $0.0 == "turnId" || $0.0 == "threadId" })?.1 ?? "Redacted metadata",
                outcome: status, reference: "UNHANDLED PROTOCOL EVENT · SEQ \(sequence)", fields: fields,
                classification: classify(status)
            ))
        }
        return rows
    }

    private static func orderByProjectedTime(_ records: [FlightRecord]) -> [FlightRecord] {
        // Parse each timestamp once. The previous comparator re-parsed both
        // operands on every comparison (O(n log n) ISO8601 parses per build,
        // ~38 s for 5000 records). Formatters stay per-call: DateFormatter is
        // not thread-safe, and two allocations are O(1) against the build.
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let wholeSecond = ISO8601DateFormatter()
        wholeSecond.formatOptions = [.withInternetDateTime]
        func date(_ value: String) -> Date? {
            // Both formats require the "T" date/time separator, so values
            // without one ("Not projected", "Unavailable", ...) can never
            // parse; skipping them returns the same nil faster.
            guard value.contains("T") else { return nil }
            return fractional.date(from: value) ?? wholeSecond.date(from: value)
        }
        let keys = records.map { date($0.timestamp) }
        return records.indices.sorted { lhs, rhs in
            switch (keys[lhs], keys[rhs]) {
            case let (left?, right?) where left != right: return left > right
            case (_?, nil): return true
            case (nil, _?): return false
            default: return lhs < rhs
            }
        }.map { records[$0] }
    }
}

enum FlightSelectionState: Equatable {
    case none
    case visible(String)
    case filtered(String)
    case unavailable(String)

    static func resolve(selectionID: String?, all: [FlightRecord], visible: [FlightRecord]) -> Self {
        guard let selectionID else { return .none }
        if visible.contains(where: { $0.id == selectionID }) { return .visible(selectionID) }
        if all.contains(where: { $0.id == selectionID }) { return .filtered(selectionID) }
        return .unavailable(selectionID)
    }
}

struct FlightRowPresentation: Equatable {
    let isSelected: Bool
    let isFocused: Bool

    var hasCustomFocusRing: Bool { isFocused }
    var focusRingWidth: CGFloat { isFocused ? 2 : 0 }
    var accessibilityValue: String {
        switch (isSelected, isFocused) {
        case (true, true): "Selected, keyboard focused"
        case (true, false): "Selected"
        case (false, true): "Keyboard focused"
        case (false, false): "Not selected"
        }
    }
}

enum FlightChronology {
    /// Bounded render cap for the main chronology list: the LazyVStack only
    /// instantiates visible rows, and anything beyond the cap collapses into
    /// the "+N more" overflow disclosure below.
    static let maxRenderedRows = 100
}

public struct FlightRecorderView: View {
    @ObservedObject private var model: CockpitModel
    @State private var category: FlightCategory = .all
    @State private var outcome: FlightOutcomeFilter = .all
    @State private var query = ""
    @FocusState private var focusedRecordID: String?

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

    private var projection: FlightProjection {
        ProjectionCache.shared.flightProjection(
            snapshot: model.snapshot,
            runtimeConnection: model.runtimeConnection,
            codexStore: model.codex.store,
            codexConnection: model.codexConnection
        )
    }
    private var visibleRecords: [FlightRecord] {
        let base = projection.filtered(category: category, outcome: outcome, query: query)
        guard !model.showAllRecords else { return base }
        return base.filter { !$0.isNoise }
    }
    private var selectionState: FlightSelectionState {
        FlightSelectionState.resolve(
            selectionID: model.selection.inspectionID,
            all: projection.records,
            visible: visibleRecords
        )
    }
    private var selectedRecord: FlightRecord? {
        guard case .visible(let id) = selectionState else { return nil }
        return visibleRecords.first { $0.id == id }
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
                    .background(ZeroTheme.markerYellow.opacity(0.78))
                    .rotationEffect(.degrees(-0.7))
                ZeroStatusBadge(projection.isRuntimeLive ? "RING-0 LIVE" : "HISTORICAL / OFFLINE",
                                symbol: projection.isRuntimeLive ? "record.circle" : "clock.badge.questionmark",
                                tone: projection.isRuntimeLive ? .healthy : .attention).equatable()
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
            ZeroStatusBadge("READ-ONLY EVIDENCE", symbol: "eye.fill", tone: .neutral).equatable()
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
                detail: "Denied, failed, dispatched, queued, or approval-waiting runtime rows", badge: "PROJECTED", tone: .attention
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
                Toggle("Show all records (include render/clock noise)", isOn: $model.showAllRecords)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .accessibilityLabel("Show all records")
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
                ResizablePane(.inspector(key: "flightRecorder.inspector", defaultWidth: 410)) {
                    inspector
                }
            }
        } else {
            VStack(spacing: 14) { recordsPanel; inspector }
        }
    }

    private var recordsPanel: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                NetworkFlightSectionHeader("Ring-0 Event Chronology", badge: "\(visibleRecords.count) VISIBLE").equatable()
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
                            ForEach(visibleRecords.prefix(FlightChronology.maxRenderedRows)) { record in flightRow(record) }
                            if visibleRecords.count > FlightChronology.maxRenderedRows {
                                Text("+\(visibleRecords.count - FlightChronology.maxRenderedRows) more matching records (bounded render)")
                                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                                    .foregroundStyle(ZeroTheme.secondaryInk)
                                    .padding(.vertical, 6)
                            }
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
        let presentation = FlightRowPresentation(
            isSelected: model.selection.inspectionID == record.id,
            isFocused: focusedRecordID == record.id
        )
        return Button { model.selection.inspectionID = record.id } label: {
            HStack(spacing: 0) {
                flightCell(record.timestamp, width: 170)
                flightCell("\(record.originLabel)\n\(record.channel)", width: 210, lines: 3)
                flightCell(record.actor, width: 150)
                flightCell(record.evidence, width: 170)
                flightCell(record.outcome, width: 120, tone: flightTone(record.classification))
            }
            .contentShape(Rectangle())
            .background(presentation.isSelected ? ZeroTheme.orange.opacity(0.085) : Color.clear)
            .overlay(alignment: .leading) {
                if presentation.isSelected { ZeroTheme.orange.frame(width: 3) }
            }
            .overlay(alignment: .bottom) { ZeroTheme.line.opacity(0.7).frame(height: 1) }
            .overlay {
                RoundedRectangle(cornerRadius: 4)
                    .strokeBorder(ZeroTheme.orange, lineWidth: presentation.focusRingWidth)
                    .opacity(presentation.hasCustomFocusRing ? 1 : 0)
            }
        }
        .buttonStyle(.plain)
        .focusable(true)
        .focused($focusedRecordID, equals: record.id)
        .focusEffectDisabled()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(record.channel), \(record.outcome), \(record.originLabel)")
        .accessibilityValue(presentation.accessibilityValue)
        .accessibilityAddTraits(presentation.isSelected ? .isSelected : [])
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
            InspectorPopoutButton(kind: .flightRecorder)
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
                        ZeroStatusBadge(record.originLabel,
                                        symbol: record.origin == .runtime ? "externaldrive.badge.checkmark" : "memorychip",
                                        tone: record.origin == .runtime ? .authority : .attention)
                        ZeroStatusBadge(record.category.rawValue.uppercased(), tone: .neutral)
                    }
                    NetworkFlightEvidenceRows(rows: [
                        ("Channel", record.channel),
                        ("Actor", record.actor),
                        ("Reference", record.reference)
                    ]).equatable()
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
                    .background(ZeroTheme.cardCream, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ZeroTheme.line))
                    Text("Mark audited, verify tree, export, and replay are unavailable because this projection supplies no exact owner-authorized primitive.")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if case .filtered(let id) = selectionState {
                staleOrFilteredSelection(
                    id: id,
                    title: "Selected record hidden by filters",
                    detail: "The exact shared selection is preserved. Change the filters or clear the selection; another row was not selected automatically."
                )
            } else if case .unavailable(let id) = selectionState {
                staleOrFilteredSelection(
                    id: id,
                    title: "Selected evidence is no longer retained",
                    detail: "The bounded source no longer contains this exact identity. Clear it explicitly; the inspector will not retarget to a different record."
                )
            } else {
                NetworkFlightEmptyState(symbol: "cursorarrow.click.2", title: "No record selected", detail: "Select a visible evidence row to inspect its bounded fields.")
            }
        }
    }

    private func staleOrFilteredSelection(id: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            NetworkFlightEmptyState(symbol: "scope", title: title, detail: detail)
            Text(id)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .textSelection(.enabled)
                .accessibilityLabel("Selected evidence identity")
                .accessibilityValue(id)
            Button("Clear exact selection") { model.selection.inspectionID = nil }
                .buttonStyle(ZeroButtonStyle(.quiet))
                .focusEffectDisabled()
        }
    }
}

func isNoiseRecord(_ record: RuntimeRecord) -> Bool {
    let kind = (runtimeText(record, keys: ["kind"]) ?? "").lowercased()
    return kind.hasPrefix("display.") || kind == "clock.tick" || kind == "sse.keepalive" || kind == "ready"
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

private func codexOriginLabel(for connection: CodexConnectionState) -> String {
    switch connection {
    case .connected: "CODEX LIVE MEMORY"
    case .connecting: "CODEX RETAINED MEMORY · CONNECTING"
    case .disconnected: "CODEX RETAINED MEMORY · DISCONNECTED"
    case .exited(let status): "CODEX RETAINED MEMORY · EXITED \(status)"
    case .failed: "CODEX RETAINED MEMORY · FAILED"
    }
}

private func codexUnknownRecordID(_ event: CodexEvent, sequence: Int) -> String {
    var identity = [event.method]
    if case .request(let id, _, _) = event {
        identity.append("request=\(codexRequestIDLabel(id))")
    }
    for key in ["threadId", "turnId", "itemId", "status", "type", "model"] {
        if let value = codexScalar(event.params[key]) {
            identity.append("\(key)=\(value)")
        }
    }

    var digest: UInt64 = 14_695_981_039_346_656_037
    for byte in identity.joined(separator: "\u{1f}").utf8 {
        digest ^= UInt64(byte)
        digest &*= 1_099_511_628_211
    }
    return "codex-event-\(String(digest, radix: 16))-\(sequence)"
}
