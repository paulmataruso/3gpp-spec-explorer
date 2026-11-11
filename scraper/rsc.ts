/**
 * Minimal React Server Components "flight" payload parser.
 *
 * A flight payload is a sequence of rows: `<hexId>:<tag?><payload>`.
 *  - JSON rows end with "\n"
 *  - `T<hexByteLen>,<text>` rows carry raw UTF-8 text of an exact byte length (no trailing newline)
 *  - `I[...]` rows are client-module references, `HL[...]` are resource hints, etc.
 *
 * We resolve "$"-prefixed references so callers get a plain, fully materialised tree.
 */

export interface ClientRef {
  $client: string; // export name (e.g. "TocSidebar") or module id
  module: string;
}

export type RNode = string | number | boolean | null | undefined | RElement | ClientRef | RNode[] | { [k: string]: RNode };

export interface RElement {
  $el: true;
  type: string | ClientRef; // html tag or client component
  props: Record<string, RNode>;
}

export function isElement(v: unknown): v is RElement {
  return typeof v === 'object' && v !== null && (v as RElement).$el === true;
}

interface RawRow {
  tag: string; // '' for JSON, 'T', 'I', 'HL', ...
  value: unknown;
}

export class FlightPayload {
  rows = new Map<string, RawRow>();
  private cache = new Map<string, RNode>();
  private resolving = new Set<string>();

  constructor(buf: Buffer) {
    this.parse(buf);
  }

  private parse(buf: Buffer) {
    let p = 0;
    const n = buf.length;
    while (p < n) {
      // skip stray newlines
      while (p < n && (buf[p] === 0x0a || buf[p] === 0x0d)) p++;
      if (p >= n) break;
      const colon = buf.indexOf(0x3a, p); // ':'
      if (colon < 0) break;
      const id = buf.toString('latin1', p, colon);
      p = colon + 1;
      // tag = run of uppercase letters
      let q = p;
      while (q < n && buf[q] >= 0x41 && buf[q] <= 0x5a) q++;
      const tag = buf.toString('latin1', p, q);
      if (tag === 'T') {
        const comma = buf.indexOf(0x2c, q);
        const len = parseInt(buf.toString('latin1', q, comma), 16);
        const start = comma + 1;
        const text = buf.toString('utf8', start, start + len);
        this.rows.set(id, { tag: 'T', value: text });
        p = start + len;
        continue;
      }
      let nl = buf.indexOf(0x0a, q);
      if (nl < 0) nl = n;
      const body = buf.toString('utf8', q, nl);
      p = nl + 1;
      let value: unknown = body;
      try {
        value = JSON.parse(body);
      } catch {
        /* keep raw */
      }
      this.rows.set(id, { tag, value });
    }
  }

  /** Resolve a row id into a materialised tree. */
  get(id: string): RNode {
    if (this.cache.has(id)) return this.cache.get(id);
    const row = this.rows.get(id);
    if (!row) return undefined;
    if (this.resolving.has(id)) return undefined; // cycle guard
    this.resolving.add(id);
    let out: RNode;
    if (row.tag === 'T') out = row.value as string;
    else if (row.tag === 'I') {
      const v = row.value as [string | number, unknown, string];
      out = { $client: v[2] || String(v[0]), module: String(v[0]) };
    } else if (row.tag === '') out = this.resolve(row.value);
    else out = undefined;
    this.resolving.delete(id);
    this.cache.set(id, out);
    return out;
  }

  private resolveRefString(s: string): RNode {
    if (!s.startsWith('$')) return s;
    if (s.startsWith('$$')) return s.slice(1);
    if (s === '$undefined') return undefined;
    if (s.startsWith('$S')) return { $symbol: s.slice(2) } as unknown as RNode;
    if (s === '$NaN' || s === '$Infinity' || s === '$-Infinity' || s === '$-0') return null;
    let ref = s.slice(1);
    if (ref.startsWith('L') || ref.startsWith('@')) ref = ref.slice(1);
    if (/^[DnFTQWKBYRriX]/.test(ref) && !/^[0-9a-f]+(:|$)/.test(ref)) return undefined; // unsupported special refs
    const [rowId, ...path] = ref.split(':');
    if (!/^[0-9a-f]+$/.test(rowId)) return s;
    let v: RNode = this.get(rowId);
    for (const key of path) {
      if (v && typeof v === 'object') {
        if (isElement(v)) v = key === 'props' ? (v.props as RNode) : (v.props as Record<string, RNode>)[key];
        else v = (v as Record<string, RNode>)[key];
      } else v = undefined;
    }
    return v;
  }

