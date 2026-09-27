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

if args.count == 4 && args[1] == "cutout" {
    cutout(args[2], args[3])
} else if args.count == 3 && args[1] == "focus" {
    focus(args[2])
} else {
    fail("usage: vision cutout <input> <output.png> | vision focus <input>", 2)
}

