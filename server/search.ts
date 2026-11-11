import type { SpecDb, SpecRow } from './db.ts';

/* ------------------------------------------------------------------ */
/* Query parsing                                                       */
/* ------------------------------------------------------------------ */

export interface ParsedQuery {
  terms: string[]; // bare words (lower-case)
  phrases: string[]; // "quoted phrases"
  excluded: string[];
  spec?: string;
  series?: string;
  rel?: number;
  type?: 'ts' | 'tr';
  inTitle: boolean;
  /** "38.331 5.3.3" style direct reference */
  sectionRef?: string;
}

const SPEC_NUM = /^(?:3gpp\s*)?(?:t[sr]\s*)?(\d{2})[.\s]?(\d{3})((?:-\d{1,2})*)$/i;

export function normalizeSpec(s: string, db: SpecDb): string | undefined {
  const m = SPEC_NUM.exec(s.trim());
  if (!m) return undefined;
  const spec = `${m[1]}.${m[2]}${m[3] || ''}`;
  return db.specMap.has(spec) ? spec : undefined;
}

export function parseQuery(q: string, db: SpecDb): ParsedQuery {
  const pq: ParsedQuery = { terms: [], phrases: [], excluded: [], inTitle: false };
  let rest = q.trim();
  // quoted phrases
  rest = rest.replace(/"([^"]+)"/g, (_, p: string) => {
    pq.phrases.push(p.toLowerCase());
    return ' ';
  });
  const tokens = rest.split(/\s+/).filter(Boolean);
  const leftovers: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const kv = /^(spec|series|rel|release|type|in):(.+)$/i.exec(t);
    if (kv) {
      const k = kv[1].toLowerCase();
      const v = kv[2].toLowerCase();
      if (k === 'spec') pq.spec = normalizeSpec(v, db) ?? v;
      else if (k === 'series') pq.series = v.replace(/\D/g, '').slice(0, 2);
      else if (k === 'rel' || k === 'release') pq.rel = Number(v.replace(/\D/g, '')) || undefined;
      else if (k === 'type' && (v === 'ts' || v === 'tr')) pq.type = v;
      else if (k === 'in' && v === 'title') pq.inTitle = true;
      continue;
    }
    // "TS 38.331" / "38.331" / "38331" as a spec filter
    const combo = /^t[sr]$/i.test(t) && tokens[i + 1] ? `${t} ${tokens[i + 1]}` : t;
    const spec = normalizeSpec(combo.replace(/^t[sr]\s*/i, ''), db);
    if (spec && !pq.spec) {
      pq.spec = spec;
      if (combo !== t) i++;
      continue;
    }
    if (t.startsWith('-') && t.length > 1) {
      pq.excluded.push(t.slice(1).toLowerCase());
      continue;
    }
    leftovers.push(t);
  }
  // a lone section number right after a spec number → direct reference
  if (pq.spec && leftovers.length === 1 && /^[a-z]?\d+(\.\w+)*$/i.test(leftovers[0]) && /[\d.]/.test(leftovers[0])) {
    pq.sectionRef = leftovers[0].toLowerCase();
  }
  for (const t of leftovers) {
    const w = t.toLowerCase().replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_*]+$/gu, '');
    if (w) pq.terms.push(w);
  }
  return pq;
}

