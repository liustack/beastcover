import type { StyleDefinition } from '../schema.ts';

export const luminousImpasto = {
    name: 'luminous_impasto',
    displayName: '明亮厚涂',
    scenarios: ['封面色彩冲击力', '须有景'],
    prompt: `明亮厚涂油画，调色刀画法。用不透明油彩满幅铺开，颜料堆得很厚，刀痕清晰可见，一块一块的色斑铺满整个画面，从近景一直堆到天空和远山。

颜色明亮、饱和、干净：清澈的蓝、青绿、翠绿、暖黄、橙、珊瑚粉、白。光是主角，阳光或夕照要照得画面通亮，水面和亮处用厚厚的白与黄提出来。

形靠色块堆出来，不勾边、不描线：树是一团团亮绿和黄的刀痕，水是一道道横向的厚色，云是厚白的团块，建筑是几块干净的色面。

画面要满，四角都有内容，不留空白纸面。构图是自然的风景视角：有前景、有中景、有远处。画的必须是有纵深的景，不画桌面静物、器物特写或室内摆设。

配色（本式推荐，可按当篇文章或产品主题替换）：明亮饱和，清澈蓝、青绿、翠绿、暖黄、橙、珊瑚粉、厚白。不要低饱和灰调，那是平面六式的语言。`,
    avoid: ['桌面静物', '器物特写', '室内静物', '纯抽象隐喻', '无景的人物特写'],
    paletteSlots: [
        {
            name: 'colors',
            role: '油彩',
            prompt: '清澈蓝、青绿、翠绿、暖黄、橙、珊瑚粉、厚白',
            css: '#3a8fd4',
        },
    ],
    canvas: {
        strategy: 'full-bleed',
        guidance: '画面要满，四角都有内容，不留空白纸面。',
    },
    tier: 'accent',
    isFallback: false,
    coverOnly: true,
    requiresScene: true,
} as const satisfies StyleDefinition;
