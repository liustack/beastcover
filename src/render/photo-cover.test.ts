import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { familyClearArea, familyCoveredAreas, familyVisibleArea } from '../compose/index.ts';
import {
    FAMILY_NAMES,
    type FamilyName,
    getPlatform,
    PLATFORM_NAMES,
    type Rect,
} from '../platforms/index.ts';
import { type CoverLayout, customLayout, familyLayout } from './layout.ts';
import {
    arrowWings,
    calloutGeometry,
    calloutLayout,
    framedFocusBox,
    photoTextLayout,
    preparePhotoLayer,
} from './photo-cover.ts';

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

async function writeTestPhoto(width: number, height: number): Promise<string> {
    const directory = mkdtempSync(join(tmpdir(), 'beastcover-photo-'));
    tempDirectories.push(directory);
    const path = join(directory, 'photo.png');
    const bytes = await sharp({
        create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
    })
        .png()
        .toBuffer();
    writeFileSync(path, bytes);
    return path;
}

// 某一族按它的全部平台合成时的版式：可见区是裁切框的交集，遮挡区是各平台的界面矩形，
// 和 composeCovers 填的一样。
function familyCoverLayout(family: FamilyName): CoverLayout {
    const members = PLATFORM_NAMES.filter((name) => getPlatform(name).family === family);
    return {
        ...familyLayout(family),
        visibleArea: familyVisibleArea(family, members),
        clearArea: familyClearArea(family, members),
        coveredAreas: familyCoveredAreas(family, members),
    };
}

// 横版：可见区 y 120..1080，遮挡区是 YouTube 时长角标和 B 站底栏。
const landscapeLayout = () => photoTextLayout(familyCoverLayout('landscape'));
// 竖版：可见区是 3:4 裁切框，遮挡区是短视频的顶栏、底栏和右侧按钮列。
const portraitLayout = () => photoTextLayout(familyCoverLayout('portrait'));

/** 线段和矩形是否相交（Liang-Barsky），测试里自己算一遍，不借用实现 */
function segmentCrossesRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: Rect) {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const [p, q] of [
        [-dx, a.x - rect.x],
        [dx, rect.x + rect.width - a.x],
        [-dy, a.y - rect.y],
        [dy, rect.y + rect.height - a.y],
    ]) {
        if (p === 0) {
            if (q < 0) {
                return false;
            }
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) {
                return false;
            }
            t0 = Math.max(t0, t);
        } else {
            if (t < t0) {
                return false;
            }
            t1 = Math.min(t1, t);
        }
    }
    return true;
}

function grow(rect: Rect, pad: number): Rect {
    return {
        x: rect.x - pad,
        y: rect.y - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
    };
}

function inside(point: { x: number; y: number }, rect: Rect): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

