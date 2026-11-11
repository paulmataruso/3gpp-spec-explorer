import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { tokens, base } from '../styles/tokens.ts';
import { content } from '../styles/content.ts';
import { katexStyles } from '../styles/katex.ts';
import { icon } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import type { SpecDetail, SectionDetail, TocNode, TermResult } from '../lib/api.ts';
import { matcherFor, linkTerms } from '../lib/terms.ts';
import { store, onStoreChange } from '../lib/store.ts';
import { fmtNum, fmtDate, citation, highlightAsn1, highlightYaml, SERIES, releaseName } from '../lib/format.ts';
import '../components/toc.ts';

/** Spec overview + section reader sharing one persistent TOC sidebar. */
export class SeReader extends LitElement {
  static properties = {
    ctx: { attribute: false },
    spec: {},
    sid: {},
    detail: { state: true },
    section: { state: true },
    error: { state: true },
    loading: { state: true },
    tocOpen: { state: true },
    drawer: { state: true },
    allVersions: { state: true },
    deep: { state: true },
    zoom: { state: true },
    term: { state: true },
  };
  declare ctx: Ctx;
  declare spec: string;
  declare sid: string | undefined;
  declare detail: SpecDetail | null;
  declare section: SectionDetail | null;
  declare error: string;
  declare loading: boolean;
  declare tocOpen: boolean;
  declare drawer: boolean;
  declare allVersions: boolean;
  declare deep: boolean;
  declare zoom: string | null;
  /** open concept card */
  declare term: { t: string; x: number; y: number; up: boolean; h: number; data: TermResult | null; err?: string; el: HTMLElement } | null;
  private unsub?: () => void;
  private reqId = 0;

