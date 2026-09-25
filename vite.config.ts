/// <reference types="vitest/config" />

import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        lib: {
            entry: resolve(__dirname, 'src/main.ts'),
            formats: ['es'],
            fileName: 'main',
        },
        rollupOptions: {
            external: [
                'commander',
                'playwright',
                'sharp',
                ...builtinModules,
                ...builtinModules.map((name) => `node:${name}`),
            ],
        },
        target: 'node22',
        outDir: 'dist',
        emptyOutDir: true,
        minify: false,
    },
});
