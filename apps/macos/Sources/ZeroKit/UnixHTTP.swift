import Foundation
import Darwin
public struct ZeroError: LocalizedError {public let message:String;public let rejected:Bool;public var errorDescription:String?{message};public init(_ message:String,rejected:Bool=false){self.message=message;self.rejected=rejected}}
public enum UnixHTTP {
 public static func decode(_ bytes:Data)throws->Any {
  let marker=Data("\r\n\r\n".utf8)
  guard let split=bytes.range(of:marker) else{throw ZeroError(bytes.count>16_384 ? "Runtime response headers too large":"Invalid runtime response")}
  guard bytes.distance(from:bytes.startIndex,to:split.lowerBound)<=16_384,
        let headers=String(data:bytes[..<split.lowerBound],encoding:.utf8) else{throw ZeroError("Runtime response headers too large")}
  let status=headers.components(separatedBy:"\r\n")[0].split(separator:" ",omittingEmptySubsequences:true)
  guard status.count>=2,["HTTP/1.0","HTTP/1.1"].contains(String(status[0])),let statusCode=Int(status[1]),(100...599).contains(statusCode) else{throw ZeroError("Invalid runtime response status")}
  var body=Data(bytes[split.upperBound...]);if headers.lowercased().contains("transfer-encoding: chunked") {
   var rest=body;body=Data()
   while true {
    guard let line=rest.range(of:Data("\r\n".utf8)),line.lowerBound<=rest.index(rest.startIndex,offsetBy:min(rest.count,128)),let countText=String(data:rest[..<line.lowerBound],encoding:.utf8),let count=Int(countText.split(separator:";").first ?? "",radix:16),count>=0 else{throw ZeroError("Invalid response chunk")}
    rest=Data(rest[line.upperBound...])
    if count==0 {
     guard rest==Data("\r\n".utf8)||(rest.count<=16_384&&rest.range(of:marker)?.upperBound==rest.endIndex) else{throw ZeroError("Invalid response trailers")}
     break
    }
    guard count<=rest.count,rest.count-count>=2 else{throw ZeroError("Truncated response chunk")}
    let end=rest.index(rest.startIndex,offsetBy:count),terminatorEnd=rest.index(end,offsetBy:2)
    guard rest[end..<terminatorEnd]==Data("\r\n".utf8) else{throw ZeroError("Invalid response chunk terminator")}
    body.append(rest[..<end]);rest=Data(rest[terminatorEnd...])
   }
  }
  let value=try JSONSerialization.jsonObject(with:body)
  guard statusCode==200 else{throw ZeroError((value as? [String:Any])?["error"] as? String ?? "Runtime rejected action",rejected:true)};return value
 }
 public static func call(socketPath:String,path:String,body:[String:Any]?=nil)async throws->Any {
  try await withCheckedThrowingContinuation { continuation in
   DispatchQueue.global(qos:.userInitiated).async {
    do {continuation.resume(returning:try request(socketPath:socketPath,path:path,body:body))}catch{continuation.resume(throwing:error)}
   }
  }
 }
 private static func request(socketPath:String,path:String,body:[String:Any]?)throws->Any {
  guard !path.contains("\r"),!path.contains("\n") else{throw ZeroError("Invalid request path")}
  let connection = try UnixSocketConnection(socketPath: socketPath, timeoutSeconds: 3)
  defer { connection.close() }
  let fd = connection.fd
  let payload=try body.map{try JSONSerialization.data(withJSONObject:$0)} ?? Data()
  var request=Data("\(body == nil ? "GET":"POST") /v0.1/\(path) HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: \(payload.count)\r\n\r\n".utf8);request.append(payload)
  try request.withUnsafeBytes { raw in var sent=0;while sent<raw.count {let n=Darwin.write(fd,raw.baseAddress!.advanced(by:sent),raw.count-sent);if n<0&&errno==EINTR{continue};guard n>0 else{throw ZeroError("Runtime write failed")};sent+=n}}
  var response=Data();var buffer=[UInt8](repeating:0,count:8192)
  while true{let n=Darwin.read(fd,&buffer,buffer.count);if n<0&&errno==EINTR{continue};if n==0{break};guard n>0 else{throw ZeroError("Runtime response timed out")};guard response.count+n<=4*1024*1024 else{throw ZeroError("Runtime response too large")};response.append(contentsOf:buffer.prefix(n))}
  return try decode(response)
 }
}

/// Socket permissions and peer identity keep both HTTP clients owner-local.
/// Cancellation uses shutdown; only the worker closes the descriptor, avoiding
/// descriptor reuse races between cancellation and an in-progress read.
final class UnixSocketConnection: @unchecked Sendable {
 let fd: Int32
 private let lock = NSLock()
 private var closed = false
 init(socketPath: String, timeoutSeconds: Int) throws {
  guard !socketPath.utf8.contains(0) else { throw ZeroError("Invalid runtime socket path") }
  var info = stat()
  guard lstat(socketPath, &info) == 0,
        info.st_mode & S_IFMT == S_IFSOCK,
        info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else {
   throw ZeroError("Runtime socket unavailable or not owner-only")
  }
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  let pathBytes = Array(socketPath.utf8) + [0]
  guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw ZeroError("Runtime socket path too long") }
  fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard fd >= 0 else { throw ZeroError("Cannot create runtime connection") }
  do {
   var timeout = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
   var noSig: Int32 = 1
   guard setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0,
         setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0,
         setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSig, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
    throw ZeroError("Cannot configure runtime connection")
   }
   withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: pathBytes) }
   let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
    Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
   } }
   guard result == 0 else { throw ZeroError("Runtime disconnected") }
   var owner: uid_t = 0
   var group: gid_t = 0
   guard getpeereid(fd, &owner, &group) == 0, owner == geteuid() else { throw ZeroError("Runtime peer is not the current owner") }
  } catch { Darwin.close(fd); closed = true; throw error }
 }
 func cancel() { lock.withLock { if !closed { _ = Darwin.shutdown(fd, SHUT_RDWR) } } }
 func close() { lock.withLock { if !closed { closed = true; Darwin.close(fd) } } }
 deinit { close() }
}
