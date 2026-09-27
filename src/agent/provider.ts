import { AGENT_PROVIDERS, type AgentProvider } from '../config.ts';

export function selectAgentProvider(input: {
    via?: AgentProvider;
    configVia?: AgentProvider;
    lookup: (name: string) => string | undefined;
}): { provider: AgentProvider; commandPath: string } {
    const requested = input.via ?? input.configVia;
    if (requested !== undefined) {
        const commandPath = input.lookup(requested);
        if (commandPath === undefined) {
            throw new Error(`No installed CLI found for via "${requested}". Install ${requested}.`);
        }
        return { provider: requested, commandPath };
    }

    for (const provider of AGENT_PROVIDERS) {
        const commandPath = input.lookup(provider);
        if (commandPath !== undefined) {
            return { provider, commandPath };
        }
    }

    throw new Error('No agent CLI found. Install codex or agy.');
}
