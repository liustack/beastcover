// 照片封面：图库照片做底图，项目调色板做色调层，正文大字压在下三分之一。
// 渲染引擎禁网禁 JS，照片先用 sharp 裁到画布像素尺寸再内联成 data URI。
// 封面是用户要发出去的成品，画面上只有照片、配色和标题，不印工具名和说明字样。
import sharp from 'sharp';
import type { PaletteSlotValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import type { PhotoFocus } from '../subject/vision.ts';
import { type CoverLayout, type Headline, headlineMarkup, probeMarkup } from './layout.ts';
import { headlineCss, resolveRenderColors, subjectMarkup } from './template.ts';

const PHOTO_JPEG_QUALITY = 82;

export interface PhotoLayer {
    dataUri: string;
    sourceWidth: number;
    sourceHeight: number;
}

export const PHOTO_FITS = ['cover', 'extend'] as const;

export type PhotoFit = (typeof PHOTO_FITS)[number];

export function parsePhotoFit(value: string): PhotoFit {
    if (!PHOTO_FITS.includes(value as PhotoFit)) {
        throw new Error(`Unknown fit "${value}". Use ${PHOTO_FITS.join(', ')}.`);
    }
    return value as PhotoFit;
}

export interface PhotoFraming {
    /** 照片主体，0 到 1 的位置和范围。没有时退回 sharp 的注意力裁切 */
    focus?: PhotoFocus;
    /** 主体要落在画布的哪里，0 到 1 */
    target?: { x: number; y: number };
    /** cover 铺满裁切，extend 整张照片放进去、四周用模糊放大的同一张补满 */
    fit?: PhotoFit;
}

// extend 时背景模糊的强度，按画布短边算，画布越大越糊。
const EXTEND_BLUR_SHARE = 0.03;

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}

/**
 * 在一条边上摆裁切窗口：主体中心尽量落在目标比例上，主体范围放得下时整段留在窗口里，
 * 最后不出原图。全是像素整数。
 */
export function placeWindow(input: {
    source: number;
    window: number;
    focusCenter: number;
    focusSize: number;
    target: number;
}): number {
    const { source, window } = input;
    let start = input.focusCenter - input.target * window;
    const focusStart = input.focusCenter - input.focusSize / 2;
    const focusEnd = input.focusCenter + input.focusSize / 2;
    if (focusEnd - focusStart <= window) {
        start = clamp(start, focusEnd - window, focusStart);
    }
    return Math.round(clamp(start, 0, source - window));
}

async function orientedSize(imagePath: string): Promise<{ width: number; height: number }> {
    const meta = await sharp(imagePath, { failOn: 'error' }).metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(`Cannot read image size from ${imagePath}.`);
    }
    return (meta.orientation ?? 1) >= 5
        ? { width: meta.height, height: meta.width }
        : { width: meta.width, height: meta.height };
}

