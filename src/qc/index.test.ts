import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
    checkBrightness,
    checkColourfulness,
    checkContrast,
    checkEdges,
    checkOverlaps,
    checkSubjects,
    clearCrop,
    colourfulness,
    formatFindings,
    maskFromRects,
    type QcFinding,
    textMaskFrom,
    textOnPicture,
} from './index.ts';

const MASTER = { width: 1920, height: 1200 };
const mask = (rects: { x: number; y: number; width: number; height: number }[]) =>
    maskFromRects(MASTER.width, MASTER.height, rects);
const FULL = { x: 0, y: 0, width: 1920, height: 1200 };
const NOTHING = { faces: [], people: [], text: [], objects: [] };

describe('headline overlaps', () => {
    it('fails when the headline covers a face, a person, text in the picture, or its subject', () => {
        const headline = [{ x: 200, y: 700, width: 1000, height: 300 }];
        const findings = checkOverlaps({
            platform: 'youtube',
            crop: FULL,
            text: mask(headline),
            contents: {
                faces: [{ x: 0.3, y: 0.6, width: 0.05, height: 0.08 }],
                people: [{ x: 0.25, y: 0.5, width: 0.1, height: 0.4 }],
                text: [{ x: 0.12, y: 0.62, width: 0.3, height: 0.05 }],
                objects: [{ x: 0.2, y: 0.55, width: 0.3, height: 0.3 }],
            },
        });
        expect(findings.map((f) => f.level)).toEqual(['fail', 'fail', 'fail', 'fail']);
        expect(findings.map((f) => f.message).join('\n')).toMatch(/face/);
        expect(findings.map((f) => f.message).join('\n')).toMatch(/person/);
        expect(findings.map((f) => f.message).join('\n')).toMatch(
            /text that is already in the picture/,
        );
        expect(findings.map((f) => f.message).join('\n')).toMatch(/main subject/);
    });

    it('passes when the headline sits clear of everything the picture shows', () => {
        expect(
            checkOverlaps({
                platform: 'youtube',
                crop: FULL,
                text: mask([{ x: 100, y: 100, width: 600, height: 300 }]),
                contents: {
                    ...NOTHING,
                    faces: [{ x: 0.7, y: 0.2, width: 0.1, height: 0.15 }],
                    objects: [{ x: 0.6, y: 0.1, width: 0.3, height: 0.5 }],
                },
            }),
        ).toEqual([]);
    });

    it('ignores a salient region so large it is really the background', () => {
        expect(
            checkOverlaps({
                platform: 'youtube',
                crop: FULL,
                text: mask([{ x: 100, y: 100, width: 600, height: 300 }]),
                contents: { ...NOTHING, objects: [{ x: 0, y: 0, width: 0.95, height: 0.9 }] },
            }),
        ).toEqual([]);
    });

    it('only judges what the platform crop shows', () => {
        // 人在母版顶部，YouTube 裁掉了上面 60px，人整个在裁切框外。
        expect(
            checkOverlaps({
                platform: 'youtube',
                crop: { x: 0, y: 60, width: 1920, height: 1080 },
                text: mask([{ x: 0, y: 0, width: 800, height: 55 }]),
                contents: { ...NOTHING, people: [{ x: 0.1, y: 0, width: 0.2, height: 0.04 }] },
            }),
        ).toEqual([]);
    });

    it('tolerates a sliver of overlap with a person or an object', () => {
        expect(
            checkOverlaps({
                platform: 'youtube',
                crop: FULL,
                text: mask([{ x: 100, y: 100, width: 600, height: 300 }]),
                contents: { ...NOTHING, people: [{ x: 0.36, y: 0.1, width: 0.2, height: 0.5 }] },
            }),
        ).toEqual([]);
    });
});

