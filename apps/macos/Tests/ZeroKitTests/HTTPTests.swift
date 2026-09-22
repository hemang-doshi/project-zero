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
  let value=try await UnixHTTP.call(socketPath:socket,path:"doctor") as? [String:Any]
  XCTAssertEqual(value?["audit_chain"] as? String,"VALID")
  let projects=try await UnixHTTP.call(socketPath:socket,path:"projects") as? [String:Any]
  XCTAssertEqual(projects?["version"] as? String,"0.2")
 }
}

final class MalformedHTTPTests:XCTestCase {
 func testEmptyChunkSizeRejected() {
  XCTAssertThrowsError(try UnixHTTP.decode(Data("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n\r\n".utf8)))
 }
}
final class RejectionTests:XCTestCase {
 func testAuthoritativeRejectionDiffersFromTransportUncertainty()throws {
  do {_ = try UnixHTTP.decode(Data("HTTP/1.1 400 Bad Request\r\n\r\n{\"error\":\"AUTHORIZATION: denied\"}".utf8));XCTFail("accepted")}catch let e as ZeroError {XCTAssertTrue(e.rejected)}
  XCTAssertFalse(ZeroError("Runtime disconnected").rejected)
 }
}
final class ArtworkTests:XCTestCase {
 func testRejectsForeignArtworkHosts(){XCTAssertFalse(Artwork.allowed(URL(string:"https://localhost/image/x")!));XCTAssertFalse(Artwork.allowed(URL(string:"http://i.scdn.co/image/x")!));XCTAssertTrue(Artwork.allowed(URL(string:"https://i.scdn.co/image/ab123")!))}
 func testRejectsInvalidImage(){XCTAssertNil(Artwork.rgb565(Data("not an image".utf8)))}
}
final class BassFilterTests:XCTestCase {
 func testBassBandRejectsHighFrequency(){
  func energy(_ hz:Double)->Double{var filter=BassFilter(sampleRate:48000);var sum=0.0;for i in 0..<48000{let v=filter.sample(Float(sin(2*Double.pi*hz*Double(i)/48000)),channel:0);if i>1000{sum+=Double(v*v)}};return sum}
  XCTAssertGreaterThan(energy(100),energy(2000)*16)
 }
}
