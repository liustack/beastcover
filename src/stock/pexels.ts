// Pexels 需要 API key。授权是 Pexels License，可商用，署名不强制，但我们照旧打印。
import {
    asNumber,
    asRecord,
    asString,
    type FetchImpl,
    fetchJson,
    type SleepFn,
    userAgent,
} from './http.ts';
import {
    matchesOrientation,
    STOCK_PAGE_SIZE,
    type StockHit,
    type StockOrientation,
    type StockPhoto,
} from './types.ts';

export const PEXELS_SEARCH_URL = 'https://api.pexels.com/v1/search';
export const PEXELS_PHOTO_URL = 'https://api.pexels.com/v1/photos/';
const PEXELS_LICENSE = 'Pexels License';

export interface PexelsContext {
    apiKey: string;
    fetch: FetchImpl;
    sleep: SleepFn;
}

function headers(apiKey: string): Record<string, string> {
    return { Authorization: apiKey, 'User-Agent': userAgent() };
}

function parseHit(raw: unknown): StockHit | null {
    const photo = asRecord(raw);
    if (!photo) {
        return null;
    }
    const rawId = photo.id;
    const id = typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId) : '';
    if (id === '') {
        return null;
    }
    const src = asRecord(photo.src) ?? {};
    const creator = asString(photo.photographer) ?? 'unknown';
    const width = asNumber(photo.width);
    const height = asNumber(photo.height);
    if (width === undefined || height === undefined || width <= 0 || height <= 0) {
        return null;
    }
    return {
        ref: `pexels:${id}`,
        provider: 'pexels',
        id,
        width,
        height,
        creator,
        license: PEXELS_LICENSE,
        attribution: `Photo by ${creator} on Pexels`,
        pageUrl: asString(photo.url) ?? `https://www.pexels.com/photo/${id}/`,
        thumbnail: asString(src.medium) ?? asString(src.tiny) ?? '',
    };
}

export interface PexelsSearchOptions {
    query: string;
    orientation?: StockOrientation;
}

export async function searchPexels(
    options: PexelsSearchOptions,
    context: PexelsContext,
): Promise<StockHit[]> {
    const url = new URL(PEXELS_SEARCH_URL);
    url.searchParams.set('query', options.query);
    url.searchParams.set('per_page', String(STOCK_PAGE_SIZE));
    if (options.orientation) {
        url.searchParams.set('orientation', options.orientation);
    }
    const json = await fetchJson({
        label: 'Pexels search',
        url: url.toString(),
        init: { headers: headers(context.apiKey) },
        fetch: context.fetch,
        sleep: context.sleep,
        secrets: [context.apiKey],
    });
    const root = asRecord(json);
    const list = Array.isArray(root?.photos) ? root.photos : [];
    const hits: StockHit[] = [];
    for (const raw of list) {
        const hit = parseHit(raw);
        if (!hit || !matchesOrientation(hit, options.orientation)) {
            continue;
        }
        hits.push(hit);
        if (hits.length >= STOCK_PAGE_SIZE) {
            break;
        }
    }
    return hits;
}

export async function loadPexelsPhoto(id: string, context: PexelsContext): Promise<StockPhoto> {
    const json = await fetchJson({
        label: 'Pexels photo',
        url: `${PEXELS_PHOTO_URL}${encodeURIComponent(id)}`,
        init: { headers: headers(context.apiKey) },
        fetch: context.fetch,
        sleep: context.sleep,
        secrets: [context.apiKey],
    });
    const hit = parseHit(json);
    if (!hit) {
        throw new Error(`Pexels photo ${id} was not found.`);
    }
    const src = asRecord(asRecord(json)?.src) ?? {};
    const downloadUrl = asString(src.original) ?? asString(src.large2x);
    if (!downloadUrl) {
        throw new Error(`Pexels photo ${id} has no download URL.`);
    }
    return { ...hit, downloadUrl };
}