export async function preparePhotoLayer(
    imagePath: string,
    pixelWidth: number,
    pixelHeight: number,
    framing: PhotoFraming = {},
): Promise<PhotoLayer> {
    const source = await orientedSize(imagePath);
    const upright = await sharp(imagePath, { failOn: 'error' }).rotate().toBuffer();
    const target = framing.target ?? { x: 0.5, y: 0.5 };
    const focus = framing.focus;
    let bytes: Buffer;

    if (framing.fit === 'extend') {
        // 整张照片按比例放进画布，主体尽量对准目标位置，其余地方铺同一张照片的模糊放大版。
        const scale = Math.min(pixelWidth / source.width, pixelHeight / source.height);
        const width = Math.round(source.width * scale);
        const height = Math.round(source.height * scale);
        const fx = (focus?.x ?? 0.5) * width;
        const fy = (focus?.y ?? 0.5) * height;
        const left = Math.round(clamp(target.x * pixelWidth - fx, 0, pixelWidth - width));
        const top = Math.round(clamp(target.y * pixelHeight - fy, 0, pixelHeight - height));
        const blur = Math.max(4, Math.min(pixelWidth, pixelHeight) * EXTEND_BLUR_SHARE);
        const background = await sharp(upright)
            .resize(pixelWidth, pixelHeight, { fit: 'cover' })
            .blur(blur)
            .modulate({ brightness: 0.8 })
            .toBuffer();
        const foreground = await sharp(upright).resize(width, height).toBuffer();
        bytes = await sharp(background)
            .composite([{ input: foreground, left, top }])
            .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
    } else if (focus === undefined) {
        bytes = await sharp(upright)
            .resize(pixelWidth, pixelHeight, { fit: 'cover', position: 'attention' })
            .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
    } else {
        // 按画布比例在原图里取最大的窗口，再挪到主体落在目标位置的地方。
        const aspect = pixelWidth / pixelHeight;
        const windowWidth = Math.min(source.width, Math.round(source.height * aspect));
        const windowHeight = Math.min(source.height, Math.round(source.width / aspect));
        const left = placeWindow({
            source: source.width,
            window: windowWidth,
            focusCenter: focus.x * source.width,
            focusSize: focus.width * source.width,
            target: target.x,
        });
        const top = placeWindow({
            source: source.height,
            window: windowHeight,
            focusCenter: focus.y * source.height,
            focusSize: focus.height * source.height,
            target: target.y,
        });
        bytes = await sharp(upright)
            .extract({ left, top, width: windowWidth, height: windowHeight })
            .resize(pixelWidth, pixelHeight, { fit: 'fill' })
            .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
    }
    return {
        dataUri: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        sourceWidth: source.width,
        sourceHeight: source.height,
    };
}

// 照片封面的标题只占标题区的下面这一截，上面留给照片主体。
const PHOTO_TEXT_SHARE = 0.5;
const ULTRAWIDE_TEXT_SHARE = 0.55;

/**
 * 照片封面给照片主体让位：横版、竖版和自定义画布的标题压在标题区下半。
 * 超宽的标题区本来就是一条扁带，标题改占左边一截，右边留给主体。
 */
export function photoTextLayout(layout: CoverLayout): CoverLayout {
    if (layout.family === 'ultrawide') {
        const area = layout.textArea;
        return {
            ...layout,
            textArea: { ...area, width: Math.round(area.width * ULTRAWIDE_TEXT_SHARE) },
        };
    }
    const area = layout.textArea;
    const height = Math.round(area.height * PHOTO_TEXT_SHARE);
    return { ...layout, textArea: { ...area, y: area.y + area.height - height, height } };
}

/**
 * 照片主体放哪才不和标题抢：标题在标题区下半的左边，横版把主体放右上，竖版放上方，
 * 超宽放在公众号裁切框的右半边。有人物时人物已经占了一侧，照片主体居中。
 */
export function photoFocusTarget(
    layout: CoverLayout,
    hasSubject: boolean,
): { x: number; y: number } {
    if (hasSubject) {
        return { x: 0.5, y: 0.5 };
    }
    switch (layout.family) {
        case 'landscape':
            return { x: 0.7, y: 0.3 };
        case 'portrait':
            return { x: 0.5, y: 0.3 };
        // 标题占公众号裁切框左边，主体放右边：公众号裁切框是 528 到 1393。
        case 'ultrawide':
            return { x: 0.64, y: 0.45 };
        default:
            return layout.width >= layout.height ? { x: 0.7, y: 0.3 } : { x: 0.5, y: 0.3 };
    }
}

interface PhotoCoverBase {
    layout: CoverLayout;
    /** 标题字号和断行方式，由渲染器在标题区域里量出来 */
    headline: Headline;
    palette?: Record<string, PaletteSlotValue>;
    /** 抠好的人物，版式里要有 subjectArea */
    subject?: SubjectLayer;
    /** 照片调色，默认 natural */
    look?: PhotoLook;
}

export const PHOTO_LOOKS = ['natural', 'mono', 'duotone', 'punch'] as const;

