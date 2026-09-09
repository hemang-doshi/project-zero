import Foundation
import Combine
import Darwin

public struct SSEEvent: Equatable, Sendable {
    public let name: String
    public let data: String
    public init(name: String, data: String) { self.name = name; self.data = data }
}

public struct SSEParser {
    private var line = Data()
    private var name = "message"
    private var data: [String] = []
    private var eventBytes = 0
    private var afterCR = false
    private let maximumEventBytes: Int
    public init(maximumEventBytes: Int = 65_536) { self.maximumEventBytes = max(1, maximumEventBytes) }
    public mutating func append(_ bytes: Data) throws -> [SSEEvent] {
        var events: [SSEEvent] = []
        for byte in bytes {
            if afterCR { afterCR = false; if byte == 10 { continue } }
            eventBytes += 1
            guard eventBytes <= maximumEventBytes else { throw ZeroError("Runtime event too large") }
            if byte == 10 || byte == 13 {
                guard let text = String(data: line, encoding: .utf8) else { throw ZeroError("Invalid runtime event encoding") }
                line.removeAll(keepingCapacity: true)
                afterCR = byte == 13
                if text.isEmpty {
                    if !data.isEmpty { events.append(SSEEvent(name: name, data: data.joined(separator: "\n"))) }
                    name = "message"; data.removeAll(keepingCapacity: true); eventBytes = 0
                } else if !text.hasPrefix(":") {
                    let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                    var value = parts.count == 2 ? String(parts[1]) : ""
                    if value.hasPrefix(" ") { value.removeFirst() }
                    if parts[0] == "event" { name = value }
                    if parts[0] == "data" { data.append(value) }
                }
            } else { line.append(byte) }
        }
        return events
    }
}

/// Incremental HTTP framing. Go's flushed SSE response normally uses chunks;
/// decoding only SSE lines from the raw socket would misread chunk boundaries.
struct StreamHTTPParser {
    private enum Phase { case headers, body, fixed(Int), size, chunk(Int), terminator(Int), trailers, complete }
    private var phase: Phase = .headers
    private var line = Data()
    private var trailerBytes = 0
    private let maximumHeaderBytes: Int
    var isComplete: Bool { if case .complete = phase { return true }; return false }
    init(maximumHeaderBytes: Int = 16_384) { self.maximumHeaderBytes = max(1, maximumHeaderBytes) }

    mutating func append(_ bytes: Data) throws -> Data {
        var output = Data()
        for byte in bytes {
            switch phase {
            case .headers:
                line.append(byte)
                guard line.count <= maximumHeaderBytes else { throw ZeroError("Runtime response headers too large") }
                if line.suffix(4) == Data("\r\n\r\n".utf8) { try parseHeaders(); line.removeAll(keepingCapacity: true) }
            case .body: output.append(byte)
            case .fixed(let remaining):
                output.append(byte); phase = remaining == 1 ? .complete : .fixed(remaining - 1)
            case .size:
                line.append(byte)
                guard line.count <= 128 else { throw ZeroError("Invalid runtime chunk size") }
                if line.suffix(2) == Data("\r\n".utf8) {
                    guard let text = String(data: line.dropLast(2), encoding: .ascii),
                          let sizeText = text.split(separator: ";", omittingEmptySubsequences: false).first,
                          !sizeText.isEmpty, sizeText.allSatisfy({ $0.isHexDigit }),
                          let size = Int(sizeText, radix: 16) else { throw ZeroError("Invalid runtime chunk size") }
                    phase = size == 0 ? .trailers : .chunk(size)
                    line.removeAll(keepingCapacity: true)
                }
            case .chunk(let remaining):
                output.append(byte); phase = remaining == 1 ? .terminator(0) : .chunk(remaining - 1)
            case .terminator(let index):
                guard byte == (index == 0 ? 13 : 10) else { throw ZeroError("Invalid runtime chunk terminator") }
                phase = index == 0 ? .terminator(1) : .size
            case .trailers:
                trailerBytes += 1; line.append(byte)
                guard trailerBytes <= maximumHeaderBytes else { throw ZeroError("Runtime response trailers too large") }
                if line.suffix(2) == Data("\r\n".utf8) {
                    if line.count == 2 { phase = .complete }
                    else if !line.contains(58) { throw ZeroError("Invalid runtime response trailer") }
                    line.removeAll(keepingCapacity: true)
                }
            case .complete: throw ZeroError("Unexpected bytes after runtime response")
            }
        }
        return output
    }

    func finish() throws {
        switch phase {
        case .body, .complete: return
        default: throw ZeroError("Truncated runtime stream response")
        }
    }

