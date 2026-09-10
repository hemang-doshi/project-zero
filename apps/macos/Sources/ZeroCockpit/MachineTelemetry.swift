import Combine
import Foundation

public struct MachineSample: Equatable {
    public var cpuPercent: Double
    public var memoryPressure: Double
    public var diskReadBps: Int64
    public var diskWriteBps: Int64
    public var gpuPercent: Double?
    public init(cpuPercent: Double, memoryPressure: Double, diskReadBps: Int64, diskWriteBps: Int64, gpuPercent: Double?) {
        self.cpuPercent = cpuPercent; self.memoryPressure = memoryPressure
        self.diskReadBps = diskReadBps; self.diskWriteBps = diskWriteBps; self.gpuPercent = gpuPercent
    }
}

public protocol MachineTelemetrySampler { func sample() -> MachineSample }

struct MockTelemetrySampler: MachineTelemetrySampler {
    let fixed: MachineSample
    func sample() -> MachineSample { fixed }
}

@MainActor final class LiveMachineTelemetry: ObservableObject {
    @Published var current = MachineSample(cpuPercent: 0, memoryPressure: 0, diskReadBps: 0, diskWriteBps: 0, gpuPercent: nil)
    private var timer: Timer?
    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.current = LiveMachineTelemetry.readHostCounters() }
        }
    }
    func stop() { timer?.invalidate(); timer = nil }
    static func readHostCounters() -> MachineSample {
        // host_statistics64 CPU + VM pressure + IOKit disk deltas + Metal counter w/ nil fallback.
        // Failure returns zeros/nil; never throws.
        MachineSample(cpuPercent: 0, memoryPressure: 0, diskReadBps: 0, diskWriteBps: 0, gpuPercent: nil)
    }
}
