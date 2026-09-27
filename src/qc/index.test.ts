import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
    checkBrightness,
    checkEdges,
    checkOverlaps,
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
