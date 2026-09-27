import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 中间产物一律进系统临时目录：下载的图库照片、模型原图、抠图缓存。
 * 项目目录零残留（用完即走），沙箱 agent（codex workspace-write）也必然可写，
 * 系统自己清理。真想留的文件由 agent 拷去它该在的地方。
 */
export function tempRoot(): string {
    return join(tmpdir(), 'beastcover');
}

export function tempRefsDir(): string {
    return join(tempRoot(), 'refs');
}

export function tempCacheDir(): string {
    return join(tempRoot(), 'cache');
}

/**
 * 每次运行一个独立暂存子目录。不同目录同时出图时各写各的，
 * 全局同名文件会互相覆盖（两个任务的封面都变成后写的那张）。
 */
export function newRunDir(): string {
    mkdirSync(tempCacheDir(), { recursive: true });
    return mkdtempSync(join(tempCacheDir(), 'run-'));
}
