import AppKit
import Foundation
func emit(_ value:[String:String]) {if let data=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]){FileHandle.standardOutput.write(data)}}
guard CommandLine.arguments.dropFirst().first=="spotify" else{exit(2)}
guard !NSRunningApplication.runningApplications(withBundleIdentifier:"com.spotify.client").isEmpty else{emit(["state":"not_running"]);exit(0)}
// Static read-only AppleScript: no user text is interpolated and no playback command exists.
let source="""
tell application id "com.spotify.client"
 return {player state as string, name of current track, artist of current track}
end tell
"""
var error:NSDictionary?
guard let result=NSAppleScript(source:source)?.executeAndReturnError(&error),error==nil else{exit(3)}
func field(_ n:Int)->String {String((result.atIndex(n)?.stringValue ?? "").prefix(128))}
emit(["state":field(1),"track":field(2),"artist":field(3)])
