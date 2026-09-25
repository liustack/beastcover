import { describe, expect, it } from 'vitest';
import { formatStockRef, isStockRef, parseStockRef } from './ref.ts';

describe('stock refs', () => {
    it('parses provider and id', () => {
        expect(parseStockRef('pexels:12345')).toEqual({ provider: 'pexels', id: '12345' });
        expect(parseStockRef(' openverse:9f2a-1c ')).toEqual({
            provider: 'openverse',
            id: '9f2a-1c',
        });
        expect(formatStockRef({ provider: 'pexels', id: '7' })).toBe('pexels:7');
    });

    it('rejects unknown providers, empty ids, and path separators', () => {
        expect(() => parseStockRef('unsplash:1')).toThrowError(
            'Invalid photo ref "unsplash:1". Expected pexels:<id> or openverse:<id>.',
        );
        expect(() => parseStockRef('pexels:')).toThrowError('Invalid photo ref "pexels:"');
        expect(() => parseStockRef('pexels:../x')).toThrowError(
            'The id must not be empty or contain slashes.',
        );
        expect(isStockRef('pexels:1')).toBe(true);
        expect(isStockRef('./photo.jpg')).toBe(false);
    });
});
