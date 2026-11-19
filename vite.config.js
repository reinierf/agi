// @ts-check
import {defineConfig} from 'vite';
import gamesPlugin from './tools/games-plugin.js';

export default defineConfig({
    // Relative asset URLs, so the build also works when hosted under a sub-path.
    base: './',
    plugins: [gamesPlugin()],
    server: {port: 3000},
    preview: {port: 3000},
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
