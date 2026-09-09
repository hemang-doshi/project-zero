import XCTest
@testable import ZeroCockpit
import ZeroKit

final class NetworkFlightViewTests: XCTestCase {
    func testNetworkFactsUseOnlyProjectedNodeAndInvocationEvidence() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let facts = NetworkFacts(snapshot: snapshot, connection: .live)

        XCTAssertTrue(facts.isLive)
        XCTAssertEqual(facts.registeredNodeCountLabel, "2+")
        XCTAssertEqual(facts.onlineNodeCount, 1)
        XCTAssertEqual(facts.capabilityCount, 3)
        XCTAssertEqual(facts.evidenceRows.map(\.target), ["desk"])
        XCTAssertEqual(facts.evidenceRows.map(\.evidenceID), ["invoke-1"])
        XCTAssertEqual(facts.delivery(for: facts.nodes[0]).label, "Delivered")
        XCTAssertFalse(facts.delivery(for: facts.nodes[0]).label.localizedCaseInsensitiveContains("rendered"))
    }

    func testNetworkFactsLabelRetainedSnapshotAsCachedWhenTransportIsOffline() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let facts = NetworkFacts(snapshot: snapshot, connection: .offline)

        XCTAssertFalse(facts.isLive)
        XCTAssertEqual(facts.freshnessLabel, "CACHED · 2026-09-10T00:00:00Z")
        XCTAssertEqual(facts.nodes.count, 2)
    }

    func testFlightProjectionSeparatesOriginsAndDoesNotExposeUnknownCodexFields() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        var codex = CodexEventStore()
        codex.reduce(.notification(method: "future/privateEvent", params: .object([
            "threadId": .string("thread-7"),
            "status": .string("waiting"),
            "secret": .string("must-not-appear")
        ])))

        let projection = FlightProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: codex,
            codexConnection: .connected
        )

        XCTAssertEqual(projection.records.filter { $0.origin == .runtime }.count, 3)
        XCTAssertEqual(projection.records.filter { $0.origin == .codex }.count, 1)
        XCTAssertEqual(projection.runtimeEventCountLabel, "1+")
        XCTAssertTrue(projection.historyNotice.contains("lower bound"))
        let codexFields = projection.records.first { $0.origin == .codex }?.fields.map { $0.1 }.joined(separator: " ") ?? ""
        XCTAssertFalse(codexFields.contains("must-not-appear"))
        XCTAssertTrue(codexFields.contains("thread-7"))
    }

    func testFlightFiltersAreCombinedWithoutInventingRows() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let projection = FlightProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected
        )

        let matching = projection.filtered(category: .invocations, outcome: .success, query: "desk")

        XCTAssertEqual(matching.map(\.id), ["runtime-invocation-invoke-1"])
        XCTAssertEqual(projection.filtered(category: .codex, outcome: .all, query: "").count, 0)
    }

    func testFlightOrdersProjectedTimestampsBeforeUntimestampedState() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let projection = FlightProjection(
            snapshot: snapshot,
            runtimeConnection: .live,
            codexStore: CodexEventStore(),
            codexConnection: .disconnected
        )

        XCTAssertEqual(projection.records.map(\.id), [
            "runtime-audit-8",
            "runtime-event-event-9",
            "runtime-invocation-invoke-1"
        ])
    }

    private let snapshotJSON = #"""
    {
      "version":"0.1","revision":42,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",
      "release":{"version":"0.2.0","build":"7"},
      "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":1,"since_ms":0,"revision":3},
      "integrations":[],"policies":[],"context":{},
      "projects":[{"id":"p","name":"Project Zero","path":"/display/path","removed":false}],
      "nodes":[
        {"id":"desk","revoked":false,"capabilities":["display.render","display.clear"],"last_seen":"2026-09-10T00:00:00Z","status":"ONLINE"},
        {"id":"sensor","revoked":false,"capabilities":["telemetry.read"],"status":"OFFLINE"},
        {"id":"old","revoked":true,"capabilities":["legacy"],"status":"REVOKED"}
      ],
      "node_profiles":[{"id":"desk","value":{"render_schema":"0.2","version":"0.2.0","build":"7"}}],
      "approvals":[],"firings":[],
      "invocations":[{"id":"invoke-1","principal":"owner","node":"desk","capability":"display.render","status":"SUCCEEDED","approved":1,"deadline":"2026-09-10T01:00:00Z","attempts":1}],
      "events":[{"seq":9,"id":"event-9","kind":"session.changed","time":"2026-09-10T00:00:00Z"}],
      "audit":[{"seq":8,"principal":"owner","action":"session.start","target":"runtime","decision":"ALLOW","correlation":"event-9","time":"2026-09-10T00:01:00Z","previous_hash":"prev","hash":"hash"}],
      "truncated":{"nodes":true,"events":true}
    }
    """#
}
