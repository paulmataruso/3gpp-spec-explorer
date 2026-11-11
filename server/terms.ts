/**
 * Concept lookup: where is a term (AUSF, Nnrf, Nnrf_NFManagement, "Network Slice Selection Function") described?
 *
 * 3GPP spreads one concept over several documents — stage 2 architecture (23.501), stage 2 procedures
 * and services (23.502), stage 3 APIs (29.5xx)… — so a term resolves to a ranked list of sections,
 * grouped per specification, found through the title index.
 */
import type { SpecDb, SectionRow } from './db.ts';

export interface TermHit {
  sid: string;
  num: string | null;
  title: string;
  kind: 'definition' | 'services' | 'operation' | 'section';
}
export interface TermGroup {
  spec: string;
  title: string;
  type: string;
  stage: string;
  hits: TermHit[];
}
export interface TermResult {
  term: string;
  expansion: string | null;
  /** where the expansion comes from (the current spec or the 3GPP vocabulary, TR 21.905) */
  expansionFrom: string | null;
  related: string[];
  groups: TermGroup[];
}

const VOCAB = '21.905';
/** the system-wide architecture / procedure specs are the canonical place a network function is described */
const CORE: Record<string, number> = { '23.501': 15, '23.502': 10, '23.503': 6, '23.401': 10, '23.402': 4, '23.002': 6, '23.228': 4 };
const escFts = (s: string) => `"${s.replace(/"/g, '""')}"`;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ \s]+/g, ' ')
    .replace(/[.:]$/, '')
    .trim();

function stageOf(spec: string, type: string, title: string): string {
  if (type === 'TR') return 'Study / report';
  const m = /stage\s*([123])/i.exec(title);
  if (m) return `Stage ${m[1]}`;
  if (spec.startsWith('22.')) return 'Stage 1';
  if (spec.startsWith('23.')) return 'Stage 2';
  if (/^(24|29|38\.4|36\.4|38\.3|36\.3)/.test(spec)) return 'Stage 3';
  return '';
}

export class TermIndex {
  private termCache = new Map<string, [string, string][]>();
  private resultCache = new Map<string, TermResult>();
  private db: SpecDb;
  private gen = '';

  constructor(db: SpecDb) {
    this.db = db;
  }

  private fresh() {
    const g = String(this.db.info.builtAt ?? '');
    if (g !== this.gen) {
      this.gen = g;
      this.termCache.clear();
      this.resultCache.clear();
    }
  }

