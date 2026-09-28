// 带人的两类封面。
// 人物大字：抠好的人贴一侧，冷色同色相渐变底（暖肤配冷底最省事），另一侧 2-4 个字白字黑描边。
// 人物加赌注：人站在事件的场景里（场景照片虚一点、字那侧局部压暗），一块倾斜的赌注牌
// （$10,000、DAY 7、50 米）压在标题上方。MrBeast 一类挑战视频的主力配方。
// 配方依据：research.md 第 2.1 节人物大小和位置、第 2.4 节背景、第 5.0 节各平台的字。
import sharp from 'sharp';
import type { CoverTemplate, RenderedPage } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { PictureSubject } from '../qc/index.ts';
import type { FontChoice } from '../render/fonts.ts';
import {
    type CoverLayout,
    escapeHtml,
    type Headline,
    placeSubject,
    withSubjectArea,
} from '../render/layout.ts';
import {
    framingFraction,
    type PhotoFit,
    type PhotoLook,
    photoFocusTarget,
    preparePhotoLayer,
} from '../render/photo-cover.ts';
import { coverDocument, subjectMarkup } from '../render/template.ts';
import type { TypeColors, TypeSpec } from '../render/type.ts';
import type { SubjectLayer } from '../subject/index.ts';
import {
    eyebrow,
    type FontKit,
    faceSubject,
    type GenrePhoto,
    genrePage,
    joinLayers,
    localScrim,
    NO_LAYERS,
    photoForLayout,
    photoLayers,
    photoSubject,
    rectCss,
    tailLine,
} from './page.ts';
import { isLightScheme, SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';
import { type StyleName, styledType } from './styles.ts';

// 脸高占无遮挡区高度的比例。爆款要求脸高至少三分之一，四到五成更好（research.md 第 2.1 节）。
const FACE_TEXT_SHARE = 0.42;
const FACE_STAKES_SHARE = 0.38;
// 赌注封面的场景是虚化的背景，照片挪不到位时可以放大这么多，把场景主体送到人的肩头一侧。
export const SCENE_MAX_ZOOM = 1.5;

// 脸要比身后至少亮两成，第一眼才落在脸上（research.md 第 2.4 节、第 7.2 节）。
// 提亮最多三成五，再多皮肤就发白发假。
const FACE_LIFT = 1.2;
const MAX_LIFT = 1.35;
// 提亮后脸上最亮那一小块（95% 分位的最亮通道）不超过这个值，否则高光糊成一片白。
// 身后本来就很亮时提不到比它亮两成，提到这里为止。
const HIGHLIGHT_CEILING = 245;
// 算出来只提这么一点，就不动图了。
const MIN_LIFT = 1.02;

function pngBytes(dataUri: string): Buffer {
    return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

/** BT.601 亮度，0-255 */
function lumaOf(hex: string): number {
    const value = Number.parseInt(hex.slice(1), 16);
    return 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
}

/** 人物图里脸那一块（不透明的像素）的平均亮度和高光（最亮通道的 95% 分位）。没找到脸就没有 */
async function faceLight(
    subject: SubjectLayer,
): Promise<{ luma: number; highlight: number } | undefined> {
    const face = subject.face;
    if (face === undefined) {
        return undefined;
    }
    const { data, info } = await sharp(pngBytes(subject.dataUri))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const x0 = Math.max(0, Math.floor((face.x - face.width / 2) * info.width));
    const y0 = Math.max(0, Math.floor((face.y - face.height / 2) * info.height));
    const x1 = Math.min(info.width, Math.ceil((face.x + face.width / 2) * info.width));
    const y1 = Math.min(info.height, Math.ceil((face.y + face.height / 2) * info.height));
    let sum = 0;
    const peaks: number[] = [];
    for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
            const i = (y * info.width + x) * info.channels;
            if ((data[i + 3] ?? 0) < 128) {
                continue;
            }
            const r = data[i] ?? 0;
            const g = data[i + 1] ?? 0;
            const b = data[i + 2] ?? 0;
            sum += 0.299 * r + 0.587 * g + 0.114 * b;
            peaks.push(Math.max(r, g, b));
        }
    }
    if (peaks.length === 0) {
        return undefined;
    }
    peaks.sort((a, b) => a - b);
    return {
        luma: sum / peaks.length,
        highlight: peaks[Math.floor(peaks.length * 0.95)] ?? 255,
    };
}

