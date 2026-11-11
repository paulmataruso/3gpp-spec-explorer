/**
 * Resumable crawler for itecspec.com/3gpp.
 *
 *   node scraper/crawl.ts catalog            # spec list (1 request)
 *   node scraper/crawl.ts specs              # TOC + version archive per spec
 *   node scraper/crawl.ts sections           # every section's content
 *   node scraper/crawl.ts all                # all of the above
 *
 * Options: --only 38.331,38.300   --limit 50   --concurrency 6
 * Env:     DATA_DIR (default ./data)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { HttpClient, getRsc, routerTree } from './http.ts';
import { FlightPayload } from './rsc.ts';
import { extractCatalog, extractToc, extractArchive, extractSection } from './extract.ts';
import type { CatalogEntry, TocNode, ArchiveVersion } from './extract.ts';

const args = process.argv.slice(2);
const phase = args.find((a) => !a.startsWith('--')) ?? 'all';
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('only')?.split(',').map((s) => s.trim());
const limit = opt('limit') ? Number(opt('limit')) : Infinity;
const specParallel = Number(opt('spec-parallel') ?? 4);
const maxSections = opt('max-sections') ? Number(opt('max-sections')) : Infinity;
const minSections = opt('min-sections') ? Number(opt('min-sections')) : 0;

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const RAW = path.join(DATA, 'raw');
const SPECS_DIR = path.join(RAW, 'specs');
const SECT_DIR = path.join(RAW, 'sections');
fs.mkdirSync(SPECS_DIR, { recursive: true });
fs.mkdirSync(SECT_DIR, { recursive: true });

const http = new HttpClient(opt('concurrency') ? Number(opt('concurrency')) : undefined);
const logFile = fs.createWriteStream(path.join(DATA, 'crawl.log'), { flags: 'a' });
function log(...a: unknown[]) {
  const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}`;
  console.log(line);
  logFile.write(line + '\n');
}

export interface SpecMeta extends CatalogEntry {
  toc: TocNode[];
  versions: ArchiveVersion[];
  sectionCount: number;
  crawledAt: string;
}

/* ---------- ordering: most-used series first ---------- */
const SERIES_PRIORITY = ['38', '23', '24', '29', '36', '33', '37', '22', '21', '26', '28', '32', '31', '27', '34', '35', '25', '45', '43', '44', '48', '51', '52', '55', '49', '46', '41', '42', '01'];
function specOrder(a: CatalogEntry, b: CatalogEntry) {
  const pa = SERIES_PRIORITY.indexOf(a.spec.slice(0, 2));
  const pb = SERIES_PRIORITY.indexOf(b.spec.slice(0, 2));
  const ra = pa < 0 ? 99 : pa;
  const rb = pb < 0 ? 99 : pb;
  return ra - rb || a.spec.localeCompare(b.spec, 'en', { numeric: true });
}

/* ---------- phases ---------- */

async function crawlCatalog(): Promise<CatalogEntry[]> {
  const file = path.join(RAW, 'catalog.json');
  if (fs.existsSync(file) && phase !== 'catalog') return JSON.parse(fs.readFileSync(file, 'utf8'));
  const buf = await http.get(`/3gpp?_rsc=init${Date.now() % 1000}`, { RSC: '1' });
  if (!buf) throw new Error('catalog fetch 404');
  const catalog = extractCatalog(new FlightPayload(buf)).map((c) => ({ ...c, title: c.title.replace(/\s+/g, ' ').trim() }));
  fs.writeFileSync(file, JSON.stringify(catalog, null, 1));
  log(`catalog: ${catalog.length} specs`);
  return catalog;
}

function selected(catalog: CatalogEntry[]) {
  let list = [...catalog].sort(specOrder);
  if (only) list = list.filter((c) => only.includes(c.spec));
  return list.slice(0, limit);
}

function countToc(nodes: TocNode[]): number {
  return nodes.reduce((a, n) => a + 1 + countToc(n.children), 0);
}

