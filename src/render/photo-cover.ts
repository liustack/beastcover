// 照片封面：图库照片做底图，项目调色板做色调层，正文大字压在下三分之一。
// 渲染引擎禁网禁 JS，照片先用 sharp 裁到画布像素尺寸再内联成 data URI。
// 封面是用户要发出去的成品，画面上只有照片、配色和标题，不印工具名和说明字样。
import sharp from 'sharp';
import type { PaletteSlotValue } from '../styles/schema.ts';
import type { SubjectLayer } from '../subject/index.ts';
import { type CoverLayout, type Headline, headlineMarkup, probeMarkup } from './layout.ts';
import { headlineCss, resolveRenderColors, subjectMarkup } from './template.ts';

const PHOTO_JPEG_QUALITY = 82;

export interface PhotoLayer {
    dataUri: string;
    sourceWidth: number;
    sourceHeight: number;
}

export async function preparePhotoLayer(
    imagePath: string,
    pixelWidth: number,
    pixelHeight: number,
): Promise<PhotoLayer> {
    const image = sharp(imagePath, { failOn: 'error' });
    const meta = await image.metadata();
    if (meta.width === undefined || meta.height === undefined) {
        throw new Error(`Cannot read image size from ${imagePath}.`);
    }
    const bytes = await image
        .rotate()
        .resize(pixelWidth, pixelHeight, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    return {
        dataUri: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        sourceWidth: meta.width,
        sourceHeight: meta.height,
    };
}

interface PhotoCoverBase {
    layout: CoverLayout;
    /** 标题字号和断行方式，由渲染器在标题区域里量出来 */
    headline: Headline;
    palette?: Record<string, PaletteSlotValue>;
    /** 抠好的人物，版式里要有 subjectArea */
    subject?: SubjectLayer;
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