/** tokenise like FTS5 unicode61 (letters/digits/underscore) */
export function ftsTokens(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function quote(tok: string) {
  return `"${tok.replace(/"/g, '""')}"`;
}

/**
 * Build an FTS5 MATCH expression.
 * - every word becomes a quoted token (hyphenated words become phrases: NG-RAN → "ng" "ran" adjacent)
 * - the last word gets a prefix wildcard when `prefixLast` (typeahead)
 */
export function buildMatch(pq: ParsedQuery, opts: { prefixLast?: boolean; titleOnly?: boolean } = {}): string | null {
  const parts: string[] = [];
  const words = pq.terms;
  words.forEach((w, i) => {
    const toks = ftsTokens(w.replace(/\*$/, ''));
    if (!toks.length) return;
    const wantPrefix = w.endsWith('*') || (opts.prefixLast && i === words.length - 1);
    if (toks.length === 1) parts.push(quote(toks[0]) + (wantPrefix ? '*' : ''));
    else parts.push(`"${toks.join(' ')}"` + (wantPrefix ? '*' : ''));
  });
  for (const p of pq.phrases) {
    const toks = ftsTokens(p);
    if (toks.length) parts.push(`"${toks.join(' ')}"`);
  }
  if (!parts.length) return null;
  const q = parts.join(' AND ');
  let expr: string;
  if (opts.titleOnly || pq.inTitle) {
    expr = `{title}: (${q}) NOT kind: "stub"`;
  } else {
    // sections with text match on title or body; heading-only sections (their subsections carry
    // the text) only when the title matches; specs without crawled content ("stub") never
    expr = `(({title body}: (${q})) AND kind: "body") OR (({title}: (${q})) AND kind: "head")`;
  }
  const filters: string[] = [];
  if (pq.spec) filters.push(`spec: "s${pq.spec.replace(/[^0-9a-z]+/gi, '_').toLowerCase()}"`);
  if (pq.series) filters.push(`series: "ser${pq.series}"`);
  if (pq.rel) filters.push(`rel: "rel${pq.rel}"`);
  if (pq.type) filters.push(`type: "${pq.type}"`);
  if (filters.length) expr = `(${expr}) AND ${filters.join(' AND ')}`;
  for (const ex of pq.excluded) {
    const toks = ftsTokens(ex);
    if (toks.length) expr = `(${expr}) NOT {title body}: "${toks.join(' ')}"`;
  }
  return expr;
}

/* ------------------------------------------------------------------ */
/* Snippets                                                            */
/* ------------------------------------------------------------------ */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** Pick the densest ~240 char window and wrap matches in <mark>. Returns safe HTML. */
export function makeSnippet(text: string, pq: ParsedQuery, size = 240): string {
  if (!text) return '';
  const needles = [
    ...pq.terms.map((t) => ({ re: ftsTokens(t.replace(/\*$/, '')).join('[^\\p{L}\\p{N}]+'), prefix: t.endsWith('*') })),
    ...pq.phrases.map((p) => ({ re: ftsTokens(p).join('[^\\p{L}\\p{N}]+'), prefix: false })),
  ].filter((n) => n.re);
  const flat = text.replace(/\s+/g, ' ');
  if (!needles.length) return esc(flat.slice(0, size)) + (flat.length > size ? '…' : '');
  const re = new RegExp(
    needles
      .sort((a, b) => b.re.length - a.re.length)
      // tokens only contain [\p{L}\p{N}_] so they are regex-safe as-is
      .map((n) => `(?<![\\p{L}\\p{N}_])${n.re}${n.prefix ? '[\\p{L}\\p{N}_]*' : ''}`)
      .join('|'),
    'giu',
  );
  const hits: { s: number; e: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) && hits.length < 500) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    hits.push({ s: m.index, e: m.index + m[0].length });
  }
  if (!hits.length) return esc(flat.slice(0, size)) + (flat.length > size ? '…' : '');
  // densest window
  let best = 0;
  let bestCount = 0;
  for (let i = 0, j = 0; i < hits.length; i++) {
    while (j < hits.length && hits[j].e - hits[i].s <= size) j++;
    if (j - i > bestCount) {
      bestCount = j - i;
      best = i;
    }
  }
  let start = Math.max(0, hits[best].s - 60);
  // snap to word boundary
  if (start > 0) {
    const sp = flat.indexOf(' ', start);
    if (sp > 0 && sp < hits[best].s) start = sp + 1;
  }
  let end = Math.min(flat.length, start + size);
  if (end < flat.length) {
    const sp = flat.lastIndexOf(' ', end);
    if (sp > hits[best].e) end = sp;
  }
  let out = start > 0 ? '…' : '';
  let pos = start;
  for (const h of hits) {
    if (h.s < start || h.e > end) continue;
    out += esc(flat.slice(pos, h.s)) + '<mark>' + esc(flat.slice(h.s, h.e)) + '</mark>';
    pos = h.e;
  }
  out += esc(flat.slice(pos, end)) + (end < flat.length ? '…' : '');
  return out;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface SearchOptions {
  q: string;
  spec?: string;
  series?: string;
  rel?: number;
  type?: string;
  limit?: number;
  offset?: number;
  inTitle?: boolean;
}