async function crawlSpec(c: CatalogEntry): Promise<SpecMeta | null> {
  const file = path.join(SPECS_DIR, `${c.spec}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  // pretend we navigate from a sibling spec so only the page segment is streamed
  const tree = routerTree(c.release, '00.000');
  const [page, archive] = await Promise.all([
    getRsc(http, `/3gpp/${c.release}/${c.spec}`, tree, `/3gpp/${c.release}/00.000`),
    getRsc(http, `/3gpp/archive/${c.spec}`, tree, `/3gpp/${c.release}/00.000`).catch(() => null),
  ]);
  if (!page) {
    log(`spec ${c.spec}: 404`);
    return null;
  }
  const toc = extractToc(new FlightPayload(page), c.release, c.spec);
  const versions = archive ? extractArchive(new FlightPayload(archive)) : [];
  const meta: SpecMeta = { ...c, toc, versions, sectionCount: countToc(toc), crawledAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(meta));
  return meta;
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    }),
  );
}

let totalSectionsFetched = 0;
let specsDone = 0;

function flatten(nodes: TocNode[], out: TocNode[] = []): TocNode[] {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

async function crawlSections(meta: SpecMeta) {
  const gz = path.join(SECT_DIR, `${meta.spec}.ndjson.gz`);
  if (fs.existsSync(gz)) return;
  const nd = path.join(SECT_DIR, `${meta.spec}.ndjson`);
  const done = new Set<string>();
  if (fs.existsSync(nd)) {
    for (const line of fs.readFileSync(nd, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const o = JSON.parse(line);
        if (!o.error) done.add(o.id);
      } catch {
        /* truncated line from a crash */
      }
    }
    // rewrite without error / partial lines
    const good = fs
      .readFileSync(nd, 'utf8')
      .split('\n')
      .filter((l) => {
        try {
          return l && !JSON.parse(l).error;
        } catch {
          return false;
        }
      });
    fs.writeFileSync(nd, good.length ? good.join('\n') + '\n' : '');
  }
  const seen = new Set<string>();
  const todo = flatten(meta.toc).filter((n) => {
    if (n.id === 'contents' || done.has(n.id) || seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const out = fs.createWriteStream(nd, { flags: 'a' });
  let errors = 0;
  const tree = routerTree(meta.release, meta.spec, '__nav__');
  const fromUrl = `/3gpp/${meta.release}/${meta.spec}/s/__nav__`;
  await Promise.all(
    todo.map(async (n) => {
      const t0 = Date.now();
      try {
        const buf = await getRsc(http, `/3gpp/${meta.release}/${meta.spec}/s/${encodeURIComponent(n.id)}`, tree, fromUrl);
        if (!buf) {
          out.write(JSON.stringify({ id: n.id, missing: true }) + '\n');
          return;
        }
        const sec = extractSection(new FlightPayload(buf));
        if (!sec) {
          out.write(JSON.stringify({ id: n.id, missing: true, reason: 'no-main' }) + '\n');
          return;
        }
        out.write(
          JSON.stringify({ id: n.id, n: n.number, t: n.title, h: sec.heading, c: sec.content, f: sec.figures.length ? sec.figures : undefined, k: sec.components.length ? sec.components : undefined, ms: Date.now() - t0 }) + '\n',
        );
        totalSectionsFetched++;
      } catch (e) {
        errors++;
        out.write(JSON.stringify({ id: n.id, error: String((e as Error).message) }) + '\n');
      }
    }),
  );
  await new Promise<void>((r) => out.end(r));
  if (errors === 0) {
    const data = fs.readFileSync(nd);
    fs.writeFileSync(gz + '.tmp', zlib.gzipSync(data, { level: 6 }));
    fs.renameSync(gz + '.tmp', gz);
    fs.unlinkSync(nd);
  } else log(`spec ${meta.spec}: ${errors} section errors — rerun to retry`);
}

/* ---------- progress ---------- */
const started = Date.now();
let phaseLabel = '';
let phaseTotal = 0;
let phaseSectionTotal = 0;
const ticker = setInterval(() => {
  const mins = (Date.now() - started) / 60000;
  log(
    `[${phaseLabel}] specs ${specsDone}/${phaseTotal} | sections ${totalSectionsFetched}${phaseSectionTotal ? '/' + phaseSectionTotal : ''} | req ok ${http.stats.ok} retry ${http.stats.retries} fail ${http.stats.failed} 404 ${http.stats.notFound} | ${(http.stats.bytes / 1e6).toFixed(0)} MB | ${(http.stats.ok / (mins * 60)).toFixed(1)} req/s`,
  );
}, 15_000);

async function main() {
  const catalog = await crawlCatalog();
  if (phase === 'catalog') return;
  const list = selected(catalog);

  if (phase === 'specs' || phase === 'all' || phase === 'sections') {
    phaseLabel = 'specs';
    phaseTotal = list.length;
    specsDone = 0;
    await pool(list, 8, async (c) => {
      try {
        await crawlSpec(c);
      } catch (e) {
        log(`spec ${c.spec} failed: ${(e as Error).message}`);
      }
      specsDone++;
    });
    const metas = list
      .map((c) => path.join(SPECS_DIR, `${c.spec}.json`))
      .filter((f) => fs.existsSync(f))
      .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')) as SpecMeta)
      .filter((m) => m.sectionCount <= maxSections && m.sectionCount >= minSections);
    const totalSections = metas.reduce((a, m) => a + m.sectionCount, 0);
    log(`specs phase done: ${metas.length} specs, ${totalSections} TOC entries`);
    if (phase === 'specs') return;

    phaseLabel = 'sections';
    phaseTotal = metas.length;
    phaseSectionTotal = totalSections;
    specsDone = 0;
    await pool(metas, specParallel, async (m) => {
      try {
        await crawlSections(m);
      } catch (e) {
        log(`sections ${m.spec} failed: ${(e as Error).message}`);
      }
      specsDone++;
    });
    log('sections phase done');
  }
}

main()
  .catch((e) => {
    log('FATAL', e?.stack || e);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(ticker);
    log(`finished in ${((Date.now() - started) / 60000).toFixed(1)} min`, JSON.stringify(http.stats));
  });