    private mutating func parseHeaders() throws {
        guard let text = String(data: line, encoding: .utf8) else { throw ZeroError("Invalid runtime response headers") }
        let lines = text.components(separatedBy: "\r\n")
        let status = lines[0].split(separator: " ")
        guard status.count >= 2, ["HTTP/1.1", "HTTP/1.0"].contains(String(status[0])), status[1] == "200" else {
            throw ZeroError("Runtime stream rejected", rejected: true)
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { throw ZeroError("Invalid runtime response header") }
            let key = line[..<colon].lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces).lowercased()
            guard headers[key] == nil else { throw ZeroError("Duplicate runtime response header") }
            headers[key] = value
        }
        guard headers["content-type"]?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces) == "text/event-stream" else {
            throw ZeroError("Runtime response is not an event stream")
        }
        if let encoding = headers["transfer-encoding"] {
            guard encoding == "chunked", headers["content-length"] == nil else { throw ZeroError("Unsupported runtime transfer encoding") }
            phase = .size
        } else if let text = headers["content-length"] {
            guard !text.isEmpty, text.allSatisfy({ $0.isNumber }), let count = Int(text) else { throw ZeroError("Invalid runtime content length") }
            phase = count == 0 ? .complete : .fixed(count)
        } else { phase = .body }
    }
}

public struct RuntimeChange: Sendable, Equatable {
    public let name: String
    public let revision: UInt64
    public let domains: [String]
    public let timestamp: String
    private struct Payload: Decodable { let revision: UInt64; let domains: [String]; let timestamp: String }
    public init(event: SSEEvent) throws {
        guard ["ready", "runtime.changed", "keepalive"].contains(event.name) else { throw ZeroError("Unknown runtime event") }
        let payload = try JSONDecoder().decode(Payload.self, from: Data(event.data.utf8))
        guard payload.domains.count <= 100 else { throw ZeroError("Runtime event has too many domains") }
        name = event.name; revision = payload.revision; domains = payload.domains; timestamp = payload.timestamp
    }
}

public struct UnixEventStream: Sendable {
    public let socketPath: String
    public init(socketPath: String) { self.socketPath = socketPath }
    public func events() -> AsyncThrowingStream<RuntimeChange, Error> {
        let cancellation = StreamCancellation()
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            continuation.onTermination = { _ in cancellation.cancel() }
            DispatchQueue.global(qos: .utility).async {
                do {
                    let connection = try UnixSocketConnection(socketPath: socketPath, timeoutSeconds: 30)
                    cancellation.attach(connection)
                    let result: Result<Void, Error> = Result {
                        try cancellation.check()
                        let request = Data("GET /v0.1/cockpit/stream HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n".utf8)
                        try request.withUnsafeBytes { bytes in
                            var sent = 0
                            while sent < bytes.count {
                                let count = Darwin.write(connection.fd, bytes.baseAddress!.advanced(by: sent), bytes.count - sent)
                                if count < 0 && errno == EINTR { continue }
                                guard count > 0 else { throw ZeroError("Runtime stream write failed") }
                                sent += count
                            }
                        }
                        var http = StreamHTTPParser()
                        var sse = SSEParser()
                        var buffer = [UInt8](repeating: 0, count: 8192)
                        while !http.isComplete {
                            try cancellation.check()
                            let count = Darwin.read(connection.fd, &buffer, buffer.count)
                            if count < 0 && errno == EINTR { continue }
                            if count == 0 { try http.finish(); break }
                            guard count > 0 else { throw ZeroError("Runtime stream timed out or disconnected") }
                            for event in try sse.append(http.append(Data(buffer.prefix(count)))) {
                                // Unknown extensions are ignored; malformed known events fail closed.
                                if ["ready", "runtime.changed", "keepalive"].contains(event.name) {
                                    continuation.yield(try RuntimeChange(event: event))
                                }
                            }
                        }
                    }
                    connection.close() // Close before notifying the reconnect loop.
                    continuation.finish(throwing: result.failure)
                } catch { continuation.finish(throwing: error) }
            }
        }
    }
}

private extension Result where Success == Void {
    var failure: Failure? { if case .failure(let error) = self { return error }; return nil }
}

private final class StreamCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var connection: UnixSocketConnection?
    private var cancelled = false
    func attach(_ connection: UnixSocketConnection) {
        lock.withLock { self.connection = connection; if cancelled { connection.cancel() } }
    }
    func cancel() { lock.withLock { cancelled = true; connection?.cancel() } }
    func check() throws { if lock.withLock({ cancelled }) { throw CancellationError() } }
}

public enum RuntimeConnectionState: String, Sendable { case connecting, live, reconnecting, offline }

@MainActor
public final class CockpitClient: ObservableObject {
    @Published public private(set) var snapshot: CockpitSnapshot?
    @Published public private(set) var state: RuntimeConnectionState = .offline
    @Published public private(set) var lastError: String?
    @Published public private(set) var receivedAt: Date?
    private let fetchSnapshot: @Sendable () async throws -> CockpitSnapshot
    private let openStream: @Sendable () -> AsyncThrowingStream<RuntimeChange, Error>
    private let reconnectDelay: TimeInterval
    private let maximumSnapshotAge: TimeInterval
    private var streamTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var ageTask: Task<Void, Never>?
    private var refreshPending = false
    private var streamReady = false
    private var generation = UUID()
    private var snapshotEpoch = UUID()
    private var refreshID: UUID?
    private var ageTaskID: UUID?

