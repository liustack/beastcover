// 生成 README 横幅（中英各一张）和 GitHub 社交预览图，全部用 examples/ 里真实出的封面拼。
// 用法：pnpm brand （先 pnpm examples，横幅里的封面就是最新的）
//
// 横幅是一面封面墙：十四种封面类型，每张标上类型和平台。社交预览是左边项目名和一句话、
// 右边三张真实封面，一大两小对齐排。示例封面换了，重新跑一遍即可。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(repo, 'examples');
const assets = join(repo, 'assets');

function dataUri(name) {
    const bytes = readFileSync(join(examples, name));
    const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${type};base64,${bytes.toString('base64')}`;
}

const TILES = {
    'face-text-youtube.png': { en: 'Face with big words', zh: '人物大字', platform: ['YouTube', 'YouTube'] },
    'versus-youtube.jpg': { en: 'Versus', zh: '档位对比', platform: ['YouTube', 'YouTube'] },
    'number-youtube.png': { en: 'Number hook', zh: '数字冲击', platform: ['YouTube', 'YouTube'] },
    'callout-youtube.jpg': { en: 'Callout', zh: '圈注科普', platform: ['YouTube', 'YouTube'] },
    'scene-title-youtube.jpg': { en: 'Scene title', zh: '场景题字', platform: ['YouTube', 'YouTube'] },
    'face-stakes-scene-youtube.jpg': {
        en: 'Face with stakes',
        zh: '人物加赌注',
        platform: ['YouTube', 'YouTube'],
    },
    'big-type-xiaohongshu.png': { en: 'Big type', zh: '大字报', platform: ['Xiaohongshu', '小红书'] },
    'collage-xiaohongshu.jpg': { en: 'Collage', zh: '拼图', platform: ['Xiaohongshu', '小红书'] },
    'before-after-xiaohongshu.jpg': {
        en: 'Before and after',
        zh: '前后对比',
        platform: ['Xiaohongshu', '小红书'],
    },
    'mood-xiaohongshu.jpg': { en: 'Mood', zh: '氛围单图', platform: ['Xiaohongshu', '小红书'] },
    'product-youtube.png': { en: 'Product', zh: '产品主角', platform: ['YouTube', 'YouTube'] },
    'tier-youtube.jpg': { en: 'Tier list', zh: '排行榜', platform: ['YouTube', 'YouTube'] },
    'quote-youtube.png': { en: 'Quote', zh: '金句', platform: ['YouTube', 'YouTube'] },
    'proof-bilibili.png': { en: 'Screenshot proof', zh: '截图证据', platform: ['Bilibili', 'B 站'] },
};

const ROWS = [
    ['face-text-youtube.png', 'versus-youtube.jpg', 'number-youtube.png'],
    ['callout-youtube.jpg', 'scene-title-youtube.jpg', 'face-stakes-scene-youtube.jpg'],
    ['product-youtube.png', 'tier-youtube.jpg', 'quote-youtube.png', 'proof-bilibili.png'],
    [
        'big-type-xiaohongshu.png',
        'collage-xiaohongshu.jpg',
        'before-after-xiaohongshu.jpg',
        'mood-xiaohongshu.jpg',
    ],
];

// 一行里的封面比例不一（B 站比 YouTube 高一点），按宽高比分宽度，整行才等高。
const ASPECT = Object.fromEntries(
    await Promise.all(
        ROWS.flat().map(async (name) => {
            const { width, height } = await sharp(join(examples, name)).metadata();
            return [name, width / height];
        }),
    ),
);

const FONT =
    '"Helvetica Neue", "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", Arial, sans-serif';

function bannerHtml(language) {
    const index = language === 'en' ? 0 : 1;
    const rows = ROWS.map(
        (row) => `<section class="row">${row
            .map((name) => {
                const tile = TILES[name];
                return `<figure style="flex-grow: ${ASPECT[name]}"><img src="${dataUri(name)}" alt=""><figcaption><b>${tile[language]}</b><span>${tile.platform[index]}</span></figcaption></figure>`;
            })
            .join('')}</section>`,
    ).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin: 0; width: 2400px; background: #111214; font-family: ${FONT}; }
        main { padding: 56px; display: flex; flex-direction: column; gap: 40px; }
        .row { display: flex; gap: 32px; }
        figure { margin: 0; flex: 1 1 0; min-width: 0; }
        img { display: block; width: 100%; border-radius: 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
        figcaption { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; color: #8b8f96; font-size: 26px; }
        figcaption b { color: #f3f3f1; font-size: 30px; font-weight: 700; white-space: nowrap; }
    </style></head><body><main>${rows}</main></body></html>`;
}