describe('text mask', () => {
    it('finds the ink by comparing the render with and without text, and ignores the rest', async () => {
        const background = await sharp({
            create: { width: 200, height: 100, channels: 3, background: '#3366aa' },
        })
            .png()
            .toBuffer();
        const withText = await sharp(background)
            .composite([
                {
                    input: await sharp({
                        create: { width: 40, height: 20, channels: 3, background: '#ffffff' },
                    })
                        .png()
                        .toBuffer(),
                    left: 20,
                    top: 40,
                },
            ])
            .png()
            .toBuffer();
        const text = await textMaskFrom(withText, background);
        expect(text.data[50 * 200 + 40]).toBe(1);
        expect(text.data[10 * 200 + 150]).toBe(0);
        expect(text.data[50 * 200 + 150]).toBe(0);
    });
});

describe('text on the picture', () => {
    it('drops the ink that sits on a solid colour band and keeps the ink on a photo', async () => {
        // 左半是纯色色带，右半是随机噪点（照片的细节），整张都压着字。
        const width = 200;
        const height = 100;
        const pixels = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 3;
                const value = x < width / 2 ? 230 : Math.floor(Math.random() * 256);
                pixels[offset] = value;
                pixels[offset + 1] = x < width / 2 ? 200 : value;
                pixels[offset + 2] = x < width / 2 ? 60 : value;
            }
        }
        const background = await sharp(pixels, { raw: { width, height, channels: 3 } })
            .png()
            .toBuffer();
        const picture = await textOnPicture(
            maskFromRects(width, height, [{ x: 0, y: 0, width, height }]),
            background,
        );
        expect(picture.data[50 * width + 40]).toBe(0);
        expect(picture.data[50 * width + 160]).toBe(1);
    });

    it('stops a flat band inside a saliency box from counting as covering the subject', () => {
        const band = mask([{ x: 0, y: 400, width: 1920, height: 300 }]);
        const onPhoto = maskFromRects(MASTER.width, MASTER.height, []);
        const contents = { ...NOTHING, objects: [{ x: 0, y: 0.3, width: 1, height: 0.4 }] };
        const input = { platform: 'youtube' as const, crop: FULL, text: band, contents };
        expect(checkOverlaps(input).map((finding) => finding.message)).toEqual([
            "the headline covers the picture's main subject.",
        ]);
        expect(checkOverlaps({ ...input, pictureText: onPhoto })).toEqual([]);
    });
});

describe('edges', () => {
    it('fails when ink reaches the edge of a crop and passes when it stays inside', () => {
        const youtube = { x: 0, y: 60, width: 1920, height: 1080 };
        expect(
            checkEdges('youtube', mask([{ x: 192, y: 132, width: 900, height: 200 }]), youtube),
        ).toEqual([]);
        // 标签伸到 youtube 裁切框的右边外面。
        const cut = checkEdges(
            'youtube',
            mask([{ x: 1700, y: 400, width: 400, height: 120 }]),
            youtube,
        );
        expect(cut.map((finding) => finding.level)).toEqual(['fail']);
        // 字在母版上碰到顶，但 youtube 从 y 60 开始裁：碰的是裁切框的上沿。
        expect(
            checkEdges('youtube', mask([{ x: 400, y: 0, width: 300, height: 61 }]), youtube),
        ).toHaveLength(1);
    });
});

