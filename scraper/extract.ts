import { FlightPayload, findElement, collectElements, className, compact, isElement } from './rsc.ts';
import type { RNode, RElement, CNode } from './rsc.ts';

export interface CatalogEntry {
  spec: string;
  title: string;
  type: string; // TS | TR
  release: string; // rel-19
}

export interface TocNode {
  id: string; // url id (lower-case)
  number: string | null; // display number e.g. 5.3.4.2A
  title: string;
  children: TocNode[];
}

export interface ArchiveVersion {
  release: string; // Rel-18 / Ph2 ...
  version: string;
  date: string;
  size: string;
  url: string;
}

export function textOf(n: RNode): string {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string') return n;
  if (typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isElement(n)) return textOf(n.props.children);
  return '';
}

function childrenArray(el: RElement): RNode[] {
  const c = el.props.children;
  return Array.isArray(c) ? c : [c];
}

function hrefOf(el: RElement): string | undefined {
  return typeof el.props.href === 'string' ? el.props.href : undefined;
}

/* ---------------- catalog ---------------- */

export function extractCatalog(fp: FlightPayload): CatalogEntry[] {
  for (const id of fp.modelRowIds()) {
    const raw = fp.rows.get(id)!.value;
    if (Array.isArray(raw) && raw[0] === '$' && raw[3] && typeof raw[3] === 'object' && Array.isArray((raw[3] as any).specs)) {
      return ((raw[3] as any).specs as { s: string; t: string; y: string; r: string }[]).map((x) => ({
        spec: x.s,
        title: x.t,
        type: x.y,
        release: x.r,
      }));
    }
  }
  throw new Error('catalog row not found');
}

/* ---------------- spec TOC ---------------- */

function parseLi(li: RElement, specPath: string): TocNode | undefined {
  const link = findElement(li.props.children, (el) => (hrefOf(el) ?? '').startsWith(specPath + '/s/'));
  if (!link) return undefined;
  const href = hrefOf(link)!;
  const id = decodeURIComponent(href.slice(specPath.length + 3));
  const spans = childrenArray(link).filter(isElement);
  let number: string | null = null;
  let title = '';
  if (spans.length >= 2) {
    number = textOf(spans[0]).trim() || null;
    title = textOf(spans[1]).trim();
  } else title = textOf(link).trim();
  const node: TocNode = { id, number, title, children: [] };
  // nested list lives in the li's later children
  const rest = childrenArray(li).slice(1);
  const ul = findElement(rest, (el) => el.type === 'ul');
  if (ul) node.children = parseUl(ul, specPath);
  return node;
}

function parseUl(ul: RElement, specPath: string): TocNode[] {
  const out: TocNode[] = [];
  for (const c of childrenArray(ul).flat(4) as RNode[]) {
    if (isElement(c) && c.type === 'li') {
      const n = parseLi(c, specPath);
      if (n) out.push(n);
    }
  }
  return out;
}

export function extractToc(fp: FlightPayload, rel: string, spec: string): TocNode[] {
  const specPath = `/3gpp/${rel}/${spec}`;
  const root = fp.get('0');
  // find the outer-most ul containing TOC links
  const ul = findElement(
    root,
    (el) =>
      el.type === 'ul' &&
      !!findElement(el.props.children, (x) => (hrefOf(x) ?? '').startsWith(specPath + '/s/')),
  );
  if (!ul) return [];
  return parseUl(ul, specPath);
}

/* ---------------- archive ---------------- */

export function extractArchive(fp: FlightPayload): ArchiveVersion[] {
  const out: ArchiveVersion[] = [];
  const sections = collectElements(fp.get('0'), (el) => el.type === 'section');
  for (const sec of sections) {
    const h2 = findElement(sec.props.children, (el) => el.type === 'h2');
    const release = h2 ? textOf(h2).trim() : '';
    for (const tr of collectElements(sec.props.children, (el) => el.type === 'tr')) {
      const tds = childrenArray(tr).filter((x): x is RElement => isElement(x) && x.type === 'td');
      if (tds.length < 4) continue;
      const a = findElement(tds[3].props.children, (el) => el.type === 'a');
      out.push({
        release,
        version: textOf(tds[0]).trim(),
        date: textOf(tds[1]).trim(),
        size: textOf(tds[2]).trim(),
        url: a ? String(a.props.href ?? '') : '',
      });
    }
  }
  return out;
}

/* ---------------- section content ---------------- */

export interface SectionContent {
  heading: string;
  content: CNode[];
  figures: string[];
  components: string[];
}

export function extractSection(fp: FlightPayload): SectionContent | undefined {
  // The page segment is row "4" in practice, but search all model rows to be safe.
  const root = fp.get('0');
  const main = findElement(root, (el) => el.type === 'main' && el.props.id === 'main-content');
  if (!main) return undefined;
  const h1 = findElement(main.props.children, (el) => el.type === 'h1');
  const prose = findElement(main.props.children, (el) => className(el).split(/\s+/).includes('prose'));
  if (!prose) return { heading: h1 ? textOf(h1) : '', content: [], figures: [], components: [] };
  // unwrap context providers (client components that only pass children through)
  const unwrap = (nodes: RNode[]): RNode[] =>
    nodes.flatMap((k) => {
      if (Array.isArray(k)) return unwrap(k);
      if (isElement(k) && typeof k.type === 'object' && /Provider$/.test(k.type.$client)) return unwrap(childrenArray(k));
      return [k];
    });
  const kids = unwrap(childrenArray(prose)).filter((k) => {
    if (isElement(k) && k.type === 'div' && className(k).includes('not-prose')) {
      const t = textOf(k);
      if (t.startsWith('This section contains the following subsections')) return false;
    }
    return true;
  });
  const content = compact(kids);
  const figures: string[] = [];
  const components = new Set<string>();
  const walk = (n: CNode) => {
    if (typeof n === 'string') return;
    const [tag, attrs, ...ch] = n;
    if (tag.startsWith('@')) {
      components.add(tag);
      const block = attrs && (attrs as any).block;
      if (block && typeof block === 'object' && typeof block.src === 'string') figures.push(block.src);
    }
    ch.forEach(walk);
  };
  content.forEach(walk);
  return { heading: h1 ? textOf(h1) : '', content, figures, components: [...components] };
}
