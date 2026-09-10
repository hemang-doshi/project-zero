import XCTest
import SwiftUI
@testable import ZeroCockpit

final class ThemeStateTests: XCTestCase {
    func testDeliveryStatesRemainDistinctAndDoNotImplyRendering() {
        XCTAssertEqual(DeliveryState.offline.presentation.label, "Offline")
        XCTAssertEqual(DeliveryState.awaitingDelivery.presentation.label, "Awaiting delivery")
        XCTAssertEqual(DeliveryState.delivered.presentation.label, "Delivered")
        XCTAssertNotEqual(DeliveryState.delivered.presentation.detail, DeliveryState.rendered.presentation.detail)
        XCTAssertEqual(Set(DeliveryState.allCases.map { $0.presentation.label }).count, 7)
    }

    func testNavigationOrderAndSelectionPreserveInspectedProject() {
        XCTAssertEqual(CockpitRoute.allCases.map(\.title), ["Desk", "Runtime", "Network", "Flight Recorder", "Airlock", "Zero Bot", "Skill Lab"])
        var selection = CockpitSelection(projectID: "project-zero")
        selection.route = .airlock
        XCTAssertEqual(selection.projectID, "project-zero")
        XCTAssertEqual(selection.route, .airlock)
    }

    func testReducedMotionNeverMovesControls() {
        XCTAssertEqual(ZeroControlMotion.pressScale(reduceMotion: true, isPressed: true), 1)
        XCTAssertEqual(ZeroControlMotion.pressScale(reduceMotion: false, isPressed: false), 1)
        XCTAssertLessThan(ZeroControlMotion.pressScale(reduceMotion: false, isPressed: true), 1)
    }

    func testProminentControlTypographyUsesDynamicTypeTextStyles() {
        XCTAssertEqual(ZeroControlTypography.buttonTextStyle, .callout)
        XCTAssertEqual(ZeroControlTypography.statusTextStyle, .caption2)
    }

    func testAuthorityTextMeetsNormalTextContrastInEveryEnabledState() {
        for contrast in [ColorSchemeContrast.standard, .increased] {
            for scheme in [ColorScheme.light, .dark] {
                var environment = EnvironmentValues()
                environment.colorScheme = scheme
                for isPressed in [false, true] {
                    let presentation = ZeroAuthorityPresentation(isPressed: isPressed, contrast: contrast)
                    let foreground = luminance(presentation.foreground.resolve(in: environment))
                    let background = luminance(presentation.background.resolve(in: environment))
                    let ratio = (max(foreground, background) + 0.05) / (min(foreground, background) + 0.05)
                    XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(scheme), \(contrast), pressed: \(isPressed)")
                }
            }
        }
    }

    func testRailTileHasNoWhiteFill() throws {
        let presentation = ZeroRailPresentation(selected: false)
        XCTAssertEqual(presentation.background, .clear)
    }

    func testSelectedRailKeepsOrangeContinuity() throws {
        XCTAssertEqual(ZeroRailPresentation(selected: true).accent, ZeroTheme.authorityOrange)
    }

    private func luminance(_ color: Color.Resolved) -> Double {
        func linear(_ value: Float) -> Double {
            let channel = Double(value)
            return channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
    }
}
