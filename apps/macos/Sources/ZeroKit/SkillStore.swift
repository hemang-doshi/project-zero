import Foundation

/// Where a Zero-owned skill was learned or written.
///
/// The source is read from the skill's `SKILL.md` front-matter (`source:`).
/// A missing key defaults to `.authored`; an unrecognized value makes the
/// skill visible-but-unusable rather than silently remapped.
public enum SkillSource: String, CaseIterable, Codable, Sendable {
    case learnedInCodex = "learned-in-codex"
    case learnedInOpenCode = "learned-in-opencode"
    case authored = "authored"

    public var displayName: String {
        switch self {
        case .learnedInCodex: return "Learned in Codex"
        case .learnedInOpenCode: return "Learned in OpenCode"
        case .authored: return "Authored"
        }
    }
}

/// One Zero-owned skill: parsed front-matter plus enable state.
///
/// The store never executes skill code and never logs skill bodies,
/// credentials, or approval payloads. A skill whose `SKILL.md` front-matter
/// is malformed stays listed with `isUsable == false` and a
/// `rejectionReason`, so failures are visible instead of silently dropped.
public struct ZeroSkill: Equatable, Identifiable {
    public let id: String
    public let name: String
    public let summary: String
    public let source: SkillSource
    public let enabled: Bool
    public let isUsable: Bool
    public let rejectionReason: String?

    public init(
        id: String,
        name: String,
        summary: String,
        source: SkillSource,
        enabled: Bool,
        isUsable: Bool,
        rejectionReason: String? = nil
    ) {
        self.id = id
        self.name = name
        self.summary = summary
        self.source = source
        self.enabled = enabled
        self.isUsable = isUsable
        self.rejectionReason = rejectionReason
    }
}

/// Lists, parses, and enables Zero-owned skills shared by both providers.
///
/// Source of truth is the owner-controlled skills directory (default
/// `~/Library/Application Support/ProjectZero/skills`): each skill is a
/// folder with a `SKILL.md` plus optional assets, the same shape agent
/// harnesses already use. Enabled state persists in `UserDefaults` under
/// `zero.skills.enabled.<id>`; skills enabled once apply to both providers'
/// future sessions (shared), while threads/projects stay namespaced per
/// provider. Listing a missing directory returns empty and creates nothing.
public struct SkillStore {
    public private(set) var skills: [ZeroSkill]
    private let defaults: UserDefaults

    private static func enabledKey(for id: String) -> String { "zero.skills.enabled.\(id)" }

    /// Uses `skills` as the roster, overlaying persisted enable flags.
    public init(skills: [ZeroSkill], defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.skills = skills.map { skill in
            guard let persisted = defaults.object(forKey: Self.enabledKey(for: skill.id)) as? Bool else {
                return skill
            }
            return ZeroSkill(
                id: skill.id, name: skill.name, summary: skill.summary,
                source: skill.source, enabled: persisted,
                isUsable: skill.isUsable, rejectionReason: skill.rejectionReason
            )
        }
    }

