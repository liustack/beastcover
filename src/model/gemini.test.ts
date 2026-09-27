import { describe, expect, it, vi } from 'vitest';
import { generateGeminiImage } from './index.ts';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('gemini image generation', () => {
    it('posts the prompt with the aspect ratio and reads the inlineData part', async () => {
        const png = Buffer.from('png-bytes');
        const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
            jsonResponse(200, {
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: 'here is your image' },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: png.toString('base64'),
                                    },
                                },
                            ],
                        },
                    },
                ],
            }),
        );

        const bytes = await generateGeminiImage({
            apiKey: 'g-secret',
            model: 'gemini-3-pro-image-preview',
            prompt: '孔版印刷。主体：海边的人',
            aspectRatio: '3:2',
            fetch: fetcher,
        });

        expect(bytes.equals(png)).toBe(true);
        const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent',
        );
        expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-secret');
        const body = JSON.parse(init.body as string) as {
            contents: { parts: { text: string }[] }[];
            generationConfig: { imageConfig: { aspectRatio: string } };
        };
        expect(body.contents[0]?.parts[0]?.text).toBe('孔版印刷。主体：海边的人');
        expect(body.generationConfig.imageConfig.aspectRatio).toBe('3:2');
        expect(init.body as string).not.toContain('g-secret');
    });

    it('reports the status on failure and fails loudly without image data', async () => {
        await expect(
            generateGeminiImage({
                apiKey: 'k',
                model: 'm',
                prompt: 'p',
                aspectRatio: '2:3',
                fetch: vi.fn(async () => jsonResponse(429, { error: 'quota' })),
            }),
        ).rejects.toThrowError(/gemini image generation failed: HTTP 429/);

        await expect(
            generateGeminiImage({
                apiKey: 'k',
                model: 'm',
                prompt: 'p',
                aspectRatio: '2:3',
                fetch: vi.fn(async () =>
                    jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'no' }] } }] }),
                ),
            }),
        ).rejects.toThrowError('gemini returned no image data (expected an inlineData part).');
    });
});
