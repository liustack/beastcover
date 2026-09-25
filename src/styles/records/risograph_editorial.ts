import type { StyleDefinition } from '../schema.ts';

export const risographEditorial = {
    name: 'risograph_editorial',
    displayName: '孔版印刷编辑插画',
    scenarios: ['印刷式高对比冲击力', '题材不限'],
    prompt: `孔版印刷（risograph）编辑插画。用两到三个专色分版套印：每种颜色单独走一遍纸，所以套不准，色块和轮廓之间有一到三毫米错位，颜色越出边界或没盖到位。

专色用孔版特有的鲜亮墨：荧光粉、荧光橙、亮蓝、青、黄、绿，其中荧光粉是这门工艺的招牌色。颜色鲜亮、平涂、不做渐变。

油墨是半透明的，两色叠印处透出第三种颜色，且比单色更深。纸的颜色也会透上来参与成色。

纸是未涂布的纸，纹理粗、吸墨。默认亮白纸；也可以用彩色纸（浅黄、浅蓝、浅粉），彩色纸会让所有油墨的颜色跟着变。不要做旧、不要泛黄发暗的纸。

明暗和层次用网点表示，不用渐变：网点粗、看得见，稀疏处露出纸。

油墨不完全干、覆盖不匀：有的地方墨厚、有的地方发白露纸，边缘有轻微拖蹭。

形体高度概括，平面化，不做体积和阴影，不用细线勾边。

不要出现文字。不要复古海报感、不要照片写实、不要平滑的数字渐变、不要密到糊成一片的网点。

配色（本式推荐，可按当篇文章或产品主题替换）：两到三个专色，荧光粉加靛蓝、或亮蓝加荧光橙、或青加荧光粉加黄。纸底亮白，或换浅色彩纸让整体成色跟着变。颜色鲜亮，这是这一式的身份，不要压成低饱和。`,
    avoid: [
        '文字',
        '复古海报感',
        '照片写实',
        '平滑的数字渐变',
        '密到糊成一片的网点',
        '做旧',
        '泛黄发暗的纸',
    ],
    paletteSlots: [
        { name: 'paper', role: '纸底', prompt: '亮白', css: '#ffffff' },
        {
            name: 'spot',
            role: '专色',
            prompt: '荧光粉加靛蓝、或亮蓝加荧光橙、或青加荧光粉加黄',
            css: '#ff48a5',
        },
    ],
    canvas: {
        strategy: 'full-bleed',
        guidance: '2026-08-23 实测定案：孔版色块出血到画面边缘，不留纸边。',
    },
    tier: 'accent',
    isFallback: false,
    coverOnly: false,
    requiresScene: false,
} as const satisfies StyleDefinition;
