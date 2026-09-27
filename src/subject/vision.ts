// macOS 自带的 Vision：主体抠图（前景实例遮罩，macOS 14 起可用）和照片主体定位（人脸，其次显著区域）。
// 不打包模型、不联网：第一次用时把下面这段 Swift 编译成小程序放进 ~/.beastcover/bin/，之后直接调用。
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

import VISION_TOOL_SWIFT from '../../skills/beastcover/scripts/vision-tool.swift?raw';

export { VISION_TOOL_SWIFT };

// 退出码约定见 Swift 源码第一行注释。
const NO_SUBJECT_EXIT = 3;
const CUTOUT_TIMEOUT_MS = 60_000;
const COMPILE_TIMEOUT_MS = 180_000;

export class NoSubjectFoundError extends Error {}

export interface VisionCutoutRuntime {
    platform: NodeJS.Platform;
    /** 放编译好的抠图小程序，通常是 ~/.beastcover/bin */
    binDir: string;
    /** binDir 建不了（codex 这类沙箱写不进 home）时的退路，默认系统临时目录 */
    fallbackBinDir?: string;
    /** 降级时说一声，并告诉 agent 怎么替用户申请持久权限。不给就不出声 */
    note?: (line: string) => void;
    lookupCommand: (name: string) => string | undefined;
    /** Darwin 内核版本，默认取本机。macOS 14 对应 Darwin 23 */
    osRelease?: string;
}

const MIN_DARWIN_MAJOR = 23;

function toolPath(binDir: string): string {
    const hash = createHash('sha256').update(VISION_TOOL_SWIFT).digest('hex').slice(0, 12);
    return join(binDir, `vision-tool-${hash}`);
}

function binDirCandidates(runtime: VisionCutoutRuntime): string[] {
    return [runtime.binDir, runtime.fallbackBinDir ?? join(tmpdir(), 'beastcover', 'bin')];
}

/** 抠图不可用时返回原因，可用时返回 undefined */
export function visionCutoutUnavailable(runtime: VisionCutoutRuntime): string | undefined {
    const darwinMajor = Number.parseInt((runtime.osRelease ?? release()).split('.')[0] ?? '', 10);
    if (runtime.platform !== 'darwin' || !(darwinMajor >= MIN_DARWIN_MAJOR)) {
        return 'automatic cutout needs macOS 14 or newer';
    }
    const built = binDirCandidates(runtime).some((dir) => existsSync(toolPath(dir)));
    if (!built && runtime.lookupCommand('swiftc') === undefined) {
        return 'automatic cutout needs the Swift compiler. Run xcode-select --install';
    }
    return undefined;
}

/** 只把权限类失败当「这个目录用不了」，磁盘满、编译错这类问题照抛 */
function isPermissionError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EROFS';
}

async function ensureTool(runtime: VisionCutoutRuntime): Promise<string> {
    const candidates = binDirCandidates(runtime);
    for (const dir of candidates) {
        if (existsSync(toolPath(dir))) {
            return toolPath(dir);
        }
    }
    const swiftc = runtime.lookupCommand('swiftc');
    if (swiftc === undefined) {
        throw new Error('Automatic cutout needs the Swift compiler. Run xcode-select --install.');
    }
    // 首选 ~/.beastcover/bin：一次编译永久复用。沙箱写不进 home 就退到临时目录，
    // 代价只是临时目录被系统清理后重编一次（约 2.5 秒）。
    for (const [index, dir] of candidates.entries()) {
        const path = toolPath(dir);
        // 源码和编译中的文件名带上随机后缀，几个进程同时首次编译也不会互相踩文件。
        const attempt = randomUUID();
        const source = `${path}.${attempt}.swift`;
        const building = `${path}.${attempt}.building`;
        try {
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            writeFileSync(source, VISION_TOOL_SWIFT, 'utf8');
        } catch (error) {
            if (isPermissionError(error) && index < candidates.length - 1) {
                runtime.note?.(
                    `Cutout tool: ${dir} is not writable in this sandbox, using the temp dir for now. To cache the tool permanently, allow writes to ${dir} (codex: add it to sandbox_workspace_write.writable_roots) or run one cutout outside the sandbox.`,
                );
                continue;
            }
            throw error;
        }
        try {
            await execFileAsync(swiftc, ['-O', '-o', building, source], {
                timeout: COMPILE_TIMEOUT_MS,
            });
            chmodSync(building, 0o755);
            renameSync(building, path);
            // 源码变了才会编新版本，旧版本的小程序不会再用，一起清掉。
            for (const name of readdirSync(dir)) {
                const stale = join(dir, name);
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
    throw new Error('Could not create a directory for the macOS cutout tool.');
}

/**
 * Vision 读的是原始像素，不看 EXIF 方向，而合成时 sharp 会按方向把照片转正。
 * 带方向标记的图先转正成一份临时 PNG 再交给 Vision，两边就在同一个坐标系里。
 */
async function withUprightImage<T>(
    inputPath: string,
    run: (uprightPath: string) => Promise<T>,
): Promise<T> {
    const meta = await sharp(inputPath, { failOn: 'error' }).metadata();
    if (meta.orientation === undefined || meta.orientation === 1) {
        return run(inputPath);
    }
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-upright-'));
    try {
        const upright = join(directory, 'upright.png');
        await sharp(inputPath, { failOn: 'error' }).rotate().png().toFile(upright);
        return await run(upright);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

/** 把 inputPath 里的主体抠成透明 PNG 写到 outputPath，方向按 EXIF 转正 */
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
        await withUprightImage(inputPath, (upright) =>
            execFileAsync(tool, ['cutout', upright, outputPath], {
                timeout: CUTOUT_TIMEOUT_MS,
            }),
        );
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

/** 用 Vision 找照片主体：有人脸按人脸，没有按显著区域，坐标按转正后的照片算。什么都没找到返回 undefined */
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
        const { stdout } = await withUprightImage(inputPath, (upright) =>
            execFileAsync(tool, ['focus', upright], { timeout: CUTOUT_TIMEOUT_MS }),
        );
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
