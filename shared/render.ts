/**
 * Converts the compact content tree captured by the crawler into clean, semantic,
 * framework-free HTML (plus a plain-text projection used for full-text indexing).
 *
 * Output classes (styled by the web component):
 *   p.cap      figure / table caption        p.ctr  centred paragraph
 *   p.note     NOTE / EXAMPLE indented block span.tab  tab stop
 *   pre.asn1   ASN.1 module block            a.xref cross reference (data-spec / data-sec)
 *   div.tbl    scroll wrapper for tables     figure.fig  figure with lazy image
 *   td.ctr / td.rgt  cell alignment
 */

import { fixPuaHtml, fixPuaText } from './pua.ts';

export type CNode = string | [string, Record<string, any> | 0, ...CNode[]];

export interface RenderContext {
  spec: string;
  /** does the given spec exist in the catalog? */
  hasSpec: (spec: string) => boolean;
  /** does the section exist in the given spec? (ids are lower-case) */
  hasSection: (spec: string, id: string) => boolean;
  /** URL prefix for images, e.g. "api/images/38.300/" */
  imageUrl: (src: string) => string;
}

export interface RenderResult {
  html: string;
  text: string;
  unknown: string[]; // unknown tags/classes (diagnostics)
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

function textOf(n: CNode): string {
  if (typeof n === 'string') return n;
  const [, attrs, ...ch] = n;
  if (attrs && typeof attrs === 'object' && typeof attrs.__html === 'string') return '';
  return ch.map(textOf).join('');
}

function cls(attrs: Record<string, any> | 0): string[] {
  return attrs && typeof attrs.className === 'string' ? attrs.className.split(/\s+/).filter(Boolean) : [];
}

/** strip anything executable from trusted-ish KaTeX HTML */
function sanitizeHtml(h: string): string {
  return h
    .replace(/<\s*(script|iframe|object|embed|style|link|meta)[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

const SPEC_RE = /^(?:3GPP\s+)?T[SR]\s+(\d{2}\.\d{3}(?:-\d+)*)$/i;
const SPEC_INLINE_RE = /\b(3GPP\s+)?(T[SR])\s+(\d{2}\.\d{3}(?:-\d{1,2})*)\b/g;
/** "clause 4.3.2 of TS 23.502": the spec named right after a clause reference wins */
const CLAUSE_OF_RE = /^[\s\u00a0]*(?:of|in)[\s\u00a0]+(?:the[\s\u00a0]+)?(?:3GPP[\s\u00a0]+)?T[SR][\s\u00a0]+(\d{2}\.\d{3}(?:-\d{1,2})*)/;
const CLAUSE_OF_GAP_RE = /^[\s\u00a0]*(?:of|in)[\s\u00a0]+(?:the[\s\u00a0]+)?$/;
const CLAUSE_RE = /^(?:sub)?clauses?\s+([A-Z]?\d+(?:\.\d+[a-zA-Z]?)*[a-zA-Z]?|[A-Z](?:\.\d+[a-zA-Z]?)*)\.?$/i;

export function renderSection(nodes: CNode[], ctx: RenderContext): RenderResult {
  const unknown = new Set<string>();
  const textParts: string[] = [];

  /* ---------- ASN.1 grouping (top-level paragraphs between ASN1START / ASN1STOP) ---------- */
  const blocks: (CNode | { asn1: string[] })[] = [];
  let asn: string[] | null = null;
  for (const n of nodes) {
    const t = textOf(n);
    const isP = typeof n !== 'string' && n[0] === 'p';
    if (asn) {
      if (isP) {
        asn.push(t);
        if (/^\s*--\s*ASN1STOP/.test(t)) {
          blocks.push({ asn1: asn });
          asn = null;
        }
        continue;
      }
      blocks.push({ asn1: asn });
      asn = null;
    }
    if (isP && /^\s*--\s*ASN1START/.test(t)) {
      asn = [t];
      continue;
    }
    blocks.push(n);
  }
  if (asn) blocks.push({ asn1: asn });

  /* ---------- inline rendering with cross-reference detection ---------- */
  // lastSpec tracks the most recent "TS xx.yyy" in the current block so "clause 5.3" links to it
  let lastSpec: { spec: string; at: number } | null = null;
  let charPos = 0;

  function linkSpecsInText(s: string): string {
    let out = '';
    let last = 0;
    SPEC_INLINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPEC_INLINE_RE.exec(s))) {
      const spec = m[3];
      if (!ctx.hasSpec(spec)) continue;
      out += esc(s.slice(last, m.index));
      out += `<a class="xref" data-spec="${esc(spec)}">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
      lastSpec = { spec, at: charPos + m.index };
    }
    out += esc(s.slice(last));
    return out;
  }

  function renderText(s: string): string {
    const html = linkSpecsInText(s).replace(/\t/g, '<span class="tab"></span>');
    textParts.push(s);
    charPos += s.length;
    return html;
  }

  function renderXref(children: CNode[], following: CNode | undefined, following2?: CNode): string {
    const t = children.map(textOf).join('');
    textParts.push(t);
    const start = charPos;
    charPos += t.length;
    let m = SPEC_RE.exec(t.trim());
    if (m) {
      let spec = m[1];
      // "TS 38.101" followed by text "-1 [15]" => 38.101-1
      if (typeof following === 'string') {
        const suf = /^(-\d{1,2})\b/.exec(following);
        if (suf && ctx.hasSpec(spec + suf[1])) spec += suf[1];
      }
      if (ctx.hasSpec(spec)) {
        lastSpec = { spec, at: start };
        return `<a class="xref" data-spec="${esc(spec)}">${esc(t)}</a>`;
      }
      return `<span class="ref">${esc(t)}</span>`;
    }
    m = CLAUSE_RE.exec(t.trim());
    if (m) {
      const id = m[1].toLowerCase();
      let target = lastSpec && start - lastSpec.at < 80 ? lastSpec.spec : ctx.spec;
      // forward form: "clause 4.3.2 of TS 23.502" (plain text, or " of " + a spec reference)
      const fwd =
        typeof following === 'string'
          ? (CLAUSE_OF_RE.exec(following)?.[1] ??
            (CLAUSE_OF_GAP_RE.test(following) && following2 !== undefined && typeof following2 !== 'string' ? SPEC_RE.exec(textOf(following2).trim())?.[1] : undefined))
          : undefined;
      if (fwd) target = fwd;
      if (ctx.hasSection(target, id)) {
        return `<a class="xref" data-spec="${esc(target)}" data-sec="${esc(id)}">${esc(t)}</a>`;
      }
    }
    return `<span class="ref">${esc(t)}</span>`;
  }

  function attrsFor(tag: string, a: Record<string, any> | 0): string {
    if (!a) return '';
    let s = '';
    const c = cls(a);
    if (tag === 'td' || tag === 'th') {
      if (a.colSpan && Number(a.colSpan) > 1) s += ` colspan="${Number(a.colSpan)}"`;
      if (a.rowSpan && Number(a.rowSpan) > 1) s += ` rowspan="${Number(a.rowSpan)}"`;
      if (c.includes('text-center')) s += ' class="ctr"';
      else if (c.includes('text-right')) s += ' class="rgt"';
      if (a.style && typeof a.style === 'object' && a.style.backgroundColor) s += ` style="background:${esc(String(a.style.backgroundColor))}"`;
    }
    return s;
  }

  function render(n: CNode, next?: CNode, next2?: CNode): string {
    if (typeof n === 'string') return renderText(n);
    const [tag, a, ...ch] = n;
    if (a && typeof a.__html === 'string') {
      // pre-rendered KaTeX math
      const tex = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/.exec(a.__html);
      if (tex) textParts.push(' ' + tex[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') + ' ');
      return sanitizeHtml(a.__html);
    }
    const kids = () => ch.map((c, i) => render(c, ch[i + 1], ch[i + 2])).join('');
    const c = cls(a);
    switch (tag) {
      case 'p': {
        textParts.push('\n');
        lastSpec = null;
        const t = ch.map(textOf).join('').trim();
        // itecspec flattens the 3GPP paragraph styles; recover them from the layout classes
        const tab = ch.findIndex((x) => typeof x !== 'string' && x[0] === 'span' && cls(x[1]).includes('inline-block'));
        const head = tab > 0 ? ch.slice(0, tab).map(textOf).join('').trim() : '';
        const isDef = tab > 0 && head.length > 0 && head.length <= 40;
        let k = '';
        if (c.includes('border-l-2')) {
          if (/^(NOTE|EXAMPLE|Editor)/i.test(t)) k = 'note';
          else if (/^\[[^\]]{1,12}\]/.test(t)) k = 'ex'; // reference list "[1]<tab>…"
          else k = isDef ? 'def' : 'ind';
        } else if (c.includes('text-center')) k = /^(Figure|Table)\s/i.test(t) ? 'cap' : isDef ? 'def' : 'ctr';
        else if (c.includes('text-right')) k = 'rgt';
        if (k === 'def') {
          // "TERM<tab>description" (abbreviations, interface lists, definitions)
          const dt = ch.slice(0, tab).map((x, i) => render(x, ch[i + 1], ch[i + 2])).join('');
          textParts.push(' ');
          const rest = ch.slice(tab + 1);
          const dd = rest.map((x, i) => render(x, rest[i + 1], rest[i + 2])).join('');
          return `<p class="def"><span class="dt">${dt}</span><span class="dd">${dd}</span></p>`;
        }
        const body = kids();
        if (!body.trim()) return '';
        return `<p${k ? ` class="${k}"` : ''}>${body}</p>`;
      }
      case 'span': {
        if (c.includes('inline-block')) {
          textParts.push(' ');
          return '<span class="tab"></span>';
        }
        if (c.includes('text-gray-800') || c.length) return renderXref(ch, next, next2);
        return kids();
      }
      case 'div': {
        if (c.includes('not-prose')) return ''; // subsection index (we generate our own)
        if (c.includes('overflow-x-auto')) return `<div class="tbl">${kids()}</div>`;
        if (c.length) unknown.add('div.' + c.join('.'));
        return `<div>${kids()}</div>`;
      }
      case 'table':
        return `<table>${kids()}</table>`;
      case 'thead':
      case 'tbody':
      case 'tfoot':
        return `<${tag}>${kids()}</${tag}>`;
      case 'tr':
        textParts.push('\n');
        return `<tr>${kids()}</tr>`;
      case 'td':
      case 'th':
        textParts.push(' ');
        return `<${tag}${attrsFor(tag, a)}>${kids()}</${tag}>`;
      case 'ul':
      case 'ol':
        return `<${tag}>${kids()}</${tag}>`;
      case 'li':
        textParts.push('\n');
        return `<li>${kids()}</li>`;
      case 'strong':
      case 'b':
        return `<strong>${kids()}</strong>`;
      case 'em':
      case 'i':
        return `<em>${kids()}</em>`;
      case 'sub':
      case 'sup':
      case 'u':
      case 's':
      case 'code':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'blockquote':
      case 'caption':
      case 'colgroup':
      case 'col':
        return `<${tag}>${kids()}</${tag}>`;
      case 'pre':
        return `<pre>${kids()}</pre>`;
      case 'br':
        textParts.push('\n');
        return '<br>';
      case 'hr':
        return '<hr>';
      case 'img': {
        const src = a ? String(a.src ?? '') : '';
        return src ? `<img data-src="${esc(ctx.imageUrl(src))}" alt="${esc(String((a && a.alt) || ''))}" loading="lazy">` : '';
      }
      case 'a': {
        const href = a ? String(a.href ?? '') : '';
        if (/^https?:\/\//.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${kids()}</a>`;
        return kids();
      }
      case '@Figure': {
        const b = (a && a.block) || {};
        const src = String(b.src ?? '');
        if (!src) return '';
        const w = Number(b.width) || 0;
        const h = Number(b.height) || 0;
        const dims = w && h ? ` width="${w}" height="${h}" style="aspect-ratio:${w}/${h}"` : '';
        return `<figure class="fig"><img data-src="${esc(ctx.imageUrl(src))}" alt="${esc(String(b.alt || 'Figure'))}"${dims} loading="lazy" decoding="async"></figure>`;
      }
      default: {
        if (tag.startsWith('@')) {
          unknown.add(tag);
          return kids();
        }
        unknown.add(tag);
        return kids();
      }
    }
  }

  let html = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (typeof b === 'object' && !Array.isArray(b) && 'asn1' in b) {
      textParts.push('\n' + b.asn1.join('\n') + '\n');
      html += `<pre class="asn1"><code>${esc(b.asn1.join('\n'))}</code></pre>`;
      continue;
    }
    const n = b as CNode;
    html += render(n, blocks[i + 1] as CNode);
  }
  const text = textParts
    .join('')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  // symbol-font characters itecspec passes on as private-use code points (shared/pua.ts)
  return { html: fixPuaHtml(html), text: fixPuaText(text), unknown: [...unknown] };
}