// 社交预览右边的三张：一张大的在上，两张并排在下，对齐不歪。
const SOCIAL_HERO = 'face-stakes-scene-youtube.jpg';
const SOCIAL_PAIR = ['number-youtube.png', 'scene-title-youtube.jpg'];

// 深色舞台、细字、柔和投影：封面本身已经够吵，底子要安静，让封面当唯一的主角。
function socialHtml() {
    const card = (name, style) =>
        `<img class="card" style="${style}" src="${dataUri(name)}" alt="">`;
    // 大图 1060 宽，下面两张各 518 宽，间距 24，整组在 1280 高里垂直居中。
    const width = 1060;
    const gap = 24;
    const heroHeight = Math.round((width * 9) / 16);
    const pairWidth = (width - gap) / 2;
    const pairHeight = Math.round((pairWidth * 9) / 16);
    const top = Math.round((1280 - (heroHeight + gap + pairHeight)) / 2);
    const left = 1360;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body {
            margin: 0; width: 2560px; height: 1280px; overflow: hidden; position: relative;
            font-family: ${FONT}; color: #f4f4f5;
            background:
                radial-gradient(circle at 76% 46%, rgba(255, 106, 51, 0.22), transparent 42%),
                radial-gradient(circle at 18% 80%, rgba(90, 120, 255, 0.10), transparent 40%),
                #0b0c0f;
        }
        .copy { position: absolute; left: 150px; top: 50%; transform: translateY(-50%); width: 1100px; }
        .eyebrow { font-size: 34px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #ff7a4d; }
        h1 { margin: 28px 0 0; font-size: 210px; line-height: 0.95; font-weight: 800; letter-spacing: -0.045em; }
        p { margin: 40px 0 0; font-size: 58px; line-height: 1.22; font-weight: 500; color: #a1a1aa; letter-spacing: -0.01em; }
        .command {
            display: inline-flex; gap: 22px; margin-top: 64px; padding: 26px 38px;
            border-radius: 22px; background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            font: 500 38px Menlo, monospace; color: #e4e4e7; white-space: nowrap;
        }
        .command span { color: #71717a; }
        .card {
            position: absolute; border-radius: 22px;
            border: 1px solid rgba(255, 255, 255, 0.10);
            box-shadow: 0 40px 90px rgba(0, 0, 0, 0.55), 0 8px 24px rgba(0, 0, 0, 0.35);
        }
    </style></head><body>
        <div class="copy">
            <div class="eyebrow">14 cover types · every platform</div>
            <h1>BeastCover</h1>
            <p>Covers that get the click,<br>checked before you ship.</p>
            <div class="command"><span>$</span>npx -y skills add liustack/beastcover -g</div>
        </div>
        ${card(SOCIAL_HERO, `left: ${left}px; top: ${top}px; width: ${width}px; height: ${heroHeight}px;`)}
        ${SOCIAL_PAIR.map((name, index) =>
            card(
                name,
                `left: ${left + index * (pairWidth + gap)}px; top: ${top + heroHeight + gap}px; width: ${pairWidth}px; height: ${pairHeight}px;`,
            ),
        ).join('')}
    </body></html>`;
}

const browser = await chromium.launch({ headless: true });
try {
    const shoot = async (html, width, height, output) => {
        const page = await browser.newPage({ viewport: { width, height: height ?? 800 } });
        await page.setContent(html, { waitUntil: 'load' });
        const png = await page.screenshot({ type: 'png', fullPage: height === undefined });
        await page.close();
        await sharp(png).jpeg({ quality: 88, mozjpeg: true }).toFile(output);
        console.log(`Wrote ${output}`);
    };
    await shoot(bannerHtml('en'), 2400, undefined, join(assets, 'banner.jpg'));
    await shoot(bannerHtml('zh'), 2400, undefined, join(assets, 'banner.zh-CN.jpg'));
    await shoot(socialHtml(), 2560, 1280, join(assets, 'social-preview.jpg'));
} finally {
    await browser.close();
}
