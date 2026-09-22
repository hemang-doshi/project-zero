import XCTest
import SwiftUI
import ZeroKit
@testable import ZeroCockpit

extension ZeroSkill {
    static func fixture(
        id: String,
        enabled: Bool,
        source: SkillSource = .authored,
        usable: Bool = true
    ) -> ZeroSkill {
        ZeroSkill(
            id: id,
            name: id,
            summary: "\(id) summary",
            source: source,
            enabled: enabled,
            isUsable: usable,
            rejectionReason: usable ? nil : "testdouble unusable"
        )
    }
}

@MainActor
final class SkillLabTests: XCTestCase {
    private var scrubDomains: [String] = []

    override func tearDown() {
        for domain in scrubDomains {
            UserDefaults.standard.removePersistentDomain(forName: domain)
        }
        scrubDomains = []
        super.tearDown()
    }

    private func isolatedDefaults() -> UserDefaults {
        let name = "SkillLabTests.\(UUID().uuidString)"
        scrubDomains.append(name)
        UserDefaults.standard.removePersistentDomain(forName: name)
        return UserDefaults(suiteName: name)!
    }

    // MARK: - Brief acceptance

    func testDisabledSkillIsNotInjected() throws {
        let store = SkillStore(skills: [.fixture(id: "s1", enabled: false)], defaults: isolatedDefaults())
        XCTAssertTrue(store.injectionContext(for: .codex).isEmpty)
        XCTAssertTrue(store.injectionContext(for: .opencode).isEmpty)
    }

    func testSkillLabRouteExistsInOrder() throws {
        XCTAssertEqual(CockpitRoute.allCases.last, .skillLab)
    }

    // MARK: - Route membership + shortcuts

    func testSkillLabRouteTitleSymbolAndShortcut() throws {
        XCTAssertEqual(CockpitRoute.skillLab.title, "Skill Lab")
        XCTAssertFalse(CockpitRoute.skillLab.symbol.isEmpty)
        XCTAssertEqual(CockpitRoute.skillLab.shortcut, KeyEquivalent("7"))
    }

    func testEveryRouteHasADistinctCommandShortcut() throws {
        let shortcuts = CockpitRoute.allCases.map { String($0.shortcut.character) }
        XCTAssertEqual(shortcuts, ["1", "2", "3", "4", "5", "6", "7"])
        XCTAssertEqual(Set(shortcuts).count, CockpitRoute.allCases.count)
    }

    func testRailAndStripCoverSkillLab() throws {
        XCTAssertTrue(CockpitRoute.allCases.contains(.skillLab))
        XCTAssertEqual(CockpitRoute.allCases.count, 7)
    }

    // MARK: - Front-matter parsing

    func testWellFormedSkillFileParses() throws {
        let markdown = """
            ---
            name: desk-audit
            description: Audits desk state before send.
            source: authored
            ---
            # Desk audit
            Body never executes.
            """
        let skill = SkillStore.parse(id: "desk-audit", markdown: markdown, enabled: false)
        XCTAssertEqual(skill.name, "desk-audit")
        XCTAssertEqual(skill.summary, "Audits desk state before send.")
        XCTAssertTrue(skill.isUsable)
        XCTAssertNil(skill.rejectionReason)
    }

    func testMalformedFrontMatterIsVisibleButUnusable() throws {
        let markdown = """
            ---
            name: [unclosed bracket
            description:
            ---
            Body.
            """
        let skill = SkillStore.parse(id: "broken", markdown: markdown, enabled: true)
        XCTAssertEqual(skill.id, "broken")
        XCTAssertFalse(skill.isUsable)
        XCTAssertNotNil(skill.rejectionReason)
    }

    func testMissingFrontMatterIsVisibleButUnusable() throws {
        let skill = SkillStore.parse(id: "plain", markdown: "# No front matter\nJust notes.", enabled: true)
        XCTAssertFalse(skill.isUsable)
        XCTAssertNotNil(skill.rejectionReason)
    }

    func testMissingNameIsVisibleButUnusable() throws {
        let markdown = """
            ---
            description: Has a description but no name.
            ---
            Body.
            """
        let skill = SkillStore.parse(id: "noname", markdown: markdown, enabled: false)
        XCTAssertFalse(skill.isUsable)
    }

    func testUnknownSourceIsVisibleButUnusable() throws {
        let markdown = """
            ---
            name: mystery
            description: Unknown origin.
            source: learned-in-hal9000
            ---
            Body.
            """
        let skill = SkillStore.parse(id: "mystery", markdown: markdown, enabled: false)
        XCTAssertFalse(skill.isUsable)
        XCTAssertNotNil(skill.rejectionReason)
    }

