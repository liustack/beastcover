import type { StyleDefinition } from '../schema.ts';

export const tornPaperEditorialCollage = {
    name: 'torn_paper_editorial_collage',
    displayName: '手撕纸编辑拼贴',
    scenarios: ['信息碎片', '重组', '复杂系统'],
    prompt: `手撕纸拼贴编辑插画。画面里的人、桌子、电脑、植物、背景和漂浮的形状，全部由一片一片撕开的纸拼成，不是画出来的。

纸片的边是手撕的：毛糙、不规则、能看见纸的纤维，撕口处露出内层的白边。纸片之间有轻微的翘起和叠压关系，能看出是一层压着一层贴上去的。绝对不要光滑笔直的裁切边，也不要在普通插画上叠一层纸纹当拼贴。

形体高度概括：一个人可能只是三四片纸（头、身体、手臂），一台电脑就是两片纸。只保留最关键的轮廓和姿态，不做细节。

颜色低饱和、中性、成熟：米白、暖灰、深蓝灰、墨绿、浅卡其、灰黑，加少量橙色或赭色作为唯一强调。不用糖果色、荧光色。

构图简洁，主体清楚，留白充足。用纸片的疏密、大小、方向和重叠关系去表达意思（信息扩散、注意力分散、秩序与混乱），不要撒一堆碎纸当装饰。

不要出现文字。不要手账风、不要儿童手工课拼贴、不要卡通、不要立体投影和厚重阴影、不要把画面塞满。

配色（本式推荐，可按当篇文章或产品主题替换）：米白、暖灰、深蓝灰、墨绿、浅卡其、灰黑，一处橙色或赭色作强调。`,
    avoid: ['文字', '手账风', '儿童手工课拼贴', '卡通', '立体投影和厚重阴影', '把画面塞满'],
    paletteSlots: [
        { name: 'paper', role: '纸底', prompt: '米白', css: '#f2eadc' },
        {
            name: 'neutrals',
            role: '中性色',
            prompt: '暖灰、深蓝灰、墨绿、浅卡其、灰黑',
            css: '#8a8580',
        },
        { name: 'accent', role: '强调色', prompt: '橙色或赭色', css: '#c46a38' },
    ],
    canvas: {
        strategy: 'full-bleed',
        guidance:
            '2026-08-23 实测定案：拼贴纸片铺满整幅，不留纸边。构图仍要简洁，靠色块本身的留白呼吸，不靠画面外的白边。',
    },
    tier: 'accent',
    isFallback: false,
    coverOnly: false,
    requiresScene: false,
} as const satisfies StyleDefinition;
