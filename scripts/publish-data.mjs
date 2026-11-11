#!/usr/bin/env node
/**
 * Publish the built data (data/3gpp.db + the figures it uses) as a GitHub Release, so a fresh clone can run
 * `docker compose build && docker compose up -d` and have every spec: scripts/fetch-data.mjs downloads the
 * release on the container's first start.
 *
 *   GITHUB_TOKEN=<token with repo scope> node scripts/publish-data.mjs [--tag data-20261110] [--repo owner/name] [--dry]
 *
 * - The database goes up zstd-compressed, the figures as plain tar files (PNG does not compress). Each file is
 *   under 2 GiB, GitHub's limit for one release file.
 * - Only figures the database references are included, resolved the way the server resolves them (the exact
 *   name, else the same stem as .svg/.png/.jpg/.gif).
 * - Parts are built, uploaded and deleted one at a time, so about 2 GB of free disk is enough. Rerunning resumes:
 *   files already uploaded with the expected size are kept.
 * - Writes data-bundle.json. Commit and push it; `docker compose build` then picks up the new data.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Writable, Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB = path.join(DATA, '3gpp.db');
const IMAGES = path.join(DATA, 'images');
const WORK = path.join(DATA, '.publish');
const PART = 1_900_000_000; // GitHub: each release file must be < 2 GiB
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const REPO =
  flag('--repo') ||
  process.env.GITHUB_REPOSITORY ||
  /github\.com[/:]([^/]+\/[^/.]+)/.exec(pkg.repository?.url ?? '')?.[1];
if (!REPO) throw new Error('No repository: pass --repo owner/name');
if (!fs.existsSync(DB)) throw new Error(`${DB} not found: build the data first (docs/data-pipeline.md)`);

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const gb = (n) => (n / 1e9).toFixed(2) + ' GB';

// ---- what goes in -----------------------------------------------------------------------------------------

const db = new DatabaseSync(DB, { readOnly: true });
const info = JSON.parse(db.prepare(`SELECT value FROM meta WHERE key = 'info'`).get()?.value ?? '{}');
const builtAt = info.builtAt ?? new Date(fs.statSync(DB).mtimeMs).toISOString();
const TAG = flag('--tag') || `data-${builtAt.slice(0, 10).replace(/-/g, '')}`;

log(`collecting the figures ${path.relative(ROOT, DB)} references…`);
const refs = new Set();
const SRC = /(?:data-src|src)="(?:[^"]*?\/api\/images\/)?([^"/]+\/images\/[^"]+)"/g;
for (const r of db.prepare('SELECT html FROM sections WHERE html IS NOT NULL').iterate()) {
  for (const m of zlib.brotliDecompressSync(r.html).toString().matchAll(SRC)) refs.add(decodeURIComponent(m[1]));
}
db.close();
const images = new Map(); // relative path under images/ -> size
let unresolved = 0;
for (const ref of refs) {
  const stem = ref.replace(/\.[a-z0-9]+$/i, '');
  const hit = [ref, ...['.svg', '.png', '.jpg', '.gif'].map((e) => stem + e)].find((p) => fs.existsSync(path.join(IMAGES, p)));
  if (hit) images.set(hit, fs.statSync(path.join(IMAGES, hit)).size);
  else unresolved++;
}
const imageList = [...images.keys()].sort();
const imageBytes = [...images.values()].reduce((a, b) => a + b, 0);
log(`${refs.size} references → ${imageList.length} files, ${gb(imageBytes)}${unresolved ? ` (${unresolved} have no file)` : ''}`);

// tar groups under the size limit (512-byte header + data padded to 512 per file, 1 KiB end marker)
const groups = [];
{
  let cur = [], size = 1024;
  for (const f of imageList) {
    const s = 512 + Math.ceil(images.get(f) / 512) * 512;
    if (cur.length && size + s > PART) {
      groups.push(cur);
      cur = [];
      size = 1024;
    }
    cur.push(f);
    size += s;
  }
  if (cur.length) groups.push(cur);
}
const dbBytes = fs.statSync(DB).size;
log(`release ${REPO}@${TAG}: database ${gb(dbBytes)} (zstd) + ${groups.length} figure archive(s)`);
if (DRY) process.exit(0);
if (!TOKEN) throw new Error('Set GITHUB_TOKEN (a token with repo scope for ' + REPO + ')');

// ---- GitHub -----------------------------------------------------------------------------------------------

async function gh(method, url, { body, headers = {}, ok404 = false } = {}) {
  const res = await fetch(url.startsWith('https:') ? url : `https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'spec-explorer-publish',
      ...headers,
    },
    body,
    ...(body && typeof body !== 'string' ? { duplex: 'half' } : {}),
  });
  if (ok404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? {} : res.json();
}

const releaseBody = (files) => `Specification data for 3GPP Spec Explorer, built ${builtAt.slice(0, 10)}: the SQLite database \
(${(info.specs ?? 0).toLocaleString('en')} specs, ${(info.sections ?? 0).toLocaleString('en')} sections) and the \
${imageList.length.toLocaleString('en')} figures it uses.

**You don't need to download these by hand.** \`docker compose build && docker compose up -d\` fetches, checks and \
unpacks them on the first start (see the README).

| File | Contents |
|---|---|
${files.map((f) => `| \`${f.name}\` | ${f.kind === 'db' ? 'database, zstd-compressed' : 'figures (tar)'}, ${gb(f.size)} |`).join('\n')}

The specifications are © 3GPP Organizational Partners (ARIB, ATIS, CCSA, ETSI, TSDSI, TTA, TTC).`;

let release = await gh('GET', `/repos/${REPO}/releases/tags/${TAG}`, { ok404: true });
if (!release) {
  log(`creating release ${TAG}`);
  release = await gh('POST', `/repos/${REPO}/releases`, {
    body: JSON.stringify({ tag_name: TAG, name: `Spec data ${builtAt.slice(0, 10)}`, body: 'Uploading…', make_latest: 'true' }),
  });
}
const assets = async () => gh('GET', `/repos/${REPO}/releases/${release.id}/assets?per_page=100`);

// ---- build, upload, delete one part at a time ---------------------------------------------------------------

fs.mkdirSync(WORK, { recursive: true });
const stateFile = path.join(WORK, `${TAG}.json`);
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { files: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));

/** already on the release with the size we recorded for it */
async function uploaded(name) {
  const known = state.files[name];
  const a = (await assets()).find((x) => x.name === name);
  if (a && known && a.size === known.size && a.state === 'uploaded') return true;
  if (a) await gh('DELETE', `/repos/${REPO}/releases/assets/${a.id}`); // partial or stale
  return false;
}

