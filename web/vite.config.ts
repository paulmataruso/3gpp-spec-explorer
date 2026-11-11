import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'dist/web');
const nm = path.join(root, 'node_modules');

/** font files we ship (latin subsets + KaTeX woff2) */
function fontFiles(): [string, string][] {
  const list: [string, string][] = [];
  for (const f of ['400-normal', '400-italic', '500-normal', '600-normal', '700-normal'])
    list.push([path.join(nm, `@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${f}.woff2`), `ibm-plex-sans-latin-${f}.woff2`]);
  for (const f of ['400-normal', '500-normal', '600-normal'])
    list.push([path.join(nm, `@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${f}.woff2`), `jetbrains-mono-latin-${f}.woff2`]);
  const kdir = path.join(nm, 'katex/dist/fonts');
  for (const f of fs.readdirSync(kdir)) if (f.endsWith('.woff2')) list.push([path.join(kdir, f), `katex/${f}`]);
  return list;
}

function assets(): Plugin {
  return {
    name: 'spec-explorer-assets',
    configureServer(server) {
      const files = new Map(fontFiles().map(([src, name]) => [name, src]));
      server.middlewares.use('/fonts/', (req, res, next) => {
        const f = files.get(decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]));
        if (!f) return next();
        res.setHeader('Content-Type', 'font/woff2');
        fs.createReadStream(f).pipe(res);
      });
    },
    closeBundle() {
      for (const [src, name] of fontFiles()) {
        const dst = path.join(out, 'fonts', name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
      for (const f of fs.readdirSync(path.join(here, 'static'))) fs.copyFileSync(path.join(here, 'static', f), path.join(out, f));
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: false,
  plugins: [assets()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_PROXY || 'http://localhost:8080' },
  },
  build: {
    outDir: out,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: path.join(here, 'src/embed.ts'),
      formats: ['es'],
      fileName: () => 'embed.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