/** Plain-text projection of already-clean HTML (used for content converted from official .docx files). */
export function htmlToText(html: string): string {
  return html
    .replace(/<span class="katex">[\s\S]*?<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>[\s\S]*?<\/span><\/span><\/span>/g, ' $1 ')
    .replace(/<(br|\/p|\/li|\/tr|\/h\d|\/pre|\/div)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<span class="(?:tab|dd)">/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/* ------------------------------------------------------------------------------------------------
 * Content converted from the official .docx files (scraper/docx/split.lua) arrives as pandoc HTML
 * with a few markers; bring it in line with renderSection's output.
 * ---------------------------------------------------------------------------------------------- */

const unescHtml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const TEX_SPAN_RE = /<span class="tex" data-display="([01])">([\s\S]*?)<\/span>/g;
const CLAUSE_INLINE_RE = /\b((?:sub)?clauses?|section)\s+([A-Z]?\d+(?:\.\d+[a-zA-Z]?)*[a-zA-Z]?|[A-Z](?:\.\d+[a-zA-Z]?)+)\b/gi;
const NO_LINK_TAGS = new Set(['a', 'pre', 'code', 'h1', 'h2', 'h3']);

/** add a.xref links for "TS 36.331" and "clause 5.3.5" mentions in plain-text runs of an HTML string */
function linkRefsInHtml(html: string, ctx: RenderContext): string {
  let skip = 0;
  let texDepth = 0;
  let lastSpec: { spec: string; at: number } | null = null;
  let pos = 0;
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(part);
        if (m) {
          const tag = m[2].toLowerCase();
          if (part.startsWith('<span class="tex"')) texDepth++;
          else if (texDepth && tag === 'span' && m[1]) texDepth--;
          if (NO_LINK_TAGS.has(tag)) skip += m[1] ? -1 : 1;
          if (tag === 'p' || tag === 'td' || tag === 'li') lastSpec = null;
        }
        return part;
      }
      if (!part || skip > 0 || texDepth > 0) {
        pos += part.length;
        return part;
      }
      // one pass over both patterns, left to right
      const hits: { at: number; len: number; html: string }[] = [];
      SPEC_INLINE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SPEC_INLINE_RE.exec(part))) {
        if (ctx.hasSpec(m[3])) hits.push({ at: m.index, len: m[0].length, html: `<a class="xref" data-spec="${m[3]}">${m[0]}</a>` });
      }
      CLAUSE_INLINE_RE.lastIndex = 0;
      while ((m = CLAUSE_INLINE_RE.exec(part))) {
        const at = m.index;
        // the closest preceding spec mention within ~80 chars decides the target spec
        const before = hits.filter((h) => h.at < at && h.html.includes('data-spec')).pop();
        let target = ctx.spec;
        const fwd = CLAUSE_OF_RE.exec(part.slice(at + m[0].length))?.[1];
        if (fwd) target = fwd;
        else if (before && at - before.at < 80) target = /data-spec="([^"]+)"/.exec(before.html)![1];
        else if (lastSpec && pos + at - lastSpec.at < 80) target = lastSpec.spec;
        const id = m[2].toLowerCase();
        if (ctx.hasSection(target, id)) {
          hits.push({ at, len: m[0].length, html: `<a class="xref" data-spec="${esc(target)}" data-sec="${esc(id)}">${m[0]}</a>` });
        }
      }
      hits.sort((a, b) => a.at - b.at);
      let out = '';
      let last = 0;
      for (const h of hits) {
        if (h.at < last) continue;
        out += part.slice(last, h.at) + h.html;
        last = h.at + h.len;
        const sm = /data-spec="([^"]+)"(?! data-sec)/.exec(h.html);
        if (sm) lastSpec = { spec: sm[1], at: pos + h.at };
      }
      out += part.slice(last);
      pos += part.length;
      return out;
    })
    .join('');
}

