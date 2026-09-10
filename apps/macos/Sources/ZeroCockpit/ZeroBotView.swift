import SwiftUI
import ZeroKit

enum ZeroBotItemCategory: String, Equatable, Sendable {
    case operatorMessage = "OPERATOR"
    case agentMessage = "ZERO BOT"
    case reasoning = "REASONING"
    case plan = "PLAN"
    case command = "COMMAND"
    case fileChange = "FILE CHANGE"
    case tool = "TOOL"
    case other = "PROTOCOL ITEM"

    init(kind: String) {
        let value = kind.lowercased()
        if value.contains("user") || value.contains("operator") { self = .operatorMessage }
        else if value.contains("agentmessage") || value.contains("assistant") { self = .agentMessage }
        else if value.contains("reasoning") { self = .reasoning }
        else if value.contains("plan") { self = .plan }
        else if value.contains("commandexecution") || value.contains("terminal") { self = .command }
        else if value.contains("filechange") || value.contains("diff") { self = .fileChange }
        else if value.contains("tool") || value.contains("search") || value.contains("image") { self = .tool }
        else { self = .other }
    }
}

struct ZeroBotModelOption: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let advertised: Bool
}

struct ZeroBotProjectBinding: Codable, Equatable, Sendable {
    let projectID: String
    let name: String
    let path: String

    init(projectID: String, name: String, path: String) {
        self.projectID = projectID
        self.name = name
        self.path = path
    }

    init(_ project: CockpitProject) {
        self.init(projectID: project.id, name: project.name, path: project.path)
    }
}

enum ZeroBotProjectBindingCodec {
    static func decode(_ encoded: String) -> [String: ZeroBotProjectBinding] {
        guard let data = encoded.data(using: .utf8),
              let bindings = try? JSONDecoder().decode([String: ZeroBotProjectBinding].self, from: data) else {
            return [:]
        }
        return bindings
    }

    static func encode(_ bindings: [String: ZeroBotProjectBinding]) -> String {
        guard let data = try? JSONEncoder().encode(bindings) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
}

struct ZeroBotEvidence: Equatable, Sendable {
    let title: String
    let content: String
    let truncated: Bool
}

struct ZeroBotMetadataField: Equatable, Sendable {
    let label: String
    let value: String
}

enum ZeroBotApprovalAvailability: Equatable, Sendable {
    case actionable
    case blocked(String)

    var reason: String? {
        if case .blocked(let reason) = self { return reason }
        return nil
    }
}

struct ZeroBotThreadPresentation: Equatable {
    let label: String
    let symbol: String
    let tone: ZeroTone
}

enum ZeroBotTypography {
    static let usesDynamicTypeRelativeStyles = true
    static let minimumProminentStyle: Font.TextStyle = .caption2

    static func font(
        _ style: Font.TextStyle,
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(style, design: design, weight: weight)
    }
}

struct ZeroBotProjection {
    let snapshot: CockpitSnapshot?
    let runtimeConnection: RuntimeConnectionState
    let connection: CodexConnectionState
    let store: CodexEventStore
    let threadSettings: [String: CodexSettings]
    let threadProjects: [String: ZeroBotProjectBinding]
    let models: [CodexJSON]

    @MainActor
    init(model: CockpitModel, threadProjects: [String: ZeroBotProjectBinding] = [:]) {
        self.init(
            snapshot: model.snapshot,
            runtimeConnection: model.runtimeConnection,
            connection: model.codexConnection,
            store: model.codex.store,
            threadSettings: model.codex.threadSettings,
            threadProjects: threadProjects,
            models: model.codex.models
        )
    }

    init(
        snapshot: CockpitSnapshot?,
        runtimeConnection: RuntimeConnectionState = .live,
        connection: CodexConnectionState,
        store: CodexEventStore,
        threadSettings: [String: CodexSettings],
        threadProjects: [String: ZeroBotProjectBinding] = [:],
        models: [CodexJSON]
    ) {
        self.snapshot = snapshot
        self.runtimeConnection = runtimeConnection
        self.connection = connection
        self.store = store
        self.threadSettings = threadSettings
        self.threadProjects = threadProjects
        self.models = models
    }

