import { describe, expect, it, vi } from 'vitest';
import { selectAgentProvider } from './index.ts';

describe('agent provider selection', () => {
    it('uses explicit via agy and does not fall back to codex', () => {
        const found = vi.fn((name: string) => (name === 'agy' ? '/bin/agy' : '/bin/codex'));
        expect(selectAgentProvider({ via: 'agy', lookup: found })).toEqual({
            provider: 'agy',
            commandPath: '/bin/agy',
        });
        expect(found).not.toHaveBeenCalledWith('codex');

        const names: string[] = [];
        const missingAgy = vi.fn((name: string) => {
            names.push(name);
            return name === 'codex' ? '/bin/codex' : undefined;
        });
        expect(() => selectAgentProvider({ via: 'agy', lookup: missingAgy })).toThrowError(/agy/);
        expect(names).not.toContain('codex');
    });

    it('uses configVia agy when via is omitted and does not silently switch', () => {
        const found = vi.fn((name: string) => (name === 'agy' ? '/bin/agy' : '/bin/codex'));
        expect(
            selectAgentProvider({
                configVia: 'agy',
                lookup: found,
            }),
        ).toEqual({
            provider: 'agy',
            commandPath: '/bin/agy',
        });
        expect(found).not.toHaveBeenCalledWith('codex');

        const names: string[] = [];
        const missingAgy = vi.fn((name: string) => {
            names.push(name);
            return name === 'codex' ? '/bin/codex' : undefined;
        });
        expect(() => selectAgentProvider({ configVia: 'agy', lookup: missingAgy })).toThrowError(
            /agy/,
        );
        expect(names).not.toContain('codex');
    });

    it('picks the first installed CLI among codex, then agy', () => {
        expect(
            selectAgentProvider({
                lookup: (name) => `/${name}`,
            }),
        ).toEqual({
            provider: 'codex',
            commandPath: '/codex',
        });

        expect(
            selectAgentProvider({
                lookup: (name) => (name === 'agy' ? '/bin/agy' : undefined),
            }),
        ).toEqual({
            provider: 'agy',
            commandPath: '/bin/agy',
        });
    });

    it('names every backend when none of the CLIs are installed', () => {
        expect(() => selectAgentProvider({ lookup: () => undefined })).toThrowError(/codex/);
        expect(() => selectAgentProvider({ lookup: () => undefined })).toThrowError(/agy/);
    });
});