/**
 * 脸比身后暗时把人整体提亮，目标是脸比背景亮两成。最多提三成五，而且脸上的高光不提到过曝：
 * 抠出来的人常常偏暗，压在亮底或亮场景前面就被背景抢了第一眼，但提成一片白更糟。
 */
export async function litSubject(subject: SubjectLayer, behindLuma: number): Promise<SubjectLayer> {
    const light = await faceLight(subject);
    if (light === undefined || light.luma <= 0 || light.luma >= behindLuma * FACE_LIFT) {
        return subject;
    }
    const factor = Math.min(
        MAX_LIFT,
        (behindLuma * FACE_LIFT) / light.luma,
        HIGHLIGHT_CEILING / Math.max(1, light.highlight),
    );
    if (factor < MIN_LIFT) {
        return subject;
    }
    // 只乘颜色通道，透明度原样保留。
    const lifted = await sharp(pngBytes(subject.dataUri))
        .ensureAlpha()
        .linear([factor, factor, factor, 1], [0, 0, 0, 0])
        .png()
        .toBuffer();
    return { ...subject, dataUri: `data:image/png;base64,${lifted.toString('base64')}` };
}

export interface FaceTextRequest {
    text: string;
    fonts: FontKit;
    subject: SubjectLayer;
    scheme?: SchemeName;
    tag?: string;
    style?: StyleName;
}

export function faceTextTemplate(request: FaceTextRequest): CoverTemplate {
    // 青底：冷底不用边缘光就能把暖色的脸分开，又比海军蓝亮，信息流里不显暗。
    const schemeName = request.scheme ?? 'teal';
    const scheme = SCHEMES[schemeName];
    // 浅底方案是深色字直接压底，描边和字同色会糊成一团，改用荧光笔标重点。
    const light = isLightScheme(schemeName);
    const bold: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'marker' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const { type, colors } = styledType(request.style ?? 'bold', {
        fonts: request.fonts,
        ground: { light, picture: false },
        colors: scheme.type,
        bold,
    });
    const tag = eyebrow(request.tag, { background: scheme.type.accent, ink: scheme.type.stroke });
    const page = (layout: CoverLayout, headline: Headline, subject: SubjectLayer | undefined) => {
        const measure = subject === undefined;
        const person =
            subject === undefined
                ? { css: '', html: '' }
                : subjectMarkup(layout, subject, {
                      outline: 'clean',
                      faceShare: FACE_TEXT_SHARE,
                  });
        // 渐变从字那一侧亮到人那一侧深：人身后暗，脸就比背景亮。
        const angle = layout.subjectArea && layout.subjectArea.y > layout.textArea.y ? 180 : 90;
        return genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors,
            background: schemeGradient(scheme, angle),
            measure,
            prefix: tag.prefix,
            over: joinLayers({ css: tag.css, html: '' }, person),
        });
    };
    return {
        layoutFor: faceLayout,
        measureHtml: (layout, headline) => page(layout, headline, undefined),
        renderHtml: async (layout, headline) => ({
            // 身后是底色渐变的两档，取它们的平均亮度。
            html: page(
                layout,
                headline,
                await litSubject(
                    request.subject,
                    (lumaOf(scheme.base) + lumaOf(scheme.baseDeep)) / 2,
                ),
            ),
            subjects: faceSubject(layout, request.subject, FACE_TEXT_SHARE),
        }),
    };
}

export interface QuoteRequest {
    /** 原话 */
    text: string;
    fonts: FontKit;
    subject: SubjectLayer;
    /** 谁说的，跟在原话后面 */
    speaker?: string;
    scheme?: SchemeName;
    style?: StyleName;
}

