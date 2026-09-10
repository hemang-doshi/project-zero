import SwiftUI

public extension ZeroTheme {
    static let wallpaper = Color(red: 140 / 255, green: 158 / 255, blue: 130 / 255)
    static let wallpaperDot = Color(red: 108 / 255, green: 126 / 255, blue: 99 / 255)
    static let workstation = Color(red: 250 / 255, green: 248 / 255, blue: 245 / 255)
    static let navigation = Color(red: 243 / 255, green: 236 / 255, blue: 223 / 255)
    static let frameBand = Color(red: 206 / 255, green: 216 / 255, blue: 196 / 255)
    static let ink = Color(red: 25 / 255, green: 28 / 255, blue: 32 / 255)
    static let secondaryInk = Color(red: 92 / 255, green: 64 / 255, blue: 56 / 255)
    static let line = Color(red: 222 / 255, green: 215 / 255, blue: 202 / 255)
    static let orange = Color(red: 245 / 255, green: 78 / 255, blue: 0)
    static let orangePressed = Color(red: 168 / 255, green: 51 / 255, blue: 0)
    static let authorityOrange = orange
}

public enum ZeroTone: Sendable, Equatable {
    case neutral, healthy, attention, error, authority

    public var color: Color {
        switch self {
        case .neutral: ZeroTheme.secondaryInk
        case .healthy: Color(red: 0.14, green: 0.39, blue: 0.26)
        case .attention: Color(red: 0.49, green: 0.30, blue: 0.04)
        case .error: Color(red: 0.69, green: 0.15, blue: 0.16)
        case .authority: ZeroTheme.orangePressed
        }
    }
}

public enum DeliveryState: String, CaseIterable, Sendable {
    case committedLocally, awaitingDelivery, delivered, rendered, queued, stale, offline

    public var presentation: (label: String, symbol: String, detail: String, tone: ZeroTone) {
        switch self {
        case .committedLocally: ("Committed locally", "externaldrive.badge.checkmark", "Saved by the local runtime.", .neutral)
        case .awaitingDelivery: ("Awaiting delivery", "arrow.up.forward", "Committed; waiting for a delivery receipt.", .attention)
        case .delivered: ("Delivered", "checkmark.circle", "The node acknowledged delivery; rendering is unconfirmed.", .healthy)
        case .rendered: ("Rendered", "display", "A matching receipt confirms the displayed frame.", .healthy)
        case .queued: ("Queued", "tray", "Waiting for an available connection.", .attention)
        case .stale: ("Stale or uncertain", "clock.badge.questionmark", "Fresh delivery evidence is unavailable.", .attention)
        case .offline: ("Offline", "wifi.slash", "The node is disconnected.", .error)
        }
    }
}

enum ZeroControlMotion {
    static func pressScale(reduceMotion: Bool, isPressed: Bool) -> CGFloat {
        reduceMotion || !isPressed ? 1 : 0.98
    }
}

enum ZeroControlTypography {
    static let buttonTextStyle = Font.TextStyle.callout
    static let statusTextStyle = Font.TextStyle.caption2

    static let button = Font.system(buttonTextStyle, design: .default).weight(.semibold)
    static let status = Font.system(statusTextStyle, design: .monospaced).weight(.semibold)
}

struct ZeroAuthorityPresentation {
    let isPressed: Bool
    let contrast: ColorSchemeContrast

    var foreground: Color {
        if isPressed { return .white }
        return contrast == .increased ? .black : ZeroTheme.ink
    }
    var background: Color { isPressed ? ZeroTheme.orangePressed : ZeroTheme.orange }
}

// Rail tiles read as glyphs on the green desktop: unselected tiles are fully
// transparent, and selection keeps the reviewed pressed-orange edge plus the
// authority-orange continuity token. Selected fill is unchanged.
struct ZeroRailPresentation {
    let selected: Bool

    init(selected: Bool) {
        self.selected = selected
    }

    var background: Color {
        selected ? ZeroTheme.navigation : .clear
    }

    var border: Color {
        selected ? ZeroTheme.orangePressed : .clear
    }

    var accent: Color {
        ZeroTheme.authorityOrange
    }
}

