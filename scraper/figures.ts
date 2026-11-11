/**
 * Fetch figures for crawled specs from the official 3GPP archive and convert them
 * (EMF/WMF -> PNG) inside the converter container.
 *
 *   docker build -t spec-explorer-converter:1 docker/converter
 *   node scraper/figures.ts [--only 38.300,38.331] [--parallel 4] [--batch 6] [--retry]
 *
 * itecspec names figures images/imageN.png after the docx's word/media/imageN.*,
 * so we take the same version itecspec rendered (newest version of the spec's release).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickUrls, archiveUrls } from './versions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const OUT = path.join(DATA, 'images');
const JOBS = path.join(DATA, 'tmp', 'figure-jobs');
const IMAGE = process.env.CONVERTER_IMAGE || 'spec-explorer-converter:1';
const parallel = Number(opt('parallel') ?? 4);
const batchSize = Number(opt('batch') ?? 6);
const only = opt('only')?.split(',');
const retry = args.includes('--retry');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(JOBS, { recursive: true });


type Dims = [number, number];

/** figure srcs referenced by a crawled spec, their display sizes, and their order in the document */
function figuresOf(spec: string, toc: { id: string; children?: any[] }[]) {
  const f = path.join(DATA, 'raw', 'sections', `${spec}.ndjson.gz`);
  const sizes: Record<string, Dims> = {};
  const perSection = new Map<string, [string, number, number][]>();
  if (!fs.existsSync(f)) return { needed: [] as string[], sizes, order: [] as [string, number, number][] };
  const set = new Set<string>();
  const re = /"src":"images\/(image\d+)\.\w+"[^}]*?"width":(\d+),"height":(\d+)/g;
  for (const line of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line);
    for (const s of o.f ?? []) set.add(s);
    const occ: [string, number, number][] = [];
    for (const m of line.matchAll(re)) {
      const w = Number(m[2]);
      const h = Number(m[3]);
      occ.push([m[1], w, h]);
      if (!sizes[m[1]] || sizes[m[1]][0] < w) sizes[m[1]] = [w, h];
    }
    if (occ.length) perSection.set(o.id, occ);
  }
  // document order = TOC order, then order of appearance within a section
  const order: [string, number, number][] = [];
  const walk = (nodes: { id: string; children?: any[] }[]) => {
    for (const n of nodes) {
      const occ = perSection.get(n.id);
      if (occ) {
        order.push(...occ);
        perSection.delete(n.id);
      }
      walk(n.children ?? []);
    }
  };
  walk(toc);
  for (const occ of perSection.values()) order.push(...occ);
  return { needed: [...set], sizes, order };
}

function run(cmd: string, argv: string[]) {
  return new Promise<number>((resolve) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => resolve(c ?? 1));
  });
}

async function main() {
  const catalog: { spec: string; release: string }[] = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'catalog.json'), 'utf8'));
  const jobs: { spec: string; urls: string[]; needed: string[]; sizes: Record<string, Dims>; order: [string, number, number][] }[] = [];
  for (const c of catalog) {
    if (only && !only.includes(c.spec)) continue;
    const done = path.join(OUT, c.spec, '.done');
    if (fs.existsSync(done)) {
      // --retry: run again only where figures are still missing
      if (!retry) continue;
      try {
        if (JSON.parse(fs.readFileSync(done, 'utf8')).ok) continue;
      } catch {}
    }
    const metaFile = path.join(DATA, 'raw', 'specs', `${c.spec}.json`);
    if (!fs.existsSync(metaFile)) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const { needed, sizes, order } = figuresOf(c.spec, meta.toc ?? []);
    if (!needed.length) continue;
    // newest version first; on --retry also the two before it (itecspec may show an older drawing)
    let urls = pickUrls(c.release, meta.versions ?? [], retry ? 3 : 1);
    // no link in the metadata: look in the spec's folder of the official archive
    if (!urls.length) urls = await archiveUrls(c.spec, c.release, DATA, retry ? 3 : 1);
    const url = urls[0];
    if (!url) {
      fs.mkdirSync(path.dirname(done), { recursive: true });
      fs.writeFileSync(done, JSON.stringify({ ok: false, reason: 'no download url' }));
      continue;
    }
    jobs.push({ spec: c.spec, urls, needed, sizes, order });
  }
  console.log(`[figures] ${jobs.length} specs to process, ${jobs.reduce((a, j) => a + j.needed.length, 0)} figures`);
  const batches: (typeof jobs)[] = [];
  for (let i = 0; i < jobs.length; i += batchSize) batches.push(jobs.slice(i, i + batchSize));
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, batches.length) }, async (_, w) => {
      while (next < batches.length) {
        const b = batches[next++];
        const jf = path.join(JOBS, `job-${w}.json`);
        fs.writeFileSync(jf, JSON.stringify(b));
        await run('docker', [
          'run', '--rm',
          '-v', `${OUT}:/out`,
          '-v', `${path.join(here, 'figures')}:/app:ro`,
          '-v', `${JOBS}:/jobs:ro`,
          '-e', 'HOME=/tmp',
          IMAGE, 'python3', '/app/convert.py', `/jobs/job-${w}.json`, '/out',
        ]);
        done += b.length;
        console.log(`[figures] ${done}/${jobs.length} specs`);
      }
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
