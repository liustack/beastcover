import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { lookupCommandOnPath } from '../doctor.ts';
import { attentionFocus } from '../subject/focus.ts';
import { visionFocus } from '../subject/vision.ts';
import { customLayout, familyLayout } from './layout.ts';
import {
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
        expect(photoFocusTarget(familyLayout('ultrawide'), false)).toEqual({ x: 0.64, y: 0.45 });
        expect(photoFocusTarget(customLayout(900, 1600), false)).toEqual({ x: 0.5, y: 0.3 });
        expect(photoFocusTarget(familyLayout('landscape'), true)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('keeps photo cover headlines in the lower half of the text area', () => {
        const landscape = familyLayout('landscape');
        const lowered = photoTextLayout(landscape);
        expect(lowered.textArea.y + lowered.textArea.height).toBe(
            landscape.textArea.y + landscape.textArea.height,
        );
        expect(lowered.textArea.height).toBe(Math.round(landscape.textArea.height / 2));
        const ultrawide = familyLayout('ultrawide');
        const band = photoTextLayout(ultrawide).textArea;
        expect(band.x).toBe(ultrawide.textArea.x);
        expect(band.width).toBe(Math.round(ultrawide.textArea.width * 0.55));
        expect(photoFocusTarget(ultrawide, false).x * ultrawide.width).toBeGreaterThan(
            band.x + band.width,
        );
        // 主体目标点落在标题区上方。
        const target = photoFocusTarget(landscape, false);
        expect(target.y * landscape.height).toBeLessThan(lowered.textArea.y);
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