    /// Owner-controlled skills directory. Read-only: listing never creates it.
    public static var defaultDirectory: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ProjectZero/skills", isDirectory: true)
    }

    /// Lists the skills in `directory` (sorted by id). Never creates anything.
    public static func load(from directory: URL, defaults: UserDefaults = .standard) -> SkillStore {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        let parsed = names.sorted().compactMap { name -> ZeroSkill? in
            let skillFile = directory.appendingPathComponent(name).appendingPathComponent("SKILL.md")
            guard let markdown = try? String(contentsOf: skillFile, encoding: .utf8) else { return nil }
            let enabled = defaults.object(forKey: enabledKey(for: name)) as? Bool ?? false
            return parse(id: name, markdown: markdown, enabled: enabled)
        }
        return SkillStore(skills: parsed, defaults: defaults)
    }

    /// Lists the default owner-controlled directory.
    public static func load(defaults: UserDefaults = .standard) -> SkillStore {
        load(from: defaultDirectory, defaults: defaults)
    }

    /// Parses one `SKILL.md`. Malformed input yields a visible-but-unusable row.
    public static func parse(id: String, markdown: String, enabled: Bool) -> ZeroSkill {
        func unusable(_ reason: String) -> ZeroSkill {
            ZeroSkill(id: id, name: id, summary: "", source: .authored,
                      enabled: enabled, isUsable: false, rejectionReason: reason)
        }
        var lines = markdown.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
            return unusable("Missing SKILL.md front-matter (expected a leading --- block with name and description).")
        }
        lines.removeFirst()
        guard let closing = lines.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces) == "---" }) else {
            return unusable("Unterminated SKILL.md front-matter (missing closing ---).")
        }
        var fields: [String: String] = [:]
        for raw in lines[..<closing] {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            guard let colon = line.firstIndex(of: ":") else {
                return unusable("Malformed front-matter line \(raw).")
            }
            let key = String(line[..<colon]).trimmingCharacters(in: .whitespaces).lowercased()
            var value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            fields[key] = value
        }
        guard let name = fields["name"], !name.isEmpty,
              let description = fields["description"], !description.isEmpty
        else {
            return unusable("Front-matter needs non-empty name and description.")
        }
        let source: SkillSource
        if let raw = fields["source"], !raw.isEmpty {
            guard let parsed = SkillSource(rawValue: raw.lowercased()) else {
                return unusable("Unknown skill source \(raw).")
            }
            source = parsed
        } else {
            source = .authored
        }
        return ZeroSkill(id: id, name: name, summary: description, source: source,
                         enabled: enabled, isUsable: true)
    }

    public func isEnabled(_ id: String) -> Bool {
        skills.first(where: { $0.id == id })?.enabled ?? false
    }

    public mutating func setEnabled(_ id: String, _ enabled: Bool) {
        defaults.set(enabled, forKey: Self.enabledKey(for: id))
        skills = skills.map { skill in
            guard skill.id == id else { return skill }
            return ZeroSkill(
                id: skill.id, name: skill.name, summary: skill.summary,
                source: skill.source, enabled: enabled,
                isUsable: skill.isUsable, rejectionReason: skill.rejectionReason
            )
        }
    }

    /// Enabled and usable skills, in roster order.
    public var enabledSkills: [ZeroSkill] {
        skills.filter { $0.enabled && $0.isUsable }
    }

    /// The exact injection contract shown verbatim in the UI before first use.
    public static func injectionContract(for provider: ProviderID) -> String {
        let mechanism: String
        switch provider {
        case .codex:
            mechanism = "Codex sessions receive enabled skills as session context per the provider's skill mechanism."
        case .opencode:
            mechanism = "OpenCode sessions receive enabled skills as ACP-embedded context."
        }
        return mechanism
            + " Skills enabled once apply to both providers' future sessions (shared)."
            + " Threads and projects stay namespaced per provider."
            + " A skill a provider rejects is shown as rejected with the provider's reason — never silently dropped."
    }

    /// Per-provider injection text for future sessions. Empty when no enabled,
    /// usable skill exists — a disabled skill is never injected. Unusable
    /// skills are listed in the UI but excluded here with their reason shown
    /// there. Full SKILL.md bodies load from the owner-controlled directory
    /// at session start; this preview never executes skill code.
    public func injectionContext(for provider: ProviderID) -> String {
        let enabled = enabledSkills
        guard !enabled.isEmpty else { return "" }
        var text = "\(provider.displayName) session skill context (\(enabled.count) skill\(enabled.count == 1 ? "" : "s")):\n"
        text += Self.injectionContract(for: provider) + "\n"
        for skill in enabled {
            text += "\n## \(skill.name) (\(skill.source.displayName))\n\(skill.summary)\n"
        }
        return text
    }
}