export type PhotoLook = (typeof PHOTO_LOOKS)[number];

export function parsePhotoLook(value: string): PhotoLook {
    if (!PHOTO_LOOKS.includes(value as PhotoLook)) {
        throw new Error(`Unknown look "${value}". Use ${PHOTO_LOOKS.join(', ')}.`);
    }
    return value as PhotoLook;
}

// 调色全在合成层用 CSS 做：natural 是调色板的淡罩，mono 黑白，punch 更艳更硬，
// duotone 双色调，暗部压成调色板的深色、亮部染成强调色。
function lookCss(look: PhotoLook): string {
    switch (look) {
        case 'natural':
            return '';
        case 'mono':
            return `
        .photo { filter: grayscale(1) contrast(1.15); }
        .wash { display: none; }`;
        case 'punch':
            return `
        .photo { filter: saturate(1.45) contrast(1.15); }
        .wash { display: none; }`;
        case 'duotone':
            return `
        .photo { filter: grayscale(1) contrast(1.2); }
        .wash { background: var(--cover-accent); opacity: 1; }
        .tone-shadow {
            position: absolute;
            inset: 0;
            z-index: -2;
            background: var(--cover-ink);
            mix-blend-mode: lighten;
        }`;
    }
}

/** 量字号时不需要照片，只排标题和探针 */
export type PhotoCoverOptions =
    | (PhotoCoverBase & { photo: PhotoLayer; measure?: false })
    | (PhotoCoverBase & { measure: true });

export function createPhotoCoverTemplate(text: string, options: PhotoCoverOptions): string {
    const colors = resolveRenderColors(options.palette ?? {});
    const { layout } = options;
    const subject = subjectMarkup(layout, options.measure === true ? undefined : options.subject);
    const photo =
        options.measure === true ? '' : `<img class="photo" src="${options.photo.dataUri}" alt="">`;

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>BeastCover</title>
    <style>
        :root {
            color-scheme: light;
            font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Songti SC", serif;
            --cover-paper: ${colors.paper};
            --cover-ink: ${colors.ink};
            --cover-accent: ${colors.accent};
            background: var(--cover-ink);
            color: var(--cover-paper);
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            width: ${layout.width}px;
            height: ${layout.height}px;
            margin: 0;
            overflow: hidden;
        }

        #canvas {
            position: relative;
            width: ${layout.width}px;
            height: ${layout.height}px;
            isolation: isolate;
        }

        .photo {
            position: absolute;
            inset: 0;
            z-index: -3;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .wash {
            position: absolute;
            inset: 0;
            z-index: -2;
            background: var(--cover-paper);
            mix-blend-mode: multiply;
            opacity: 0.42;
        }
${lookCss(options.look ?? 'natural')}

        .scrim {
            position: absolute;
            inset: 0;
            z-index: -1;
            background: linear-gradient(
                180deg,
                color-mix(in srgb, var(--cover-ink) 34%, transparent) 0%,
                transparent 30%,
                transparent 46%,
                color-mix(in srgb, var(--cover-ink) 86%, transparent) 100%
            );
        }
${headlineCss(layout, options.headline, text)}

        .text-box {
            align-items: flex-end;
        }

        .copy {
            text-shadow: 0 2px 12px color-mix(in srgb, var(--cover-ink) 55%, transparent);
        }
${subject.css}
    </style>
</head>
<body>
    <main id="canvas">
        ${photo}
        ${options.look === 'duotone' ? '<div class="tone-shadow" aria-hidden="true"></div>' : ''}
        <div class="wash" aria-hidden="true"></div>
        <div class="scrim" aria-hidden="true"></div>
        <div class="accent-bar" aria-hidden="true"></div>
        <section class="text-box" aria-label="Headline">
            <p class="copy">${headlineMarkup(text, options.headline)}</p>${options.measure === true ? probeMarkup(text, options.headline) : ''}
        </section>
        ${subject.html}
    </main>
</body>
</html>`;
}
