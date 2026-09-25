import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    loadOpenversePhoto,
    OPENVERSE_SEARCH_URL,
    OPENVERSE_TOKEN_URL,
    resetOpenverseTokenCache,
    searchOpenverse,
} from './openverse.ts';

const noSleep = async () => undefined;

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
}

const cc0 = {
    id: 'a1',
    url: 'https://upload.example/a1.jpg',
    license: 'cc0',
    creator: 'Ada',
    width: 1600,
    height: 900,
    thumbnail: 'https://api.openverse.org/thumb/a1',
    foreign_landing_url: 'https://flickr.example/a1',
};

beforeEach(() => {
    resetOpenverseTokenCache();
});

describe('openverse', () => {
    it('searches anonymously, keeps only cc0/pdm, and filters orientation client-side', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            expect(String(url)).toContain(OPENVERSE_SEARCH_URL);
            expect(String(url)).toContain('license=cc0%2Cpdm');
            expect(
                (init?.headers as Record<string, string> | undefined)?.Authorization,
            ).toBeUndefined();
            return json({
                results: [
                    cc0,
                    { ...cc0, id: 'by', license: 'by' },
                    { ...cc0, id: 'pdm-portrait', license: 'pdm', width: 900, height: 1600 },
                    { ...cc0, id: 'no-size', width: undefined, height: undefined },
                    { ...cc0, id: 'zero-size', width: 0, height: 0 },
                ],
            });
        });

        const hits = await searchOpenverse(
            { query: 'mountain lake', orientation: 'landscape' },
            { credentials: {}, fetch: fetchImpl as typeof fetch, sleep: noSleep },
        );

        expect(hits).toEqual([
            {
                ref: 'openverse:a1',
                provider: 'openverse',
                id: 'a1',
                width: 1600,
                height: 900,
                creator: 'Ada',
                license: 'cc0',
                attribution: '',
                pageUrl: 'https://flickr.example/a1',
                thumbnail: 'https://api.openverse.org/thumb/a1',
            },
        ]);
    });

    it('fetches a bearer token once when credentials are configured', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url) === OPENVERSE_TOKEN_URL) {
                expect(init?.method).toBe('POST');
                return json({ access_token: 'tok', expires_in: 3600 });
            }
            expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
                'Bearer tok',
            );
            return json({ results: [cc0] });
        });
        const context = {
            credentials: { clientId: 'id', clientSecret: 'sec' },
            fetch: fetchImpl as typeof fetch,
            sleep: noSleep,
        };

        await searchOpenverse({ query: 'a' }, context);
        await searchOpenverse({ query: 'b' }, context);
        const tokenCalls = fetchImpl.mock.calls.filter(
            ([url]) => String(url) === OPENVERSE_TOKEN_URL,
        );
        expect(tokenCalls).toHaveLength(1);
    });

    it('refuses to download a photo whose license is not cc0 or pdm', async () => {
        const fetchImpl = vi.fn(async () => json({ ...cc0, license: 'by-sa' }));
        await expect(
            loadOpenversePhoto('a1', {
                credentials: {},
                fetch: fetchImpl as typeof fetch,
                sleep: noSleep,
            }),
        ).rejects.toThrowError(
            'Openverse photo a1 is licensed "by-sa", not cc0 or pdm. Refusing to download.',
        );
    });

    it('returns the download url on detail', async () => {
        const fetchImpl = vi.fn(async () => json(cc0));
        const photo = await loadOpenversePhoto('a1', {
            credentials: {},
            fetch: fetchImpl as typeof fetch,
            sleep: noSleep,
        });
        expect(photo.downloadUrl).toBe('https://upload.example/a1.jpg');
        expect(photo.ref).toBe('openverse:a1');
    });
});
