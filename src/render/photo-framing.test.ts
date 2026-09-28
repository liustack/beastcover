import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { lookupCommandOnPath } from '../doctor.ts';
import { stakesLayout } from '../genres/face.ts';
import type { Rect } from '../platforms/index.ts';
import { attentionFocus } from '../subject/focus.ts';
import { visionFocus } from '../subject/vision.ts';
import { customLayout, familyLayout } from './layout.ts';
import {
    framePhoto,
    photoFocusTarget,
    photoTextLayout,
    placeWindow,
    preparePhotoLayer,
} from './photo-cover.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function tempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-framing-'));
    tempDirectories.push(directory);
    return directory;
}

/** 1600x900 的灰图，(200..400, 350..550) 是一块纯红，当作照片主体 */
async function photoWithRedBlock(): Promise<string> {
    const path = join(tempDir(), 'photo.png');
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#808080' } })
        .composite([
            {
                input: {
                    create: { width: 200, height: 200, channels: 3, background: '#ff0000' },
                },
                left: 200,
                top: 350,
            },
        ])
        .png()
        .toFile(path);
    return path;
}

async function redCentre(dataUri: string): Promise<{ x: number; y: number; width: number }> {
    const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < info.height; y += 2) {
        for (let x = 0; x < info.width; x += 2) {
            const i = (y * info.width + x) * info.channels;
            if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 255) < 80) {
                sumX += x;
                sumY += y;
                count += 1;
            }
        }
    }
    return { x: sumX / count / info.width, y: sumY / count / info.height, width: info.width };
}

