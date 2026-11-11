/**
 * Convert the specs that are too large to crawl section by section from their official .docx.
 *
 *   node scraper/docx.ts [--min-sections 3000] [--only 36.523-1,38.533] [--parallel 2] [--force]
 *   node scraper/docx.ts --openapi        # specs whose crawled text carries OpenAPI definitions
 *   node scraper/docx.ts --archive        # archive-only specs (data/raw/catalog-archive.json, see archive.ts)
 *   node scraper/docx.ts --fill [--first 23.700-83,…]
 *       every crawled spec once more from its .docx, cut along itecspec's TOC ids, into
 *       data/raw/sections-docx/ - build-db takes a section from there when itecspec's rendering lost
 *       text (nested tables inside table cells are dropped by itecspec, for instance)
 *   node scraper/docx.ts --redo
 *       converted specs whose last conversion had a part pandoc could not read, or produced at most 3
 *       sections (GSM-era documents without heading styles, before split.lua learnt to find their headings)
 *   node scraper/docx.ts --latest
 *       crawled specs whose archive folder has a newer document than the text we hold (itecspec lags the
 *       archive by up to a few quarters; data/raw/archive-latest.json from `archive.ts --latest`): that
 *       newest document, in heading-discovery mode; meta.contentVersion records which version it is
 *   node scraper/docx.ts --attachments
 *       the files each spec's zip carries beside the document (test suites, codec sources, schemas) into
 *       data/raw/attachments/<spec>.ndjson.gz, from the zip the spec's text comes from (docx/attachments.py).
 *       Every conversion records them too; this mode covers specs converted before that, and crawled ones
 *
 * Huge and archive-only specs are converted in heading-discovery mode: the document's own headings
 * become the table of contents (itecspec's TOC of the huge test specs repeats ids such as
 * "initial-conditions", so those entries could never get text).
 *
 * itecspec flattens code paragraphs (indentation and "- " list markers of the OpenAPI YAML in the
 * 29.5xx annexes are lost; ASN.1 tabs become spacer spans), so --openapi rebuilds the specs carrying
 * OpenAPI or ASN.1 from the official .docx, keeping the crawled file in data/raw/sections-crawled/.
 *
 * Picks every spec whose TOC has more than --min-sections entries and that has no crawled
 * sections file yet (or all of --only), then runs scraper/docx/convert_docx.py in the
 * converter container (docker build -t spec-explorer-converter:1 docker/converter).
 * Output lands in data/raw/sections/<spec>.ndjson.gz, figures in data/images/<spec>/images/.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickUrl, archiveUrls } from './versions.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const IMAGE = process.env.CONVERTER_IMAGE || 'spec-explorer-converter:1';
/** current LibreOffice for Word 6/95/97 parts (docker/legacy); "" disables the step */
const LEGACY_IMAGE = process.env.LEGACY_IMAGE ?? 'spec-explorer-legacy:1';
const minSections = Number(opt('min-sections') ?? 3000);
const parallel = Number(opt('parallel') ?? 2);
const only = opt('only')?.split(',');
const force = args.includes('--force');
const openapi = args.includes('--openapi');
const archive = args.includes('--archive');
const fill = args.includes('--fill');
const latest = args.includes('--latest');
const redo = args.includes('--redo');
const attach = args.includes('--attachments');
/** specs --redo converts again whatever their last result (one per line; an entry goes once its conversion succeeds) */
const REDO_LIST = path.join(DATA, 'redo.txt');
const redoList = new Set(
  (fs.existsSync(REDO_LIST) ? fs.readFileSync(REDO_LIST, 'utf8') : '').split('\n').map((l) => l.trim()).filter(Boolean),
);

