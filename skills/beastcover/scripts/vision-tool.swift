import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// 用法：
//   vision cutout <输入图片> <输出 PNG>   抠出前景主体
//   vision focus <输入图片>              打印主体中心的 JSON：人脸，其次显著物体，其次注意力区域
// 退出码 2 参数错，3 没找到主体，4 读写失败。
let args = CommandLine.arguments

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
    exit(code)
}

func loadImage(_ path: String) -> CGImage {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("cannot read \(path)", 4)
    }
    return image
}

func union(_ boxes: [CGRect]) -> CGRect? {
    guard var result = boxes.first else { return nil }
    for box in boxes.dropFirst() { result = result.union(box) }
    return result
}

func printFocus(_ box: CGRect, _ source: String) {
    // Vision 的坐标原点在左下角，换成左上角。
    let x = box.midX
    let y = 1 - box.midY
    print("{\"x\":\(x),\"y\":\(y),\"width\":\(box.width),\"height\":\(box.height),\"source\":\"\(source)\"}")
}

func focus(_ path: String) {
    let handler = VNImageRequestHandler(cgImage: loadImage(path), options: [:])
    let faces = VNDetectFaceRectanglesRequest()
    // 按物体的显著性框得紧，按注意力的常常框住大半张图，所以先用前者，没有结果再用后者。
    let objects = VNGenerateObjectnessBasedSaliencyImageRequest()
    let attention = VNGenerateAttentionBasedSaliencyImageRequest()
    do {
        try handler.perform([faces, objects, attention])
    } catch {
        fail("vision failed: \(error)", 4)
    }
    if let box = union((faces.results ?? []).map { $0.boundingBox }) {
        printFocus(box, "faces")
        return
    }
    let candidates: [[VNSaliencyImageObservation]?] = [objects.results, attention.results]
    for results in candidates {
        if let box = union((results?.first?.salientObjects ?? []).map { $0.boundingBox }) {
            printFocus(box, "saliency")
            return
        }
    }
    fail("no subject found", 3)
}

func cutout(_ inputPath: String, _ outputPath: String) {
    let image = loadImage(inputPath)
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fail("vision failed: \(error)", 4)
    }
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
        fail("no subject found", 3)
    }
    do {
        let masked = try observation.generateMaskedImage(
            ofInstances: observation.allInstances,
            from: handler,
            croppedToInstancesExtent: true
        )
        let ciImage = CIImage(cvPixelBuffer: masked)
        let context = CIContext()
        let output = URL(fileURLWithPath: outputPath)
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent),
              let destination = CGImageDestinationCreateWithURL(
                  output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            fail("cannot write \(outputPath)", 4)
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        guard CGImageDestinationFinalize(destination) else {
            fail("cannot write \(outputPath)", 4)
        }
    } catch {
        fail("mask failed: \(error)", 4)
    }
}

func boxJson(_ box: CGRect) -> String {
    // 左上角原点的 0 到 1 坐标，x、y 是框的左上角。
    let x = box.minX
    let y = 1 - box.maxY
    return "{\"x\":\(x),\"y\":\(y),\"width\":\(box.width),\"height\":\(box.height)}"
}

// 质检用：一次找出人脸、人体、文字、显著物体，打印 {"faces":[...],"people":[...],"text":[...],"objects":[...]}。
func analyze(_ path: String) {
    let handler = VNImageRequestHandler(cgImage: loadImage(path), options: [:])
    let faces = VNDetectFaceRectanglesRequest()
    let people = VNDetectHumanRectanglesRequest()
    people.upperBodyOnly = false
    // 中文只有 accurate 模式认得出，fast 只认拉丁字母。
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = false
    text.recognitionLanguages = ["zh-Hans", "en-US"]
    let objects = VNGenerateObjectnessBasedSaliencyImageRequest()
    // 人体框检测器会漏掉小的、侧身的人，姿态检测找关节，能补上一部分。
    let poses = VNDetectHumanBodyPoseRequest()
    do {
        try handler.perform([faces, people, text, objects, poses])
    } catch {
        fail("vision failed: \(error)", 4)
    }
    let faceBoxes = (faces.results ?? []).map { boxJson($0.boundingBox) }
    var peopleRects = (people.results ?? []).map { $0.boundingBox }
    for pose in poses.results ?? [] {
        let joints = ((try? pose.recognizedPoints(.all)) ?? [:]).values.filter { $0.confidence > 0.3 }
        guard joints.count >= 4,
              let minX = joints.map({ $0.location.x }).min(), let maxX = joints.map({ $0.location.x }).max(),
              let minY = joints.map({ $0.location.y }).min(), let maxY = joints.map({ $0.location.y }).max() else { continue }
        // 关节框比人窄，四周各放大两成才包住头和手脚。
        let w = maxX - minX, h = maxY - minY
        peopleRects.append(CGRect(x: minX - w * 0.2, y: minY - h * 0.2, width: w * 1.4, height: h * 1.4))
    }
    let peopleBoxes = peopleRects.map { boxJson($0) }
    // 置信度太低的「字」多半是纹理，不算。
    let textBoxes = (text.results ?? [])
        .filter { ($0.topCandidates(1).first?.confidence ?? 0) >= 0.5 }
        .map { boxJson($0.boundingBox) }
    let objectBoxes = (objects.results?.first?.salientObjects ?? []).map { boxJson($0.boundingBox) }
    print("{\"faces\":[\(faceBoxes.joined(separator: ","))],\"people\":[\(peopleBoxes.joined(separator: ","))],\"text\":[\(textBoxes.joined(separator: ","))],\"objects\":[\(objectBoxes.joined(separator: ","))]}")
}

if args.count == 4 && args[1] == "cutout" {
    cutout(args[2], args[3])
} else if args.count == 3 && args[1] == "focus" {
    focus(args[2])
} else if args.count == 3 && args[1] == "analyze" {
    analyze(args[2])
} else {
    fail("usage: vision cutout <input> <output.png> | vision focus <input> | vision analyze <input>", 2)
}

