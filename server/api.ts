/**
 * Framework-agnostic request handler: `createHandler(opts)` returns a
 * `(req, res, next?) => void` function usable with node:http, Express, Connect,
 * Fastify (via middie), Next.js custom servers, etc.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SpecDb, unbr } from './db.ts';
import { search, facets, suggest, normalizeSpec } from './search.ts';
import { SERIES } from '../shared/catalog.ts';
import { TermIndex } from './terms.ts';

export interface HandlerOptions {
  /** path to the SQLite database built by `npm run build:db` */
  dbPath: string;
  /** directory with figure images: <imagesDir>/<spec>/images/imageN.png */
  imagesDir?: string;
  /** directory with the built web UI (index.html, assets) — omit to serve the API only */
  staticDir?: string;
  /** URL prefix the app is mounted under, e.g. "/3gpp" (default "") */
  basePath?: string;
  /** value for Access-Control-Allow-Origin (default "*") */
  corsOrigin?: string;
}

type Req = IncomingMessage & { originalUrl?: string };
type Next = (err?: unknown) => void;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

function pickEncoding(req: Req): 'br' | 'gzip' | null {
  const ae = String(req.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

function compress(buf: Buffer, enc: 'br' | 'gzip'): Buffer {
  return enc === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
    : zlib.gzipSync(buf, { level: 6 });
}

export function createHandler(opts: HandlerOptions) {
  const db = new SpecDb(opts.dbPath);
  const terms = new TermIndex(db);
  const base = (opts.basePath ?? '').replace(/\/+$/, '');
  const cors = opts.corsOrigin ?? '*';
  const staticDir = opts.staticDir ? path.resolve(opts.staticDir) : undefined;
  const imagesDir = opts.imagesDir ? path.resolve(opts.imagesDir) : undefined;
  const staticCache = new Map<string, { raw: Buffer; br?: Buffer; gz?: Buffer; mtime: number }>();
  let lastCheck = 0;

  function headers(res: ServerResponse, extra: Record<string, string> = {}) {
    res.setHeader('Access-Control-Allow-Origin', cors);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  }

  function sendBody(req: Req, res: ServerResponse, body: Buffer, type: string, cache: string, precompressed?: { br?: Buffer; gz?: Buffer }) {
    headers(res, { 'Content-Type': type, 'Cache-Control': cache });
    const enc = body.length > 1024 && /json|text|javascript|svg/.test(type) ? pickEncoding(req) : null;
    let out = body;
    if (enc) {
      out = (enc === 'br' ? precompressed?.br : precompressed?.gz) ?? compress(body, enc);
      res.setHeader('Content-Encoding', enc);
    }
    res.setHeader('Content-Length', out.length);
    res.statusCode = 200;
    if (req.method === 'HEAD') res.end();
    else res.end(out);
  }

  function json(req: Req, res: ServerResponse, data: unknown, cache = 'public, max-age=300') {
    sendBody(req, res, Buffer.from(JSON.stringify(data)), 'application/json; charset=utf-8', cache);
  }

  function sectionPayload(spec: string, sid: string, deep: boolean) {
    const s = db.section(spec, sid);
    if (!s) throw new HttpError(404, `Section ${sid} not found in ${spec}`);
    const meta = db.specMap.get(spec)!;
    const parents: { sid: string; num: string | null; title: string }[] = [];
    let p = s.parent;
    let guard = 0;
    while (p && guard++ < 20) {
      const ps = db.section(spec, p);
      if (!ps) break;
      parents.unshift({ sid: ps.sid, num: ps.num, title: ps.title });
      p = ps.parent;
    }
    const prev = db.neighbour(spec, s.ord, -1);
    const next = db.neighbour(spec, s.ord, 1);
    const lite = (x?: { sid: string; num: string | null; title: string }) => (x ? { sid: x.sid, num: x.num, title: x.title } : null);
    const children = db.children(spec, sid).map((c) => ({ sid: c.sid, num: c.num, title: c.title, hasContent: c.chars > 0, childCount: c.child_count }));
    let parts: { sid: string; num: string | null; title: string; depth: number; html: string }[] | undefined;
    let truncated = false;
    if (deep && s.child_count > 0) {
      const LIMIT_CHARS = 600_000;
      let total = 0;
      parts = [];
      for (const r of db.subtree(spec, s.ord, s.depth, 400).slice(1)) {
        const html = unbr(r.html);
        total += html.length;
        if (total > LIMIT_CHARS) {
          truncated = true;
          break;
        }
        parts.push({ sid: r.sid, num: r.num, title: r.title, depth: r.depth - s.depth, html });
      }
    }
    return {
      spec,
      specTitle: meta.short_title,
      release: meta.release,
      type: meta.type,
      version: meta.latest_version,
      sid: s.sid,
      num: s.num,
      title: s.title,
      html: unbr(s.html),
      hasContent: s.chars > 0,
      parents,
      children,
      prev: lite(prev),
      next: lite(next),
      parts,
      truncated,
      refBy: terms.backlinks(spec, s.sid),
    };
  }

  function serveFile(req: Req, res: ServerResponse, file: string, cache: string): boolean {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
      if (!st.isFile()) return false;
    } catch {
      return false;
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    let entry = staticCache.get(file);
    if (!entry || entry.mtime !== st.mtimeMs) {
      entry = { raw: fs.readFileSync(file), mtime: st.mtimeMs };
      if (st.size < 8_000_000) staticCache.set(file, entry);
    }
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      headers(res, { ETag: etag, 'Cache-Control': cache });
      res.statusCode = 304;
      res.end();
      return true;
    }
    res.setHeader('ETag', etag);
    const enc = /json|text|javascript|svg/.test(type) && entry.raw.length > 1024 ? pickEncoding(req) : null;
    if (enc === 'br' && !entry.br) entry.br = zlib.brotliCompressSync(entry.raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    if (enc === 'gzip' && !entry.gz) entry.gz = zlib.gzipSync(entry.raw, { level: 9 });
    sendBody(req, res, entry.raw, type, cache, entry);
    return true;
  }

  function route(req: Req, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (base) {
      if (p !== base && !p.startsWith(base + '/')) return false;
      p = p.slice(base.length) || '/';
    }
    const qs = url.searchParams;

    if (p.startsWith('/api/')) {
      const now = Date.now();
      if (now - lastCheck > 5000) {
        lastCheck = now;
        db.refreshIfChanged();
      }
      const seg = p.slice(5).split('/').filter(Boolean);
      // /api/info
      if (seg[0] === 'info') {
        json(req, res, {
          ...db.info,
          series: Object.entries(SERIES)
            .map(([key, name]) => ({ key, name, count: db.specs.filter((s) => s.series === key).length }))
            .filter((x) => x.count > 0),
        });
        return true;
      }
      // /api/specs, /api/specs/:spec, /api/specs/:spec/sections/:sid
      if (seg[0] === 'specs') {
        if (seg.length === 1) {
          json(
            req,
            res,
            db.specs.map((s) => ({
              spec: s.spec,
              title: s.short_title,
              tsg: s.tsg,
              type: s.type,
              release: s.release,
              rel: s.rel_num,
              series: s.series,
              sections: s.section_count,
              available: s.available,
              version: s.latest_version,
              date: s.latest_date,
              ...(s.source === 'archive' ? { source: 'archive', status: s.status } : {}),
            })),
          );
          return true;
        }
        const spec = normalizeSpec(seg[1], db) ?? seg[1];
        const meta = db.specMap.get(spec);
        if (!meta) throw new HttpError(404, `Unknown spec ${seg[1]}`);
        if (seg.length === 2) {
          const toc = db.tocBlob(spec);
          json(req, res, { ...meta, versions: db.versions(spec), toc: toc ? JSON.parse(unbr(toc)) : [] });
          return true;
        }
        if (seg[2] === 'sections' && seg[3]) {
          json(req, res, sectionPayload(spec, seg.slice(3).join('/').toLowerCase(), qs.get('deep') === '1'));
          return true;
        }
        throw new HttpError(404, 'Not found');
      }
      if (seg[0] === 'search') {
        const o = {
          q: qs.get('q') ?? '',
          spec: qs.get('spec') ?? undefined,
          series: qs.get('series') ?? undefined,
          rel: qs.get('rel') ? Number(qs.get('rel')) : undefined,
          type: qs.get('type') ?? undefined,
          limit: qs.get('limit') ? Number(qs.get('limit')) : undefined,
          offset: qs.get('offset') ? Number(qs.get('offset')) : undefined,
          inTitle: qs.get('in') === 'title',
        };
        json(req, res, seg[1] === 'facets' ? facets(db, o) : search(db, o), 'public, max-age=120');
        return true;
      }
      // /api/terms/:spec — abbreviations to link in that spec; /api/term?t=AUSF&spec=23.501 — where a term is described
      if (seg[0] === 'terms' && seg[1]) {
        const spec = normalizeSpec(seg[1], db) ?? seg[1];
        if (!db.specMap.has(spec)) throw new HttpError(404, `Unknown spec ${seg[1]}`);
        json(req, res, { spec, abbr: terms.abbrevs(spec) }, 'public, max-age=3600');
        return true;
      }
      if (seg[0] === 'term') {
        const t = (qs.get('t') ?? '').trim();
        if (!t) throw new HttpError(400, 'Missing ?t=');
        const spec = qs.get('spec') ? (normalizeSpec(qs.get('spec')!, db) ?? undefined) : undefined;
        json(req, res, terms.lookup(t, spec), 'public, max-age=600');
        return true;
      }
      if (seg[0] === 'suggest') {
        json(req, res, suggest(db, qs.get('q') ?? '', Math.min(Number(qs.get('limit') ?? 8), 20)), 'public, max-age=120');
        return true;
      }
      if (seg[0] === 'images') {
        if (!imagesDir) throw new HttpError(404, 'Images not configured');
        const rel = path.normalize(seg.slice(1).join('/'));
        const file = path.join(imagesDir, rel);
        if (!file.startsWith(imagesDir + path.sep)) throw new HttpError(400, 'Bad path');
        if (serveFile(req, res, file, 'public, max-age=31536000, immutable')) return true;
        // try alternative extensions (png/svg) for converted figures
        const stem = file.replace(/\.[a-z0-9]+$/i, '');
        for (const ext of ['.svg', '.png', '.jpg', '.gif']) if (serveFile(req, res, stem + ext, 'public, max-age=31536000, immutable')) return true;
        throw new HttpError(404, 'Image not found');
      }
      if (seg[0] === 'health') {
        json(req, res, { ok: true, specs: db.specs.length }, 'no-store');
        return true;
      }
      throw new HttpError(404, 'Unknown API route');
    }

    // static UI
    if (!staticDir) return false;
    const rel = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(staticDir, rel);
    if (file.startsWith(staticDir) && rel !== '/' && !rel.endsWith('index.html') && serveFile(req, res, file, /\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'public, max-age=300')) return true;
    // SPA fallback (history routing): any HTML navigation that isn't a real file gets index.html
    if (String(req.headers.accept ?? '').includes('text/html') && !/^\/(assets|fonts)\//.test(rel)) {
      const idx = path.join(staticDir, 'index.html');
      if (fs.existsSync(idx)) {
        const page = fs.readFileSync(idx, 'utf8').replaceAll('%BASE%', base);
        headers(res, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.statusCode = 200;
        res.end(req.method === 'HEAD' ? undefined : page);
        return true;
      }
    }
    return false;
  }

  const handler = (req: Req, res: ServerResponse, next?: Next) => {
    if (req.method === 'OPTIONS') {
      headers(res, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '86400' });
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (next) return next();
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      if (route(req, res)) return;
      if (next) return next();
      res.statusCode = 404;
      headers(res, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.statusCode = status;
      headers(res, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  };
  return Object.assign(handler, { db });
}