    func testKnownSourcesParse() throws {
        for source in SkillSource.allCases {
            let markdown = """
                ---
                name: \(source.rawValue)-skill
                description: Source check.
                source: \(source.rawValue)
                ---
                Body.
                """
            let skill = SkillStore.parse(id: source.rawValue, markdown: markdown, enabled: false)
            XCTAssertTrue(skill.isUsable, "\(source.rawValue)")
            XCTAssertEqual(skill.source, source)
        }
    }

    // MARK: - Enable round-trip

    func testEnableDisableRoundTripsThroughDefaults() throws {
        let defaults = isolatedDefaults()
        var store = SkillStore(skills: [.fixture(id: "s1", enabled: false)], defaults: defaults)
        XCTAssertFalse(store.isEnabled("s1"))
        store.setEnabled("s1", true)
        XCTAssertTrue(store.isEnabled("s1"))
        XCTAssertTrue(SkillStore(skills: [.fixture(id: "s1", enabled: false)], defaults: defaults).isEnabled("s1"))
        store.setEnabled("s1", false)
        XCTAssertFalse(SkillStore(skills: [.fixture(id: "s1", enabled: false)], defaults: defaults).isEnabled("s1"))
    }

    // MARK: - Injection contract

    func testEnabledSkillInjectsPerProviderText() throws {
        let store = SkillStore(skills: [.fixture(id: "s1", enabled: true)], defaults: isolatedDefaults())
        let codex = store.injectionContext(for: .codex)
        let opencode = store.injectionContext(for: .opencode)
        XCTAssertFalse(codex.isEmpty)
        XCTAssertFalse(opencode.isEmpty)
        XCTAssertTrue(codex.contains("s1"))
        XCTAssertTrue(opencode.contains("s1"))
        XCTAssertNotEqual(codex, opencode)
    }

    func testInjectionContractTextIsShownVerbatim() throws {
        XCTAssertTrue(SkillStore.injectionContract(for: .codex).contains("session context"))
        XCTAssertTrue(SkillStore.injectionContract(for: .opencode).contains("ACP-embedded context"))
        XCTAssertTrue(SkillStore.injectionContract(for: .codex).contains("never silently dropped"))
        XCTAssertTrue(SkillStore.injectionContract(for: .opencode).contains("never silently dropped"))
    }

    func testUnusableSkillIsNeverInjected() throws {
        let store = SkillStore(
            skills: [.fixture(id: "broken", enabled: true, usable: false)],
            defaults: isolatedDefaults()
        )
        XCTAssertTrue(store.injectionContext(for: .codex).isEmpty)
        XCTAssertTrue(store.injectionContext(for: .opencode).isEmpty)
    }

    // MARK: - Directory listing (fixtures only, never the real dir)

    func testLoadListsFixtureDirectoryWithoutTouchingRealDirectory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let good = root.appendingPathComponent("desk-audit")
        let bad = root.appendingPathComponent("broken")
        try FileManager.default.createDirectory(at: good, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: bad, withIntermediateDirectories: true)
        try """
            ---
            name: desk-audit
            description: Audits desk state before send.
            source: learned-in-codex
            ---
            # Desk audit
            """.write(to: good.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try "no front matter here".write(to: bad.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: root) }

        let store = SkillStore.load(from: root, defaults: isolatedDefaults())
        XCTAssertEqual(store.skills.count, 2)
        XCTAssertEqual(store.skills.first(where: { $0.id == "desk-audit" })?.source, .learnedInCodex)
        XCTAssertTrue(store.skills.first(where: { $0.id == "desk-audit" })?.isUsable == true)
        let broken = try XCTUnwrap(store.skills.first(where: { $0.id == "broken" }))
        XCTAssertFalse(broken.isUsable)
        XCTAssertNotNil(broken.rejectionReason)
    }

    func testLoadOfMissingDirectoryIsEmptyAndCreatesNothing() throws {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("missing-\(UUID().uuidString)")
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
        let store = SkillStore.load(from: missing, defaults: isolatedDefaults())
        XCTAssertTrue(store.skills.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
    }

    func testDefaultDirectoryIsOwnerControlledAndUncreated() throws {
        let url = SkillStore.defaultDirectory
        XCTAssertTrue(url.path.contains("ProjectZero"))
        XCTAssertTrue(url.lastPathComponent == "skills")
        XCTAssertFalse(url.path.contains("Developer/project-zero"))
    }
}