// 金句的人比人物大字小一点，原话要占更多地方。
const QUOTE_SHARE = 0.36;

/**
 * 金句：一张脸、一个大引号、一句原话、一个署名。访谈切片和观点类用它，原话要具体、
 * 有得争（YouTube 播客封面的经验：能被反驳的一句话比描述主题的一句话点得多）。
 */
export function quoteTemplate(request: QuoteRequest): CoverTemplate {
    const schemeName = request.scheme ?? 'teal';
    const scheme = SCHEMES[schemeName];
    const light = isLightScheme(schemeName);
    const bold: TypeSpec = light
        ? { style: 'ink', font: request.fonts.choose('heavy'), highlight: 'marker' }
        : { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' };
    const { type, colors } = styledType(request.style ?? 'bold', {
        fonts: request.fonts,
        ground: { light, picture: false },
        colors: scheme.type,
        bold,
    });
    // 大引号是标题块开头的装饰（伪元素）：跟着原话一起量字号、一起留在标题区里，但不算一行字，
    // 不占三行的名额。描边层也有一个，引号跟字一样带描边。量字号的探针不加。
    const mark = `
        .copy:not(.probe)::before,
        .copy-layer::before {
            content: '“';
            display: block;
            height: 0.62em;
            font-size: 1.6em;
            line-height: 1;
        }
        .copy:not(.probe)::before {
            color: ${colors.accent};
        }`;
    const speaker = tailLine(request.speaker === undefined ? undefined : `— ${request.speaker}`, {
        ink: colors.fill,
        sizeEm: 0.36,
    });
    const page = (layout: CoverLayout, headline: Headline, subject: SubjectLayer | undefined) => {
        const person =
            subject === undefined
                ? NO_LAYERS
                : subjectMarkup(layout, subject, { outline: 'clean', faceShare: QUOTE_SHARE });
        const angle = layout.subjectArea && layout.subjectArea.y > layout.textArea.y ? 180 : 90;
        return genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors,
            background: light ? scheme.base : schemeGradient(scheme, angle),
            measure: subject === undefined,
            suffix: speaker.suffix,
            over: joinLayers({ css: mark + speaker.css, html: '' }, person),
        });
    };
    return {
        layoutFor: faceLayout,
        measureHtml: (layout, headline) => page(layout, headline, undefined),
        renderHtml: async (layout, headline) => ({
            html: page(
                layout,
                headline,
                await litSubject(
                    request.subject,
                    (lumaOf(scheme.base) + lumaOf(scheme.baseDeep)) / 2,
                ),
            ),
            subjects: faceSubject(layout, request.subject, QUOTE_SHARE),
        }),
    };
}

export interface FaceStakesRequest {
    text: string;
    fonts: FontKit;
    subject: SubjectLayer;
    photo: GenrePhoto;
    /** 赌注牌上的字：金额、天数、距离 */
    stake?: string;
    scheme?: SchemeName;
    look?: PhotoLook;
    fit?: PhotoFit;
    style?: StyleName;
}

// 赌注牌占标题一侧的上面这一截，倾斜这么多度。
const STAKE_SHARE = 0.36;
const STAKE_TILT = -4;
const STAKE_GAP_SHARE = 0.04;
// 场景照片虚化：高斯 sigma 占出图宽度的比例（research.md 第 7.2 节 0.6-1.2% W，这里取轻的一档，
// 场景还要认得出来）。
const SCENE_BLUR_SHARE = 0.004;

// 标题和人之间至少空出画布短边的这么多：质检把人框和字迹各往外放一圈，贴着就算压到。
const FACE_GAP_SHARE = 0.03;

/** 人物版式，标题区朝人的那条边往回收一截，字永远碰不到人 */
export function faceLayout(layout: CoverLayout): CoverLayout {
    const base = withSubjectArea(layout);
    const subject = base.subjectArea;
    if (subject === undefined) {
        return base;
    }
    const gap = Math.round(Math.min(layout.width, layout.height) * FACE_GAP_SHARE);
    const area = base.textArea;
    const textArea =
        subject.y >= area.y + area.height
            ? { ...area, height: Math.min(area.height, subject.y - gap - area.y) }
            : { ...area, width: Math.min(area.width, subject.x - gap - area.x) };
    return { ...base, textArea };
}

