/**
 * Standalone server: API + web UI.
 *
 * Env:
 *   PORT=8080  HOST=0.0.0.0
 *   DB_PATH=./data/3gpp.db  IMAGES_DIR=./data/images  STATIC_DIR=./dist/web
 *   BASE_PATH=""  (e.g. "/3gpp" when reverse-proxied under a prefix)
 *   CORS_ORIGIN="*"  LOG_REQUESTS=1
 *   STATIC_DIR="" serves the API only
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHandler } from './api.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.existsSync(path.join(here, '../package.json')) ? path.join(here, '..') : path.join(here, '../..');
const env = (k: string, d: string) => process.env[k] ?? d;

const opts = {
  dbPath: path.resolve(env('DB_PATH', path.join(root, 'data/3gpp.db'))),
  imagesDir: path.resolve(env('IMAGES_DIR', path.join(root, 'data/images'))),
  // STATIC_DIR="" serves the API only
  staticDir: process.env.STATIC_DIR === '' ? undefined : path.resolve(env('STATIC_DIR', path.join(root, 'dist/web'))),
  basePath: env('BASE_PATH', ''),
  corsOrigin: env('CORS_ORIGIN', '*'),
};
const handler = createHandler(opts);
const port = Number(env('PORT', '8080'));
const host = env('HOST', '0.0.0.0');

const server = http.createServer((req, res) => {
  const t0 = performance.now();
  res.on('finish', () => {
    if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${req.url} ${res.statusCode} ${(performance.now() - t0).toFixed(1)}ms`);
  });
  handler(req, res);
});
server.keepAliveTimeout = 65_000;
server.listen(port, host, () => {
  console.log(`3GPP Spec Explorer listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${opts.basePath || '/'}`);
  console.log(`  db: ${opts.dbPath} (${handler.db.specs.length} specs)`);
  console.log(`  ui: ${opts.staticDir && fs.existsSync(opts.staticDir) ? opts.staticDir : '(none — API only)'}`);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
