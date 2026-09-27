// 封面类型：每个类型是一整套配方（画面从哪来、字怎么做、怎么排），--template 选类型。
// 这里登记每个类型要什么素材、接受哪些选项，把参数组装成 composeCovers 用的 CoverTemplate。
// 类型的来历和各平台的主流封面见 .issues/2026-09-27-breakout-design/research.md 第 5 节。
import type { CoverTemplate } from '../compose/index.ts';
import type { PhotoFit, PhotoLook } from '../render/photo-cover.ts';
import type { SubjectLayer } from '../subject/index.ts';
import { bigTypeTemplate } from './big-type.ts';
import { COLLAGE_MAX, COLLAGE_MIN, collageTemplate } from './collage.ts';
import { faceStakesTemplate, faceTextTemplate } from './face.ts';
import { numberGenreTemplate } from './number.ts';
import type { FontKit, GenrePhoto } from './page.ts';
import { calloutTemplate, moodTemplate, sceneTitleTemplate } from './photo.ts';
import { isLightScheme, type SchemeName } from './schemes.ts';
import { beforeAfterTemplate, versusTemplate } from './split.ts';
import type { StyleName } from './styles.ts';

export const GENRE_NAMES = [
    'big-type',
    'number',
    'face-text',
    'face-stakes',
    'versus',
    'before-after',
    'scene-title',
    'callout',
    'collage',
    'mood',
] as const;

export type GenreName = (typeof GENRE_NAMES)[number];

export function parseGenre(value: string): GenreName {
    if (!GENRE_NAMES.includes(value as GenreName)) {
        throw new Error(`Unknown template "${value}". Use ${GENRE_NAMES.join(', ')}.`);
    }
    return value as GenreName;
}

/** 只有部分类型接受的选项 */
export type GenreOption = 'tag' | 'number' | 'labels' | 'look' | 'fit';

interface GenreSpec {
    /** 照片张数的下限和上限 */
    photos: [number, number];
    /**
     * --scene 能现画几张。0 是要真照片：圈注要圈真实的主体，对比和拼图要真实的几样东西。
     * 前后对比画两张，第二张照着第一张改，是同一个地方。
     */
    scenes: 0 | 1 | 2;
    /** 要不要抠好的人 */
    subject: boolean;
    options: readonly GenreOption[];
    /** 必须给的选项，和缺了时怎么说 */
    requires?: Partial<Record<GenreOption, string>>;
    /** 字压在纯色上（不是照片上）：只有这样浅底方案 cream、lemon 的深色字才读得出 */
    flatGround: boolean;
    /** 一句话说这个类型是什么，放进帮助和报错 */
    summary: string;
}

export const GENRES: Readonly<Record<GenreName, GenreSpec>> = {
    'big-type': {
        photos: [0, 0],
        scenes: 0,
        subject: false,
        options: ['tag'],
        flatGround: true,
        summary: 'the headline is the picture: heavy type on a plain or gradient background',
    },
    number: {
        photos: [0, 0],
        scenes: 0,
        subject: false,
        options: ['tag', 'number'],
        requires: { number: '--template number needs --number <figure>, like --number 3.' },
        flatGround: true,
        summary: 'one huge figure beside a short line',
    },
    'face-text': {
        photos: [0, 0],
        scenes: 0,
        subject: true,
        options: ['tag'],
        flatGround: true,
        summary: 'a cut-out person on one side, two to four big words on the other',
    },
    'face-stakes': {
        photos: [1, 1],
        scenes: 1,
        subject: true,
        options: ['number', 'look', 'fit'],
        flatGround: false,
        summary:
            'a person inside the scene of the story, with the stakes on a tilted sign (--number)',
    },
    versus: {
        photos: [2, 2],
        scenes: 0,
        subject: false,
        options: ['labels', 'look'],
        requires: {
            labels: '--template versus needs --labels for the two price tags, like --labels "¥15,¥1500".',
        },
        flatGround: true,
        summary: 'two equal halves with a price tag each and a VS badge in the seam',
    },
    'before-after': {
        photos: [2, 2],
        scenes: 2,
        subject: false,
        options: ['labels', 'look'],
        flatGround: true,
        summary: 'before on the left (or top), after on the right (or bottom), an arrow between',
    },
    'scene-title': {
        photos: [1, 1],
        scenes: 1,
        subject: false,
        options: ['look', 'fit'],
        flatGround: false,
        summary: 'a full-bleed scene with an outlined title in its quiet part',
    },
    callout: {
        photos: [1, 1],
        scenes: 0,
        subject: false,
        options: ['look'],
        flatGround: false,
        summary: 'a red circle and an arrow on the photo subject, with a short question',
    },
    collage: {
        photos: [COLLAGE_MIN, COLLAGE_MAX],
        scenes: 0,
        subject: false,
        options: ['look'],
        flatGround: true,
        summary: 'two to four photos in a grid with the title on a colour band',
    },
    mood: {
        photos: [1, 1],
        scenes: 1,
        subject: false,
        options: ['look', 'fit'],
        flatGround: false,
        summary: 'one strong photo with a small, quiet line',
    },
};

/** 没给 --template 时按素材选：有人有场景是赌注，只有人是人物大字，两张对比，三四张拼图，一张题字 */
export function defaultGenre(inputs: { photos: number; subject: boolean }): GenreName {
    if (inputs.subject) {
        return inputs.photos > 0 ? 'face-stakes' : 'face-text';
    }
    if (inputs.photos === 0) {
        return 'big-type';
    }
    if (inputs.photos === 1) {
        return 'scene-title';
    }
    return inputs.photos === 2 ? 'before-after' : 'collage';
}

function photoCount(count: number): string {
    return count === 1 ? 'one --photo' : `${count} --photo images`;
}

