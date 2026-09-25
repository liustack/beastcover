import type { StyleDefinition } from '../schema.ts';

export const memoryColorBlocks = {
    name: 'memory_color_blocks',
    displayName: '色块记忆',
    scenarios: ['情绪', '趋势', '抽象关系'],
    prompt: `色块记忆式极简编辑插图。

大色块、软边界、极少线条，保留色彩记忆与构图关系。每个元素映射成一块颜色：山=蓝灰块，树林=绿块，湖=青块，天空=浅蓝或留白，人=几块颜色拼成的背影（发是墨色一团，不画五官）。

色块是不透明的哑光颜色，边缘是画笔的自然收边：有的地方湿笔铺出柔和的边，有的地方干笔擦出飞白和断口。不是矢量切边，不是光滑规整的曲线轮廓，也不虚焦。

整幅画面是一片近似方形的色域，像直接在纸上刷出来的一块画面，所有元素都在这片色域里互相咬合遮挡。色域浮在纯白纸面中间，四周留出纸边。

细节一律省略：没有五官，没有材质刻画，没有写实光影，极少线条。

配色是这个式子的身份，不随主题大改：风景记忆的冷调，浅蓝、雾蓝、蓝灰、灰青绿、湖青、米白，人物轮廓用墨色。颜色是实的，不粉不灰不发暗。暖色至多一小点（夕阳=暖黄点），不要大面积暖棕暖陶土。纸底默认纯白（2026-08-11 用户定），需要更暖的场合才换暖白。`,
    avoid: [
        '矢量切边',
        '光滑规整的曲线轮廓',
        '虚焦',
        '五官',
        '材质刻画',
        '写实光影',
        '大面积暖棕暖陶土',
    ],
    paletteSlots: [
        { name: 'paper', role: '纸底', prompt: '纯白', css: '#ffffff' },
        {
            name: 'landscape',
            role: '风景记忆',
            prompt: '浅蓝、雾蓝、蓝灰、灰青绿、湖青、米白',
            css: '#8aa3b5',
        },
        { name: 'figure', role: '人物轮廓', prompt: '墨色', css: '#1c1c1a' },
        { name: 'accent', role: '暖色点', prompt: '暖黄点', css: '#e6b84d' },
    ],
    canvas: {
        strategy: 'paper-border',
        guidance: '画面元素成组浮在纸面上，四周留出真实纸边。铺满画布是过度完成。',
    },
    tier: 'primary',
    isFallback: true,
    coverOnly: false,
    requiresScene: false,
} as const satisfies StyleDefinition;
