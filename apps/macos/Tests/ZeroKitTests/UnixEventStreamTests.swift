import XCTest
@testable import ZeroKit

final class UnixEventStreamTests: XCTestCase {
    func testUnixConnectionRejectsNonSocketBeforeConnect() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("zero-not-a-socket-\(UUID().uuidString)")
        try Data("not a socket".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertThrowsError(try UnixSocketConnection(socketPath: file.path, timeoutSeconds: 1))
    }

    func testUnixHTTPRejectsMalformedOrOversizedFraming() throws {
        XCTAssertThrowsError(try UnixHTTP.decode(Data("NOTHTTP 200 OK\r\n\r\n{}".utf8)))
        XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 200 OK\r\nX-Fill: \(String(repeating: "x", count: 16_384))\r\n\r\n{}".utf8)))
        XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nxXX0\r\n\r\n".utf8)))
    }

    func testSSEPreservesSplitUTF8AndMultilineData() throws {
        var parser = SSEParser()
        let bytes = Data("event: runtime.changed\r\ndata: {\"revision\":2,\r\ndata: \"domains\":[\"séssion\"],\"timestamp\":\"2026-09-10T00:00:00Z\"}\r\n\r\n".utf8)
        var events: [SSEEvent] = []
        for byte in bytes { events += try parser.append(Data([byte])) }
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].name, "runtime.changed")
        let change = try RuntimeChange(event: events[0])
        XCTAssertEqual(change.revision, 2)
        XCTAssertEqual(change.domains, ["séssion"])
    }

    func testSSERejectsOversizedEventAndInvalidUTF8() throws {
        var parser = SSEParser(maximumEventBytes: 32)
        XCTAssertThrowsError(try parser.append(Data("data: \(String(repeating: "x", count: 33))".utf8)))
        var invalid = SSEParser()
        XCTAssertThrowsError(try invalid.append(Data([100, 97, 116, 97, 58, 255, 10, 10])))
        XCTAssertThrowsError(try RuntimeChange(event: SSEEvent(name: "ready", data: "{}")))
    }

    func testHTTPChunkedStreamAcrossEveryByte() throws {
        var parser = StreamHTTPParser()
        let body = "event: ready\ndata: {}\n\n"
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n\(String(body.utf8.count, radix: 16))\r\n\(body)\r\n0\r\n\r\n"
        var decoded = Data()
        for byte in response.utf8 { decoded.append(try parser.append(Data([byte]))) }
        XCTAssertEqual(String(decoding: decoded, as: UTF8.self), body)
        XCTAssertTrue(parser.isComplete)
        XCTAssertNoThrow(try parser.finish())
    }

    func testHTTPRejectsBadStatusHeadersAndChunkTerminator() throws {
        for response in [
            "HTTP/1.1 403 Forbidden\r\nContent-Type: text/event-stream\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: gzip\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nxXX"
        ] {
            var parser = StreamHTTPParser()
            XCTAssertThrowsError(try parser.append(Data(response.utf8)))
        }
        var oversized = StreamHTTPParser(maximumHeaderBytes: 32)
        XCTAssertThrowsError(try oversized.append(Data(String(repeating: "x", count: 33).utf8)))
        var truncated = StreamHTTPParser()
        _ = try truncated.append(Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhi".utf8))
        XCTAssertThrowsError(try truncated.finish())
    }

    func testSnapshotUsesTypedSessionAndMarksProjectionAsDisplayOnly() throws {
        let snapshot = try CockpitSnapshot.decode(Self.snapshotData)
        XCTAssertEqual(snapshot.session.elapsedMS, 3_661_000)
        XCTAssertEqual(snapshot.projects.first?.path, "/registered/repo")
        XCTAssertTrue(snapshot.truncated["projects"] == true)
        XCTAssertEqual(snapshot.nodes.first?.revoked, true)
        XCTAssertEqual(snapshot.nodes.first?.status, "REVOKED")
        XCTAssertEqual(snapshot.integrations.first?.data["branch"], "main")
    }

    @MainActor
    func testClientCoalescesChangesAndRefreshesOnKeepalive() async throws {
        let fixture = ClientFixture(data: Self.snapshotData)
        let client = CockpitClient(socketPath: "/unused", reconnectDelay: 0.01, maximumSnapshotAge: 60,
            fetchSnapshot: { try await fixture.fetch() }, openStream: { fixture.open() })
        client.start()
        await fixture.waitForConnections(1)
        fixture.emit("ready", revision: 1)
        await fixture.waitForFetches(1)
        for revision in 2...20 { fixture.emit("runtime.changed", revision: UInt64(revision)) }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.fetchCount, 1, "Only one fetch may be in flight")
        fixture.releaseFetch()
        await fixture.waitForFetches(2)
        fixture.releaseFetch()
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(fixture.fetchCount, 2, "A burst needs only one trailing refresh")
        XCTAssertEqual(client.state, .live)
        fixture.emit("keepalive", revision: 20)
        await fixture.waitForFetches(3)
        fixture.releaseFetch()
        client.stop()
        XCTAssertEqual(client.state, .offline)
    }

    @MainActor
    func testReconnectWaitsForClosureAndRefetchesLowerRevision() async throws {
        let fixture = ClientFixture(data: Self.snapshotData)
        let client = CockpitClient(socketPath: "/unused", reconnectDelay: 0.01, maximumSnapshotAge: 60,
            fetchSnapshot: { try await fixture.fetch() }, openStream: { fixture.open() })
        client.start()
        await fixture.waitForConnections(1)
        fixture.emit("ready", revision: 90)
        await fixture.waitForFetches(1)
        fixture.releaseFetch()
        try await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(fixture.connections, 1)
        fixture.close()
        await fixture.waitForConnections(2)
        fixture.emit("ready", revision: 0)
        await fixture.waitForFetches(2)
        fixture.releaseFetch()
        client.stop()
        try await Task.sleep(nanoseconds: 30_000_000)
        XCTAssertEqual(fixture.connections, 2)
        XCTAssertEqual(client.state, .offline)
    }

    @MainActor
    func testReconnectNeverPublishesSnapshotFromPreviousStreamEpoch() async throws {
        let fixture = ClientFixture(data: Self.snapshotData)
        let client = CockpitClient(socketPath: "/unused", reconnectDelay: 0.01, maximumSnapshotAge: 60,
            fetchSnapshot: { try await fixture.fetch() }, openStream: { fixture.open() })
        client.start()
        await fixture.waitForConnections(1)
        fixture.emit("ready", revision: 90)
        await fixture.waitForFetches(1)

        fixture.close()
        await fixture.waitForConnections(2)
        fixture.emit("ready", revision: 0)
        await fixture.waitForFetches(2)
        XCTAssertEqual(fixture.fetchCount, 2, "The new ready epoch must not wait for an obsolete fetch")

        fixture.releaseFetch(1, data: Self.snapshotData(revision: 90))
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertNil(client.snapshot, "A snapshot fetched for the closed stream must be discarded")
        XCTAssertEqual(client.state, .connecting, "An obsolete fetch must not mark the replacement stream live")

        fixture.releaseFetch(2, data: Self.snapshotData(revision: 0))
        await Self.wait { client.snapshot?.revision == 0 && client.state == .live }
        client.stop()
    }

    @MainActor
    func testLiveClientRefreshesWhenSnapshotAges() async throws {
        let fixture = ClientFixture(data: Self.snapshotData)
        let client = CockpitClient(socketPath: "/unused", reconnectDelay: 0.01, maximumSnapshotAge: 0.02,
            fetchSnapshot: { try await fixture.fetch() }, openStream: { fixture.open() })
        client.start()
        await fixture.waitForConnections(1)
        fixture.emit("ready", revision: 1)
        await fixture.waitForFetches(1)
        fixture.releaseFetch()
        await fixture.waitForFetches(2)
        fixture.releaseFetch()
        client.stop()
        XCTAssertEqual(fixture.fetchCount, 2)
        XCTAssertEqual(client.state, .offline)
    }

    @MainActor
    func testSnapshotAgeDeadlineIsScheduledFromReceiptTime() async throws {
        let maximumAge: TimeInterval = 0.12
        let fixture = ClientFixture(data: Self.snapshotData)
        let client = CockpitClient(socketPath: "/unused", reconnectDelay: 0.01, maximumSnapshotAge: maximumAge,
            fetchSnapshot: { try await fixture.fetch() }, openStream: { fixture.open() })
        client.start()
        await fixture.waitForConnections(1)

        // Phase-shift receipt just after the old fixed-period check. A periodic
        // timer would miss the next deadline and wait almost another full age.
        try await Task.sleep(nanoseconds: 140_000_000)
        fixture.emit("ready", revision: 1)
        await fixture.waitForFetches(1)
        fixture.releaseFetch(1)
        let received = Date()

        await fixture.waitForFetches(2)
        let elapsed = Date().timeIntervalSince(received)
        XCTAssertLessThan(elapsed, 0.19, "Refresh must be scheduled from receivedAt + maximumSnapshotAge")
        fixture.releaseFetch(2)
        client.stop()
    }

    static let snapshotData = Data(#"{"version":"0.1","revision":2,"timestamp":"2026-09-10T00:00:00.123456Z","status":"RUNNING","runtime_version":"0.2.0","release":{"version":"0.2.0","build":"0.2.0-7","protocols":["0.1"],"render_schemas":["0.1","0.2"],"database_version":2},"session":{"id":"s1","project_id":"p1","project":"Zero","state":"RUNNING","elapsed_ms":3661000,"since_ms":1,"revision":2},"integrations":[{"id":"git","enabled":true,"status":"FRESH","observed_at":"2026-09-10T00:00:00Z","data":{"branch":"main"}}],"policies":[],"context":{},"projects":[{"id":"p1","name":"Zero","path":"/registered/repo","aliases":[],"removed":false}],"nodes":[{"id":"desk","revoked":1,"capabilities":["display.render"],"last_seen":"2026-09-10T00:00:00Z","status":"REVOKED"}],"node_profiles":[],"approvals":[],"firings":[],"invocations":[],"events":[],"audit":[],"truncated":{"projects":true}}"#.utf8)

    static func snapshotData(revision: UInt64) -> Data {
        let text = String(decoding: snapshotData, as: UTF8.self)
        return Data(text.replacingOccurrences(of: #""revision":2"#, with: #""revision":\#(revision)"#).utf8)
    }

    @MainActor
    static func wait(_ condition: @escaping @MainActor () -> Bool) async {
        for _ in 0..<200 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
        XCTFail("Timed out waiting for client state")
    }
}

private final class ClientFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let data: Data
    private var continuation: AsyncThrowingStream<RuntimeChange, Error>.Continuation?
    private var fetchContinuations: [Int: CheckedContinuation<CockpitSnapshot, Error>] = [:]
    private var fetches = 0
    private var opens = 0
    init(data: Data) { self.data = data }
    var fetchCount: Int { lock.withLock { fetches } }
    var connections: Int { lock.withLock { opens } }
    func open() -> AsyncThrowingStream<RuntimeChange, Error> {
        AsyncThrowingStream { stream in lock.withLock { opens += 1; continuation = stream } }
    }
    func fetch() async throws -> CockpitSnapshot {
        try await withCheckedThrowingContinuation { result in
            lock.withLock {
                fetches += 1
                fetchContinuations[fetches] = result
            }
        }
    }
    func releaseFetch(_ number: Int? = nil, data replacement: Data? = nil) {
        let result = lock.withLock { () -> CheckedContinuation<CockpitSnapshot, Error>? in
            let key = number ?? fetchContinuations.keys.min()
            guard let key else { return nil }
            return fetchContinuations.removeValue(forKey: key)
        }
        result?.resume(with: Result { try CockpitSnapshot.decode(replacement ?? data) })
    }
    func emit(_ name: String, revision: UInt64) {
        let value = try! RuntimeChange(event: SSEEvent(name: name, data: "{\"revision\":\(revision),\"domains\":[],\"timestamp\":\"2026-09-10T00:00:00Z\"}"))
        lock.withLock { continuation }?.yield(value)
    }
    func close() { lock.withLock { continuation }?.finish() }
    func waitForFetches(_ count: Int) async { await wait { self.fetchCount >= count } }
    func waitForConnections(_ count: Int) async { await wait { self.connections >= count } }
    private func wait(_ condition: () -> Bool) async {
        for _ in 0..<200 { if condition() { return }; try? await Task.sleep(nanoseconds: 5_000_000) }
        XCTFail("Timed out waiting for client progress")
    }
}
