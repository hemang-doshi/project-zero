import Foundation

public enum CodexEvent: Equatable, Sendable {
    case notification(method: String, params: CodexJSON)
    case request(id: CodexRequestID, method: String, params: CodexJSON)
    public var method: String {
        switch self { case .notification(let method, _), .request(_, let method, _): return method }
    }
    public var params: CodexJSON {
        switch self { case .notification(_, let params), .request(_, _, let params): return params }
    }
}

public struct CodexItem: Identifiable, Equatable, Sendable {
    public let id: String
    public var turnID: String
    public var kind = "unknown"
    public var status = "inProgress"
    public var text = ""
    public var output = ""
    public var metadata: CodexJSON = .null
    public var textTruncated = false
    public var outputTruncated = false
    public var metadataTruncated = false
}

public struct CodexPlanStep: Equatable, Sendable {
    public let step: String
    public let status: String
}

public struct CodexTurn: Identifiable, Equatable, Sendable {
    public let id: String
    public var status = "inProgress"
    public var diff = ""
    public var explanation: String?
    public var plan: [CodexPlanStep] = []
    public var error: CodexJSON = .null
    public var contentTruncated = false
}

public struct CodexThread: Identifiable, Equatable, Sendable {
    public let id: String
    public var title = ""
    public var status: CodexJSON = .null
    public var turns: [String: CodexTurn] = [:]
    public var items: [CodexItem] = []
    public var tokenUsage: CodexJSON = .null
    public var contentTruncated = false
    fileprivate var turnOrder: [String] = []
    public func item(id: String) -> CodexItem? { items.first { $0.id == id } }
}

public struct CodexApproval: Identifiable, Equatable, Sendable {
    public let id: CodexRequestID
    public let method: String
    public let params: CodexJSON
}

public struct CodexRetentionLimits: Equatable, Sendable {
    public let threads: Int, turnsPerThread: Int, itemsPerThread: Int, textBytes: Int, metadataBytes: Int
    public init(threads: Int = 8, turnsPerThread: Int = 32, itemsPerThread: Int = 128,
                textBytes: Int = 32_768, metadataBytes: Int = 8_192) {
        self.threads = max(1, threads)
        self.turnsPerThread = max(1, turnsPerThread)
        self.itemsPerThread = max(1, itemsPerThread)
        self.textBytes = max(1, textBytes)
        self.metadataBytes = max(32, metadataBytes)
    }
}

public struct CodexHistoryTruncation: Equatable, Sendable {
    public fileprivate(set) var threads = 0
    public fileprivate(set) var turns = 0
    public fileprivate(set) var items = 0
    public fileprivate(set) var unknownEvents = 0
    public fileprivate(set) var approvals = 0
    public fileprivate(set) var metadata = false
}

    /// Retention: threads 8 / turns-per-thread 32 / items-per-thread 128 /
    /// unknownEvents 100 (all drop-oldest, pending-approval pins exempt) /
    /// pending approvals 64 (drop-oldest; approvals resolve explicitly, so an
    /// unbounded session would otherwise grow this array without limit and
    /// every per-eval reduction iterates it via pinned-thread scans).
public struct CodexEventStore: Equatable, Sendable {
    public private(set) var threads: [String: CodexThread] = [:]
    public private(set) var approvals: [CodexApproval] = []
    public private(set) var unknownEvents: [CodexEvent] = []
    public private(set) var lastError: CodexJSON = .null
    public private(set) var truncation = CodexHistoryTruncation()
    private let maximumUnknownEvents: Int
    private let limits: CodexRetentionLimits
    private var threadOrder: [String] = []
    public init(maximumUnknownEvents: Int = 100, limits: CodexRetentionLimits = CodexRetentionLimits()) {
        self.maximumUnknownEvents = max(0, maximumUnknownEvents)
        self.limits = limits
    }
    public func thread(id: String) -> CodexThread? { threads[id] }

    public mutating func resolve(_ id: CodexRequestID) {
        approvals.removeAll { $0.id == id }
        trimHistory()
    }

