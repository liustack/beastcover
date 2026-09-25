import { describe, expect, it, vi } from 'vitest';
import { fetchJson, redactSecrets } from './http.ts';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, ...init });
}

describe('stock http layer', () => {
    it('retries twice on 429 using Retry-After, then gives up', async () => {
        const responses = [
            new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }),
            new Response('slow down', { status: 429 }),
            jsonResponse({ ok: true }),
        ];
        const fetchImpl = vi.fn(async () => responses.shift() as Response);
        const sleep = vi.fn(async (_ms: number) => undefined);

        await expect(
            fetchJson({
                label: 'test',
                url: 'https://x',
                init: {},
                fetch: fetchImpl,
                sleep,
                secrets: [],
            }),
        ).resolves.toEqual({ ok: true });
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 1500]);

        const hugeRetry = [
            new Response('x', { status: 429, headers: { 'Retry-After': '999999' } }),
            jsonResponse({ ok: true }),
        ];
        const slowSleep = vi.fn(async (_ms: number) => undefined);
        await fetchJson({
            label: 'test',
            url: 'https://x',
            init: {},
            fetch: vi.fn(async () => hugeRetry.shift() as Response),
            sleep: slowSleep,
            secrets: [],
        });
        expect(slowSleep.mock.calls[0]?.[0]).toBe(10_000);

        const always429 = vi.fn(async () => new Response('nope', { status: 429 }));
        await expect(
            fetchJson({
                label: 'test',
                url: 'https://x',
                init: {},
                fetch: always429,
                sleep,
                secrets: [],
            }),
        ).rejects.toThrowError('test rate-limited (HTTP 429): nope');
        expect(always429).toHaveBeenCalledTimes(3);
    });

    it('redacts secrets from error bodies and reports non-JSON', async () => {
        const leaky = vi.fn(async () => new Response('key sk-secret rejected', { status: 401 }));
        await expect(
            fetchJson({
                label: 'Pexels search',
                url: 'https://x',
                init: {},
                fetch: leaky,
                sleep: async () => undefined,
                secrets: ['sk-secret'],
            }),
        ).rejects.toThrowError('Pexels search HTTP 401: key [redacted] rejected');

        const html = vi.fn(async () => new Response('<html>', { status: 200 }));
        await expect(
            fetchJson({
                label: 'test',
                url: 'https://x',
                init: {},
                fetch: html,
                sleep: async () => undefined,
                secrets: [],
            }),
        ).rejects.toThrowError(
            'test returned non-JSON (HTTP 200, content-encoding none, first bytes 3c68746d6c3e): <html>',
        );

        expect(redactSecrets('a b', [''])).toBe('a b');
    });
});
