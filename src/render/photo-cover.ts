// 照片怎么放进封面：按主体构图、整张放进去（extend）、圈注的红圈和箭头、照片封面的标题位置。
// 渲染引擎禁网禁 JS，照片先用 sharp 裁到画布像素尺寸再内联成 data URI。
import sharp from 'sharp';
import type { Rect } from '../platforms/index.ts';
import type { PhotoFocus } from '../subject/vision.ts';
import type { CoverLayout } from './layout.ts';

export const PHOTO_JPEG_QUALITY = 82;

export interface PhotoLayer {
    dataUri: string;
    sourceWidth: number;
    sourceHeight: number;
    /** 照片主体落在画布上的范围（0 到 1）。按主体构图时才有 */
    focusBox?: Rect;
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
    /** 画布里平台真正会显示的区域，0 到 1。主体和 extend 的清晰照片都放在这里面 */
    visible?: Rect;
    /**
     * 构图用的画布比例，默认就是截图像素。母版乘 scale 再取整后比例会差一点点，
     * 圈注要求渲染前的检查和出图构图完全一致，所以传版式的宽高来构图
     */
    canvas?: { width: number; height: number };
}

// extend 时背景模糊的强度，按画布短边算，画布越大越糊。
const EXTEND_BLUR_SHARE = 0.03;

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}

/**
 * 在一条边上摆裁切窗口：主体中心尽量落在目标比例上，主体范围整段留在窗口的可见段里
 * （可见段是窗口里平台真正会显示的那一截，默认整个窗口），放不下可见段就至少留在窗口里，
 * 最后不出原图。全是像素整数。
 */
export function placeWindow(input: {
    source: number;
    window: number;
    focusCenter: number;
    focusSize: number;
    target: number;
    visible?: [number, number];
}): number {
    const { source, window } = input;
    const [visibleStart, visibleEnd] = input.visible ?? [0, 1];
    const target = clamp(input.target, visibleStart, visibleEnd);
    let start = input.focusCenter - target * window;
    const focusStart = input.focusCenter - input.focusSize / 2;
    const focusEnd = input.focusCenter + input.focusSize / 2;
    const focusSize = focusEnd - focusStart;
    if (focusSize <= (visibleEnd - visibleStart) * window) {
        start = clamp(start, focusEnd - visibleEnd * window, focusStart - visibleStart * window);
    } else if (focusSize <= window) {
        start = clamp(start, focusEnd - window, focusStart);
    }
    return Math.round(clamp(start, 0, source - window));
}

export interface FramedPhoto {
    /** 原图里取的窗口，像素 */
    left: number;
    top: number;
    width: number;
    height: number;
    /** 主体范围是否整个落在可见区域里 */
    focusVisible: boolean;
}

/**
 * 按画布比例在原图里取最大的窗口，挪到主体落在目标位置、并留在可见区域里的地方。
 * visible 是画布里平台真正会显示的区域（0 到 1），默认整张画布。
 */
export function framePhoto(input: {
    source: { width: number; height: number };
    canvas: { width: number; height: number };
    focus: PhotoFocus;
    target: { x: number; y: number };
    visible?: Rect;
}): FramedPhoto {
    const { source, focus } = input;
    const visible = input.visible ?? { x: 0, y: 0, width: 1, height: 1 };
    const aspect = input.canvas.width / input.canvas.height;
    const width = Math.min(source.width, Math.round(source.height * aspect));
    const height = Math.min(source.height, Math.round(source.width / aspect));
    const xRange: [number, number] = [visible.x, visible.x + visible.width];
    const yRange: [number, number] = [visible.y, visible.y + visible.height];
    const left = placeWindow({
        source: source.width,
        window: width,
        focusCenter: focus.x * source.width,
        focusSize: focus.width * source.width,
        target: input.target.x,
        visible: xRange,
    });
    const top = placeWindow({
        source: source.height,
        window: height,
        focusCenter: focus.y * source.height,
        focusSize: focus.height * source.height,
        target: input.target.y,
        visible: yRange,
    });
    const inside = (
        center: number,
        size: number,
        start: number,
        window: number,
        range: [number, number],
    ) =>
        center - size / 2 >= start + range[0] * window - 1 &&
        center + size / 2 <= start + range[1] * window + 1;
    return {
        left,
        top,
        width,
        height,
        focusVisible:
            inside(focus.x * source.width, focus.width * source.width, left, width, xRange) &&
            inside(focus.y * source.height, focus.height * source.height, top, height, yRange),
    };
}

