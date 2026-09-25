import type { RequestListener } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
    assertSafeRemoteTarget,
    isBlockedHostname,
    isPrivateIpAddress,
    pinnedFetch,
} from './ssrf.ts';

describe('ssrf guards', () => {
    it('blocks loopback, link-local, private, and metadata hosts', () => {
        expect(isBlockedHostname('localhost')).toBe(true);
        expect(isBlockedHostname('foo.localhost')).toBe(true);
        expect(isBlockedHostname('metadata.google.internal')).toBe(true);
        expect(isBlockedHostname('images.pexels.com')).toBe(false);

        expect(isPrivateIpAddress('127.0.0.1')).toBe(true);
        expect(isPrivateIpAddress('10.1.2.3')).toBe(true);
        expect(isPrivateIpAddress('172.16.0.9')).toBe(true);
        expect(isPrivateIpAddress('192.168.1.1')).toBe(true);
        expect(isPrivateIpAddress('169.254.169.254')).toBe(true);
        expect(isPrivateIpAddress('100.64.0.1')).toBe(true);
        expect(isPrivateIpAddress('::1')).toBe(true);
        expect(isPrivateIpAddress('fe80::1')).toBe(true);
        expect(isPrivateIpAddress('fd00::1')).toBe(true);
        expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateIpAddress('not-an-ip')).toBe(true);

        expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
        expect(isPrivateIpAddress('198.18.97.239')).toBe(false);
        expect(isPrivateIpAddress('2606:4700::1111')).toBe(false);
    });

    it('rejects a hostname when any resolved address is private', async () => {
        const lookup = async () => [
            { address: '104.16.1.1', family: 4 },
            { address: '10.0.0.5', family: 4 },
        ];
        await expect(
            assertSafeRemoteTarget(new URL('https://cdn.example.com/a.jpg'), lookup),
        ).rejects.toThrowError(
            'Blocked private or reserved download target: cdn.example.com -> 10.0.0.5',
        );
    });

    it('pins the first public address that resolved', async () => {
        const lookup = async () => [{ address: '104.16.1.1', family: 4 }];
        await expect(
            assertSafeRemoteTarget(new URL('https://cdn.example.com/a.jpg'), lookup),
        ).resolves.toEqual({ hostname: 'cdn.example.com', address: '104.16.1.1', family: 4 });
    });

    it('rejects literal private IPs and empty resolutions', async () => {
        await expect(
            assertSafeRemoteTarget(new URL('https://127.0.0.1/a.jpg'), async () => []),
        ).rejects.toThrowError('Blocked private or reserved download target: 127.0.0.1');
        await expect(
            assertSafeRemoteTarget(new URL('https://[::127.0.0.1]/a.jpg'), async () => []),
        ).rejects.toThrowError('Blocked private or reserved download target');
        await expect(
            assertSafeRemoteTarget(new URL('https://nowhere.example/a.jpg'), async () => []),
        ).rejects.toThrowError('Host nowhere.example did not resolve to any IP address.');
    });
});

describe('pinnedFetch', () => {
    it('connects to the pinned address regardless of the URL hostname and passes headers through', async () => {
        const { createServer } = await import('node:http');
        const seen: { host?: string; agent?: string; encoding?: string } = {};
        const server = createServer((req, res) => {
            seen.host = req.headers.host;
            seen.agent = req.headers['user-agent'];
            seen.encoding = req.headers['accept-encoding'];
            res.writeHead(200, { 'content-type': 'image/png', 'x-served': 'pinned' });
            res.end(Buffer.from('png-bytes'));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        try {
            const response = await pinnedFetch(
                new URL(`http://pinned.invalid:${port}/photo.png`),
                { hostname: 'pinned.invalid', address: '127.0.0.1', family: 4 },
                { headers: { 'User-Agent': 'beastcover-test', 'Accept-Encoding': 'identity' } },
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('x-served')).toBe('pinned');
            expect(response.headers.get('content-type')).toBe('image/png');
            expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('png-bytes');
            expect(seen).toEqual({
                host: `pinned.invalid:${port}`,
                agent: 'beastcover-test',
                encoding: 'identity',
            });
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('surfaces a redirect as its status instead of following it', async () => {
        const { createServer } = await import('node:http');
        const server = createServer((_req, res) => {
            res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
            res.end();
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            const response = await pinnedFetch(new URL(`http://pinned.invalid:${port}/a`), {
                hostname: 'pinned.invalid',
                address: '127.0.0.1',
                family: 4,
            });
            expect(response.status).toBe(302);
            expect(response.ok).toBe(false);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});

describe('embedded IPv4 in IPv6', () => {
    it('blocks IPv4-compatible, 6to4, and NAT64 forms of private addresses', () => {
        expect(isPrivateIpAddress('::127.0.0.1')).toBe(true);
        expect(isPrivateIpAddress('::7f00:1')).toBe(true);
        expect(isPrivateIpAddress('2002:7f00:1::')).toBe(true);
        expect(isPrivateIpAddress('2002:c0a8:101::')).toBe(true);
        expect(isPrivateIpAddress('64:ff9b::7f00:1')).toBe(true);
        expect(isPrivateIpAddress('64:ff9b::a00:1')).toBe(true);
        expect(isPrivateIpAddress('2002:808:808::')).toBe(true);
        expect(isPrivateIpAddress('64:ff9b::808:808')).toBe(true);
    });
});

describe('pinnedFetch limits', () => {
    async function serve(handler: RequestListener) {
        const { createServer } = await import('node:http');
        const server = createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
    }
    const pin = { hostname: 'pinned.invalid', address: '127.0.0.1', family: 4 };

    it('rejects a declared content-length above maxBytes before reading the body', async () => {
        let bodySent = false;
        const s = await serve((_req, res) => {
            res.writeHead(200, { 'content-length': '1000' });
            bodySent = true;
            res.end(Buffer.alloc(1000));
        });
        try {
            await expect(
                pinnedFetch(new URL(`http://pinned.invalid:${s.port}/a`), pin, { maxBytes: 100 }),
            ).rejects.toThrowError('Stock photo is 1000 bytes, larger than the 100 byte limit.');
            expect(bodySent).toBe(true);
        } finally {
            await s.close();
        }
    });

    it('cuts a chunked stream that grows past maxBytes', async () => {
        const s = await serve((_req, res) => {
            res.writeHead(200, { 'transfer-encoding': 'chunked' });
            let sent = 0;
            const timer = setInterval(() => {
                if (res.destroyed) {
                    clearInterval(timer);
                    return;
                }
                res.write(Buffer.alloc(64 * 1024));
                sent += 64 * 1024;
                if (sent > 2 * 1024 * 1024) {
                    clearInterval(timer);
                    res.end();
                }
            }, 1);
        });
        try {
            await expect(
                pinnedFetch(new URL(`http://pinned.invalid:${s.port}/a`), pin, {
                    maxBytes: 200_000,
                }),
            ).rejects.toThrowError('exceeded the 200000 byte limit while downloading');
        } finally {
            await s.close();
        }
    });

    it('fails a stalled response after timeoutMs', async () => {
        const s = await serve((_req, res) => {
            res.writeHead(200);
            res.write('partial');
        });
        try {
            await expect(
                pinnedFetch(new URL(`http://pinned.invalid:${s.port}/a`), pin, { timeoutMs: 300 }),
            ).rejects.toThrowError(/stalled for 300ms|exceeded 300ms/);
        } finally {
            await s.close();
        }
    });
});
