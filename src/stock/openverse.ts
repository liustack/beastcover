// Openverse 匿名可用，只接 cc0 和 pdm 两种授权，拿到的图不需要署名。
// clientId 和 clientSecret 可选，只用来提高限额。
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

export const OPENVERSE_SEARCH_URL = 'https://api.openverse.org/v1/images/';
export const OPENVERSE_TOKEN_URL = 'https://api.openverse.org/v1/auth_tokens/token/';
const TOKEN_SKEW_MS = 30_000;

export interface OpenverseCredentials {
    clientId?: string;
    clientSecret?: string;
}

export interface OpenverseContext {
    credentials: OpenverseCredentials;
    fetch: FetchImpl;
    sleep: SleepFn;
    now?: () => number;
}

interface CachedToken {
    accessToken: string;
    expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function resetOpenverseTokenCache(): void {
    tokenCache.clear();
}

export function isCc0OrPdm(license: string | undefined): boolean {
    const token = (license ?? '').toLowerCase();
    return token === 'cc0' || token === 'pdm';
}

function secretsOf(credentials: OpenverseCredentials): string[] {
    return [credentials.clientSecret ?? ''].filter((value) => value !== '');
}

async function getAccessToken(context: OpenverseContext): Promise<string> {
    const { clientId, clientSecret } = context.credentials;
    if (!clientId || !clientSecret) {
        throw new Error('Openverse token requires both clientId and clientSecret.');
    }
    const now = context.now ?? Date.now;
    const cached = tokenCache.get(clientId);
    if (cached && now() < cached.expiresAt - TOKEN_SKEW_MS) {
        return cached.accessToken;
    }
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
    }).toString();
    const json = await fetchJson({
        label: 'Openverse token',
        url: OPENVERSE_TOKEN_URL,
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent(),
            },
            body,
        },
        fetch: context.fetch,
        sleep: context.sleep,
        secrets: secretsOf(context.credentials),
    });
    const record = asRecord(json);
    const accessToken = asString(record?.access_token);
    const expiresIn = asNumber(record?.expires_in) ?? 3600;
    if (!accessToken) {
        throw new Error('Openverse token response was missing access_token.');
    }
    tokenCache.set(clientId, { accessToken, expiresAt: now() + expiresIn * 1000 });
    return accessToken;
}

async function authHeaders(context: OpenverseContext): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'User-Agent': userAgent() };
    const { clientId, clientSecret } = context.credentials;
    if (clientId && clientSecret) {
        headers.Authorization = `Bearer ${await getAccessToken(context)}`;
    }
    return headers;
}

function parseHit(raw: unknown): StockHit | null {
    const photo = asRecord(raw);
    if (!photo) {
        return null;
    }
    const id = asString(photo.id);
    if (!id) {
        return null;
    }
    const license = (asString(photo.license) ?? '').toLowerCase();
    if (!isCc0OrPdm(license)) {
        return null;
    }
    // 没有尺寸的条目没法判方向，也没法排版，直接跳过而不是填 0。
    const width = asNumber(photo.width);
    const height = asNumber(photo.height);
    if (width === undefined || height === undefined || width <= 0 || height <= 0) {
        return null;
    }
    return {
        ref: `openverse:${id}`,
        provider: 'openverse',
        id,
        width,
        height,
        creator: asString(photo.creator) ?? 'unknown',
        license,
        attribution: '',
        pageUrl: asString(photo.foreign_landing_url) ?? '',
        thumbnail: asString(photo.thumbnail) ?? '',
    };
}

export interface OpenverseSearchOptions {
    query: string;
    orientation?: StockOrientation;
}

export async function searchOpenverse(
    options: OpenverseSearchOptions,
    context: OpenverseContext,
): Promise<StockHit[]> {
    const url = new URL(OPENVERSE_SEARCH_URL);
    url.searchParams.set('q', options.query);
    url.searchParams.set('license_type', 'commercial');
    url.searchParams.set('license', 'cc0,pdm');
    url.searchParams.set('page_size', String(STOCK_PAGE_SIZE * 2));
    const json = await fetchJson({
        label: 'Openverse search',
        url: url.toString(),
        init: { headers: await authHeaders(context) },
        fetch: context.fetch,
        sleep: context.sleep,
        secrets: secretsOf(context.credentials),
    });
    const root = asRecord(json);
    const list = Array.isArray(root?.results) ? root.results : [];
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

export async function loadOpenversePhoto(
    id: string,
    context: OpenverseContext,
): Promise<StockPhoto> {
    const url = `${OPENVERSE_SEARCH_URL}${encodeURIComponent(id)}/`;
    const json = await fetchJson({
        label: 'Openverse photo',
        url,
        init: { headers: await authHeaders(context) },
        fetch: context.fetch,
        sleep: context.sleep,
        secrets: secretsOf(context.credentials),
    });
    const record = asRecord(json);
    const license = asString(record?.license);
    if (!isCc0OrPdm(license)) {
        throw new Error(
            `Openverse photo ${id} is licensed "${license ?? 'unknown'}", not cc0 or pdm. Refusing to download.`,
        );
    }
    const hit = parseHit(json);
    const downloadUrl = asString(record?.url);
    if (!hit || !downloadUrl) {
        throw new Error(`Openverse photo ${id} was not found.`);
    }
    return { ...hit, downloadUrl };
}
