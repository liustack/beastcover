import { describe, expect, it, vi } from 'vitest';
import { searchStock, selectStockProvider, stockFileStem } from './index.ts';

describe('stock provider selection', () => {
    it('prefers pexels when a key exists and openverse otherwise', () => {
        expect(selectStockProvider(undefined, undefined)).toBe('openverse');
        expect(selectStockProvider(undefined, { pexels: { apiKey: 'k' } })).toBe('pexels');
        expect(selectStockProvider('openverse', { pexels: { apiKey: 'k' } })).toBe('openverse');
    });

    it('refuses a pexels request without a key instead of switching provider', () => {
        expect(() => selectStockProvider('pexels', undefined)).toThrowError(
            'Pexels needs an API key. Run beastcover config set stock.pexels.apiKey <key>, or use --provider openverse.',
        );
    });

    it('rejects an empty query before touching the network', async () => {
        const fetchImpl = vi.fn();
        await expect(
            searchStock({ query: '   ' }, { config: undefined, fetch: fetchImpl as typeof fetch }),
        ).rejects.toThrowError('Stock search needs a query.');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('builds a filesystem-safe stem from a ref', () => {
        expect(stockFileStem('pexels:42')).toBe('pexels-42');
        expect(stockFileStem('openverse:9f2a c!')).toBe('openverse-9f2a_c_');
    });
});
