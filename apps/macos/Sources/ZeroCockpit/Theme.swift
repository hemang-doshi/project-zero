import SwiftUI

public enum ZeroTheme {
    // Canonical Stitch tokens live here and in ZeroControls.swift.
    // `environment`, `panel`, and `authority` were removed: their values
    // matched no Stitch reference (see the screen-anatomy spec).
}
public enum ZeroType {
    public static let bodyFontName = "Inter"
    public static let codeFontName = "JetBrains Mono"
}
public extension ZeroTheme {
    static let brandOrange = Color(red: 0xF5/255, green: 0x4E/255, blue: 0x00/255)
    static let primaryAuthority = Color(red: 0xA8/255, green: 0x33/255, blue: 0x00/255)
    static let cardCream = Color(red: 0xFA/255, green: 0xF8/255, blue: 0xF5/255)
    static let navCream = Color(red: 0xF3/255, green: 0xEC/255, blue: 0xDF/255)
    static let navBorder = Color(red: 0xDE/255, green: 0xD7/255, blue: 0xCA/255)
    static let canvasTan = Color(red: 0xE9/255, green: 0xE3/255, blue: 0xD7/255)
    static let windowCanvas = Color(red: 0xDB/255, green: 0xE3/255, blue: 0xD3/255)
    static let hoverOrange = Color(red: 0xE0/255, green: 0x47/255, blue: 0x00/255)
    static let markerYellow = Color(red: 0xF7/255, green: 0xDF/255, blue: 0x94/255)
    static let statusGreen = Color(red: 0x10/255, green: 0xB9/255, blue: 0x81/255)
    static let highlightBlue = Color(red: 0x3B/255, green: 0x82/255, blue: 0xF6/255)
    static let errorRed = Color(red: 0xDC/255, green: 0x26/255, blue: 0x26/255)
}
