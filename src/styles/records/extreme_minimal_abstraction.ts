import type { StyleDefinition } from '../schema.ts';

export const extremeMinimalAbstraction = {
    name: 'extreme_minimal_abstraction',
    displayName: '极致抽象',
    scenarios: ['核心命题', '封面视觉'],
    prompt: `极致抽象极简编辑插图。

把主题压缩到约 5%–15% 的视觉信息量。

画面最多使用：
一个不完整轮廓，
一条主要路径，
一到两个色块，
一个强调点。

必须保留以下具体关系：

【填写原始主题中必须保留的关系】

每个形状、距离、方向、缺口和遮挡都必须对应这个关系，不加入纯装饰元素。

主体要足够大、一眼可辨，至少占画面 15%，不要小到看不见。压缩的是信息量，不是主体的尺寸。构图要有明确重心，但不必居中：主体可以偏在一侧，只要另一侧的留白或色块把画面压住，整体看着是稳的。不要贴边、不要孤零零悬在角落、不要让画面失衡。

允许第一眼抽象，第二眼才辨认出主题关系。

使用 1–3 种低饱和颜色和极大量留白。不要完整画出人物、物体或场景。

避免随机几何图形、渐变球体、漂浮圆环、品牌 Logo 感、孟菲斯设计和无法解释的抽象装饰。

配色（本式推荐，可按当篇文章或产品主题替换）：暖白纸底，1 到 3 种低饱和颜色，大量留白。强调点可用一处暖色。`,
    avoid: [
        '随机几何图形',
        '渐变球体',
        '漂浮圆环',
        '品牌 Logo 感',
        '孟菲斯设计',
        '无法解释的抽象装饰',
    ],
    paletteSlots: [
        { name: 'paper', role: '纸底', prompt: '暖白', css: '#f4efe6' },
        { name: 'colors', role: '主色', prompt: '1 到 3 种低饱和颜色', css: '#8b9aa8' },
        { name: 'accent', role: '强调点', prompt: '一处暖色', css: '#c9895a' },
    ],
    canvas: {
        strategy: 'paper-border',
        guidance: '画面元素成组浮在纸面上，四周留出真实纸边。铺满画布是过度完成。',
    },
    tier: 'accent',
    isFallback: false,
    coverOnly: false,
    requiresScene: false,
    subjectSlot: {
        marker: '【填写原始主题中必须保留的关系】',
        hint: 'This style fills a relationship, not a subject. Keep that relationship as the same event in the article. Do not invent a separate abstract idea.',
    },
} as const satisfies StyleDefinition;