    public init(socketPath: String, reconnectDelay: TimeInterval = 1, maximumSnapshotAge: TimeInterval = 5,
                fetchSnapshot: (@Sendable () async throws -> CockpitSnapshot)? = nil,
                openStream: (@Sendable () -> AsyncThrowingStream<RuntimeChange, Error>)? = nil) {
        self.fetchSnapshot = fetchSnapshot ?? {
            let value = try await UnixHTTP.call(socketPath: socketPath, path: "cockpit")
            return try CockpitSnapshot.decode(JSONSerialization.data(withJSONObject: value))
        }
        self.openStream = openStream ?? { UnixEventStream(socketPath: socketPath).events() }
        self.reconnectDelay = max(0.01, reconnectDelay)
        self.maximumSnapshotAge = max(0.01, maximumSnapshotAge)
    }

    public func start() {
        guard streamTask == nil else { return }
        generation = UUID()
        let token = generation
        state = .connecting
        streamTask = Task { [weak self] in
            // Do not retain the client across an unbounded stream lifetime.
            while !Task.isCancelled {
                guard let stream = self?.openStream() else { return }
                do {
                    for try await change in stream {
                        guard let self, self.generation == token, !Task.isCancelled else { return }
                        if change.name == "ready" {
                            self.beginReadyEpoch(generation: token)
                        } else {
                            self.streamReady = true
                            self.refresh()
                        }
                    }
                } catch {
                    guard !Task.isCancelled, let self, self.generation == token else { return }
                    self.lastError = error.localizedDescription
                }
                guard let delay = self?.disconnected(generation: token), !Task.isCancelled else { return }
                do { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) } catch { return }
            }
        }
    }

    public func stop() {
        generation = UUID()
        streamTask?.cancel(); streamTask = nil
        refreshTask?.cancel(); refreshTask = nil
        ageTask?.cancel(); ageTask = nil
        refreshID = nil; ageTaskID = nil
        snapshotEpoch = UUID()
        refreshPending = false; streamReady = false; state = .offline
    }

    /// Call after a command as well as for stream invalidations. Bursts coalesce
    /// to one active fetch plus one trailing fetch so mutations cannot be lost.
    public func refresh() {
        guard streamTask != nil else { return }
        if refreshTask != nil { refreshPending = true; return }
        let token = generation
        let epoch = snapshotEpoch
        let taskID = UUID()
        refreshID = taskID
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let fetch = self?.fetchSnapshot else { return }
                do {
                    let value = try await fetch()
                    guard let self, self.generation == token, self.snapshotEpoch == epoch,
                          self.refreshID == taskID, !Task.isCancelled else { return }
                    let receivedAt = Date()
                    self.snapshot = value; self.receivedAt = receivedAt; self.lastError = nil
                    self.state = self.streamReady ? .live : .reconnecting
                    self.scheduleAgeRefresh(generation: token, from: receivedAt)
                } catch {
                    guard let self, self.generation == token, self.snapshotEpoch == epoch,
                          self.refreshID == taskID, !Task.isCancelled else { return }
                    self.lastError = error.localizedDescription; self.state = .offline
                    self.scheduleAgeRefresh(generation: token, from: Date())
                }
                guard let self, self.generation == token, self.snapshotEpoch == epoch,
                      self.refreshID == taskID else { return }
                if self.refreshPending { self.refreshPending = false }
                else { self.refreshTask = nil; self.refreshID = nil; return }
            }
        }
    }

    private func beginReadyEpoch(generation: UUID) {
        guard self.generation == generation else { return }
        invalidateSnapshotEpoch()
        streamReady = true
        state = .connecting
        refresh()
    }

    private func invalidateSnapshotEpoch() {
        snapshotEpoch = UUID()
        refreshTask?.cancel(); refreshTask = nil
        refreshID = nil
        refreshPending = false
        ageTask?.cancel(); ageTask = nil
        ageTaskID = nil
    }

    private func scheduleAgeRefresh(generation: UUID, from receivedAt: Date) {
        ageTask?.cancel()
        let taskID = UUID()
        ageTaskID = taskID
        let deadline = receivedAt.addingTimeInterval(maximumSnapshotAge)
        ageTask = Task { [weak self] in
            let remaining = max(0, deadline.timeIntervalSinceNow)
            if remaining > 0 {
                do { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) } catch { return }
            }
            guard let self, self.generation == generation, self.ageTaskID == taskID,
                  !Task.isCancelled else { return }
            self.ageTask = nil
            self.ageTaskID = nil
            if self.streamReady { self.refresh() }
        }
    }

    private func disconnected(generation: UUID) -> TimeInterval? {
        guard self.generation == generation else { return nil }
        invalidateSnapshotEpoch()
        streamReady = false; state = .reconnecting
        return reconnectDelay
    }

    deinit { streamTask?.cancel(); refreshTask?.cancel(); ageTask?.cancel() }
}