/** 版式里记录的平台可见区域换算成画布的 0 到 1 */
export function visibleFraction(layout: CoverLayout): Rect | undefined {
    const area = layout.visibleArea;
    if (area === undefined) {
        return undefined;
    }
    return {
        x: area.x / layout.width,
        y: area.y / layout.height,
        width: area.width / layout.width,
        height: area.height / layout.height,
    };
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
    let focusBox: Rect | undefined;

    const visible = framing.visible ?? { x: 0, y: 0, width: 1, height: 1 };
    if (framing.fit === 'extend') {
        // 整张照片按比例放进平台可见区域，主体尽量对准目标位置，其余地方铺同一张照片的模糊放大版。
        const area = {
            x: visible.x * pixelWidth,
            y: visible.y * pixelHeight,
            width: visible.width * pixelWidth,
            height: visible.height * pixelHeight,
        };
        const scale = Math.min(area.width / source.width, area.height / source.height);
        const width = Math.round(source.width * scale);
        const height = Math.round(source.height * scale);
        const fx = (focus?.x ?? 0.5) * width;
        const fy = (focus?.y ?? 0.5) * height;
        const left = Math.round(
            clamp(target.x * pixelWidth - fx, area.x, area.x + area.width - width),
        );
        const top = Math.round(
            clamp(target.y * pixelHeight - fy, area.y, area.y + area.height - height),
        );
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
        const framed = framePhoto({
            source,
            canvas: framing.canvas ?? { width: pixelWidth, height: pixelHeight },
            focus,
            target,
            visible,
        });
        bytes = await sharp(upright)
            .extract({
                left: framed.left,
                top: framed.top,
                width: framed.width,
                height: framed.height,
            })
            .resize(pixelWidth, pixelHeight, { fit: 'fill' })
            .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
        focusBox = {
            x: ((focus.x - focus.width / 2) * source.width - framed.left) / framed.width,
            y: ((focus.y - focus.height / 2) * source.height - framed.top) / framed.height,
            width: (focus.width * source.width) / framed.width,
            height: (focus.height * source.height) / framed.height,
        };
    }
    return {
        dataUri: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        sourceWidth: source.width,
        sourceHeight: source.height,
        ...(focusBox === undefined ? {} : { focusBox }),
    };
}

// 圈注：红圈比主体范围四周各大这么多（按主体宽高算）。
const CALLOUT_PAD = 0.15;
// 主体超过画面这么大就不圈：圈住半个画面等于没圈。
const CALLOUT_MAX_WIDTH = 0.45;
const CALLOUT_MAX_HEIGHT = 0.6;
// 下面几个都按画布短边算：红圈最小半径、线宽、红圈离可见区边缘的距离、
// 箭头起点离边缘的距离、箭杆想要的长度、箭杆最短能接受的长度。
const CALLOUT_MIN_RADIUS = 0.06;
const CALLOUT_STROKE = 0.012;
const CALLOUT_RING_MARGIN = 0.03;
const CALLOUT_ARROW_MARGIN = 0.06;
const CALLOUT_ARROW_REACH = 0.2;
const CALLOUT_ARROW_MIN = 0.08;
// 白边是红线的这么多倍宽。
const CALLOUT_HALO = 2.2;
// 箭头先试「标题中心指向红圈」的方向，被挡住时左右转着试。
const CALLOUT_ARROW_TURNS = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];

export interface CalloutShape {
    /** 红圈中心和半径，画布像素 */
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    /** 红线宽度，白边是它的 CALLOUT_HALO 倍 */
    stroke: number;
    /** 箭杆起点和箭尖，箭尖落在红圈外一点 */
    arrow: { start: { x: number; y: number }; end: { x: number; y: number } };
}