/** 标题一侧上面分一块给赌注牌 */
export function stakesLayout(layout: CoverLayout): CoverLayout {
    const base = faceLayout(layout);
    const area = base.textArea;
    const gap = Math.round(area.height * STAKE_GAP_SHARE);
    const stake = Math.round(area.height * STAKE_SHARE);
    return {
        ...base,
        accentArea: { x: area.x, y: area.y, width: area.width, height: stake },
        textArea: { ...area, y: area.y + stake + gap, height: area.height - stake - gap },
    };
}

function stakeMarkup(
    area: Rect,
    stake: string,
    fontPx: number,
    font: FontChoice,
    colors: TypeColors,
    measure: boolean,
): { css: string; html: string } {
    const edge = Math.max(3, Math.round(fontPx * 0.06));
    return {
        css: `
        .stake-box {
            position: absolute;
            ${rectCss(area)}
            z-index: 1;
            display: flex;
            align-items: flex-end;
            justify-content: flex-start;
        }
        .stake {
            margin: ${Math.round(fontPx * 0.12)}px;
            padding: 0.1em 0.3em 0.12em;
            font-family: ${font.stack};
            font-size: ${fontPx}px;
            font-weight: 900;
            line-height: 1;
            white-space: nowrap;
            color: ${colors.stroke};
            background: ${colors.accent};
            border: ${edge}px solid ${colors.stroke};
            box-shadow: ${edge * 1.5}px ${edge * 1.5}px 0 ${colors.stroke};
            border-radius: 0.05em;
            /* 绕左下角转：往上翘的一侧不会伸出底边，长的赌注牌也量得出字号。 */
            transform-origin: 0 100%;
            transform: rotate(${STAKE_TILT}deg);
        }`,
        html: `<div class="stake-box"><p class="stake ${measure ? 'copy' : 'qc-text'}">${escapeHtml(stake)}</p></div>`,
    };
}

/** 赌注封面的版式：有赌注牌时字上面让出牌的位置。构图提示和出图用同一个 */
export function faceStakesLayoutFor(
    stake: string | undefined,
): (layout: CoverLayout) => CoverLayout {
    return stake === undefined ? faceLayout : stakesLayout;
}

