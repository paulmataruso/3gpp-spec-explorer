import fs from 'node:fs';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';

export interface SpecRow {
  spec: string;
  title: string;
  short_title: string;
  tsg: string;
  type: string;
  release: string;
  rel_num: number;
  series: string;
  section_count: number;
  available: number;
  latest_version: string | null;
  latest_date: string | null;
  /** 3GPP portal status ("Withdrawn", "Under change control" …), archive-only specs */
  status: string | null;
  /** "itecspec" (crawled) or "archive" (converted from the official archive only) */
  source: string | null;
}

export interface SectionRow {
  id: number;
  spec: string;
  sid: string;
  num: string | null;
  title: string;
  ord: number;
  depth: number;
  parent: string | null;
  child_count: number;
  chars: number;
}

export const unbr = (b: Uint8Array | null | undefined): string => (b ? zlib.brotliDecompressSync(b).toString('utf8') : '');

/**
 * Read-only DB wrapper. Watches the file and transparently re-opens it after the
 * builder atomically replaces it, so data can be refreshed without a restart.
 */
export class SpecDb {
  private db!: DatabaseSync;
  private mtime = 0;
  private stmts = new Map<string, StatementSync>();
  specs: SpecRow[] = [];
  specMap = new Map<string, SpecRow>();
  /** rowid ranges per spec (rows are inserted contiguously per spec) */
  ranges: { start: number; end: number; spec: string }[] = [];
  info: Record<string, unknown> = {};
  path: string;

  constructor(path: string) {
    this.path = path;
    this.open();
  }

  private open() {
    if (!fs.existsSync(this.path)) throw new Error(`Database not found at ${this.path}. Run "npm run build:db" first.`);
    const st = fs.statSync(this.path);
    const db = new DatabaseSync(this.path, { readOnly: true });
    db.exec('PRAGMA query_only = 1; PRAGMA cache_size = -65536; PRAGMA mmap_size = 268435456; PRAGMA temp_store = MEMORY;');
    const old = this.db;
    this.db = db;
    this.stmts.clear();
    this.mtime = st.mtimeMs;
    this.loadCaches();
    if (old) setTimeout(() => old.close(), 30_000); // let in-flight requests finish
  }

  /** cheap check called per request (stat is cached by the OS) */
  refreshIfChanged() {
    try {
      const st = fs.statSync(this.path);
      if (st.mtimeMs !== this.mtime) {
        console.log('[db] database file changed — reopening');
        this.open();
      }
    } catch {
      /* file temporarily missing during rename */
    }
  }

  private loadCaches() {
    const cols = new Set((this.db.prepare(`PRAGMA table_info(specs)`).all() as { name: string }[]).map((c) => c.name));
    const extra = cols.has('status') ? 'status,source' : 'NULL status,NULL source'; // databases built before archive-only specs
    this.specs = this.db
      .prepare(
        `SELECT spec,title,short_title,tsg,type,release,rel_num,series,section_count,available,latest_version,latest_date,${extra} FROM specs ORDER BY spec`,
      )
      .all() as unknown as SpecRow[];
    this.specs.sort((a, b) => a.spec.localeCompare(b.spec, 'en', { numeric: true }));
    this.specMap = new Map(this.specs.map((s) => [s.spec, s]));
    this.ranges = (
      this.db.prepare(`SELECT spec, min(id) start, max(id) end FROM sections GROUP BY spec ORDER BY start`).all() as unknown as {
        spec: string;
        start: number;
        end: number;
      }[]
    ).map((r) => ({ ...r }));
    const row = this.db.prepare(`SELECT value FROM meta WHERE key='info'`).get() as { value: string } | undefined;
    this.info = row ? JSON.parse(row.value) : {};
  }

  stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  specForRowid(id: number): string | undefined {
    const r = this.ranges;
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (id < r[mid].start) hi = mid - 1;
      else if (id > r[mid].end) lo = mid + 1;
      else return r[mid].spec;
    }
    return undefined;
  }

  tocBlob(spec: string): Uint8Array | undefined {
    const r = this.stmt(`SELECT toc FROM specs WHERE spec=?`).get(spec) as { toc: Uint8Array | null } | undefined;
    return r?.toc ?? undefined;
  }

  versions(spec: string): unknown[] {
    const r = this.stmt(`SELECT versions FROM specs WHERE spec=?`).get(spec) as { versions: string | null } | undefined;
    return r?.versions ? JSON.parse(r.versions) : [];
  }

  section(spec: string, sid: string): (SectionRow & { html: Uint8Array | null }) | undefined {
    return this.stmt(
      `SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars,html FROM sections WHERE spec=? AND sid=?`,
    ).get(spec, sid) as any;
  }

  sectionByOrd(spec: string, ord: number): SectionRow | undefined {
    return this.stmt(`SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars FROM sections WHERE spec=? AND ord=?`).get(
      spec,
      ord,
    ) as any;
  }

  /** next/previous section that actually has content (skips empty parent headings) */
  neighbour(spec: string, ord: number, dir: 1 | -1): SectionRow | undefined {
    return (
      dir === 1
        ? this.stmt(`SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars FROM sections WHERE spec=? AND ord>? AND chars>0 ORDER BY ord LIMIT 1`)
        : this.stmt(`SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars FROM sections WHERE spec=? AND ord<? AND chars>0 ORDER BY ord DESC LIMIT 1`)
    ).get(spec, ord) as any;
  }

  children(spec: string, sid: string): SectionRow[] {
    return this.stmt(`SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars FROM sections WHERE spec=? AND parent=? ORDER BY ord`).all(
      spec,
      sid,
    ) as any;
  }

  /** the section and all its descendants in document order */
  subtree(spec: string, ord: number, depth: number, limit: number): (SectionRow & { html: Uint8Array | null })[] {
    return this.stmt(
      `SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars,html FROM sections
       WHERE spec=? AND ord>=? AND ord < coalesce((SELECT min(ord) FROM sections WHERE spec=? AND ord>? AND depth<=?), 1e12)
       ORDER BY ord LIMIT ?`,
    ).all(spec, ord, spec, ord, depth, limit) as any;
  }

  texts(ids: number[]): Map<number, string> {
    const out = new Map<number, string>();
    if (!ids.length) return out;
    const rows = this.db.prepare(`SELECT id, text FROM sections WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as {
      id: number;
      text: Uint8Array | null;
    }[];
    for (const r of rows) out.set(r.id, unbr(r.text));
    return out;
  }

  sectionsByIds(ids: number[]): Map<number, SectionRow> {
    const out = new Map<number, SectionRow>();
    if (!ids.length) return out;
    const rows = this.db
      .prepare(`SELECT id,spec,sid,num,title,ord,depth,parent,child_count,chars FROM sections WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as unknown as SectionRow[];
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  raw(): DatabaseSync {
    return this.db;
  }
}