async function upload(file, name) {
  const size = fs.statSync(file).size;
  for (let attempt = 1; ; attempt++) {
    let sent = 0, shown = 0;
    const counter = new Transform({
      transform(chunk, _e, cb) {
        sent += chunk.length;
        if (sent - shown > size / 10) {
          shown = sent;
          log(`  ${name}: ${Math.round((sent / size) * 100)}%`);
        }
        cb(null, chunk);
      },
    });
    try {
      // node:https rather than fetch: fetch gives up on a request whose body takes longer than 5 minutes to send
      const url = `${release.upload_url.replace(/\{.*$/, '')}?name=${encodeURIComponent(name)}`;
      await new Promise((resolve, reject) => {
        const req = https.request(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'spec-explorer-publish',
            'Content-Type': 'application/octet-stream',
            'Content-Length': size,
          },
        }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (text += d));
          res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 300)}`))));
        });
        req.on('error', reject);
        fs.createReadStream(file).pipe(counter).pipe(req);
      });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      log(`  upload failed (${e.message}), retrying…`);
      const a = (await assets()).find((x) => x.name === name);
      if (a) await gh('DELETE', `/repos/${REPO}/releases/assets/${a.id}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

const files = [];

// database: zstd stream cut into parts
{
  const known = Object.entries(state.files).filter(([n]) => n.startsWith('3gpp.db.zst.'));
  let done = known.length > 0;
  for (const [n] of known) if (!(await uploaded(n))) done = false;
  if (done) {
    for (const [n, v] of known) files.push({ name: n, kind: 'db', ...v });
    log('database: already uploaded');
  } else {
    log('database: compressing…');
    const parts = [];
    let cur = null;
    const next = () => {
      const name = `3gpp.db.zst.${String(parts.length + 1).padStart(3, '0')}`;
      cur = { name, file: path.join(WORK, name), fd: fs.openSync(path.join(WORK, name), 'w'), size: 0 };
      parts.push(cur);
    };
    const sink = new Writable({
      write(buf, _e, cb) {
        for (let off = 0; off < buf.length; ) {
          if (!cur || cur.size >= PART) {
            if (cur) fs.closeSync(cur.fd);
            next();
          }
          const n = Math.min(buf.length - off, PART - cur.size);
          fs.writeSync(cur.fd, buf, off, n);
          cur.size += n;
          off += n;
        }
        cb();
      },
      final(cb) {
        if (cur) fs.closeSync(cur.fd);
        cb();
      },
    });
    await pipeline(fs.createReadStream(DB), zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 } }), sink);
    for (const p of parts) {
      const v = { size: p.size, sha256: await sha256(p.file) };
      state.files[p.name] = v;
      save();
      log(`database: uploading ${p.name} (${gb(p.size)})`);
      if (!(await uploaded(p.name))) await upload(p.file, p.name);
      fs.rmSync(p.file);
      files.push({ name: p.name, kind: 'db', ...v });
    }
  }
}