    var registeredProjects: [CockpitProject] {
        (snapshot?.projects ?? []).filter { !$0.removed }.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    var threads: [CodexThread] {
        store.threads.values.sorted {
            let left = $0.title.isEmpty ? $0.id : $0.title
            let right = $1.title.isEmpty ? $1.id : $1.title
            return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
        }
    }

    var connectionPresentation: (label: String, detail: String, tone: ZeroTone) {
        switch connection {
        case .disconnected:
            return ("Disconnected", "Connect manually to the local Codex app-server.", .neutral)
        case .connecting:
            return ("Connecting", "Negotiating the local app-server protocol.", .attention)
        case .connected:
            return ("Connected", "Project Zero owns this Codex app-server session.", .healthy)
        case .exited(let code):
            return ("Exited \(code)", "The local Codex process ended. Reconnect explicitly.", .error)
        case .failed(let message):
            return ("Failed", message.isEmpty ? "The local Codex transport failed." : message, .error)
        }
    }

    var historyNotice: String {
        let dropped = store.truncation.threads + store.truncation.turns + store.truncation.items + store.truncation.unknownEvents
        var parts = ["Codex history is held only in bounded application memory."]
        if connection != .connected && (!store.threads.isEmpty || !store.approvals.isEmpty) {
            parts.append("Visible Codex state is retained evidence, not a live or actionable run.")
        }
        if dropped > 0 { parts.append("\(dropped) older record\(dropped == 1 ? "" : "s") were dropped.") }
        if store.truncation.metadata { parts.append("One or more payloads were clipped.") }
        return parts.joined(separator: " ")
    }

    func modelOptions(mode: CodexMode) -> [ZeroBotModelOption] {
        var seen = Set<String>()
        var result: [ZeroBotModelOption] = []
        for model in models {
            guard let id = Self.scalar(model["id"])
                ?? Self.scalar(model["model"])
                ?? Self.scalar(model["slug"]),
                !id.isEmpty,
                seen.insert(id).inserted else { continue }
            let label = Self.scalar(model["displayName"])
                ?? Self.scalar(model["name"])
                ?? id
            result.append(ZeroBotModelOption(id: id, label: label, advertised: true))
        }
        let preferred = mode.settings.model
        if models.isEmpty, seen.insert(preferred).inserted {
            result.insert(ZeroBotModelOption(id: preferred, label: preferred, advertised: false), at: 0)
        }
        return result
    }

    func isAdvertisedModel(_ id: String) -> Bool {
        models.contains { model in
            (Self.scalar(model["id"]) ?? Self.scalar(model["model"]) ?? Self.scalar(model["slug"])) == id
        }
    }

    func thread(id: String?) -> CodexThread? {
        guard let id else { return nil }
        return store.thread(id: id)
    }

    func isOwned(threadID: String?) -> Bool {
        guard let threadID else { return false }
        return threadSettings[threadID] != nil
    }

    func projectBinding(threadID: String?) -> ZeroBotProjectBinding? {
        guard let threadID else { return nil }
        return threadProjects[threadID]
    }

    func projectSelectionMismatch(threadID: String?, selectedProjectID: String?) -> Bool {
        guard let binding = projectBinding(threadID: threadID), let selectedProjectID else { return false }
        return selectedProjectID != binding.projectID
    }

    func hasCurrentProjectBinding(threadID: String?) -> Bool {
        guard runtimeConnection == .live,
              snapshot != nil,
              let threadID,
              threadSettings[threadID] != nil,
              store.thread(id: threadID) != nil,
              let binding = threadProjects[threadID] else { return false }
        return registeredProjects.contains {
            $0.id == binding.projectID && $0.name == binding.name && $0.path == binding.path
        }
    }

    func settings(threadID: String?) -> CodexSettings? {
        guard let threadID else { return nil }
        return threadSettings[threadID]
    }

    func canStartThread(projectID: String?, modelID: String) -> Bool {
        guard runtimeConnection == .live,
              snapshot != nil,
              connection == .connected,
              let projectID,
              isAdvertisedModel(modelID) else { return false }
        return registeredProjects.contains { $0.id == projectID }
    }

    func canSend(threadID: String?, selectedProjectID: String?, text: String) -> Bool {
        connection == .connected
            && hasCurrentProjectBinding(threadID: threadID)
            && projectBinding(threadID: threadID)?.projectID == selectedProjectID
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func activeTurn(in thread: CodexThread?) -> CodexTurn? {
        guard let thread else { return nil }
        if let turnID = thread.items.last?.turnID,
           let turn = thread.turns[turnID], Self.isActive(status: turn.status) { return turn }
        return thread.turns.values
            .filter { Self.isActive(status: $0.status) }
            .sorted { $0.id > $1.id }
            .first
    }

    func canInterrupt(threadID: String?, turnID: String?) -> Bool {
        guard connection == .connected,
              hasCurrentProjectBinding(threadID: threadID),
              let threadID,
              let turnID,
              let turn = store.thread(id: threadID)?.turns[turnID] else { return false }
        return Self.isActive(status: turn.status)
    }

    var retainedOnly: Bool { connection != .connected }

    func evidenceStatus(_ status: String) -> String {
        retainedOnly ? "RETAINED · \(status.uppercased())" : status.uppercased()
    }

    func evidenceTone(_ liveTone: ZeroTone) -> ZeroTone {
        retainedOnly ? .neutral : liveTone
    }

    var approvalCountLabel: String {
        "\(store.approvals.count) \(retainedOnly ? "RETAINED" : "PENDING")"
    }

    func threadPresentation(threadID: String?) -> ZeroBotThreadPresentation {
        if retainedOnly {
            return ZeroBotThreadPresentation(label: "RETAINED EVIDENCE", symbol: "archivebox.fill", tone: .neutral)
        }
        if hasCurrentProjectBinding(threadID: threadID) {
            return ZeroBotThreadPresentation(label: "OWNED SESSION", symbol: "checkmark.shield.fill", tone: .healthy)
        }
        if isOwned(threadID: threadID) {
            return ZeroBotThreadPresentation(label: "OWNERSHIP UNVERIFIED", symbol: "exclamationmark.shield.fill", tone: .attention)
        }
        return ZeroBotThreadPresentation(label: "HISTORY ONLY", symbol: "lock.fill", tone: .neutral)
    }

    func tokenUsageBadge(truncated: Bool) -> String {
        if truncated { return "CLIPPED" }
        return retainedOnly ? "RETAINED" : "CURRENT"
    }

    var retainedConnectionEvidence: String? {
        guard retainedOnly, !store.threads.isEmpty || !store.approvals.isEmpty else { return nil }
        switch connection {
        case .failed(let message): return message.isEmpty ? "The local Codex transport failed." : message
        case .exited(let code): return "The local Codex process exited with status \(code)."
        case .disconnected: return "Codex is disconnected."
        case .connecting: return "Codex is reconnecting; retained evidence is not actionable."
        case .connected: return nil
        }
    }

    func approvalAvailability(
        _ approval: CodexApproval,
        selectedThreadID: String?
    ) -> ZeroBotApprovalAvailability {
        guard Self.approvalResponse(method: approval.method, approve: true) != nil else {
            return .blocked("This request method does not have a safely implemented response.")
        }
        guard store.approvals.contains(approval) else {
            return .blocked("This exact request is no longer pending in the current Codex store.")
        }
        guard !Self.jsonText(approval.params).truncated else {
            return .blocked("The request payload exceeds the safe display boundary.")
        }
        guard connection == .connected else {
            return .blocked("Codex is not connected; this request is retained evidence only.")
        }
        guard runtimeConnection == .live, snapshot != nil else {
            return .blocked("The Project Zero runtime and project registry must be live.")
        }
        guard let threadID = approval.params["threadId"].string, !threadID.isEmpty else {
            return .blocked("The request has no exact thread identity.")
        }
        guard threadID == selectedThreadID else {
            return .blocked("Select the exact requesting thread before responding.")
        }
        guard hasCurrentProjectBinding(threadID: threadID) else {
            return .blocked("The request is not bound to a current Project Zero-owned project thread.")
        }
        guard let turnID = approval.params["turnId"].string, !turnID.isEmpty,
              let turn = store.thread(id: threadID)?.turns[turnID], Self.isActive(status: turn.status) else {
            return .blocked("The request does not match a current active turn in that thread.")
        }
        guard let itemID = approval.params["itemId"].string, !itemID.isEmpty,
              let item = store.thread(id: threadID)?.item(id: itemID), item.turnID == turnID else {
            return .blocked("The request item does not match that exact thread and turn.")
        }
        let category = ZeroBotItemCategory(kind: item.kind)
        if approval.method == "item/commandExecution/requestApproval", category != .command {
            return .blocked("The command approval does not match a command-execution item.")
        }
        if approval.method == "item/fileChange/requestApproval", category != .fileChange {
            return .blocked("The file-change approval does not match a file-change item.")
        }
        return .actionable
    }

    var protocolErrorEvidence: ZeroBotEvidence? {
        evidence(title: "APP-SERVER ERROR", value: store.lastError)
    }

    func turnErrorEvidence(_ turn: CodexTurn) -> ZeroBotEvidence? {
        evidence(title: "TURN ERROR", value: turn.error)
    }

    func itemMetadataFields(_ item: CodexItem) -> [ZeroBotMetadataField] {
        let metadata = item.metadata
        var fields: [ZeroBotMetadataField] = []
        switch ZeroBotItemCategory(kind: item.kind) {
        case .command:
            appendField("COMMAND", value: metadata["command"], suffix: nil, to: &fields)
            appendField("WORKING DIRECTORY", value: metadata["cwd"], suffix: nil, to: &fields)
            appendField("SOURCE", value: metadata["source"], suffix: nil, to: &fields)
            appendField("PROCESS", value: metadata["processId"], suffix: nil, to: &fields)
            appendField("EXIT CODE", value: metadata["exitCode"], suffix: nil, to: &fields)
            appendField("DURATION", value: metadata["durationMs"], suffix: " ms", to: &fields)
            appendField("PLUGIN", value: metadata["pluginId"], suffix: nil, to: &fields)
            appendField("PLUGIN SCRIPT", value: metadata["scriptPath"], suffix: nil, to: &fields)
            appendJSONField("PARSED ACTIONS", value: metadata["commandActions"], to: &fields)
        case .fileChange:
            appendJSONField("FILE CHANGES", value: metadata["changes"], to: &fields)
        case .tool:
            appendField("TOOL SERVER", value: metadata["server"], suffix: nil, to: &fields)
            appendField("TOOL", value: metadata["tool"], suffix: nil, to: &fields)
            appendField("NAMESPACE", value: metadata["namespace"], suffix: nil, to: &fields)
            appendField("READ ONLY", value: metadata["readOnlyHint"], suffix: nil, to: &fields)
            appendField("DURATION", value: metadata["durationMs"], suffix: " ms", to: &fields)
            appendJSONField("ARGUMENTS", value: metadata["arguments"], to: &fields)
        default:
            break
        }
        return fields
    }

    func itemMetadataEvidence(_ item: CodexItem) -> ZeroBotEvidence? {
        evidence(title: "BOUNDED ITEM METADATA", value: item.metadata)
    }

    static func approvalResponse(method: String, approve: Bool) -> CodexJSON? {
        switch method {
        case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
            return .object(["decision": .string(approve ? "accept" : "decline")])
        default:
            return nil
        }
    }

    static func requestIDLabel(_ id: CodexRequestID) -> String {
        switch id {
        case .string(let value): value
        case .integer(let value): String(value)
        }
    }

    static func jsonText(_ value: CodexJSON, limit: Int = 24_000) -> (text: String, truncated: Bool) {
        guard let data = try? JSONEncoder.prettyCodex.encode(value) else { return ("Payload unavailable", false) }
        guard data.count > limit else { return (String(decoding: data, as: UTF8.self), false) }
        var suffix = data.suffix(limit)
        while let first = suffix.first, first & 0xC0 == 0x80 { suffix = suffix.dropFirst() }
        return ("…\n" + String(decoding: suffix, as: UTF8.self), true)
    }

    private func evidence(title: String, value: CodexJSON) -> ZeroBotEvidence? {
        guard value != .null else { return nil }
        let rendered = Self.jsonText(value)
        return ZeroBotEvidence(title: title, content: rendered.text, truncated: rendered.truncated)
    }

    private func appendField(
        _ label: String,
        value: CodexJSON,
        suffix: String?,
        to fields: inout [ZeroBotMetadataField]
    ) {
        guard let scalar = Self.scalar(value), !scalar.isEmpty else { return }
        fields.append(ZeroBotMetadataField(label: label, value: scalar + (suffix ?? "")))
    }

    private func appendJSONField(
        _ label: String,
        value: CodexJSON,
        to fields: inout [ZeroBotMetadataField]
    ) {
        guard value != .null else { return }
        let rendered = Self.jsonText(value, limit: 4_096)
        fields.append(ZeroBotMetadataField(
            label: label,
            value: rendered.truncated ? "Clipped — inspect exact metadata below" : rendered.text
        ))
    }

    private static func scalar(_ value: CodexJSON) -> String? {
        switch value {
        case .string(let value): value
        case .integer(let value): String(value)
        case .number(let value): String(value)
        case .bool(let value): value ? "true" : "false"
        default: nil
        }
    }

    private static func isActive(status: String) -> Bool {
        let terminal = ["completed", "failed", "interrupted", "cancelled", "canceled"]
        return !terminal.contains(status.lowercased())
    }
}

private extension JSONEncoder {
    static var prettyCodex: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

public struct ZeroBotView: View {
    @ObservedObject private var model: CockpitModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedProjectID: String?
    @State private var selectedThreadID: String?
    @State private var mode: CodexMode = .assist
    @State private var selectedModelID = CodexMode.assist.settings.model
    @SceneStorage("projectZero.zeroBot.threadProjects.v1") private var encodedThreadProjects = ""
    @State private var intent = ""
    @State private var actionInFlight = false
    @State private var localNotice: String?
    @State private var expandedReasoning = Set<String>()
    @State private var expandedMetadata = Set<String>()
    @State private var selectedUnknownIndex: Int?
    @FocusState private var composerFocused: Bool

    public init(model: CockpitModel) { self.model = model }

    private var threadProjects: [String: ZeroBotProjectBinding] {
        ZeroBotProjectBindingCodec.decode(encodedThreadProjects)
    }
    private var projection: ZeroBotProjection { ZeroBotProjection(model: model, threadProjects: threadProjects) }
    private var selectedThread: CodexThread? { projection.thread(id: selectedThreadID) }
    private var activeTurn: CodexTurn? { projection.activeTurn(in: selectedThread) }

    public var body: some View {
        GeometryReader { proxy in
            let wide = proxy.size.width >= 1_080 && !dynamicTypeSize.isAccessibilitySize
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    sessionHeader(wide: wide)
                    if wide {
                        HStack(alignment: .top, spacing: 12) {
                            explorer.frame(width: 250)
                            conversation.frame(maxWidth: .infinity)
                            inspector.frame(width: 330)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            explorer
                            conversation
                            inspector
                        }
                    }
                    historyFooter
                }
                .padding(proxy.size.width < 720 ? 14 : 20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(ZeroTheme.workstation)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Zero Bot project chat and live execution workspace")
        .onChange(of: mode) { _, newMode in
            selectedModelID = newMode.settings.model
        }
        .onChange(of: Set(model.codex.store.threads.keys)) { _, retainedThreadIDs in
            storeThreadProjects(threadProjects.filter { retainedThreadIDs.contains($0.key) })
        }
    }

    @ViewBuilder
    private func sessionHeader(wide: Bool) -> some View {
        let identity = VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                Text("ZERO BOT")
                    .font(ZeroBotTypography.font(.caption, weight: .black, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(ZeroTheme.orange, in: RoundedRectangle(cornerRadius: 3))
                Text(selectedThread.map(threadTitle) ?? "Project-owned Codex workspace")
                    .font(ZeroBotTypography.font(.callout, weight: .bold, design: .monospaced))
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
            Text("Live app-server evidence · explicit local authority · no desktop session scraping")
                .font(ZeroBotTypography.font(.callout, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
        }

        if wide {
            HStack(spacing: 12) {
                identity
                Spacer()
                connectionControls
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                identity
                connectionControls
            }
        }
    }

    private var connectionControls: some View {
        HStack(spacing: 8) {
            let state = projection.connectionPresentation
            ZeroStatusBadge(state.label, symbol: connectionSymbol, tone: state.tone)
            if model.codexConnection == .connected {
                Button("Disconnect") {
                    model.disconnectCodex()
                    selectedThreadID = nil
                    storeThreadProjects([:])
                    localNotice = "Codex disconnected. No thread or turn was started."
                }
                .buttonStyle(ZeroButtonStyle(.standard))
                .focusEffectDisabled()
                .disabled(actionInFlight)
            } else {
                Button(actionInFlight ? "Connecting…" : "Connect Codex") { connect() }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .disabled(actionInFlight || model.codexConnection == .connecting)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var explorer: some View {
        ZeroBotCard {
            VStack(alignment: .leading, spacing: 12) {
                ZeroBotSectionHeader("Workspace Threads", badge: "\(projection.threads.count) VISIBLE")
                Text("Select a registered project, then explicitly start a Project Zero-owned thread.")
                    .font(ZeroBotTypography.font(.callout, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)

                Text("REGISTERED PROJECTS")
                    .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                if projection.registeredProjects.isEmpty {
                    ZeroBotEmpty(
                        symbol: "folder.badge.questionmark",
                        title: "No registered project available",
                        detail: model.runtimeConnection == .live
                            ? "Register a project through Project Zero before opening a Codex thread."
                            : "Connect to the Project Zero runtime to load registered projects."
                    )
                } else {
                    VStack(spacing: 6) {
                        ForEach(projection.registeredProjects) { project in
                            Button {
                                selectedProjectID = project.id
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: selectedProjectID == project.id ? "folder.fill" : "folder")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(project.name).lineLimit(1)
                                        Text(project.id)
                                            .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                                            .foregroundStyle(ZeroTheme.secondaryInk)
                                            .lineLimit(1)
                                        Text(project.path)
                                            .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                                            .foregroundStyle(ZeroTheme.secondaryInk)
                                            .lineLimit(2)
                                            .textSelection(.enabled)
                                    }
                                    Spacer(minLength: 4)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(ZeroButtonStyle(.quiet, selected: selectedProjectID == project.id))
                            .focusEffectDisabled()
                            .accessibilityValue(selectedProjectID == project.id ? "Selected" : "Not selected")
                        }
                    }
                }
                if projection.snapshot?.truncated["projects"] == true {
                    Label("Project list is bounded", systemImage: "ellipsis.circle")
                        .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                        .foregroundStyle(ZeroTone.attention.color)
                }

                Divider().overlay(ZeroTheme.line)
                policyControls

                Button(actionInFlight ? "Starting…" : "New Agent Session") { startThread() }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .disabled(actionInFlight || !projection.canStartThread(projectID: selectedProjectID, modelID: selectedModelID))
                    .accessibilityHint(startThreadUnavailableReason ?? "Starts one thread with the displayed project and policy")

                Divider().overlay(ZeroTheme.line)
                Text("THREADS")
                    .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                if projection.threads.isEmpty {
                    ZeroBotEmpty(
                        symbol: "bubble.left.and.exclamationmark.bubble.right",
                        title: "No Codex threads",
                        detail: model.codexConnection == .connected
                            ? "Choose a project and start a session."
                            : "Connect Codex manually to discover or create threads."
                    )
                } else {
                    VStack(spacing: 6) {
                        ForEach(projection.threads) { thread in threadButton(thread) }
                    }
                }
            }
        }
    }

    private var policyControls: some View {
        VStack(alignment: .leading, spacing: 9) {
            ZeroBotSectionHeader("New Session Policy", badge: mode.rawValue.uppercased())
            ZeroSegmentedChoice("Codex mode", values: CodexMode.allCases, selection: $mode) { value in
                Text(value.rawValue.capitalized)
                    .frame(maxWidth: .infinity)
            }
            Text(mode == .assist
                ? "Assist is read-only and never approves actions."
                : "Work may write in the registered workspace and asks before protected actions.")
                .font(ZeroBotTypography.font(.caption, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)

            Text("MODEL")
                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    ForEach(projection.modelOptions(mode: mode)) { option in
                        Button {
                            selectedModelID = option.id
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.label).lineLimit(1)
                                Text(option.advertised ? "ADVERTISED" : "POLICY DEFAULT")
                                    .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                                    .opacity(0.72)
                            }
                        }
                        .buttonStyle(ZeroButtonStyle(.quiet, selected: selectedModelID == option.id))
                        .focusEffectDisabled()
                        .accessibilityValue(selectedModelID == option.id ? "Selected" : "Not selected")
                    }
                }
            }
            let settings = mode.settings
            VStack(alignment: .leading, spacing: 4) {
                ZeroBotPolicyRow(label: "Reasoning", value: settings.effort)
                ZeroBotPolicyRow(label: "Sandbox", value: settings.sandbox)
                ZeroBotPolicyRow(label: "Approval", value: settings.approvalPolicy)
            }
        }
    }

    private func threadButton(_ thread: CodexThread) -> some View {
        let presentation = projection.threadPresentation(threadID: thread.id)
        return Button {
            selectedThreadID = thread.id
            if let binding = projection.projectBinding(threadID: thread.id) {
                selectedProjectID = binding.projectID
            }
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: presentation.symbol)
                        .foregroundStyle(presentation.tone.color)
                    Text(threadTitle(thread))
                        .font(ZeroBotTypography.font(.callout, weight: .bold))
                        .lineLimit(2)
                    Spacer(minLength: 3)
                }
                HStack(spacing: 5) {
                    ZeroStatusBadge(presentation.label, tone: presentation.tone)
                    Text(thread.id)
                        .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(ZeroButtonStyle(.quiet, selected: selectedThreadID == thread.id))
        .focusEffectDisabled()
        .accessibilityLabel("\(threadTitle(thread)), \(presentation.label.lowercased())")
        .accessibilityValue(selectedThreadID == thread.id ? "Selected" : "Not selected")
    }

    private var conversation: some View {
        ZeroBotCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selectedThread.map(threadTitle) ?? "No thread selected")
                            .font(ZeroBotTypography.font(.title3, weight: .black))
                            .textSelection(.enabled)
                        Text(conversationSubtitle)
                            .font(ZeroBotTypography.font(.caption, weight: .medium, design: .monospaced))
                            .foregroundStyle(ZeroTheme.secondaryInk)
                    }
                    Spacer()
                    if let selectedThreadID {
                        let presentation = projection.threadPresentation(threadID: selectedThreadID)
                        ZeroStatusBadge(
                            presentation.label,
                            symbol: presentation.symbol,
                            tone: presentation.tone
                        )
                    }
                }

                if let retainedConnectionEvidence = projection.retainedConnectionEvidence {
                    Label(retainedConnectionEvidence, systemImage: "exclamationmark.triangle.fill")
                        .font(ZeroBotTypography.font(.callout, weight: .semibold))
                        .foregroundStyle(ZeroTone.error.color)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(9)
                        .background(ZeroTone.error.color.opacity(0.07), in: RoundedRectangle(cornerRadius: 6))
                        .accessibilityLabel("Retained Codex connection failure. \(retainedConnectionEvidence)")
                }

                if let thread = selectedThread {
                    if thread.items.isEmpty && thread.turns.isEmpty {
                        ZeroBotEmpty(
                            symbol: "ellipsis.message",
                            title: "No streamed content yet",
                            detail: projection.hasCurrentProjectBinding(threadID: thread.id)
                                ? "Enter an intent below to start the first turn."
                                : "This discovered thread has no retained events in the current connection."
                        )
                    } else {
                        VStack(spacing: 9) {
                            ForEach(thread.items) { item in
                                itemCard(item)
                            }
                        }
                    }
                } else {
                    ZeroBotEmpty(
                        symbol: "bubble.left.and.text.bubble.right",
                        title: "Select an explicit thread",
                        detail: "Historical threads remain read-only. Create a Project Zero-owned thread to send work."
                    )
                }

                approvalCards
                composer
            }
        }
    }

    private func itemCard(_ item: CodexItem) -> some View {
        let category = ZeroBotItemCategory(kind: item.kind)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ZeroStatusBadge(
                    category.rawValue,
                    symbol: itemSymbol(category),
                    tone: projection.evidenceTone(itemTone(category))
                )
                Text(projection.evidenceStatus(item.status))
                    .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                Spacer()
                Text(item.id)
                    .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .lineLimit(1)
            }
            if category == .reasoning {
                Button {
                    if expandedReasoning.contains(item.id) { expandedReasoning.remove(item.id) }
                    else { expandedReasoning.insert(item.id) }
                } label: {
                    HStack {
                        Text(expandedReasoning.contains(item.id) ? "Hide reasoning stream" : "Show reasoning stream")
                        Spacer()
                        Image(systemName: expandedReasoning.contains(item.id) ? "chevron.up" : "chevron.down")
                    }
                }
                .buttonStyle(ZeroButtonStyle(.quiet, selected: expandedReasoning.contains(item.id)))
                .focusEffectDisabled()
                .accessibilityValue(expandedReasoning.contains(item.id) ? "Expanded" : "Collapsed")
                if expandedReasoning.contains(item.id) { itemContent(item, category: category) }
            } else {
                itemContent(item, category: category)
            }
            if item.textTruncated || item.outputTruncated || item.metadataTruncated {
                Label("Content clipped by the in-memory retention boundary", systemImage: "scissors")
                    .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ZeroTone.attention.color)
            }
        }
        .padding(11)
        .background(projection.retainedOnly ? ZeroTheme.workstation : itemBackground(category), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ZeroTheme.line))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func itemContent(_ item: CodexItem, category: ZeroBotItemCategory) -> some View {
        if !item.text.isEmpty {
            Text(item.text)
                .font(category == .command || category == .tool
                    ? ZeroBotTypography.font(.callout, design: .monospaced)
                    : ZeroBotTypography.font(.body, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        if !item.output.isEmpty {
            ZeroBotCodeWell(
                title: "STREAMED OUTPUT",
                content: item.output,
                tone: projection.evidenceTone(category == .fileChange ? .healthy : .neutral)
            )
        }
        let fields = projection.itemMetadataFields(item)
        if !fields.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                    ZeroBotPolicyRow(label: field.label, value: field.value)
                }
            }
            .padding(8)
            .background(ZeroTheme.navigation.opacity(0.55), in: RoundedRectangle(cornerRadius: 5))
            .accessibilityLabel("Structured execution metadata")
        }
        if let metadata = projection.itemMetadataEvidence(item) {
            Button {
                if expandedMetadata.contains(item.id) { expandedMetadata.remove(item.id) }
                else { expandedMetadata.insert(item.id) }
            } label: {
                HStack {
                    Text(expandedMetadata.contains(item.id) ? "Hide exact bounded metadata" : "Inspect exact bounded metadata")
                    Spacer()
                    Image(systemName: expandedMetadata.contains(item.id) ? "chevron.up" : "chevron.down")
                }
            }
            .buttonStyle(ZeroButtonStyle(.quiet, selected: expandedMetadata.contains(item.id)))
            .focusEffectDisabled()
            .accessibilityValue(expandedMetadata.contains(item.id) ? "Expanded" : "Collapsed")
            .accessibilityHint("Shows the exact retained metadata payload for this item")
            if expandedMetadata.contains(item.id) {
                ZeroBotCodeWell(title: metadata.title, content: metadata.content, tone: .neutral)
            }
            if metadata.truncated {
                Text("Inspector rendering clipped this payload further.")
                    .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                    .foregroundStyle(ZeroTone.attention.color)
            }
        }
    }

