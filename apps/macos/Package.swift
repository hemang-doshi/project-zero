// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ZeroMac", platforms: [.macOS(.v14)], products: [.executable(name:"ZeroMenu",targets:["ZeroMenu"]),.executable(name:"ZeroMacObserve",targets:["ZeroMacObserve"])], targets:[.target(name:"ZeroKit"),.target(name:"ZeroCockpit",dependencies:["ZeroKit"]),.executableTarget(name:"ZeroMenu",dependencies:["ZeroKit","ZeroCockpit"]),.executableTarget(name:"ZeroMacObserve",dependencies:["ZeroKit"]),.executableTarget(name:"ZeroAudio",dependencies:["ZeroKit"]),.testTarget(name:"ZeroKitTests",dependencies:["ZeroKit"])])
