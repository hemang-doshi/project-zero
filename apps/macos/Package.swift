// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ZeroMac", platforms: [.macOS(.v14)], products: [.executable(name:"ZeroMenu",targets:["ZeroMenu"]),.executable(name:"ZeroMacObserve",targets:["ZeroMacObserve"])], targets:[.target(name:"ZeroKit"),.executableTarget(name:"ZeroMenu",dependencies:["ZeroKit"]),.executableTarget(name:"ZeroMacObserve"),.testTarget(name:"ZeroKitTests",dependencies:["ZeroKit"])])