  resolve(v: unknown): RNode {
    if (typeof v === 'string') return this.resolveRefString(v);
    if (Array.isArray(v)) {
      if (v.length >= 4 && v[0] === '$' && (typeof v[1] === 'string' || v[1] === null)) {
        // React element: ["$", type, key, props]
        const rawType = v[1] as string;
        let type: string | ClientRef;
        if (rawType.startsWith('$')) {
          const t = this.resolveRefString(rawType);
          if (t && typeof t === 'object' && '$client' in (t as object)) type = t as ClientRef;
          else if (t && typeof t === 'object' && '$symbol' in (t as object)) type = '#fragment';
          else type = String(rawType);
        } else type = rawType;
        const props = (this.resolve(v[3]) ?? {}) as Record<string, RNode>;
        return { $el: true, type, props };
      }
      return v.map((x) => this.resolve(x));
    }
    if (v && typeof v === 'object') {
      const o: Record<string, RNode> = {};
      for (const [k, x] of Object.entries(v)) o[k] = this.resolve(x);
      return o;
    }
    return v as RNode;
  }

  /** Root rows that are JSON trees (excluding module refs/hints) */
  modelRowIds(): string[] {
    return [...this.rows.entries()].filter(([, r]) => r.tag === '').map(([id]) => id);
  }
}

/** Depth-first search for the first element matching a predicate. */
export function findElement(node: RNode, pred: (el: RElement) => boolean, seen = new Set<object>()): RElement | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (seen.has(node as object)) return undefined;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = findElement(c, pred, seen);
      if (r) return r;
    }
    return undefined;
  }
  if (isElement(node)) {
    if (pred(node)) return node;
    for (const v of Object.values(node.props)) {
      const r = findElement(v, pred, seen);
      if (r) return r;
    }
    return undefined;
  }
  for (const v of Object.values(node as Record<string, RNode>)) {
    const r = findElement(v, pred, seen);
    if (r) return r;
  }
  return undefined;
}

export function className(el: RElement): string {
  const c = el.props.className;
  return typeof c === 'string' ? c : '';
}

/**
 * Compact a resolved element tree for storage: [tag, attrs|0, ...children]
 * Strings stay strings. Client components become ["@Name", props-json].
 */
export type CNode = string | [string, Record<string, unknown> | 0, ...CNode[]];

export function compact(node: RNode): CNode[] {
  const out: CNode[] = [];
  const push = (n: RNode) => {
    if (n === null || n === undefined || n === false || n === true) return;
    if (typeof n === 'string') {
      if (n.length) out.push(n);
      return;
    }
    if (typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(push);
      return;
    }
    if (isElement(n)) {
      const { children, ...rest } = n.props;
      if (typeof n.type === 'object') {
        // client component: keep props verbatim (minus functions/elements), plus compacted children
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) if (v !== undefined) attrs[k] = v;
        out.push([`@${n.type.$client}`, attrs, ...compact(children)]);
        return;
      }
      if (n.type === '#fragment' || n.type.startsWith('$')) {
        push(children);
        return;
      }
      const attrs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined || v === null || k === 'key') continue;
        if (k === 'dangerouslySetInnerHTML') attrs.__html = (v as { __html: string }).__html;
        else attrs[k] = v;
      }
      out.push([n.type, Object.keys(attrs).length ? attrs : 0, ...compact(children)]);
      return;
    }
    if (typeof n === 'object' && '$client' in n) return;
  };
  push(node);
  return out;
}

/** Collect all elements matching a predicate (does not descend into matches). */
export function collectElements(node: RNode, pred: (el: RElement) => boolean, out: RElement[] = [], seen = new Set<object>()): RElement[] {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (seen.has(node as object)) return out;
  seen.add(node as object);
  if (Array.isArray(node)) {
    for (const c of node) collectElements(c, pred, out, seen);
    return out;
  }
  if (isElement(node)) {
    if (pred(node)) {
      out.push(node);
      return out;
    }
    for (const v of Object.values(node.props)) collectElements(v, pred, out, seen);
    return out;
  }
  for (const v of Object.values(node as Record<string, RNode>)) collectElements(v, pred, out, seen);
  return out;
}
