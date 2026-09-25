// macOS 自带的主体抠图（Vision 的前景实例遮罩，macOS 14 起可用）。
// 不打包模型、不联网：第一次用时把下面这段 Swift 编译成小程序放进 ~/.beastcover/bin/，之后直接调用。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const VISION_CUTOUT_SWIFT = String.raw`import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

// 用法：cutout <输入图片> <输出 PNG>。退出码 2 参数错，3 没找到主体，4 读写失败。
let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: cutout <input> <output.png>\n".data(using: .utf8)!)
    exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write("cannot read \(input.path)\n".data(using: .utf8)!)
    exit(4)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(4)
}
guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
    FileHandle.standardError.write("no subject found\n".data(using: .utf8)!)
    exit(3)
}

do {
    let masked = try observation.generateMaskedImage(
        ofInstances: observation.allInstances,
        from: handler,
        croppedToInstancesExtent: true
    )
    let ciImage = CIImage(cvPixelBuffer: masked)
    let context = CIContext()
    guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent),
          let destination = CGImageDestinationCreateWithURL(
              output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        FileHandle.standardError.write("cannot write \(output.path)\n".data(using: .utf8)!)
        exit(4)
    }
    CGImageDestinationAddImage(destination, cgImage, nil)
    guard CGImageDestinationFinalize(destination) else {
        FileHandle.standardError.write("cannot write \(output.path)\n".data(using: .utf8)!)
        exit(4)
    }
} catch {
    FileHandle.standardError.write("mask failed: \(error)\n".data(using: .utf8)!)
    exit(4)
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
    const hash = createHash('sha256').update(VISION_CUTOUT_SWIFT).digest('hex').slice(0, 12);
    return join(binDir, `vision-cutout-${hash}`);
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
    writeFileSync(source, VISION_CUTOUT_SWIFT, 'utf8');
    try {
        await execFileAsync(swiftc, ['-O', '-o', building, source], {
            timeout: COMPILE_TIMEOUT_MS,
        });
        chmodSync(building, 0o755);
        renameSync(building, path);
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
        await execFileAsync(tool, [inputPath, outputPath], { timeout: CUTOUT_TIMEOUT_MS });
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
