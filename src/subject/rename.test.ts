import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 只在这个文件里劫持 renameSync：并发抠图的缓存 rename 在 Windows 上会报 EPERM，
// 其他错误码必须照抛，不能因为对方写好了缓存就吞掉真实 I/O 故障。
const control = vi.hoisted(() => ({ renameError: undefined as NodeJS.ErrnoException | undefined }));

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        renameSync: (from: string, to: string) => {
            if (control.renameError !== undefined) {
                const error = control.renameError;
                control.renameError = undefined;
                // 模拟对方已把缓存写好：先真的放一份，再抛错。
                actual.copyFileSync(from, to);
                throw error;
            }
            actual.renameSync(from, to);
        },
    };
});

import { prepareSubject } from './index.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    control.renameError = undefined;
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function errnoError(code: string): NodeJS.ErrnoException {
    const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
    error.code = code;
    return error;
}

async function setup(): Promise<{
    photo: string;
    cacheDir: string;
    cutout: (i: string, o: string) => Promise<void>;
}> {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-rename-'));
    tempDirectories.push(directory);
    const photo = join(directory, 'photo.jpg');
    await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
        .jpeg()
        .toFile(photo);
    const cutout = async (input: string, output: string) => {
        await sharp(input).ensureAlpha().png().toFile(output);
    };
    return { photo, cacheDir: join(directory, 'cache'), cutout };
}

describe('cutout cache rename', () => {
    it('reuses the twin cache on EPERM but rethrows other errors', async () => {
        const { photo, cacheDir, cutout } = await setup();

        control.renameError = errnoError('EPERM');
        await expect(prepareSubject(photo, { cacheDir, cutout })).resolves.toMatchObject({
            method: 'macos-vision',
        });

        rmSync(cacheDir, { recursive: true, force: true });
        control.renameError = errnoError('EIO');
        await expect(prepareSubject(photo, { cacheDir, cutout })).rejects.toThrowError(
            'injected EIO',
        );
        expect(readdirSync(cacheDir).filter((name) => name.includes('partial'))).toEqual([]);
    });
});
