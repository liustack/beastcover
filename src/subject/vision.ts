// macOS 自带的 Vision：主体抠图（前景实例遮罩，macOS 14 起可用）和照片主体定位（人脸，其次显著区域）。
// 不打包模型、不联网：第一次用时把下面这段 Swift 编译成小程序放进 ~/.beastcover/bin/，之后直接调用。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const VISION_TOOL_SWIFT = String.raw`import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// 用法：
//   vision cutout <输入图片> <输出 PNG>   抠出前景主体
//   vision focus <输入图片>              打印主体中心的 JSON：有人脸按人脸，没有按显著区域
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
    let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
    do {
        try handler.perform([faces, saliency])
    } catch {
        fail("vision failed: \(error)", 4)
    }
    if let box = union((faces.results ?? []).map { $0.boundingBox }) {
        printFocus(box, "faces")
        return
    }
    let salient = (saliency.results?.first?.salientObjects ?? []).map { $0.boundingBox }
    if let box = union(salient) {
        printFocus(box, "saliency")
        return
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
`;

// 退出码约定见 Swift 源码第一行注释。
const NO_SUBJECT_EXIT = 3;
const CUTOUT_TIMEOUT_MS = 60_000;
const COMPILE_TIMEOUT_MS = 180_000;

export class NoSubjectFoundError extends Error {}

export interface VisionCutoutRuntime {
    platform: NodeJS.Platform;
    /** 放编译好的抠图小程序，通常是 ~/.beastcover/bin */
    binDir: string;
    lookupCommand: (name: string) => string | undefined;
    /** Darwin 内核版本，默认取本机。macOS 14 对应 Darwin 23 */
    osRelease?: string;
}

const MIN_DARWIN_MAJOR = 23;

function toolPath(binDir: string): string {
    const hash = createHash('sha256').update(VISION_TOOL_SWIFT).digest('hex').slice(0, 12);
    return join(binDir, `vision-tool-${hash}`);
}

/** 抠图不可用时返回原因，可用时返回 undefined */
export function visionCutoutUnavailable(runtime: VisionCutoutRuntime): string | undefined {
    const darwinMajor = Number.parseInt((runtime.osRelease ?? release()).split('.')[0] ?? '', 10);
    if (runtime.platform !== 'darwin' || !(darwinMajor >= MIN_DARWIN_MAJOR)) {
        return 'automatic cutout needs macOS 14 or newer';
    }
    if (!existsSync(toolPath(runtime.binDir)) && runtime.lookupCommand('swiftc') === undefined) {
        return 'automatic cutout needs the Swift compiler. Run xcode-select --install';
    }
    return undefined;
}

async function ensureTool(runtime: VisionCutoutRuntime): Promise<string> {
    const path = toolPath(runtime.binDir);
    if (existsSync(path)) {
        return path;
    }
    const swiftc = runtime.lookupCommand('swiftc');
    if (swiftc === undefined) {
        throw new Error('Automatic cutout needs the Swift compiler. Run xcode-select --install.');
    }
    mkdirSync(runtime.binDir, { recursive: true, mode: 0o700 });
    const source = `${path}.swift`;
    const building = `${path}.building`;
    writeFileSync(source, VISION_TOOL_SWIFT, 'utf8');
    try {
        await execFileAsync(swiftc, ['-O', '-o', building, source], {
            timeout: COMPILE_TIMEOUT_MS,
        });
        chmodSync(building, 0o755);
        renameSync(building, path);
        // 源码变了才会编新版本，旧版本的小程序不会再用，一起清掉。
        for (const name of readdirSync(runtime.binDir)) {
            const stale = join(runtime.binDir, name);
            if (/^vision-(cutout|tool)-[0-9a-f]+$/.test(name) && stale !== path) {
                rmSync(stale, { force: true });
            }
        }
    } catch (error) {
        rmSync(building, { force: true });
        const detail = (error as { stderr?: string }).stderr?.trim() || String(error);
        throw new Error(`Could not build the macOS cutout tool: ${detail}`);
    } finally {
        rmSync(source, { force: true });
    }
    return path;
}

/** 把 inputPath 里的主体抠成透明 PNG 写到 outputPath */
export async function visionCutout(
    inputPath: string,
    outputPath: string,
    runtime: VisionCutoutRuntime,
): Promise<void> {
    const unavailable = visionCutoutUnavailable(runtime);
    if (unavailable !== undefined) {
        throw new Error(`${inputPath} has no transparent background, and ${unavailable}.`);
    }
    const tool = await ensureTool(runtime);
    try {
        await execFileAsync(tool, ['cutout', inputPath, outputPath], {
            timeout: CUTOUT_TIMEOUT_MS,
        });
    } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        if (failure.code === NO_SUBJECT_EXIT) {
            throw new NoSubjectFoundError(`No person or object stands out in ${inputPath}.`);
        }
        throw new Error(
            `macOS cutout failed for ${inputPath}: ${failure.stderr?.trim() || String(error)}`,
        );
    }
}

export interface PhotoFocus {
    /** 主体中心在图里的位置，0 到 1，原点在左上角 */
    x: number;
    y: number;
    /** 主体范围的宽高，同样是 0 到 1 */
    width: number;
    height: number;
    source: 'faces' | 'saliency' | 'attention';
}

/** 用 Vision 找照片主体：有人脸按人脸，没有按显著区域。什么都没找到返回 undefined */
export async function visionFocus(
    inputPath: string,
    runtime: VisionCutoutRuntime,
): Promise<PhotoFocus | undefined> {
    const unavailable = visionCutoutUnavailable(runtime);
    if (unavailable !== undefined) {
        throw new Error(`Vision focus is unavailable: ${unavailable}.`);
    }
    const tool = await ensureTool(runtime);
    try {
        const { stdout } = await execFileAsync(tool, ['focus', inputPath], {
            timeout: CUTOUT_TIMEOUT_MS,
        });
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const numbers = ['x', 'y', 'width', 'height'].map((key) => parsed[key]);
        if (
            numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value)) ||
            (parsed.source !== 'faces' && parsed.source !== 'saliency')
        ) {
            throw new Error(`Unexpected focus output: ${stdout.trim()}`);
        }
        const [x, y, width, height] = numbers as [number, number, number, number];
        return { x, y, width, height, source: parsed.source };
    } catch (error) {
        if ((error as { code?: number }).code === NO_SUBJECT_EXIT) {
            return undefined;
        }
        throw error;
    }
}
