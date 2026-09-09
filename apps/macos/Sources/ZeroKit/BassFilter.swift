import Foundation
/// Two one-pole low-pass filters isolate roughly 40–200 Hz without retaining PCM.
public struct BassFilter {
 private let fast:Float,slow:Float
 private var low200=[Float](repeating:0,count:2),low40=[Float](repeating:0,count:2)
 public init(sampleRate:Double){fast=Float(1-exp(-2*Double.pi*200/sampleRate));slow=Float(1-exp(-2*Double.pi*40/sampleRate))}
 public mutating func sample(_ value:Float,channel:Int)->Float {let ch=channel%2;low200[ch]+=fast*(value-low200[ch]);low40[ch]+=slow*(value-low40[ch]);return low200[ch]-low40[ch]}
}
