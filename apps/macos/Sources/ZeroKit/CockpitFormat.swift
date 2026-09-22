import Foundation

public enum CockpitFormat {
    public static func elapsed(milliseconds: Int64) -> String {
        let seconds = max(0, milliseconds / 1_000)
        return String(format: "%d:%02d:%02d", seconds / 3_600, (seconds / 60) % 60, seconds % 60)
    }
}
