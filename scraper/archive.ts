/**
 * Specs that exist in the official 3GPP archive but not on itecspec (withdrawn specs, GSM phase 1/2
 * specs of series 01–12, old UMTS "xx.yyU" documents, …).
 *
 *   node scraper/archive.ts [--refresh] [--only 04.08,23.039] [--parallel 4]
 *
 * Lists https://www.3gpp.org/ftp/Specs/archive/<series>/ for every series, takes each spec folder
 * that is missing from data/raw/catalog.json (plus the numbers of Specs/latest-drafts/ and those the portal's
 * per-series reports list without any archive folder - data/raw/portal-index.json), reads its versions
 * (zip name, date, size) and the 3GPP portal record (title, TS/TR, status, responsible group), and writes
 *   data/raw/catalog-archive.json   – catalog entries (merged by build-db / docx / figures)
 *   data/raw/specs/<spec>.json      – meta with an empty TOC: the docx converter discovers headings
 * The content itself comes from `node scraper/docx.ts --archive`.
 *
 *   node scraper/archive.ts --latest [--refresh] [--only 23.501] [--parallel 4]
 *
 * itecspec lags the archive (23.501: v20.1.0 there, v20.3.0 in the archive): lists the archive folder of
 * every crawled spec too and writes data/raw/archive-latest.json – {spec: {versions, content}} with all
 * published versions and the newest real document; `docx.ts --latest` converts the specs whose newest
 * document is newer than the crawled text, build-db merges the version lists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { labelReleases, releaseOfVersion } from '../shared/catalog.ts';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const RAW = path.join(DATA, 'raw');
const ARCHIVE = 'https://www.3gpp.org/ftp/Specs/archive/';
const PORTAL = 'https://www.3gpp.org/DynaReport/';
const UA = 'spec-explorer/1.0 (+archive mirror)';
const refresh = args.includes('--refresh');
/** look specs up again whose portal record had no title (the portal is flaky under load) */
const retitle = args.includes('--retitle');
const untitled = (m: any) => !m?.title || m.title === m.spec || /\((untitled|no document published)\)$/.test(m.title);
const only = opt('only')?.split(',');
const parallel = Number(opt('parallel') ?? 4);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, tries = 5): Promise<string | null> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (res.status === 404 || res.status === 403) return null;
      if (res.ok) return await res.text();
      if (i >= tries) throw new Error(`${res.status} ${url}`);
    } catch (e) {
      if (i >= tries) throw e;
    }
    await sleep(1000 * 2 ** i);
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const text = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "i00" -> [18,0,0]: version digits are base 36; 6-digit codes use two digits each */
export function decodeVersion(code: string): number[] {
  if (code.length === 6 && /^\d+$/.test(code)) return [code.slice(0, 2), code.slice(2, 4), code.slice(4)].map(Number);
  return [...code.toLowerCase()].map((c) => parseInt(c, 36));
}

export interface ArchiveZip {
  url: string;
  version: string;
  date: string;
  bytes: number;
}

const rowRe = /<a class="file" href="([^"]+\.zip)"[^>]*>[^<]*<\/a>[\s\S]*?(\d{4})\/(\d{2})\/(\d{2})[\s\S]*?([\d.,]+)\s*(bytes|KB|MB|GB)/gi;

/**
 * Specs/latest-drafts/: the newest draft of specs under development, sometimes newer than anything in
 * the spec's archive folder (36.276 v1.0.0) or for a number that has no folder yet - by spec number
 */
let draftIndex: Promise<Map<string, ArchiveZip[]>> | undefined;
function drafts(): Promise<Map<string, ArchiveZip[]>> {
  draftIndex ??= (async () => {
    const out = new Map<string, ArchiveZip[]>();
    const html = (await get('https://www.3gpp.org/ftp/Specs/latest-drafts/')) ?? '';
    for (const z of parseZips(html)) {
      const m = /\/(\d{2})(\d{3})((?:-\d+)*)-\w+\.zip$/i.exec(z.url);
      if (!m) continue;
      const spec = `${m[1]}.${m[2]}${m[3]}`;
      out.set(spec, [...(out.get(spec) ?? []), z]);
    }
    return out;
  })();
  return draftIndex;
}

