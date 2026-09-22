import Foundation

public enum CodexJSON: Codable, Equatable, Sendable {
    case object([String: CodexJSON]), array([CodexJSON]), string(String)
    case integer(Int64), number(Double), bool(Bool), null

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let v = try? value.decode(Bool.self) { self = .bool(v) }
        else if let v = try? value.decode(Int64.self) { self = .integer(v) }
        else if let v = try? value.decode(Double.self) { self = .number(v) }
        else if let v = try? value.decode(String.self) { self = .string(v) }
        else if let v = try? value.decode([CodexJSON].self) { self = .array(v) }
        else { self = .object(try value.decode([String: CodexJSON].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let v): try value.encode(v)
        case .array(let v): try value.encode(v)
        case .string(let v): try value.encode(v)
        case .integer(let v): try value.encode(v)
        case .number(let v): try value.encode(v)
        case .bool(let v): try value.encode(v)
        case .null: try value.encodeNil()
        }
    }

    public subscript(_ key: String) -> CodexJSON {
        guard case .object(let value) = self else { return .null }
        return value[key] ?? .null
    }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var array: [CodexJSON] { if case .array(let v) = self { return v }; return [] }
    public var integer: Int64? { if case .integer(let v) = self { return v }; return nil }
}

public enum CodexRequestID: Hashable, Sendable {
    case string(String), integer(Int64)
    public init?(_ value: CodexJSON) {
        switch value {
        case .string(let v): self = .string(v)
        case .integer(let v): self = .integer(v)
        default: return nil
        }
    }
    public var json: CodexJSON {
        switch self { case .string(let v): return .string(v); case .integer(let v): return .integer(v) }
    }
}

public enum CodexBridgeError: Error, Equatable, LocalizedError {
    case invalidMessage, lineTooLarge, pendingLimit, timeout, disconnected, unownedThread, unknownRequest
    case invalidProject, alreadyConnected, rpc(code: Int64, message: String), transport(String)
    public var errorDescription: String? {
        switch self {
        case .rpc(_, let message), .transport(let message): return message
        default: return String(describing: self)
        }
    }
}

/// Codex stdio carries JSON-RPC objects without requiring a `jsonrpc` field.
public struct CodexLineCodec {
    public static let defaultMaximumLineBytes = 1_048_576
    private var buffer = Data()
    private let maximumLineBytes: Int
    public init(maximumLineBytes: Int = defaultMaximumLineBytes) {
        self.maximumLineBytes = max(1, maximumLineBytes)
    }

    public mutating func append(_ data: Data) throws -> [CodexJSON] {
        var values: [CodexJSON] = []
        for byte in data {
            if byte == 10 {
                guard !buffer.isEmpty else { throw CodexBridgeError.invalidMessage }
                let value = try JSONDecoder().decode(CodexJSON.self, from: buffer)
                guard case .object = value else { throw CodexBridgeError.invalidMessage }
                values.append(value)
                buffer.removeAll(keepingCapacity: true)
            } else {
                guard buffer.count < maximumLineBytes else { throw CodexBridgeError.lineTooLarge }
                buffer.append(byte)
            }
        }
        return values
    }

    public static func encode(_ value: CodexJSON, maximumLineBytes: Int = defaultMaximumLineBytes) throws -> Data {
        guard case .object = value else { throw CodexBridgeError.invalidMessage }
        var data = try JSONEncoder().encode(value)
        guard data.count <= maximumLineBytes else { throw CodexBridgeError.lineTooLarge }
        data.append(10)
        return data
    }
}
