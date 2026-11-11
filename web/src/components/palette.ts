import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from '../styles/tokens.ts';
import { icon, type IconName } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import type { Suggestions } from '../lib/api.ts';
import { store } from '../lib/store.ts';
import { debounce, releaseName } from '../lib/format.ts';

interface Item {
  kind: 'spec' | 'section' | 'search' | 'recent' | 'query';
  icon: IconName;
  label: string;
  sub?: string;
  badge?: string;
  run: () => void;
}

const POPULAR = [
  ['38.331', 'NR RRC protocol'],
  ['38.300', 'NR & NG-RAN overall description'],
  ['23.501', '5G system architecture'],
  ['24.501', '5GS NAS protocol'],
  ['38.211', 'NR physical channels & modulation'],
  ['36.331', 'LTE RRC protocol'],
];

/** ⌘K command palette: specs, sections and full-text search in one keyboard-first dialog. */
export class SePalette extends LitElement {
  static properties = {
    ctx: { attribute: false },
    open: { type: Boolean, reflect: true },
    q: { state: true },
    sugg: { state: true },
    active: { state: true },
    loading: { state: true },
  };
  declare ctx: Ctx;
  declare open: boolean;
  declare q: string;
  declare sugg: Suggestions | null;
  declare active: number;
  declare loading: boolean;
  private abort?: AbortController;
  private returnFocus: Element | null = null;

