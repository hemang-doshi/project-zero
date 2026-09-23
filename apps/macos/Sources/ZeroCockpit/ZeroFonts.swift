import AppKit
import SwiftUI

/// Project Zero typography: Inter for proportional text, JetBrains Mono for
/// evidence/code. Each helper falls back to the matching system face when a
/// family is not installed, so text always renders and stays monospaced where
/// it must. Apply through these helpers instead of `Font.system` so the
/// Stitch type stack is actually used.
public enum ZeroFontFamily {
    public static let body = "Inter"
    public static let code = "JetBrains Mono"
    public static let hasBody = NSFont(name: body, size: 12) != nil
    public static let hasCode = NSFont(name: code, size: 12) != nil
}

public extension Font {
    /// Proportional Zero text at a dynamic type style (Inter when installed).
    static func zero(_ style: Font.TextStyle = .body) -> Font {
        guard ZeroFontFamily.hasBody else { return .system(style, design: .default) }
        return .custom(ZeroFontFamily.body, size: baseSize(for: style), relativeTo: style)
    }

    /// Proportional Zero text at an explicit point size.
    static func zero(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        guard ZeroFontFamily.hasBody else { return .system(size: size, weight: weight, design: .default) }
        return .custom(ZeroFontFamily.body, size: size).weight(weight)
    }

    /// Monospaced Zero text at a dynamic type style (JetBrains Mono, else SF Mono).
    static func zeroMono(_ style: Font.TextStyle = .body) -> Font {
        guard ZeroFontFamily.hasCode else { return .system(style, design: .monospaced) }
        return .custom(ZeroFontFamily.code, size: baseSize(for: style), relativeTo: style)
    }

    /// Monospaced Zero text at an explicit point size.
    static func zeroMono(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        guard ZeroFontFamily.hasCode else { return .system(size: size, weight: weight, design: .monospaced) }
        return .custom(ZeroFontFamily.code, size: size).weight(weight)
    }

    private static func baseSize(for style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: 34
        case .title: 28
        case .title2: 22
        case .title3: 20
        case .headline: 17
        case .subheadline: 15
        case .body: 17
        case .callout: 16
        case .footnote: 13
        case .caption: 12
        case .caption2: 11
        @unknown default: 17
        }
    }
}
