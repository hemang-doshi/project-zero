import Foundation
import Darwin
public struct ZeroError: LocalizedError {public let message:String;public let rejected:Bool;public var errorDescription:String?{message};public init(_ message:String,rejected:Bool=false){self.message=message;self.rejected=rejected}}
public enum UnixHTTP {
 public static func decode(_ bytes:Data)throws->Any {
  let marker=Data("\r\n\r\n".utf8);guard let split=bytes.range(of:marker),let headers=String(data:bytes[..<split.lowerBound],encoding:.utf8) else{throw ZeroError("Invalid runtime response")}
  var body=Data(bytes[split.upperBound...]);if headers.lowercased().contains("transfer-encoding: chunked") {
   var rest=body;body=Data()
   while true {guard let line=rest.range(of:Data("\r\n".utf8)),let countText=String(data:rest[..<line.lowerBound],encoding:.utf8),let count=Int(countText.split(separator:";").first ?? "",radix:16),count>=0 else{throw ZeroError("Invalid response chunk")};rest=Data(rest[line.upperBound...]);if count==0{break};guard count<=rest.count-2 else{throw ZeroError("Truncated response chunk")};body.append(rest.prefix(count));rest=Data(rest.dropFirst(count+2))}
  }
  let value=try JSONSerialization.jsonObject(with:body)
  guard headers.split(separator:" ").dropFirst().first=="200" else{throw ZeroError((value as? [String:Any])?["error"] as? String ?? "Runtime rejected action",rejected:true)};return value
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
  let fd=Darwin.socket(AF_UNIX,SOCK_STREAM,0);guard fd>=0 else{throw ZeroError("Cannot create runtime connection")};defer{Darwin.close(fd)}
  var timeout=timeval(tv_sec:3,tv_usec:0);setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size));var noSig:Int32=1;setsockopt(fd,SOL_SOCKET,SO_NOSIGPIPE,&noSig,4)
  var address=sockaddr_un();address.sun_family=sa_family_t(AF_UNIX);let pathBytes=Array(socketPath.utf8)+[0]
  guard pathBytes.count<=MemoryLayout.size(ofValue:address.sun_path) else{throw ZeroError("Runtime socket path too long")}
  withUnsafeMutableBytes(of:&address.sun_path){destination in destination.copyBytes(from:pathBytes)}
  let result=withUnsafePointer(to:&address){$0.withMemoryRebound(to:sockaddr.self,capacity:1){Darwin.connect(fd,$0,socklen_t(MemoryLayout<sockaddr_un>.size))}}
  guard result==0 else{throw ZeroError("Runtime disconnected")}
  let payload=try body.map{try JSONSerialization.data(withJSONObject:$0)} ?? Data()
  var request=Data("\(body == nil ? "GET":"POST") /v0.1/\(path) HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: \(payload.count)\r\n\r\n".utf8);request.append(payload)
  try request.withUnsafeBytes { raw in var sent=0;while sent<raw.count {let n=Darwin.write(fd,raw.baseAddress!.advanced(by:sent),raw.count-sent);guard n>0 else{throw ZeroError("Runtime write failed")};sent+=n}}
  var response=Data();var buffer=[UInt8](repeating:0,count:8192)
  while true{let n=Darwin.read(fd,&buffer,buffer.count);if n==0{break};guard n>0 else{throw ZeroError("Runtime response timed out")};guard response.count+n<=4*1024*1024 else{throw ZeroError("Runtime response too large")};response.append(contentsOf:buffer.prefix(n))}
  return try decode(response)
 }
}
