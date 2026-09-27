import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
    checkBrightness,
    checkOverlaps,
    formatFindings,
    maskFromRects,
    type QcFinding,
    textMaskFrom,
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