let katexMod: { renderToString: (tex: string, opts: Record<string, unknown>) => string } | null = null;
/** build scripts call this once before finishDocxHtml so math can be rendered server-side */
export async function loadKatex() {
  katexMod ??= ((await import('katex')) as any).default;
}

/** normalise HTML from the docx pipeline; returns final HTML + text for indexing */
export function finishDocxHtml(src: string, ctx: RenderContext): { html: string; text: string } {
  let h = fixPuaHtml(src)
    // <div class="p-note"><p>..</p></div> -> <p class="note">..</p>
    .replace(/<div class="((?:p-[\w-]+ ?)+)">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g, (_, c: string, inner: string) => `<p class="${c.replace(/p-/g, '').trim()}">${inner}</p>`)
    .replace(/<div class="((?:p-[\w-]+ ?)+)">/g, (_, c: string) => `<div class="${c.replace(/p-/g, '').trim()}">`)
    .replace(/<table\b[^>]*>/g, '<div class="tbl"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/<(td|th)\b([^>]*)>/g, (_, tag: string, attrs: string) => {
      // keep spans, turn pandoc's inline text-align into the reader's cell classes
      const keep = (attrs.match(/\s(?:colspan|rowspan)="\d+"/g) ?? []).join('');
      const align = /text-align:\s*(center|right)/.exec(attrs)?.[1];
      return `<${tag}${keep}${align ? ` class="${align === 'center' ? 'ctr' : 'rgt'}"` : ''}>`;
    })
    .replace(/<p>\s*<\/p>/g, '')
    // EW/EX "TERM<tab>description" rows (abbreviations, interface lists) -> definition rows
    .replace(/<p class="ex">((?:(?!<\/p>|<span class="tab">)[\s\S]){1,300}?)<span class="tab"><\/span>([\s\S]*?)<\/p>/g, (whole, dt: string, dd: string) => {
      const head = dt.replace(/<[^>]+>/g, '').trim();
      return head && head.length <= 40 && !head.startsWith('[') ? `<p class="def"><span class="dt">${dt}</span><span class="dd">${dd}</span></p>` : whole;
    });
  const text = htmlToText(h.replace(TEX_SPAN_RE, (_, _d, tex: string) => ` ${tex} `));
  h = linkRefsInHtml(h, ctx);
  h = h.replace(TEX_SPAN_RE, (whole, d: string, tex: string) => {
    if (!katexMod) return whole;
    try {
      return katexMod.renderToString(unescHtml(tex), { displayMode: d === '1', throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
    } catch {
      return `<code>${tex}</code>`;
    }
  });
  return { html: h, text };
}