// figures: one tar per group, paths relative to images/
const gnuTar = /GNU tar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout ?? '');
for (let i = 0; i < groups.length; i++) {
  const name = `images.${String(i + 1).padStart(3, '0')}.tar`;
  if (state.files[name] && (await uploaded(name))) {
    files.push({ name, kind: 'images', ...state.files[name] });
    log(`${name}: already uploaded`);
    continue;
  }
  const list = path.join(WORK, `${name}.list`);
  const file = path.join(WORK, name);
  fs.writeFileSync(list, groups[i].join('\n') + '\n');
  log(`${name}: packing ${groups[i].length} files…`);
  const owner = gnuTar ? ['--owner=0', '--group=0', '--numeric-owner'] : ['--uid', '0', '--gid', '0'];
  const r = spawnSync('tar', ['--format=ustar', ...owner, '-cf', file, '-C', IMAGES, '-T', list], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar failed for ${name}`);
  const v = { size: fs.statSync(file).size, sha256: await sha256(file) };
  state.files[name] = v;
  save();
  log(`${name}: uploading (${gb(v.size)})`);
  if (!(await uploaded(name))) await upload(file, name);
  fs.rmSync(file);
  fs.rmSync(list);
  files.push({ name, kind: 'images', ...v });
}

// ---- manifest -----------------------------------------------------------------------------------------------

await gh('PATCH', `/repos/${REPO}/releases/${release.id}`, { body: JSON.stringify({ body: releaseBody(files) }) });
const bundle = {
  format: 1,
  tag: TAG,
  builtAt,
  baseUrl: `https://github.com/${REPO}/releases/download/${TAG}/`,
  specs: info.specs,
  sections: info.sections,
  figures: imageList.length,
  dbBytes,
  imageBytes,
  downloadBytes: files.reduce((a, f) => a + f.size, 0),
  files,
};
fs.writeFileSync(path.join(ROOT, 'data-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
log(`done: ${files.length} files, ${gb(bundle.downloadBytes)} → data-bundle.json (commit and push it)`);