/** sections in a converted file (0 when missing or empty) */
function lineCount(file: string): number {
  try {
    return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
const vkey = (v: string) => v.split('.').map((x) => x.padStart(4, '0')).join('.');
const first = opt('first')?.split(',') ?? [];

/**
 * does a sections file carry code listings whose exact layout matters - OpenAPI YAML or ASN.1 modules
 * (38.331 RRC, 38.413 NGAP, 38.473 F1AP, 37.355 LPP, …)? itecspec renders ASN.1 as paragraphs with
 * spacer spans for the tabs, so a copied module is not valid ASN.1 any more
 */
function hasOpenApi(file: string): boolean {
  try {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
    if (text.includes('openapi: 3')) return true;
    const asn1 = text.match(/DEFINITIONS (?:AUTOMATIC|IMPLICIT|EXPLICIT) TAGS|::= *(?:SEQUENCE|CHOICE|ENUMERATED|INTEGER)/g);
    return (asn1?.length ?? 0) >= 5;
  } catch {
    return false;
  }
}

/** TOC entries whose id already occurred earlier in the TOC */
function duplicateIds(toc: { id: string; children?: any[] }[]): number {
  const seen = new Set<string>();
  let d = 0;
  const walk = (ns: { id: string; children?: any[] }[]) => {
    for (const n of ns) {
      if (seen.has(n.id)) d++;
      seen.add(n.id);
      walk(n.children ?? []);
    }
  };
  walk(toc);
  return d;
}

/** must match VERSION in docx/convert_docx.py */
const VERSION = 6;
/** outputs older than this are converted again: v6 changed only heading discovery, v5 the code blocks */
const MIN_VERSION = openapi ? 5 : VERSION;

/** version stamped on a previous conversion (crawled files count as current) */
function converterVersion(file: string): number {
  try {
    const buf = zlib.gunzipSync(fs.readFileSync(file));
    const nl = buf.indexOf(10);
    const o = JSON.parse(buf.toString('utf8', 0, nl < 0 ? buf.length : nl));
    return o.src === 'docx' ? Number(o.v ?? 1) : Infinity;
  } catch {
    return 0;
  }
}

/** download the zip into the cache and turn legacy .doc/.rtf parts into .docx (scraper/docx/legacy.py) */
function prepare(url: string, log: number) {
  return new Promise<number>((resolve) => {
    if (!LEGACY_IMAGE) return resolve(0);
    const p = spawn('docker', ['run', '--rm', '-v', `${here}:/app:ro`, '-v', `${DATA}:/data`, '-e', 'HOME=/tmp', LEGACY_IMAGE, 'python3', '/app/docx/legacy.py', url, '/data/tmp/docx'], {
      stdio: ['ignore', log, log],
    });
    p.on('close', (c) => resolve(c ?? 1));
  });
}

/** zip url a recorded attachments file was taken from ("" when there is none) */
function attachmentsSrc(file: string): string {
  try {
    const buf = zlib.gunzipSync(fs.readFileSync(file));
    const nl = buf.indexOf(10);
    return JSON.parse(buf.toString('utf8', 0, nl < 0 ? buf.length : nl)).src ?? '';
  } catch {
    return '';
  }
}

/** the files beside the document only (scraper/docx/attachments.py), log in <spec>.attach.log */
function runAttachments(spec: string, url: string) {
  const log = fs.openSync(path.join(DATA, 'tmp', 'docx', `${spec}.attach.log`), 'w');
  return new Promise<number>((resolve) => {
    const p = spawn('docker', ['run', '--rm', '-v', `${here}:/app:ro`, '-v', `${DATA}:/data`, '-e', 'HOME=/tmp', IMAGE, 'python3', '/app/docx/attachments.py', spec, url, '/data'], {
      stdio: ['ignore', log, log],
    });
    p.on('close', (c) => {
      fs.closeSync(log);
      resolve(c ?? 1);
    });
  });
}

async function run(spec: string, url: string, discover: boolean) {
  const extra = [...(discover ? ['--discover'] : []), ...(fill ? ['--fill'] : [])];
  const logFile = path.join(DATA, 'tmp', 'docx', `${spec}.log`);
  const log = fs.openSync(logFile, 'w');
  await prepare(url, log);
  return new Promise<number>((resolve) => {
    const p = spawn(
      'docker',
      ['run', '--rm', '-v', `${here}:/app:ro`, '-v', `${DATA}:/data`, '-e', 'HOME=/tmp', IMAGE, 'python3', '/app/docx/convert_docx.py', spec, url, '/data', ...extra],
      { stdio: ['ignore', log, log] },
    );
    p.on('close', (c) => {
      fs.closeSync(log);
      resolve(c ?? 1);
    });
  });
}

async function main() {
  fs.mkdirSync(path.join(DATA, 'tmp', 'docx'), { recursive: true });
  const read = (f: string) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
  const crawled: { spec: string; release: string }[] = read(path.join(DATA, 'raw', 'catalog.json'));
  const archived: { spec: string; release: string }[] = read(path.join(DATA, 'raw', 'catalog-archive.json'));
  const catalog = archive ? archived : only || redo || attach ? [...crawled, ...archived] : crawled;
  const newest: Record<string, { content: { version: string; url: string } | null }> = latest
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'archive-latest.json'), 'utf8'))
    : {};
  const jobs: { spec: string; url: string; sections: number; discover: boolean; version?: string; attach?: boolean }[] = [];
  for (const c of catalog) {
    if (only ? !only.includes(c.spec) : false) continue;
    const metaFile = path.join(DATA, 'raw', 'specs', `${c.spec}.json`);
    if (!fs.existsSync(metaFile)) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const out = path.join(DATA, 'raw', 'sections', `${c.spec}.ndjson.gz`);
    const current = fs.existsSync(out) && !force && converterVersion(out) >= MIN_VERSION;
    let discover = meta.source === 'archive' || meta.tocSource === 'docx' || !meta.toc?.length;
    if (attach) {
      // the zip the text comes from: the converted version, or the one the fill step read for a crawled spec
      const url = meta.contentUrl ?? pickUrl(c.release, meta.versions ?? []) ?? (await archiveUrls(c.spec, c.release, DATA, 1))[0];
      if (!url) continue;
      // a crawled spec the fill step has not reached yet: that conversion records them
      if (!only && converterVersion(out) === Infinity && !fs.existsSync(path.join(DATA, 'raw', 'sections-docx', `${c.spec}.ndjson.gz`))) continue;
      if (!force && attachmentsSrc(path.join(DATA, 'raw', 'attachments', `${c.spec}.ndjson.gz`)) === url) continue;
      jobs.push({ spec: c.spec, url, sections: meta.sectionCount, discover: false, attach: true });
      continue;
    }
    if (redo) {
      const logFile = path.join(DATA, 'tmp', 'docx', `${c.spec}.log`);
      // the crawled text (or a fill run, whose output lives elsewhere) is not this mode's business
      if (!redoList.has(c.spec)) {
        if (!fs.existsSync(logFile) || converterVersion(out) === Infinity) continue;
        const last = fs.readFileSync(logFile, 'utf8');
        if (!/pandoc failed/.test(last) && lineCount(out) > 3) continue;
      }
      discover ||= (meta.sectionCount ?? 0) > minSections || duplicateIds(meta.toc ?? []) > 0;
    } else if (latest) {
      const e = newest[c.spec]?.content;
      const have: string | undefined = meta.contentVersion ?? (meta.versions ?? []).map((v: any) => v.version).sort((a: string, b: string) => vkey(b).localeCompare(vkey(a)))[0];
      if (!e || (have && vkey(e.version) <= vkey(have) && !force)) continue;
      jobs.push({ spec: c.spec, url: e.url, sections: meta.sectionCount, discover: true, version: e.version });
      continue;
    } else if (fill) {
      // only crawled specs; the docx-sourced ones already are the document
      if (converterVersion(out) !== Infinity) continue;
      const done = path.join(DATA, 'raw', 'sections-docx', `${c.spec}.ndjson.gz`);
      if (fs.existsSync(done) && !force && converterVersion(done) >= VERSION) continue;
      discover = false;
    } else if (openapi) {
      if (!fs.existsSync(out) || (current && converterVersion(out) !== Infinity)) continue;
      if (!hasOpenApi(out)) continue;
    } else if (archive) {
      if (current) continue;
    } else {
      const huge = (meta.sectionCount ?? 0) > minSections;
      // itecspec addresses sections by id: when its TOC repeats an id ("initial-conditions", "a" in both the
      // definitions and the abbreviations of 21.905) only the first one can be fetched
      const dups = duplicateIds(meta.toc ?? []);
      if (!only && !huge && !dups && meta.tocSource !== 'docx') continue;
      // a crawled file never counts as current for a spec that needs the document
      const v = fs.existsSync(out) ? converterVersion(out) : 0;
      if (!force && v !== Infinity && v >= MIN_VERSION) continue;
      if (only && v === Infinity && !force && !huge && !dups) continue;
      discover ||= huge || dups > 0;
    }
    // itecspec lists no versions for ~110 specs: take the newest zip in the spec's archive folder
    const url = meta.contentUrl ?? pickUrl(c.release, meta.versions ?? []) ?? (await archiveUrls(c.spec, c.release, DATA, 1))[0];
    if (!url) {
      console.log(`[docx] ${c.spec}: no download url`);
      continue;
    }
    jobs.push({ spec: c.spec, url, sections: meta.sectionCount, discover });
  }
  if (first.length) jobs.sort((a, b) => Number(first.includes(b.spec)) - Number(first.includes(a.spec)));
  console.log(`[docx] ${jobs.length} specs: ${jobs.slice(0, 40).map((j) => `${j.spec} (${j.sections ?? '?'})`).join(', ')}${jobs.length > 40 ? ' …' : ''}`);
  if (args.includes('--dry')) return;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const t0 = Date.now();
        const out = path.join(DATA, 'raw', 'sections', `${j.spec}.ndjson.gz`);
        if (!fill && !j.attach && fs.existsSync(out) && converterVersion(out) === Infinity) {
          // keep the crawled version
          const keep = path.join(DATA, 'raw', 'sections-crawled');
          fs.mkdirSync(keep, { recursive: true });
          fs.copyFileSync(out, path.join(keep, `${j.spec}.ndjson.gz`));
        }
        console.log(`[docx] ${j.spec} started`);
        const code = j.attach ? await runAttachments(j.spec, j.url) : await run(j.spec, j.url, j.discover);
        if (code === 0 && j.version) {
          // the text is now that of the newest document: record which one (read again - the converter rewrote the TOC)
          const metaFile = path.join(DATA, 'raw', 'specs', `${j.spec}.json`);
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          meta.contentVersion = j.version;
          meta.contentUrl = j.url;
          fs.writeFileSync(metaFile + '.part', JSON.stringify(meta));
          fs.renameSync(metaFile + '.part', metaFile);
        }
        if (code === 0 && redo && redoList.delete(j.spec)) {
          fs.writeFileSync(REDO_LIST, [...redoList].map((s) => `${s}\n`).join(''));
        }
        const tail = fs.readFileSync(path.join(DATA, 'tmp', 'docx', `${j.spec}${j.attach ? '.attach' : ''}.log`), 'utf8').trim().split('\n').pop();
        console.log(`[docx] ${j.spec} ${code === 0 ? 'done' : `FAILED (${code})`} in ${((Date.now() - t0) / 60000).toFixed(1)} min — ${tail}`);
      }
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