  private hasTable(name: string): boolean {
    return !!this.db.stmt(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  }

  /** abbreviations usable in a spec: its own clause 3.x list, then the 3GPP vocabulary */
  abbrevs(spec: string): [string, string][] {
    this.fresh();
    let r = this.termCache.get(spec);
    if (r) return r;
    if (!this.hasTable('abbrevs')) return [];
    const map = new Map<string, string>();
    const rows = this.db.stmt(`SELECT abbr, expansion FROM abbrevs WHERE spec=?`);
    for (const x of rows.all(VOCAB) as { abbr: string; expansion: string }[]) map.set(x.abbr, x.expansion);
    if (spec !== VOCAB) for (const x of rows.all(spec) as { abbr: string; expansion: string }[]) map.set(x.abbr, x.expansion);
    r = [...map.entries()];
    if (this.termCache.size > 300) this.termCache.clear();
    this.termCache.set(spec, r);
    return r;
  }

  private expansionOf(term: string, spec?: string): { text: string; from: string } | null {
    if (!this.hasTable('abbrevs')) return null;
    if (spec) {
      const own = this.db.stmt(`SELECT expansion FROM abbrevs WHERE spec=? AND abbr=?`).get(spec, term) as { expansion: string } | undefined;
      if (own) return { text: own.expansion, from: spec };
    }
    const r = this.db
      .stmt(`SELECT expansion, count(*) n, max(spec='${VOCAB}') v FROM abbrevs WHERE abbr=? GROUP BY expansion ORDER BY v DESC, n DESC LIMIT 1`)
      .get(term) as { expansion: string } | undefined;
    return r ? { text: r.expansion, from: VOCAB } : null;
  }

  lookup(termIn: string, spec?: string): TermResult {
    this.fresh();
    const term = termIn.trim().slice(0, 120);
    const key = `${spec ?? ''}|${term}`;
    const cached = this.resultCache.get(key);
    if (cached) return cached;

    // related names: NF "NRF" <-> service-based interface "Nnrf"; operation names → their service
    const related: string[] = [];
    let nf: string | null = null;
    let iface: string | null = null;
    const svc = /^(N[a-z0-9][a-z0-9-]*)_([A-Za-z0-9]+)(?:_([A-Za-z0-9]+))?$/.exec(term);
    if (svc) {
      iface = svc[1];
      nf = iface.slice(1).toUpperCase();
      if (svc[3]) related.push(`${svc[1]}_${svc[2]}`);
      related.push(iface, nf);
    } else if (/^N[a-z0-9][a-z0-9-]+$/.test(term)) {
      iface = term;
      nf = term.slice(1).toUpperCase();
      related.push(nf);
    } else if (/^[A-Z0-9][A-Z0-9-]{1,10}$/.test(term) && /[A-Z]/.test(term)) {
      nf = term;
      iface = 'N' + term.toLowerCase();
    }
    const exp = this.expansionOf(term, spec);
    const nfExp = !exp && nf && nf !== term ? this.expansionOf(nf, spec) : null;

    // candidate sections from the title index
    const queries: string[] = [`title: ${escFts(term)}`];
    if (exp) queries.push(`title: ${escFts(exp.text)}`);
    if (nf && nf !== term) queries.push(`title: ${escFts(nf)}`);
    if (iface && !svc) queries.push(`title: ${escFts(iface.toLowerCase())}*`);
    if (svc) queries.push(`title: ${escFts(`${svc[1]}_${svc[2]}`.toLowerCase())}*`);
    if (svc?.[3]) queries.push(`title: ${escFts(svc[3])}`);
    const ids = new Set<number>();
    for (const q of queries) {
      try {
        for (const r of this.db.stmt(`SELECT rowid FROM fts WHERE fts MATCH ? LIMIT 4000`).all(q) as { rowid: number }[]) ids.add(r.rowid);
      } catch {
        /* bad FTS syntax for odd input */
      }
    }
    const rows = ids.size ? this.sections([...ids]) : [];

    const t = norm(term);
    const e = exp ? norm(exp.text) : null;
    const nfl = nf ? nf.toLowerCase() : null;
    const ifl = iface ? iface.toLowerCase() : null;
    const svcName = svc ? `${svc[1]}_${svc[2]}`.toLowerCase() : null;
    const opShort = svc?.[3]?.toLowerCase() ?? null;
    const mode: 'op' | 'svc' | 'iface' | 'nf' | 'other' = svc ? (svc[3] ? 'op' : 'svc') : iface && term === iface ? 'iface' : nf ? 'nf' : 'other';
    const isNfDef = (ti: string) =>
      !!nfl && (ti === nfl || (e != null && mode === 'nf' && (ti === e || ti === `${e} (${t})` || ti === `${t} (${e})`)) || ti === `${nfl} functional description`);
    const isNfServices = (ti: string) =>
      !!nfl && (ti === `${nfl} services` || ti === `${nfl} service` || ti === `services provided by ${nfl}` || ti === `services offered by the ${nfl}` || ti === `services offered by ${nfl}`);
    const scored: { row: SectionRow; score: number; kind: TermHit['kind'] }[] = [];
    for (const row of rows) {
      const meta = this.db.specMap.get(row.spec);
      if (!meta) continue;
      const ti = norm(row.title);
      const words = ti.split(/[^a-z0-9_-]+/);
      let score = 0;
      let kind: TermHit['kind'] = 'section';
      if (mode === 'op' || mode === 'svc') {
        if (ti.startsWith(t) && (ti.length === t.length || /^[\s(]/.test(ti.slice(t.length)))) {
          kind = mode === 'op' ? 'operation' : 'services';
          score = 100;
        } else if (mode === 'svc' && ti.startsWith(t + '_')) {
          kind = 'operation';
          score = 70;
        } else if (mode === 'op' && svcName && (ti === svcName || ti.startsWith(svcName + ' '))) {
          kind = 'services';
          score = 80;
        } else if (mode === 'op' && opShort && words.includes(opShort)) {
          kind = 'operation';
          score = ti === opShort || ti.startsWith(opShort + ' ') ? 95 : 75;
        } else if (isNfServices(ti)) {
          kind = 'services';
          score = 65;
        } else if (isNfDef(ti)) {
          kind = 'definition';
          score = 55;
        } else continue;
      } else if (mode === 'iface') {
        if (isNfServices(ti) || ti === t) {
          kind = 'services';
          score = 95;
        } else if (ifl && ti.startsWith(ifl + '_')) {
          kind = /_[a-z0-9]+_[a-z0-9]+/.test(ti) ? 'operation' : 'services';
          score = kind === 'services' ? 85 : 50;
        } else if (isNfDef(ti)) {
          kind = 'definition';
          score = 75;
        } else continue;
      } else {
        const defTitles = [t, e, e && `${e} (${t})`, e && `${t} (${e})`, `${t} functional description`, `${t} function`].filter(Boolean) as string[];
        if (defTitles.includes(ti)) {
          kind = 'definition';
          score = 100;
        } else if (isNfServices(ti)) {
          kind = 'services';
          score = 85;
        } else if (ifl && ti.startsWith(ifl + '_')) {
          kind = /_[a-z0-9]+_[a-z0-9]+/.test(ti) ? 'operation' : 'services';
          score = kind === 'services' ? 70 : 35;
        } else if (words.includes(t) || (e && ti.includes(e))) {
          score = 30 - Math.min(20, Math.floor(ti.length / 8));
          if (ti.startsWith(t + ' ') || (e && ti.startsWith(e))) score += 12;
        } else continue;
      }
      if (meta.type === 'TR') score -= 35;
      if (row.spec === spec) score += 10;
      score -= Math.min(row.depth, 6) * 2;
      scored.push({ row, score, kind });
    }

    // group per spec; spec rank = best hit, with a small bonus for breadth
    const bySpec = new Map<string, typeof scored>();
    for (const s of scored) {
      const a = bySpec.get(s.row.spec) ?? [];
      a.push(s);
      bySpec.set(s.row.spec, a);
    }
    const groups = [...bySpec.entries()]
      .map(([sp, hits]) => {
        hits.sort((a, b) => b.score - a.score || a.row.ord - b.row.ord);
        const meta = this.db.specMap.get(sp)!;
        // a spec that covers the concept in many sections is a better home than one with a single mention
        const strong = hits.filter((h) => h.score >= Math.max(50, hits[0].score - 35)).length;
        const rank = hits[0].score + 9 * Math.log2(1 + strong) + Math.min(6, hits.length) + (CORE[sp] ?? 0) + (meta.available ? 0 : -50);
        return {
          rank,
          group: {
            spec: sp,
            title: meta.short_title,
            type: meta.type,
            stage: stageOf(sp, meta.type, meta.title),
            hits: hits.slice(0, 4).map((h) => ({ sid: h.row.sid, num: h.row.num, title: h.row.title, kind: h.kind })),
          },
        };
      })
      .sort((a, b) => b.rank - a.rank || a.group.spec.localeCompare(b.group.spec, 'en', { numeric: true }))
      .slice(0, 12)
      .map((g) => g.group);

    const result: TermResult = {
      term,
      expansion: exp?.text ?? (nfExp ? `${nfExp.text} (${nf}) service-based interface` : null),
      expansionFrom: exp?.from ?? nfExp?.from ?? null,
      related,
      groups,
    };
    if (this.resultCache.size > 2000) this.resultCache.clear();
    this.resultCache.set(key, result);
    return result;
  }

  private sections(ids: number[]): SectionRow[] {
    const out: SectionRow[] = [];
    for (let i = 0; i < ids.length; i += 900) {
      const chunk = ids.slice(i, i + 900);
      out.push(...this.db.sectionsByIds(chunk).values());
    }
    return out;
  }

  /** sections that cross-reference the given one */
  backlinks(spec: string, sid: string, limit = 60): { total: number; items: { spec: string; sid: string; num: string | null; title: string; specTitle: string }[] } {
    if (!this.hasTable('refs')) return { total: 0, items: [] };
    const s = this.db.section(spec, sid);
    if (!s) return { total: 0, items: [] };
    const total = (this.db.stmt(`SELECT count(*) n FROM refs WHERE to_id=?`).get(s.id) as { n: number }).n;
    if (!total) return { total, items: [] };
    const rows = this.db
      .stmt(
        `SELECT x.spec, x.sid, x.num, x.title FROM refs r JOIN sections x ON x.id=r.from_id WHERE r.to_id=?
         ORDER BY (x.spec = ?) DESC, x.spec, x.ord LIMIT ?`,
      )
      .all(s.id, spec, limit) as { spec: string; sid: string; num: string | null; title: string }[];
    return { total, items: rows.map((r) => ({ ...r, specTitle: this.db.specMap.get(r.spec)?.short_title ?? '' })) };
  }
}