describe('subjects', () => {
    const douyin = { x: 0, y: 0, width: 1080, height: 1920 };
    const bars = [
        { x: 0, y: 0, width: 1080, height: 220 },
        { x: 0, y: 1540, width: 1080, height: 380 },
        { x: 944, y: 768, width: 136, height: 772 },
    ];
    const panel = { x: 0, y: 1120, width: 1080, height: 800 };
    const subject = (box: { x: number; y: number; width: number; height: number }) => [
        { name: "the after photo's subject", box, frame: panel },
    ];

    it('passes a subject that fits and shows in full', () => {
        expect(
            checkSubjects(
                'douyin',
                subject({ x: 100, y: 1150, width: 800, height: 350 }),
                douyin,
                bars,
            ),
        ).toEqual([]);
    });

    it('fails a subject that could fit but runs under the bottom bar', () => {
        const findings = checkSubjects(
            'douyin',
            subject({ x: 100, y: 1336, width: 850, height: 438 }),
            douyin,
            bars,
        );
        expect(findings.map((finding) => finding.message)).toEqual([
            "the after photo's subject is cut off or hidden under the app's buttons. Pick a photo with more room around its subject, or another type.",
        ]);
    });

    it('accepts a subject larger than the window when the window shows only subject', () => {
        expect(
            checkSubjects(
                'douyin',
                subject({ x: -200, y: 1100, width: 1480, height: 900 }),
                douyin,
                bars,
            ),
        ).toEqual([]);
        // 比窗口还大，窗口却一边露空：主体没对准。
        expect(
            checkSubjects(
                'douyin',
                subject({ x: 400, y: 1100, width: 1480, height: 900 }),
                douyin,
                bars,
            ),
        ).toHaveLength(1);
    });

    it('fails a subject hidden under the side buttons', () => {
        expect(
            checkSubjects(
                'douyin',
                subject({ x: 850, y: 1150, width: 200, height: 300 }),
                douyin,
                bars,
            ),
        ).toHaveLength(1);
    });

    it('warns when a face is too small to read in the feed', () => {
        const face = (height: number) => [
            {
                name: 'the face',
                box: { x: 400, y: 600, width: height * 0.8, height },
                frame: douyin,
                minShare: 1 / 3,
            },
        ];
        // 看得清的区域 1080 x 1320，短边 1080：脸 400 高够了，200 高太小。
        expect(checkSubjects('douyin', face(400), douyin, bars)).toEqual([]);
        expect(checkSubjects('douyin', face(200), douyin, bars)).toEqual([
            {
                level: 'warn',
                platform: 'douyin',
                message:
                    "the face is small (19% of the cover's short side, 33% or more reads in the feed). Use a photo cropped closer, head and shoulders.",
            },
        ]);
    });

    it('works out the clear part of a crop from full-width bars only', () => {
        expect(clearCrop(douyin, bars)).toEqual({ x: 0, y: 220, width: 1080, height: 1320 });
    });
});

