import XCTest
@testable import ZeroKit
final class HTTPTests: XCTestCase {
 func testHTTPRejectsErrorAndDecodesChunked() throws {
  let raw=Data("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{\"x\":1}\r\n0\r\n\r\n".utf8)
  let value=try UnixHTTP.decode(raw) as? [String:Int]
  XCTAssertEqual(value?["x"],1)
  XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 400 Bad Request\r\n\r\n{\"error\":\"denied\"}".utf8)))
  XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n20\r\nshort".utf8)))
 }
}

final class LiveUnixTests: XCTestCase {
 func testOwnerRuntimeConnection() async throws {
  guard let socket=ProcessInfo.processInfo.environment["ZERO_TEST_SOCKET"] else {throw XCTSkip("Set ZERO_TEST_SOCKET for real runtime transport verification")}
  let value=try await UnixHTTP.call(socketPath:socket,path:"doctor") as? [String:String]
  XCTAssertEqual(value?["audit_chain"],"VALID")
  let projects=try await UnixHTTP.call(socketPath:socket,path:"projects") as? [String:Any]
  XCTAssertEqual(projects?["version"] as? String,"0.2")
 }
}

final class MalformedHTTPTests:XCTestCase {
 func testEmptyChunkSizeRejected() {
  XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n\r\n".utf8)))
 }
}
