import { type PaletteSlotValue, parseCssColorValue } from '../styles/schema.ts';

export const DEFAULT_RENDER_COLORS = {
    paper: '#f1eee6',
    ink: '#161711',
    accent: '#1746d1',
} as const;

export interface RenderTemplateOptions {
    palette?: Record<string, PaletteSlotValue>;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function slotCss(palette: Record<string, PaletteSlotValue>, name: string): string | undefined {
    const slot = palette[name];
    if (slot === undefined) {
        return undefined;
    }
    if (typeof slot.css !== 'string') {
        throw new Error(`Palette slot "${name}" is missing a CSS color.`);
    }
    return parseCssColorValue(slot.css);
}

export function resolveRenderColors(palette: Record<string, PaletteSlotValue> = {}): {
    paper: string;
    ink: string;
    accent: string;
} {
    return {
        paper:
            slotCss(palette, 'paper') ??
            slotCss(palette, 'background') ??
            DEFAULT_RENDER_COLORS.paper,
        ink: slotCss(palette, 'dark') ?? DEFAULT_RENDER_COLORS.ink,
        accent:
            slotCss(palette, 'accent') ??
            slotCss(palette, 'primary') ??
            DEFAULT_RENDER_COLORS.accent,
    };
}

export function createRenderTemplate(text: string, options: RenderTemplateOptions = {}): string {
    const safeText = escapeHtml(text);
    const characterCount = Array.from(text.trim()).length;
    const density = characterCount <= 48 ? 'short' : characterCount <= 120 ? 'medium' : 'long';
    const palette = options.palette ?? {};
    for (const [name, slot] of Object.entries(palette)) {
        if (typeof slot.css !== 'string') {
            throw new Error(`Palette slot "${name}" is missing a CSS color.`);
        }
        parseCssColorValue(slot.css);
    }
    const colors = resolveRenderColors(palette);
    const paletteJson = escapeHtml(JSON.stringify(palette));

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
            background: var(--cover-paper);
            color: var(--cover-ink);
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

        body {
            background: var(--cover-paper);
        }

        #canvas {
            position: relative;
            display: grid;
            grid-template-rows: auto 1fr auto;
            width: 100vw;
            height: 100vh;
            padding: 6.2vh 5.6vw 5.4vh;
            isolation: isolate;
        }

        #canvas::before {
            position: absolute;
            inset: 0 auto 0 0;
            width: 1.25vw;
            min-width: 10px;
            content: "";
            background: var(--cover-accent);
        }

        header,
        footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
            font-size: clamp(11px, 1.05vw, 18px);
            font-weight: 650;
            letter-spacing: 0.13em;
            line-height: 1;
            text-transform: uppercase;
        }

        header {
            padding-bottom: 2.1vh;
            border-bottom: 1px solid rgba(22, 23, 17, 0.28);
        }

        .brand {
            font-family: "Helvetica Neue", "PingFang SC", sans-serif;
            font-size: clamp(18px, 1.75vw, 30px);
            font-weight: 800;
            letter-spacing: -0.045em;
            text-transform: none;
        }

        .copy-wrap {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(70px, 11vw);
            gap: 5vw;
            align-items: center;
            min-height: 0;
            padding: 4.5vh 0 5vh;
        }

        .copy {
            margin: 0;
            font-weight: 600;
            letter-spacing: -0.055em;
            line-height: 0.98;
            text-wrap: balance;
            white-space: pre-wrap;
        }

        .copy[data-density="short"] {
            max-width: 14em;
            font-size: clamp(40px, min(6.2vw, 14vh), 112px);
        }

        .copy[data-density="medium"] {
            max-width: 20em;
            font-size: clamp(30px, min(3.6vw, 9vh), 68px);
            line-height: 1;
        }

        .copy[data-density="long"] {
            max-width: 32em;
            font-size: clamp(20px, min(2.2vw, 5.6vh), 42px);
            line-height: 1.08;
            text-wrap: pretty;
        }

        .system-mark {
            display: grid;
            grid-template-rows: 1fr 1fr 1fr;
            height: min(46vh, 430px);
            border: 1px solid rgba(22, 23, 17, 0.45);
        }

        .system-mark span {
            display: block;
            border-bottom: 1px solid rgba(22, 23, 17, 0.45);
        }

        .system-mark span:nth-child(2) {
            background: var(--cover-accent);
        }

        .system-mark span:last-child {
            border-bottom: 0;
        }

        footer {
            padding-top: 2.1vh;
            border-top: 1px solid rgba(22, 23, 17, 0.28);
        }

        .local {
            color: var(--cover-accent);
        }
    </style>
</head>
<body>
    <main id="canvas">
        <header>
            <span class="brand">BeastCover</span>
            <span>Visual system / 001</span>
        </header>
        <section class="copy-wrap" aria-label="Rendered text">
            <p class="copy" data-density="${density}">${safeText}</p>
            <div class="system-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        </section>
        <footer>
            <span>One story · one visual language</span>
            <span class="local">Local render</span>
        </footer>
    </main>
    <script type="application/json" id="beastcover-palette">${paletteJson}</script>
</body>
</html>`;
}
