import Foundation

/// Bounded display data. Project paths, approval hashes and inputs in this
/// projection may be truncated: obtain action authority from their full API.
public struct CockpitSnapshot: Decodable, Sendable {
    public let version: String
    public let revision: UInt64
    public let timestamp: String
    public let status: String
    public let runtimeVersion: String
    public let release: RuntimeRecord
    public let session: CockpitSession
    public let integrations: [CockpitIntegration]
    public let policies: [RuntimeRecord]
    public let context: [String: RuntimeRecord]
    public let projects: [CockpitProject]
    public let nodes: [CockpitNode]
    public let nodeProfiles: [RuntimeRecord]
    public let approvals: [RuntimeRecord]
    public let firings: [RuntimeRecord]
    public let invocations: [RuntimeRecord]
    public let events: [RuntimeRecord]
    public let audit: [RuntimeRecord]
    public let truncated: [String: Bool]

    enum CodingKeys: String, CodingKey {
        case version, revision, timestamp, status, release, session, integrations, policies, context
        case projects, nodes, approvals, firings, invocations, events, audit, truncated
        case runtimeVersion = "runtime_version", nodeProfiles = "node_profiles"
    }

    public static func decode(_ data: Data) throws -> CockpitSnapshot {
        guard data.count <= 4 * 1024 * 1024 else { throw ZeroError("Runtime snapshot too large") }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.version == "0.1" else { throw ZeroError("Unsupported cockpit snapshot version") }
        return value
    }
}

public struct CockpitSession: Decodable, Sendable {
    public let id: String?
    public let projectID: String?
    public let project: String
    public let state: String
    public let elapsedMS: Int64
    public let sinceMS: Int64
    public let revision: Int64
    enum CodingKeys: String, CodingKey {
        case id, project, state, revision
        case projectID = "project_id", elapsedMS = "elapsed_ms", sinceMS = "since_ms"
    }
}

public struct CockpitProject: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let aliases: [String]?
    public let removed: Bool
}

public struct CockpitIntegration: Decodable, Identifiable, Sendable {
    public let id: String
    public let enabled: Bool
    public let status: String
    public let projectID: String?
    public let observedAt: String
    public let data: [String: String]
    public let message: String?
    enum CodingKeys: String, CodingKey {
        case id, enabled, status, data, message
        case projectID = "project_id", observedAt = "observed_at"
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        enabled = try values.decode(Bool.self, forKey: .enabled)
        status = try values.decode(String.self, forKey: .status)
        projectID = try values.decodeIfPresent(String.self, forKey: .projectID)
        observedAt = try values.decode(String.self, forKey: .observedAt)
        data = try values.decodeIfPresent([String: String].self, forKey: .data) ?? [:]
        message = try values.decodeIfPresent(String.self, forKey: .message)
    }
}

public struct CockpitNode: Decodable, Identifiable, Sendable {
    public let id: String
    public let revoked: Bool
    public let capabilities: [String]
    public let lastSeen: String?
    /// Lifecycle freshness is computed authoritatively by zerod from revocation
    /// and last-seen evidence; clients must not synthesize this value.
    public let status: String
    enum CodingKeys: String, CodingKey { case id, revoked, capabilities, status; case lastSeen = "last_seen" }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        // SQLite query projections encode booleans as 0/1.
        if let flag = try? values.decode(Bool.self, forKey: .revoked) { revoked = flag }
        else { revoked = try values.decode(Int.self, forKey: .revoked) != 0 }
        capabilities = try values.decodeIfPresent([String].self, forKey: .capabilities) ?? []
        lastSeen = try values.decodeIfPresent(String.self, forKey: .lastSeen)
        status = try values.decode(String.self, forKey: .status)
    }
}

/// Metadata records retain their typed JSON values for evidence inspectors.
public struct RuntimeRecord: Decodable, Sendable {
    public let fields: [String: RuntimeValue]
    public init(from decoder: Decoder) throws {
        fields = try decoder.singleValueContainer().decode([String: RuntimeValue].self)
    }
    public subscript(_ key: String) -> RuntimeValue { fields[key] ?? .null }
}

public enum RuntimeValue: Decodable, Equatable, Sendable {
    case object([String: RuntimeValue]), array([RuntimeValue]), string(String)
    case integer(Int64), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let v = try? value.decode(Bool.self) { self = .bool(v) }
        else if let v = try? value.decode(Int64.self) { self = .integer(v) }
        else if let v = try? value.decode(Double.self) { self = .number(v) }
        else if let v = try? value.decode(String.self) { self = .string(v) }
        else if let v = try? value.decode([RuntimeValue].self) { self = .array(v) }
        else { self = .object(try value.decode([String: RuntimeValue].self)) }
    }
    public subscript(_ key: String) -> RuntimeValue {
        if case .object(let fields) = self { return fields[key] ?? .null }; return .null
    }
    public var string: String? { if case .string(let value) = self { return value }; return nil }
    public var integer: Int64? { if case .integer(let value) = self { return value }; return nil }
    public var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
    public var array: [RuntimeValue] { if case .array(let value) = self { return value }; return [] }
}
