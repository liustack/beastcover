// 带人的两类封面。
// 人物大字：抠好的人贴一侧，冷色同色相渐变底（暖肤配冷底最省事），另一侧 2-4 个字白字黑描边。
// 人物加赌注：人站在事件的场景里（场景照片虚一点、字那侧局部压暗），一块倾斜的赌注牌
// （$10,000、DAY 7、50 米）压在标题上方。MrBeast 一类挑战视频的主力配方。
// 配方依据：research.md 第 2.1 节人物大小和位置、第 2.4 节背景、第 5.0 节各平台的字。
import sharp from 'sharp';
import type { CoverTemplate } from '../compose/index.ts';
import type { Rect } from '../platforms/index.ts';
import type { FontChoice } from '../render/fonts.ts';
import { type CoverLayout, escapeHtml, type Headline, withSubjectArea } from '../render/layout.ts';
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
    photoForLayout,
    photoLayers,
    rectCss,
} from './page.ts';
import { SCHEMES, type SchemeName, schemeGradient } from './schemes.ts';

// 脸高占无遮挡区高度的比例。爆款要求脸高至少三分之一，四到五成更好（research.md 第 2.1 节）。
const FACE_TEXT_SHARE = 0.42;
const FACE_STAKES_SHARE = 0.38;

export interface FaceTextRequest {
    text: string;
    fonts: FontKit;
    subject: SubjectLayer;
    scheme?: SchemeName;
    tag?: string;
}

export function faceTextTemplate(request: FaceTextRequest): CoverTemplate {
    // 青底：冷底不用边缘光就能把暖色的脸分开，又比海军蓝亮，信息流里不显暗。
    const scheme = SCHEMES[request.scheme ?? 'teal'];
    const type: TypeSpec = {
        style: 'outline',
        font: request.fonts.choose('heavy'),
        highlight: 'color',
    };
    const tag = eyebrow(request.tag, { background: scheme.type.accent, ink: scheme.type.stroke });
    const page = (layout: CoverLayout, headline: Headline, measure: boolean) => {
        const person = measure
            ? { css: '', html: '' }
            : subjectMarkup(layout, request.subject, {
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
            colors: scheme.type,
            background: schemeGradient(scheme, angle),
            measure,
            prefix: tag.prefix,
            over: joinLayers({ css: tag.css, html: '' }, person),
        });
    };
    return {
        layoutFor: faceLayout,
        measureHtml: (layout, headline) => page(layout, headline, true),
        renderHtml: async (layout, headline) => ({
            html: page(layout, headline, false),
            subjects: faceSubject(layout, request.subject, FACE_TEXT_SHARE),
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

export function faceStakesTemplate(request: FaceStakesRequest): CoverTemplate {
    const scheme = SCHEMES[request.scheme ?? 'navy'];
    const stakeFont = request.fonts.choose('condensed');
    const type: TypeSpec = {
        style: 'outline',
        font: request.fonts.choose('heavy'),
        highlight: 'color',
    };
    const stake = request.stake;
    const layoutFor = stake === undefined ? faceLayout : stakesLayout;
    const page = async (
        layout: CoverLayout,
        headline: Headline,
        pixels: { width: number; height: number } | undefined,
    ) => {
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
        if (pixels !== undefined) {
            const visible = framingFraction(layout);
            const scene = photoForLayout(request.photo, layout);
            const photo = await preparePhotoLayer(scene.path, pixels.width, pixels.height, {
                focus: scene.focus,
                // 竖版字在上、人在下，场景的主体放到人的肩头一带，不压在字底下。
                target:
                    layout.subjectArea !== undefined && layout.subjectArea.y > layout.textArea.y
                        ? { x: 0.5, y: 0.62 }
                        : photoFocusTarget(layout, true),
                fit: request.fit ?? 'cover',
                canvas: { width: layout.width, height: layout.height },
                ...(visible === undefined ? {} : { visible }),
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
                localScrim(layout, portrait ? 'top' : 'left'),
            );
            person = subjectMarkup(layout, request.subject, {
                outline: 'sticker',
                faceShare: FACE_STAKES_SHARE,
            });
        }
        return genrePage({
            layout,
            headline,
            text: request.text,
            type,
            colors: scheme.type,
            background: scheme.baseDeep,
            measure,
            align: { x: 'start', y: 'start' },
            under,
            over: joinLayers(stakeLayer, person),
        });
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
                colors: scheme.type,
                background: scheme.baseDeep,
                measure: true,
                align: { x: 'start', y: 'start' },
            }),
        renderHtml: async (layout, headline, pixelWidth, pixelHeight) => ({
            html: await page(layout, headline, { width: pixelWidth, height: pixelHeight }),
            subjects: faceSubject(layout, request.subject, FACE_STAKES_SHARE),
        }),
    };
}