    public mutating func reduce(_ event: CodexEvent) {
        let p = event.params
        if case .request(let id, let method, let params) = event {
            if method.hasSuffix("/requestApproval") || method == "item/tool/requestUserInput" {
                approvals.removeAll { $0.id == id }
                approvals.append(CodexApproval(id: id, method: method, params: params))
                trimHistory()
            } else { retain(event) }
            return
        }
        if event.method == "serverRequest/resolved", let id = CodexRequestID(p["requestId"]) {
            resolve(id)
            return
        }
        if event.method == "error" { lastError = boundedJSON(p, truncated: &truncation.metadata); return }
        guard let threadID = p["threadId"].string ?? p["thread"]["id"].string else { retain(event); return }
        var thread = threads[threadID] ?? CodexThread(id: threadID)
        switch event.method {
        case "thread/started":
            thread.title = p["thread"]["name"].string ?? p["thread"]["preview"].string ?? thread.title
            thread.status = p["thread"]["status"]
        case "thread/name/updated": thread.title = p["threadName"].string ?? thread.title
        case "thread/status/changed": thread.status = p["status"]
        case "thread/tokenUsage/updated": thread.tokenUsage = p["tokenUsage"]
        case "turn/started", "turn/completed", "turn/diff/updated", "turn/plan/updated":
            guard let id = p["turnId"].string ?? p["turn"]["id"].string else { retain(event); return }
            var turn = thread.turns[id] ?? CodexTurn(id: id)
            if event.method == "turn/diff/updated" { turn.diff = p["diff"].string ?? "" }
            else if event.method == "turn/plan/updated" {
                turn.explanation = p["explanation"].string
                turn.plan = p["plan"].array.map { CodexPlanStep(step: $0["step"].string ?? "", status: $0["status"].string ?? "unknown") }
            } else {
                turn.status = p["turn"]["status"].string ?? (event.method == "turn/started" ? "inProgress" : "unknown")
                turn.error = p["turn"]["error"]
            }
            turn.diff = boundedText(turn.diff, truncated: &turn.contentTruncated)
            if let explanation = turn.explanation { turn.explanation = boundedText(explanation, truncated: &turn.contentTruncated) }
            turn.error = boundedJSON(turn.error, truncated: &turn.contentTruncated)
            // The complete plan shares the metadata budget rather than retaining many large steps.
            let plan = boundedJSON(.array(turn.plan.map { .object(["step": .string($0.step), "status": .string($0.status)]) }), truncated: &turn.contentTruncated)
            turn.plan = plan.array.map { CodexPlanStep(step: $0["step"].string ?? "", status: $0["status"].string ?? "unknown") }
            thread.turns[id] = turn
            thread.turnOrder.removeAll { $0 == id }
            thread.turnOrder.append(id)
        case "item/started", "item/completed", "item/agentMessage/delta", "item/reasoning/textDelta",
             "item/reasoning/summaryTextDelta", "item/plan/delta", "item/commandExecution/outputDelta", "item/fileChange/outputDelta":
            guard let id = p["itemId"].string ?? p["item"]["id"].string else { retain(event); return }
            let index = thread.items.firstIndex { $0.id == id }
            var item = index.map { thread.items[$0] } ?? CodexItem(id: id, turnID: p["turnId"].string ?? "")
            if event.method == "item/started" || event.method == "item/completed" {
                item.kind = p["item"]["type"].string ?? item.kind
                item.status = p["item"]["status"].string ?? (event.method == "item/completed" ? "completed" : "inProgress")
                item.text = p["item"]["text"].string ?? item.text
                item.output = p["item"]["aggregatedOutput"].string ?? item.output
                item.metadata = p["item"]
            } else if event.method.hasSuffix("/outputDelta") { item.output += p["delta"].string ?? "" }
            else { item.text += p["delta"].string ?? "" }
            item.text = boundedText(item.text, truncated: &item.textTruncated)
            item.output = boundedText(item.output, truncated: &item.outputTruncated)
            item.metadata = boundedJSON(item.metadata, truncated: &item.metadataTruncated)
            if let index { thread.items.remove(at: index) }
            thread.items.append(item)
        default: retain(event); return
        }
        thread.title = boundedText(thread.title, truncated: &thread.contentTruncated)
        thread.status = boundedJSON(thread.status, truncated: &thread.contentTruncated)
        thread.tokenUsage = boundedJSON(thread.tokenUsage, truncated: &thread.contentTruncated)
        threads[threadID] = thread
        threadOrder.removeAll { $0 == threadID }
        threadOrder.append(threadID)
        trimHistory()
    }

