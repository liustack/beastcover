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