/** 类型和素材、选项要对得上，对不上直接报错，不猜用户想要哪个 */
export function checkGenreInputs(
    name: GenreName,
    inputs: {
        photos: number;
        subject: boolean;
        options: Readonly<Partial<Record<GenreOption, unknown>>>;
        scheme?: SchemeName;
        style?: StyleName;
    },
): void {
    const spec = GENRES[name];
    if (inputs.style === 'memo') {
        if (name !== 'big-type') {
            throw new Error(
                `--style memo draws a phone notes screen for --template big-type. ${name} has its own picture.`,
            );
        }
        if (inputs.scheme !== undefined) {
            throw new Error("--style memo uses the notes app's own colours. Drop --scheme.");
        }
    }
    if (inputs.scheme !== undefined && isLightScheme(inputs.scheme) && !spec.flatGround) {
        const flat = GENRE_NAMES.filter((genre) => GENRES[genre].flatGround);
        throw new Error(
            `--scheme ${inputs.scheme} is dark type for words on flat colour (${flat.join(', ')}). ${name} puts its words on the picture: use navy, night, orange, or teal.`,
        );
    }
    const [min, max] = spec.photos;
    if (inputs.photos < min || inputs.photos > max) {
        if (max === 0) {
            throw new Error(
                `--template ${name} takes no photo. Drop --photo, or pick a photo template like scene-title.`,
            );
        }
        const wanted = min === max ? photoCount(min) : `${min} to ${max} --photo images`;
        throw new Error(`--template ${name} needs ${wanted}. It got ${inputs.photos}.`);
    }
    if (spec.subject && !inputs.subject) {
        throw new Error(`--template ${name} needs --subject <path>, a photo of the person.`);
    }
    if (!spec.subject && inputs.subject) {
        throw new Error(
            `--subject works with --template face-text or face-stakes. ${name} has no person in it.`,
        );
    }
    for (const [option, value] of Object.entries(inputs.options) as [GenreOption, unknown][]) {
        if (value !== undefined && !spec.options.includes(option)) {
            const owners = GENRE_NAMES.filter((genre) => GENRES[genre].options.includes(option));
            throw new Error(`--${option} works with --template ${owners.join(', ')}.`);
        }
    }
    for (const [option, message] of Object.entries(spec.requires ?? {}) as [
        GenreOption,
        string,
    ][]) {
        if (inputs.options[option] === undefined) {
            throw new Error(message);
        }
    }
}

export interface GenreInput {
    /** 带 *关键词* 标记的标题 */
    text: string;
    fonts: FontKit;
    photos: readonly GenrePhoto[];
    subject?: SubjectLayer;
    scheme?: SchemeName;
    tag?: string;
    figure?: string;
    labels?: [string, string];
    look?: PhotoLook;
    fit?: PhotoFit;
    style?: StyleName;
}

function first<T>(items: readonly T[], what: string): T {
    const item = items[0];
    if (item === undefined) {
        throw new Error(`Missing ${what}.`);
    }
    return item;
}

function pair<T>(items: readonly T[]): readonly [T, T] {
    if (items.length !== 2) {
        throw new Error('This template needs exactly two photos.');
    }
    return [items[0] as T, items[1] as T];
}

function personOf(input: GenreInput): SubjectLayer {
    if (input.subject === undefined) {
        throw new Error('This template needs --subject.');
    }
    return input.subject;
}

/** 按类型把素材和选项组装成模板。输入已经过 checkGenreInputs */
export function genreTemplate(name: GenreName, input: GenreInput): CoverTemplate {
    const common = {
        text: input.text,
        fonts: input.fonts,
        ...(input.scheme === undefined ? {} : { scheme: input.scheme }),
        ...(input.style === undefined ? {} : { style: input.style }),
    };
    const look = input.look === undefined ? {} : { look: input.look };
    const fit = input.fit === undefined ? {} : { fit: input.fit };
    const tag = input.tag === undefined ? {} : { tag: input.tag };
    switch (name) {
        case 'big-type':
            return bigTypeTemplate({ ...common, ...tag });
        case 'number':
            return numberGenreTemplate({
                ...common,
                ...tag,
                figure: first(input.figure === undefined ? [] : [input.figure], '--number'),
            });
        case 'face-text':
            return faceTextTemplate({ ...common, ...tag, subject: personOf(input) });
        case 'face-stakes':
            return faceStakesTemplate({
                ...common,
                ...look,
                ...fit,
                subject: personOf(input),
                photo: first(input.photos, '--photo'),
                ...(input.figure === undefined ? {} : { stake: input.figure }),
            });
        case 'versus':
            return versusTemplate({
                ...common,
                ...look,
                photos: pair(input.photos),
                ...(input.labels === undefined ? {} : { labels: input.labels }),
            });
        case 'before-after':
            return beforeAfterTemplate({
                ...common,
                ...look,
                photos: pair(input.photos),
                ...(input.labels === undefined ? {} : { labels: input.labels }),
            });
        case 'scene-title':
            return sceneTitleTemplate({
                ...common,
                ...look,
                ...fit,
                photo: first(input.photos, '--photo'),
            });
        case 'callout': {
            // 圈注圈的是真实照片里找到的主体，现画的场景不走这里（--scene 只给三种场景类型）。
            const photo = first(input.photos, '--photo');
            if (photo.focus === undefined) {
                throw new Error('The callout needs a photo whose subject was found.');
            }
            return calloutTemplate({ ...common, ...look, photo, focus: photo.focus });
        }
        case 'collage':
            return collageTemplate({ ...common, ...look, photos: input.photos });
        case 'mood':
            return moodTemplate({
                ...common,
                ...look,
                ...fit,
                photo: first(input.photos, '--photo'),
            });
    }
}
