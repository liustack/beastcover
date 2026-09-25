import { LOCAL_MODEL_PROVIDERS, type LocalModelProvider } from '../config.ts';

export function selectLocalModelProvider(input: {
    via?: LocalModelProvider;
    configVia?: LocalModelProvider;
    lookup: (name: string) => string | undefined;
}): { provider: LocalModelProvider; commandPath: string } {
    const requested = input.via ?? input.configVia;
    if (requested !== undefined) {
        const commandPath = input.lookup(requested);
        if (commandPath === undefined) {
            throw new Error(`No installed CLI found for via "${requested}". Install ${requested}.`);
        }
        return { provider: requested, commandPath };
    }

    for (const provider of LOCAL_MODEL_PROVIDERS) {
        const commandPath = input.lookup(provider);
        if (commandPath !== undefined) {
            return { provider, commandPath };
        }
    }

    throw new Error('No local-model CLI found. Install codex, grok, or claude.');
}
