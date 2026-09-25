export const STOCK_PROVIDERS = ['pexels', 'openverse'] as const;
export type StockProvider = (typeof STOCK_PROVIDERS)[number];

export const STOCK_ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;
export type StockOrientation = (typeof STOCK_ORIENTATIONS)[number];

export const STOCK_PAGE_SIZE = 8;

export interface StockHit {
    ref: string;
    provider: StockProvider;
    id: string;
    width: number;
    height: number;
    creator: string;
    license: string;
    attribution: string;
    pageUrl: string;
    thumbnail: string;
}

export interface StockPhoto extends StockHit {
    downloadUrl: string;
}

export function matchesOrientation(
    hit: { width: number; height: number },
    orientation: StockOrientation | undefined,
): boolean {
    if (orientation === undefined) {
        return true;
    }
    if (orientation === 'landscape') {
        return hit.width > hit.height;
    }
    if (orientation === 'portrait') {
        return hit.height > hit.width;
    }
    return hit.width === hit.height;
}
