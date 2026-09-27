// OpenAI Images API：POST /v1/images/generations，图片总是以 base64 返回。
// key 只进 Authorization 头。服务端错误正文可能回显 key，进报错信息前先脱敏。
import { redactSecrets } from '../stock/http.ts';

export type ModelFetch = (url: string, init: RequestInit) => Promise<Response>;

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

export async function failureText(response: Response, apiKey: string): Promise<string> {
    let body: string;
    try {
        body = redactSecrets((await response.text()).slice(0, 300), [apiKey]);
    } catch {
        body = '';
    }
    return body === '' ? `HTTP ${response.status}` : `HTTP ${response.status}: ${body}`;
}

export async function generateOpenAiImage(input: {
    apiKey: string;
    model: string;
    prompt: string;
    width: number;
    height: number;
    fetch: ModelFetch;
}): Promise<Buffer> {
    const response = await input.fetch(OPENAI_IMAGES_URL, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            size: `${input.width}x${input.height}`,
        }),
    });

    if (!response.ok) {
        throw new Error(
            `openai image generation failed: ${await failureText(response, input.apiKey)}`,
        );
    }

    let parsed: { data?: { b64_json?: string }[] };
    try {
        parsed = (await response.json()) as typeof parsed;
    } catch {
        throw new Error('openai returned a response that is not JSON.');
    }
    const b64 = parsed.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64 === '') {
        throw new Error('openai returned no image data (expected data[0].b64_json).');
    }
    return Buffer.from(b64, 'base64');
}
