// --guides 参考线：把标题区（绿）、主体区（橙）、人物区（蓝）、大字区（紫）和平台界面遮挡区（红）画到成品上，方便目检。
import type { Platform, Rect } from '../platforms/index.ts';

export interface GuideAreas {
    textArea: Rect;
    focusArea: Rect;
    subjectArea?: Rect;
    accentArea?: Rect;
}

function toOutput(rect: Rect, platform: Platform, factor: number): Rect {
    return {
        x: (rect.x - platform.crop.x) * factor,
        y: (rect.y - platform.crop.y) * factor,
        width: rect.width * factor,
        height: rect.height * factor,
    };
}

function rectTag(rect: Rect, style: string): string {
    const r = (value: number) => value.toFixed(1);
    return `<rect x="${r(rect.x)}" y="${r(rect.y)}" width="${r(rect.width)}" height="${r(rect.height)}" ${style}/>`;
}

export function guidesOverlay(
    platform: Platform,
    areas: GuideAreas,
    pixelWidth: number,
    pixelHeight: number,
): Buffer {
    const factor = pixelWidth / platform.crop.width;
    const stroke = Math.max(2, Math.round(pixelWidth / 400));
    const dash = `stroke-dasharray="${stroke * 4} ${stroke * 3}"`;
    const shapes = [
        ...platform.covered.map((rect) =>
            rectTag(toOutput(rect, platform, factor), 'fill="#ef4444" fill-opacity="0.35"'),
        ),
        rectTag(
            toOutput(areas.focusArea, platform, factor),
            `fill="none" stroke="#f97316" stroke-width="${stroke}" ${dash}`,
        ),
        ...(areas.subjectArea
            ? [
                  rectTag(
                      toOutput(areas.subjectArea, platform, factor),
                      `fill="none" stroke="#3b82f6" stroke-width="${stroke}" ${dash}`,
                  ),
              ]
            : []),
        ...(areas.accentArea
            ? [
                  rectTag(
                      toOutput(areas.accentArea, platform, factor),
                      `fill="none" stroke="#a855f7" stroke-width="${stroke}"`,
                  ),
              ]
            : []),
        rectTag(
            toOutput(areas.textArea, platform, factor),
            `fill="none" stroke="#22c55e" stroke-width="${stroke}"`,
        ),
    ];
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}">${shapes.join('')}</svg>`,
    );
}
