// 图库入口。有 Pexels key 就先用 Pexels，否则 Openverse。用户点名某个 provider 时只用那个，
// 缺 key 直接报错，不换别家。
import type { StockConfig } from '../config.ts';
import { type DownloadContext, downloadPhotoBytes, writePhotoFiles } from './download.ts';
import { defaultSleep, type FetchImpl, type SleepFn } from './http.ts';
import { loadOpenversePhoto, type OpenverseContext, searchOpenverse } from './openverse.ts';
import { loadPexelsPhoto, type PexelsContext, searchPexels } from './pexels.ts';
import { parseStockRef } from './ref.ts';
import type { StockHit, StockOrientation, StockPhoto, StockProvider } from './types.ts';

export type { StockSidecar } from './download.ts';
export { extensionForContentType, MAX_DOWNLOAD_BYTES, sidecarPath } from './download.ts';
export { formatStockRef, isStockRef, parseStockRef } from './ref.ts';
export type { StockHit, StockOrientation, StockPhoto, StockProvider } from './types.ts';
export { STOCK_ORIENTATIONS, STOCK_PROVIDERS } from './types.ts';

export interface StockRuntime {
    config: StockConfig | undefined;
    fetch?: FetchImpl;
    sleep?: SleepFn;
    download?: DownloadContext;
}

export function selectStockProvider(
    requested: StockProvider | undefined,
    config: StockConfig | undefined,
): StockProvider {
    const hasPexelsKey = Boolean(config?.pexels?.apiKey);
    if (requested === 'pexels' && !hasPexelsKey) {
        throw new Error(
            'Pexels needs an API key. Run beastcover config set stock.pexels.apiKey <key>, or use --provider openverse.',
        );
    }
    if (requested !== undefined) {
        return requested;
    }
    return hasPexelsKey ? 'pexels' : 'openverse';
}

function pexelsContext(runtime: StockRuntime): PexelsContext {
    const apiKey = runtime.config?.pexels?.apiKey;
    if (!apiKey) {
        throw new Error(
            'Pexels needs an API key. Run beastcover config set stock.pexels.apiKey <key>.',
        );
    }
    return { apiKey, fetch: runtime.fetch ?? fetch, sleep: runtime.sleep ?? defaultSleep };
}

function openverseContext(runtime: StockRuntime): OpenverseContext {
    return {
        credentials: runtime.config?.openverse ?? {},
        fetch: runtime.fetch ?? fetch,
        sleep: runtime.sleep ?? defaultSleep,
    };
}

export interface StockSearchInput {
    query: string;
    provider?: StockProvider;
    orientation?: StockOrientation;
}

export async function searchStock(
    input: StockSearchInput,
    runtime: StockRuntime,
): Promise<{ provider: StockProvider; hits: StockHit[] }> {
    const query = input.query.trim();
    if (query === '') {
        throw new Error('Stock search needs a query.');
    }
    const provider = selectStockProvider(input.provider, runtime.config);
    const options = { query, orientation: input.orientation };
    const hits =
        provider === 'pexels'
            ? await searchPexels(options, pexelsContext(runtime))
            : await searchOpenverse(options, openverseContext(runtime));
    return { provider, hits };
}

export async function loadStockPhoto(ref: string, runtime: StockRuntime): Promise<StockPhoto> {
    const parsed = parseStockRef(ref);
    // 只借它的报错：pexels ref 没 key 时在这里停，不换到 openverse。
    selectStockProvider(parsed.provider, runtime.config);
    return parsed.provider === 'pexels'
        ? loadPexelsPhoto(parsed.id, pexelsContext(runtime))
        : loadOpenversePhoto(parsed.id, openverseContext(runtime));
}

export interface FetchStockInput {
    ref: string;
    basePath: string;
    now: Date;
}

export interface FetchedStock {
    photo: StockPhoto;
    imagePath: string;
    sidecar: string;
    /** 实际下载到的尺寸，可能比图库标的小 */
    width: number;
    height: number;
}

export async function fetchStockPhoto(
    input: FetchStockInput,
    runtime: StockRuntime,
): Promise<FetchedStock> {
    const photo = await loadStockPhoto(input.ref, runtime);
    const downloaded = await downloadPhotoBytes(photo.downloadUrl, runtime.download);
    const written = writePhotoFiles({
        photo,
        downloaded,
        basePath: input.basePath,
        now: input.now,
    });
    return { photo, ...written, width: downloaded.width, height: downloaded.height };
}

export function stockFileStem(ref: string): string {
    const parsed = parseStockRef(ref);
    return `${parsed.provider}-${parsed.id.replaceAll(/[^A-Za-z0-9_-]/g, '_')}`;
}
