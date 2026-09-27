// Gemini generateContent：imageConfig 定比例，图片在 candidates 的 inlineData 里（base64）。
// key 只进 x-goog-api-key 头。服务端错误正文可能回显 key，进报错信息前先脱敏。
import { failureText, type ModelFetch, referenceMime } from './openai.ts';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function generateGeminiImage(input: {
    apiKey: string;
    model: string;
    prompt: string;
    /** 生成比例，如 3:2、2:3，取自族的生成计划 */
    aspectRatio: string;
    /** 照着改的那张图，和提示词放在同一轮里 */
    reference?: Buffer;
    fetch: ModelFetch;
}): Promise<Buffer> {
    const parts: object[] =
        input.reference === undefined
            ? [{ text: input.prompt }]
            : [
                  {
                      inlineData: {
                          mimeType: referenceMime(input.reference),
                          data: input.reference.toString('base64'),
                      },
                  },
                  { text: input.prompt },
              ];
    const response = await input.fetch(
        `${GEMINI_BASE_URL}/${encodeURIComponent(input.model)}:generateContent`,
        {
            method: 'POST',
            headers: {
                'x-goog-api-key': input.apiKey,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    imageConfig: { aspectRatio: input.aspectRatio },
                },
            }),
        },
    );

    if (!response.ok) {
        throw new Error(
            `gemini image generation failed: ${await failureText(response, input.apiKey)}`,
        );
    }

    let parsed: {
        candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    try {
        parsed = (await response.json()) as typeof parsed;
    } catch {
        throw new Error('gemini returned a response that is not JSON.');
    }
    const data = parsed.candidates?.[0]?.content?.parts?.find(
        (part) => typeof part.inlineData?.data === 'string' && part.inlineData.data !== '',
    )?.inlineData?.data;
    if (data === undefined) {
        throw new Error('gemini returned no image data (expected an inlineData part).');
    }
    return Buffer.from(data, 'base64');
}
