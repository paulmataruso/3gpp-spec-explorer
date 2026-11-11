import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, base } from '../styles/tokens.ts';
import { icon, SERIES_ICON } from '../lib/icons.ts';
import { SERIES, fmtNum } from '../lib/format.ts';
import type { SpecSummary, TocNode } from '../lib/api.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import type { RouteName } from '../lib/router.ts';

interface Target {
  name: RouteName;
  spec?: string;
  sid?: string;
  params?: Record<string, string>;
}

interface Item {
  key: string;
  num: string;
  label: string;
  meta?: string;
  badge?: 'TS' | 'TR';
  series?: string;
  kids: boolean;
  target: Target;
}

interface Level {
  key: string;
  kicker: string;
  title: string;
  /** the page this column belongs to (spec overview, chapter...) */
  open?: Target & { label: string };
  items: Item[] | null; // null while loading
  selected?: string;
  error?: string;
}

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/**
 * Drill-down navigation from the series ("root topics") through specifications and their
 * chapters down to the last section. Columns on wide containers, a single sliding list on narrow ones.
 * Fires `se-close` when it wants to be closed.
 */
export class SeNavMenu extends LitElement {
  static properties = {
    ctx: { attribute: false },
    current: { attribute: false },
    levels: { state: true },
    filter: { state: true },
  };
  declare ctx: Ctx;
  declare current: { spec?: string; sid?: string };
  declare levels: Level[];
  declare filter: string;
  private specs: SpecSummary[] = [];
  private tocs = new Map<string, { nodes: Map<string, TocNode>; parent: Map<string, string | null>; root: TocNode[] }>();