/** 椭圆（连外边一起）和矩形有没有碰到：把坐标按半径缩成单位圆，再做圆和矩形的最近点判断 */
function ellipseMeetsRect(
    ellipse: { cx: number; cy: number; rx: number; ry: number },
    rect: Rect,
): boolean {
    const nearestX = clamp(ellipse.cx, rect.x, rect.x + rect.width);
    const nearestY = clamp(ellipse.cy, rect.y, rect.y + rect.height);
    const dx = (nearestX - ellipse.cx) / ellipse.rx;
    const dy = (nearestY - ellipse.cy) / ellipse.ry;
    return dx * dx + dy * dy <= 1;
}

type Point = { x: number; y: number };

/** 线段和矩形有没有相交，Liang-Barsky 裁剪：把线段参数区间按四条边逐条收窄，收空了就是不交 */
function segmentMeetsRect(from: Point, to: Point, rect: Rect): boolean {
    let enter = 0;
    let exit = 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (const [p, q] of [
        [-dx, from.x - rect.x],
        [dx, rect.x + rect.width - from.x],
        [-dy, from.y - rect.y],
        [dy, rect.y + rect.height - from.y],
    ]) {
        if (p === 0) {
            if (q < 0) {
                return false;
            }
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > exit) {
                return false;
            }
            enter = Math.max(enter, t);
        } else {
            if (t < enter) {
                return false;
            }
            exit = Math.min(exit, t);
        }
    }
    return true;
}

/** 一条有宽度的线（线宽的一半是 pad）有没有碰到这些矩形：矩形四周各放大 pad 再和中心线求交 */
function strokeMeetsRects(from: Point, to: Point, pad: number, rects: readonly Rect[]): boolean {
    return rects.some((rect) =>
        segmentMeetsRect(from, to, {
            x: rect.x - pad,
            y: rect.y - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
        }),
    );
}

// 箭头：箭尖离红圈这么多个线宽，两翼这么多个线宽长、和箭杆夹这么多弧度。
const CALLOUT_TIP_GAP = 2.5;
const CALLOUT_HEAD = 4;
const CALLOUT_WING_ANGLE = 0.5;

/** 箭头两翼的端点，从箭尖往回张开 */
export function arrowWings(start: Point, end: Point, stroke: number): [Point, Point] {
    const head = stroke * CALLOUT_HEAD;
    const along = Math.atan2(end.y - start.y, end.x - start.x);
    const wing = (side: number): Point => ({
        x: end.x - head * Math.cos(along + side * CALLOUT_WING_ANGLE),
        y: end.y - head * Math.sin(along + side * CALLOUT_WING_ANGLE),
    });
    return [wing(1), wing(-1)];
}

/** 圈注做不到时的报错，where 点名是哪几张封面 */
function calloutRefusal(where: string, problem: string): Error {
    return new Error(
        `The callout cannot mark the subject on ${where}: ${problem}. Pick a photo where the subject is small and has empty space around it, or use another --template.`,
    );
}

/** 红圈的中心、半径和线宽，画布像素。主体太大就不圈：圈住半个画面等于没圈 */
function calloutRing(
    layout: CoverLayout,
    box: Rect,
    where: string,
): { cx: number; cy: number; rx: number; ry: number; stroke: number; halo: number } {
    if (box.width > CALLOUT_MAX_WIDTH || box.height > CALLOUT_MAX_HEIGHT) {
        throw new Error(
            `The callout on ${where}: the subject covers ${Math.round(box.width * 100)}% of the width and ${Math.round(box.height * 100)}% of the height, too big to circle. Pick a photo with one small, clear subject.`,
        );
    }
    const w = layout.width;
    const h = layout.height;
    const unit = Math.min(w, h);
    const stroke = Math.max(4, Math.round(unit * CALLOUT_STROKE));
    return {
        cx: (box.x + box.width / 2) * w,
        cy: (box.y + box.height / 2) * h,
        rx: Math.max((box.width * w * (1 + CALLOUT_PAD * 2)) / 2, unit * CALLOUT_MIN_RADIUS),
        ry: Math.max((box.height * h * (1 + CALLOUT_PAD * 2)) / 2, unit * CALLOUT_MIN_RADIUS),
        stroke,
        halo: (stroke * CALLOUT_HALO) / 2,
    };
}

