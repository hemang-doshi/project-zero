import Foundation
import XCTest
@testable import ZeroCockpit
import ZeroKit

@MainActor
final class CockpitModelTests: XCTestCase {
    func testMenuCannotOfferFocusActionWhileRuntimeIsOffline() async {
        let commands = RuntimeCommandRecorder()
        let model = makeModel(commands: commands)

        let accepted = await model.command("session.pause")

        XCTAssertFalse(accepted)
        XCTAssertFalse(model.canIssueRuntimeCommand)
        XCTAssertFalse(model.canPauseOrResume)
        let commandCount = await commands.callCount()
        XCTAssertEqual(commandCount, 0)
    }

    func testApplicationLifecycleKeepsRuntimeAliveAfterWindowCloses() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData())
        let model = makeModel(client: fixture.client())

        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)
        model.windowDidAppear()
        model.windowDidDisappear()

        XCTAssertFalse(model.isWindowActive)
        XCTAssertEqual(model.runtimeConnection, .live)
        XCTAssertEqual(fixture.streamOpenCount, 1)
    }

    func testOneOfTwoWindowClosuresDoesNotDeactivateRemainingWindowOrRuntime() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData())
        let model = makeModel(client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        model.windowDidAppear()
        model.windowDidAppear()
        model.windowDidDisappear()

        XCTAssertTrue(model.isWindowActive)
        XCTAssertEqual(model.runtimeConnection, .live)
        model.windowDidDisappear()
        XCTAssertFalse(model.isWindowActive)
        XCTAssertEqual(model.runtimeConnection, .live)
    }

    func testInitializationAndApplicationActivationDoNotStartCodex() async {
        let transport = RecordingCodexTransport()
        let codex = CodexAppServer(transport: transport, requestTimeout: 0.01)
        let model = makeModel(codex: codex)

        XCTAssertEqual(codex.state, .disconnected)
        XCTAssertEqual(transport.startCount, 0)

        model.applicationDidStart()
        model.windowDidAppear()
        await Task.yield()

        XCTAssertEqual(codex.state, .disconnected)
        XCTAssertEqual(transport.startCount, 0)
        model.windowDidDisappear()
    }

    func testCommittedFocusCommandRequiresCausallyNewDisplayInvocation() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        let commands = RuntimeCommandRecorder()
        let model = makeModel(commands: commands, client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)
        XCTAssertEqual(model.deliveryState, .delivered)

        let fetchesBeforeCommand = fixture.fetchCount
        let paused = await model.pauseFocus()
        XCTAssertTrue(paused)
        await fixture.waitForFetches(atLeast: fetchesBeforeCommand + 1)
        XCTAssertEqual(model.deliveryState, .committedLocally)

        let recordedRequest = await commands.lastRequest()
        let commandID = try! XCTUnwrap(recordedRequest?.id)
        fixture.setSnapshot(snapshotData(
            revision: 11,
            invocations: [("\(commandID):desk", "DISPATCHED"), ("old-render", "SUCCEEDED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(11, client: model.runtime)
        XCTAssertEqual(model.deliveryState, .awaitingDelivery)

        fixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [("\(commandID):desk", "SUCCEEDED"), ("old-render", "SUCCEEDED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(12, client: model.runtime)
        XCTAssertEqual(model.deliveryState, .delivered)
    }

    func testWaitingApprovalRemainsQueuedAndBecomesStaleAfterDenial() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        let commands = RuntimeCommandRecorder(statuses: ["WAITING_APPROVAL", "SUCCEEDED"])
        let model = makeModel(commands: commands, client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        let proposed = await model.pauseFocus()

        XCTAssertTrue(proposed)
        XCTAssertEqual(model.deliveryState, .queued)
        XCTAssertEqual(model.attentionCount, 1)
        XCTAssertFalse(model.hasUncertainRuntimeCommand)

        let recordedRequest = await commands.lastRequest()
        let request = try! XCTUnwrap(recordedRequest)
        fixture.setSnapshot(snapshotData(
            revision: 11,
            invocations: [("old-render", "SUCCEEDED")],
            runtimeInvocations: [(request.id, "session.pause", "WAITING_APPROVAL")],
            approvalIDs: [request.id]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(11, client: model.runtime)

        XCTAssertEqual(model.deliveryState, .queued)
        XCTAssertEqual(model.attentionCount, 1, "The proposal and bounded approval row are the same attention item")

        let denied = await model.resolveRuntimeApproval(id: request.id, approve: false)
        XCTAssertTrue(denied)

        fixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [("old-render", "SUCCEEDED")],
            runtimeInvocations: [(request.id, "session.pause", "CANCELLED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(12, client: model.runtime)

        XCTAssertEqual(model.deliveryState, .stale)
        XCTAssertEqual(model.attentionCount, 0)
        XCTAssertNotEqual(model.deliveryState, .committedLocally)
        XCTAssertNotEqual(model.deliveryState, .delivered)
    }

    func testWaitingApprovalSurvivesModelRecreationWithoutUsingHistoricalDelivery() async {
        let suiteName = "CockpitModelTests.\(UUID().uuidString)"
        let defaults = try! XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let socketPath = "/tmp/project-zero-approval-\(UUID().uuidString).sock"
        let commands = RuntimeCommandRecorder(status: "WAITING_APPROVAL")
        let firstFixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        var firstModel: CockpitModel? = CockpitModel(
            socketPath: socketPath,
            client: firstFixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await commands.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        firstModel?.applicationDidStart()
        await firstFixture.waitUntilLive(try! XCTUnwrap(firstModel).runtime)

        let proposed = await firstModel?.pauseFocus()
        XCTAssertEqual(proposed, true)
        let recordedRequest = await commands.lastRequest()
        let commandID = try! XCTUnwrap(recordedRequest?.id)
        XCTAssertEqual(firstModel?.deliveryState, .queued)
        firstModel = nil

        let recoveredFixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 11,
            invocations: [("old-render", "SUCCEEDED")],
            runtimeInvocations: [(commandID, "session.pause", "WAITING_APPROVAL")],
            approvalIDs: [commandID]
        ))
        let recoveredModel = CockpitModel(
            socketPath: socketPath,
            client: recoveredFixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await commands.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        recoveredModel.applicationDidStart()
        await recoveredFixture.waitUntilLive(recoveredModel.runtime)

        XCTAssertEqual(recoveredModel.deliveryState, .queued)
        XCTAssertEqual(recoveredModel.attentionCount, 1)
        XCTAssertNotEqual(recoveredModel.deliveryState, .delivered)
    }

    func testCurrentApprovalReconstructsLifecycleBeforeBoundedEvidenceDisappears() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 11,
            invocations: [("old-render", "SUCCEEDED")],
            runtimeInvocations: [("proposal-1", "session.pause", "WAITING_APPROVAL")],
            approvalIDs: ["proposal-1"]
        ))
        let model = makeModel(client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        XCTAssertEqual(model.deliveryState, .queued)

        fixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(12, client: model.runtime)

        XCTAssertEqual(model.deliveryState, .stale)
        XCTAssertEqual(model.attentionCount, 0)
        XCTAssertNotEqual(model.deliveryState, .delivered)
    }

    func testDeniedApprovalRemainsStaleWhenTerminalInvocationFallsOutsideBoundedHistory() async {
        let suiteName = "CockpitModelTests.\(UUID().uuidString)"
        let defaults = try! XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let socketPath = "/tmp/project-zero-denial-\(UUID().uuidString).sock"
        let commands = RuntimeCommandRecorder(statuses: ["WAITING_APPROVAL", "SUCCEEDED"])
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        var model: CockpitModel? = CockpitModel(
            socketPath: socketPath,
            client: fixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await commands.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        model?.applicationDidStart()
        await fixture.waitUntilLive(try! XCTUnwrap(model).runtime)

        let proposed = await model?.pauseFocus()
        XCTAssertEqual(proposed, true)
        let recordedRequest = await commands.lastRequest()
        let commandID = try! XCTUnwrap(recordedRequest?.id)
        fixture.setSnapshot(snapshotData(
            revision: 11,
            invocations: [("old-render", "SUCCEEDED")],
            runtimeInvocations: [(commandID, "session.pause", "WAITING_APPROVAL")],
            approvalIDs: [commandID]
        ))
        model?.runtime.refresh()
        await fixture.waitForRevision(11, client: try! XCTUnwrap(model).runtime)

        let denied = await model?.resolveRuntimeApproval(id: commandID, approve: false)
        XCTAssertEqual(denied, true)
        fixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        model?.runtime.refresh()
        await fixture.waitForRevision(12, client: try! XCTUnwrap(model).runtime)
        XCTAssertEqual(model?.deliveryState, .stale)
        XCTAssertEqual(model?.attentionCount, 0)
        model = nil

        let recoveredFixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 12,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        let recoveredModel = CockpitModel(
            socketPath: socketPath,
            client: recoveredFixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await commands.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        recoveredModel.applicationDidStart()
        await recoveredFixture.waitUntilLive(recoveredModel.runtime)

        XCTAssertEqual(recoveredModel.deliveryState, .stale)
        XCTAssertEqual(recoveredModel.attentionCount, 0)
    }

    func testRecoveredDeliveryRejectsPrefixedButNonExactInvocationID() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        let commands = RuntimeCommandRecorder()
        let model = makeModel(commands: commands, client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        let paused = await model.pauseFocus()
        XCTAssertTrue(paused)
        let recordedRequest = await commands.lastRequest()
        let commandID = try! XCTUnwrap(recordedRequest?.id)
        fixture.setSnapshot(snapshotData(
            revision: 11,
            invocations: [("\(commandID):desk:extra", "SUCCEEDED"), ("old-render", "SUCCEEDED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(11, client: model.runtime)

        XCTAssertEqual(model.deliveryState, .committedLocally)

        fixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [("\(commandID):desk", "SUCCEEDED"), ("old-render", "SUCCEEDED")]
        ))
        model.runtime.refresh()
        await fixture.waitForRevision(12, client: model.runtime)
        XCTAssertEqual(model.deliveryState, .delivered)
    }

    func testPersistedAmbiguousRetryRecoversOnlyExactExistingDeliveryEvidence() async {
        let suiteName = "CockpitModelTests.\(UUID().uuidString)"
        let defaults = try! XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let socketPath = "/tmp/project-zero-retry-\(UUID().uuidString).sock"
        let transport = AmbiguousThenCachedRuntimeCommandTransport()
        let firstFixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 10,
            invocations: [("old-render", "SUCCEEDED")]
        ))
        var firstModel: CockpitModel? = CockpitModel(
            socketPath: socketPath,
            client: firstFixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await transport.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        firstModel?.applicationDidStart()
        await firstFixture.waitUntilLive(try! XCTUnwrap(firstModel).runtime)

        let confirmed = await firstModel?.pauseFocus()
        XCTAssertEqual(confirmed, false)
        XCTAssertTrue(try! XCTUnwrap(firstModel).hasUncertainRuntimeCommand)
        let recordedRequest = await transport.lastRequest()
        let commandID = try! XCTUnwrap(recordedRequest?.id)
        firstModel = nil

        let recoveredFixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            revision: 11,
            invocations: [
                ("\(commandID):desk", "DISPATCHED"),
                ("unrelated-new-render", "SUCCEEDED"),
            ]
        ))
        let recoveredModel = CockpitModel(
            socketPath: socketPath,
            client: recoveredFixture.client(),
            codex: CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: { request in try await transport.send(request) },
            resolveProject: { _ in throw ZeroError("unused") },
            userDefaults: defaults
        )
        recoveredModel.applicationDidStart()
        await recoveredFixture.waitUntilLive(recoveredModel.runtime)

        XCTAssertTrue(recoveredModel.hasUncertainRuntimeCommand)
        let retried = await recoveredModel.retryPendingRuntimeCommand()
        XCTAssertTrue(retried)
        XCTAssertEqual(recoveredModel.deliveryState, .awaitingDelivery)

        recoveredFixture.setSnapshot(snapshotData(
            revision: 12,
            invocations: [
                ("\(commandID):desk", "SUCCEEDED"),
                ("unrelated-new-render", "SUCCEEDED"),
            ]
        ))
        recoveredModel.runtime.refresh()
        await recoveredFixture.waitForRevision(12, client: recoveredModel.runtime)
        XCTAssertEqual(recoveredModel.deliveryState, .delivered)
    }

    func testRetryIsSerializedAndCannotCreateALateFailureAfterSuccess() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData())
        let commands = HeldRuntimeCommandTransport()
        let model = makeModel(sendCommand: { request in try await commands.send(request) }, client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        let first = Task { await model.pauseFocus() }
        await commands.waitForCalls(1)
        let retryWhileSubmitting = await model.retryPendingRuntimeCommand()

        XCTAssertFalse(retryWhileSubmitting)
        let commandCount = await commands.callCount()
        XCTAssertEqual(commandCount, 1)
        await commands.succeed()
        let firstSucceeded = await first.value
        XCTAssertTrue(firstSucceeded)
        XCTAssertEqual(model.commandState, .idle)
        XCTAssertFalse(model.hasUncertainRuntimeCommand)
    }

    func testTruncatedAttentionIsPresentedAsALowerBound() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData(
            approvals: 2,
            firings: 1,
            truncatedAttention: true
        ))
        let model = makeModel(client: fixture.client())
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        XCTAssertEqual(model.attentionCount, 3)
        XCTAssertTrue(model.attentionIsLowerBound)
        XCTAssertEqual(model.attentionLabel, "3+")
    }

    func testTypedCommandResponseAndAuthoritativeProjectResponse() async {
        let fixture = RuntimeSnapshotFixture(snapshot: snapshotData())
        let commands = RuntimeCommandRecorder()
        let projectLookup = ProjectLookupRecorder()
        let transport = RecordingCodexTransport(automaticResponses: true)
        let codex = CodexAppServer(transport: transport)
        let model = CockpitModel(
            socketPath: "/tmp/project-zero-model-test.sock",
            client: fixture.client(),
            codex: codex,
            sendCommand: { request in try await commands.send(request) },
            resolveProject: { projectID in try await projectLookup.resolve(projectID) },
            userDefaults: nil
        )
        model.applicationDidStart()
        await fixture.waitUntilLive(model.runtime)

        let paused = await model.pauseFocus()
        XCTAssertTrue(paused)
        let recordedResponse = await commands.lastResponse()
        let response = try! XCTUnwrap(recordedResponse)
        XCTAssertEqual(response.status, "SUCCEEDED")
        let connected = await model.connectCodex()
        XCTAssertTrue(connected)
        let threadID = await model.startCodexThread(projectID: "p1", mode: .work)
        XCTAssertEqual(threadID, "thread-1")
        let requestedIDs = await projectLookup.requestedIDs()
        XCTAssertEqual(requestedIDs, ["p1"])
        XCTAssertEqual(transport.lastThreadPath, "/authoritative/project-zero")
        model.disconnectCodex()
    }

    private func makeModel(
        commands: RuntimeCommandRecorder? = nil,
        codex: CodexAppServer? = nil,
        sendCommand: (@Sendable (RuntimeCommandRequest) async throws -> RuntimeCommandResponse)? = nil,
        client: CockpitClient? = nil
    ) -> CockpitModel {
        let commands = commands ?? RuntimeCommandRecorder()
        let client = client ?? CockpitClient(
            socketPath: "/tmp/project-zero-model-test.sock",
            reconnectDelay: 60,
            fetchSnapshot: { throw ZeroError("offline") },
            openStream: {
                AsyncThrowingStream { continuation in
                    continuation.finish(throwing: ZeroError("offline"))
                }
            }
        )
        return CockpitModel(
            socketPath: "/tmp/project-zero-model-test.sock",
            client: client,
            codex: codex ?? CodexAppServer(transport: RecordingCodexTransport()),
            sendCommand: sendCommand ?? { request in try await commands.send(request) },
            resolveProject: { projectID in
                RuntimeProjectResponse(
                    version: "0.2",
                    project: RuntimeProjectAuthority(id: projectID, name: "Project Zero", path: "/authoritative/project-zero")
                )
            },
            userDefaults: nil
        )
    }

    private func snapshotData(
        revision: UInt64 = 2,
        invocations: [(String, String)] = [],
        runtimeInvocations: [(String, String, String)] = [],
        approvals: Int = 0,
        approvalIDs: [String]? = nil,
        firings: Int = 0,
        truncatedAttention: Bool = false
    ) -> Data {
        let displayInvocationJSON = invocations.map {
            #"{"id":"\#($0.0)","principal":"owner","node":"desk","capability":"display.render","status":"\#($0.1)","approved":1,"deadline":"","attempts":1}"#
        }
        let runtimeInvocationJSON = runtimeInvocations.map {
            #"{"id":"\#($0.0)","principal":"owner","node":"runtime","capability":"\#($0.1)","status":"\#($0.2)","approved":0,"deadline":"","attempts":0}"#
        }
        let invocationJSON = (displayInvocationJSON + runtimeInvocationJSON).joined(separator: ",")
        let resolvedApprovalIDs = approvalIDs ?? (0..<approvals).map { "approval-\($0)" }
        let approvalsJSON = resolvedApprovalIDs.map {
            #"{"id":"\#($0)","node":"runtime","capability":"session.pause","status":"WAITING_APPROVAL"}"#
        }.joined(separator: ",")
        let firingsJSON = (0..<firings).map {
            #"{"id":"firing-\#($0)","state":"PENDING"}"#
        }.joined(separator: ",")
        return Data(#"{"version":"0.1","revision":\#(revision),"timestamp":"2026-09-10T00:00:00Z","status":"RUNNING","runtime_version":"0.2.0","release":{},"session":{"id":"s1","project_id":"p1","project":"Project Zero","state":"RUNNING","elapsed_ms":1000,"since_ms":1,"revision":4},"integrations":[],"policies":[],"context":{},"projects":[{"id":"p1","name":"Project Zero","path":"/bounded/path","removed":false}],"nodes":[{"id":"desk","revoked":0,"capabilities":["display.render"],"last_seen":"2026-09-10T00:00:00Z","status":"ONLINE"}],"node_profiles":[],"approvals":[\#(approvalsJSON)],"firings":[\#(firingsJSON)],"invocations":[\#(invocationJSON)],"events":[],"audit":[],"truncated":{"approvals":\#(truncatedAttention),"firings":\#(truncatedAttention)}}"#.utf8)
    }
}

private actor RuntimeCommandRecorder {
    private var requests: [RuntimeCommandRequest] = []
    private var responses: [RuntimeCommandResponse] = []
    private var statuses: [String]

    init(status: String = "SUCCEEDED") {
        statuses = [status]
    }

    init(statuses: [String]) {
        self.statuses = statuses
    }

    func send(_ request: RuntimeCommandRequest) throws -> RuntimeCommandResponse {
        let status = statuses.count > 1 ? statuses.removeFirst() : (statuses.first ?? "SUCCEEDED")
        let response = RuntimeCommandResponse(version: "0.1", id: request.id, status: status)
        requests.append(request)
        responses.append(response)
        return response
    }

    func callCount() -> Int { requests.count }
    func lastRequest() -> RuntimeCommandRequest? { requests.last }
    func lastResponse() -> RuntimeCommandResponse? { responses.last }
}

private actor AmbiguousThenCachedRuntimeCommandTransport {
    private var requests: [RuntimeCommandRequest] = []

    func send(_ request: RuntimeCommandRequest) throws -> RuntimeCommandResponse {
        requests.append(request)
        if requests.count == 1 {
            throw ZeroError("command response was lost")
        }
        return RuntimeCommandResponse(version: "0.1", id: request.id, status: "SUCCEEDED")
    }

    func lastRequest() -> RuntimeCommandRequest? { requests.last }
}

private actor HeldRuntimeCommandTransport {
    private var calls = 0
    private var request: RuntimeCommandRequest?
    private var continuation: CheckedContinuation<RuntimeCommandResponse, Error>?

    func send(_ request: RuntimeCommandRequest) async throws -> RuntimeCommandResponse {
        calls += 1
        self.request = request
        return try await withCheckedThrowingContinuation { continuation = $0 }
    }

    func callCount() -> Int { calls }
    func waitForCalls(_ expected: Int) async {
        for _ in 0..<200 {
            if calls >= expected { return }
            await Task.yield()
        }
        XCTFail("Timed out waiting for held runtime command")
    }
    func succeed() {
        guard let request, let continuation else { return }
        self.continuation = nil
        continuation.resume(returning: RuntimeCommandResponse(version: "0.1", id: request.id, status: "SUCCEEDED"))
    }
}

private actor ProjectLookupRecorder {
    private var ids: [String] = []
    func resolve(_ id: String) throws -> RuntimeProjectResponse {
        ids.append(id)
        return RuntimeProjectResponse(
            version: "0.2",
            project: RuntimeProjectAuthority(id: id, name: "Project Zero", path: "/authoritative/project-zero")
        )
    }
    func requestedIDs() -> [String] { ids }
}

private final class RuntimeSnapshotFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data
    private var continuation: AsyncThrowingStream<RuntimeChange, Error>.Continuation?
    private var fetches = 0
    private var opens = 0

    init(snapshot: Data) { data = snapshot }

    var streamOpenCount: Int { lock.withLock { opens } }
    var fetchCount: Int { lock.withLock { fetches } }

    @MainActor
    func client() -> CockpitClient {
        CockpitClient(
            socketPath: "/tmp/project-zero-model-test.sock",
            reconnectDelay: 60,
            maximumSnapshotAge: 60,
            fetchSnapshot: { try self.fetch() },
            openStream: { self.open() }
        )
    }

    func setSnapshot(_ data: Data) { lock.withLock { self.data = data } }

    func fetch() throws -> CockpitSnapshot {
        let data = lock.withLock { () -> Data in fetches += 1; return self.data }
        return try CockpitSnapshot.decode(data)
    }

    func open() -> AsyncThrowingStream<RuntimeChange, Error> {
        AsyncThrowingStream { stream in
            lock.withLock { opens += 1; continuation = stream }
            let ready = try! RuntimeChange(event: SSEEvent(
                name: "ready",
                data: #"{"revision":0,"domains":[],"timestamp":"2026-09-10T00:00:00Z"}"#
            ))
            stream.yield(ready)
        }
    }

    @MainActor
    func waitUntilLive(_ client: CockpitClient) async {
        for _ in 0..<200 {
            if client.state == .live { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("Timed out waiting for live runtime client")
    }

    func waitForFetches(atLeast expected: Int) async {
        for _ in 0..<200 {
            if lock.withLock({ fetches >= expected }) { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("Timed out waiting for snapshot fetch")
    }

    @MainActor
    func waitForRevision(_ revision: UInt64, client: CockpitClient) async {
        for _ in 0..<200 {
            if client.snapshot?.revision == revision { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("Timed out waiting for snapshot revision \(revision)")
    }
}

@MainActor
private final class RecordingCodexTransport: CodexTransport {
    private(set) var startCount = 0
    private(set) var messages: [CodexJSON] = []
    private var receive: ((CodexTransportEvent) -> Void)?
    private let automaticResponses: Bool

    init(automaticResponses: Bool = false) { self.automaticResponses = automaticResponses }

    var lastThreadPath: String? {
        messages.last(where: { $0["method"].string == "thread/start" })?["params"]["cwd"].string
    }

    func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        startCount += 1
        self.receive = receive
    }

    func send(_ data: Data) throws {
        var codec = CodexLineCodec()
        guard let message = try codec.append(data).first else { return }
        messages.append(message)
        guard automaticResponses, message["id"] != .null else { return }
        let result: CodexJSON
        switch message["method"].string {
        case "model/list", "thread/list": result = .object(["data": .array([])])
        case "thread/start": result = .object(["thread": .object(["id": .string("thread-1")])])
        default: result = .object([:])
        }
        let response = try CodexLineCodec.encode(.object(["id": message["id"], "result": result]))
        receive?(.data(response))
    }

    func stop() { receive = nil }
}
