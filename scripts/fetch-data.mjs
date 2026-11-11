#!/usr/bin/env node
/**
 * First-start data download for `docker compose up`. The container entrypoint (docker/entrypoint.sh) runs it
 * before the server, and it makes sure /data holds the spec database and figures:
 *
 * - /data/3gpp.db exists and was not installed by this script (you built or copied your own): nothing to do
 * - the release named in data-bundle.json is already installed: nothing to do
 * - otherwise it downloads that release's files (scripts/publish-data.mjs makes them), checks their size and
 *   SHA-256, and unpacks them. Downloads resume after an interruption, and each part is deleted once unpacked.
 *
 * While it works, it answers on PORT with a progress page, so http://localhost:8080 shows what is happening;
 * the app replaces it when the download is done. DATA_DOWNLOAD=off skips all of this.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, PassThrough } from 'node:stream';

const env = (k, d) => process.env[k] || d;
const DB_PATH = path.resolve(env('DB_PATH', '/data/3gpp.db'));
const DATA = path.dirname(DB_PATH);
const IMAGES = path.resolve(env('IMAGES_DIR', path.join(DATA, 'images')));
const BUNDLE = path.resolve(env('DATA_BUNDLE', '/app/data-bundle.json'));
const MARK = path.join(DATA, '.bundle.json');
const WORK = path.join(DATA, '.download');
const STATE = path.join(WORK, 'state.json');

const log = (...a) => console.log('[data]', ...a);
const gb = (n) => (n / 1e9).toFixed(1) + ' GB';
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

// ---- progress page --------------------------------------------------------------------------------------------

const progress = { phase: 'Starting', file: '', done: 0, total: 0, startedAt: Date.now(), error: '' };

function page() {
  const pct = progress.total ? Math.min(100, Math.floor((progress.done / progress.total) * 100)) : 0;
  const secs = (Date.now() - progress.startedAt) / 1000;
  const rate = progress.done / Math.max(secs, 1);
  const eta = rate > 0 && progress.total > progress.done ? Math.ceil((progress.total - progress.done) / rate / 60) : null;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>Preparing 3GPP Spec Explorer</title><style>
:root{--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--bar:#e2e8f0;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--text:#e2e8f0;--muted:#94a3b8;--bar:#1e293b;--accent:#60a5fa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);max-width:520px;width:100%;padding:32px;border-radius:14px;box-shadow:0 1px 3px #0002}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px}
.bar{height:10px;background:var(--bar);border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent);width:${pct}%}
.row{display:flex;justify-content:space-between;margin-top:10px;font-size:14px;color:var(--muted)}.err{color:#dc2626;margin-top:16px}
</style></head><body><main><h1>Getting the specification data ready</h1>
<p>The first start downloads the database and figures (${gb(progress.total)}). This happens once; the app opens here by itself when it's done.</p>
<div class="bar"><i></i></div>
<div class="row"><span>${esc(progress.phase)}${progress.file ? ` · ${esc(progress.file)}` : ''}</span><span>${pct}%</span></div>
<div class="row"><span>${gb(progress.done)} of ${gb(progress.total)}</span><span>${eta ? `about ${eta} min left` : ''}</span></div>
${progress.error ? `<div class="err">${esc(progress.error)} Retrying…</div>` : ''}
</main></body></html>`;
}

function startProgressServer() {
  const srv = http.createServer((req, res) => {
    const json = /\/api\//.test(req.url ?? '');
    res.writeHead(503, { 'Content-Type': json ? 'application/json' : 'text/html; charset=utf-8', 'Retry-After': '10', 'Cache-Control': 'no-store' });
    res.end(json ? JSON.stringify({ ok: false, status: 'downloading-data', ...progress }) : page());
  });
  srv.on('error', (e) => log(`progress page unavailable: ${e.message}`));
  srv.listen(+env('PORT', '8080'), env('HOST', '0.0.0.0'));
  return srv;
}

// ---- download -------------------------------------------------------------------------------------------------

async function sha256(file) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

/** downloads one release file into WORK, resuming a partial one, and verifies it */
async function download(bundle, f) {
  const tmp = path.join(WORK, f.name);
  const base = progress.done;
  for (let attempt = 1; ; attempt++) {
    progress.phase = 'Downloading';
    let have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (have > f.size) {
      fs.rmSync(tmp);
      have = 0;
    }
    try {
      if (have < f.size) {
        const ctrl = new AbortController();
        let timer = setTimeout(() => ctrl.abort(), 60_000);
        const res = await fetch(bundle.baseUrl + encodeURIComponent(f.name), {
          headers: have ? { Range: `bytes=${have}-` } : {},
          signal: ctrl.signal,
        });
        if (res.status === 200) have = 0; // no range support: start over
        else if (res.status !== 206) throw new Error(`HTTP ${res.status} for ${f.name}`);
        progress.done = base + have;
        const count = new Transform({
          transform(chunk, _e, cb) {
            clearTimeout(timer);
            timer = setTimeout(() => ctrl.abort(), 60_000); // stalled for a minute: retry
            progress.done += chunk.length;
            cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' }));
        clearTimeout(timer);
      }
      progress.phase = 'Checking';
      if (fs.statSync(tmp).size !== f.size || (await sha256(tmp)) !== f.sha256) {
        fs.rmSync(tmp);
        throw new Error(`${f.name} failed its checksum`);
      }
      progress.error = '';
      progress.done = base + f.size;
      return tmp;
    } catch (e) {
      if (attempt >= 10) throw e;
      progress.error = `${e.message || e}.`;
      log(`${f.name}: ${progress.error} retrying (${attempt}/10)`);
      await new Promise((r) => setTimeout(r, Math.min(60, 5 * attempt) * 1000));
    }
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

// ---- main -----------------------------------------------------------------------------------------------------

async function main() {
  if (env('DATA_DOWNLOAD', 'auto') === 'off') return log(`DATA_DOWNLOAD=off: using what is in ${DATA}`);
  const bundle = readJson(BUNDLE);
  const mark = readJson(MARK);
  const haveDb = fs.existsSync(DB_PATH);
  if (haveDb && !mark) return log(`${DB_PATH} was not downloaded by this script (your own build?): using it as is`);
  if (!bundle) {
    if (haveDb) return;
    throw new Error(`no data in ${DATA} and no ${BUNDLE} to download it from`);
  }
  if (haveDb && mark?.tag === bundle.tag) return log(`spec data ${bundle.tag} is installed`);

  fs.mkdirSync(WORK, { recursive: true });
  let state = readJson(STATE);
  if (state?.tag !== bundle.tag) {
    if (mark) {
      log(`replacing spec data ${mark.tag} with ${bundle.tag}`);
      fs.rmSync(DB_PATH, { force: true });
      fs.rmSync(IMAGES, { recursive: true, force: true });
      fs.rmSync(MARK, { force: true });
    }
    for (const f of fs.readdirSync(WORK)) fs.rmSync(path.join(WORK, f), { recursive: true, force: true });
    state = { tag: bundle.tag, done: [] };
  }
  const save = () => fs.writeFileSync(STATE, JSON.stringify(state));
  const todo = bundle.files.filter((f) => !state.done.includes(f.name));
  const dbParts = bundle.files.filter((f) => f.kind === 'db');

  // room for what is still to come: unpacked size plus one part in flight (the db parts all at once)
  const dbLeft = dbParts.some((f) => !state.done.includes(f.name));
  const need =
    todo.filter((f) => f.kind === 'images').reduce((a, f) => a + f.size, 0) +
    (dbLeft ? bundle.dbBytes + dbParts.reduce((a, f) => a + f.size, 0) : 0) +
    Math.max(0, ...todo.map((f) => f.size));
  const st = fs.statfsSync(DATA);
  const free = st.bavail * st.bsize;
  if (free < need) throw new Error(`not enough disk space in ${DATA}: ${gb(need)} needed, ${gb(free)} free`);

  progress.total = bundle.downloadBytes;
  progress.done = bundle.files.filter((f) => state.done.includes(f.name)).reduce((a, f) => a + f.size, 0);
  log(`downloading spec data ${bundle.tag}: ${todo.length} file(s), ${gb(progress.total - progress.done)} to go`);
  const srv = startProgressServer();
  try {
    // database: all parts, then one zstd stream into place
    if (dbLeft) {
      const files = [];
      for (const f of dbParts) {
        progress.phase = 'Downloading';
        progress.file = f.name;
        files.push(await download(bundle, f));
      }
      progress.phase = 'Unpacking';
      progress.file = 'database';
      const cat = new PassThrough();
      (async () => {
        for (const f of files) for await (const c of fs.createReadStream(f)) if (!cat.write(c)) await new Promise((r) => cat.once('drain', r));
        cat.end();
      })().catch((e) => cat.destroy(e));
      await pipeline(cat, zlib.createZstdDecompress(), fs.createWriteStream(DB_PATH + '.tmp'));
      fs.renameSync(DB_PATH + '.tmp', DB_PATH);
      for (const f of files) fs.rmSync(f);
      state.done.push(...dbParts.map((f) => f.name));
      save();
    }
    // figures: each tar on its own
    fs.mkdirSync(IMAGES, { recursive: true });
    for (const f of todo.filter((x) => x.kind === 'images')) {
      progress.phase = 'Downloading';
      progress.file = f.name;
      const file = await download(bundle, f);
      progress.phase = 'Unpacking';
      await run('tar', ['-xof', file, '-C', IMAGES]);
      fs.rmSync(file);
      state.done.push(f.name);
      save();
    }
    // hand the files to whoever owns the data folder on the host
    const { uid, gid } = fs.statSync(DATA);
    if (process.getuid?.() === 0 && (uid !== 0 || gid !== 0)) await run('chown', ['-R', `${uid}:${gid}`, DB_PATH, IMAGES]);
    fs.writeFileSync(MARK, JSON.stringify({ tag: bundle.tag, builtAt: bundle.builtAt, installedAt: new Date().toISOString() }, null, 1) + '\n');
    fs.rmSync(WORK, { recursive: true, force: true });
    log(`spec data ${bundle.tag} installed (${bundle.specs} specs, ${bundle.figures} figures)`);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(() => r()));
  }
}

main().catch((e) => {
  console.error('[data]', e.message || e);
  process.exit(1);
});
