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
}

public struct CodexThread: Identifiable, Equatable, Sendable {
    public let id: String
    public var title = ""
    public var status: CodexJSON = .null
    public var turns: [String: CodexTurn] = [:]
    public var items: [CodexItem] = []
    public var tokenUsage: CodexJSON = .null
    public func item(id: String) -> CodexItem? { items.first { $0.id == id } }
}

public struct CodexApproval: Identifiable, Equatable, Sendable {
    public let id: CodexRequestID
    public let method: String
    public let params: CodexJSON
}

/// Unknown notifications remain inspectable, but never trigger an action.
public struct CodexEventStore: Equatable, Sendable {
    public private(set) var threads: [String: CodexThread] = [:]
    public private(set) var approvals: [CodexApproval] = []
    public private(set) var unknownEvents: [CodexEvent] = []
    public private(set) var lastError: CodexJSON = .null
    private let maximumUnknownEvents: Int
    public init(maximumUnknownEvents: Int = 100) { self.maximumUnknownEvents = max(0, maximumUnknownEvents) }
    public func thread(id: String) -> CodexThread? { threads[id] }

    public mutating func resolve(_ id: CodexRequestID) { approvals.removeAll { $0.id == id } }

    public mutating func reduce(_ event: CodexEvent) {
        let p = event.params
        if case .request(let id, let method, let params) = event {
            if method.hasSuffix("/requestApproval") || method == "item/tool/requestUserInput" {
                resolve(id)
                approvals.append(CodexApproval(id: id, method: method, params: params))
            } else { retain(event) }
            return
        }
        if event.method == "serverRequest/resolved", let id = CodexRequestID(p["requestId"]) {
            resolve(id)
            return
        }
        if event.method == "error" { lastError = p; return }
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
            thread.turns[id] = turn
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
            if let index { thread.items[index] = item } else { thread.items.append(item) }
        default: retain(event); return
        }
        threads[threadID] = thread
    }

    private mutating func retain(_ event: CodexEvent) {
        guard maximumUnknownEvents > 0 else { return }
        unknownEvents.append(event)
        if unknownEvents.count > maximumUnknownEvents { unknownEvents.removeFirst(unknownEvents.count - maximumUnknownEvents) }
    }
}
