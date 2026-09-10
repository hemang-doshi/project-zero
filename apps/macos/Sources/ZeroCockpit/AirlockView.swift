import SwiftUI
import ZeroKit

func airlockPendingCount(approvals: [String], firings: [String]) -> Int { approvals.count + firings.count }

enum AirlockOrigin: String, Equatable, Sendable {
    case runtime = "PROJECT ZERO"
    case codex = "CODEX"
}

enum AirlockAuthority: Equatable, Sendable {
    case runtime(id: String)
    case codex(id: CodexRequestID)
}

enum AirlockEvidenceFreshness: Equatable, Sendable {
    case live
    case retained
    case expired
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
    let freshness: AirlockEvidenceFreshness
    let isExpired: Bool
    let allowsApprove: Bool
    let allowsDeny: Bool
    let responseUnavailableReason: String?

    var accessibilitySummary: String {
        var parts = [
            "\(origin.rawValue) approval \(requestID)",
            "action \(action)",
            "target \(target)"
        ]
        if isExpired {
            parts.append("deadline expired")
        }
        if freshness == .retained {
            parts.append(origin == .runtime ? "retained cached evidence" : "retained in-memory evidence")
        }
        return parts.joined(separator: ", ")
    }
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
            codexConnection: model.codexConnection,
            now: model.clock
        )
    }

    init(
        snapshot: CockpitSnapshot?,
        runtimeConnection: RuntimeConnectionState,
        codexStore: CodexEventStore,
        codexConnection: CodexConnectionState,
        now: Date = Date()
    ) {
        self.snapshot = snapshot
        self.runtimeConnection = runtimeConnection
        self.codexConnection = codexConnection
        approvals = Self.runtimeApprovals(snapshot, connection: runtimeConnection, now: now)
            + Self.codexApprovals(codexStore, connection: codexConnection)
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
    var actionableApprovalCount: Int { approvals.filter { canApprove($0) || canDeny($0) }.count }

    var runtimeConnectionLabel: String {
        let retained = snapshot == nil ? "" : " · CACHED"
        switch runtimeConnection {
        case .live: return "ZEROD LIVE"
        case .connecting: return "ZEROD CONNECTING\(retained)"
        case .reconnecting: return "ZEROD RECONNECTING\(retained)"
        case .offline: return "ZEROD OFFLINE\(retained)"
        }
    }

    var codexConnectionLabel: String {
        switch codexConnection {
        case .connected: return "CODEX CONNECTED"
        case .connecting: return "CODEX CONNECTING"
        case .disconnected: return "CODEX DISCONNECTED"
        case .exited(let status): return "CODEX EXITED \(status)"
        case .failed: return "CODEX FAILED"
        }
    }

    func item(selectionID: String?) -> AirlockApprovalItem? {
        guard let selectionID else { return nil }
        return approvals.first { $0.id == selectionID }
    }

    func canApprove(_ item: AirlockApprovalItem) -> Bool {
        guard item.authority != nil, item.allowsApprove else { return false }
        switch item.authority {
        case .runtime: return runtimeIsLive
        case .codex: return codexIsConnected
        case nil: return false
        }
    }

    func canDeny(_ item: AirlockApprovalItem) -> Bool {
        guard item.authority != nil, item.allowsDeny else { return false }
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

    private static func runtimeApprovals(
        _ snapshot: CockpitSnapshot?,
        connection: RuntimeConnectionState,
        now: Date
    ) -> [AirlockApprovalItem] {
        guard let snapshot else { return [] }
        return snapshot.approvals.enumerated().map { index, record in
            let authorityID = strictRuntimeString(record["id"])
            let requestID = authorityID ?? "Unavailable"
            let actionValue = strictRuntimeString(record["capability"])
            let targetValue = strictRuntimeString(record["node"])
            let deadlineValue = strictRuntimeString(record["deadline"])
            let decisionValue = strictRuntimeString(record["status"])
            let action = actionValue ?? "Unavailable"
            let target = targetValue ?? "Unavailable"
            let deadline = deadlineValue ?? "Unavailable"
            let decision = decisionValue ?? "Unavailable"
            let omitted = record["input_omitted"].bool == true
            let parsedDeadline = deadlineValue.flatMap(parseRuntimeDeadline)
            let identityIsComplete = authorityID != nil && actionValue != nil && targetValue != nil
                && parsedDeadline != nil && decisionValue == "WAITING_APPROVAL"
            let expired = parsedDeadline.map { now >= $0 } ?? false
            let freshness: AirlockEvidenceFreshness
            if connection != .live { freshness = .retained }
            else if expired { freshness = .expired }
            else { freshness = .live }
            var evidence = [
                AirlockEvidenceField("Request ID", requestID, authoritative: true),
                AirlockEvidenceField("Action", action),
                AirlockEvidenceField("Target", target),
                AirlockEvidenceField("Source", "Project Zero · zerod"),
                AirlockEvidenceField("Deadline", deadline),
                AirlockEvidenceField("Decision", decision)
            ]
            if let hash = networkRuntimeText(record, keys: ["hash"]) {
                evidence.append(AirlockEvidenceField("Invocation hash", hash))
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
                detail: runtimeDetail(connection: connection, expired: expired, omitted: omitted),
                authority: identityIsComplete ? authorityID.map(AirlockAuthority.runtime(id:)) : nil,
                evidence: evidence,
                inputOmitted: omitted,
                displayTruncated: false,
                freshness: freshness,
                isExpired: expired,
                allowsApprove: identityIsComplete && !expired,
                allowsDeny: identityIsComplete,
                responseUnavailableReason: identityIsComplete
                    ? nil
                    : "Required runtime identity, state, or RFC3339 deadline fields are unavailable or have the wrong type."
            )
        }
    }

    private static func codexApprovals(
        _ store: CodexEventStore,
        connection: CodexConnectionState
    ) -> [AirlockApprovalItem] {
        store.approvals.map { approval in
            let requestID = codexRequestLabel(approval.id)
            let params = approval.params
            let threadID = strictCodexString(params["threadId"])
            let turnID = strictCodexString(params["turnId"])
            let itemID = strictCodexString(params["itemId"])
            let startedAtMS = params["startedAtMs"].integer.flatMap { $0 >= 0 ? $0 : nil }
            let command = boundedCodexText(params["command"].string)
            let cwd = boundedCodexText(params["cwd"].string)
            let grantRoot = boundedCodexText(params["grantRoot"].string)
            let reason = boundedCodexText(params["reason"].string)
            let target = command.value ?? grantRoot.value ?? cwd.value ?? itemID ?? "Unavailable"
            let source = threadID.map { "Codex app-server · thread \($0)" } ?? "Codex app-server"
            let methodValidation = validateCodexParams(method: approval.method, params: params)
            let advertised = advertisedDecisions(method: approval.method, params: params)
            var evidence = [
                AirlockEvidenceField("Request ID", requestID, authoritative: true),
                AirlockEvidenceField("Action", approval.method, authoritative: true),
                AirlockEvidenceField("Target", target),
                AirlockEvidenceField("Source", source),
                AirlockEvidenceField("Deadline", "Not supplied by app-server"),
                AirlockEvidenceField("Decision", "AWAITING_RESPONSE")
            ]
            for (label, value) in [
                ("Thread ID", threadID), ("Turn ID", turnID), ("Item ID", itemID),
                ("Started at (ms)", startedAtMS.map(String.init)),
                ("Working directory", cwd.value), ("Grant root", grantRoot.value),
                ("Command", command.value), ("Reason", reason.value),
                ("Kind", strictCodexString(params["kind"])),
                ("Approval callback", strictCodexString(params["approvalId"])),
                ("Environment ID", strictCodexString(params["environmentId"]))
            ] {
                if let value { evidence.append(AirlockEvidenceField(label, value)) }
            }
            for (label, key) in [
                ("Additional permissions", "additionalPermissions"),
                ("Available decisions", "availableDecisions"),
                ("Command actions", "commandActions"),
                ("Proposed execpolicy amendment", "proposedExecpolicyAmendment"),
                ("Proposed network policy amendments", "proposedNetworkPolicyAmendments"),
                ("Network approval context", "networkApprovalContext")
            ] where params[key] != .null {
                evidence.append(AirlockEvidenceField(label, canonicalCodexJSON(params[key])))
            }
            evidence.append(AirlockEvidenceField("Full request parameters", canonicalCodexJSON(params)))
            let truncated = command.truncated || cwd.truncated || grantRoot.truncated || reason.truncated
            let supportsBinaryDecision = codexDecisionResponse(method: approval.method, approve: true) != nil
            let canAnswer = supportsBinaryDecision && methodValidation == nil
                && threadID != nil && turnID != nil && itemID != nil && startedAtMS != nil
            let unavailableReason: String?
            if let methodValidation {
                unavailableReason = methodValidation
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
                detail: codexDetail(connection: connection, advertised: advertised, supported: supportsBinaryDecision),
                authority: canAnswer ? .codex(id: approval.id) : nil,
                evidence: evidence,
                inputOmitted: false,
                displayTruncated: truncated,
                freshness: connection == .connected ? .live : .retained,
                isExpired: false,
                allowsApprove: canAnswer && advertised.approve,
                allowsDeny: canAnswer && advertised.deny,
                responseUnavailableReason: unavailableReason
            )
        }
    }

    private struct CodexDecisionAvailability {
        let approve: Bool
        let deny: Bool
    }

    private static func strictRuntimeString(_ value: RuntimeValue) -> String? {
        guard case .string(let text) = value, !text.isEmpty else { return nil }
        return text
    }

    private static func strictCodexString(_ value: CodexJSON) -> String? {
        guard case .string(let text) = value, !text.isEmpty else { return nil }
        return text
    }

    private static func parseRuntimeDeadline(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let wholeSeconds = ISO8601DateFormatter()
        wholeSeconds.formatOptions = [.withInternetDateTime]
        return wholeSeconds.date(from: value)
    }

    private static func runtimeDetail(
        connection: RuntimeConnectionState,
        expired: Bool,
        omitted: Bool
    ) -> String {
        if expired, connection != .live {
            return "The approval deadline has passed. This is retained snapshot evidence while \(runtimeConnectionDescription(connection)). Runtime actions are disabled until a fresh live snapshot arrives; the retained WAITING_APPROVAL row is not treated as a terminal denial."
        }
        if connection != .live {
            return "This is retained snapshot evidence while \(runtimeConnectionDescription(connection)). Runtime actions are disabled until a fresh live snapshot arrives."
        }
        if expired {
            return "The approval deadline has passed. Approval is disabled; the daemon's exact deny operation remains available for this retained WAITING_APPROVAL row, which is not treated as a terminal denial."
        }
        if omitted {
            return "The live daemon retained the full invocation. This bounded display projection omits one or more input fields; actions route only the exact request ID."
        }
        return "The live daemon is holding this exact invocation for an explicit owner decision."
    }

    private static func runtimeConnectionDescription(_ connection: RuntimeConnectionState) -> String {
        switch connection {
        case .live: return "zerod is live"
        case .connecting: return "zerod is connecting"
        case .reconnecting: return "zerod is reconnecting"
        case .offline: return "zerod is offline"
        }
    }

    private static func codexDetail(
        connection: CodexConnectionState,
        advertised: CodexDecisionAvailability,
        supported: Bool
    ) -> String {
        guard connection == .connected else {
            return "This is retained in-memory request evidence while \(codexConnectionDescription(connection)). Responses are disabled until the same app-server connection is live."
        }
        guard supported else {
            return "This request uses a method-specific response schema and cannot be answered by Airlock's exact accept/decline controls."
        }
        if !advertised.approve || !advertised.deny {
            return "Codex is paused at this exact JSON-RPC request. Only decisions advertised by this request are enabled below."
        }
        return "Codex is paused at this exact JSON-RPC request until the owner answers."
    }

    private static func codexConnectionDescription(_ connection: CodexConnectionState) -> String {
        switch connection {
        case .connected: return "Codex is connected"
        case .connecting: return "Codex is connecting"
        case .disconnected: return "Codex is disconnected"
        case .exited(let status): return "Codex exited with status \(status)"
        case .failed: return "Codex failed"
        }
    }

    private static func advertisedDecisions(method: String, params: CodexJSON) -> CodexDecisionAvailability {
        guard method == "item/commandExecution/requestApproval" else {
            return CodexDecisionAvailability(
                approve: method == "item/fileChange/requestApproval",
                deny: method == "item/fileChange/requestApproval"
            )
        }
        switch params["availableDecisions"] {
        case .null:
            // The field is nullable for compatibility; the method's response schema
            // itself advertises exact accept and decline variants.
            return CodexDecisionAvailability(approve: true, deny: true)
        case .array(let decisions):
            return CodexDecisionAvailability(
                approve: decisions.contains(.string("accept")),
                deny: decisions.contains(.string("decline"))
            )
        default:
            return CodexDecisionAvailability(approve: false, deny: false)
        }
    }

    private static func validateCodexParams(method: String, params: CodexJSON) -> String? {
        guard case .object = params else {
            return "The Codex request parameters are not an object. The request is display-only."
        }
        guard strictCodexString(params["threadId"]) != nil,
              strictCodexString(params["turnId"]) != nil,
              strictCodexString(params["itemId"]) != nil,
              let startedAt = params["startedAtMs"].integer,
              startedAt >= 0 else {
            return "Required Codex thread, turn, item, or start-time fields are missing or have the wrong type."
        }
        switch method {
        case "item/commandExecution/requestApproval":
            guard optionalString(params["command"]),
                  optionalString(params["cwd"]),
                  optionalString(params["environmentId"]),
                  optionalString(params["reason"]),
                  optionalString(params["approvalId"]),
                  validCommandKind(params["kind"]),
                  validAdditionalPermissions(params["additionalPermissions"]),
                  validAvailableDecisions(params["availableDecisions"]),
                  validCommandActions(params["commandActions"]),
                  validStringArray(params["proposedExecpolicyAmendment"]),
                  validNetworkAmendments(params["proposedNetworkPolicyAmendments"]),
                  validNetworkContext(params["networkApprovalContext"]) else {
                return "One or more command approval fields do not match the advertised app-server schema."
            }
            return nil
        case "item/fileChange/requestApproval":
            guard optionalString(params["grantRoot"]), optionalString(params["reason"]) else {
                return "One or more file-change approval fields do not match the advertised app-server schema."
            }
            return nil
        default:
            return "Airlock has no exact response schema for this Codex request method."
        }
    }

    private static func optionalString(_ value: CodexJSON) -> Bool {
        switch value { case .null, .string: return true; default: return false }
    }

    private static func validCommandKind(_ value: CodexJSON) -> Bool {
        switch value {
        case .null: return true
        case .string(let kind): return kind == "command" || kind == "writeStdin"
        default: return false
        }
    }

    private static func validAdditionalPermissions(_ value: CodexJSON) -> Bool {
        guard case .object(let profile) = value else { return value == .null }
        return validFileSystemPermissions(profile["fileSystem"] ?? .null)
            && validNetworkPermissions(profile["network"] ?? .null)
    }

    private static func validFileSystemPermissions(_ value: CodexJSON) -> Bool {
        guard case .object(let permissions) = value else { return value == .null }
        guard validStringArray(permissions["read"] ?? .null),
              validStringArray(permissions["write"] ?? .null),
              validFileSystemEntries(permissions["entries"] ?? .null) else { return false }
        switch permissions["globScanMaxDepth"] ?? .null {
        case .null: return true
        case .integer(let depth): return depth >= 1
        default: return false
        }
    }

    private static func validFileSystemEntries(_ value: CodexJSON) -> Bool {
        guard case .array(let entries) = value else { return value == .null }
        return entries.allSatisfy { entry in
            guard case .object(let fields) = entry,
                  case .string(let access) = fields["access"],
                  ["read", "write", "deny"].contains(access),
                  let path = fields["path"] else { return false }
            return validFileSystemPath(path)
        }
    }

    private static func validFileSystemPath(_ value: CodexJSON) -> Bool {
        guard case .object(let fields) = value, case .string(let type) = fields["type"] else { return false }
        switch type {
        case "path": return strictCodexString(fields["path"] ?? .null) != nil
        case "glob_pattern": return strictCodexString(fields["pattern"] ?? .null) != nil
        case "special": return validSpecialPath(fields["value"] ?? .null)
        default: return false
        }
    }

    private static func validSpecialPath(_ value: CodexJSON) -> Bool {
        guard case .object(let fields) = value, case .string(let kind) = fields["kind"] else { return false }
        switch kind {
        case "root", "minimal", "tmpdir", "slash_tmp": return true
        case "project_roots": return optionalString(fields["subpath"] ?? .null)
        case "unknown":
            return strictCodexString(fields["path"] ?? .null) != nil
                && optionalString(fields["subpath"] ?? .null)
        default: return false
        }
    }

    private static func validNetworkPermissions(_ value: CodexJSON) -> Bool {
        guard case .object(let permissions) = value else { return value == .null }
        switch permissions["enabled"] ?? .null {
        case .null, .bool: return true
        default: return false
        }
    }

    private static func validAvailableDecisions(_ value: CodexJSON) -> Bool {
        guard case .array(let decisions) = value else { return value == .null }
        return decisions.allSatisfy(validDecision)
    }

    private static func validDecision(_ value: CodexJSON) -> Bool {
        if case .string(let decision) = value {
            return ["accept", "acceptForSession", "decline", "cancel"].contains(decision)
        }
        guard case .object(let fields) = value else { return false }
        if case .object(let amendment) = fields["acceptWithExecpolicyAmendment"] {
            return validRequiredStringArray(amendment["execpolicy_amendment"] ?? .null)
        }
        if case .object(let wrapper) = fields["applyNetworkPolicyAmendment"] {
            return validNetworkAmendment(wrapper["network_policy_amendment"] ?? .null)
        }
        return false
    }

    private static func validCommandActions(_ value: CodexJSON) -> Bool {
        guard case .array(let actions) = value else { return value == .null }
        return actions.allSatisfy { action in
            guard case .object(let fields) = action,
                  let type = strictCodexString(fields["type"] ?? .null),
                  strictCodexString(fields["command"] ?? .null) != nil else { return false }
            switch type {
            case "read":
                return strictCodexString(fields["name"] ?? .null) != nil
                    && strictCodexString(fields["path"] ?? .null) != nil
            case "listFiles": return optionalString(fields["path"] ?? .null)
            case "search":
                return optionalString(fields["path"] ?? .null)
                    && optionalString(fields["query"] ?? .null)
            case "unknown": return true
            default: return false
            }
        }
    }

    private static func validStringArray(_ value: CodexJSON) -> Bool {
        guard case .array(let values) = value else { return value == .null }
        return values.allSatisfy { if case .string = $0 { return true }; return false }
    }

    private static func validRequiredStringArray(_ value: CodexJSON) -> Bool {
        guard case .array(let values) = value else { return false }
        return values.allSatisfy { if case .string = $0 { return true }; return false }
    }

    private static func validNetworkAmendments(_ value: CodexJSON) -> Bool {
        guard case .array(let amendments) = value else { return value == .null }
        return amendments.allSatisfy(validNetworkAmendment)
    }

    private static func validNetworkAmendment(_ value: CodexJSON) -> Bool {
        guard case .object(let fields) = value,
              let host = strictCodexString(fields["host"] ?? .null), !host.isEmpty,
              case .string(let action) = fields["action"] else { return false }
        return action == "allow" || action == "deny"
    }

    private static func validNetworkContext(_ value: CodexJSON) -> Bool {
        guard case .object(let fields) = value,
              strictCodexString(fields["host"] ?? .null) != nil,
              case .string(let networkProtocol) = fields["protocol"] else { return value == .null }
        return ["http", "https", "socks5Tcp", "socks5Udp"].contains(networkProtocol)
    }

    private static func canonicalCodexJSON(_ value: CodexJSON) -> String {
        guard let encoded = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: encoded),
              let canonical = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else {
            return "Unavailable"
        }
        return String(decoding: canonical, as: UTF8.self)
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
    @State private var inspectorPanel: PanelSelection = .primary

    public init(model: CockpitModel) { self.model = model }

    private var projection: AirlockProjection { AirlockProjection(model: model) }

    public var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 1_060
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(wide: wide)
                    statsRow(columns: proxy.size.width >= 900 ? 4 : (proxy.size.width >= 620 ? 2 : 1))
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
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Airlock: Local Boundary & Outbound Egress Gate")
                    .font(.title2.weight(.black))
                    .tracking(-0.6)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                ZeroStatusBadge(
                    "EXPLICIT LOCAL AUTHORITY",
                    symbol: "lock.shield.fill",
                    tone: .error
                )
            }
            Text("Every visible live or retained request remains attached to its original authority ID. Display-only summaries never become action payloads.")
                .font(.body)
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        let statuses = HStack(spacing: 7) {
            ZeroStatusBadge(
                projection.runtimeConnectionLabel,
                symbol: runtimeConnectionSymbol,
                tone: runtimeConnectionTone
            )
            ZeroStatusBadge(
                projection.codexConnectionLabel,
                symbol: projection.codexIsConnected ? "bolt.horizontal.circle.fill" : "bolt.slash",
                tone: codexConnectionTone
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

    private func statsRow(columns: Int) -> some View {
        // Count directly from the projection arrays: every bounded approval and
        // firing row is pending evidence, whether or not it carries display IDs.
        let pending = airlockPendingCount(
            approvals: projection.approvals.map(\.id),
            firings: projection.snapshot?.firings.indices.map { "firing-\($0)" } ?? []
        )
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
            statCell(value: "\(pending)", label: "PENDING")
            statCell(value: String(projection.runtimeApprovalCount), label: "PROJECT ZERO")
            statCell(value: String(projection.codexApprovalCount), label: "CODEX")
            statCell(
                value: "\(projection.audit.count)\(projection.snapshot?.truncated["audit"] == true ? "+" : "")",
                label: "AUDITED"
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Airlock pending stats")
    }

    private func statCell(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.monospaced())
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(label)
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(ZeroTheme.secondaryInk)
                .lineSpacing(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func approvalWorkspace(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                approvalQueue.frame(maxWidth: .infinity, alignment: .top)
                ResizablePane(.inspector(key: "airlock.inspector", defaultWidth: 390)) {
                    PanelHost(selected: $inspectorPanel, options: [.primary]) { _ in
                        VStack(alignment: .leading, spacing: 8) {
                            InspectorPopoutButton(kind: .airlock)
                            InspectorView(model: model)
                        }
                    }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 14) {
                approvalQueue
                PanelHost(selected: $inspectorPanel, options: [.primary]) { _ in
                    InspectorView(model: model)
                }
            }
        }
    }

    private var approvalQueue: some View {
        NetworkFlightPanel {
            VStack(alignment: .leading, spacing: 12) {
                NetworkFlightSectionHeader(
                    "Outbound & Tool Boundary Requests",
                    badge: projection.approvalCountLabel + " VISIBLE"
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
        if projection.runtimeConnection == .connecting {
            return "zerod is connecting. No current runtime decision can be inferred from an empty projection."
        }
        if projection.runtimeConnection == .reconnecting {
            return "zerod is reconnecting. No current runtime decision can be inferred from an empty projection."
        }
        if !projection.runtimeIsLive && !projection.codexIsConnected {
            return "Neither authority channel is live. No pending decision can be inferred."
        }
        if !projection.runtimeIsLive {
            return "zerod is offline. Connected Codex approvals would still appear independently here."
        }
        return "No approval is present in the current bounded runtime or Codex projection."
    }

    private func approvalCard(_ item: AirlockApprovalItem) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Image(systemName: item.origin == .runtime ? "lock.shield.fill" : "terminal.fill")
                    .font(.headline)
                    .foregroundStyle(item.origin == .runtime ? ZeroTheme.orangePressed : ZeroTone.attention.color)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.action)
                        .font(.headline.monospaced())
                        .lineSpacing(2)
                        .textSelection(.enabled)
                    Text(item.target)
                        .font(.caption.monospaced())
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .lineSpacing(2)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 5) {
                    ZeroStatusBadge(item.origin.rawValue, tone: item.origin == .runtime ? .authority : .attention)
                    ZeroStatusBadge(freshnessLabel(item), tone: freshnessTone(item))
                    if item.isExpired, item.freshness != .expired {
                        ZeroStatusBadge("EXPIRED", tone: .error)
                    }
                }
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
        .accessibilityLabel(item.accessibilitySummary)
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
    }

    private var runtimeConnectionTone: ZeroTone {
        switch projection.runtimeConnection {
        case .live: return .healthy
        case .connecting, .reconnecting: return .attention
        case .offline: return .error
        }
    }

    private var runtimeConnectionSymbol: String {
        switch projection.runtimeConnection {
        case .live: return "checkmark.circle.fill"
        case .connecting: return "ellipsis.circle.fill"
        case .reconnecting: return "arrow.triangle.2.circlepath.circle.fill"
        case .offline: return "wifi.slash"
        }
    }

    private var codexConnectionTone: ZeroTone {
        switch projection.codexConnection {
        case .connected: return .healthy
        case .connecting: return .attention
        case .disconnected: return .neutral
        case .exited, .failed: return .error
        }
    }

    private func freshnessLabel(_ item: AirlockApprovalItem) -> String {
        switch item.freshness {
        case .live: return "LIVE REQUEST"
        case .retained: return "CACHED EVIDENCE"
        case .expired: return "EXPIRED"
        }
    }

    private func freshnessTone(_ item: AirlockApprovalItem) -> ZeroTone {
        switch item.freshness {
        case .live: return .healthy
        case .retained: return .neutral
        case .expired: return .error
        }
    }

    private func authorityDatum(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2.weight(.bold).monospaced())
                .foregroundStyle(ZeroTheme.secondaryInk)
                .lineSpacing(2)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(value)
                    .font(.caption.monospaced())
                    .lineSpacing(2)
                    .textSelection(.enabled)
                    .fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func lowerEvidence(wide: Bool) -> some View {
        if wide {
            HStack(alignment: .top, spacing: 14) {
                auditLedger.frame(maxWidth: .infinity)
                ResizablePane(.explorer(key: "airlock.policy", defaultWidth: 330)) {
                    policyPanel
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 14) { auditLedger; policyPanel }
        }
    }

    private var auditLedger: some View {
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
                        ForEach(projection.audit.prefix(100)) {
                            auditRow(time: $0.time, action: $0.action, target: $0.target, actor: $0.actor, decision: $0.decision, evidence: $0.evidence)
                        }
                        if projection.audit.count > 100 {
                            Text("+\(projection.audit.count - 100) more audit rows in the bounded snapshot")
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(ZeroTheme.secondaryInk)
                                .padding(.vertical, 6)
                        }
                    }
                    .frame(minWidth: 800)
                }
            }
            if projection.snapshot?.truncated["audit"] == true {
                disclosureNotice(
                    "The daemon reports additional audit decisions beyond this bounded projection. The visible count is a lower bound.",
                    tone: .attention
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Image(systemName: policy.enabled ? "checkmark.shield.fill" : "shield.slash")
                            .foregroundStyle(policy.enabled ? ZeroTone.healthy.color : ZeroTheme.secondaryInk)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(policy.id).font(.caption.weight(.bold).monospaced()).lineSpacing(2).textSelection(.enabled)
                            Text(policy.status).font(.caption2.monospaced()).foregroundStyle(ZeroTheme.secondaryInk).lineSpacing(2)
                        }
                        Spacer()
                        ZeroStatusBadge(policy.enabled ? "ENABLED" : policy.status, tone: policy.enabled ? .healthy : .neutral)
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            Label("Deny exact request", systemImage: "xmark.circle.fill")
        }
        .buttonStyle(AirlockDenyButtonStyle())
        .focusEffectDisabled()
        .disabled(!projection.canDeny(item))
        .accessibilityLabel("Deny exact request \(item.requestID) for \(item.target)")

        Button {
            resolve(approve: true)
        } label: {
            Label("Approve exact request", systemImage: "lock.open.fill")
        }
        .buttonStyle(ZeroButtonStyle(.authority))
        .focusEffectDisabled()
        .disabled(!projection.canApprove(item))
        .accessibilityLabel("Approve exact request \(item.requestID) for \(item.target)")
    }

    private func resolve(approve: Bool) {
        switch item.authority {
        case .runtime(let id):
            guard approve ? projection.canApprove(item) : projection.canDeny(item) else { return }
            Task { await model.resolveRuntimeApproval(id: id, approve: approve) }
        case .codex(let id):
            guard approve ? projection.canApprove(item) : projection.canDeny(item) else { return }
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