  constructor() {
    super();
    this.levels = [];
    this.filter = '';
    this.current = {};
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        container-type: inline-size;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: 14px;
        box-shadow: var(--c-shadow-lg);
        overflow: hidden;
        animation: drop 160ms var(--_ease);
      }
      @keyframes drop {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
      }
      .top {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 10px 10px 14px;
        border-bottom: 1px solid var(--c-border);
      }
      .top .input {
        flex: 1;
        height: 36px;
        max-width: 420px;
      }
      .top .all {
        margin-left: auto;
        white-space: nowrap;
      }
      .path {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--c-border);
        overflow-x: auto;
        white-space: nowrap;
        scrollbar-width: none;
        font-size: 12.5px;
      }
      .path .sep {
        flex: none;
        width: 12px;
        height: 12px;
        color: var(--c-muted);
        opacity: 0.7;
      }
      .crumb {
        flex: none;
        min-height: 30px;
        padding: 0 7px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--c-muted);
        font: inherit;
        cursor: pointer;
        max-width: 26ch;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .crumb:hover {
        color: var(--c-text);
        background: var(--c-surface-3);
      }
      .crumb[aria-current] {
        color: var(--c-text);
        font-weight: 600;
      }
      .crumb:focus-visible {
        outline: 2px solid var(--c-accent);
        outline-offset: -2px;
      }
      .cols {
        flex: 1;
        min-height: 0;
        display: flex;
        overflow-x: auto;
        scroll-behavior: smooth;
        scrollbar-width: thin;
      }
      .col {
        flex: 0 0 300px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--c-border);
      }
      .col:last-child {
        flex: 1 0 300px;
        border-right: 0;
      }
      .col:not(:last-child) {
        background: var(--c-surface-2);
      }
      .col-head {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 52px;
        padding: 8px 8px 8px 14px;
        border-bottom: 1px solid var(--c-border);
      }
      .col-head .ttl {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .col-head .k {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--c-muted);
      }
      .col-head .t {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--c-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .col-head .open {
        flex: none;
        min-height: 30px;
        font-size: 12.5px;
        padding: 0 10px;
      }
      .back {
        display: none;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 6px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        scrollbar-width: thin;
      }
      li {
        content-visibility: auto;
        contain-intrinsic-size: auto 40px;
      }
      .item {
        width: 100%;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-height: 40px;
        padding: 9px 10px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--c-text-2);
        font: inherit;
        font-size: 13.5px;
        line-height: 1.4;
        text-align: left;
        cursor: pointer;
        transition: background var(--_dur) var(--_ease);
      }
      .item:hover {
        background: var(--c-surface-3);
        color: var(--c-text);
      }
      .item:focus-visible {
        outline: 2px solid var(--c-accent);
        outline-offset: -2px;
      }
      .item[aria-expanded='true'] {
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
      }
      .item.here {
        color: var(--c-accent-text);
        font-weight: 600;
      }
      .item .ic {
        flex: none;
        color: var(--c-muted);
        margin-top: 1px;
      }
      .item .n {
        flex: none;
        min-width: 2.2ch;
        font-family: var(--_mono);
        font-size: 12px;
        color: var(--c-muted);
        padding-top: 1px;
      }
      .item[aria-expanded='true'] .n,
      .item[aria-expanded='true'] .ic {
        color: var(--c-accent-text);
      }
      .item .l {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .item .m {
        display: block;
        font-size: 12px;
        color: var(--c-muted);
        font-weight: 400;
      }
      .item .badge {
        flex: none;
        margin-top: 1px;
      }
      .item .chev {
        flex: none;
        width: 16px;
        height: 16px;
        margin-top: 2px;
        color: var(--c-muted);
      }
      .state {
        padding: 18px 14px;
        font-size: 13px;
        color: var(--c-muted);
      }
      .skel {
        height: 14px;
        margin: 14px 10px;
      }
      /* narrow: one column at a time, with a back button */
      @container (max-width: 700px) {
        .col:not(:last-child) {
          display: none;
        }
        .col:last-child {
          flex-basis: 100%;
        }
        .back {
          display: inline-flex;
        }
        .top .all span {
          display: none;
        }
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();
    try {
      this.specs = await this.ctx.api.specs();
    } catch {
      this.levels = [{ key: 'root', kicker: '3GPP', title: 'Series', items: [], error: 'Could not load the catalogue.' }];
      return;
    }
    await this.reveal(this.current.spec, this.current.sid);
  }

  /* ---------------- data ---------------- */

  private rootLevel(): Level {
    const counts = new Map<string, number>();
    for (const s of this.specs) counts.set(s.series, (counts.get(s.series) ?? 0) + 1);
    const items = [...counts.keys()].sort(byNumber).map<Item>((k) => ({
      key: `ser:${k}`,
      num: k,
      label: SERIES[k] ?? `Series ${k}`,
      meta: `${fmtNum(counts.get(k)!)} specifications`,
      series: k,
      kids: true,
      target: { name: 'browse', params: { series: k } },
    }));
    return { key: 'root', kicker: '3GPP', title: 'All series', items };
  }

  private seriesLevel(k: string): Level {
    const items = this.specs
      .filter((s) => s.series === k)
      .sort((a, b) => byNumber(a.spec, b.spec))
      .map<Item>((s) => ({
        key: `spec:${s.spec}`,
        num: s.spec,
        label: s.title,
        badge: s.type,
        kids: s.sections > 0,
        target: { name: 'spec', spec: s.spec },
      }));
    return {
      key: `ser:${k}`,
      kicker: `Series ${k}`,
      title: SERIES[k] ?? `Series ${k}`,
      open: { name: 'browse', params: { series: k }, label: 'List' },
      items,
    };
  }

  private async toc(spec: string) {
    let t = this.tocs.get(spec);
    if (!t) {
      const d = await this.ctx.api.spec(spec);
      const nodes = new Map<string, TocNode>();
      const parent = new Map<string, string | null>();
      const walk = (ns: TocNode[], p: string | null) => {
        for (const n of ns) {
          if (nodes.has(n[0])) continue;
          nodes.set(n[0], n);
          parent.set(n[0], p);
          if (n[4]) walk(n[4], n[0]);
        }
      };
      walk(d.toc, null);
      t = { nodes, parent, root: d.toc.filter((n) => n[0] !== 'contents') };
      this.tocs.set(spec, t);
    }
    return t;
  }

  private nodeItems(spec: string, nodes: TocNode[]): Item[] {
    return nodes.map((n) => ({
      key: `sec:${spec}:${n[0]}`,
      num: n[1],
      label: n[2],
      meta: n[4]?.length ? `${n[4].length} subsections` : undefined,
      kids: !!n[4]?.length,
      target: { name: 'read', spec, sid: n[0] },
    }));
  }

  private async expand(item: Item): Promise<Level> {
    if (item.key.startsWith('ser:')) return this.seriesLevel(item.key.slice(4));
    const spec = item.target.spec!;
    const t = await this.toc(spec);
    if (item.key.startsWith('spec:')) {
      const s = this.specs.find((x) => x.spec === spec);
      return {
        key: item.key,
        kicker: `${s?.type ?? 'TS'} ${spec}`,
        title: s?.title ?? spec,
        open: { name: 'spec', spec, label: 'Overview' },
        items: this.nodeItems(spec, t.root),
      };
    }
    const n = t.nodes.get(item.target.sid!);
    return {
      key: item.key,
      kicker: `${spec}${n?.[1] ? ` § ${n[1]}` : ''}`,
      title: n?.[2] ?? '',
      open: { name: 'read', spec, sid: item.target.sid, label: 'Read' },
      items: this.nodeItems(spec, n?.[4] ?? []),
    };
  }

  /** open the menu at the given spec / section (or at the root) */
  private async reveal(spec?: string, sid?: string) {
    const levels: Level[] = [this.rootLevel()];
    const s = spec ? this.specs.find((x) => x.spec === spec) : undefined;
    if (s) {
      levels[0].selected = `ser:${s.series}`;
      const ser = this.seriesLevel(s.series);
      ser.selected = `spec:${s.spec}`;
      levels.push(ser);
      if (s.sections > 0) {
        try {
          const t = await this.toc(s.spec);
          const chain: string[] = [];
          let p = sid ? (t.nodes.has(sid) ? sid : null) : null;
          while (p) {
            chain.unshift(p);
            p = t.parent.get(p) ?? null;
          }
          let lvl = await this.expand(ser.items!.find((i) => i.key === ser.selected)!);
          levels.push(lvl);
          for (const id of chain) {
            const it = lvl.items?.find((i) => i.target.sid === id);
            if (!it) break;
            lvl.selected = it.key;
            if (!it.kids) break;
            lvl = await this.expand(it);
            levels.push(lvl);
          }
        } catch {
          /* show what we have */
        }
      }
    }
    this.levels = levels;
    await this.updateComplete;
    this.scrollToEnd(false);
    // focus the current item (or the first one) in the last column
    const last = this.levels.length - 1;
    const sel = this.renderRoot.querySelector<HTMLElement>(`.item.here[data-col="${last}"]`) ?? this.renderRoot.querySelector<HTMLElement>(`.item[data-col="${last}"]`);
    (sel ?? this.renderRoot.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true });
    sel?.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- interaction ---------------- */

  private async drill(col: number, item: Item, focus = false) {
    const head = this.levels.slice(0, col + 1);
    head[col] = { ...head[col], selected: item.key };
    const placeholder: Level = { key: item.key, kicker: '', title: item.label, items: null };
    this.levels = [...head, placeholder];
    this.filter = '';
    try {
      const lvl = await this.expand(item);
      if (this.levels[col + 1]?.key !== item.key) return; // user moved on
      this.levels = [...this.levels.slice(0, col + 1), lvl];
    } catch {
      this.levels = [...this.levels.slice(0, col + 1), { ...placeholder, items: [], error: 'Could not load the contents.' }];
    }
    await this.updateComplete;
    this.scrollToEnd(true);
    if (focus) this.focusItem(col + 1, 0);
  }

  private back() {
    if (this.levels.length < 2) return;
    const levels = this.levels.slice(0, -1);
    const last = levels.length - 1;
    const sel = levels[last].selected;
    levels[last] = { ...levels[last], selected: undefined };
    this.levels = levels;
    this.filter = '';
    this.updateComplete.then(() => {
      const idx = levels[last].items?.findIndex((i) => i.key === sel) ?? 0;
      this.focusItem(last, Math.max(0, idx));
    });
  }

  private crumbLabel(l: Level) {
    if (l.key.startsWith('ser:')) return `Series ${l.key.slice(4)}`;
    if (l.key.startsWith('spec:')) return l.kicker;
    const n = /§ (.+)$/.exec(l.kicker)?.[1];
    return n || l.title;
  }

  /** go back to level i: narrow — drop deeper columns; wide — bring the column into view */
  private jump(i: number) {
    if (this.clientWidth <= 700) {
      if (i >= this.levels.length - 1) return;
      const sel = this.levels[i].selected;
      this.levels = this.levels.slice(0, i + 1).map((l, k) => (k === i ? { ...l, selected: undefined } : l));
      this.filter = '';
      this.updateComplete.then(() => {
        const idx = this.levels[i].items?.findIndex((x) => x.key === sel) ?? 0;
        this.focusItem(i, Math.max(0, idx));
      });
      return;
    }
    const col = this.renderRoot.querySelectorAll<HTMLElement>('.col')[i];
    const cols = this.renderRoot.querySelector<HTMLElement>('.cols');
    if (col && cols) cols.scrollTo({ left: col.offsetLeft - cols.offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const idx = this.visibleItems(i).findIndex((x) => x.key === this.levels[i].selected);
    this.focusItem(i, Math.max(0, idx));
  }

  private scrollToEnd(smooth: boolean) {
    const cols = this.renderRoot.querySelector<HTMLElement>('.cols');
    if (!cols) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    cols.scrollTo({ left: cols.scrollWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

  private focusItem(col: number, i: number) {
    const el = this.renderRoot.querySelector<HTMLElement>(`.item[data-col="${col}"][data-i="${i}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }

  private close(restoreFocus = false) {
    this.dispatchEvent(new CustomEvent('se-close', { detail: { restoreFocus }, bubbles: true, composed: true }));
  }

  private onKey = (e: KeyboardEvent) => {
    const el = e.composedPath()[0] as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.filter) this.filter = '';
      else this.close(true);
      return;
    }
    const last = this.levels.length - 1;
    if (el.tagName === 'INPUT') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusItem(last, 0);
      }
      return;
    }
    if (!el.classList?.contains('item')) return;
    const col = Number(el.dataset.col);
    const i = Number(el.dataset.i);
    const items = this.visibleItems(col);
    const narrow = this.clientWidth <= 700;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.focusItem(col, Math.min(items.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (i === 0 && col === last) this.renderRoot.querySelector<HTMLElement>('input')?.focus();
        else this.focusItem(col, Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        this.focusItem(col, 0);
        break;
      case 'End':
        e.preventDefault();
        this.focusItem(col, items.length - 1);
        break;
      case 'ArrowRight': {
        const it = items[i];
        if (it?.kids) {
          e.preventDefault();
          if (this.levels[col].selected === it.key && this.levels[col + 1]?.items) this.focusItem(col + 1, 0);
          else this.drill(col, it, true);
        }
        break;
      }
      case 'ArrowLeft':
        if (col > 0) {
          e.preventDefault();
          if (narrow) this.back();
          else {
            const prev = this.visibleItems(col - 1).findIndex((x) => x.key === this.levels[col - 1].selected);
            this.focusItem(col - 1, Math.max(0, prev));
          }
        }
        break;
    }
  };

  private visibleItems(col: number): Item[] {
    const items = this.levels[col]?.items ?? [];
    if (col !== this.levels.length - 1 || !this.filter.trim()) return items;
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const hay = `${it.num} ${it.label}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  private isHere(it: Item) {
    const c = this.current;
    if (!c.spec) return false;
    if (it.target.name === 'spec') return it.target.spec === c.spec && !c.sid;
    if (it.target.name === 'read') return it.target.spec === c.spec && it.target.sid === c.sid?.toLowerCase();
    return false;
  }

  /* ---------------- render ---------------- */

  private renderItem(col: number, it: Item, i: number) {
    const lead = it.series
      ? html`<span class="ic">${icon(SERIES_ICON[it.series] ?? 'folder', 'sm')}</span><span class="n">${it.num}</span>`
      : it.num
        ? html`<span class="n">${it.num}</span>`
        : nothing;
    const body = html`${lead}<span class="l">${it.label}${it.meta ? html`<span class="m">${it.meta}</span>` : nothing}</span>
      ${it.badge ? html`<span class="badge ${it.badge.toLowerCase()}">${it.badge}</span>` : nothing}`;
    const here = this.isHere(it) ? 'here' : '';
    if (it.kids) {
      const open = this.levels[col].selected === it.key;
      return html`<li>
        <button class="item ${here}" data-col=${col} data-i=${i} aria-expanded=${open ? 'true' : 'false'} @click=${() => this.drill(col, it, false)}>
          ${body}${icon('chevronRight', 'chev')}
        </button>
      </li>`;
    }
    return html`<li>
      <a
        class="item ${here}"
        data-col=${col}
        data-i=${i}
        href=${this.ctx.href(it.target.name, it.target)}
        aria-current=${here ? 'page' : nothing}
        @click=${linkClick(this.ctx, it.target.name, it.target)}
        >${body}</a
      >
    </li>`;
  }

  private renderCol(lvl: Level, col: number) {
    const items = this.visibleItems(col);
    const isLast = col === this.levels.length - 1;
    return html`<section class="col" aria-label=${lvl.title || lvl.kicker}>
      <div class="col-head">
        ${col > 0 ? html`<button class="btn ghost icon-only back" aria-label="Back" title="Back" @click=${() => this.back()}>${icon('arrowLeft', 'sm')}</button>` : nothing}
        <div class="ttl">
          <span class="k">${lvl.kicker || ' '}</span>
          <span class="t" title=${lvl.title}>${lvl.title}</span>
        </div>
        ${lvl.open
          ? html`<a class="btn open" href=${this.ctx.href(lvl.open.name, lvl.open)} @click=${linkClick(this.ctx, lvl.open.name, lvl.open)}
              >${lvl.open.label} ${icon('arrowRight', 'sm')}</a
            >`
          : nothing}
      </div>
      ${lvl.items === null
        ? html`<div aria-busy="true">${[70, 90, 60, 80, 50].map((w) => html`<div class="skel" style="width:${w}%"></div>`)}</div>`
        : lvl.error
          ? html`<div class="state">${lvl.error}</div>`
          : items.length === 0
            ? html`<div class="state">${isLast && this.filter ? `Nothing matches “${this.filter}”.` : 'No subsections.'}</div>`
            : html`<ul>
                ${items.map((it, i) => this.renderItem(col, it, i))}
              </ul>`}
    </section>`;
  }

  protected updated(ch: PropertyValues) {
    if (ch.has('current') && ch.get('current') !== undefined && this.specs.length) this.reveal(this.current.spec, this.current.sid);
  }

  render() {
    const last = this.levels[this.levels.length - 1];
    return html`<div class="top" @keydown=${this.onKey}>
        <label class="input">
          ${icon('search', 'sm')}
          <input
            type="search"
            placeholder=${last ? `Filter ${last.title || 'list'}…` : 'Filter…'}
            aria-label="Filter the current list"
            .value=${this.filter}
            @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          />
        </label>
        <a class="btn ghost all" href=${this.ctx.href('browse')} @click=${linkClick(this.ctx, 'browse')}>${icon('library', 'sm')}<span>All specifications</span></a>
        <button class="btn ghost icon-only" aria-label="Close menu" title="Close" @click=${() => this.close(true)}>${icon('x', 'sm')}</button>
      </div>
      <nav class="path" aria-label="Menu path">
        ${this.levels.map(
          (l, i) =>
            html`${i ? icon('chevronRight', 'sep') : nothing}<button class="crumb" aria-current=${i === this.levels.length - 1 ? 'location' : nothing} @click=${() => this.jump(i)}>
                ${i === 0 ? 'All series' : this.crumbLabel(l)}
              </button>`,
        )}
      </nav>
      <div class="cols" @keydown=${this.onKey}>${this.levels.map((l, i) => this.renderCol(l, i))}</div>`;
  }
}
customElements.get('se-navmenu') || customElements.define('se-navmenu', SeNavMenu);