    /// Pending approvals are never discarded or clipped. Their context may exceed
    /// history counts by the client's bounded pending-request limit (64 by default).
    private mutating func trimHistory() {
        if approvals.count > 64 {
            // CodexApproval carries no status/state field: every entry here
            // is pending by definition (resolve() removes on response), so
            // no exemption is distinguishable. Drop-oldest, but count it in
            // truncation.approvals so existing drop-count surfaces disclose
            // the eviction instead of dropping it silently.
            let overflow = approvals.count - 64
            approvals.removeFirst(overflow)
            truncation.approvals += overflow
        }
        let pinnedThreads = Set(approvals.compactMap { $0.params["threadId"].string })
        while threadOrder.count > limits.threads,
              let index = threadOrder.firstIndex(where: { !pinnedThreads.contains($0) }) {
            // Always keep the newest history entry as well as pending approvals.
            if index == threadOrder.count - 1 { break }
            threads.removeValue(forKey: threadOrder.remove(at: index))
            truncation.threads += 1
        }
        for id in threadOrder {
            guard var thread = threads[id] else { continue }
            let requests = approvals.filter { $0.params["threadId"].string == id }
            let pinnedTurns = Set(requests.compactMap { $0.params["turnId"].string })
            let pinnedItems = Set(requests.compactMap { $0.params["itemId"].string })
            while thread.turnOrder.count > limits.turnsPerThread,
                  let index = thread.turnOrder.firstIndex(where: { !pinnedTurns.contains($0) }) {
                if index == thread.turnOrder.count - 1 { break }
                thread.turns.removeValue(forKey: thread.turnOrder.remove(at: index))
                truncation.turns += 1
            }
            while thread.items.count > limits.itemsPerThread,
                  let index = thread.items.firstIndex(where: { !pinnedItems.contains($0.id) }) {
                if index == thread.items.count - 1 { break }
                thread.items.remove(at: index)
                truncation.items += 1
            }
            threads[id] = thread
        }
    }

    private func boundedText(_ value: String, truncated: inout Bool) -> String {
        guard value.utf8.count > limits.textBytes else { return value }
        truncated = true
        var bytes = value.utf8.suffix(limits.textBytes)
        // Do not retain half of a UTF-8 scalar at the beginning of the tail.
        while let first = bytes.first, first & 0xC0 == 0x80 { bytes = bytes.dropFirst() }
        return String(decoding: bytes, as: UTF8.self)
    }

    private func boundedJSON(_ value: CodexJSON, truncated: inout Bool) -> CodexJSON {
        guard let size = try? JSONEncoder().encode(value).count, size <= limits.metadataBytes else {
            truncated = true
            return .object(["_truncated": .bool(true)])
        }
        return value
    }

    private mutating func retain(_ event: CodexEvent) {
        guard maximumUnknownEvents > 0 else { truncation.unknownEvents += 1; return }
        let params = boundedJSON(event.params, truncated: &truncation.metadata)
        switch event {
        case .notification(let method, _): unknownEvents.append(.notification(method: method, params: params))
        case .request(let id, let method, _): unknownEvents.append(.request(id: id, method: method, params: params))
        }
        if unknownEvents.count > maximumUnknownEvents {
            let count = unknownEvents.count - maximumUnknownEvents
            unknownEvents.removeFirst(count)
            truncation.unknownEvents += count
        }
    }
}
