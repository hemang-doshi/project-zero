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
        XCTAssertEqual(commands.requests.count, 0)
    }

    func testInitializationAndWindowActivationDoNotStartCodex() async {
        let transport = RecordingCodexTransport()
        let codex = CodexAppServer(transport: transport, requestTimeout: 0.01)
        let model = makeModel(codex: codex)

        XCTAssertEqual(codex.state, .disconnected)
        XCTAssertEqual(transport.startCount, 0)

        model.windowDidAppear()
        await Task.yield()

        XCTAssertEqual(codex.state, .disconnected)
        XCTAssertEqual(transport.startCount, 0)
        model.windowDidDisappear()
    }

    func testRuntimeRefreshStartsOnlyAtWindowLifecycle() async {
        let fetches = RuntimeSnapshotRecorder()
        let client = CockpitClient(
            socketPath: "/tmp/project-zero-model-test.sock",
            reconnectDelay: 60,
            fetchSnapshot: { try await fetches.fetch() },
            openStream: { AsyncThrowingStream { $0.finish() } }
        )
        let model = makeModel(client: client)

        let beforeActivation = await fetches.callCount()
        XCTAssertEqual(beforeActivation, 0)

        model.windowDidAppear()
        for _ in 0..<50 where await fetches.callCount() == 0 {
            await Task.yield()
        }

        let afterActivation = await fetches.callCount()
        XCTAssertEqual(afterActivation, 1)
        model.windowDidDisappear()
    }

    private func makeModel(
        commands: RuntimeCommandRecorder? = nil,
        codex: CodexAppServer? = nil,
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
            sendCommand: { request in
                commands.requests.append(request)
                return [:]
            },
            userDefaults: nil
        )
    }
}

@MainActor
private final class RuntimeCommandRecorder {
    var requests: [[String: Any]] = []
}

@MainActor
private final class RecordingCodexTransport: CodexTransport {
    private(set) var startCount = 0

    func start(receive: @escaping (CodexTransportEvent) -> Void) throws {
        startCount += 1
    }

    func send(_ data: Data) throws {}
    func stop() {}
}

private actor RuntimeSnapshotRecorder {
    private var calls = 0

    func fetch() throws -> CockpitSnapshot {
        calls += 1
        throw ZeroError("offline")
    }

    func callCount() -> Int { calls }
}
