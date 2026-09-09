// Adapted from Times Gate host/macos/AuxDeckAudio.swift; Spotify-only tap, no recording.
import ZeroKit
import CoreAudio
import AudioToolbox
import Foundation

private let spotifyBundleID = "com.spotify.client"

private func propertyAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector,
                               mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}

private func checked(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw NSError(domain: "ZeroAudio", code: Int(status),
                      userInfo: [NSLocalizedDescriptionKey: "\(operation) failed (\(status))"])
    }
}

@available(macOS 14.2, *)
final class AudioMeter {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private let sampleQueue = DispatchQueue(label: "dev.projectzero.audio.samples")
    private var lastEmission = ContinuousClock.now
    private var bassFilter = BassFilter(sampleRate:48000)

    deinit { stop() }

    func start() throws {
        let processID = try spotifyProcessID()
        let description = CATapDescription(stereoMixdownOfProcesses: [processID])
        description.name = "Zero Spotify Meter"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        try checked(AudioHardwareCreateProcessTap(description, &tapID), "Create Spotify audio tap")
        var format=AudioStreamBasicDescription();var formatSize=UInt32(MemoryLayout<AudioStreamBasicDescription>.size);var formatAddress=propertyAddress(kAudioTapPropertyFormat)
        try checked(AudioObjectGetPropertyData(tapID,&formatAddress,0,nil,&formatSize,&format),"Read tap format")
        guard format.mFormatFlags & kAudioFormatFlagIsFloat != 0,format.mBitsPerChannel==32,format.mSampleRate>=8000 else{stop();throw NSError(domain:"ZeroAudio",code:2)}
        bassFilter=BassFilter(sampleRate:format.mSampleRate)
        do {
            let aggregateDescription: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Zero Private Audio Meter",
                kAudioAggregateDeviceUIDKey: "dev.projectzero.audio.aggregate.\(UUID().uuidString)",
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString]]
            ]
            try checked(AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary,
                                                            &aggregateID),
                        "Create private aggregate device")
            try checked(AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, sampleQueue) {
                [weak self] _, input, _, _, _ in self?.measure(input)
            }, "Create audio meter IO callback")
            try checked(AudioDeviceStart(aggregateID, ioProcID), "Start Spotify audio meter")
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown, let ioProcID {
            AudioDeviceStop(aggregateID, ioProcID)
            AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private func spotifyProcessID() throws -> AudioObjectID {
        var address = propertyAddress(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        try checked(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject),
                                                   &address, 0, nil, &size),
                    "Read audio process list size")
        var processes = [AudioObjectID](repeating: kAudioObjectUnknown,
                                       count: Int(size) / MemoryLayout<AudioObjectID>.stride)
        try checked(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                               &address, 0, nil, &size, &processes),
                    "Read audio process list")
        for process in processes where bundleID(of: process) == spotifyBundleID {
            return process
        }
        throw NSError(domain: "ZeroAudio", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Spotify is not producing audio"])
    }

    private func bundleID(of process: AudioObjectID) -> String? {
        var address = propertyAddress(kAudioProcessPropertyBundleID)
        var size = UInt32(MemoryLayout<CFString>.stride)
        var value: CFString = "" as CFString
        let status = withUnsafeMutablePointer(to: &value) {
            AudioObjectGetPropertyData(process, &address, 0, nil, &size, $0)
        }
        return status == noErr ? value as String : nil
    }

    private func measure(_ input: UnsafePointer<AudioBufferList>) {
        var bassSum:Double=0
        var channelOffset=0
        var sum: Double = 0
        var peak: Float = 0
        var count = 0
        for buffer in UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)) {
            guard let data = buffer.mData else { continue }
            let samples = data.assumingMemoryBound(to: Float.self)
            let sampleCount = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
            for index in 0..<sampleCount {
                let raw=samples[index].isFinite ? samples[index] : 0
                let filtered=bassFilter.sample(raw,channel:channelOffset+index%max(1,Int(buffer.mNumberChannels)))
                bassSum+=Double(filtered*filtered)
                let value = min(1, abs(raw))
                sum += Double(value * value)
                peak = max(peak, value)
                count += 1
            }
            channelOffset+=Int(buffer.mNumberChannels)
        }
        guard count > 0,lastEmission.duration(to:.now) >= .milliseconds(45) else { return }
        let rms = Float(sqrt(sum / Double(count)))
        let meter = min(1, sqrt(rms * 3.2) * 0.78 + sqrt(peak) * 0.22)
        let level = UInt8(max(0, min(255, Int(meter * 255))))
        let bass = UInt8(max(0,min(255,Int(sqrt(sqrt(bassSum/Double(count))*5)*255))))
        FileHandle.standardOutput.write(Data([level,bass]))
        lastEmission = .now
    }
}

@main enum ZeroAudio {
    static func main() async {
        guard #available(macOS 14.2, *) else {exit(2)}
        let meter = AudioMeter()
        do {
            try meter.start()
            defer { meter.stop() }
            while !Task.isCancelled { try await Task.sleep(for: .seconds(3600)) }
        } catch {
            FileHandle.standardError.write(Data("Zero audio unavailable: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
