import { LitElement, html, css, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../styles/tokens.ts';
import { icon } from '../lib/icons.ts';
import type { TocNode } from '../lib/api.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';

interface Row {
  node: TocNode;
  depth: number;
  path: string[];
}

/** Collapsible, filterable table-of-contents tree. */
export class SeToc extends LitElement {
  static properties = {
    toc: { attribute: false },
    spec: {},
    active: {},
    ctx: { attribute: false },
    filter: { state: true },
    expanded: { state: true },
  };
  declare toc: TocNode[];
  declare spec: string;
  declare active: string | undefined;
  declare ctx: Ctx;
  declare filter: string;
  declare expanded: Set<string>;
  private parentOf = new Map<string, string | null>();
  private total = 0;
  private lastToc?: TocNode[];

  constructor() {
    super();
    this.toc = [];
    this.filter = '';
    this.expanded = new Set();
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      .head {
        display: flex;
        gap: 6px;
        padding: 12px 12px 8px;
        position: sticky;
        top: 0;
        z-index: 1;
        background: inherit;
      }
      .head .input {
        flex: 1;
        height: 34px;
      }
      .list {
        flex: 1;
        min-height: 0;
        padding: 0 8px 24px;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .row {
        display: flex;
        align-items: flex-start;
        gap: 2px;
        border-radius: 6px;
        position: relative;
        content-visibility: auto;
        contain-intrinsic-size: auto 32px;
      }
      .row:hover {
        background: var(--c-surface-3);
      }
      .row.active {
        background: var(--c-accent-soft);
      }
      .tw {
        flex: none;
        width: 22px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 0;
        background: none;
        color: var(--c-muted);
        cursor: pointer;
        border-radius: 4px;
        padding: 0;
      }
      .tw .icon {
        width: 14px;
        height: 14px;
        transition: transform var(--_dur) var(--_ease);
      }
      .tw[aria-expanded='true'] .icon {
        transform: rotate(90deg);
      }
      .tw:hover {
        color: var(--c-text);
      }
      .tw.leaf {
        cursor: default;
      }
      a {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: 8px;
        padding: 6px 8px 6px 0;
        color: var(--c-text-2);
        font-size: 13.5px;
        line-height: 1.4;
      }
      .row.active a {
        color: var(--c-accent-text);
        font-weight: 500;
      }
      .row.empty a .t {
        color: var(--c-muted);
      }
      .n {
        flex: none;
        font-family: var(--_mono);
        font-size: 12px;
        color: var(--c-muted);
        padding-top: 1px;
        min-width: 2ch;
      }
      .row.active .n {
        color: var(--c-accent-text);
      }
      .t {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .path {
        display: block;
        font-size: 11.5px;
        color: var(--c-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .empty-state {
        padding: 24px 12px;
        color: var(--c-muted);
        font-size: 13px;
        text-align: center;
      }
      .more {
        padding: 8px 12px;
        font-size: 12px;
        color: var(--c-muted);
      }
    `,
  ];

  private index() {
    if (this.lastToc === this.toc) return;
    this.lastToc = this.toc;
    this.parentOf.clear();
    this.total = 0;
    const walk = (nodes: TocNode[], parent: string | null) => {
      for (const n of nodes) {
        this.total++;
        this.parentOf.set(n[0], parent);
        if (n[4]) walk(n[4], n[0]);
      }
    };
    walk(this.toc, null);
  }

  willUpdate(changed: Map<string, unknown>) {
    this.index();
    if ((changed.has('active') || changed.has('toc')) && this.active) {
      // expand ancestors of the active section
      const next = new Set(this.expanded);
      let p = this.parentOf.get(this.active) ?? null;
      let guard = 0;
      while (p && guard++ < 30) {
        next.add(p);
        p = this.parentOf.get(p) ?? null;
      }
      this.expanded = next;
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('active') || changed.has('toc')) {
      requestAnimationFrame(() => {
        const el = this.renderRoot.querySelector('.row.active') as HTMLElement | null;
        const list = this.renderRoot.querySelector('.list') as HTMLElement | null;
        if (el && list) {
          const r = el.getBoundingClientRect();
          const lr = list.getBoundingClientRect();
          if (r.top < lr.top + 40 || r.bottom > lr.bottom - 20) list.scrollTop += r.top - lr.top - lr.height / 3;
        }
      });
    }
  }

  private toggle(id: string) {
    const next = new Set(this.expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded = next;
  }

  expandAll() {
    const all = new Set<string>();
    const walk = (nodes: TocNode[]) => nodes.forEach((n) => n[4]?.length && (all.add(n[0]), walk(n[4])));
    walk(this.toc);
    this.expanded = all;
  }

  collapseAll() {
    this.expanded = new Set();
  }

  private visibleRows(): Row[] {
    const rows: Row[] = [];
    const walk = (nodes: TocNode[], depth: number) => {
      for (const n of nodes) {
        rows.push({ node: n, depth, path: [] });
        if (n[4]?.length && this.expanded.has(n[0])) walk(n[4], depth + 1);
      }
    };
    walk(this.toc, 0);
    return rows;
  }

  private filteredRows(): Row[] {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const rows: Row[] = [];
    const walk = (nodes: TocNode[], path: string[]) => {
      for (const n of nodes) {
        const hay = `${n[1]} ${n[2]}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) rows.push({ node: n, depth: 0, path });
        if (rows.length >= 300) return;
        if (n[4]) walk(n[4], [...path, n[1] || n[2]]);
      }
    };
    walk(this.toc, []);
    return rows;
  }

  render() {
    const filtering = this.filter.trim().length > 0;
    const rows = filtering ? this.filteredRows() : this.visibleRows();
    return html`
      <div class="head">
        <label class="input">
          ${icon('search', 'sm')}
          <input
            type="search"
            placeholder="Filter ${this.total.toLocaleString()} sections"
            aria-label="Filter table of contents"
            .value=${this.filter}
            @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Escape') this.filter = '';
            }}
          />
        </label>
        <button class="btn icon-only ghost" title="Expand all" aria-label="Expand all" ?disabled=${this.total > 6000} @click=${() => this.expandAll()}>
          ${icon('expand', 'sm')}
        </button>
        <button class="btn icon-only ghost" title="Collapse all" aria-label="Collapse all" @click=${() => this.collapseAll()}>${icon('collapse', 'sm')}</button>
      </div>
      <nav class="list scroll" aria-label="Table of contents">
        ${rows.length === 0
          ? html`<div class="empty-state">${this.filter ? `No sections match “${this.filter}”.` : 'No sections.'}</div>`
          : html`<ul role="tree">
              ${repeat(
                rows,
                (r) => r.node[0] + (filtering ? '|f' : ''),
                (r) => this.renderRow(r, filtering),
              )}
            </ul>`}
        ${filtering && rows.length >= 300 ? html`<div class="more">Showing first 300 matches — refine the filter.</div>` : nothing}
      </nav>
    `;
  }

  private renderRow(r: Row, filtering: boolean) {
    const [id, num, title, flags, kids] = r.node;
    const hasKids = !!kids?.length;
    const open = this.expanded.has(id);
    const active = id === this.active;
    return html`<li
      class="row ${active ? 'active' : ''} ${flags ? '' : 'empty'}"
      role="treeitem"
      aria-level=${r.depth + 1}
      aria-expanded=${hasKids && !filtering ? String(open) : nothing}
      aria-selected=${active ? 'true' : 'false'}
      style="padding-left:${filtering ? 4 : r.depth * 14 + 2}px"
    >
      ${filtering
        ? nothing
        : html`<button
            class="tw ${hasKids ? '' : 'leaf'}"
            tabindex=${hasKids ? 0 : -1}
            aria-label=${hasKids ? (open ? 'Collapse' : 'Expand') + ' ' + title : ''}
            aria-expanded=${hasKids ? String(open) : nothing}
            @click=${() => hasKids && this.toggle(id)}
          >
            ${hasKids ? icon('chevronRight') : nothing}
          </button>`}
      <a
        href=${this.ctx.href('read', { spec: this.spec, sid: id })}
        @click=${linkClick(this.ctx, 'read', { spec: this.spec, sid: id })}
        aria-current=${active ? 'page' : nothing}
      >
        ${num ? html`<span class="n">${num}</span>` : nothing}
        <span class="t">${title}${filtering && r.path.length ? html`<span class="path">${r.path.join(' › ')}</span>` : nothing}</span>
      </a>
    </li>`;
  }
}
customElements.get('se-toc') || customElements.define('se-toc', SeToc);