describe('contrast', () => {
    const W = 200;
    const H = 100;
    const crop = { x: 0, y: 0, width: W, height: H };
    type Rgb = readonly [number, number, number];
    const raster = (paint: (x: number, y: number) => Rgb) => {
        const data = Buffer.alloc(W * H * 3);
        for (let y = 0; y < H; y += 1) {
            for (let x = 0; x < W; x += 1) {
                data.set(paint(x, y), (y * W + x) * 3);
            }
        }
        return sharp(data, { raw: { width: W, height: H, channels: 3 } })
            .png()
            .toBuffer();
    };
    // 标题是中间一根 160x40 的横条。
    const inGlyph = (x: number, y: number) => x >= 20 && x < 180 && y >= 30 && y < 70;
    const headline = () => raster((x, y) => (inGlyph(x, y) ? [0, 0, 0] : [255, 255, 255]));
    const grey = (value: number): Rgb => [value, value, value];
    // ground 是不带字的那张。没给就和带字的一样：只有标题填色算字迹。
    const check = async (
        paint: (x: number, y: number) => Rgb,
        ground: (x: number, y: number) => Rgb = paint,
    ) =>
        (
            await checkContrast({
                target: 'youtube',
                withText: await raster(paint),
                background: await raster(ground),
                headline: await headline(),
                crop,
            })
        ).map((finding) => finding.level);

    it('fails a single-tone headline that blends into what is behind it', async () => {
        expect(await check((x, y) => (inGlyph(x, y) ? grey(255) : grey(216)))).toEqual(['fail']);
    });

    it('finds a headline painted in the same colour as what is behind it', async () => {
        expect(await check(() => grey(255))).toEqual(['fail']);
        expect(await check((x, y) => (inGlyph(x, y) ? grey(238) : grey(255)))).toEqual(['fail']);
    });

    it('passes dark type on a light ground and outlined type on a mid grey', async () => {
        expect(await check((x, y) => (inGlyph(x, y) ? [18, 18, 18] : [245, 238, 220]))).toEqual([]);
        // 白字外面一圈 6 像素的黑描边，压在中灰上。
        const nearGlyph = (x: number, y: number) => x >= 14 && x < 186 && y >= 24 && y < 76;
        expect(
            await check(
                (x, y) => (inGlyph(x, y) ? grey(255) : nearGlyph(x, y) ? grey(0) : grey(138)),
                () => grey(138),
            ),
        ).toEqual([]);
        // 黑字黑描边压奶油底：字和描边连成一块，眼睛拿整块和奶油底比。
        const cream: Rgb = [245, 238, 220];
        expect(
            await check(
                (x, y) => (nearGlyph(x, y) ? grey(18) : cream),
                () => cream,
            ),
        ).toEqual([]);
    });

    it('fails a headline that is readable on one half and not on the other', async () => {
        // 白字左半压在深灰上，右半压在 #999 上（只有 2.85:1）。
        expect(
            await check((x, y) => (inGlyph(x, y) ? grey(255) : x < 100 ? grey(51) : grey(153))),
        ).toEqual(['fail']);
        // 灰底上一小段黑色强调字，拉不高其余白字的对比度。
        expect(
            await check((x, y) => (inGlyph(x, y) ? (x < 40 ? grey(0) : grey(255)) : grey(153))),
        ).toEqual(['fail']);
    });

    it('skips a crop the headline is not in', async () => {
        expect(
            await checkContrast({
                target: 'youtube',
                withText: await raster(() => grey(255)),
                background: await raster(() => grey(255)),
                headline: await headline(),
                crop: { x: 0, y: 80, width: W, height: 20 },
            }),
        ).toEqual([]);
    });
});

describe('colourfulness', () => {
    it('warns on a nearly grey cover and passes a colourful one', async () => {
        const grey = await sharp({
            create: { width: 320, height: 180, channels: 3, background: '#9a9a96' },
        })
            .png()
            .toBuffer();
        const orange = await sharp({
            create: { width: 320, height: 180, channels: 3, background: '#ff7a1a' },
        })
            .png()
            .toBuffer();
        expect(checkColourfulness('youtube', await colourfulness(grey))).toHaveLength(1);
        expect(checkColourfulness('youtube', await colourfulness(orange))).toEqual([]);
    });
});

describe('brightness', () => {
    it('warns about a dark cover and passes a bright one', () => {
        expect(checkBrightness('youtube', 62).map((f) => f.level)).toEqual(['warn']);
        expect(checkBrightness('youtube', 118)).toEqual([]);
    });
});

describe('report', () => {
    it('lists failures before warnings, groups platforms, and colours only on a terminal', () => {
        const findings: QcFinding[] = [
            { level: 'warn', platform: 'youtube', message: 'the cover is dark.' },
            {
                level: 'fail',
                platform: 'youtube',
                message: 'the headline covers a face in the picture.',
            },
            {
                level: 'fail',
                platform: 'bilibili',
                message: 'the headline covers a face in the picture.',
            },
        ];
        const plain = formatFindings(findings, false);
        expect(plain).toEqual([
            'QC FAIL youtube, bilibili: the headline covers a face in the picture.',
            'QC WARN youtube: the cover is dark.',
            'QC: 1 problem fails the check. The files were written; fix the cover before you ship it.',
        ]);
        expect(formatFindings(findings, true)[0]).toContain('\u001b[31m');
        expect(formatFindings([], false)).toEqual(['QC: passed.']);
    });
});
