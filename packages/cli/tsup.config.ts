import { defineConfig } from 'tsup';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

// Provide require() for bundled CJS deps (cross-spawn via @modelcontextprotocol/sdk)
const cjsShim = `import { createRequire as __blush_cr } from 'node:module'; const require = __blush_cr(import.meta.url);`;

export default defineConfig([
  // Library + SDK entries (no shebang)
  {
    entry: {
      index: 'src/index.ts',
      sdk: 'src/sdk.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    noExternal: ['@blush/ai', '@blush/core', '@blush/tui', '@blush/team', '@sinclair/typebox'],
    banner: { js: cjsShim },
  },
  // Binary entry (with shebang + executable)
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    noExternal: ['@blush/ai', '@blush/core', '@blush/tui', '@blush/team', '@sinclair/typebox'],
    banner: { js: `#!/usr/bin/env node\n${cjsShim}` },
    async onSuccess() {
      await chmod(join('dist', 'bin.js'), 0o755);
    },
  },
]);
