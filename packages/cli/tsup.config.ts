import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@ap/ai', '@ap/core', '@ap/tui', 'chalk'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