    @ViewBuilder
    private var approvalCards: some View {
        let approvals = projection.store.approvals.sorted { left, right in
            let leftSelected = left.params["threadId"].string == selectedThreadID
            let rightSelected = right.params["threadId"].string == selectedThreadID
            if leftSelected != rightSelected { return leftSelected }
            return ZeroBotProjection.requestIDLabel(left.id) < ZeroBotProjection.requestIDLabel(right.id)
        }
        if !approvals.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ZeroBotSectionHeader("Owner Decisions Across Codex", badge: "\(approvals.count) \(projection.retainedOnly ? "RETAINED" : "PENDING")")
                ForEach(approvals) { approval in
                    approvalCard(approval)
                }
            }
        }
    }

    private func approvalCard(_ approval: CodexApproval) -> some View {
        let responseSupported = ZeroBotProjection.approvalResponse(method: approval.method, approve: true) != nil
        let availability = projection.approvalAvailability(approval, selectedThreadID: selectedThreadID)
        let payload = ZeroBotProjection.jsonText(approval.params)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                ZeroStatusBadge(
                    projection.retainedOnly ? "RETAINED REQUEST" : "APPROVAL REQUIRED",
                    symbol: projection.retainedOnly ? "archivebox.fill" : "hand.raised.fill",
                    tone: projection.retainedOnly ? .neutral : .error
                )
                Spacer()
                Text("REQUEST \(ZeroBotProjection.requestIDLabel(approval.id))")
                    .font(ZeroBotTypography.font(.caption2, design: .monospaced))
                    .textSelection(.enabled)
            }
            Text(approval.method)
                .font(ZeroBotTypography.font(.callout, weight: .bold, design: .monospaced))
                .textSelection(.enabled)
            ZeroBotCodeWell(title: "EXACT REQUEST PAYLOAD", content: payload.text, tone: .attention)
            if let reason = availability.reason {
                Label(reason, systemImage: "lock.fill")
                    .font(ZeroBotTypography.font(.callout, weight: .semibold))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if responseSupported {
                HStack(spacing: 8) {
                    Button("Decline") { answer(approval, approve: false) }
                        .buttonStyle(ZeroButtonStyle(.standard))
                        .focusEffectDisabled()
                    Button("Accept exact request") { answer(approval, approve: true) }
                        .buttonStyle(ZeroButtonStyle(.authority))
                        .focusEffectDisabled()
                }
                .disabled(availability != .actionable || actionInFlight || payload.truncated)
            } else {
                Label("This request needs a method-specific response that this client does not safely implement.", systemImage: "exclamationmark.shield")
                    .font(ZeroBotTypography.font(.callout, weight: .semibold))
                    .foregroundStyle(ZeroTone.attention.color)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(11)
        .background(ZeroTone.error.color.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ZeroTone.error.color.opacity(0.35)))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SEND INTENT")
                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
            TextEditor(text: $intent)
                .font(ZeroBotTypography.font(.body, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 82, maxHeight: 150)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(composerFocused ? ZeroTheme.orangePressed : ZeroTheme.line, lineWidth: composerFocused ? 2 : 1)
                }
                .focused($composerFocused)
                .accessibilityLabel("Codex intent")
                .accessibilityHint(sendUnavailableReason ?? "Sends a turn to the selected Project Zero-owned thread")
            HStack(alignment: .center, spacing: 8) {
                composerPolicy
                Spacer()
                Button(actionInFlight ? "Sending…" : "Send Intent") { sendIntent() }
                    .buttonStyle(ZeroButtonStyle(.authority))
                    .focusEffectDisabled()
                    .keyboardShortcut(.return, modifiers: [.command])
                    .disabled(actionInFlight || !projection.canSend(
                        threadID: selectedThreadID,
                        selectedProjectID: selectedProjectID,
                        text: intent
                    ))
            }
            if let reason = sendUnavailableReason {
                Label(reason, systemImage: "info.circle")
                    .font(ZeroBotTypography.font(.caption2, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            }
        }
        .padding(10)
        .background(ZeroTheme.navigation.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
    }

    private var composerPolicy: some View {
        let settings = projection.settings(threadID: selectedThreadID)
        let binding = projection.projectBinding(threadID: selectedThreadID)
        return VStack(alignment: .leading, spacing: 2) {
            Text(settings?.model ?? "No owned thread policy")
            if let settings {
                Text("\(settings.effort) · \(settings.sandbox) · approval \(settings.approvalPolicy)")
            } else {
                Text("New-session choices do not alter existing threads")
            }
            if let binding {
                Text("BOUND PROJECT · \(binding.name) [\(binding.projectID)]")
                Text("REGISTERED SNAPSHOT PATH · \(binding.path)")
                    .textSelection(.enabled)
            } else if selectedThreadID != nil {
                Text("NO VERIFIED PROJECT BINDING · SEND DISABLED")
            }
        }
        .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
        .foregroundStyle(ZeroTheme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var inspector: some View {
        ZeroBotCard {
            VStack(alignment: .leading, spacing: 12) {
                ZeroBotSectionHeader(
                    projection.retainedOnly ? "Retained Run" : "Current Run",
                    badge: activeTurn.map { projection.evidenceStatus($0.status) } ?? "IDLE"
                )
                if let thread = selectedThread, let activeTurn {
                    runInspector(thread: thread, turn: activeTurn)
                } else {
                    ZeroBotEmpty(
                        symbol: "scope",
                        title: "No active run",
                        detail: selectedThread == nil
                            ? "Select a thread to inspect plan, diff, usage, and streamed protocol state."
                            : "This thread has no retained active turn."
                    )
                    if let thread = selectedThread { completedTurnEvidence(thread) }
                }
                if let thread = selectedThread { turnErrorEvidence(thread) }
                tokenUsage
                rawEvents
                stateNotice
            }
        }
    }

    private func runInspector(thread: CodexThread, turn: CodexTurn) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                ZeroBotPolicyRow(label: "Thread", value: thread.id)
                ZeroBotPolicyRow(label: "Turn", value: turn.id)
                ZeroBotPolicyRow(label: "Status", value: turn.status)
                if let settings = projection.settings(threadID: thread.id) {
                    ZeroBotPolicyRow(label: "Model", value: settings.model)
                    ZeroBotPolicyRow(label: "Reasoning", value: settings.effort)
                    ZeroBotPolicyRow(label: "Sandbox", value: settings.sandbox)
                    ZeroBotPolicyRow(label: "Approval", value: settings.approvalPolicy)
                }
            }
            Button("Interrupt exact turn") {
                interrupt(threadID: thread.id, turnID: turn.id)
            }
            .buttonStyle(ZeroButtonStyle(.authority))
            .focusEffectDisabled()
            .disabled(actionInFlight || !projection.canInterrupt(threadID: thread.id, turnID: turn.id))
            .accessibilityHint("Interrupts turn \(turn.id) in thread \(thread.id)")

            planView(turn)
            if !turn.diff.isEmpty {
                ZeroBotCodeWell(
                    title: "UNIFIED CODE DIFF",
                    content: turn.diff,
                    tone: projection.evidenceTone(.healthy)
                )
            }
            if turn.contentTruncated {
                Label("Run evidence is truncated", systemImage: "scissors")
                    .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ZeroTone.attention.color)
            }
        }
    }

    @ViewBuilder
    private func planView(_ turn: CodexTurn) -> some View {
        if !turn.plan.isEmpty || turn.explanation != nil {
            VStack(alignment: .leading, spacing: 7) {
                ZeroBotSectionHeader("Execution Stages", badge: "\(turn.plan.count)")
                if let explanation = turn.explanation, !explanation.isEmpty {
                    Text(explanation)
                        .font(ZeroBotTypography.font(.caption, weight: .medium))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                        .textSelection(.enabled)
                }
                ForEach(Array(turn.plan.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 7) {
                        Image(systemName: planSymbol(step.status))
                            .foregroundStyle(projection.evidenceTone(planTone(step.status)).color)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.step)
                                .font(ZeroBotTypography.font(.caption, weight: .semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            Text("STEP \(index + 1) · \(step.status.uppercased())")
                                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                                .foregroundStyle(ZeroTheme.secondaryInk)
                        }
                    }
                }
            }
            .padding(9)
            .background(ZeroTheme.navigation.opacity(0.55), in: RoundedRectangle(cornerRadius: 7))
        }
    }

    @ViewBuilder
    private func completedTurnEvidence(_ thread: CodexThread) -> some View {
        let turns = thread.turns.values.sorted { $0.id < $1.id }
        if let turn = turns.last {
            VStack(alignment: .leading, spacing: 8) {
                ZeroBotSectionHeader("Latest Retained Turn", badge: turn.status.uppercased())
                ZeroBotPolicyRow(label: "Turn", value: turn.id)
                planView(turn)
                if !turn.diff.isEmpty {
                    ZeroBotCodeWell(
                        title: "UNIFIED CODE DIFF",
                        content: turn.diff,
                        tone: projection.evidenceTone(.healthy)
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func turnErrorEvidence(_ thread: CodexThread) -> some View {
        let failedTurns = thread.turns.values
            .filter { projection.turnErrorEvidence($0) != nil }
            .sorted { $0.id < $1.id }
        if !failedTurns.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ZeroBotSectionHeader("Turn Failures", badge: "\(failedTurns.count) EVIDENCE")
                ForEach(failedTurns, id: \.id) { turn in
                    VStack(alignment: .leading, spacing: 5) {
                        ZeroBotPolicyRow(label: "Turn", value: turn.id)
                        turnErrorCard(turn)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var tokenUsage: some View {
        if let thread = selectedThread, thread.tokenUsage != .null {
            let payload = ZeroBotProjection.jsonText(thread.tokenUsage)
            VStack(alignment: .leading, spacing: 7) {
                ZeroBotSectionHeader("Token Usage", badge: projection.tokenUsageBadge(truncated: payload.truncated))
                ZeroBotCodeWell(title: "APP-SERVER USAGE", content: payload.text, tone: .neutral)
            }
        }
    }

    private var rawEvents: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZeroBotSectionHeader("Protocol Inspector", badge: "\(projection.store.unknownEvents.count) RAW")
            if projection.store.unknownEvents.isEmpty {
                Text("No unrecognized app-server events are retained.")
                    .font(ZeroBotTypography.font(.caption, weight: .medium))
                    .foregroundStyle(ZeroTheme.secondaryInk)
            } else {
                VStack(spacing: 5) {
                    ForEach(Array(projection.store.unknownEvents.enumerated()), id: \.offset) { index, event in
                        Button {
                            selectedUnknownIndex = selectedUnknownIndex == index ? nil : index
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "waveform.path.ecg")
                                Text(event.method)
                                    .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: selectedUnknownIndex == index ? "chevron.up" : "chevron.down")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(ZeroButtonStyle(.quiet, selected: selectedUnknownIndex == index))
                        .focusEffectDisabled()
                        .accessibilityValue(selectedUnknownIndex == index ? "Expanded" : "Collapsed")
                        if selectedUnknownIndex == index {
                            let payload = ZeroBotProjection.jsonText(event.params)
                            ZeroBotCodeWell(title: "RAW BOUNDED PARAMS", content: payload.text, tone: .attention)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var stateNotice: some View {
        if let protocolError = projection.protocolErrorEvidence {
            ZeroBotCodeWell(title: protocolError.title, content: protocolError.content, tone: .error)
            if protocolError.truncated {
                Text("App-server error evidence was clipped for display.")
                    .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ZeroTone.attention.color)
            }
        }
        let message = model.codexActionError ?? localNotice
        if let message, !message.isEmpty {
            Label(message, systemImage: model.codexActionError == nil ? "checkmark.circle" : "exclamationmark.triangle")
                .font(ZeroBotTypography.font(.callout, weight: .semibold))
                .foregroundStyle(model.codexActionError == nil ? ZeroTone.healthy.color : ZeroTone.error.color)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(9)
                .background((model.codexActionError == nil ? ZeroTone.healthy.color : ZeroTone.error.color).opacity(0.07), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    @ViewBuilder
    private func turnErrorCard(_ turn: CodexTurn) -> some View {
        if let error = projection.turnErrorEvidence(turn) {
            ZeroBotCodeWell(title: error.title, content: error.content, tone: .error)
            if error.truncated {
                Text("Turn error evidence was clipped for display.")
                    .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ZeroTone.attention.color)
            }
        }
    }

    private var historyFooter: some View {
        Label(projection.historyNotice, systemImage: "archivebox")
            .font(ZeroBotTypography.font(.caption2, weight: .medium, design: .monospaced))
            .foregroundStyle(ZeroTheme.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("History boundary. \(projection.historyNotice)")
    }

    private var startThreadUnavailableReason: String? {
        if model.runtimeConnection != .live || model.snapshot == nil {
            return "Connect the Project Zero runtime and load a fresh project registry before starting a thread."
        }
        if model.codexConnection != .connected { return "Connect Codex before starting a thread." }
        if selectedProjectID == nil { return "Select a registered project before starting a thread." }
        if !projection.isAdvertisedModel(selectedModelID) { return "Select a model advertised by this Codex connection." }
        return nil
    }

    private var sendUnavailableReason: String? {
        if model.runtimeConnection != .live || model.snapshot == nil {
            return "Project Zero runtime evidence is not live; sending is disabled."
        }
        if model.codexConnection != .connected { return "Connect Codex before sending." }
        guard let selectedThreadID else { return "Select a thread before sending." }
        if !projection.isOwned(threadID: selectedThreadID) { return "This discovered thread is read-only; start a Project Zero-owned session." }
        guard let binding = projection.projectBinding(threadID: selectedThreadID) else {
            return "This thread has no verified Project Zero project binding; sending is disabled."
        }
        if !projection.hasCurrentProjectBinding(threadID: selectedThreadID) {
            return "The bound project \(binding.name) no longer exactly matches the live registered path."
        }
        if projection.projectSelectionMismatch(threadID: selectedThreadID, selectedProjectID: selectedProjectID) {
            return "Select the bound project \(binding.name) before sending to this thread."
        }
        if intent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter an intent before sending." }
        return nil
    }

    private var conversationSubtitle: String {
        guard let selectedThread else { return projection.connectionPresentation.detail }
        let turnCount = selectedThread.turns.count
        let itemCount = selectedThread.items.count
        return "\(turnCount) turn\(turnCount == 1 ? "" : "s") · \(itemCount) streamed item\(itemCount == 1 ? "" : "s")"
    }

    private var connectionSymbol: String {
        switch model.codexConnection {
        case .connected: "link.circle.fill"
        case .connecting: "arrow.triangle.2.circlepath"
        case .disconnected: "link.badge.plus"
        case .exited, .failed: "exclamationmark.triangle.fill"
        }
    }

    private func connect() {
        guard !actionInFlight else { return }
        storeThreadProjects([:])
        selectedThreadID = nil
        actionInFlight = true
        localNotice = nil
        Task {
            let connected = await model.connectCodex()
            actionInFlight = false
            if connected { localNotice = "Connected. No thread or turn was started." }
        }
    }

    private func startThread() {
        guard !actionInFlight,
              let selectedProjectID,
              let project = projection.registeredProjects.first(where: { $0.id == selectedProjectID }),
              projection.canStartThread(projectID: selectedProjectID, modelID: selectedModelID) else { return }
        actionInFlight = true
        localNotice = nil
        Task {
            if let id = await model.startCodexThread(projectID: selectedProjectID, model: selectedModelID, mode: mode) {
                var bindings = threadProjects
                bindings[id] = ZeroBotProjectBinding(project)
                storeThreadProjects(bindings)
                selectedThreadID = id
                localNotice = "Created Project Zero-owned thread \(id)."
            }
            actionInFlight = false
        }
    }

    private func sendIntent() {
        guard !actionInFlight,
              let selectedThreadID,
              projection.canSend(
                threadID: selectedThreadID,
                selectedProjectID: selectedProjectID,
                text: intent
              ) else { return }
        let submitted = intent.trimmingCharacters(in: .whitespacesAndNewlines)
        actionInFlight = true
        localNotice = nil
        Task {
            if let id = await model.startCodexTurn(threadID: selectedThreadID, text: submitted) {
                intent = ""
                composerFocused = false
                localNotice = "Started turn \(id)."
            }
            actionInFlight = false
        }
    }

    private func interrupt(threadID: String, turnID: String) {
        guard !actionInFlight, projection.canInterrupt(threadID: threadID, turnID: turnID) else { return }
        actionInFlight = true
        localNotice = nil
        Task {
            if await model.interruptCodexTurn(turnID: turnID, threadID: threadID) {
                localNotice = "Interrupt requested for exact turn \(turnID)."
            }
            actionInFlight = false
        }
    }

    private func answer(_ approval: CodexApproval, approve: Bool) {
        guard !actionInFlight,
              projection.approvalAvailability(approval, selectedThreadID: selectedThreadID) == .actionable,
              !ZeroBotProjection.jsonText(approval.params).truncated,
              let response = ZeroBotProjection.approvalResponse(method: approval.method, approve: approve) else { return }
        actionInFlight = true
        localNotice = nil
        let succeeded = model.replyToCodexApproval(id: approval.id, response: response)
        if succeeded {
            localNotice = "\(approve ? "Accepted" : "Declined") exact request \(ZeroBotProjection.requestIDLabel(approval.id))."
        }
        actionInFlight = false
    }

    private func storeThreadProjects(_ bindings: [String: ZeroBotProjectBinding]) {
        encodedThreadProjects = ZeroBotProjectBindingCodec.encode(bindings)
    }

    private func threadTitle(_ thread: CodexThread) -> String {
        thread.title.isEmpty ? "Untitled thread" : thread.title
    }

    private func itemSymbol(_ category: ZeroBotItemCategory) -> String {
        switch category {
        case .operatorMessage: "person.fill"
        case .agentMessage: "sparkles"
        case .reasoning: "brain.head.profile"
        case .plan: "list.bullet.clipboard"
        case .command: "terminal.fill"
        case .fileChange: "doc.badge.gearshape"
        case .tool: "wrench.and.screwdriver.fill"
        case .other: "waveform.path.ecg"
        }
    }

    private func itemTone(_ category: ZeroBotItemCategory) -> ZeroTone {
        switch category {
        case .agentMessage, .fileChange: .healthy
        case .reasoning, .plan, .command, .tool: .attention
        case .operatorMessage, .other: .neutral
        }
    }

    private func itemBackground(_ category: ZeroBotItemCategory) -> Color {
        switch category {
        case .operatorMessage: ZeroTheme.navigation.opacity(0.48)
        case .agentMessage: Color.white
        case .reasoning: Color(red: 0.95, green: 0.94, blue: 0.88)
        case .plan: ZeroTheme.frameBand.opacity(0.42)
        case .command, .tool: Color(red: 0.94, green: 0.94, blue: 0.96)
        case .fileChange: ZeroTone.healthy.color.opacity(0.06)
        case .other: ZeroTheme.workstation
        }
    }

    private func planSymbol(_ status: String) -> String {
        switch status.lowercased() {
        case "completed", "complete", "done": "checkmark.circle.fill"
        case "inprogress", "in_progress", "active": "arrow.triangle.2.circlepath.circle.fill"
        case "failed", "blocked": "exclamationmark.circle.fill"
        default: "circle"
        }
    }

    private func planTone(_ status: String) -> ZeroTone {
        switch status.lowercased() {
        case "completed", "complete", "done": .healthy
        case "failed", "blocked": .error
        case "inprogress", "in_progress", "active": .attention
        default: .neutral
        }
    }
}

private struct ZeroBotCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.line))
            .shadow(color: ZeroTheme.ink.opacity(0.07), radius: 8, y: 3)
    }
}

private struct ZeroBotSectionHeader: View {
    let title: String
    let badge: String

    init(_ title: String, badge: String) {
        self.title = title
        self.badge = badge
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(ZeroBotTypography.font(.callout, weight: .black))
            Spacer(minLength: 5)
            Text(badge)
                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 3))
        }
    }
}

private struct ZeroBotPolicyRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label.uppercased())
                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                .foregroundStyle(ZeroTheme.secondaryInk)
            Spacer(minLength: 6)
            Text(value)
                .font(ZeroBotTypography.font(.caption2, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }
}

private struct ZeroBotCodeWell: View {
    let title: String
    let content: String
    let tone: ZeroTone

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(ZeroBotTypography.font(.caption2, weight: .bold, design: .monospaced))
                .foregroundStyle(tone.color)
            ScrollView(.horizontal, showsIndicators: true) {
                Text(content)
                    .font(ZeroBotTypography.font(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(8)
        .background(Color(red: 0.93, green: 0.93, blue: 0.95), in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(tone.color.opacity(0.22)))
    }
}

private struct ZeroBotEmpty: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol)
                .font(ZeroBotTypography.font(.callout, weight: .bold))
            Text(detail)
                .font(ZeroBotTypography.font(.caption, weight: .medium))
                .foregroundStyle(ZeroTheme.secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ZeroTheme.navigation.opacity(0.55), in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ZeroTheme.line))
    }
}
