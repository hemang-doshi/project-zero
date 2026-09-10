import SwiftUI

/// Which inspector surface a pop-out window hosts.
enum InspectorPopoutKind: String, CaseIterable, Sendable {
    case flightRecorder
    case airlock
    case zeroBot
}

/// Scene registrations for the three inspector pop-outs.
///
/// Each scene is a real window (`WindowGroup(id:for:)` opened with
/// `openWindow(id:value:)`). The value is a stable per-kind tag so at most
/// one pop-out per inspector exists; the live content always comes from the
/// shared `CockpitModel`, so a pop-out shows the same `inspectionID` as its
/// parent and closing it never clears selection. No borderless windows, no
/// private API.
enum CockpitPopoutScene {
    static let flightInspector = "inspector-flight-recorder"
    static let airlockInspector = "inspector-airlock"
    static let zeroBotInspector = "inspector-zero-bot"

    static var allIDs: [String] { [flightInspector, airlockInspector, zeroBotInspector] }

    static func sceneID(for kind: InspectorPopoutKind) -> String {
        switch kind {
        case .flightRecorder: flightInspector
        case .airlock: airlockInspector
        case .zeroBot: zeroBotInspector
        }
    }

    static func title(for kind: InspectorPopoutKind) -> String {
        switch kind {
        case .flightRecorder: "Flight Recorder Inspector"
        case .airlock: "Airlock Inspector"
        case .zeroBot: "Zero Bot Run Inspector"
        }
    }
}

/// A pop-out inspector window bound to the shared model.
///
/// The model is held by reference (never copied): the pop-out renders the
/// same route surface — and therefore the same inspector and the same live
/// `selection.inspectionID` — as the main window. This view performs no
/// selection writes, so dismissing it cannot clear or retarget selection.
struct InspectorPopout: View {
    @ObservedObject var model: CockpitModel
    let kind: InspectorPopoutKind

    init(model: CockpitModel, kind: InspectorPopoutKind = .flightRecorder) {
        self.model = model
        self.kind = kind
    }

    var body: some View {
        Group {
            switch kind {
            case .flightRecorder:
                FlightRecorderView(model: model)
            case .airlock:
                AirlockView(model: model)
            case .zeroBot:
                ZeroBotView(model: model)
            }
        }
        .frame(minWidth: 900, minHeight: 640)
    }
}

/// Themed pop-out button for inspector headers.
///
/// Semantic `Button` under the custom `ZeroButtonStyle` (never a native
/// bezel), `square.on.square` symbol, shortcut noted in `help`. The action
/// is idempotent: reopening focuses the existing per-kind pop-out.
struct InspectorPopoutButton: View {
    @Environment(\.openWindow) private var openWindow
    let kind: InspectorPopoutKind

    init(kind: InspectorPopoutKind) {
        self.kind = kind
    }

    var body: some View {
        Button {
            openWindow(id: CockpitPopoutScene.sceneID(for: kind), value: kind.rawValue)
        } label: {
            Label("Pop out", systemImage: "square.on.square")
        }
        .buttonStyle(ZeroButtonStyle(.quiet))
        .focusEffectDisabled()
        .keyboardShortcut("o", modifiers: [.command, .shift])
        .help("Open inspector in its own window (⌘⇧O)")
        .accessibilityLabel("Pop out \(CockpitPopoutScene.title(for: kind))")
    }
}
