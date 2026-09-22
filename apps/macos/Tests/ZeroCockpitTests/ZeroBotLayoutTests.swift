import XCTest
@testable import ZeroCockpit
import ZeroKit

/// Layout-mapping assertions for the Codex-familiar Zero Bot workspace.
///
/// These cover presentation and labels only: every projection predicate and
/// action gate stays under `ZeroBotViewTests`. No test here connects,
/// starts, or sends anything.
final class ZeroBotLayoutTests: XCTestCase {
    func testSidebarShowsWorkspacePath() throws {
        let row = ThreadRowPresentation(threadID: "t", project: boundProject)
        XCTAssertTrue(row.subtitle.contains(boundProject.name))
        XCTAssertEqual(row.accessibilityPath, boundProject.path)
    }

    func testSteerLabelMatchesProviderCapability() throws {
        XCTAssertEqual(ZeroBotComposer.steerLabel(for: .codex), "Stop & redirect")
        XCTAssertEqual(ZeroBotComposer.steerLabel(for: .opencode), "Steer")
    }

    func testSidebarRowExposesBasenameWithFullPathTooltip() throws {
        let row = ThreadRowPresentation(threadID: "t", project: boundProject)
        XCTAssertEqual(row.workspaceBasename, "project-zero")
        XCTAssertEqual(row.tooltip, boundProject.path)
        XCTAssertFalse(row.workspaceBasename.isEmpty)
    }

    func testUnboundRowHasNoWorkspacePath() throws {
        let row = ThreadRowPresentation(threadID: "t", project: nil)
        XCTAssertEqual(row.accessibilityPath, "")
        XCTAssertEqual(row.workspaceBasename, "")
    }

    func testCodexInterruptIsNotMidTurnSteer() throws {
        XCTAssertFalse(ZeroBotComposer.supportsMidTurnSteer(for: .codex))
        XCTAssertTrue(ZeroBotComposer.supportsMidTurnSteer(for: .opencode))
    }

    func testAttachIsDisabledWithReasonUntilProviderEvidenceExists() throws {
        for provider in ProviderID.allCases {
            let reason = ZeroBotComposer.attachUnavailableReason(for: provider)
            XCTAssertNotNil(reason, "\(provider.displayName) must explain why attach is unavailable")
            XCTAssertFalse(reason?.isEmpty == true)
        }
    }

    func testInspectorTabsMirrorCodexPanelGrammar() throws {
        let titles = ZeroBotInspectorTab.allCases.map(\.title)
        XCTAssertEqual(titles, ["Run", "Diff", "Telemetry", "Raw"])
        XCTAssertEqual(Set(ZeroBotInspectorTab.allCases.map(\.icon)).count, 4)
    }

    func testPaletteFiltersExistingSelectionStateWithoutNewAuthority() throws {
        let items = [
            ZeroBotPaletteItem(id: "t-1", title: "Fix login", subtitle: "Project Zero", kind: .thread),
            ZeroBotPaletteItem(id: "p-1", title: "Project Zero", subtitle: "/bounded/project-zero", kind: .project),
            ZeroBotPaletteItem(id: "m-1", title: "gpt-5.6-sol", subtitle: "Codex model", kind: .model),
        ]
        XCTAssertEqual(ZeroBotPalette.filter(query: "", items: items).count, 3)
        let threadHits = ZeroBotPalette.filter(query: "login", items: items)
        XCTAssertEqual(threadHits.map(\.id), ["t-1"])
        let projectHits = ZeroBotPalette.filter(query: "project", items: items)
        XCTAssertEqual(Set(projectHits.map(\.id)), ["t-1", "p-1"])
        XCTAssertTrue(ZeroBotPalette.filter(query: "zzz-no-match", items: items).isEmpty)
    }

    func testStatusStripAlwaysPairsTextWithIcon() throws {
        let strips = [
            ZeroBotStatusStrip.items(
                connectionLabel: "Connected", projectPath: "/bounded/project-zero",
                modelID: "gpt-5.6-sol", usageGlance: "42 tokens", syncState: "Live"
            ),
            ZeroBotStatusStrip.items(
                connectionLabel: "Disconnected", projectPath: nil,
                modelID: nil, usageGlance: nil, syncState: "Retained evidence"
            ),
        ]
        for strip in strips {
            XCTAssertFalse(strip.isEmpty)
            for item in strip {
                XCTAssertFalse(item.text.isEmpty, "status is never color alone")
                XCTAssertFalse(item.icon.isEmpty, "status is never color alone")
            }
        }
    }

    private var boundProject: ZeroBotProjectBinding {
        ZeroBotProjectBinding(projectID: "project-zero", name: "Project Zero", path: "/bounded/project-zero")
    }
}
