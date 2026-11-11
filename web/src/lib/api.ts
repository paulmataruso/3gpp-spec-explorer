/** Typed client for the Spec Explorer REST API with small in-memory caches. */

export interface SpecSummary {
  spec: string;
  title: string;
  tsg: string;
  type: 'TS' | 'TR';
  release: string;
  rel: number;
  series: string;
  sections: number;
  available: number;
  version: string | null;
  date: string | null;
  /** only on specs converted from the official 3GPP archive (not published on itecspec) */
  source?: 'archive';
  status?: string | null;
}

/** compact toc node: [id, number, title, flags(1=has content), children?] */
export type TocNode = [string, string, string, number, TocNode[]?];

export interface Version {
  release: string;
  version: string;
  date: string;
  size: string;
  url: string;
}

export interface SpecDetail {
  spec: string;
  title: string;
  short_title: string;
  tsg: string;
  type: 'TS' | 'TR';
  release: string;
  rel_num: number;
  series: string;
  section_count: number;
  available: number;
  latest_version: string | null;
  latest_date: string | null;
  /** 3GPP portal status of archive-only specs ("Withdrawn", "Under change control" …) */
  status?: string | null;
  /** "archive": converted from the official archive only; "itecspec": crawled */
  source?: string | null;
  versions: Version[];
  toc: TocNode[];
}

export interface SectionRef {
  sid: string;
  num: string | null;
  title: string;
}

export interface SectionDetail extends SectionRef {
  spec: string;
  specTitle: string;
  release: string;
  type: string;
  version: string | null;
  html: string;
  hasContent: boolean;
  parents: SectionRef[];
  children: (SectionRef & { hasContent: boolean; childCount: number })[];
  prev: SectionRef | null;
  next: SectionRef | null;
  parts?: (SectionRef & { depth: number; html: string })[];
  truncated?: boolean;
  /** sections (in any spec) that cross-reference this one */
  refBy?: { total: number; items: (SectionRef & { spec: string; specTitle: string })[] };
}

export interface TermHit extends SectionRef {
  kind: 'definition' | 'services' | 'operation' | 'section';
}

export interface TermResult {
  term: string;
  expansion: string | null;
  expansionFrom: string | null;
  related: string[];
  groups: { spec: string; title: string; type: 'TS' | 'TR'; stage: string; hits: TermHit[] }[];
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

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  took: number;
  direct?: { spec: string; sid?: string };
  error?: string;
  query: { spec?: string; series?: string; rel?: number; type?: string; terms: string[] };
}

export interface Facets {
  specs: { key: string; count: number; title: string }[];
  series: { key: string; count: number }[];
  releases: { key: string; count: number }[];
  types: { key: string; count: number }[];
  took: number;
}

export interface Suggestions {
  specs: { spec: string; title: string; type: string; release: string }[];
  sections: { spec: string; sid: string; num: string | null; title: string; specTitle: string }[];
}

export interface Info {
  builtAt: string;
  specs: number;
  specsWithContent: number;
  sections: number;
  releases: { release: string; rel_num: number; n: number }[];
  series: { key: string; name: string; count: number }[];
}

export interface SearchParams {
  q: string;
  spec?: string;
  series?: string;
  rel?: number;
  type?: string;
  offset?: number;
  limit?: number;
  in?: 'title';
}

class Lru<V> {
  private m = new Map<string, V>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(k: string) {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}

export class ApiClient {
  readonly base: string;
  private specsP?: Promise<SpecSummary[]>;
  private infoP?: Promise<Info>;
  private specCache = new Lru<Promise<SpecDetail>>(24);
  private sectionCache = new Lru<Promise<SectionDetail>>(120);
  private termsCache = new Lru<Promise<[string, string][]>>(16);
  private termCache = new Lru<Promise<TermResult>>(200);

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.base + path, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* ignore */
      }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.json() as Promise<T>;
  }

  imageUrl(src: string) {
    return `${this.base}/images/${src}`;
  }

  info() {
    return (this.infoP ??= this.get<Info>('/info').catch((e) => {
      this.infoP = undefined;
      throw e;
    }));
  }

  specs() {
    return (this.specsP ??= this.get<SpecSummary[]>('/specs').catch((e) => {
      this.specsP = undefined;
      throw e;
    }));
  }

  spec(spec: string) {
    let p = this.specCache.get(spec);
    if (!p) {
      p = this.get<SpecDetail>(`/specs/${encodeURIComponent(spec)}`);
      p.catch(() => this.specCache.set(spec, undefined as never));
      this.specCache.set(spec, p);
    }
    return p;
  }

  section(spec: string, sid: string, deep = false) {
    const key = `${spec}/${sid}${deep ? '?deep' : ''}`;
    let p = this.sectionCache.get(key);
    if (!p) {
      p = this.get<SectionDetail>(`/specs/${encodeURIComponent(spec)}/sections/${encodeURIComponent(sid)}${deep ? '?deep=1' : ''}`);
      this.sectionCache.set(key, p);
      p.catch(() => this.sectionCache.set(key, undefined as never));
    }
    return p;
  }

  private qs(p: SearchParams) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== null) u.set(k, String(v));
    return u.toString();
  }

  search(p: SearchParams, signal?: AbortSignal) {
    return this.get<SearchResult>(`/search?${this.qs(p)}`, signal);
  }

  facets(p: SearchParams, signal?: AbortSignal) {
    return this.get<Facets>(`/search/facets?${this.qs(p)}`, signal);
  }

  /** abbreviations defined for a spec (its own list + the 3GPP vocabulary) */
  terms(spec: string) {
    let p = this.termsCache.get(spec);
    if (!p) {
      p = this.get<{ abbr: [string, string][] }>(`/terms/${encodeURIComponent(spec)}`).then((r) => r.abbr);
      p.catch(() => this.termsCache.set(spec, undefined as never));
      this.termsCache.set(spec, p);
    }
    return p;
  }

  /** where a term is described, grouped per specification */
  term(term: string, spec?: string) {
    const key = `${spec ?? ''}|${term}`;
    let p = this.termCache.get(key);
    if (!p) {
      p = this.get<TermResult>(`/term?t=${encodeURIComponent(term)}${spec ? `&spec=${encodeURIComponent(spec)}` : ''}`);
      p.catch(() => this.termCache.set(key, undefined as never));
      this.termCache.set(key, p);
    }
    return p;
  }

  suggest(q: string, signal?: AbortSignal) {
    return this.get<Suggestions>(`/suggest?q=${encodeURIComponent(q)}`, signal);
  }
}
