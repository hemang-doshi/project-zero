import XCTest
@testable import ZeroCockpit
import ZeroKit

final class NetworkFlightViewTests: XCTestCase {
    func testNetworkFactsUseOnlyProjectedNodeAndInvocationEvidence() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let facts = NetworkFacts(snapshot: snapshot, connection: .live)

        XCTAssertTrue(facts.isLive)
        XCTAssertEqual(facts.registeredNodeCountLabel, "3+")
        XCTAssertEqual(facts.activeNodeCount, 2)
        XCTAssertEqual(facts.revokedNodeCount, 1)
        XCTAssertEqual(facts.onlineNodeCount, 1)
        XCTAssertEqual(facts.capabilityCount, 4)
        XCTAssertEqual(facts.nodes.map(\.id), ["desk", "sensor", "old"])
        XCTAssertEqual(facts.lifecycleStatus(for: facts.nodes[2]), "REVOKED")
        XCTAssertEqual(facts.delivery(for: facts.nodes[2]).label, "Revoked")
        XCTAssertTrue(facts.topologyNotice.contains("including 1 revoked"))
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
        XCTAssertEqual(facts.nodes.count, 3)
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
        XCTAssertEqual(projection.records.first { $0.origin == .codex }?.originLabel, "CODEX LIVE MEMORY")
    }

    func testRetainedCodexRowsNeverClaimToBeLiveAfterFailureOrExit() {
        var codex = CodexEventStore()
        codex.reduce(.notification(method: "future/state", params: .object([
            "threadId": .string("thread-retained"),
            "status": .string("waiting")
        ])))

        let failed = FlightProjection(
            snapshot: nil,
            runtimeConnection: .offline,
            codexStore: codex,
            codexConnection: .failed("private transport detail")
        )
        let exited = FlightProjection(
            snapshot: nil,
            runtimeConnection: .offline,
            codexStore: codex,
            codexConnection: .exited(9)
        )

        XCTAssertEqual(failed.records.first?.originLabel, "CODEX RETAINED MEMORY · FAILED")
        XCTAssertEqual(exited.records.first?.originLabel, "CODEX RETAINED MEMORY · EXITED 9")
        XCTAssertFalse(failed.historyNotice.localizedCaseInsensitiveContains("live Codex"))
        XCTAssertFalse(failed.historyNotice.contains("private transport detail"))
        XCTAssertTrue(failed.historyNotice.contains("retained"))
    }

    func testUnknownCodexRecordIdentitySurvivesOldestEventEviction() {
        var codex = CodexEventStore(maximumUnknownEvents: 2)
        codex.reduce(unknownCodexEvent("event-a"))
        codex.reduce(unknownCodexEvent("event-b"))
        let before = FlightProjection(snapshot: nil, runtimeConnection: .offline,
                                      codexStore: codex, codexConnection: .connected)
        let retainedID = before.records.first { record in
            record.fields.contains { $0.0 == "itemId" && $0.1 == "event-b" }
        }?.id

        codex.reduce(unknownCodexEvent("event-c"))
        let after = FlightProjection(snapshot: nil, runtimeConnection: .offline,
                                     codexStore: codex, codexConnection: .connected)

        XCTAssertNotNil(retainedID)
        XCTAssertEqual(after.records.first { record in
            record.fields.contains { $0.0 == "itemId" && $0.1 == "event-b" }
        }?.id, retainedID)
        XCTAssertNil(after.records.first { record in
            record.fields.contains { $0.0 == "itemId" && $0.1 == "event-a" }
        })
    }

    func testFlightSelectionUsesExactSharedIdentityWithoutFallbackRetargeting() throws {
        let snapshot = try CockpitSnapshot.decode(Data(snapshotJSON.utf8))
        let projection = FlightProjection(snapshot: snapshot, runtimeConnection: .live,
                                          codexStore: CodexEventStore(), codexConnection: .disconnected)
        let visible = projection.filtered(category: .invocations, outcome: .all, query: "")

        XCTAssertEqual(
            FlightSelectionState.resolve(selectionID: "runtime-event-event-9", all: projection.records, visible: visible),
            .filtered("runtime-event-event-9")
        )
        XCTAssertEqual(
            FlightSelectionState.resolve(selectionID: "missing-record", all: projection.records, visible: visible),
            .unavailable("missing-record")
        )
        XCTAssertEqual(
            FlightSelectionState.resolve(selectionID: nil, all: projection.records, visible: visible),
            .none
        )
    }

    func testFlightRowCustomFocusPresentationIsVisibleAndAccessible() {
        let presentation = FlightRowPresentation(isSelected: true, isFocused: true)

        XCTAssertTrue(presentation.hasCustomFocusRing)
        XCTAssertEqual(presentation.focusRingWidth, 2)
        XCTAssertEqual(presentation.accessibilityValue, "Selected, keyboard focused")
    }

    func testNetworkTargetPresentationPreservesFullCanonicalIdentity() {
        let target = "terrarium-display-authority-node-01.local/project-zero/primary"

        XCTAssertGreaterThan(NetworkTargetPresentation.width, 160)
        XCTAssertEqual(NetworkTargetPresentation.accessibilityValue(target), target)
        XCTAssertTrue(NetworkTargetPresentation.wrapsFullIdentity)
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

    private func unknownCodexEvent(_ itemID: String) -> CodexEvent {
        .notification(method: "future/itemState", params: .object([
            "threadId": .string("thread-7"),
            "turnId": .string("turn-2"),
            "itemId": .string(itemID),
            "status": .string("waiting")
        ]))
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
