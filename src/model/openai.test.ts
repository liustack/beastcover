import { describe, expect, it, vi } from 'vitest';
import { generateOpenAiImage } from './index.ts';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('openai image generation', () => {
    it('posts the model, prompt, and size with the key only in the header', async () => {
        const png = Buffer.from('png-bytes');
        const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
            jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] }),
        );

        const bytes = await generateOpenAiImage({
            apiKey: 'sk-secret',
            model: 'gpt-image-2.5-flare',
            prompt: '孔版印刷。主体：海边的人',
            width: 1536,
            height: 1024,
            fetch: fetcher,
        });

        expect(bytes.equals(png)).toBe(true);
        expect(fetcher).toHaveBeenCalledOnce();
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://api.openai.com/v1/images/generations');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret');
        const body = JSON.parse(init.body as string) as Record<string, string>;
        expect(body).toEqual({
            model: 'gpt-image-2.5-flare',
            prompt: '孔版印刷。主体：海边的人',
            size: '1536x1024',
        });
        expect(init.body as string).not.toContain('sk-secret');
    });

    it('redacts the key when the error body echoes it', async () => {
        const attempt = generateOpenAiImage({
            apiKey: 'sk-secret',
            model: 'm',
            prompt: 'p',
            width: 1536,
            height: 1024,
            fetch: vi.fn(async () =>
                jsonResponse(401, { error: { message: 'Invalid API key: sk-secret' } }),
            ),
        });
        await expect(attempt).rejects.toThrowError(/\[redacted\]/);
        await expect(
            generateOpenAiImage({
                apiKey: 'sk-secret',
                model: 'm',
                prompt: 'p',
                width: 1536,
                height: 1024,
                fetch: vi.fn(async () =>
                    jsonResponse(401, { error: { message: 'Invalid API key: sk-secret' } }),
                ),
            }),
        ).rejects.not.toThrowError(/sk-secret/);
    });

    it('redacts a key that straddles the truncation boundary', async () => {
        // key 从第 280 个字符开始，截断点 300 落在 key 中间：先截断再脱敏会留下 key 前缀。
        const body = `${'x'.repeat(280)}sk-straddle-key-1234567890 tail`;
        const attempt = generateOpenAiImage({
            apiKey: 'sk-straddle-key-1234567890',
            model: 'm',
            prompt: 'p',
            width: 1536,
            height: 1024,
            fetch: vi.fn(async () => new Response(body, { status: 401 })),
        });
        await expect(attempt).rejects.not.toThrowError(/sk-straddle/);
    });

    it('reports the status and body on failure without the key', async () => {
        const failing = vi.fn(async () => jsonResponse(401, { error: { message: 'bad key' } }));
        const attempt = generateOpenAiImage({
            apiKey: 'sk-secret',
            model: 'm',
            prompt: 'p',
            width: 1536,
            height: 1024,
            fetch: failing,
        });
        await expect(attempt).rejects.toThrowError(/openai image generation failed: HTTP 401/);
        await expect(
            generateOpenAiImage({
                apiKey: 'sk-secret',
                model: 'm',
                prompt: 'p',
                width: 1536,
                height: 1024,
                fetch: vi.fn(async () => jsonResponse(401, {})),
            }),
        ).rejects.not.toThrowError(/sk-secret/);
    });

    it('fails loudly when the response has no image data', async () => {
        await expect(
            generateOpenAiImage({
                apiKey: 'k',
                model: 'm',
                prompt: 'p',
                width: 1536,
                height: 1024,
                fetch: vi.fn(async () => jsonResponse(200, { data: [] })),
            }),
        ).rejects.toThrowError('openai returned no image data (expected data[0].b64_json).');

        await expect(
            generateOpenAiImage({
                apiKey: 'k',
                model: 'm',
                prompt: 'p',
                width: 1536,
                height: 1024,
                fetch: vi.fn(async () => new Response('not json', { status: 200 })),
            }),
        ).rejects.toThrowError('openai returned a response that is not JSON.');
    });
});
