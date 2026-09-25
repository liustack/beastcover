import { STOCK_PROVIDERS, type StockProvider } from './types.ts';

export interface StockRef {
    provider: StockProvider;
    id: string;
}

const REF_PATTERN = /^(pexels|openverse):(.+)$/;

export function isStockRef(value: string): boolean {
    return REF_PATTERN.test(value.trim());
}

export function parseStockRef(value: string): StockRef {
    const match = REF_PATTERN.exec(value.trim());
    if (!match) {
        throw new Error(
            `Invalid photo ref "${value}". Expected ${STOCK_PROVIDERS.map((p) => `${p}:<id>`).join(' or ')}.`,
        );
    }
    const id = (match[2] as string).trim();
    if (id === '' || /[\\/]/.test(id)) {
        throw new Error(
            `Invalid photo ref "${value}". The id must not be empty or contain slashes.`,
        );
    }
    return { provider: match[1] as StockProvider, id };
}

export function formatStockRef(ref: StockRef): string {
    return `${ref.provider}:${ref.id}`;
}