public struct ZeroButtonStyle: ButtonStyle {
    public enum Kind { case standard, authority, quiet }
    private let kind: Kind
    private let selected: Bool

    public init(_ kind: Kind = .standard, selected: Bool = false) {
        self.kind = kind
        self.selected = selected
    }

    public func makeBody(configuration: Configuration) -> some View {
        Surface(configuration: configuration, kind: kind, selected: selected)
    }

    private struct Surface: View {
        let configuration: Configuration
        let kind: Kind
        let selected: Bool
        @Environment(\.isEnabled) private var enabled
        @Environment(\.isFocused) private var focused
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @Environment(\.colorSchemeContrast) private var contrast
        @State private var hovered = false

        private var authority: ZeroAuthorityPresentation {
            ZeroAuthorityPresentation(isPressed: configuration.isPressed, contrast: contrast)
        }

        private var fill: Color {
            if !enabled { return ZeroTheme.navigation }
            if kind == .authority { return authority.background }
            if selected { return ZeroTheme.frameBand }
            if configuration.isPressed || hovered { return ZeroTheme.navigation }
            return kind == .quiet ? .clear : ZeroTheme.workstation
        }

        var body: some View {
            configuration.label
                .font(ZeroControlTypography.button)
                .foregroundStyle(kind == .authority && enabled ? authority.foreground : ZeroTheme.ink)
                .padding(.horizontal, 12)
                .frame(minHeight: 32)
                .background(fill, in: RoundedRectangle(cornerRadius: 5))
                .overlay {
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(selected || contrast == .increased ? ZeroTheme.secondaryInk : ZeroTheme.line,
                                      lineWidth: selected || contrast == .increased ? 1.5 : 1)
                }
                .overlay {
                    if focused {
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(ZeroTheme.orangePressed, lineWidth: 2)
                            .padding(-3)
                    }
                }
                .opacity(enabled ? 1 : 0.5)
                .scaleEffect(ZeroControlMotion.pressScale(reduceMotion: reduceMotion, isPressed: configuration.isPressed))
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
                .animation(.easeOut(duration: 0.12), value: hovered)
                .contentShape(RoundedRectangle(cornerRadius: 5))
                .onHover { hovered = $0 }
        }
    }
}

public struct ZeroStatusBadge: View, Equatable {
    private let label: String
    private let symbol: String
    private let tone: ZeroTone

    public init(_ label: String, symbol: String = "circle.fill", tone: ZeroTone = .neutral) {
        self.label = label
        self.symbol = symbol
        self.tone = tone
    }

    public var body: some View {
        Label(label, systemImage: symbol)
            .font(ZeroControlTypography.status)
            .foregroundStyle(tone.color)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tone.color.opacity(0.09), in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(tone.color.opacity(0.3)))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
    }
}

public struct ZeroFilterChip: View {
    private let title: String
    private let selected: Bool
    private let action: () -> Void

    public init(_ title: String, selected: Bool, action: @escaping () -> Void) {
        self.title = title
        self.selected = selected
        self.action = action
    }

    public var body: some View {
        Button(title, action: action)
            .buttonStyle(ZeroButtonStyle(.quiet, selected: selected))
            .focusEffectDisabled()
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityValue(selected ? "Selected" : "Not selected")
    }
}

public struct ZeroSegmentedChoice<Value: Hashable, Label: View>: View {
    private let title: String
    private let values: [Value]
    @Binding private var selection: Value
    private let label: (Value) -> Label

    public init(_ title: String, values: [Value], selection: Binding<Value>, @ViewBuilder label: @escaping (Value) -> Label) {
        self.title = title
        self.values = values
        _selection = selection
        self.label = label
    }

    public var body: some View {
        HStack(spacing: 3) {
            ForEach(values, id: \.self) { value in
                Button { selection = value } label: { label(value) }
                    .buttonStyle(ZeroButtonStyle(.quiet, selected: selection == value))
                    .focusEffectDisabled()
                    .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
        .padding(3)
        .background(ZeroTheme.navigation, in: RoundedRectangle(cornerRadius: 7))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}
