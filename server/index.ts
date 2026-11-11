/**
 * Library entry — mount the explorer inside an existing Node app.
 *
 *   import { createHandler } from '3gpp-spec-explorer/server';
 *   const specs = createHandler({ dbPath: '/data/3gpp.db', imagesDir: '/data/images', staticDir: '/app/dist/web', basePath: '/specs' });
 *   expressApp.use(specs);                    // Express / Connect
 *   http.createServer((q, s) => specs(q, s)); // plain node:http
 */
export { createHandler } from './api.ts';
export type { HandlerOptions } from './api.ts';
