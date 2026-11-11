// Bundle the TypeScript server into dependency-free ESM files under dist/server.
import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true, logLevel: 'info', legalComments: 'none' };
await build({ ...common, entryPoints: ['server/server.ts'], outfile: 'dist/server/server.js' });
await build({ ...common, entryPoints: ['server/index.ts'], outfile: 'dist/server/index.js' });
