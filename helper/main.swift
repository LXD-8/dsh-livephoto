// Apple Live Photo pair writer + Photos importer.
//
// Builds a JPEG + MOV pair that AVFoundation, PHLivePhoto and Photos accept as
// a real Live Photo:
//   - still: JPEG carrying the Apple maker-note asset identifier (tag 17)
//   - movie: passthrough video, matching `com.apple.quicktime.content.identifier`,
//     plus a boxed `mebx` timed-metadata track written by AVAssetWriter itself
//     (`com.apple.quicktime.still-image-time`), which is what the hand-rolled
//     variants never got right.
// Optional `import` step adds both resources to the Photos library in a single
// PHAssetCreationRequest, so iCloud can sync them to the iPhone as one asset.
//
// Usage: dsh-livephoto-helper <job.json> <result.json>

import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ImageIO
import Photos
import UniformTypeIdentifiers

struct Job: Decodable {
    let action: String
    let photo: String
    let video: String
    let outputDir: String
    let coverTime: Double
    let baseName: String
}

struct Failure: Error, CustomStringConvertible {
    let description: String
}

func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw Failure(description: message) }
}

let jobPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let resultPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""

var result: [String: Any] = [:]
func finish(_ payload: [String: Any], status: Int32) -> Never {
    var out = payload
    if out["action"] == nil, let job = try? JSONDecoder().decode(Job.self, from: Data(contentsOf: URL(fileURLWithPath: jobPath))) {
        out["action"] = job.action
    }
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])) ?? Data()
    try? data.write(to: URL(fileURLWithPath: resultPath.isEmpty ? "/tmp/dsh-livephoto-result.json" : resultPath))
    print(String(data: data, encoding: .utf8) ?? "{}")
    exit(status)
}

func pump(_ seconds: Double) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

/// Save a still as JPEG with the Live Photo asset identifier in the Apple maker note.
func writeStill(source: URL, destination: URL, identifier: String, target: CGSize) throws {
    guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
        throw Failure(description: "cannot decode still image: \(source.path)")
    }
    let width = Int(target.width.rounded())
    let height = Int(target.height.rounded())
    var output = image
    if image.width != width || image.height != height {
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else {
            throw Failure(description: "cannot allocate image context")
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage() else {
            throw Failure(description: "cannot scale still image")
        }
        output = scaled
    }
    var properties = (CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any]) ?? [:]
    var maker = (properties[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any]) ?? [:]
    maker["17"] = identifier
    properties[kCGImagePropertyMakerAppleDictionary as String] = maker
    properties[kCGImageDestinationLossyCompressionQuality as String] = 0.98
    guard let destinationImage = CGImageDestinationCreateWithURL(
        destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil
    ) else {
        throw Failure(description: "cannot create JPEG destination")
    }
    CGImageDestinationAddImage(destinationImage, output, properties as CFDictionary)
    try check(CGImageDestinationFinalize(destinationImage), "cannot write \(destination.path)")
}

struct BuiltPair {
    let photo: URL
    let video: URL
    let identifier: String
    let stillTime: Double
    let duration: Double
    let fps: Double
}