describe('photo framing', () => {
    it('places the crop window so the focus lands on the target and stays in the photo', () => {
        // 主体在 300，窗口 800，想让主体落在窗口 72% 处：窗口起点应是 300-576，出界后夹到 0。
        expect(
            placeWindow({
                source: 1600,
                window: 800,
                focusCenter: 300,
                focusSize: 200,
                target: 0.72,
            }),
        ).toBe(0);
        // 主体在 1300，放在 72% 处：起点 1300-576=724，不出界。
        expect(
            placeWindow({
                source: 1600,
                window: 800,
                focusCenter: 1300,
                focusSize: 200,
                target: 0.72,
            }),
        ).toBe(724);
        // 主体范围 400 宽，目标 95% 会切掉主体右半，起点夹到让主体整段留在窗口里：1500-800=700。
        expect(
            placeWindow({
                source: 1600,
                window: 800,
                focusCenter: 1300,
                focusSize: 400,
                target: 0.95,
            }),
        ).toBe(700);
    });

    it('keeps the window inside a subject that is bigger than the window', () => {
        // 主体 30 到 402（372 长），窗口只有 370：目标把窗口推到 0 会一边露空一边切主体，
        // 夹回主体里面，起点落在 30 到 32 之间。
        const start = placeWindow({
            source: 600,
            window: 370,
            focusCenter: 216,
            focusSize: 372,
            target: 0.66,
        });
        expect(start).toBeGreaterThanOrEqual(30);
        expect(start + 370).toBeLessThanOrEqual(402);
    });

    it('keeps the focus inside the visible part of the window when the photo allows it', () => {
        // 窗口 1920 宽，只有 0.275 到 0.725 这段会被公众号看到。主体在 3000，目标 0.64 时起点 1771，
        // 主体落在窗口的 1229 处，在可见段里。
        expect(
            placeWindow({
                source: 4000,
                window: 1920,
                focusCenter: 3000,
                focusSize: 100,
                target: 0.64,
                visible: [0.275, 0.725],
            }),
        ).toBe(1771);
        // 目标在可见段外（0.95）时，改成让主体贴着可见段的边。
        expect(
            placeWindow({
                source: 4000,
                window: 1920,
                focusCenter: 3000,
                focusSize: 100,
                target: 0.95,
                visible: [0.275, 0.725],
            }),
        ).toBe(3050 - Math.round(0.725 * 1920));
    });

    it('reports when the photo cannot move far enough to show its focus', () => {
        // 1920x368 的照片正好铺满超宽母版，窗口挪不动，主体在最右边，公众号看不到。
        const framed = framePhoto({
            source: { width: 1920, height: 368 },
            canvas: { width: 1920, height: 368 },
            focus: { x: 0.9, y: 0.5, width: 0.07, height: 0.4, source: 'attention' },
            target: { x: 0.64, y: 0.45 },
            visible: { x: 0.275, y: 0, width: 0.45, height: 1 },
        });
        expect(framed.focusVisible).toBe(false);
        // 照片比母版宽一倍，窗口能左右挪，主体就能挪进可见段。
        const roomy = framePhoto({
            source: { width: 8000, height: 768 },
            canvas: { width: 1920, height: 368 },
            focus: { x: 0.7, y: 0.5, width: 0.03, height: 0.3, source: 'attention' },
            target: { x: 0.64, y: 0.45 },
            visible: { x: 0.275, y: 0, width: 0.45, height: 1 },
        });
        expect(roomy.focusVisible).toBe(true);
    });

    it('puts the sharp extend photo inside the visible area', async () => {
        // 超宽照片，红块在右边 x≈0.88。公众号只看得到中间 0.275 到 0.725。
        const path = join(tempDir(), 'wide.png');
        await sharp({ create: { width: 1920, height: 368, channels: 3, background: '#808080' } })
            .composite([
                {
                    input: {
                        create: { width: 140, height: 140, channels: 3, background: '#ff0000' },
                    },
                    left: 1630,
                    top: 114,
                },
            ])
            .png()
            .toFile(path);
        const layer = await preparePhotoLayer(path, 1920, 368, {
            fit: 'extend',
            focus: { x: 0.885, y: 0.5, width: 0.07, height: 0.38, source: 'attention' },
            target: { x: 0.64, y: 0.45 },
            visible: { x: 0.275, y: 0, width: 0.45, height: 1 },
        });
        // 模糊背景里也留着一点红，只数可见段里的清晰红块。
        const bytes = Buffer.from(layer.dataUri.slice(layer.dataUri.indexOf(',') + 1), 'base64');
        const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        let inside = 0;
        for (let y = 0; y < info.height; y += 1) {
            for (
                let x = Math.round(0.275 * info.width);
                x < Math.round(0.725 * info.width);
                x += 1
            ) {
                const i = (y * info.width + x) * info.channels;
                if ((data[i] ?? 0) > 230 && (data[i + 1] ?? 255) < 40) {
                    inside += 1;
                }
            }
        }
        expect(inside).toBeGreaterThan(1000);
        // 整张放进来也记下主体落在哪，质检照样核对：照片缩到 864 宽、贴在 528 处，
        // 主体中心在 528 + 0.885 x 864。
        const box = layer.focusBox as { x: number; width: number };
        expect(box.x + box.width / 2).toBeCloseTo((528 + 0.885 * 864) / 1920, 3);
        expect(box.width).toBeCloseTo((0.07 * 864) / 1920, 3);
    });

    it('moves the focus toward the target instead of cropping around the centre', async () => {
        const path = await photoWithRedBlock();
        const focus = {
            x: 300 / 1600,
            y: 450 / 900,
            width: 0.125,
            height: 0.22,
            source: 'attention' as const,
        };

        // 竖版要一个 9:16 的窄窗口，默认居中会把左边的红块整个裁掉。
        const framed = await preparePhotoLayer(path, 360, 640, {
            focus,
            target: { x: 0.5, y: 0.3 },
        });
        const centre = await redCentre(framed.dataUri);
        expect(centre.x).toBeCloseTo(0.5, 1);
        expect(centre.y).toBeCloseTo(0.5, 1);
    });

    it('keeps the whole photo with extend and fills the rest with a blurred copy', async () => {
        const path = await photoWithRedBlock();
        const layer = await preparePhotoLayer(path, 360, 640, { fit: 'extend' });
        const bytes = Buffer.from(layer.dataUri.slice(layer.dataUri.indexOf(',') + 1), 'base64');
        const meta = await sharp(bytes).metadata();
        expect([meta.width, meta.height]).toEqual([360, 640]);
        // 整张 16:9 照片缩到 360 宽放在中间，红块中心在照片的 (0.1875, 0.5)。
        const centre = await redCentre(layer.dataUri);
        expect(centre.x).toBeCloseTo(0.1875, 1);
    });

    it('puts the photo focus away from the headline in each family', () => {
        expect(photoFocusTarget(familyLayout('landscape'), false)).toEqual({ x: 0.7, y: 0.3 });
        expect(photoFocusTarget(familyLayout('portrait'), false)).toEqual({ x: 0.5, y: 0.3 });
        expect(photoFocusTarget(familyLayout('ultrawide'), false)).toEqual({ x: 0.7, y: 0.3 });
        expect(photoFocusTarget(customLayout(900, 1600), false)).toEqual({ x: 0.5, y: 0.3 });
    });

    it("puts the scene's subject at the person's shoulder, clear of the words", () => {
        for (const family of ['landscape', 'ultrawide', 'portrait'] as const) {
            const layout = stakesLayout(familyLayout(family));
            const person = layout.subjectArea;
            if (person === undefined) {
                throw new Error(`${family} stakes layout has no subject area`);
            }
            const target = photoFocusTarget(layout, true);
            const point = { x: target.x * layout.width, y: target.y * layout.height };
            const inside = (area: Rect) =>
                point.x >= area.x &&
                point.x <= area.x + area.width &&
                point.y >= area.y &&
                point.y <= area.y + area.height;
            expect(inside(person), family).toBe(true);
            expect(inside(layout.textArea), family).toBe(false);
        }
        // 竖版人在字下面：主体左右对准人物区中线。
        const portrait = stakesLayout(familyLayout('portrait'));
        const area = portrait.subjectArea;
        if (area === undefined) {
            throw new Error('portrait stakes layout has no subject area');
        }
        expect(photoFocusTarget(portrait, true).x * portrait.width).toBeCloseTo(
            area.x + area.width / 2,
        );
        expect(() => photoFocusTarget(familyLayout('landscape'), true)).toThrow(
            'needs a subject area',
        );
    });

    it('zooms a photo that cannot slide far enough, never past maxZoom', () => {
        // 3:2 的照片铺 16:9 画布，横向用满，窗口挪不动：主体在 0.44，想落到 0.655 只能放大。
        const source = { width: 1024, height: 681 };
        const canvas = { width: 1920, height: 1080 };
        const focus = { x: 0.44, y: 0.5, width: 0.1, height: 0.1, source: 'saliency' as const };
        const target = { x: 0.655, y: 0.5 };
        const landed = (framed: { left: number; width: number }) =>
            (focus.x * source.width - framed.left) / framed.width;

        expect(framePhoto({ source, canvas, focus, target }).width).toBe(1024);
        const zoomed = framePhoto({ source, canvas, focus, target, maxZoom: 1.5 });
        expect(Math.abs(landed(zoomed) - target.x)).toBeLessThan(0.02);
        expect(zoomed.width).toBeGreaterThanOrEqual(Math.floor(1024 / 1.5));
        const capped = framePhoto({ source, canvas, focus, target, maxZoom: 1.2 });
        expect(capped.width).toBe(Math.round(1024 / 1.2));
        // 不放大就到得了，就不放大。
        const easy = framePhoto({
            source,
            canvas,
            focus,
            target: { x: 0.44, y: 0.5 },
            maxZoom: 1.5,
        });
        expect(easy.width).toBe(1024);
    });

    it('keeps photo cover headlines in the lower half of the text area', () => {
        const landscape = familyLayout('landscape');
        const lowered = photoTextLayout(landscape);
        expect(lowered.textArea.y + lowered.textArea.height).toBe(
            landscape.textArea.y + landscape.textArea.height,
        );
        expect(lowered.textArea.height).toBe(Math.round(landscape.textArea.height / 2));
        // 主体目标点落在标题区上方，超宽也一样。
        for (const family of [landscape, familyLayout('ultrawide')]) {
            expect(photoFocusTarget(family, false).y * family.height).toBeLessThan(
                photoTextLayout(family).textArea.y,
            );
        }
        const portrait = familyLayout('portrait');
        expect(photoFocusTarget(portrait, false).y * portrait.height).toBeLessThan(
            photoTextLayout(portrait).textArea.y,
        );
    });

    it('finds a striking block with sharp attention on any system', async () => {
        const focus = await attentionFocus(await photoWithRedBlock());
        expect(focus.source).toBe('attention');
        expect(focus.x).toBeGreaterThan(0.1);
        expect(focus.x).toBeLessThan(0.3);
        expect(focus.y).toBeGreaterThan(0.35);
        expect(focus.y).toBeLessThan(0.65);
    });

    it.runIf(process.platform === 'darwin' && lookupCommandOnPath('swiftc') !== undefined)(
        'reports Vision focus in the upright frame of an EXIF-rotated photo',
        async () => {
            // 横图的左边有红块，EXIF 标 6 摆正后红块跑到上方，主体中心的 y 应该偏小、x 居中。
            const path = join(tempDir(), 'rotated.jpg');
            await sharp(await photoWithRedBlock())
                .jpeg()
                .withMetadata({ orientation: 6 })
                .toFile(path);
            const focus = await visionFocus(path, {
                platform: 'darwin',
                binDir: join(tempDir(), 'bin'),
                lookupCommand: lookupCommandOnPath,
            });
            expect(focus?.y ?? 1).toBeLessThan(0.4);
            expect(focus?.x ?? 0).toBeGreaterThan(0.3);
            expect(focus?.x ?? 1).toBeLessThan(0.7);
        },
        240_000,
    );

    it.runIf(process.platform === 'darwin' && lookupCommandOnPath('swiftc') !== undefined)(
        'finds the salient block with macOS Vision',
        async () => {
            const focus = await visionFocus(await photoWithRedBlock(), {
                platform: 'darwin',
                binDir: join(tempDir(), 'bin'),
                lookupCommand: lookupCommandOnPath,
            });
            expect(focus?.source).toBe('saliency');
            expect(focus?.x ?? 0).toBeLessThan(0.45);
        },
        240_000,
    );
});