/**
 * 照片按 cover 构图摆进画布后主体范围落在哪，画布的 0 到 1。构图和出图用的是同一个
 * framePhoto，这里算出来的和 preparePhotoLayer 记的 focusBox 一致。
 */
export function framedFocusBox(
    photo: { width: number; height: number },
    focus: PhotoFocus,
    layout: CoverLayout,
    hasSubject: boolean,
): Rect {
    const framed = framePhoto({
        source: photo,
        canvas: { width: layout.width, height: layout.height },
        focus,
        target: photoFocusTarget(layout, hasSubject),
        visible: visibleFraction(layout),
    });
    return {
        x: ((focus.x - focus.width / 2) * photo.width - framed.left) / framed.width,
        y: ((focus.y - focus.height / 2) * photo.height - framed.top) / framed.height,
        width: (focus.width * photo.width) / framed.width,
        height: (focus.height * photo.height) / framed.height,
    };
}

/** 圈注要按平台的可见区和遮挡区算，合成入口一定填了它们。没填是调用方的 bug，直接报错 */
function calloutAreas(layout: CoverLayout): { visible: Rect; covered: readonly Rect[] } {
    if (layout.visibleArea === undefined || layout.coveredAreas === undefined) {
        throw new Error(
            'The callout needs the visible and covered areas of the requested platforms.',
        );
    }
    return { visible: layout.visibleArea, covered: layout.coveredAreas };
}

// 圈注封面的标题带：至少留标题区高度的这么多，圈和标题带之间空这么多（按画布短边）。
const CALLOUT_MIN_TEXT_SHARE = 0.2;
const CALLOUT_TEXT_GAP = 0.02;

/**
 * 圈注封面的版式：标题带还是标题区下半，但红圈伸进来多少就再往下缩多少，圈永远压不到字。
 * 缩到剩不下五分之一就报错换图。主体框只由可见区和构图目标决定，和标题带无关，所以
 * 这里算的圈和出图时的一致。
 */
export function calloutLayout(
    layout: CoverLayout,
    photo: { width: number; height: number },
    focus: PhotoFocus,
    where = 'this cover',
): CoverLayout {
    calloutAreas(layout);
    const usual = photoTextLayout(layout);
    const ring = calloutRing(layout, framedFocusBox(photo, focus, layout, false), where);
    const gap = Math.min(layout.width, layout.height) * CALLOUT_TEXT_GAP;
    const area = usual.textArea;
    const bottom = area.y + area.height;
    const top = Math.max(area.y, Math.round(ring.cy + ring.ry + ring.halo + gap));
    if (bottom - top < layout.textArea.height * CALLOUT_MIN_TEXT_SHARE) {
        throw calloutRefusal(where, 'the red circle would leave no room for the headline below it');
    }
    return { ...usual, textArea: { ...area, y: top, height: bottom - top } };
}

/**
 * 红圈圈住照片主体，一支箭头从背离标题的空处指过来。教育和技术频道的爆款常用这一手
 * （90 张头部缩略图里 14 张有红圈或箭头）。
 *
 * 圈和整支箭头都要留在本次平台都看得见的区域里，不压标题带，不落进平台界面盖住的地方。
 * 做不到就报错，不画一半：合成前 checkCallout 用同一个函数先算一遍，所以真到画的时候
 * 这里不会再失败。where 是报错时点名的封面。
 */
