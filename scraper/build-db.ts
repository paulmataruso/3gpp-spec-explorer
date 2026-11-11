/**
 * Build the SQLite database consumed by the server from the raw crawl output.
 *
 *   node scraper/build-db.ts                 # full rebuild -> data/3gpp.db
 *   DATA_DIR=/path node scraper/build-db.ts
 *
 * The DB is written to a temp file and atomically renamed, so a running server
 * picks up the new version without downtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { renderSection, finishDocxHtml, htmlToText, loadKatex } from '../shared/render.ts';
import type { CNode } from '../shared/render.ts';
import { fixPuaHtml } from '../shared/pua.ts';
import { seriesOf, relNum, splitTitle, labelReleases, byVersionDesc } from '../shared/catalog.ts';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const RAW = path.join(DATA, 'raw');
const OUT = path.resolve(process.env.DB_PATH || path.join(DATA, '3gpp.db'));
const TMP = OUT + '.building';

interface TocNode {
  id: string;
  number: string | null;
  title: string;
  children: TocNode[];
}
interface SpecMeta {
  spec: string;
  title: string;
  type: string;
  release: string;
  toc: TocNode[];
  versions: { release: string; version: string; date: string; size: string; url: string }[];
  sectionCount: number;
  /** archive-only specs: the version whose text was converted (the newest one may be a "withdrawn" stub) */
  contentVersion?: string;
  contentUrl?: string;
  plannedRelease?: string | null;
  source?: string;
  status?: string | null;
}

/** exact-match FTS token for a spec number: 36.523-1 -> s36_523_1 */
export const specToken = (spec: string) => 's' + spec.replace(/[^0-9a-z]+/gi, '_').toLowerCase();

const br = (s: string) =>
  zlib.brotliCompressSync(Buffer.from(s), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 7, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: s.length },
  });