/** zips of one spec folder (plus its newest draft from latest-drafts), newest version first */
async function listZips(spec: string): Promise<ArchiveZip[] | null> {
  const html = await get(`${ARCHIVE}${spec.slice(0, 2)}_series/${spec}/`);
  const extra = (await drafts()).get(spec) ?? [];
  if (html == null && !extra.length) return null;
  const out = parseZips(html ?? '');
  for (const z of extra) if (!out.some((o) => o.version === z.version)) out.push(z);
  const key = (v: string) => v.split('.').map((x) => x.padStart(4, '0')).join('.');
  out.sort((a, b) => key(b.version).localeCompare(key(a.version)) || b.date.localeCompare(a.date));
  return out;
}

function parseZips(html: string): ArchiveZip[] {
  const out: ArchiveZip[] = [];
  for (const m of html.matchAll(rowRe)) {
    const code = /-(\w+)\.zip$/i.exec(m[1])?.[1] ?? '';
    const v = decodeVersion(code);
    // companion files such as 0309-SDL.zip (SDL models) are not versions; no release beyond 22 exists yet
    if (v.length !== 3 || !v.every(Number.isFinite) || v[0] > 22) continue;
    const unit = { bytes: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[6].toLowerCase()]!;
    out.push({
      url: m[1],
      version: v.join('.'),
      date: `${m[2]}-${m[3]}-${m[4]}`,
      bytes: Math.round(Number(m[5].replace(/\./g, '').replace(',', '.')) * unit),
    });
  }
  return out;
}

const GSM_PHASE = (spec: string) => Number(spec.slice(0, 2)) <= 12;

/**
 * the version whose text is shown: the newest one, unless it is a stub ("withdrawn",
 * "transferred to TS …") much smaller than the real document
 */
function pickContent(zips: ArchiveZip[]): ArchiveZip | undefined {
  const max = Math.max(...zips.map((z) => z.bytes));
  return zips.find((z) => z.bytes >= Math.min(max * 0.08, 40_000)) ?? zips[0];
}

interface Portal {
  title?: string;
  type?: string;
  status?: string;
  group?: string;
  release?: string;
}