export function calloutGeometry(
    layout: CoverLayout,
    box: Rect,
    where = 'this cover',
): CalloutShape {
    const refuse = (problem: string): never => {
        throw calloutRefusal(where, problem);
    };
    const { visible, covered } = calloutAreas(layout);
    const { cx, cy, rx, ry, stroke, halo } = calloutRing(layout, box, where);
    const unit = Math.min(layout.width, layout.height);
    const ring = { cx, cy, rx: rx + halo, ry: ry + halo };

    const text = layout.textArea;
    const ringMargin = unit * CALLOUT_RING_MARGIN;
    if (
        ring.cx - ring.rx < visible.x + ringMargin ||
        ring.cx + ring.rx > visible.x + visible.width - ringMargin ||
        ring.cy - ring.ry < visible.y + ringMargin ||
        ring.cy + ring.ry > visible.y + visible.height - ringMargin
    ) {
        refuse('the red circle would be cut off at the edge of the cover');
    }
    if (ellipseMeetsRect(ring, text)) {
        refuse('the red circle would run into the headline');
    }
    if (covered.some((rect) => ellipseMeetsRect(ring, rect))) {
        refuse("the red circle would sit under the app's buttons");
    }

    // 箭头起点：从背离标题的方向起转着试，起点夹进可见区。要求起点在箭尖那圈椭圆外面
    // （箭头才是指向红圈的）、箭杆够长、箭杆和两翼连白边都不碰标题带或遮挡区。挑箭杆最长的。
    const base = Math.atan2(cy - (text.y + text.height / 2), cx - (text.x + text.width / 2));
    const reach = Math.max(rx, ry) + unit * CALLOUT_ARROW_REACH;
    const arrowMargin = unit * CALLOUT_ARROW_MARGIN;
    const blocked = [text, ...covered];
    const tipGap = stroke * CALLOUT_TIP_GAP;
    const shaftPad = (stroke * CALLOUT_HALO * 1.3) / 2;
    let start: Point | undefined;
    let end: Point | undefined;
    let best = unit * CALLOUT_ARROW_MIN;
    for (const turn of CALLOUT_ARROW_TURNS) {
        const angle = base + (turn * Math.PI) / 180;
        const candidate = {
            x: clamp(
                cx + Math.cos(angle) * reach,
                visible.x + arrowMargin,
                visible.x + visible.width - arrowMargin,
            ),
            y: clamp(
                cy + Math.sin(angle) * reach,
                visible.y + arrowMargin,
                visible.y + visible.height - arrowMargin,
            ),
        };
        const outsideTip =
            ((candidate.x - cx) / (rx + tipGap)) ** 2 + ((candidate.y - cy) / (ry + tipGap)) ** 2;
        if (outsideTip <= 1) {
            continue;
        }
        // 箭尖在红圈外一点，朝着起点。
        const toward = Math.atan2(candidate.y - cy, candidate.x - cx);
        const tip = {
            x: cx + (rx + tipGap) * Math.cos(toward),
            y: cy + (ry + tipGap) * Math.sin(toward),
        };
        const length = Math.hypot(candidate.x - tip.x, candidate.y - tip.y);
        if (length < best) {
            continue;
        }
        const wings = arrowWings(candidate, tip, stroke);
        // 起点、箭尖和两翼端点连圆头白边都要留在可见区内。起点虽然夹进了可见区，但小画布上
        // 线宽有下限，白边和翼长不随短边同比缩小，箭尖和翼端可能伸出边界被切掉。
        const insideVisible = (point: Point): boolean =>
            point.x >= visible.x + shaftPad &&
            point.x <= visible.x + visible.width - shaftPad &&
            point.y >= visible.y + shaftPad &&
            point.y <= visible.y + visible.height - shaftPad;
        if (![candidate, tip, ...wings].every(insideVisible)) {
            continue;
        }
        if (
            strokeMeetsRects(candidate, tip, shaftPad, blocked) ||
            wings.some((wing) => strokeMeetsRects(wing, tip, shaftPad, blocked))
        ) {
            continue;
        }
        best = length;
        start = candidate;
        end = tip;
    }
    if (start === undefined || end === undefined) {
        return refuse('there is no clear side to point the arrow from');
    }
    return { cx, cy, rx, ry, stroke, arrow: { start, end } };
}