describe('callout geometry', () => {
    it('keeps the ring and the arrow inside the visible area and clear of the headline and app UI', () => {
        const layout = landscapeLayout();
        const shape = calloutGeometry(layout, { x: 0.65, y: 0.2, width: 0.1, height: 0.1 });

        const text = layout.textArea;
        const visible = layout.visibleArea as Rect;
        // 圈连白边都在可见区里，而且不碰标题区。
        expect(shape.cx - shape.rx - shape.stroke * 1.1).toBeGreaterThanOrEqual(visible.x);
        expect(shape.cx + shape.rx + shape.stroke * 1.1).toBeLessThanOrEqual(
            visible.x + visible.width,
        );
        expect(shape.cy - shape.ry - shape.stroke * 1.1).toBeGreaterThanOrEqual(visible.y);
        expect(shape.cy + shape.ry + shape.stroke * 1.1).toBeLessThanOrEqual(text.y);
        // 箭头起点在可见区里、不在标题区和遮挡区里，箭杆有长度。
        expect(inside(shape.arrow.start, visible)).toBe(true);
        expect(inside(shape.arrow.start, text)).toBe(false);
        for (const covered of layout.coveredAreas ?? []) {
            expect(inside(shape.arrow.start, covered)).toBe(false);
        }
        expect(
            Math.hypot(shape.arrow.start.x - shape.cx, shape.arrow.start.y - shape.cy),
        ).toBeGreaterThan(Math.max(shape.rx, shape.ry) + shape.stroke * 4);
    });

    it('starts every arrow outside the ring and keeps the whole arrow clear, on a grid of subjects', () => {
        // 320x120 复刻自定义小画布：线宽有下限，白边和翼长不随短边同比缩小。
        const smallCanvas = { x: 0, y: 0, width: 320, height: 120 };
        const smallLayout = {
            ...photoTextLayout(customLayout(320, 120)),
            visibleArea: smallCanvas,
            clearArea: smallCanvas,
            coveredAreas: [],
        };
        for (const [layout, atLeast] of [
            [landscapeLayout(), 100],
            [portraitLayout(), 100],
            [smallLayout, 20],
        ] as const) {
            const blocked = [layout.textArea, ...(layout.coveredAreas ?? [])];
            const visible = layout.visibleArea as Rect;
            let accepted = 0;
            for (let x = 0; x <= 0.9; x += 0.02) {
                for (let y = 0; y <= 0.9; y += 0.02) {
                    for (const [width, height] of [
                        [0.05, 0.05],
                        [0.1, 0.06],
                        [0.06, 0.15],
                        [0.13, 0.13],
                        [0.3, 0.1],
                        [0.4, 0.2],
                    ]) {
                        let shape: ReturnType<typeof calloutGeometry>;
                        try {
                            shape = calloutGeometry(layout, { x, y, width, height });
                        } catch {
                            continue;
                        }
                        accepted += 1;
                        const { cx, cy, rx, ry, stroke, arrow } = shape;
                        const tipGap = stroke * 2.5;
                        const label = `${layout.family} box ${x},${y} ${width}x${height}`;
                        // 起点在箭尖所在的那圈椭圆外面，箭头才是指向红圈的。
                        const outside =
                            ((arrow.start.x - cx) / (rx + tipGap)) ** 2 +
                            ((arrow.start.y - cy) / (ry + tipGap)) ** 2;
                        expect(outside, label).toBeGreaterThan(1);
                        // 箭杆连白边都不碰标题带和遮挡区。
                        const pad = (stroke * 2.2 * 1.3) / 2;
                        for (const rect of blocked) {
                            expect(
                                segmentCrossesRect(arrow.start, arrow.end, grow(rect, pad)),
                                label,
                            ).toBe(false);
                        }
                        // 箭杆、箭尖和两翼连圆头白边完整留在可见区内，不被画布或裁切切掉。
                        const wings = arrowWings(arrow.start, arrow.end, stroke);
                        for (const point of [arrow.start, arrow.end, ...wings]) {
                            expect(point.x, label).toBeGreaterThanOrEqual(visible.x + pad);
                            expect(point.x, label).toBeLessThanOrEqual(
                                visible.x + visible.width - pad,
                            );
                            expect(point.y, label).toBeGreaterThanOrEqual(visible.y + pad);
                            expect(point.y, label).toBeLessThanOrEqual(
                                visible.y + visible.height - pad,
                            );
                        }
                    }
                }
            }
            expect(accepted, layout.family).toBeGreaterThan(atLeast);
        }
    });

    it('refuses a ring that would run into the headline', () => {
        expect(() =>
            calloutGeometry(landscapeLayout(), { x: 0.45, y: 0.35, width: 0.14, height: 0.14 }),
        ).toThrowError(/the red circle would run into the headline/);
    });

    it('refuses a ring that a platform crop would cut', () => {
        expect(() =>
            calloutGeometry(landscapeLayout(), { x: 0.65, y: 0.02, width: 0.1, height: 0.1 }),
        ).toThrowError(/the red circle would be cut off at the edge of the cover/);
    });

    it('refuses a ring under the app buttons', () => {
        expect(() =>
            calloutGeometry(portraitLayout(), { x: 0.8, y: 0.42, width: 0.1, height: 0.05 }),
        ).toThrowError(/the red circle would sit under the app's buttons/);
    });

    it('refuses to draw when no side is clear for the arrow instead of starting it at the subject', () => {
        // 圈落在一个小口袋里：上面贴着可见区顶边，左右和斜上方都被遮挡区堵死，下面是标题区。
        const layout: CoverLayout = {
            ...photoTextLayout(customLayout(1000, 1000)),
            textArea: { x: 0, y: 300, width: 1000, height: 700 },
            visibleArea: { x: 0, y: 0, width: 1000, height: 1000 },
            clearArea: { x: 0, y: 0, width: 1000, height: 1000 },
            coveredAreas: [
                { x: 0, y: 0, width: 400, height: 300 },
                { x: 600, y: 0, width: 400, height: 300 },
            ],
        };
        expect(() =>
            calloutGeometry(layout, { x: 0.47, y: 0.12, width: 0.06, height: 0.06 }),
        ).toThrowError(/there is no clear side to point the arrow from/);
    });

    it('names the covers in the message when told where it is drawing', () => {
        expect(() =>
            calloutGeometry(
                landscapeLayout(),
                { x: 0.45, y: 0.35, width: 0.14, height: 0.14 },
                'youtube, bilibili',
            ),
        ).toThrowError(
            'The callout cannot mark the subject on youtube, bilibili: the red circle would run into the headline. Pick a photo where the subject is small and has empty space around it, or use another --template.',
        );
    });
});

describe('callout layout', () => {
    const photo = { width: 1920, height: 1200 };
    const base = {
        ...familyLayout('landscape'),
        visibleArea: { x: 0, y: 120, width: 1920, height: 960 },
        clearArea: { x: 0, y: 120, width: 1920, height: 936 },
        coveredAreas: [{ x: 1632, y: 1008, width: 288, height: 132 }],
    };

    it('keeps the usual lower-half headline band when the ring sits above it', () => {
        const focus = { x: 0.75, y: 0.25, width: 0.1, height: 0.1, source: 'saliency' as const };
        expect(calloutLayout(base, photo, focus).textArea).toEqual(photoTextLayout(base).textArea);
    });

    it('starts the headline band just below the ring when the subject sits in the middle', () => {
        // 照片和母版一样大挪不动，主体在正中：圈的下沿到 y=690 左右，标题带从它下面开始。
        const focus = { x: 0.48, y: 0.48, width: 0.13, height: 0.14, source: 'saliency' as const };
        const usual = photoTextLayout(base).textArea;
        const layout = calloutLayout(base, photo, focus);
        const band = layout.textArea;
        // 缩过的标题带和圈一起交给几何检查，圈不再压标题。
        const ring = calloutGeometry(layout, framedFocusBox(photo, focus, layout, false));
        expect(band.y).toBeGreaterThan(ring.cy + ring.ry + ring.stroke * 1.1);
        expect(band.y).toBeGreaterThan(usual.y);
        expect(band.y + band.height).toBe(usual.y + usual.height);
        expect(band.x).toBe(usual.x);
        expect(band.width).toBe(usual.width);
    });

    it('refuses when the band left below the ring is shallower than a fifth of the text area', () => {
        const focus = { x: 0.5, y: 0.5, width: 0.3, height: 0.3, source: 'saliency' as const };
        expect(() => calloutLayout(base, photo, focus, 'youtube')).toThrowError(
            'The callout cannot mark the subject on youtube: the red circle would leave no room for the headline below it. Pick a photo where the subject is small and has empty space around it, or use another --template.',
        );
    });
});

describe('photo framing for the callout', () => {
    it('frames by the layout aspect so the focus box matches the pre-render check at any scale', async () => {
        // 1200x641 进 16:10 母版时窗口宽度落在 1025.6 附近，像素画布取整后的比例会把它推到 1025 或 1026。
        const source = await writeTestPhoto(1200, 641);
        const photo = { width: 1200, height: 641 };
        const focus = { x: 0.62, y: 0.41, width: 0.13, height: 0.14, source: 'saliency' as const };
        for (const family of FAMILY_NAMES) {
            const layout = photoTextLayout(familyCoverLayout(family));
            const expected = framedFocusBox(photo, focus, layout, false);
            for (const scale of [1, 1.003, 1.013, 2.37, 3.043]) {
                const layer = await preparePhotoLayer(
                    source,
                    Math.round(layout.width * scale),
                    Math.round(layout.height * scale),
                    {
                        focus,
                        target: { x: 0.7, y: 0.3 },
                        canvas: { width: layout.width, height: layout.height },
                        visible: {
                            x: (layout.visibleArea as Rect).x / layout.width,
                            y: (layout.visibleArea as Rect).y / layout.height,
                            width: (layout.visibleArea as Rect).width / layout.width,
                            height: (layout.visibleArea as Rect).height / layout.height,
                        },
                    },
                );
                if (family === 'portrait') {
                    // 竖版的目标点是 (0.5, 0.3)，这里只核对横向目标一致的两族。
                    continue;
                }
                expect(layer.focusBox, `${family} at ${scale}x`).toEqual(expected);
            }
        }
        // 遍历三族多档 scale 的真渲染是套件里最重的用例，机器被其他会话占满时 30 秒不够。
    }, 90_000);
});