func buildPair(job: Job) throws -> BuiltPair {
    let photoURL = URL(fileURLWithPath: job.photo)
    let videoURL = URL(fileURLWithPath: job.video)
    let outputDir = URL(fileURLWithPath: job.outputDir, isDirectory: true)
    try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

    let asset = AVURLAsset(url: videoURL)
    let duration = CMTimeGetSeconds(asset.duration)
    try check(duration.isFinite && duration > 0, "cannot read video duration")
    try check(asset.tracks(withMediaType: .audio).isEmpty, "video carries an audio track; strip it before pairing")
    guard let track = asset.tracks(withMediaType: .video).first else {
        throw Failure(description: "video has no visual track")
    }
    let codec = track.formatDescriptions.first.map { CMFormatDescriptionGetMediaSubType($0 as! CMFormatDescription) }
    try check(codec == kCMVideoCodecType_H264 || codec == kCMVideoCodecType_HEVC,
              "video must be H.264 or HEVC")
    let transform = track.preferredTransform
    let size = track.naturalSize.applying(transform)
    try check(size.width > 0 && size.height > 0, "video has an empty frame size")
    var fps = Double(track.nominalFrameRate)
    if !(fps.isFinite && fps > 0) { fps = 30 }
    let stillTime = job.coverTime
    try check(stillTime.isFinite && stillTime >= 0, "cover time must be zero or later")
    try check(stillTime + 1 / fps <= duration + 0.001, "cover time lies outside the video")

    let identifier = UUID().uuidString
    let photoOut = outputDir.appendingPathComponent("\(job.baseName).JPG")
    let videoOut = outputDir.appendingPathComponent("\(job.baseName).MOV")
    try? FileManager.default.removeItem(at: photoOut)
    try? FileManager.default.removeItem(at: videoOut)
    try writeStill(source: photoURL, destination: photoOut, identifier: identifier,
                   target: CGSize(width: abs(size.width), height: abs(size.height)))

    let reader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    videoOutput.alwaysCopiesSampleData = false
    try check(reader.canAdd(videoOutput), "cannot read the video track")
    reader.add(videoOutput)

    let writer = try AVAssetWriter(outputURL: videoOut, fileType: .mov)
    let content = AVMutableMetadataItem()
    content.keySpace = .quickTimeMetadata
    content.key = AVMetadataKey.quickTimeMetadataKeyContentIdentifier as NSString
    content.value = identifier as NSString
    content.dataType = kCMMetadataBaseDataType_UTF8 as String
    writer.metadata = [content]

    guard let format = track.formatDescriptions.first as! CMFormatDescription? else {
        throw Failure(description: "video has no format description")
    }
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: format)
    videoInput.transform = transform
    videoInput.expectsMediaDataInRealTime = false
    try check(writer.canAdd(videoInput), "cannot write the video track")
    writer.add(videoInput)

    let spec: [String: Any] = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String:
            "mdta/com.apple.quicktime.still-image-time",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String:
            kCMMetadataBaseDataType_SInt8 as String,
    ]
    var metadataFormat: CMFormatDescription?
    let formatStatus = CMMetadataFormatDescriptionCreateWithMetadataSpecifications(
        allocator: kCFAllocatorDefault, metadataType: kCMMetadataFormatType_Boxed,
        metadataSpecifications: [spec] as CFArray, formatDescriptionOut: &metadataFormat
    )
    try check(formatStatus == noErr && metadataFormat != nil, "cannot create the metadata format")
    let metadataInput = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil,
                                           sourceFormatHint: metadataFormat)
    metadataInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadataInput)
    try check(writer.canAdd(metadataInput), "cannot write the metadata track")
    writer.add(metadataInput)

    try check(writer.startWriting(), "cannot start the writer")
    writer.startSession(atSourceTime: .zero)
    try check(reader.startReading(), "cannot start the reader")

    let still = AVMutableMetadataItem()
    still.keySpace = .quickTimeMetadata
    still.key = "com.apple.quicktime.still-image-time" as NSString
    still.value = NSNumber(value: Int8(0))
    still.dataType = kCMMetadataBaseDataType_SInt8 as String
    let stillRange = CMTimeRange(
        start: CMTime(seconds: stillTime, preferredTimescale: 60000),
        duration: CMTime(seconds: 1 / fps, preferredTimescale: 60000)
    )
    try check(adaptor.append(AVTimedMetadataGroup(items: [still], timeRange: stillRange)),
              "cannot append the still-image-time sample")
    metadataInput.markAsFinished()

    while let sample = videoOutput.copyNextSampleBuffer() {
        while !videoInput.isReadyForMoreMediaData {
            try check(writer.status == .writing, "writer failed: \(writer.error?.localizedDescription ?? "unknown")")
            Thread.sleep(forTimeInterval: 0.002)
        }
        try check(videoInput.append(sample), "cannot append a video sample")
    }
    try check(reader.status == .completed, "reader failed: \(reader.error?.localizedDescription ?? "unknown")")
    videoInput.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    try check(done.wait(timeout: .now() + 120) == .success && writer.status == .completed,
              "writer failed: \(writer.error?.localizedDescription ?? "unknown")")

    // Read both identifiers back and load the pair the way the system does.
    let imageCheck = CGImageSourceCreateWithURL(photoOut as CFURL, nil)
    let imageProps = imageCheck.flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) as? [String: Any] }
    let photoID = (imageProps?[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any])?["17"] as? String
    let paired = AVURLAsset(url: videoOut)
    let videoID = paired.metadata(forFormat: .quickTimeMetadata)
        .first { $0.identifier == .quickTimeMetadataContentIdentifier }?.stringValue
    try check(photoID == identifier && videoID == identifier, "identifier readback mismatch")

    var stillTimeReadback: Double?
    for metadataTrack in paired.tracks(withMediaType: .metadata) {
        guard let readReader = try? AVAssetReader(asset: paired) else { continue }
        let metadataOutput = AVAssetReaderTrackOutput(track: metadataTrack, outputSettings: nil)
        guard readReader.canAdd(metadataOutput) else { continue }
        readReader.add(metadataOutput)
        let metadataAdaptor = AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput: metadataOutput)
        guard readReader.startReading() else { continue }
        while let group = metadataAdaptor.nextTimedMetadataGroup() {
            if group.items.contains(where: { ($0.key as? String) == "com.apple.quicktime.still-image-time" }) {
                stillTimeReadback = CMTimeGetSeconds(group.timeRange.start)
            }
        }
    }
    var loaded = false
    var completed = false
    var loadError: String?
    let request = PHLivePhoto.request(
        withResourceFileURLs: [photoOut, videoOut], placeholderImage: nil,
        targetSize: .zero, contentMode: .aspectFit
    ) { livePhoto, info in
        if (info[PHLivePhotoInfoIsDegradedKey] as? Bool) == true { return }
        loaded = livePhoto != nil
        loadError = (info[PHLivePhotoInfoErrorKey] as? Error)?.localizedDescription
        completed = true
    }
    let deadline = Date().addingTimeInterval(30)
    while !completed && Date() < deadline { pump(0.05) }
    if !completed {
        PHLivePhoto.cancelRequest(withRequestID: request)
        loadError = "PHLivePhoto loading timed out"
    }
    try check(loaded, "the pair was written but PHLivePhoto refused it: \(loadError ?? "unknown")")

    return BuiltPair(photo: photoOut, video: videoOut, identifier: identifier,
                     stillTime: stillTimeReadback ?? stillTime, duration: duration, fps: fps)
}

