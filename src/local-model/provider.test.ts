import { describe, expect, it, vi } from 'vitest';
import { selectLocalModelProvider } from './index.ts';

describe('local-model provider selection', () => {
    it('uses explicit via grok and does not fall back to codex', () => {
        const found = vi.fn((name: string) => (name === 'grok' ? '/bin/grok' : '/bin/codex'));
        expect(selectLocalModelProvider({ via: 'grok', lookup: found })).toEqual({
            provider: 'grok',
            commandPath: '/bin/grok',
        });
        expect(found).not.toHaveBeenCalledWith('codex');
        expect(found).not.toHaveBeenCalledWith('claude');

        const names: string[] = [];
        const missingGrok = vi.fn((name: string) => {
            names.push(name);
            return name === 'codex' ? '/bin/codex' : undefined;
        });
        expect(() => selectLocalModelProvider({ via: 'grok', lookup: missingGrok })).toThrowError(
            /grok/,
        );
        expect(names).not.toContain('codex');
        expect(names).not.toContain('claude');
    });

    it('uses configVia claude when via is omitted and does not silently switch', () => {
        const found = vi.fn((name: string) => (name === 'claude' ? '/bin/claude' : '/bin/codex'));
        expect(
            selectLocalModelProvider({
                configVia: 'claude',
                lookup: found,
            }),
        ).toEqual({
            provider: 'claude',
            commandPath: '/bin/claude',
        });
        expect(found).not.toHaveBeenCalledWith('codex');
        expect(found).not.toHaveBeenCalledWith('grok');

        const names: string[] = [];
        const missingClaude = vi.fn((name: string) => {
            names.push(name);
            return name === 'codex' ? '/bin/codex' : undefined;
        });
        expect(() =>
            selectLocalModelProvider({ configVia: 'claude', lookup: missingClaude }),
        ).toThrowError(/claude/);
        expect(names).not.toContain('codex');
        expect(names).not.toContain('grok');
    });

    it('picks the first installed CLI among codex, grok, then claude', () => {
        expect(
            selectLocalModelProvider({
                lookup: (name) => `/${name}`,
            }),
        ).toEqual({
            provider: 'codex',
            commandPath: '/codex',
        });

        expect(
            selectLocalModelProvider({
                lookup: (name) => (name === 'grok' ? '/bin/grok' : undefined),
            }),
        ).toEqual({
            provider: 'grok',
            commandPath: '/bin/grok',
        });

        expect(
            selectLocalModelProvider({
                lookup: (name) => (name === 'claude' ? '/bin/claude' : undefined),
            }),
        ).toEqual({
            provider: 'claude',
            commandPath: '/bin/claude',
        });
    });

    it('names every backend when none of the CLIs are installed', () => {
        expect(() => selectLocalModelProvider({ lookup: () => undefined })).toThrowError(/codex/);
        expect(() => selectLocalModelProvider({ lookup: () => undefined })).toThrowError(/grok/);
        expect(() => selectLocalModelProvider({ lookup: () => undefined })).toThrowError(/claude/);
    });
});
