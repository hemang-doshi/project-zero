import XCTest
@testable import ZeroCockpit
import ZeroKit

/// Task 0 baseline: route-switch projection build costs.
///
/// The recorded averages (SDD ledger, task-0-report.md) set Task 1 budgets:
/// each projection must build in under half its baseline or under 50 ms,
/// whichever is larger.
final class ShellPerfTests: XCTestCase {
    func largeSnapshotJSON(nodes: Int, invocations: Int) -> String {
        let nodeRows = (0..<nodes).map { i in
            #"{"id":"node-\#(i)","revoked":false,"status":"ONLINE","capabilities":["display.render"]}"#
        }.joined(separator: ",")
        let invocationRows = (0..<invocations).map { i in
            #"{"id":"invoke-\#(i)","principal":"owner","node":"node-\#(i)","capability":"display.render","status":"SUCCEEDED","approved":1,"attempts":1}"#
        }.joined(separator: ",")
        return """
        {"version":"0.1","revision":99,"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0",\
        "release":{"version":"0.2.0","build":"7"},\
        "session":{"id":"s","project_id":"p","project":"Project Zero","state":"RUNNING","elapsed_ms":1,"since_ms":0,"revision":3},\
        "integrations":[],"policies":[],"context":{},"projects":[],"node_profiles":[],\
        "nodes":[\(nodeRows)],"invocations":[\(invocationRows)],"approvals":[],"firings":[],\
        "events":[],"audit":[],"truncated":{}}
        """
    }

    func testNetworkFactsBuildScales() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        measure { _ = NetworkFacts(snapshot: snapshot, connection: .live) }
    }

    func testFlightProjectionBuildScales() throws {
        let snapshot = try CockpitSnapshot.decode(Data(largeSnapshotJSON(nodes: 200, invocations: 0).utf8))
        let store = CodexEventStore()
        measure {
            _ = FlightProjection(
                snapshot: snapshot,
                runtimeConnection: .live,
                codexStore: store,
                codexConnection: .disconnected
            )
        }
    }

    @MainActor
    func testDeskRuntimeFactsBuildScales() {
        let model = CockpitModel.preview()
        measure { _ = DeskRuntimeFacts(model: model) }
    }

    @MainActor
    func testZeroBotProjectionBuildScales() {
        let model = CockpitModel.preview()
        measure { _ = ZeroBotProjection(model: model) }
    }
}