  constructor() {
    super();
    this.detail = null;
    this.section = null;
    this.error = '';
    this.loading = false;
    this.tocOpen = store.tocOpen;
    this.drawer = false;
    this.allVersions = false;
    this.deep = false;
    this.zoom = null;
    this.term = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.unsub = onStoreChange(() => this.requestUpdate());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onOutside, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onOutside, true);
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.term) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLElement && (n.classList.contains('termcard') || n === this.term!.el))) return;
    this.term = null;
  };

  private closeTerm(restore = false) {
    const el = this.term?.el;
    this.term = null;
    if (restore) el?.focus();
  }

  private onKey = (e: KeyboardEvent) => {
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && this.zoom) {
      this.zoom = null;
      return;
    }
    if (e.key === 'Escape' && this.term) {
      this.closeTerm(true);
      return;
    }
    if (!this.section) return;
    if (e.key === ']' && this.section.next) this.ctx.go('read', { spec: this.spec, sid: this.section.next.sid });
    else if (e.key === '[' && this.section.prev) this.ctx.go('read', { spec: this.spec, sid: this.section.prev.sid });
  };

  protected willUpdate(ch: PropertyValues) {
    if (ch.has('spec')) {
      this.detail = null;
      this.allVersions = false;
      this.loadSpec();
    }
    if (ch.has('spec') || ch.has('sid')) {
      this.deep = false;
      this.drawer = false;
      this.term = null;
      if (this.sid) this.loadSection();
      else this.section = null;
    }
  }

  private async loadSpec() {
    const spec = this.spec;
    try {
      const d = await this.ctx.api.spec(spec);
      if (spec !== this.spec) return;
      this.detail = d;
      this.error = '';
      if (!this.sid) store.pushRecent({ spec, title: d.short_title });
    } catch (e) {
      if (spec === this.spec) this.error = (e as Error).message;
    }
  }

  private async loadSection(deep = false) {
    const id = ++this.reqId;
    this.loading = true;
    try {
      let s = await this.ctx.api.section(this.spec, this.sid!, deep);
      // parent headings without own text: show their subsections inline
      if (!deep && !s.hasContent && s.children.length) s = await this.ctx.api.section(this.spec, this.sid!, true);
      if (id !== this.reqId) return;
      this.section = s;
      this.deep = !!s.parts;
      this.error = '';
      store.pushRecent({ spec: s.spec, sid: s.sid, num: s.num, title: s.title, specTitle: s.specTitle });
      const main = this.renderRoot.querySelector('.main');
      main?.scrollTo({ top: 0 });
      // warm the cache for the likely next click
      if (s.next) setTimeout(() => this.ctx.api.section(this.spec, s.next!.sid).catch(() => {}), 400);
    } catch (e) {
      if (id === this.reqId) {
        this.section = null;
        this.error = (e as Error).message;
      }
    } finally {
      if (id === this.reqId) this.loading = false;
    }
  }

  protected updated() {
    // hydrate rendered spec HTML: images, ASN.1 highlighting
    const prose = this.renderRoot.querySelectorAll('.prose');
    prose.forEach((root) => {
      root.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
        const src = img.dataset.src!;
        img.removeAttribute('data-src');
        img.addEventListener(
          'error',
          () => {
            const fig = img.closest('figure') ?? img;
            fig.classList.add('missing');
            fig.innerHTML = `<span>Figure not available offline — see the official document.</span>`;
          },
          { once: true },
        );
        const w = Number(img.getAttribute('width'));
        const h = Number(img.getAttribute('height'));
        if (h && h < 48 && w < 400) img.classList.add('inline-eq');
        img.src = this.ctx.api.imageUrl(src);
      });
      root.querySelectorAll<HTMLElement>('pre.asn1 code:not([data-hl])').forEach((code) => {
        code.dataset.hl = '1';
        code.innerHTML = highlightAsn1(code.textContent ?? '');
      });
      // OpenAPI definitions: highlight + a bar with copy / download / expand
      root.querySelectorAll<HTMLElement>('pre.yaml:not([data-hl])').forEach((pre) => {
        pre.dataset.hl = '1';
        const code = pre.querySelector('code') ?? pre;
        const text = code.textContent ?? '';
        code.innerHTML = highlightYaml(text);
        const title = /^\s*title:\s*['"]?([^'"\n]+)/m.exec(text)?.[1]?.trim();
        const version = /^\s*version:\s*['"]?([^'"\n]+)/m.exec(text)?.[1]?.trim();
        const lines = text.split('\n').length;
        const bar = document.createElement('div');
        bar.className = 'codebar';
        // the clause-5 examples elide parts with "(...)" - not a usable definition
        const excerpt = /^\s*\(\.\.\.\)\s*$/m.test(text);
        bar.innerHTML = `<span class="lang">${excerpt ? 'OpenAPI excerpt' : 'OpenAPI'}</span><span class="what"></span><span class="sp"></span>
          <button type="button" data-act="copy">Copy</button>${excerpt ? '' : '<button type="button" data-act="download">Download .yaml</button>'}
          ${lines > 40 ? '<button type="button" data-act="expand" aria-expanded="false">Expand</button>' : ''}`;
        bar.querySelector('.what')!.textContent = [title, version && `v${version}`, `${lines.toLocaleString()} lines`].filter(Boolean).join(' · ');
        pre.classList.toggle('long', lines > 40);
        pre.before(bar);
      });
      // files from the spec's zip ("Files in the TS zip" annex): name, size, copy / download / expand
      root.querySelectorAll<HTMLElement>('pre.file:not([data-hl])').forEach((pre) => {
        pre.dataset.hl = '1';
        const code = pre.querySelector('code') ?? pre;
        const text = code.textContent ?? '';
        const lang = pre.dataset.lang ?? '';
        // highlighting a multi-megabyte test suite would block the page
        if (text.length < 400_000) {
          if (lang === 'asn1') code.innerHTML = highlightAsn1(text);
          else if (lang === 'yaml') code.innerHTML = highlightYaml(text);
        }
        const lines = text.split('\n').length;
        const bar = document.createElement('div');
        bar.className = 'codebar';
        bar.innerHTML = `<span class="lang"></span><span class="what"></span><span class="sp"></span>
          <button type="button" data-act="copy">Copy</button><button type="button" data-act="download">Download</button>
          ${lines > 40 ? '<button type="button" data-act="expand" aria-expanded="false">Expand</button>' : ''}`;
        bar.querySelector('.lang')!.textContent = pre.dataset.name ?? 'File';
        bar.querySelector('.what')!.textContent = [lang && lang.toUpperCase(), `${lines.toLocaleString()} lines`].filter(Boolean).join(' · ');
        pre.classList.toggle('long', lines > 40);
        pre.before(bar);
      });
    });
    this.linkify();
    const crumbs = this.renderRoot.querySelector<HTMLElement>('.crumbs');
    const ckey = `${this.spec}/${this.sid ?? ''}/${this.section?.sid ?? ''}/${this.detail ? 1 : 0}`;
    if (crumbs && crumbs.dataset.key !== ckey) {
      crumbs.dataset.key = ckey;
      crumbs.scrollLeft = crumbs.scrollWidth;
    }
  }

  /** concept links: first mention of each abbreviation / service name per section */
  private async linkify() {
    const prose = this.renderRoot.querySelector<HTMLElement>('.prose');
    if (!prose || !this.section) return;
    const spec = this.spec;
    // the .prose element is reused between sections — key the work on what it shows
    const key = `${spec}/${this.section.sid}/${this.section.parts ? 1 : 0}`;
    if (prose.dataset.linked === key) return;
    prose.dataset.linked = key;
    let abbr: [string, string][] = [];
    try {
      abbr = await this.ctx.api.terms(spec);
    } catch {
      /* link service names only */
    }
    if (prose.dataset.linked !== key || !prose.isConnected) return;
    const m = matcherFor(spec, abbr);
    const isPart = (el: Element) => el.tagName === 'SECTION' && el.classList.contains('part');
    linkTerms(prose, m, isPart);
    prose.querySelectorAll<HTMLElement>('section.part').forEach((p) => linkTerms(p, m));
  }

  private async openTerm(el: HTMLElement) {
    const t = el.dataset.term!;
    if (this.term?.el === el) {
      this.closeTerm();
      return;
    }
    const main = this.renderRoot.querySelector<HTMLElement>('.main')!;
    const r = el.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    const w = Math.min(420, m.width - 24);
    const x = Math.max(12, Math.min(r.left - m.left - 12, m.width - w - 12));
    // open below the term unless there is clearly more room above (below the sticky bar)
    const below = m.bottom - r.bottom - 16;
    const above = r.top - m.top - 64;
    const up = below < 320 && above > below;
    const h = Math.max(200, Math.min(440, up ? above : below));
    const y = (up ? r.top - 8 : r.bottom + 8) - m.top + main.scrollTop;
    this.term = { t, x, y, up, h, data: null, el };
    try {
      const data = await this.ctx.api.term(t, this.spec);
      if (this.term?.el === el) this.term = { ...this.term, data };
    } catch (e) {
      if (this.term?.el === el) this.term = { ...this.term, err: (e as Error).message };
    }
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('.termcard a, .termcard button')?.focus({ preventScroll: true });
  }

  private codeAction(btn: HTMLElement) {
    const pre = btn.closest('.codebar')?.nextElementSibling as HTMLElement | null;
    if (!pre) return;
    const text = pre.textContent ?? '';
    const act = btn.dataset.act;
    if (act === 'copy') this.copy(text, 'Copied to clipboard');
    else if (act === 'expand') {
      const open = pre.classList.toggle('open');
      btn.textContent = open ? 'Collapse' : 'Expand';
      btn.setAttribute('aria-expanded', String(open));
    } else if (act === 'download' && pre.dataset.name) {
      // a file from the spec's zip: under its own name
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = pre.dataset.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else if (act === 'download') {
      // 3GPP's own naming: TS29510_Nnrf_NFManagement.yaml
      const api = /^(N[a-z0-9-]+_[A-Za-z0-9]+)/.exec(this.section?.title ?? '')?.[1];
      const title = /^\s*title:\s*['"]?([^'"\n]+)/m.exec(text)?.[1]?.trim().replace(/[^\w.-]+/g, '_');
      const name = `TS${this.spec.replace(/[^0-9a-z-]/gi, '')}_${api ?? title ?? this.section?.sid ?? 'api'}.yaml`;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  private onProseClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const act = t.closest('.codebar button') as HTMLElement | null;
    if (act) {
      this.codeAction(act);
      return;
    }
    const term = t.closest('button.term') as HTMLElement | null;
    if (term) {
      e.preventDefault();
      this.openTerm(term);
      return;
    }
    const a = t.closest('a.xref') as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      const spec = a.dataset.spec!;
      const sid = a.dataset.sec;
      if (sid) this.ctx.go('read', { spec, sid });
      else this.ctx.go('spec', { spec });
      return;
    }
    const img = t.closest('figure.fig img') as HTMLImageElement | null;
    if (img && !img.classList.contains('inline-eq') && img.src) this.zoom = img.src;
  }

  private firstReadable(toc: TocNode[]): string | undefined {
    const walk = (nodes: TocNode[]): string | undefined => {
      for (const n of nodes) {
        if (n[3] && !/^(contents|foreword)$/.test(n[0])) return n[0];
        const k = n[4] && walk(n[4]);
        if (k) return k;
      }
    };
    return walk(toc) ?? toc[0]?.[0];
  }

  private async copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.toast(msg);
    } catch {
      this.ctx.toast('Copy failed — clipboard not available');
    }
  }

  static styles = [
    tokens,
    base,
    content,
    katexStyles,
    css`
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }
      .layout {
        display: grid;
        grid-template-columns: var(--toc-w, 316px) minmax(0, 1fr);
        height: 100%;
        position: relative;
      }
      .layout.closed {
        grid-template-columns: 0 minmax(0, 1fr);
      }
      aside {
        min-width: 0;
        overflow: hidden;
        border-right: 1px solid var(--c-border);
        background: var(--c-surface-2);
        display: flex;
        flex-direction: column;
      }
      .layout.closed aside {
        border-right: 0;
      }
      .aside-head {
        padding: 16px 16px 4px;
      }
      .aside-head a {
        display: block;
        color: inherit;
      }
      .aside-head .spec-id {
        font-size: 15px;
        color: var(--c-text);
      }
      .aside-head .t {
        display: block;
        margin-top: 2px;
        font-size: 12.5px;
        color: var(--c-muted);
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      se-toc {
        flex: 1;
        min-height: 0;
        background: var(--c-surface-2);
      }
      .main {
        height: 100%;
        min-width: 0;
        position: relative;
        background: var(--c-surface);
      }
      .bar {
        position: sticky;
        top: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 52px;
        padding: 8px 16px;
        background: color-mix(in srgb, var(--c-surface) 90%, transparent);
        backdrop-filter: saturate(1.4) blur(10px);
        border-bottom: 1px solid var(--c-border);
      }
      .up {
        flex: none;
        min-height: 34px;
        width: 34px;
        padding: 0;
      }
      .crumbs {
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        font-size: 13px;
        color: var(--c-muted);
      }
      .crumbs::-webkit-scrollbar {
        display: none;
      }
      .crumbs.scrolled {
        mask-image: linear-gradient(90deg, transparent, #000 28px);
      }
      .crumbs ol {
        display: flex;
        align-items: center;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
        white-space: nowrap;
        width: max-content;
      }
      .crumbs li {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .crumbs a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        color: var(--c-muted);
        padding: 4px 7px;
        border-radius: 6px;
        transition:
          color var(--_dur) var(--_ease),
          background var(--_dur) var(--_ease);
      }
      .crumbs a:hover {
        color: var(--c-text);
        background: var(--c-surface-3);
      }
      .crumbs a[aria-current='page'] {
        color: var(--c-text);
        font-weight: 550;
      }
      .crumbs .ct {
        max-width: 38ch;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 400;
        color: var(--c-text-2);
      }
      .crumbs .sep {
        width: 13px;
        height: 13px;
        flex: none;
        opacity: 0.6;
      }
      .crumbs .spec-id {
        color: var(--c-text);
      }
      /* "Cited by" — sections that cross-reference this one */
      .refby {
        margin: 36px 0 0;
        border: 1px solid var(--c-border);
        border-radius: 12px;
        background: var(--c-surface-2);
      }
      .refby summary {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 10px 16px;
        cursor: pointer;
        list-style: none;
        font-size: 14px;
        color: var(--c-text-2);
        border-radius: 12px;
      }
      .refby summary::-webkit-details-marker {
        display: none;
      }
      .refby summary b {
        color: var(--c-text);
        font-weight: 600;
      }
      .refby summary span {
        flex: 1;
      }
      .refby summary .chev {
        width: 16px;
        height: 16px;
        color: var(--c-muted);
        transition: transform var(--_dur) var(--_ease);
      }
      .refby[open] summary .chev {
        transform: rotate(180deg);
      }
      .refby summary:focus-visible {
        outline: 2px solid var(--c-accent);
        outline-offset: 2px;
      }
      .rgroup {
        padding: 2px 10px 10px;
      }
      .rspec {
        padding: 8px 6px 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--c-muted);
        letter-spacing: 0.02em;
      }
      .rgroup ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .rgroup a {
        display: flex;
        gap: 10px;
        padding: 7px 8px;
        border-radius: 7px;
        font-size: 13.5px;
        line-height: 1.4;
        color: var(--c-text-2);
      }
      .rgroup a:hover {
        background: var(--c-surface-3);
        color: var(--c-text);
      }
      .rgroup .n,
      .termcard .n {
        flex: none;
        min-width: 5.5ch;
        font-family: var(--_mono);
        font-size: 12px;
        color: var(--c-muted);
        padding-top: 1px;
      }
      .refby .more {
        margin: 0;
        padding: 0 16px 14px;
        font-size: 12.5px;
        color: var(--c-muted);
      }
      /* concept card */
      .termcard {
        position: absolute;
        z-index: 20;
        width: min(420px, calc(100% - 24px));
        max-height: min(440px, 70vh);
        display: flex;
        flex-direction: column;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: 12px;
        box-shadow: var(--c-shadow-lg);
        animation: tc-in 140ms var(--_ease);
      }
      .termcard.up {
        transform: translateY(-100%);
        animation-name: tc-in-up;
      }
      @keyframes tc-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
      }
      @keyframes tc-in-up {
        from {
          opacity: 0;
          transform: translateY(calc(-100% + 4px));
        }
      }
      .tc-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 8px 10px 16px;
        border-bottom: 1px solid var(--c-border);
      }
      .tc-term {
        font-family: var(--_mono);
        font-size: 15px;
        font-weight: 600;
        color: var(--c-text);
        overflow-wrap: anywhere;
      }
      .tc-exp {
        margin-top: 2px;
        font-size: 13.5px;
        color: var(--c-text-2);
      }
      .tc-src {
        margin-top: 4px;
        font-size: 11.5px;
        color: var(--c-muted);
      }
      .tc-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 6px 8px;
        scrollbar-width: thin;
      }
      .tc-empty {
        margin: 10px 8px;
        font-size: 13px;
        color: var(--c-muted);
      }
      .tc-group + .tc-group {
        border-top: 1px solid var(--c-border);
      }
      .tc-spec {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 8px;
        padding: 10px 8px 4px;
        font-size: 12.5px;
        color: var(--c-text);
        font-weight: 600;
      }
      .tc-stage {
        font-size: 11px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
      }
      .tc-st {
        flex-basis: 100%;
        font-weight: 400;
        color: var(--c-muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .termcard ul {
        list-style: none;
        margin: 0;
        padding: 0 0 6px;
      }
      .termcard li a {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 7px 8px;
        border-radius: 7px;
        font-size: 13.5px;
        line-height: 1.4;
        color: var(--c-text-2);
      }
      .termcard li a:hover,
      .termcard li a:focus-visible {
        background: var(--c-surface-3);
        color: var(--c-text);
      }
      .termcard .tt {
        flex: 1;
        min-width: 0;
      }
      .termcard .k {
        flex: none;
        font-size: 11px;
        color: var(--c-muted);
        border: 1px solid var(--c-border);
        border-radius: 999px;
        padding: 0 7px;
      }
      .termcard .k-definition {
        color: var(--c-accent-text);
        border-color: color-mix(in srgb, var(--c-accent) 40%, transparent);
      }
      .tc-foot {
        display: flex;
        gap: 4px;
        padding: 6px 8px;
        border-top: 1px solid var(--c-border);
      }
      .tc-foot .btn {
        min-height: 34px;
        font-size: 13px;
      }
      .actions {
        display: flex;
        gap: 2px;
        flex: none;
      }
      .actions .btn {
        min-height: 34px;
        width: 34px;
        padding: 0;
      }
      .progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: -1px;
        height: 2px;
        overflow: hidden;
      }
      .progress::after {
        content: '';
        position: absolute;
        inset: 0;
        width: 30%;
        background: var(--c-accent);
        animation: load 0.9s var(--_ease) infinite;
      }
      @keyframes load {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(400%);
        }
      }
      article {
        max-width: 860px;
        margin: 0 auto;
        padding: 36px 40px 96px;
      }
      .kicker {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        font-size: 13px;
        color: var(--c-muted);
        margin-bottom: 10px;
      }
      h1 {
        margin: 0 0 28px;
        font-size: clamp(24px, 3vw, 30px);
        line-height: 1.2;
        letter-spacing: -0.02em;
        font-weight: 650;
        text-wrap: balance;
      }
      h1 .num {
        font-family: var(--_mono);
        color: var(--c-accent-text);
        font-weight: 600;
        margin-right: 0.45em;
        letter-spacing: -0.03em;
      }
      .part {
        margin-top: 40px;
        scroll-margin-top: 64px;
      }
      .part h2 {
        margin: 0 0 14px;
        padding-top: 18px;
        border-top: 1px solid var(--c-border);
        font-weight: 620;
        letter-spacing: -0.01em;
        line-height: 1.3;
      }
      .part h2 a {
        color: inherit;
      }
      .part h2 .num {
        font-family: var(--_mono);
        color: var(--c-accent-text);
        margin-right: 0.5em;
        font-weight: 600;
      }
      .part.d1 h2 {
        font-size: 21px;
      }
      .part.d2 h2 {
        font-size: 18px;
      }
      .part.d3 h2,
      .part.d4 h2,
      .part.d5 h2,
      .part.d6 h2 {
        font-size: 16px;
      }
      .part .empty {
        font-size: 13.5px;
        color: var(--c-muted);
        font-style: italic;
      }
      .subs {
        margin: 32px 0 0;
        padding: 18px 20px;
        border-radius: var(--_radius);
        background: var(--c-surface-2);
        border: 1px solid var(--c-border);
      }
      .subs h3 {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 600;
        color: var(--c-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .subs ul {
        list-style: none;
        margin: 0;
        padding: 0;
        columns: 2 280px;
        column-gap: 24px;
      }
      .subs li {
        break-inside: avoid;
        padding: 3px 0;
        font-size: 14px;
      }
      .subs li .n {
        font-family: var(--_mono);
        font-size: 12.5px;
        color: var(--c-muted);
        margin-right: 8px;
      }
      .pager {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 56px;
      }
      .pager a {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 16px;
        border: 1px solid var(--c-border);
        border-radius: var(--_radius);
        color: var(--c-text-2);
        font-size: 14px;
        min-width: 0;
        transition:
          border-color var(--_dur) var(--_ease),
          background var(--_dur) var(--_ease);
      }
      .pager a:hover {
        border-color: var(--c-accent);
        background: var(--c-accent-soft);
      }
      .pager .lbl {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--c-muted);
      }
      .pager .ttl {
        display: block;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pager .ttl b {
        font-family: var(--_mono);
        font-weight: 600;
        margin-right: 6px;
        color: var(--c-text);
      }
      .pager .next {
        text-align: right;
        align-items: flex-end;
        grid-column: 2;
      }
      .notice {
        display: flex;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
        background: var(--c-surface-2);
        border: 1px solid var(--c-border);
        color: var(--c-muted);
        font-size: 13.5px;
        margin: 16px 0;
      }

      /* overview */
      .ov-head {
        padding-bottom: 28px;
        border-bottom: 1px solid var(--c-border);
      }
      .ov-id {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .ov-id .spec-id {
        font-size: clamp(28px, 4vw, 40px);
        letter-spacing: -0.03em;
      }
      .ov-title {
        margin: 10px 0 18px;
        font-size: 19px;
        line-height: 1.45;
        font-weight: 500;
        color: var(--c-text-2);
        text-wrap: pretty;
      }
      .ov-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        font-size: 13px;
        color: var(--c-muted);
        margin-bottom: 22px;
      }
      .ov-meta b {
        display: block;
        color: var(--c-text);
        font-weight: 550;
        font-size: 14px;
        margin-top: 2px;
      }
      .ov-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ov-actions a.btn {
        text-decoration: none;
      }
      .ov h2 {
        font-size: 16px;
        font-weight: 600;
        margin: 32px 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .chapters {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 8px;
      }
      .chapters a {
        display: flex;
        gap: 10px;
        padding: 12px 14px;
        border: 1px solid var(--c-border);
        border-radius: 9px;
        color: var(--c-text-2);
        font-size: 14px;
        line-height: 1.4;
        transition: border-color var(--_dur) var(--_ease);
      }
      .chapters a:hover {
        border-color: var(--c-accent);
      }
      .chapters .n {
        flex: none;
        font-family: var(--_mono);
        font-weight: 600;
        color: var(--c-accent-text);
        min-width: 2.5ch;
      }
      .chapters .c {
        display: block;
        font-size: 12px;
        color: var(--c-muted);
        margin-top: 2px;
      }
      table.versions {
        width: 100%;
        border-collapse: collapse;
        font-size: 13.5px;
      }
      table.versions th {
        text-align: left;
        font-weight: 500;
        color: var(--c-muted);
        font-size: 12px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--c-border);
      }
      table.versions td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--c-border);
        font-variant-numeric: tabular-nums;
      }
      table.versions td:last-child,
      table.versions th:last-child {
        text-align: right;
      }
      table.versions tr:first-child td {
        font-weight: 550;
      }
      .tblwrap {
        overflow-x: auto;
      }

      .zoom {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--c-overlay);
        backdrop-filter: blur(3px);
        cursor: zoom-out;
        animation: fade 140ms var(--_ease);
      }
      .zoom img {
        max-width: min(1400px, 100%);
        max-height: 100%;
        background: #fff;
        border-radius: 10px;
        padding: 16px;
        box-shadow: var(--c-shadow-lg);
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      .scrim {
        display: none;
      }
      .err {
        max-width: 560px;
        margin: 80px auto;
        text-align: center;
        color: var(--c-muted);
      }
      .skel-lines .skel {
        height: 14px;
        margin: 12px 0;
      }

      @media (max-width: 1024px) {
        .layout,
        .layout.closed {
          grid-template-columns: minmax(0, 1fr);
        }
        aside {
          position: absolute;
          z-index: 20;
          top: 0;
          bottom: 0;
          left: 0;
          width: min(340px, 88%);
          transform: translateX(-102%);
          transition: transform 220ms var(--_ease);
          box-shadow: var(--c-shadow-lg);
        }
        .layout.drawer aside {
          transform: none;
        }
        .layout.drawer .scrim {
          display: block;
          position: absolute;
          inset: 0;
          z-index: 19;
          background: var(--c-overlay);
        }
        article {
          padding: 24px 20px 80px;
        }
      }
      @media (max-width: 560px) {
        .pager {
          grid-template-columns: 1fr;
        }
        .pager .next {
          grid-column: 1;
        }
        .actions .opt {
          display: none;
        }
      }
    `,
  ];

  private toggleToc() {
    if (matchMedia('(max-width: 1024px)').matches) this.drawer = !this.drawer;
    else {
      this.tocOpen = !this.tocOpen;
      store.tocOpen = this.tocOpen;
    }
  }

  /** one level up: parent section → spec overview → series → all specs */
  private renderUp() {
    const s = this.section;
    const series = this.spec.slice(0, 2);
    let label: string;
    let go: Parameters<typeof linkClick>;
    if (this.sid && s?.parents.length) {
      const p = s.parents[s.parents.length - 1];
      label = `Up to ${p.num || p.title}`;
      go = [this.ctx, 'read', { spec: this.spec, sid: p.sid }];
    } else if (this.sid) {
      label = `Up to ${this.spec} overview`;
      go = [this.ctx, 'spec', { spec: this.spec }];
    } else {
      label = `Up to series ${series}`;
      go = [this.ctx, 'browse', { params: { series } }];
    }
    return html`<a class="btn ghost icon-only up" href=${this.ctx.href(go[1], go[2])} @click=${linkClick(...go)} aria-label=${label} title=${label}>${icon('up', 'sm')}</a>`;
  }

  private renderBar() {
    const s = this.section;
    const d = this.detail;
    const series = d?.series ?? this.spec.slice(0, 2);
    const bookmarked = store.isBookmarked(this.spec, this.sid);
    const fs = store.fontSize;
    return html`<div class="bar">
      <button class="btn ghost icon-only" aria-label="Toggle table of contents" title="Table of contents" @click=${() => this.toggleToc()}>
        ${icon(this.tocOpen ? 'panelClose' : 'panel')}
      </button>
      ${this.renderUp()}
      <nav class="crumbs" aria-label="Breadcrumb" @scroll=${(e: Event) => (e.target as HTMLElement).classList.toggle('scrolled', (e.target as HTMLElement).scrollLeft > 4)}>
        <ol>
          <li>
            <a href=${this.ctx.href('browse')} @click=${linkClick(this.ctx, 'browse')} title="All specifications">${icon('library', 'sm')}<span>Specs</span></a>
          </li>
          <li>
            ${icon('chevronRight', 'sep')}<a
              href=${this.ctx.href('browse', { params: { series } })}
              @click=${linkClick(this.ctx, 'browse', { params: { series } })}
              title=${`Series ${series} · ${SERIES[series] ?? ''}`}
              >${series} series</a
            >
          </li>
          <li>
            ${icon('chevronRight', 'sep')}<a
              href=${this.ctx.href('spec', { spec: this.spec })}
              @click=${linkClick(this.ctx, 'spec', { spec: this.spec })}
              aria-current=${this.sid ? nothing : 'page'}
              title=${d?.short_title ?? this.spec}
              ><span class="spec-id">${d?.type ?? s?.type ?? ''} ${this.spec}</span></a
            >
          </li>
          ${s
            ? [...s.parents, s].map(
                (p, i, all) =>
                  html`<li>
                    ${icon('chevronRight', 'sep')}<a
                      href=${this.ctx.href('read', { spec: this.spec, sid: p.sid })}
                      @click=${linkClick(this.ctx, 'read', { spec: this.spec, sid: p.sid })}
                      aria-current=${i === all.length - 1 ? 'page' : nothing}
                      title=${[p.num, p.title].filter(Boolean).join(' ')}
                      >${p.num || p.title}${i === all.length - 1 && p.num ? html`<span class="ct"> ${p.title}</span>` : nothing}</a
                    >
                  </li>`,
              )
            : nothing}
        </ol>
      </nav>
      <div class="actions">
        ${s
          ? html`<button class="btn ghost opt" aria-label="Decrease text size" title="Smaller text" @click=${() => (store.fontSize = fs - 1)}>${icon('minus', 'sm')}</button>
              <button class="btn ghost opt" aria-label="Increase text size" title="Larger text" @click=${() => (store.fontSize = fs + 1)}>${icon('plus', 'sm')}</button>
              <button class="btn ghost opt" aria-label="Copy citation" title="Copy citation" @click=${() => this.copy(citation(s.type, s.spec, s.version, s.num), 'Citation copied')}>
                ${icon('quote', 'sm')}
              </button>`
          : nothing}
        <button class="btn ghost" aria-label="Copy link" title="Copy link" @click=${() => this.copy(this.ctx.share(this.sid ? 'read' : 'spec', { spec: this.spec, sid: this.sid }), 'Link copied')}>
          ${icon('link', 'sm')}
        </button>
        <button
          class="btn ghost"
          aria-pressed=${bookmarked}
          aria-label=${bookmarked ? 'Remove bookmark' : 'Bookmark'}
          title=${bookmarked ? 'Remove bookmark' : 'Bookmark'}
          @click=${() => {
            const added = store.toggleBookmark(
              s ? { spec: s.spec, sid: s.sid, num: s.num, title: s.title, specTitle: s.specTitle } : { spec: this.spec, title: d?.short_title ?? this.spec },
            );
            this.ctx.toast(added ? 'Bookmarked' : 'Bookmark removed');
          }}
        >
          ${icon(bookmarked ? 'bookmarkCheck' : 'bookmark', 'sm')}
        </button>
      </div>
      ${this.loading ? html`<div class="progress" aria-hidden="true"></div>` : nothing}
    </div>`;
  }

  private renderOverview(d: SpecDetail) {
    // the version whose text is shown (archive-only specs skip a newer "withdrawn" stub)
    const latest = d.versions.find((v) => v.version === d.latest_version) ?? d.versions[0];
    const newest = d.versions[0];
    const archive = d.source === 'archive';
    const first = this.firstReadable(d.toc);
    const versions = this.allVersions ? d.versions : d.versions.slice(0, 8);
    const count = (n: TocNode): number => 1 + (n[4] ?? []).reduce((a, k) => a + count(k), 0);
    return html`<article class="ov">
      <header class="ov-head">
        <div class="ov-id">
          <span class="spec-id">${d.type} ${d.spec}</span>
          <span class="badge ${d.type.toLowerCase()}">${d.type === 'TS' ? 'Technical Specification' : 'Technical Report'}</span>
        </div>
        <p class="ov-title">${d.short_title}</p>
        <div class="ov-meta">
          <span>Release<b>${releaseName(d.release)}</b></span>
          ${d.latest_version
            ? html`<span>${archive || (newest && newest.version !== d.latest_version) ? 'Text from version' : 'Latest version'}<b class="mono">${d.latest_version}</b></span>`
            : nothing}
          ${archive && d.status ? html`<span>Status<b>${d.status}</b></span>` : nothing}
          ${d.latest_date ? html`<span>Published<b>${fmtDate(d.latest_date)}</b></span>` : nothing}
          ${d.tsg ? html`<span>Working group<b>TSG ${d.tsg}</b></span>` : nothing}
          <span>Series<b>${d.series} · ${SERIES[d.series] ?? ''}</b></span>
          <span>Sections<b>${fmtNum(d.section_count)}</b></span>
        </div>
        <div class="ov-actions">
          ${first && d.available
            ? html`<a class="btn primary" href=${this.ctx.href('read', { spec: d.spec, sid: first })} @click=${linkClick(this.ctx, 'read', { spec: d.spec, sid: first })}
                >${icon('book', 'sm')} Start reading</a
              >`
            : nothing}
          <button class="btn" @click=${() => this.ctx.openPalette(`${d.spec} `)}>${icon('search', 'sm')} Search in ${d.spec}</button>
          ${latest?.url
            ? html`<a class="btn" href=${latest.url} target="_blank" rel="noopener noreferrer">${icon('download', 'sm')} Official .zip (v${latest.version})</a>`
            : html`<a class="btn" href=${`https://www.3gpp.org/ftp/Specs/archive/${d.spec.slice(0, 2)}_series/${d.spec}/`} target="_blank" rel="noopener noreferrer"
                >${icon('external', 'sm')} Official archive</a
              >`}
        </div>
        ${archive && !d.versions.length
          ? html`<div class="notice">
              ${icon('info', 'sm')} This number is registered with 3GPP${d.status ? html` (status: ${d.status})` : nothing}, but its folder in the official
              archive is empty — no version of the document was ever published.
            </div>`
          : archive
          ? html`<div class="notice">
              ${icon('info', 'sm')} Converted from the official 3GPP archive (version ${d.latest_version ?? '?'}).
              ${newest && latest && newest.version !== latest.version
                ? html`The newest upload, v${newest.version}, is only a short notice (typically “withdrawn” or “transferred”), so the last full text is shown.`
                : nothing}
            </div>`
          : newest && latest && newest.version !== latest.version
          ? html`<div class="notice">
              ${icon('info', 'sm')} The official archive also has v${newest.version}${newest.date ? html` (${fmtDate(newest.date)})` : nothing}; the text shown is
              from v${latest.version}.
              <a href=${newest.url} target="_blank" rel="noopener noreferrer">Download v${newest.version}</a>
            </div>`
          : nothing}
        ${!d.available && d.versions.length
          ? html`<div class="notice">${icon('info', 'sm')} Section text for this document is not in the local database yet — the table of contents and official downloads are available.</div>`
          : nothing}
      </header>
      ${d.toc.length ? html`<h2>Contents</h2>` : nothing}
      <div class="chapters">
        ${d.toc
          .filter((n) => n[0] !== 'contents')
          .map(
            (n) => html`<a href=${this.ctx.href('read', { spec: d.spec, sid: n[0] })} @click=${linkClick(this.ctx, 'read', { spec: d.spec, sid: n[0] })}>
              <span class="n">${n[1] || '§'}</span>
              <span>${n[2]}${n[4]?.length ? html`<span class="c">${count(n) - 1} subsections</span>` : nothing}</span>
            </a>`,
          )}
      </div>
      ${d.versions.length
        ? html`<h2>
              Version history <span class="muted" style="font-size:13px;font-weight:400">${d.versions.length} published versions</span>
            </h2>
            <div class="card tblwrap">
              <table class="versions">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Release</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th>Download</th>
                  </tr>
                </thead>
                <tbody>
                  ${versions.map(
                    (v) => html`<tr>
                      <td class="mono">${v.version}</td>
                      <td>${v.release}</td>
                      <td>${fmtDate(v.date)}</td>
                      <td class="muted">${v.size}</td>
                      <td>${v.url ? html`<a href=${v.url} target="_blank" rel="noopener noreferrer">.zip ${icon('arrowUpRight', 'sm')}</a>` : nothing}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            ${d.versions.length > 8
              ? html`<p><button class="btn ghost" @click=${() => (this.allVersions = !this.allVersions)}>${this.allVersions ? 'Show fewer' : `Show all ${d.versions.length} versions`}</button></p>`
              : nothing}`
        : nothing}
    </article>`;
  }

  private renderRefBy(s: SectionDetail) {
    const r = s.refBy!;
    const groups = new Map<string, typeof r.items>();
    for (const it of r.items) {
      const a = groups.get(it.spec) ?? [];
      a.push(it);
      groups.set(it.spec, a);
    }
    return html`<details class="refby" ?open=${r.total <= 8}>
      <summary>
        ${icon('refs', 'sm')}<span>Cited by <b>${fmtNum(r.total)}</b> ${r.total === 1 ? 'section' : 'sections'}${groups.size > 1 ? html` in ${groups.size} specifications` : nothing}</span>
        ${icon('chevronDown', 'chev')}
      </summary>
      ${[...groups.entries()].map(
        ([spec, items]) => html`<div class="rgroup">
          <div class="rspec">${spec === s.spec ? 'This specification' : html`<span class="mono">${spec}</span> ${items[0].specTitle}`}</div>
          <ul>
            ${items.map(
              (it) => html`<li>
                <a href=${this.ctx.href('read', { spec: it.spec, sid: it.sid })} @click=${linkClick(this.ctx, 'read', { spec: it.spec, sid: it.sid })}
                  ><span class="n">${it.num ?? ''}</span><span>${it.title}</span></a
                >
              </li>`,
            )}
          </ul>
        </div>`,
      )}
      ${r.total > r.items.length ? html`<p class="more">Showing ${r.items.length} of ${fmtNum(r.total)}.</p>` : nothing}
    </details>`;
  }

  private renderTermCard() {
    const t = this.term!;
    const d = t.data;
    const KIND: Record<string, string> = { definition: 'Description', services: 'Services', operation: 'Operation' };
    return html`<div
      class="termcard ${t.up ? 'up' : ''}"
      role="dialog"
      aria-label="Where ${t.t} is described"
      style="left:${t.x}px;top:${t.y}px;max-height:${t.h}px"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.closeTerm(true);
        }
      }}
    >
      <div class="tc-head">
        <div>
          <div class="tc-term">${t.t}</div>
          ${d?.expansion ? html`<div class="tc-exp">${d.expansion}</div>` : nothing}
          ${d?.expansionFrom ? html`<div class="tc-src">Abbreviation from ${d.expansionFrom === this.spec ? 'this specification' : `TR ${d.expansionFrom}`}</div>` : nothing}
        </div>
        <button class="btn ghost icon-only" aria-label="Close" title="Close" @click=${() => this.closeTerm(true)}>${icon('x', 'sm')}</button>
      </div>
      <div class="tc-body">
        ${t.err
          ? html`<p class="tc-empty">${t.err}</p>`
          : !d
            ? html`<div aria-busy="true">${[80, 60, 70].map((w) => html`<div class="skel" style="width:${w}%;height:12px;margin:12px 0"></div>`)}</div>`
            : d.groups.length === 0
              ? html`<p class="tc-empty">No section is dedicated to ${t.t}. Search for every mention instead.</p>`
              : d.groups.map(
                  (g) => html`<div class="tc-group">
                    <div class="tc-spec">
                      <span class="mono">${g.type} ${g.spec}</span>${g.stage ? html`<span class="tc-stage">${g.stage}</span>` : nothing}
                      <span class="tc-st">${g.title}</span>
                    </div>
                    <ul>
                      ${g.hits.map(
                        (h) => html`<li>
                          <a href=${this.ctx.href('read', { spec: g.spec, sid: h.sid })} @click=${linkClick(this.ctx, 'read', { spec: g.spec, sid: h.sid })}>
                            <span class="n">${h.num ?? ''}</span><span class="tt">${h.title}</span>${KIND[h.kind] ? html`<span class="k k-${h.kind}">${KIND[h.kind]}</span>` : nothing}
                          </a>
                        </li>`,
                      )}
                    </ul>
                  </div>`,
                )}
      </div>
      <div class="tc-foot">
        <a
          class="btn ghost"
          href=${this.ctx.href('search', { params: { q: `"${t.t}"` } })}
          @click=${linkClick(this.ctx, 'search', { params: { q: `"${t.t}"` } })}
          >${icon('textSearch', 'sm')} All mentions</a
        >
        <a
          class="btn ghost"
          href=${this.ctx.href('search', { params: { q: `"${t.t}"`, spec: this.spec } })}
          @click=${linkClick(this.ctx, 'search', { params: { q: `"${t.t}"`, spec: this.spec } })}
          >${icon('search', 'sm')} In ${this.spec}</a
        >
      </div>
    </div>`;
  }

  private renderSection(s: SectionDetail) {
    const fs = store.fontSize;
    return html`<article style="--se-content-size:${fs}px">
      <div class="kicker">
        <span class="badge ${s.type.toLowerCase()}">${s.type} ${s.spec}</span>
        <span>${s.specTitle}</span>
      </div>
      <h1>${s.num ? html`<span class="num">${s.num}</span>` : nothing}${s.title}</h1>
      <div class="prose" @click=${this.onProseClick}>
        ${s.html ? unsafeHTML(s.html) : nothing}
        ${s.parts?.map(
          (p) => html`<section class="part d${Math.min(p.depth, 6)}" id="p-${p.sid}">
            <h2>
              <a href=${this.ctx.href('read', { spec: s.spec, sid: p.sid })} @click=${linkClick(this.ctx, 'read', { spec: s.spec, sid: p.sid })}
                >${p.num ? html`<span class="num">${p.num}</span>` : nothing}${p.title}</a
              >
            </h2>
            ${p.html ? unsafeHTML(p.html) : nothing}
          </section>`,
        )}
      </div>
      ${s.truncated
        ? html`<div class="notice">${icon('info', 'sm')} This chapter is long — open a subsection from the contents to continue reading.</div>`
        : nothing}
      ${!s.html && !s.parts?.length && !s.children.length
        ? html`<div class="notice">${icon('info', 'sm')} This section has no text in the source document${this.detail && !this.detail.available ? ' (not yet downloaded)' : ''}.</div>`
        : nothing}
      ${s.children.length && !s.parts
        ? html`<div class="subs">
            <h3>
              Subsections
              <button
                class="btn ghost"
                style="min-height:30px;font-size:12.5px;text-transform:none;letter-spacing:0"
                @click=${() => this.loadSection(true)}
              >
                ${icon('rows', 'sm')} Read all inline
              </button>
            </h3>
            <ul>
              ${s.children.map(
                (c) => html`<li>
                  <a href=${this.ctx.href('read', { spec: s.spec, sid: c.sid })} @click=${linkClick(this.ctx, 'read', { spec: s.spec, sid: c.sid })}
                    ><span class="n">${c.num}</span>${c.title}</a
                  >
                </li>`,
              )}
            </ul>
          </div>`
        : nothing}
      ${s.refBy?.total ? this.renderRefBy(s) : nothing}
      <nav class="pager" aria-label="Section navigation">
        ${s.prev
          ? html`<a href=${this.ctx.href('read', { spec: s.spec, sid: s.prev.sid })} @click=${linkClick(this.ctx, 'read', { spec: s.spec, sid: s.prev.sid })}>
              <span class="lbl">${icon('arrowLeft', 'sm')} Previous <kbd>[</kbd></span>
              <span class="ttl">${s.prev.num ? html`<b>${s.prev.num}</b>` : nothing}${s.prev.title}</span>
            </a>`
          : nothing}
        ${s.next
          ? html`<a class="next" href=${this.ctx.href('read', { spec: s.spec, sid: s.next.sid })} @click=${linkClick(this.ctx, 'read', { spec: s.spec, sid: s.next.sid })}>
              <span class="lbl">Next <kbd>]</kbd> ${icon('arrowRight', 'sm')}</span>
              <span class="ttl">${s.next.num ? html`<b>${s.next.num}</b>` : nothing}${s.next.title}</span>
            </a>`
          : nothing}
      </nav>
    </article>`;
  }

  render() {
    const d = this.detail;
    const body = this.error
      ? html`<div class="err">${icon('searchX', 'lg')}<p>${this.error}</p>
          <a class="btn" href=${this.ctx.href('spec', { spec: this.spec })} @click=${linkClick(this.ctx, 'spec', { spec: this.spec })}>Back to ${this.spec}</a></div>`
      : this.sid
        ? this.section && this.section.sid === this.sid.toLowerCase()
          ? this.renderSection(this.section)
          : html`<article class="skel-lines">
              <div class="skel" style="width:40%;height:28px;margin-bottom:28px"></div>
              ${[92, 100, 96, 70, 100, 88, 94, 60].map((w) => html`<div class="skel" style="width:${w}%"></div>`)}
            </article>`
        : d
          ? this.renderOverview(d)
          : html`<article class="skel-lines">
              <div class="skel" style="width:30%;height:40px;margin-bottom:20px"></div>
              ${[80, 60, 90].map((w) => html`<div class="skel" style="width:${w}%"></div>`)}
            </article>`;
    return html`<div class="layout ${this.tocOpen ? '' : 'closed'} ${this.drawer ? 'drawer' : ''}">
      <aside aria-label="Specification contents">
        <div class="aside-head">
          <a href=${this.ctx.href('spec', { spec: this.spec })} @click=${linkClick(this.ctx, 'spec', { spec: this.spec })}>
            <span class="spec-id">${d?.type ?? ''} ${this.spec}</span>
            <span class="t">${d?.short_title ?? ''}</span>
          </a>
        </div>
        ${d ? html`<se-toc .toc=${d.toc} .spec=${this.spec} .active=${this.sid?.toLowerCase()} .ctx=${this.ctx}></se-toc>` : html`<div style="padding:16px">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="skel" style="height:14px;margin:12px 0"></div>`)}</div>`}
      </aside>
      <div class="scrim" @click=${() => (this.drawer = false)}></div>
      <div class="main scroll">${this.renderBar()} ${body} ${this.term ? this.renderTermCard() : nothing}</div>
      ${this.zoom ? html`<div class="zoom" role="dialog" aria-label="Figure" @click=${() => (this.zoom = null)}><img src=${this.zoom} alt="Figure (enlarged)" /></div>` : nothing}
    </div>`;
  }
}
customElements.get('se-reader') || customElements.define('se-reader', SeReader);
