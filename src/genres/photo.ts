// 一张满版照片的三类封面。
// 场景题字：场景就是承诺（旅行、美食、改造、纪录片），题名压在照片里本来就安静的下半截，
// 只压暗字那一侧，白字黑描边加双层外圈（B 站剧集、纪录片的题字做法）。
// 圈注科普：照片主体上一个红圈加一支箭头，一句短问句。科普频道的招牌（research.md 第 3.3 节）。
// 氛围单图：一张好图说完，字少而小，衬线体加软投影，不描边（小红书高颜值单图、公众号编辑感）。
import type { CoverTemplate, RenderedPage } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { CoverLayout, Headline } from '../render/layout.ts';
import {
    calloutLayout,
    calloutMarkup,
    framingFraction,
    type PhotoFit,
    type PhotoLook,
    photoFocusTarget,
    photoTextLayout,
    preparePhotoLayer,
} from '../render/photo-cover.ts';
import type { TypeSpec } from '../render/type.ts';
import type { PhotoFocus } from '../subject/vision.ts';
import {
    type FontKit,
    type GenrePhoto,
    genrePage,
    joinLayers,
    type Layers,
    localScrim,
    photoForLayout,
    photoLayers,
    photoSubject,
} from './page.ts';
import { SCHEMES, type SchemeName } from './schemes.ts';

export interface PhotoGenreRequest {
    text: string;
    fonts: FontKit;
    photo: GenrePhoto;
    scheme?: SchemeName;
    look?: PhotoLook;
    fit?: PhotoFit;
}

// 氛围单图的字只占标题区左下角这一小块：字小，照片是主角。
const MOOD_WIDTH_SHARE = 0.62;
const MOOD_HEIGHT_SHARE = 0.2;

/** 标题在画面上半截还是下半截 */
function textOnTop(layout: CoverLayout): boolean {
    const area = layout.textArea;
    return area.y + area.height / 2 < layout.height / 2;
}

/** 标题挪到标题区上半截：照片下半截有人或主体时的备选 */
export function photoTopLayout(layout: CoverLayout): CoverLayout {
    const area = layout.textArea;
    return { ...layout, textArea: { ...area, height: Math.round(area.height / 2) } };
}

/** 氛围单图的上方备选：字在左上角 */
export function moodTopLayout(layout: CoverLayout): CoverLayout {
    const bottom = moodLayout(layout);
    return { ...bottom, textArea: { ...bottom.textArea, y: layout.textArea.y } };
}

/** 照片主体落在和标题相对的那半边 */
function focusTarget(layout: CoverLayout): { x: number; y: number } {
    const usual = photoFocusTarget(layout, false);
    return textOnTop(layout) ? { x: usual.x, y: 1 - usual.y } : usual;
}

export function moodLayout(layout: CoverLayout): CoverLayout {
    const area = layout.textArea;
    const height = Math.round(area.height * MOOD_HEIGHT_SHARE);
    return {
        ...layout,
        textArea: {
            x: area.x,
            y: area.y + area.height - height,
            width: Math.round(area.width * MOOD_WIDTH_SHARE),
            height,
        },
    };
}

/** 圈注要圈照片里找到的主体，所以只有它带着主体位置 */
type PhotoMode =
    | { kind: 'scene-title' }
    | { kind: 'mood' }
    | { kind: 'callout'; focus: PhotoFocus };

function photoTemplate(request: PhotoGenreRequest, mode: PhotoMode): CoverTemplate {
    const { kind } = mode;
    const scheme = SCHEMES[request.scheme ?? 'navy'];
    const type: TypeSpec =
        kind === 'mood'
            ? { style: 'soft', font: request.fonts.choose('serif'), highlight: 'color' }
            : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const photo = request.photo;
    const layoutFor =
        mode.kind === 'callout'
            ? (layout: CoverLayout) => calloutLayout(layout, photo, mode.focus)
            : kind === 'mood'
              ? moodLayout
              : photoTextLayout;
    const colors = kind === 'mood' ? { ...scheme.type, accent: '#FFFFFF' } : scheme.type;
    const moodCss =
        kind === 'mood'
            ? `
        .copy,
        .copy-layer {
            letter-spacing: 0.06em;
        }`
            : '';
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        pixels: { width: number; height: number } | undefined,
    ): Promise<RenderedPage> => {
        let under: Layers = { css: moodCss, html: '' };
        let over: Layers = { css: '', html: '' };
        let subjects: PictureSubject[] = [];
        if (pixels !== undefined) {
            const visible = framingFraction(layout);
            const picked = photoForLayout(photo, layout);
            const layer = await preparePhotoLayer(picked.path, pixels.width, pixels.height, {
                ...(picked.focus === undefined ? {} : { focus: picked.focus }),
                target: kind === 'callout' ? photoFocusTarget(layout, false) : focusTarget(layout),
                fit: kind === 'callout' ? 'cover' : (request.fit ?? 'cover'),
                // 按版式比例构图，和渲染前的圈注检查用同一个窗口。
                canvas: { width: layout.width, height: layout.height },
                ...(visible === undefined ? {} : { visible }),
            });
            const full: Rect = { x: 0, y: 0, width: layout.width, height: layout.height };
            subjects = photoSubject("the photo's subject", layer.focusBox, full);
            under = joinLayers(
                { css: moodCss, html: '' },
                photoLayers([{ dataUri: layer.dataUri, rect: full }], request.look ?? 'natural', {
                    deep: scheme.baseDeep,
                    accent: scheme.type.accent,
                }),
                localScrim(
                    layout,
                    textOnTop(layout) ? 'top' : 'bottom',
                    kind === 'mood' ? 0.38 : 0.62,
                ),
            );
            if (kind === 'callout') {
                if (layer.focusBox === undefined) {
                    throw new Error('The callout cover needs the photo framed around its subject.');
                }
                over = {
                    css: `
        .callout {
            position: absolute;
            inset: 0;
            z-index: 2;
        }`,
                    html: calloutMarkup(layout, layer.focusBox),
                };
            }
        }
        return {
            html: genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background: scheme.baseDeep,
                measure: pixels === undefined,
                align: { x: 'start', y: textOnTop(layout) ? 'start' : 'end' },
                under,
                over,
            }),
            subjects,
        };
    };
    return {
        layoutFor,
        ...(kind === 'callout'
            ? {}
            : { placements: [kind === 'mood' ? moodTopLayout : photoTopLayout] }),
        measureHtml: (layout, headline) =>
            genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background: scheme.baseDeep,
                measure: true,
                align: { x: 'start', y: textOnTop(layout) ? 'start' : 'end' },
                under: { css: moodCss, html: '' },
            }),
        renderHtml: (layout, headline, pixelWidth, pixelHeight) =>
            page(layout, headline, { width: pixelWidth, height: pixelHeight }),
    };
}

export function sceneTitleTemplate(request: PhotoGenreRequest): CoverTemplate {
    return photoTemplate(request, { kind: 'scene-title' });
}

export function calloutTemplate(request: PhotoGenreRequest & { focus: PhotoFocus }): CoverTemplate {
    return photoTemplate(request, { kind: 'callout', focus: request.focus });
}

export function moodTemplate(request: PhotoGenreRequest): CoverTemplate {
    return photoTemplate(request, { kind: 'mood' });
}
