import {
    MODEL_DEFAULTS,
    MODEL_PROVIDERS,
    type ModelConfig,
    type ModelProvider,
} from '../config.ts';

export interface SelectedModelProvider {
    provider: ModelProvider;
    apiKey: string;
    model: string;
}

function keyFor(config: ModelConfig | undefined, provider: ModelProvider): string | undefined {
    const apiKey = config?.[provider]?.apiKey;
    return apiKey === undefined || apiKey === '' ? undefined : apiKey;
}

function missingKey(provider: ModelProvider): Error {
    return new Error(
        `No API key for ${provider}. Run beastcover config set model.${provider}.apiKey <key>.`,
    );
}

/** 点名的 provider 缺 key 就报错，不换家。没点名时挑第一个配了 key 的。 */
export function selectModelProvider(input: {
    via?: ModelProvider;
    config?: ModelConfig;
}): SelectedModelProvider {
    const requested = input.via ?? input.config?.via;
    if (requested !== undefined) {
        const apiKey = keyFor(input.config, requested);
        if (apiKey === undefined) {
            throw missingKey(requested);
        }
        return {
            provider: requested,
            apiKey,
            model: input.config?.[requested]?.model ?? MODEL_DEFAULTS[requested],
        };
    }

    for (const provider of MODEL_PROVIDERS) {
        const apiKey = keyFor(input.config, provider);
        if (apiKey !== undefined) {
            return {
                provider,
                apiKey,
                model: input.config?.[provider]?.model ?? MODEL_DEFAULTS[provider],
            };
        }
    }

    throw new Error(
        `No image model API key configured. Run beastcover config set model.openai.apiKey <key> or beastcover config set model.gemini.apiKey <key>.`,
    );
}
