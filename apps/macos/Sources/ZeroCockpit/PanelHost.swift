import SwiftUI
public enum PanelSelection: String, Equatable, CaseIterable {
    case primary, secondary, tertiary
}
public struct PanelHost<Panel: View>: View {
    @Binding var selected: PanelSelection
    let options: [PanelSelection]
    let panel: (PanelSelection) -> Panel
    public init(selected: Binding<PanelSelection>, options: [PanelSelection], @ViewBuilder panel: @escaping (PanelSelection) -> Panel) {
        _selected = selected; self.options = options; self.panel = panel
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Panel", selection: $selected) {
                ForEach(options, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
            }.pickerStyle(.segmented)
            panel(selected).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(ZeroTheme.workstation, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ZeroTheme.line))
    }
}
