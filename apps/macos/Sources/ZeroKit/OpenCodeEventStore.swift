import Foundation

/// One Agent Client Protocol event reduced into the OpenCode store.
///
/// Unknown methods stay inspectable but never trigger an action, and their
/// parameters are capped so unknown traffic cannot grow retention without
/// bound. Nothing retained here ever carries credentials.
public struct OpenCodeEvent: Equatable, Sendable {
    public let method: String
    public let params: CodexJSON
    public let sessionID: String?

    public init(method: String, params: CodexJSON = .object([:]), sessionID: String? = nil) {
        self.method = method
        self.params = params
        self.sessionID = sessionID
    }
}

public struct OpenCodeSession: Equatable, Sendable {
    public let id: String
    public var transcript = ""
    public var contentTruncated = false
}

public struct OpenCodeHistoryTruncation: Equatable, Sendable {
    public fileprivate(set) var unknownEvents = 0
    public fileprivate(set) var content = false
}

/// Separate store per provider: an OpenCode session ID is never valid for
/// Codex and vice versa, so this store never shares state with
/// `CodexEventStore`. Retention mirrors the Codex limits: bounded unknown
/// events with eviction counts, bounded transcript tails with truncation
/// metadata.
public struct OpenCodeEventStore: Equatable, Sendable {
    public static let defaultMaximumUnknownEvents = 100
    public static let maximumTranscriptBytes = 32_768
    public static let maximumMetadataBytes = 8_192
    /// Session map cap: transcripts are tail-bounded per session, but the
    /// session COUNT was unbounded — one entry per session ID per session.
    /// Drop-oldest beyond 32 sessions; per-eval reductions iterate sessions.

    public private(set) var sessions: [String: OpenCodeSession] = [:]
    public private(set) var unknownEvents: [OpenCodeEvent] = []
    public private(set) var truncation = OpenCodeHistoryTruncation()
    private let maximumUnknownEvents: Int
    private let maximumSessions: Int
    private var sessionOrder: [String] = []

    public init(maximumUnknownEvents: Int = OpenCodeEventStore.defaultMaximumUnknownEvents,
                maximumSessions: Int = 32) {
        self.maximumUnknownEvents = max(0, maximumUnknownEvents)
        self.maximumSessions = max(1, maximumSessions)
    }

    public func session(id: String) -> OpenCodeSession? { sessions[id] }

    public mutating func reduce(_ event: OpenCodeEvent) {
        if event.method == "session/update",
           let sessionID = event.sessionID
               ?? event.params["sessionId"].string
               ?? event.params["sessionID"].string,
           !sessionID.isEmpty,
           event.params["update"]["sessionUpdate"].string == "agent_message_chunk",
           event.params["update"]["content"]["type"].string == "text",
           let text = event.params["update"]["content"]["text"].string {
            var session = sessions[sessionID] ?? OpenCodeSession(id: sessionID)
            session.transcript = boundedTail(
                session.transcript + text,
                truncated: &session.contentTruncated
            )
            if session.contentTruncated { truncation.content = true }
            sessions[sessionID] = session
            sessionOrder.removeAll { $0 == sessionID }
            sessionOrder.append(sessionID)
            while sessionOrder.count > maximumSessions {
                sessions.removeValue(forKey: sessionOrder.removeFirst())
            }
            return
        }
        retain(event)
    }

    private mutating func retain(_ event: OpenCodeEvent) {
        guard maximumUnknownEvents > 0 else {
            truncation.unknownEvents += 1
            return
        }
        let params = boundedMetadata(event.params, truncated: &truncation.content)
        unknownEvents.append(OpenCodeEvent(method: event.method, params: params, sessionID: event.sessionID))
        if unknownEvents.count > maximumUnknownEvents {
            let overflow = unknownEvents.count - maximumUnknownEvents
            unknownEvents.removeFirst(overflow)
            truncation.unknownEvents += overflow
        }
    }

    /// Keeps the tail so the newest transcript text survives truncation,
    /// without splitting a UTF-8 scalar at the cut.
    private func boundedTail(_ value: String, truncated: inout Bool) -> String {
        guard value.utf8.count > Self.maximumTranscriptBytes else { return value }
        truncated = true
        var bytes = value.utf8.suffix(Self.maximumTranscriptBytes)
        while let first = bytes.first, first & 0xC0 == 0x80 { bytes = bytes.dropFirst() }
        return String(decoding: bytes, as: UTF8.self)
    }

    private func boundedMetadata(_ value: CodexJSON, truncated: inout Bool) -> CodexJSON {
        guard let size = try? JSONEncoder().encode(value).count,
              size <= Self.maximumMetadataBytes else {
            truncated = true
            return .object(["_truncated": .bool(true)])
        }
        return value
    }
}
