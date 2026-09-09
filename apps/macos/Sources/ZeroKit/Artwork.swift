import Foundation
import ImageIO
import CoreGraphics
import CryptoKit

public enum Artwork {
 public static func allowed(_ u:URL)->Bool {u.scheme=="https" && u.host=="i.scdn.co" && (u.port==nil || u.port==443) && u.user==nil && u.password==nil && u.query==nil && u.fragment==nil && u.path.hasPrefix("/image/") && u.path.count<160}
 public static func rgb565(_ data:Data)->Data? {
  guard data.count<=524288,let source=CGImageSourceCreateWithData(data as CFData,nil),let properties=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any],let width=properties[kCGImagePropertyPixelWidth] as? Int,let height=properties[kCGImagePropertyPixelHeight] as? Int,width>0,height>0,width<=4096,height<=4096,let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:32,kCGImageSourceCreateThumbnailWithTransform:true] as CFDictionary) else{return nil}
  var rgba=[UInt8](repeating:0,count:4096)
  let drawn=rgba.withUnsafeMutableBytes { bytes -> Bool in
   guard let context=CGContext(data:bytes.baseAddress,width:32,height:32,bitsPerComponent:8,bytesPerRow:128,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue) else{return false}
   context.interpolationQuality = .high;context.draw(image,in:CGRect(x:0,y:0,width:32,height:32));return true
  }
  guard drawn else{return nil};var result=Data(capacity:2048)
  for i in stride(from:0,to:rgba.count,by:4){let pixel=(UInt16(rgba[i]>>3)<<11)|(UInt16(rgba[i+1]>>2)<<5)|UInt16(rgba[i+2]>>3);result.append(UInt8(pixel>>8));result.append(UInt8(pixel&255))};return result
 }
 public static func thumbnail(_ text:String)->String? {
  guard let url=URL(string:text),allowed(url) else{return nil}
  let key=SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined()
  let cache=FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("ProjectZero")
  try? FileManager.default.createDirectory(at:cache,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
  let path=cache.appendingPathComponent("artwork.json")
  if let data=try? Data(contentsOf:path),data.count<4096,let record=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],record["key"] as? String==key {
   if let pixels=record["pixels"] as? String,Data(base64Encoded:pixels)?.count==2048{return pixels}
   if Date().timeIntervalSince1970-(record["time"] as? Double ?? 0)<60{return nil}
  }
  let download=ArtworkDownload();let configuration=URLSessionConfiguration.ephemeral;configuration.timeoutIntervalForRequest=2;configuration.timeoutIntervalForResource=2;configuration.httpShouldSetCookies=false
  let queue=OperationQueue();queue.maxConcurrentOperationCount=1
  let session=URLSession(configuration:configuration,delegate:download,delegateQueue:queue)
  session.dataTask(with:url).resume();let finished=download.done.wait(timeout:.now()+2.3) == .success
  session.invalidateAndCancel()
  let pixels=finished ? download.output.flatMap{rgb565($0)}?.base64EncodedString() : nil
  var record:[String:Any]=["key":key,"time":Date().timeIntervalSince1970];if let pixels=pixels{record["pixels"]=pixels}
  if let data=try? JSONSerialization.data(withJSONObject:record){try? data.write(to:path,options:.atomic)}
  return pixels
 }
}
private final class ArtworkDownload:NSObject,URLSessionDataDelegate,@unchecked Sendable {
 let done=DispatchSemaphore(value:0);private var bytes=Data();var output:Data?
 func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
 func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping(URLSession.ResponseDisposition)->Void){let ok=(response as? HTTPURLResponse)?.statusCode==200 && response.expectedContentLength<=524288 && (response.mimeType?.hasPrefix("image/") ?? false);completionHandler(ok ? .allow:.cancel)}
 func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data){if bytes.count+data.count>524288{dataTask.cancel()}else{bytes.append(data)}}
 func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){if error==nil{output=bytes};done.signal()}
}