export function calloutMarkup(layout: CoverLayout, box: Rect): string {
    const { cx, cy, rx, ry, stroke, arrow } = calloutGeometry(layout, box);
    const { start, end } = arrow;
    const [left, right] = arrowWings(start, end, stroke);
    const path = `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`;
    const ink = (width: number, color: string) =>
        `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
    const shapes = (width: number, color: string) => `
            <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${ink(width, color)}/>
            <path d="${path}" ${ink(width * 1.3, color)}/>`;
    return `<svg class="callout" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" aria-hidden="true">${shapes(stroke * CALLOUT_HALO, '#ffffff')}${shapes(stroke, '#ff2a2a')}
        </svg>`;
}

// 照片封面的标题只占标题区的下面这一截，上面留给照片主体。
const PHOTO_TEXT_SHARE = 0.5;

/**
 * 前后对比的一个面板：平台只看得到面板的一截时（公众号只露出接缝两边），清晰照片按主体
 * 构图放进这一截，面板其余部分铺同一张照片的模糊放大版。整块都看得见时就是普通构图。
 */
export async function preparePanelLayer(
    imagePath: string,
    pixelWidth: number,
    pixelHeight: number,
    framing: { focus: PhotoFocus; visible: Rect },
): Promise<PhotoLayer> {
    const { visible } = framing;
    const full = visible.x <= 0 && visible.y <= 0 && visible.width >= 1 && visible.height >= 1;
    if (full) {
        return preparePhotoLayer(imagePath, pixelWidth, pixelHeight, {
            focus: framing.focus,
            target: { x: 0.5, y: 0.5 },
        });
    }
    const left = Math.round(visible.x * pixelWidth);
    const top = Math.round(visible.y * pixelHeight);
    const width = Math.round(visible.width * pixelWidth);
    const height = Math.round(visible.height * pixelHeight);
    const sharpPart = await preparePhotoLayer(imagePath, width, height, {
        focus: framing.focus,
        target: { x: 0.5, y: 0.5 },
    });
    const upright = await sharp(imagePath, { failOn: 'error' }).rotate().toBuffer();
    const blur = Math.max(4, Math.min(pixelWidth, pixelHeight) * EXTEND_BLUR_SHARE);
    const background = await sharp(upright)
        .resize(pixelWidth, pixelHeight, { fit: 'cover' })
        .blur(blur)
        .modulate({ brightness: 0.8 })
        .toBuffer();
    const foreground = Buffer.from(
        sharpPart.dataUri.slice(sharpPart.dataUri.indexOf(',') + 1),
        'base64',
    );
    const bytes = await sharp(background)
        .composite([{ input: foreground, left, top }])
        .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    return {
        dataUri: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        sourceWidth: sharpPart.sourceWidth,
        sourceHeight: sharpPart.sourceHeight,
    };
}

/**
 * 照片封面给照片主体让位：每一族和自定义画布的标题都压在标题区下半。
 */
export function photoTextLayout(layout: CoverLayout): CoverLayout {
    const area = layout.textArea;
    const height = Math.round(area.height * PHOTO_TEXT_SHARE);
    return { ...layout, textArea: { ...area, y: area.y + area.height - height, height } };
}

/**
 * 照片主体放哪才不和标题抢：标题在标题区下半，横版和超宽把主体放右上，竖版放上方。
 * 有人物时人物已经占了一侧，照片主体居中。
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
        case 'ultrawide':
            return { x: 0.7, y: 0.3 };
        case 'portrait':
            return { x: 0.5, y: 0.3 };
        default:
            return layout.width >= layout.height ? { x: 0.7, y: 0.3 } : { x: 0.5, y: 0.3 };
    }
}

export const PHOTO_LOOKS = ['natural', 'mono', 'duotone', 'punch'] as const;

export type PhotoLook = (typeof PHOTO_LOOKS)[number];

export function parsePhotoLook(value: string): PhotoLook {
    if (!PHOTO_LOOKS.includes(value as PhotoLook)) {
        throw new Error(`Unknown look "${value}". Use ${PHOTO_LOOKS.join(', ')}.`);
    }
    return value as PhotoLook;
}
