import XCTest
@testable import ZeroKit

final class CockpitFormattingTests: XCTestCase {
    func testElapsedUsesHours() {
        XCTAssertEqual(CockpitFormat.elapsed(milliseconds: 3_661_000), "1:01:01")
    }

    func testElapsedPadsMinutesAndSeconds() {
        XCTAssertEqual(CockpitFormat.elapsed(milliseconds: 59_000), "0:00:59")
    }
}
