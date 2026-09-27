import { describe, expect, it } from 'vitest';
import { selectModelProvider } from './index.ts';

describe('model provider selection', () => {
    it('uses explicit via and fails on a missing key instead of switching', () => {
        expect(
            selectModelProvider({
                via: 'gemini',
                config: {
                    openai: { apiKey: 'sk-a' },
                    gemini: { apiKey: 'g-b' },
                },
            }),
        ).toMatchObject({ provider: 'gemini', apiKey: 'g-b' });

        expect(() =>
            selectModelProvider({ via: 'gemini', config: { openai: { apiKey: 'sk-a' } } }),
        ).toThrowError(
            'No API key for gemini. Run beastcover config set model.gemini.apiKey <key>.',
        );
    });

    it('uses config via, then the first provider with a key', () => {
        expect(
            selectModelProvider({
                config: { via: 'gemini', openai: { apiKey: 'sk-a' }, gemini: { apiKey: 'g-b' } },
            }),
        ).toMatchObject({ provider: 'gemini' });

        expect(selectModelProvider({ config: { gemini: { apiKey: 'g-b' } } })).toMatchObject({
            provider: 'gemini',
            apiKey: 'g-b',
        });

        expect(
            selectModelProvider({
                config: { openai: { apiKey: 'sk-a' }, gemini: { apiKey: 'g-b' } },
            }),
        ).toMatchObject({ provider: 'openai' });
    });

    it('defaults the model per provider and honors the config override', () => {
        expect(selectModelProvider({ config: { openai: { apiKey: 'sk-a' } } }).model).toBe(
            'gpt-image-2.5-flare',
        );
        expect(selectModelProvider({ config: { gemini: { apiKey: 'g-b' } } }).model).toBe(
            'gemini-3-pro-image-preview',
        );
        expect(
            selectModelProvider({
                config: { openai: { apiKey: 'sk-a', model: 'gpt-image-9' } },
            }).model,
        ).toBe('gpt-image-9');
    });

    it('names both config keys when nothing is configured', () => {
        expect(() => selectModelProvider({})).toThrowError(
            'No image model API key configured. Run beastcover config set model.openai.apiKey <key> or beastcover config set model.gemini.apiKey <key>.',
        );
        expect(() => selectModelProvider({ config: { openai: { apiKey: '' } } })).toThrowError(
            /No image model API key configured/,
        );
    });
});
