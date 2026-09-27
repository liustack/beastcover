// OpenAI Images API：POST /v1/images/generations 画新图，给了参考图就走 /v1/images/edits
// （multipart，参考图放 image 字段）。GPT Image 模型的结果总是 base64。
// key 只进 Authorization 头。服务端错误正文可能回显 key，进报错信息前先脱敏。
import { redactSecrets } from '../stock/http.ts';

export type ModelFetch = (url: string, init: RequestInit) => Promise<Response>;

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';

/** 参考图的类型：场景图是我们自己存的 PNG，agent 画的也可能是 JPEG */
export function referenceMime(bytes: Buffer): 'image/png' | 'image/jpeg' {
    if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
        return 'image/png';
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
        return 'image/jpeg';
    }
    throw new Error('The reference image is neither PNG nor JPEG.');
}

export async function failureText(response: Response, apiKey: string): Promise<string> {
    let body: string;
    try {
        // 先脱敏再截断：反过来会在截断点留下替换不掉的 key 前缀。
        body = redactSecrets(await response.text(), [apiKey]).slice(0, 300);
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
    /** 照着改的那张图：同一个地方、同一个机位，只改描述里说的 */
    reference?: Buffer;
    fetch: ModelFetch;
}): Promise<Buffer> {
    const size = `${input.width}x${input.height}`;
    const { reference } = input;
    const response =
        reference === undefined
            ? await input.fetch(OPENAI_IMAGES_URL, {
                  method: 'POST',
                  headers: {
                      authorization: `Bearer ${input.apiKey}`,
                      'content-type': 'application/json',
                  },
                  body: JSON.stringify({ model: input.model, prompt: input.prompt, size }),
              })
            : await (() => {
                  // multipart 的边界由 fetch 自己写进 content-type，这里不能手动设。
                  const form = new FormData();
                  const type = referenceMime(reference);
                  form.append('model', input.model);
                  form.append('prompt', input.prompt);
                  form.append('size', size);
                  form.append(
                      'image',
                      new Blob([new Uint8Array(reference)], { type }),
                      type === 'image/png' ? 'reference.png' : 'reference.jpg',
                  );
                  return input.fetch(OPENAI_EDITS_URL, {
                      method: 'POST',
                      headers: { authorization: `Bearer ${input.apiKey}` },
                      body: form,
                  });
              })();

    if (!response.ok) {
        throw new Error(
            `openai image ${reference === undefined ? 'generation' : 'edit'} failed: ${await failureText(response, input.apiKey)}`,
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