async function portal(spec: string): Promise<Portal> {
  const html = await get(`${PORTAL}${spec.replace('.', '')}.htm`, 3).catch(() => null);
  if (!html) return {};
  const val = (id: string) => {
    const m = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:span|a|td|div)>`).exec(html);
    return m ? text(m[1]) || undefined : undefined;
  };
  const grp = /PrimaryResponsibleGroupLbl[\s\S]*?<\/span>([\s\S]*?)Secondary responsible/.exec(html);
  const typ = val('typeVal');
  return {
    title: val('titleVal'),
    type: typ ? (/report/i.test(typ) ? 'TR' : 'TS') : undefined,
    status: val('statusVal'),
    group: grp ? text(grp[1]).split(' ').slice(0, 2).join(' ') || undefined : undefined,
    release: val('initialPlannedReleaseVal'),
  };
}

const TSG: [RegExp, string][] = [
  [/^(SP|S\s?\d|SA)/i, 'Services and System Aspects'],
  [/^(CP|CT|C\s?\d|NP|N\s?\d|TP|T\s?\d)/i, 'Core Network and Terminals'],
  [/^(RP|RAN|R\s?\d)/i, 'Radio Access Network'],
  [/^(GP|GERAN|G\s?\d)/i, 'GSM EDGE Radio Access Network'],
];

const sizeLabel = (bytes: number) => (bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
/** versions newest first, labelled with their release (drafts: `fallback` unless the spec was approved later) */
const versionList = (spec: string, zips: ArchiveZip[], fallback?: string) =>
  labelReleases(
    spec,
    zips.map((z) => ({ release: '', version: z.version, date: z.date, size: sizeLabel(z.bytes), url: z.url })),
    fallback,
  );

/** --latest: every published version of the crawled specs */
async function latest(catalog: { spec: string; release: string }[]) {
  const releaseOfSpec = new Map(catalog.map((c) => [c.spec, c.release]));
  const outFile = path.join(RAW, 'archive-latest.json');
  const entries: Record<string, any> = !refresh && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  // specs with a draft in latest-drafts are listed again: the draft may be newer than what was recorded
  const withDraft = await drafts();
  const todo = catalog.map((c) => c.spec).filter((s) => (only ? only.includes(s) : !entries[s] || withDraft.has(s)));
  console.log(`[archive] latest versions of ${todo.length} crawled specs (${Object.keys(entries).length} known)`);
  let next = 0;
  let done = 0;
  const save = () => {
    fs.writeFileSync(outFile + '.part', JSON.stringify(entries));
    fs.renameSync(outFile + '.part', outFile);
  };
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < todo.length) {
        const spec = todo[next++];
        const zips = await listZips(spec).catch((e) => (console.log(`\n[archive] ${spec}: ${e.message}`), undefined));
        if (zips === undefined) continue; // retried on the next run
        const pick = zips?.length ? pickContent(zips) : undefined;
        entries[spec] = { versions: versionList(spec, zips ?? [], releaseOfSpec.get(spec)), content: pick ? { version: pick.version, url: pick.url, date: pick.date } : null };
        if (++done % 50 === 0) {
          save();
          process.stdout.write(`\r[archive] ${done}/${todo.length}`);
        }
      }
    }),
  );
  save();
  const cmp = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  let newer = 0;
  for (const c of catalog) {
    const m = JSON.parse(fs.readFileSync(path.join(RAW, 'specs', `${c.spec}.json`), 'utf8'));
    const have = m.contentVersion ?? m.versions?.[0]?.version;
    const e = entries[c.spec]?.content;
    if (e && (!have || cmp(e.version, have) > 0)) newer++;
  }
  console.log(`\n[archive] ${Object.keys(entries).length} specs listed, ${newer} with a newer document than the crawled text`);
}

async function main() {
  const catalog: { spec: string; release: string }[] = JSON.parse(fs.readFileSync(path.join(RAW, 'catalog.json'), 'utf8'));
  const crawled = new Set(catalog.map((c) => c.spec));
  if (args.includes('--latest')) return latest(catalog);

  // 1. folder index of the whole archive
  const indexFile = path.join(RAW, 'archive-index.json');
  let folders: string[];
  if (!refresh && fs.existsSync(indexFile)) folders = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  else {
    const root = (await get(ARCHIVE))!;
    const series = [...new Set([...root.matchAll(/archive\/(\d{2}_series)\/?"/g)].map((m) => m[1]))].sort();
    folders = [];
    for (const s of series) {
      const html = (await get(ARCHIVE + s + '/')) ?? '';
      for (const m of html.matchAll(new RegExp(`archive/${s}/([^/"]+)/?"`, 'g'))) if (/^\d{2}\.\w/.test(m[1])) folders.push(decodeURIComponent(m[1]));
      process.stdout.write(`\r[archive] ${s}: ${folders.length} folders`);
    }
    folders = [...new Set(folders)].sort();
    fs.writeFileSync(indexFile, JSON.stringify(folders));
    console.log();
  }
  const inArchive = folders.length;
  // a draft whose number has no archive folder yet is a spec too
  for (const spec of (await drafts()).keys()) if (!folders.includes(spec)) folders.push(spec);
  // and so is a number the portal registered that never got a folder (allocated, then withdrawn before any
  // document was uploaded - 36.571-3, 23.700-16, ...): listed like the empty folders, with the portal's title and status
  const portalFile = path.join(RAW, 'portal-index.json');
  let registered: string[];
  if (!refresh && fs.existsSync(portalFile)) registered = JSON.parse(fs.readFileSync(portalFile, 'utf8'));
  else {
    registered = [];
    for (const s of [...new Set(folders.map((f) => f.slice(0, 2)))].sort()) {
      const html = (await get(`https://www.3gpp.org/dynareport?code=${s}-series.htm`)) ?? '';
      for (const m of html.matchAll(/href="\/dynareport\/(\d{4}[^"/]*)\.htm"/gi)) registered.push(`${m[1].slice(0, 2)}.${m[1].slice(2)}`);
      process.stdout.write(`\r[archive] portal ${s}-series: ${registered.length} numbers`);
    }
    registered = [...new Set(registered)].sort();
    fs.writeFileSync(portalFile, JSON.stringify(registered));
    console.log();
  }
  const known = new Set([...folders, ...crawled].map((f) => f.toLowerCase()));
  const portalOnly = registered.filter((s) => !known.has(s.toLowerCase()));
  folders.push(...portalOnly);
  const todo = folders.filter((f) => !crawled.has(f) && (!only || only.includes(f)));
  console.log(
    `[archive] ${inArchive} spec folders in the archive, ${portalOnly.length} more numbers in the portal only, ${crawled.size} on itecspec, ${todo.length} archive-only`,
  );

  // 2. versions + portal metadata per archive-only spec
  const outFile = path.join(RAW, 'catalog-archive.json');
  const prev: any[] = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
  const entries = new Map<string, any>(prev.map((e) => [e.spec, e]));
  let next = 0;
  let done = 0;
  const empty: string[] = [];
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < todo.length) {
        const spec = todo[next++];
        const metaFile = path.join(RAW, 'specs', `${spec}.json`);
        const old = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
        if (old?.source === 'archive' && !refresh && entries.has(spec) && !(retitle && untitled(old))) {
          done++;
          continue;
        }
        const [zips, p] = await Promise.all([listZips(spec), portal(spec)]);
        // an empty folder: the number was allocated but no document was ever uploaded - still listed
        if (!zips?.length) empty.push(spec);
        const pick = zips?.length ? pickContent(zips)! : undefined;
        const portalRel = /release\s*(\d+)/i.exec(p.release ?? '')?.[1];
        const planned = portalRel ? (Number(portalRel) >= 96 ? `R${portalRel.slice(-2)}` : `rel-${portalRel}`) : undefined;
        const versions = versionList(spec, zips ?? [], planned);
        const release = pick
          ? (versions.find((v) => v.version === pick.version)?.release ?? releaseOfVersion(spec, pick.version, planned)).replace(/^Rel-/, 'rel-')
          : planned ?? (GSM_PHASE(spec) ? 'Ph2' : 'R99');
        const tsg = p.group ? TSG.find(([re]) => re.test(p.group!))?.[1] : undefined;
        const short = p.title || (pick ? `${spec} (untitled)` : `${spec} (no document published)`);
        const title = tsg ? `3rd Generation Partnership Project; Technical Specification Group ${tsg}; ${short}` : short;
        const type = p.type ?? (/^\d{2}\.(8|9)\d/.test(spec) ? 'TR' : 'TS');
        const meta = {
          ...(old?.source === 'archive' ? old : {}),
          spec,
          title,
          type,
          release,
          source: 'archive',
          status: p.status ?? null,
          group: p.group ?? null,
          contentVersion: pick?.version ?? null,
          contentUrl: pick?.url ?? null,
          noDocument: !pick,
          plannedRelease: planned ?? null,
          versions,
          toc: old?.source === 'archive' ? (old.toc ?? []) : [],
        };
        fs.writeFileSync(metaFile, JSON.stringify(meta));
        entries.set(spec, { spec, title, type, release, source: 'archive', status: meta.status });
        done++;
        if (done % 25 === 0) process.stdout.write(`\r[archive] ${done}/${todo.length}`);
      }
    }),
  );
  const list = [...entries.values()].filter((e) => !crawled.has(e.spec)).sort((a, b) => a.spec.localeCompare(b.spec, 'en', { numeric: true }));
  fs.writeFileSync(outFile, JSON.stringify(list, null, 0));
  const byStatus: Record<string, number> = {};
  for (const e of list) byStatus[e.status ?? 'unknown'] = (byStatus[e.status ?? 'unknown'] ?? 0) + 1;
  console.log(`\n[archive] ${list.length} archive-only specs written to ${path.relative(process.cwd(), outFile)}`, byStatus);
  if (empty.length) console.log(`[archive] ${empty.length} empty folders (listed without a document): ${empty.join(' ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