  constructor() {
    super();
    this.open = false;
    this.q = '';
    this.sugg = null;
    this.active = 0;
    this.loading = false;
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        position: absolute;
        inset: 0;
        z-index: 100;
        display: none;
      }
      :host([open]) {
        display: block;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: var(--c-overlay);
        backdrop-filter: blur(2px);
        animation: fade 140ms var(--_ease);
      }
      .dialog {
        position: absolute;
        left: 50%;
        top: min(12vh, 96px);
        transform: translateX(-50%);
        width: min(680px, calc(100% - 24px));
        max-height: min(560px, calc(100% - 120px));
        display: flex;
        flex-direction: column;
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: 14px;
        box-shadow: var(--c-shadow-lg);
        overflow: hidden;
        animation: pop 160ms var(--_ease);
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
      }
      @keyframes pop {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-6px) scale(0.985);
        }
      }
      .field {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        height: 56px;
        border-bottom: 1px solid var(--c-border);
        color: var(--c-muted);
      }
      .field input {
        flex: 1;
        border: 0;
        outline: 0;
        background: transparent;
        font: inherit;
        font-size: 17px;
        color: var(--c-text);
      }
      .field input::placeholder {
        color: var(--c-muted);
      }
      .spinner {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--c-border-strong);
        border-top-color: var(--c-accent);
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .results {
        flex: 1;
        min-height: 0;
        padding: 6px;
      }
      .group {
        padding: 10px 10px 4px;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--c-muted);
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        padding: 8px 10px;
        border: 0;
        border-radius: 8px;
        background: none;
        text-align: left;
        cursor: pointer;
        color: var(--c-text-2);
      }
      .item .ic {
        flex: none;
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: var(--c-surface-3);
        color: var(--c-muted);
      }
      .item[aria-selected='true'] {
        background: var(--c-accent-soft);
        color: var(--c-text);
      }
      .item[aria-selected='true'] .ic {
        background: var(--c-accent);
        color: var(--c-on-accent);
      }
      .item .body {
        flex: 1;
        min-width: 0;
      }
      .item .label {
        display: block;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item .label b {
        font-family: var(--_mono);
        font-weight: 600;
        margin-right: 6px;
        color: var(--c-text);
      }
      .item .sub {
        display: block;
        font-size: 12px;
        color: var(--c-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item .enter {
        opacity: 0;
        color: var(--c-accent-text);
      }
      .item[aria-selected='true'] .enter {
        opacity: 1;
      }
      .foot {
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 10px 16px;
        border-top: 1px solid var(--c-border);
        font-size: 12px;
        color: var(--c-muted);
        background: var(--c-surface-2);
      }
      .foot span {
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .none {
        padding: 28px 16px;
        text-align: center;
        color: var(--c-muted);
        font-size: 14px;
      }
      @media (max-width: 640px) {
        .dialog {
          top: 8px;
          max-height: calc(100% - 16px);
        }
        .foot {
          display: none;
        }
      }
    `,
  ];

  show(initial = '') {
    this.returnFocus = (this.getRootNode() as ShadowRoot).activeElement ?? document.activeElement;
    this.open = true;
    this.q = initial;
    this.active = 0;
    if (initial) this.fetch(initial);
    else this.sugg = null;
    this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector('input');
      input?.focus();
      input?.select();
    });
  }

  hide() {
    this.open = false;
    this.abort?.abort();
    (this.returnFocus as HTMLElement | null)?.focus?.();
  }

  private fetch = debounce(async (q: string) => {
    this.abort?.abort();
    if (!q.trim()) {
      this.sugg = null;
      this.loading = false;
      return;
    }
    this.abort = new AbortController();
    this.loading = true;
    try {
      this.sugg = await this.ctx.api.suggest(q, this.abort.signal);
      this.active = 0;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.sugg = { specs: [], sections: [] };
    } finally {
      this.loading = false;
    }
  }, 110);

  private runSearch(q = this.q) {
    store.pushQuery(q);
    this.hide();
    this.ctx.go('search', { params: { q } });
  }

  private items(): { group: string; items: Item[] }[] {
    const q = this.q.trim();
    const go = (spec: string, sid?: string) => () => {
      this.hide();
      if (sid) this.ctx.go('read', { spec, sid });
      else this.ctx.go('spec', { spec });
    };
    if (!q) {
      const groups: { group: string; items: Item[] }[] = [];
      const recent = store.recent.slice(0, 5);
      if (recent.length)
        groups.push({
          group: 'Recently viewed',
          items: recent.map((r) => ({
            kind: 'recent',
            icon: r.sid ? 'file' : 'book',
            label: r.sid ? `${r.num ? r.num + ' ' : ''}${r.title}` : r.title,
            badge: r.spec,
            sub: r.sid ? r.specTitle : undefined,
            run: go(r.spec, r.sid),
          })),
        });
      const qs = store.recentQueries.slice(0, 4);
      if (qs.length) groups.push({ group: 'Recent searches', items: qs.map((x) => ({ kind: 'query', icon: 'history', label: x, run: () => this.runSearch(x) })) });
      groups.push({
        group: 'Popular specifications',
        items: POPULAR.map(([spec, t]) => ({ kind: 'spec', icon: 'book', label: t, badge: spec, run: go(spec) })),
      });
      return groups;
    }
    const s = this.sugg;
    const specs: Item[] = (s?.specs ?? []).slice(0, 5).map((x) => ({
      kind: 'spec',
      icon: 'book',
      label: x.title,
      badge: x.spec,
      sub: `${x.type} · ${releaseName(x.release)}`,
      run: go(x.spec),
    }));
    const sections: Item[] = (s?.sections ?? []).slice(0, 8).map((x) => ({
      kind: 'section',
      icon: 'hash',
      label: `${x.num ? x.num + '  ' : ''}${x.title}`,
      badge: x.spec,
      sub: x.specTitle,
      run: go(x.spec, x.sid),
    }));
    const searchItem: Item = { kind: 'search', icon: 'textSearch', label: `Search all specifications for “${q}”`, sub: 'Full-text search with filters', run: () => this.runSearch() };
    const specFirst = /^\s*(t[sr]\s*)?\d{2}[.\s]?\d/i.test(q);
    const groups = specFirst
      ? [
          { group: 'Specifications', items: specs },
          { group: 'Sections', items: sections },
          { group: 'Full text', items: [searchItem] },
        ]
      : [
          { group: 'Full text', items: [searchItem] },
          { group: 'Sections', items: sections },
          { group: 'Specifications', items: specs },
        ];
    return groups.filter((g) => g.items.length);
  }

  private onKey(e: KeyboardEvent, flat: Item[]) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active = (this.active + 1) % Math.max(flat.length, 1);
      this.scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = (this.active - 1 + flat.length) % Math.max(flat.length, 1);
      this.scrollActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && this.q.trim()) this.runSearch();
      else flat[this.active]?.run();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // keep focus inside the dialog
      this.active = (this.active + (e.shiftKey ? -1 : 1) + flat.length) % Math.max(flat.length, 1);
      this.scrollActive();
    }
  }

  private scrollActive() {
    this.updateComplete.then(() => this.renderRoot.querySelector('.item[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  }

  render() {
    if (!this.open) return nothing;
    const groups = this.items();
    const flat = groups.flatMap((g) => g.items);
    let i = -1;
    return html`
      <div class="backdrop" @click=${() => this.hide()}></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Search specifications">
        <div class="field">
          ${this.loading ? html`<div class="spinner" aria-hidden="true"></div>` : icon('search', 'lg')}
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant=${flat.length ? `pal-${this.active}` : nothing}
            aria-label="Search specifications, sections or text"
            placeholder="Search specs, sections, or text — try “38.331 5.3.3”"
            autocomplete="off"
            spellcheck="false"
            .value=${this.q}
            @input=${(e: Event) => {
              this.q = (e.target as HTMLInputElement).value;
              this.active = 0;
              this.fetch(this.q);
            }}
            @keydown=${(e: KeyboardEvent) => this.onKey(e, flat)}
          />
          <button class="btn icon-only ghost" aria-label="Close" @click=${() => this.hide()}>${icon('x')}</button>
        </div>
        <div class="results scroll" id="pal-list" role="listbox">
          ${groups.length === 0 && !this.loading ? html`<div class="none">No matches. Press Enter to search the full text.</div>` : nothing}
          ${groups.map(
            (g) => html`<div class="group" role="presentation">${g.group}</div>
              ${g.items.map((it) => {
                i++;
                const idx = i;
                return html`<button
                  class="item"
                  id="pal-${idx}"
                  role="option"
                  aria-selected=${idx === this.active ? 'true' : 'false'}
                  @mousemove=${() => this.active !== idx && (this.active = idx)}
                  @click=${() => it.run()}
                >
                  <span class="ic">${icon(it.icon, 'sm')}</span>
                  <span class="body">
                    <span class="label">${it.badge ? html`<b>${it.badge}</b>` : nothing}${it.label}</span>
                    ${it.sub ? html`<span class="sub">${it.sub}</span>` : nothing}
                  </span>
                  <span class="enter">${icon('enter', 'sm')}</span>
                </button>`;
              })}`,
          )}
        </div>
        <div class="foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Ctrl</kbd><kbd>↵</kbd> full-text search</span>
          <span style="margin-left:auto"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    `;
  }
}
customElements.get('se-palette') || customElements.define('se-palette', SePalette);