/** files a spec's zip carries beside the document (scraper/docx/attachments.py) */
interface ZipFile {
  path: string;
  size: number;
  text?: string;
  in_text?: boolean;
  binary?: boolean;
  large?: boolean;
  note?: string;
  /** a Word file, spreadsheet or Visio drawing rendered for reading (scraper/docx/attachdocs.py) */
  doc?: string;
  kind?: 'word' | 'sheet' | 'drawing';
}
function readAttachments(spec: string): { src: string; items: ZipFile[] } | null {
  const f = path.join(RAW, 'attachments', `${spec}.ndjson.gz`);
  if (!fs.existsSync(f)) return null;
  try {
    const lines = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean);
    const head = JSON.parse(lines[0]);
    return { src: head.src ?? '', items: lines.slice(1).map((l) => JSON.parse(l)) };
  } catch {
    return null;
  }
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fileSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} B`);
/** highlighter the reader applies (web/src/views/reader.ts) */
function fileLang(p: string): string {
  const e = path.extname(p).toLowerCase();
  if (e === '.asn' || e === '.asn1') return 'asn1';
  if (e === '.yaml' || e === '.yml') return 'yaml';
  return e.slice(1);
}

/**
 * "Files in the TS zip": an annex after the document's own TOC. Text files the document does not carry get a
 * section each (grouped by folder when there are many); the annex lists every file, binary ones with a pointer
 * to the official zip
 */
function attachmentAnnex(spec: string, att: { src: string; items: ZipFile[] }, finish: (h: string) => { html: string; text: string }) {
  const ROOT = 'zip-files';
  /** index: documents are searched like the spec's own text (source files are found by their names only) */
  const sections = new Map<string, { html: string; text: string; index?: boolean }>();
  const used = new Set<string>([ROOT]);
  const slug = (s: string) => {
    const base = `${ROOT}--${s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  };
  const shown = att.items.filter((f) => typeof f.text === 'string' || typeof f.doc === 'string');
  const idOfFile = new Map<ZipFile, string>();
  const fileNode = (f: ZipFile): TocNode => {
    const id = slug(f.path);
    idOfFile.set(f, id);
    const lang = fileLang(f.path);
    if (typeof f.doc === 'string') {
      // Word documents went through split.lua like the specs; sheets and drawings are final html already,
      // apart from Symbol/Wingdings private-use characters (LibreOffice keeps U+F0xx from cells set in those fonts)
      const sheet = f.kind === 'word' ? '' : fixPuaHtml(f.doc);
      const r = f.kind === 'word' ? finish(f.doc) : { html: sheet, text: htmlToText(sheet) };
      const what = f.kind === 'sheet' ? 'Spreadsheet' : f.kind === 'drawing' ? 'Drawing' : 'Document';
      sections.set(id, {
        html: `<p class="zip-doc">${what} <code>${escHtml(f.path)}</code> from the specification's zip file.</p>${r.html}`,
        text: `${f.path}\n${r.text}`,
        index: true,
      });
      return { id, number: null, title: f.path, children: [] };
    }
    sections.set(id, {
      html: `<pre class="file" data-name="${escHtml(f.path.split('/').pop()!)}" data-lang="${escHtml(lang)}"><code>${escHtml(f.text!)}</code></pre>`,
      text: f.text!,
    });
    return { id, number: null, title: f.path, children: [] };
  };
  // many files (test suites with hundreds of modules): one level of folders
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const dirs = [...new Set(shown.map((f) => dirOf(f.path)))];
  let children: TocNode[];
  if (shown.length > 40 && dirs.length > 1) {
    children = dirs.map((d) => {
      const files = shown.filter((f) => dirOf(f.path) === d);
      const id = slug(d || 'top-level');
      const kids = files.map(fileNode);
      sections.set(id, {
        html: `<p>${files.length.toLocaleString('en')} file${files.length === 1 ? '' : 's'} in <code>${escHtml(d || '(top level)')}</code>.</p>`,
        text: `${files.length} files in ${d || '(top level)'}`,
      });
      return { id, number: null, title: `${d || '(top level)'}/`, children: kids };
    });
  } else {
    children = shown.map(fileNode);
  }
  const zipName = att.src.split('/').pop() ?? 'zip';
  const status = (f: ZipFile) =>
    f.text !== undefined || f.doc !== undefined
      ? `<a class="xref" data-spec="${escHtml(spec)}" data-sec="${escHtml(idOfFile.get(f)!)}">shown</a>`
      : f.in_text
        ? 'text is in the document'
        : f.note
          ? escHtml(f.note)
          : f.large
            ? 'too large to show - in the zip file'
            : 'binary - in the zip file';
  const rows = att.items.map((f) => `<tr><td><code>${escHtml(f.path)}</code></td><td class="rgt">${fileSize(f.size)}</td><td>${status(f)}</td></tr>`);
  sections.set(ROOT, {
    html:
      `<p>Besides the document, the specification's zip file <a href="${escHtml(att.src)}" target="_blank" rel="noopener noreferrer">${escHtml(zipName)}</a> ` +
      `carries ${att.items.length.toLocaleString('en')} file${att.items.length === 1 ? '' : 's'}` +
      (shown.length ? `; the ${shown.length.toLocaleString('en')} file${shown.length === 1 ? '' : 's'} the document does not contain (text files, Word documents, spreadsheets, drawings) ${shown.length === 1 ? 'follows' : 'follow'} as sections of this annex.` : '.') +
      `</p><div class="tbl"><table><thead><tr><th>File</th><th>Size</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
    text: `Files in the TS zip ${zipName} ` + att.items.map((f) => f.path).join(' '),
  });
  return { node: { id: ROOT, number: null, title: 'Files in the TS zip', children } as TocNode, sections };
}

function cleanTitle(t: string) {
  return t.replace(/\s+/g, ' ').trim();
}

async function* readSections(spec: string, dir = 'sections'): AsyncGenerator<any> {
  const gz = path.join(RAW, dir, `${spec}.ndjson.gz`);
  const nd = path.join(RAW, dir, `${spec}.ndjson`);
  let stream: NodeJS.ReadableStream | null = null;
  if (fs.existsSync(gz)) stream = fs.createReadStream(gz).pipe(zlib.createGunzip());
  else if (fs.existsSync(nd)) stream = fs.createReadStream(nd);
  if (!stream) return;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (!o.error && !o.missing) yield o;
    } catch {
      /* partial line */
    }
  }
}

const stripTags = (h: string) =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** "ABBR<tab>Expansion" rows of an abbreviations clause (rendered as p.def) */
function parseAbbrevs(html: string): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<p class="def"><span class="dt">([\s\S]*?)<\/span><span class="dd">([\s\S]*?)<\/span><\/p>/g)) {
    const abbr = stripTags(m[1]).replace(/:$/, '');
    const exp = stripTags(m[2]);
    if (!abbr || abbr.length > 24 || !exp || exp.length > 300 || !/[A-Za-z]/.test(abbr) || seen.has(abbr)) continue;
    seen.add(abbr);
    out.push([abbr, exp]);
  }
  return out;
}

async function main() {
  await loadKatex();
  const t0 = Date.now();
  const catalog: { spec: string; title: string; type: string; release: string; source?: string; status?: string | null }[] = JSON.parse(
    fs.readFileSync(path.join(RAW, 'catalog.json'), 'utf8'),
  );
  // specs only the official archive has (scraper/archive.ts)
  const archiveFile = path.join(RAW, 'catalog-archive.json');
  if (fs.existsSync(archiveFile)) {
    const have = new Set(catalog.map((c) => c.spec));
    for (const c of JSON.parse(fs.readFileSync(archiveFile, 'utf8'))) if (!have.has(c.spec)) catalog.push(c);
    catalog.sort((a, b) => a.spec.localeCompare(b.spec, 'en', { numeric: true }));
  }
  // ONLY=23.501,04.08 DB_PATH=/tmp/test.db: a small database for trying changes out
  if (process.env.ONLY) {
    const only = new Set(process.env.ONLY.split(','));
    catalog.splice(0, catalog.length, ...catalog.filter((c) => only.has(c.spec)));
  }
  const metas = new Map<string, SpecMeta>();
  for (const c of catalog) {
    const f = path.join(RAW, 'specs', `${c.spec}.json`);
    if (fs.existsSync(f)) metas.set(c.spec, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  // every published version of the crawled specs (archive.ts --latest): itecspec lists only some, and its
  // text may be older than the newest document (docx.ts --latest then sets contentVersion)
  const latestFile = path.join(RAW, 'archive-latest.json');
  const archiveVersions: Record<string, { versions: SpecMeta['versions'] }> = fs.existsSync(latestFile)
    ? JSON.parse(fs.readFileSync(latestFile, 'utf8'))
    : {};
  let mergedVersionLists = 0;
  let newerText = 0;
  for (const c of catalog) {
    const m = metas.get(c.spec);
    if (!m) continue;
    if (m.source !== 'archive') {
      const av = archiveVersions[c.spec]?.versions;
      // the crawled text is itecspec's newest version unless a newer document was converted
      m.contentVersion ??= [...(m.versions ?? [])].sort(byVersionDesc)[0]?.version;
      if (m.contentVersion && m.contentUrl) newerText++;
      if (av?.length) {
        const have = new Set(av.map((v) => v.version));
        m.versions = [...av, ...(m.versions ?? []).filter((v) => !have.has(v.version))].sort(byVersionDesc);
        mergedVersionLists++;
      }
    }
    // release labels from the version numbers (drafts 0.x–2.x: the release they were approved in)
    if (m.versions?.length) m.versions = labelReleases(c.spec, m.versions, m.plannedRelease ?? c.release);
  }
  console.log(`[db] version lists: ${mergedVersionLists} completed from the archive, ${newerText} specs with text newer than itecspec's`);
  // section-id index for cross references
  const sectionIds = new Map<string, Set<string>>();
  const walkIds = (spec: string, nodes: TocNode[], set: Set<string>) => {
    for (const n of nodes) {
      set.add(n.id);
      walkIds(spec, n.children, set);
    }
  };
  for (const [spec, m] of metas) {
    const s = new Set<string>();
    walkIds(spec, m.toc, s);
    sectionIds.set(spec, s);
  }
  const specSet = new Set(catalog.map((c) => c.spec));

  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  const db = new DatabaseSync(TMP);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA page_size = 8192;
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE specs(
      spec TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      short_title TEXT NOT NULL,
      tsg TEXT,
      type TEXT NOT NULL,
      release TEXT NOT NULL,
      rel_num INTEGER NOT NULL,
      series TEXT NOT NULL,
      section_count INTEGER NOT NULL,
      available INTEGER NOT NULL,
      latest_version TEXT,
      latest_date TEXT,
      toc BLOB,
      versions TEXT,
      status TEXT,
      source TEXT
    );
    CREATE TABLE sections(
      id INTEGER PRIMARY KEY,
      spec TEXT NOT NULL,
      sid TEXT NOT NULL,
      num TEXT,
      title TEXT NOT NULL,
      ord INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      parent TEXT,
      child_count INTEGER NOT NULL,
      chars INTEGER NOT NULL,
      html BLOB,
      text BLOB
    );
    CREATE TABLE abbrevs(spec TEXT NOT NULL, abbr TEXT NOT NULL, expansion TEXT NOT NULL);
    CREATE TABLE refs(to_id INTEGER NOT NULL, from_id INTEGER NOT NULL, PRIMARY KEY(to_id, from_id)) WITHOUT ROWID;
    CREATE VIRTUAL TABLE fts USING fts5(
      title, body, spec, series, rel, type, kind,
      content='', contentless_delete=1,
      tokenize="unicode61 remove_diacritics 2 tokenchars '_'",
      prefix='2 3 4'
    );
  `);

  const insSpec = db.prepare(
    `INSERT INTO specs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insSec = db.prepare(`INSERT INTO sections(id,spec,sid,num,title,ord,depth,parent,child_count,chars,html,text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insAbbr = db.prepare(`INSERT INTO abbrevs VALUES (?,?,?)`);
  const insRef = db.prepare(`INSERT OR IGNORE INTO refs VALUES (?,?)`);
  /** section rowid by "spec|sid" and the cross references found while rendering (resolved at the end) */
  const idOf = new Map<string, number>();
  const refFrom: number[] = [];
  const refTo: string[] = [];
  let abbrevCount = 0;
  const insFts = db.prepare(`INSERT INTO fts(rowid,title,body,spec,series,rel,type,kind) VALUES (?,?,?,?,?,?,?,?)`);

  let rowid = 0;
  let totalSections = 0;
  let totalChars = 0;
  let htmlBytes = 0;
  const unknownTags = new Map<string, number>();
  let specsWithContent = 0;
  let filledSections = 0;
  let filledChars = 0;
  const filledSpecs = new Set<string>();
  let attachedSpecs = 0;
  let attachedFiles = 0;
  let shownFiles = 0;

  db.exec('BEGIN');
  let n = 0;
  for (const c of catalog) {
    n++;
    const m = metas.get(c.spec);
    const { tsg, short } = splitTitle(c.title);
    const series = seriesOf(c.spec);
    const versions = m?.versions ?? [];
    // newest version first: sort by semantic version
    const sortedV = [...versions].sort((a, b) => {
      const pa = a.version.split('.').map(Number);
      const pb = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    });
    const latest = (m?.contentVersion && sortedV.find((v) => v.version === m.contentVersion)) || sortedV[0];
    // the release of the text shown (itecspec labels some specs by the release they were last touched in)
    const release = latest?.release ? latest.release.replace(/^Rel-/, 'rel-') : c.release;

    // load crawled content for this spec
    const content = new Map<string, any>();
    for await (const o of readSections(c.spec)) content.set(o.id, o);

    // walk TOC in order
    const docToc = m?.toc ?? [];
    const ctx = {
      spec: c.spec,
      hasSpec: (s: string) => specSet.has(s),
      hasSection: (s: string, id: string) => sectionIds.get(s)?.has(id) ?? false,
      imageUrl: (src: string) => `${c.spec}/${src}`,
    };
    // + the files beside the document
    const att = readAttachments(c.spec);
    const fileSecs = new Map<string, { html: string; text: string; index?: boolean }>();
    let toc = docToc;
    if (att?.items.length) {
      const a = attachmentAnnex(c.spec, att, (h) => finishDocxHtml(h, ctx));
      toc = [...docToc, a.node];
      for (const [k, v] of a.sections) fileSecs.set(k, v);
      attachedSpecs++;
      attachedFiles += att.items.length;
      shownFiles += [...a.sections.keys()].length;
    }
    let ord = 0;
    let available = 0;
    const seen = new Set<string>();
    /** html + plain text of one stored section (crawled tree or converted .docx html) */
    const renderOne = (o: any): { html: string; text: string } | null => {
      if (o && typeof o.html === 'string' && o.html.trim()) return finishDocxHtml(o.html, ctx); // from the official .docx
      if (o && Array.isArray(o.c) && o.c.length) {
        const r = renderSection(o.c as CNode[], ctx);
        for (const u of r.unknown) unknownTags.set(u, (unknownTags.get(u) ?? 0) + 1);
        return r.html ? { html: r.html, text: r.text } : null;
      }
      return null;
    };
    // the same spec from its .docx, cut along itecspec's TOC (docx.ts --fill): a section whose official text is
    // clearly longer replaces the crawled one (itecspec drops nested tables, for instance). Only when the two
    // agree overall - a different document version must not be mixed in.
    const rendered = new Map<string, { html: string; text: string } | null>();
    const fromDocx = new Map<string, { html: string; text: string }>();
    // (only for crawled specs: a spec converted from its .docx already is the document)
    const crawledSpec = [...content.values()].some((o) => Array.isArray(o.c));
    if (crawledSpec) for await (const o of readSections(c.spec, 'sections-docx')) {
      if (typeof o.html !== 'string' || !o.html.trim() || !content.has(o.id)) continue;
      fromDocx.set(o.id, finishDocxHtml(o.html, ctx));
    }
    if (fromDocx.size) {
      let ct = 0;
      let dt = 0;
      for (const [sid, o] of content) {
        const r = renderOne(o);
        rendered.set(sid, r);
        // compared where itecspec has text: a heading-only placeholder (36.881's "Annex B", filed as a separate
        // document itecspec never read) is what the fill is for, not a sign of another version
        const t = r?.text.length ?? 0;
        const d = fromDocx.get(sid);
        if (d && t >= 200) {
          ct += t;
          dt += d.text.length;
        }
      }
      const ratio = ct ? dt / ct : 1;
      if (ct && (ratio > 1.6 || ratio < 0.8)) {
        console.log(`  ${c.spec}: .docx text differs too much from itecspec (${ratio.toFixed(2)}x) - not used`);
        fromDocx.clear();
      }
    }
    // a section the .docx was not cut at (itecspec made its id up from a title it could not number, for
    // instance) ends up inside the .docx section before it: that one keeps itecspec's text, or the
    // swallowed section's text would show twice
    const swallowed = new Set<string>();
    if (fromDocx.size) {
      let prev: string | null = null;
      const scan = (nodes: TocNode[]) => {
        for (const n of nodes) {
          if (fromDocx.has(n.id)) prev = n.id;
          else if (prev && rendered.get(n.id)?.text.trim()) swallowed.add(prev);
          scan(n.children ?? []);
        }
      };
      scan(toc);
    }
    const walk = (nodes: TocNode[], depth: number, parent: string | null, inAbbrevs = false) => {
      for (const node of nodes) {
        if (seen.has(node.id) || node.id === 'contents') continue;
        seen.add(node.id);
        ord++;
        const id = ++rowid;
        const o = content.get(node.id);
        let html: Buffer | null = null;
        let textBlob: Buffer | null = null;
        let chars = 0;
        let text = '';
        let htmlStr = '';
        const file = fileSecs.get(node.id);
        let r = file ?? (rendered.has(node.id) ? rendered.get(node.id)! : renderOne(o));
        const d = swallowed.has(node.id) ? undefined : fromDocx.get(node.id);
        const imgs = (h?: string) => (h?.match(/<img\b/g) ?? []).length;
        const lds = (h?: string) => (h?.match(/<pre class="ld"/g) ?? []).length;
        const tl = r?.text.length ?? 0;
        // clearly more text, or figures itecspec left out with (at least) the same text, or the line drawings
        // (message sequences drawn with characters) that itecspec collapsed into centred paragraphs
        if (
          d &&
          (d.text.length > tl * 1.15 + 60 ||
            (imgs(d.html) > imgs(r?.html) && d.text.length >= tl * 0.97) ||
            (lds(d.html) > lds(r?.html) && d.text.length >= tl * 0.9))
        ) {
          filledSections++;
          filledChars += Math.max(0, d.text.length - tl);
          filledSpecs.add(c.spec);
          r = d;
        }
        if (r) {
          htmlStr = r.html;
          text = r.text;
          chars = text.length;
          html = br(r.html);
          htmlBytes += html.length;
          // file contents are not indexed (hundreds of MB of TTCN-3 and C): found by their names
          textBlob = file && !file.index ? null : br(text);
        }
        if (o) available++;
        totalSections++;
        totalChars += chars;
        const title = cleanTitle(node.title);
        idOf.set(`${c.spec}|${node.id}`, id);
        if (htmlStr) {
          const targets = new Set<string>();
          for (const m of htmlStr.matchAll(/data-spec="([^"]+)" data-sec="([^"]+)"/g)) targets.add(`${m[1]}|${m[2]}`);
          targets.delete(`${c.spec}|${node.id}`);
          for (const t of targets) {
            refFrom.push(id);
            refTo.push(t);
          }
          // the abbreviation clause itself, or its sub-sections (21.905 splits it by initial letter)
          if (inAbbrevs || /abbreviation/i.test(title)) {
            for (const [abbr, exp] of parseAbbrevs(htmlStr)) {
              insAbbr.run(c.spec, abbr, exp);
              abbrevCount++;
            }
          }
        }
        insSec.run(id, c.spec, node.id, node.number, title, ord, depth, parent, node.children.length, chars, html, textBlob);
        const label = [node.number, title].filter(Boolean).join(' ');
        // kind: body = has text, head = heading whose subsections carry the text, stub = spec not crawled
        insFts.run(id, label, file && !file.index && node.id !== 'zip-files' ? '' : text, specToken(c.spec), `ser${series}`, `rel${relNum(release)}`, c.type.toLowerCase(), chars > 0 ? 'body' : content.size ? 'head' : 'stub');
        // compact TOC node for the client: [id, number, title, flags, children?]  flags: 1 = has own content
        const cnode: any[] = [node.id, node.number ?? '', title, chars > 0 ? 1 : 0];
        compactParent.push(cnode);
        if (node.children.length) {
          const kids: any[] = [];
          cnode.push(kids);
          const saved = compactParent;
          compactParent = kids;
          walk(node.children, depth + 1, node.id, inAbbrevs || /abbreviation/i.test(title));
          compactParent = saved;
        }
        continue;
      }
    };
    const compactToc: any[] = [];
    let compactParent: any[] = compactToc;
    walk(toc, 0, null);
    if (available) specsWithContent++;

    insSpec.run(
      c.spec,
      cleanTitle(c.title),
      short,
      tsg,
      c.type,
      release,
      relNum(release),
      series,
      m?.sectionCount ?? 0,
      available,
      latest?.version ?? null,
      latest?.date ?? null,
      m ? br(JSON.stringify(compactToc)) : null,
      JSON.stringify(sortedV),
      m?.status ?? c.status ?? null,
      m?.source === 'archive' || c.source === 'archive' ? 'archive' : 'itecspec',
    );
    if (n % 200 === 0) {
      db.exec('COMMIT');
      db.exec('BEGIN');
      console.log(`  ${n}/${catalog.length} specs, ${totalSections} sections, ${(htmlBytes / 1e6).toFixed(0)} MB html (br)`);
    }
  }
  db.exec('COMMIT');

  // backlinks: which sections cite which
  db.exec('BEGIN');
  let refCount = 0;
  for (let i = 0; i < refFrom.length; i++) {
    const to = idOf.get(refTo[i]);
    if (to !== undefined && to !== refFrom[i]) {
      insRef.run(to, refFrom[i]);
      refCount++;
    }
  }
  db.exec('COMMIT');
  console.log(`  ${refCount} cross references, ${abbrevCount} abbreviations`);

  const releases = db.prepare(`SELECT release, rel_num, count(*) n FROM specs GROUP BY release ORDER BY rel_num DESC`).all();
  const meta = {
    builtAt: new Date().toISOString(),
    specs: catalog.length,
    specsWithContent,
    sections: totalSections,
    textChars: totalChars,
    releases,
    source: 'itecspec.com/3gpp + www.3gpp.org/ftp/Specs/archive',
    archiveOnlySpecs: catalog.filter((c) => c.source === 'archive').length,
    sectionsFilledFromDocx: filledSections,
    specsWithZipFiles: attachedSpecs,
    zipFiles: attachedFiles,
  };
  db.prepare(`INSERT INTO meta VALUES ('info', ?)`).run(JSON.stringify(meta));
  console.log('indexing…');
  db.exec(`
    CREATE INDEX sections_spec_ord ON sections(spec, ord);
    CREATE UNIQUE INDEX sections_spec_sid ON sections(spec, sid);
    CREATE INDEX sections_parent ON sections(spec, parent);
    CREATE INDEX specs_series ON specs(series);
    CREATE INDEX specs_rel ON specs(rel_num);
    CREATE INDEX abbrevs_abbr ON abbrevs(abbr);
    CREATE INDEX abbrevs_spec ON abbrevs(spec);
    INSERT INTO fts(fts) VALUES('optimize');
  `);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('ANALYZE');
  db.close();
  fs.renameSync(TMP, OUT);
  const size = fs.statSync(OUT).size;
  console.log(
    `  ${filledSections} sections in ${filledSpecs.size} specs completed from the official .docx (+${(filledChars / 1e3).toFixed(0)}K chars)`,
  );
  console.log(`  ${attachedFiles} files beside the documents of ${attachedSpecs} specs (${shownFiles} annex sections)`);
  console.log(
    `built ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${catalog.length} specs (${specsWithContent} with content), ${totalSections} sections, ${(totalChars / 1e6).toFixed(0)}M chars text, html ${(htmlBytes / 1e6).toFixed(0)} MB, db ${(size / 1e6).toFixed(0)} MB`,
  );
  if (unknownTags.size) console.log('unhandled tags/classes:', [...unknownTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
