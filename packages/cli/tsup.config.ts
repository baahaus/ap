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
  // Bundle workspace packages into the CLI binary so it runs standalone
  noExternal: ['@ap/ai', '@ap/core', '@ap/tui', '@ap/team', '@sinclair/typebox'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
