// 二创的输入把关：只把用户自己的图，或 cc0/pdm 的图库照片交给模型重绘。
// 图旁边有 stock 下载留下的来源记录时，按记录里的授权判断。
import { existsSync, readFileSync } from 'node:fs';
import type { RemixMode } from './prompt.ts';

const REDRAWABLE_LICENSES = new Set(['cc0', 'pdm']);

export function remixModeFor(paths: readonly string[]): RemixMode {
    if (paths.length === 1) {
        return 'restyle';
    }
    if (paths.length === 2) {
        return 'place';
    }
    throw new Error('--remix takes one image to redraw, or two: the person first, then the scene.');
}

export function assertRedrawable(imagePath: string): void {
    const sidecar = `${imagePath}.json`;
    if (!existsSync(sidecar)) {
        // 没有来源记录，当作用户自己的图。
        return;
    }
    let record: { provider?: unknown; license?: unknown };
    try {
        record = JSON.parse(readFileSync(sidecar, 'utf8')) as typeof record;
    } catch {
        throw new Error(`${sidecar} is not valid JSON, so the photo's license is unknown.`);
    }
    if (
        record.provider !== 'openverse' ||
        typeof record.license !== 'string' ||
        !REDRAWABLE_LICENSES.has(record.license)
    ) {
        throw new Error(
            `${imagePath} came from ${String(record.provider)} under "${String(record.license)}". --remix only redraws your own images or cc0/pdm photos.`,
        );
    }
}
