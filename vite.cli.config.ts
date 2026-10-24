import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/** Builds the Node CLI (dist-cli/composure.mjs) from the same core as the web app. */
export default defineConfig({
  publicDir: false,
  define: {
    __COMPOSURE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    ssr: 'src/cli/composure.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'composure.mjs',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    // Bundle dependencies (yaml) so the CLI is a single self-contained file
    noExternal: true,
  },
});
