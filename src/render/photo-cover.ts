// 照片封面：图库照片做底图，项目调色板做色调层，正文大字压在下三分之一。
// 渲染引擎禁网禁 JS，照片先用 sharp 裁到画布像素尺寸再内联成 data URI。
// 封面是用户要发出去的成品，画面上只有照片、配色和标题，不印工具名和说明字样。
import sharp from 'sharp';
import type { PaletteSlotValue } from '../styles/schema.ts';
import { resolveRenderColors } from './template.ts';

const PHOTO_JPEG_QUALITY = 82;

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

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

export interface PhotoCoverOptions {
    palette?: Record<string, PaletteSlotValue>;
    photo: PhotoLayer;
}

export function createPhotoCoverTemplate(text: string, options: PhotoCoverOptions): string {
    const safeText = escapeHtml(text);
    const characterCount = Array.from(text.trim()).length;
    const density = characterCount <= 40 ? 'short' : characterCount <= 100 ? 'medium' : 'long';
    const colors = resolveRenderColors(options.palette ?? {});

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
            width: 100%;
            height: 100%;
            margin: 0;
            overflow: hidden;
        }

        #canvas {
            position: relative;
            display: flex;
            align-items: flex-end;
            width: 100vw;
            height: 100vh;
            padding: 6vh 5.6vw 7.2vh;
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

        #canvas::before {
            position: absolute;
            inset: 0 auto 0 0;
            width: 1.25vw;
            min-width: 10px;
            content: "";
            background: var(--cover-accent);
        }

        .copy {
            margin: 0;
            font-weight: 600;
            letter-spacing: -0.05em;
            line-height: 0.98;
            text-wrap: balance;
            white-space: pre-wrap;
            /* 中文只在标点和空格处换行，整句没有标点时才退回逐字断开。 */
            word-break: keep-all;
            overflow-wrap: anywhere;
            text-shadow: 0 2px 12px color-mix(in srgb, var(--cover-ink) 55%, transparent);
        }

        .copy[data-density="short"] {
            max-width: 12em;
            font-size: clamp(44px, min(6.8vw, 15vh), 120px);
        }

        .copy[data-density="medium"] {
            max-width: 18em;
            font-size: clamp(32px, min(4vw, 10vh), 72px);
            line-height: 1;
        }

        .copy[data-density="long"] {
            max-width: 28em;
            font-size: clamp(22px, min(2.4vw, 6vh), 44px);
            line-height: 1.08;
            text-wrap: pretty;
        }
    </style>
</head>
<body>
    <main id="canvas">
        <img class="photo" src="${options.photo.dataUri}" alt="">
        <div class="wash" aria-hidden="true"></div>
        <div class="scrim" aria-hidden="true"></div>
        <p class="copy" data-density="${density}">${safeText}</p>
    </main>
</body>
</html>`;
}