export interface SearchHit {
  spec: string;
  sid: string;
  num: string | null;
  title: string;
  specTitle: string;
  release: string;
  type: string;
  snippet: string;
  score: number;
}

export function search(db: SpecDb, o: SearchOptions) {
  const t0 = performance.now();
  const pq = parseQuery(o.q, db);
  if (o.spec) pq.spec = normalizeSpec(o.spec, db) ?? o.spec;
  if (o.series) pq.series = o.series;
  if (o.rel) pq.rel = o.rel;
  if (o.type === 'ts' || o.type === 'tr') pq.type = o.type;
  if (o.inTitle) pq.inTitle = true;
  const limit = Math.min(Math.max(o.limit ?? 20, 1), 100);
  const offset = Math.max(o.offset ?? 0, 0);

  let direct: { spec: string; sid?: string } | undefined;
  if (pq.spec && pq.sectionRef) {
    const sec = db.section(pq.spec, pq.sectionRef);
    if (sec) direct = { spec: pq.spec, sid: sec.sid };
  } else if (pq.spec && !pq.terms.length && !pq.phrases.length) direct = { spec: pq.spec };

  const match = buildMatch(pq);
  if (!match) return { query: pq, direct, total: 0, hits: [] as SearchHit[], took: Math.round(performance.now() - t0) };

  let rows: { id: number; score: number }[] = [];
  let total = 0;
  try {
    rows = db
      .stmt(`SELECT rowid id, bm25(fts, 6.0, 1.0, 0, 0, 0, 0, 0) score FROM fts WHERE fts MATCH ? ORDER BY score LIMIT ? OFFSET ?`)
      .all(match, limit, offset) as unknown as { id: number; score: number }[];
    total =
      offset === 0 && rows.length < limit
        ? rows.length
        : (db.stmt(`SELECT count(*) n FROM fts WHERE fts MATCH ?`).get(match) as { n: number }).n;
  } catch (e) {
    return { query: pq, direct, total: 0, hits: [], took: 0, error: (e as Error).message };
  }
  const ids = rows.map((r) => r.id);
  const secs = db.sectionsByIds(ids);
  const texts = db.texts(ids);
  const hits: SearchHit[] = [];
  for (const r of rows) {
    const s = secs.get(r.id);
    if (!s) continue;
    const spec = db.specMap.get(s.spec);
    hits.push({
      spec: s.spec,
      sid: s.sid,
      num: s.num,
      title: s.title,
      specTitle: spec?.short_title ?? '',
      release: spec?.release ?? '',
      type: spec?.type ?? '',
      snippet: makeSnippet(texts.get(r.id) ?? '', pq),
      score: Math.round(-r.score * 100) / 100,
    });
  }
  return { query: pq, direct, total, hits, took: Math.round(performance.now() - t0) };
}