export function faceStakesTemplate(request: FaceStakesRequest): CoverTemplate {
    const scheme = SCHEMES[request.scheme ?? 'navy'];
    const stakeFont = request.fonts.choose('condensed');
    const { type, colors } = styledType(request.style ?? 'bold', {
        fonts: request.fonts,
        ground: { light: false, picture: true },
        colors: scheme.type,
        bold: { style: 'outline', font: request.fonts.choose('heavy'), highlight: 'color' },
    });
    const stake = request.stake;
    const layoutFor = faceStakesLayoutFor(stake);
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        pixels: { width: number; height: number } | undefined,
    ): Promise<RenderedPage> => {
        const measure = pixels === undefined;
        const stakeLayer =
            stake === undefined ||
            headline.accentPx === undefined ||
            layout.accentArea === undefined
                ? { css: '', html: '' }
                : stakeMarkup(
                      layout.accentArea,
                      stake,
                      headline.accentPx,
                      stakeFont,
                      scheme.type,
                      false,
                  );
        let under = { css: '', html: '' };
        let person = { css: '', html: '' };
        let sceneSubjects: PictureSubject[] = [];
        if (pixels !== undefined) {
            const visible = framingFraction(layout);
            const scene = photoForLayout(request.photo, layout);
            const photo = await preparePhotoLayer(scene.path, pixels.width, pixels.height, {
                ...(scene.focus === undefined ? {} : { focus: scene.focus }),
                target: photoFocusTarget(layout, true),
                maxZoom: SCENE_MAX_ZOOM,
                fit: request.fit ?? 'cover',
                canvas: { width: layout.width, height: layout.height },
                ...(visible === undefined ? {} : { visible }),
            });
            sceneSubjects = photoSubject("the scene's subject", photo.focusBox, {
                x: 0,
                y: 0,
                width: layout.width,
                height: layout.height,
            });
            const bytes = Buffer.from(
                photo.dataUri.slice(photo.dataUri.indexOf(',') + 1),
                'base64',
            );
            const blurred = await sharp(bytes)
                .blur(Math.max(1, pixels.width * SCENE_BLUR_SHARE))
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer();
            const portrait =
                layout.subjectArea !== undefined && layout.subjectArea.y > layout.textArea.y;
            under = joinLayers(
                photoLayers(
                    [
                        {
                            dataUri: `data:image/jpeg;base64,${blurred.toString('base64')}`,
                            rect: { x: 0, y: 0, width: layout.width, height: layout.height },
                        },
                    ],
                    request.look ?? 'natural',
                    { deep: scheme.baseDeep, accent: scheme.type.accent },
                ),
                localScrim(layout, portrait ? 'top' : 'left', type),
            );
            // 身后是人站的那块场景（已经虚化），量它的平均亮度。
            const rect = placeSubject(layout, request.subject, FACE_STAKES_SHARE);
            const k = pixels.width / layout.width;
            // 人可以伸出画布（有脸时贴边放大），只量画布里的那一截。
            const clampTo = (value: number, low: number, high: number) =>
                Math.min(Math.max(value, low), high);
            const x0 = clampTo(Math.round(rect.x * k), 0, pixels.width - 1);
            const y0 = clampTo(Math.round(rect.y * k), 0, pixels.height - 1);
            const x1 = clampTo(Math.round((rect.x + rect.width) * k), x0 + 1, pixels.width);
            const y1 = clampTo(Math.round((rect.y + rect.height) * k), y0 + 1, pixels.height);
            const behind = await sharp(blurred)
                .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
                .toBuffer();
            const { channels } = await sharp(behind).stats();
            const [r, g, b] = channels.map((channel) => channel.mean) as [number, number, number];
            person = subjectMarkup(
                layout,
                await litSubject(request.subject, 0.299 * r + 0.587 * g + 0.114 * b),
                { outline: 'sticker', faceShare: FACE_STAKES_SHARE },
            );
        }
        return {
            html: genrePage({
                layout,
                headline,
                text: request.text,
                type,
                colors,
                background: scheme.baseDeep,
                measure,
                align: { x: 'start', y: 'start' },
                under,
                over: joinLayers(stakeLayer, person),
            }),
            subjects: [
                ...sceneSubjects,
                ...faceSubject(layout, request.subject, FACE_STAKES_SHARE),
            ],
        };
    };
    return {
        layoutFor,
        ...(stake === undefined
            ? {}
            : {
                  measureAccentHtml: (layout: CoverLayout, fontPx: number) => {
                      const area = layout.accentArea;
                      if (area === undefined) {
                          throw new Error('The stakes cover needs an accent area.');
                      }
                      const measured = stakeMarkup(
                          area,
                          stake,
                          fontPx,
                          stakeFont,
                          scheme.type,
                          true,
                      );
                      return coverDocument({
                          layout,
                          colors: {
                              paper: scheme.type.fill,
                              ink: scheme.type.stroke,
                              accent: scheme.type.accent,
                          },
                          background: scheme.baseDeep,
                          fontFamily: stakeFont.stack,
                          css: measured.css,
                          body: measured.html,
                      });
                  },
              }),
        measureHtml: (layout, headline) =>
            // 量字号的页面是同步的：没有照片和人物，直接拼。
            genrePage({
                layout,
                headline: { fontPx: headline.fontPx, keepClauses: headline.keepClauses },
                text: request.text,
                type,
                colors,
                background: scheme.baseDeep,
                measure: true,
                align: { x: 'start', y: 'start' },
            }),
        renderHtml: (layout, headline, pixelWidth, pixelHeight) =>
            page(layout, headline, { width: pixelWidth, height: pixelHeight }),
    };
}