func importToPhotos(pair: BuiltPair, completion: @escaping (String?, String?) -> Void) {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
        guard status == .authorized || status == .limited else {
            completion(nil, "Photos access was not granted (\(status.rawValue)); approve it once in the system dialog and run again")
            return
        }
        var createdID: String?
        PHPhotoLibrary.shared().performChanges({
            let creation = PHAssetCreationRequest.forAsset()
            let photoOptions = PHAssetResourceCreationOptions()
            photoOptions.originalFilename = pair.photo.lastPathComponent
            let videoOptions = PHAssetResourceCreationOptions()
            videoOptions.originalFilename = pair.video.lastPathComponent
            creation.addResource(with: .photo, fileURL: pair.photo, options: photoOptions)
            creation.addResource(with: .pairedVideo, fileURL: pair.video, options: videoOptions)
            createdID = creation.placeholderForCreatedAsset?.localIdentifier
        }) { success, error in
            guard success else {
                completion(nil, "Photos rejected the pair: \(error?.localizedDescription ?? "unknown")")
                return
            }
            // Photos pairs asynchronously; give it a moment before reading subtypes.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                guard let identifier = createdID,
                      let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else {
                    completion(nil, "the asset was written but could not be read back")
                    return
                }
                if asset.mediaSubtypes.contains(.photoLive) {
                    completion(identifier, nil)
                } else {
                    completion(nil, "Photos stored the pair as a plain photo plus video (subtypes=\(asset.mediaSubtypes.rawValue))")
                }
            }
        }
    }
}

do {
    let job = try JSONDecoder().decode(Job.self, from: Data(contentsOf: URL(fileURLWithPath: jobPath)))
    let pair = try buildPair(job: job)
    var payload: [String: Any] = [
        "action": job.action,
        "ok": true,
        "identifier": pair.identifier,
        "photo": pair.photo.path,
        "video": pair.video.path,
        "stillTime": pair.stillTime,
        "duration": pair.duration,
        "fps": pair.fps,
        "livePhotoLoaded": true,
    ]
    if job.action == "make" {
        var done = false
        var assetID: String?
        var importError: String?
        importToPhotos(pair: pair) { id, error in
            assetID = id
            importError = error
            done = true
        }
        let deadline = Date().addingTimeInterval(180)
        while !done && Date() < deadline { pump(0.05) }
        if !done {
            payload["ok"] = false
            payload["imported"] = false
            payload["error"] = "waiting for the Photos permission dialog; approve it and run again"
            finish(payload, status: 4)
        }
        payload["imported"] = assetID != nil
        payload["assetID"] = assetID ?? ""
        if let importError {
            payload["ok"] = false
            payload["error"] = importError
            finish(payload, status: 5)
        }
    }
    finish(payload, status: 0)
} catch {
    finish(["ok": false, "error": (error as? Failure)?.description ?? "\(error)"], status: 1)
}