/** Facet counts (by spec/series/release/type) for a query — computed from rowid ranges, no joins. */
export function facets(db: SpecDb, o: SearchOptions) {
  const t0 = performance.now();
  const pq = parseQuery(o.q, db);
  if (o.spec) pq.spec = o.spec;
  if (o.series) pq.series = o.series;
  if (o.rel) pq.rel = o.rel;
  if (o.type === 'ts' || o.type === 'tr') pq.type = o.type;
  const match = buildMatch(pq);
  if (!match) return { specs: [], series: [], releases: [], types: [], took: 0 };
  const bySpec = new Map<string, number>();
  try {
    for (const r of db.stmt(`SELECT rowid id FROM fts WHERE fts MATCH ?`).iterate(match) as Iterable<{ id: number }>) {
      const spec = db.specForRowid(r.id);
      if (spec) bySpec.set(spec, (bySpec.get(spec) ?? 0) + 1);
    }
  } catch {
    return { specs: [], series: [], releases: [], types: [], took: 0 };
  }
  const series = new Map<string, number>();
  const rels = new Map<string, number>();
  const types = new Map<string, number>();
  for (const [spec, n] of bySpec) {
    const s = db.specMap.get(spec);
    if (!s) continue;
    series.set(s.series, (series.get(s.series) ?? 0) + n);
    rels.set(String(s.rel_num), (rels.get(String(s.rel_num)) ?? 0) + n);
    types.set(s.type, (types.get(s.type) ?? 0) + n);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  return {
    specs: sorted(bySpec)
      .slice(0, 30)
      .map((x) => ({ ...x, title: db.specMap.get(x.key)?.short_title ?? '' })),
    series: sorted(series),
    releases: sorted(rels),
    types: sorted(types),
    took: Math.round(performance.now() - t0),
  };
}

/* ------------------------------------------------------------------ */
/* Typeahead                                                           */
/* ------------------------------------------------------------------ */

function specScore(s: SpecRow, words: string[], digits: string): number {
  let score = 0;
  const num = s.spec.replace(/[^0-9]/g, '');
  if (digits.length >= 2 && num.startsWith(digits)) score += 100 - (num.length - digits.length) - s.spec.length * 0.1;
  if (words.length) {
    const hay = (s.short_title + ' ' + s.spec).toLowerCase();
    let all = true;
    for (const w of words) {
      const i = hay.indexOf(w);
      if (i < 0) {
        all = false;
        break;
      }
      score += i === 0 || /\W/.test(hay[i - 1]) ? 12 : 4;
    }
    if (!all) return digits.length >= 2 && num.startsWith(digits) ? score : 0;
  }
  // gentle preference for modern, popular series
  if (score > 0) score += ({ '38': 3, '23': 2.5, '24': 2.5, '29': 2, '36': 2, '33': 1.5 } as Record<string, number>)[s.series] ?? 0;
  return score;
}

export function suggest(db: SpecDb, q: string, limit = 8) {
  const t0 = performance.now();
  const raw = q.trim();
  if (!raw) return { specs: [], sections: [], took: 0 };
  const pq = parseQuery(raw, db);
  const words = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !/^\d+[.\d-]*$/.test(w) && !/^t[sr]$/.test(w));
  const digits = (/^(?:t[sr]\s*)?(\d[\d.\s-]*)/i.exec(raw)?.[1] ?? '').replace(/[^0-9]/g, '');

  const specs = db.specs
    .map((s) => ({ s, score: specScore(s, words, digits) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ s }) => ({ spec: s.spec, title: s.short_title, type: s.type, release: s.release }));

  let sections: { spec: string; sid: string; num: string | null; title: string; specTitle: string }[] = [];
  if (pq.spec && pq.sectionRef) {
    const sec = db.section(pq.spec, pq.sectionRef);
    if (sec) sections.push({ spec: sec.spec, sid: sec.sid, num: sec.num, title: sec.title, specTitle: db.specMap.get(sec.spec)?.short_title ?? '' });
  }
  const match = buildMatch(pq, { prefixLast: true, titleOnly: true });
  if (match) {
    try {
      const rows = db
        .stmt(`SELECT rowid id FROM fts WHERE fts MATCH ? ORDER BY bm25(fts, 1.0, 0, 0, 0, 0, 0, 0) LIMIT ?`)
        .all(match, limit * 2) as unknown as { id: number }[];
      const secs = db.sectionsByIds(rows.map((r) => r.id));
      for (const r of rows) {
        const s = secs.get(r.id);
        if (!s || sections.some((x) => x.spec === s.spec && x.sid === s.sid)) continue;
        sections.push({ spec: s.spec, sid: s.sid, num: s.num, title: s.title, specTitle: db.specMap.get(s.spec)?.short_title ?? '' });
      }
    } catch {
      /* malformed expression — ignore */
    }
  }
  sections = sections.slice(0, limit);
  return { specs, sections, took: Math.round(performance.now() - t0) };
}
