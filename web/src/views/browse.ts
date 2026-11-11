import { LitElement, html, css, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { tokens, base } from '../styles/tokens.ts';
import { icon } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import type { SpecSummary } from '../lib/api.ts';
import { SERIES, fmtNum, relName } from '../lib/format.ts';

const PAGE = 120;

/** Catalogue of all specifications with series / release / type filters. */
export class SeBrowse extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    specs: { state: true },
    shown: { state: true },
    error: { state: true },
  };
  declare ctx: Ctx;
  declare params: URLSearchParams;
  declare specs: SpecSummary[] | null;
  declare shown: number;
  declare error: string;
  private io?: IntersectionObserver;

  constructor() {
    super();
    this.specs = null;
    this.shown = PAGE;
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.ctx.api
      .specs()
      .then((s) => (this.specs = s))
      .catch((e) => (this.error = String(e.message ?? e)));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.io?.disconnect();
  }

  willUpdate(ch: Map<string, unknown>) {
    if (ch.has('params')) this.shown = PAGE;
  }

  updated() {
    const s = this.renderRoot.querySelector('.sentinel');
    if (!s) return;
    this.io?.disconnect();
    this.io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) this.shown += PAGE;
    }, { root: this.renderRoot.querySelector('.main'), rootMargin: '600px' });
    this.io.observe(s);
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .layout {
        display: grid;
        grid-template-columns: 272px 1fr;
        height: 100%;
      }
      .rail {
        border-right: 1px solid var(--c-border);
        background: var(--c-surface-2);
        padding: 20px 14px 40px;
      }
      .rail h3 {
        margin: 22px 8px 8px;
        font-size: 11.5px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--c-muted);
        font-weight: 600;
      }
      .opt {
        display: flex;
        align-items: baseline;
        gap: 10px;
        width: 100%;
        min-height: 34px;
        padding: 6px 10px;
        border: 0;
        border-radius: 7px;
        background: none;
        text-align: left;
        cursor: pointer;
        color: var(--c-text-2);
        font-size: 13.5px;
      }
      .opt:hover {
        background: var(--c-surface-3);
      }
      .opt[aria-pressed='true'] {
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
        font-weight: 500;
      }
      .opt .k {
        font-family: var(--_mono);
        font-size: 12px;
        color: var(--c-muted);
        min-width: 2ch;
      }
      .opt[aria-pressed='true'] .k {
        color: inherit;
      }
      .opt .l {
        flex: 1;
        min-width: 0;
        line-height: 1.3;
      }
      .opt .c {
        font-size: 12px;
        color: var(--c-muted);
        font-variant-numeric: tabular-nums;
      }
      .seg {
        display: flex;
        padding: 3px;
        gap: 3px;
        border-radius: 9px;
        background: var(--c-surface-3);
        margin: 0 4px;
      }
      .seg button {
        flex: 1;
        height: 30px;
        border: 0;
        border-radius: 7px;
        background: none;
        cursor: pointer;
        font-size: 13px;
        color: var(--c-muted);
      }
      .seg button[aria-pressed='true'] {
        background: var(--c-surface);
        color: var(--c-text);
        box-shadow: var(--c-shadow);
        font-weight: 500;
      }
      .rels {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 0 4px;
      }
      .rels .chip {
        min-height: 28px;
        padding: 0 10px;
        font-size: 12.5px;
      }
      .main {
        min-width: 0;
        height: 100%;
      }
      .top {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        padding: 16px 28px;
        background: color-mix(in srgb, var(--c-bg) 88%, transparent);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--c-border);
      }
      .top .input {
        flex: 1;
        min-width: 220px;
        max-width: 460px;
      }
      .top h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .top .count {
        color: var(--c-muted);
        font-size: 13.5px;
      }
      .active-filters {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 8px 16px 40px;
      }
      li a {
        display: grid;
        grid-template-columns: 112px 1fr auto;
        gap: 16px;
        align-items: center;
        padding: 14px 12px;
        border-radius: 10px;
        color: inherit;
        border-bottom: 1px solid var(--c-border);
      }
      li a:hover {
        background: var(--c-surface);
        box-shadow: 0 0 0 1px var(--c-border);
        border-bottom-color: transparent;
      }
      .sid {
        font-family: var(--_mono);
        font-weight: 600;
        font-size: 14px;
        color: var(--c-text);
      }
      .title {
        font-size: 14.5px;
        line-height: 1.45;
        color: var(--c-text-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .meta {
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .secs {
        font-size: 12px;
        color: var(--c-muted);
        min-width: 9ch;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .none {
        padding: 64px 24px;
        text-align: center;
        color: var(--c-muted);
      }
      .none .icon {
        width: 32px;
        height: 32px;
        margin-bottom: 8px;
      }
      .mobile-filters {
        display: none;
      }
      select {
        height: 36px;
        border: 1px solid var(--c-border);
        border-radius: 8px;
        background: var(--c-surface);
        color: var(--c-text);
        font: inherit;
        font-size: 13.5px;
        padding: 0 8px;
      }
      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .rail {
          display: none;
        }
        .mobile-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          width: 100%;
        }
        .top {
          padding: 12px 16px;
        }
        ul {
          padding: 4px 8px 32px;
        }
        li a {
          grid-template-columns: 1fr;
          gap: 6px;
        }
        .meta {
          justify-content: flex-start;
        }
        .secs {
          text-align: left;
        }
      }
    `,
  ];

  private set(key: string, value: string | undefined) {
    const p: Record<string, string> = {};
    for (const [k, v] of this.params.entries()) p[k] = v;
    if (value === undefined || value === '' || p[key] === value) delete p[key];
    else p[key] = value;
    this.ctx.go('browse', { params: p, replace: true });
  }

  private filtered(): SpecSummary[] {
    const all = this.specs ?? [];
    const series = this.params.get('series');
    const rel = this.params.get('rel');
    const type = this.params.get('type');
    const words = (this.params.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(
      (s) =>
        (!series || s.series === series) &&
        (!rel || String(s.rel) === rel) &&
        (!type || s.type === type) &&
        (!words.length || words.every((w) => `${s.spec} ${s.title} ${s.tsg}`.toLowerCase().includes(w))),
    );
  }

  render() {
    if (this.error) return html`<div class="none">${icon('info')}<p>Could not load specifications: ${this.error}</p></div>`;
    const all = this.specs ?? [];
    const list = this.filtered();
    const series = this.params.get('series') ?? '';
    const rel = this.params.get('rel') ?? '';
    const type = this.params.get('type') ?? '';
    const q = this.params.get('q') ?? '';
    // counts within the other active filters
    const base = all.filter((s) => (!type || s.type === type) && (!rel || String(s.rel) === rel));
    const seriesCounts = new Map<string, number>();
    for (const s of base) seriesCounts.set(s.series, (seriesCounts.get(s.series) ?? 0) + 1);
    const relCounts = new Map<number, number>();
    for (const s of all.filter((s) => (!type || s.type === type) && (!series || s.series === series))) relCounts.set(s.rel, (relCounts.get(s.rel) ?? 0) + 1);
    const rels = [...relCounts.keys()].sort((a, b) => b - a);

    return html`<div class="layout">
      <aside class="rail scroll" aria-label="Filters">
        <h3 style="margin-top:4px">Type</h3>
        <div class="seg" role="group" aria-label="Document type">
          ${[
            ['', 'All'],
            ['TS', 'TS'],
            ['TR', 'TR'],
          ].map(([v, l]) => html`<button aria-pressed=${type === v} @click=${() => this.set('type', v || undefined)}>${l}</button>`)}
        </div>
        <h3>Release</h3>
        <div class="rels">
          ${rels.map((r) => html`<button class="chip" aria-pressed=${rel === String(r)} @click=${() => this.set('rel', String(r))}>${relName(r)}<span class="count">${relCounts.get(r)}</span></button>`)}
        </div>
        <h3>Series</h3>
        <button class="opt" aria-pressed=${!series} @click=${() => this.set('series', undefined)}><span class="l">All series</span><span class="c">${fmtNum(base.length)}</span></button>
        ${Object.entries(SERIES)
          .filter(([k]) => seriesCounts.has(k) || series === k)
          .map(
            ([k, name]) => html`<button class="opt" aria-pressed=${series === k} @click=${() => this.set('series', k)}>
              <span class="k">${k}</span><span class="l">${name}</span><span class="c">${seriesCounts.get(k) ?? 0}</span>
            </button>`,
          )}
      </aside>
      <div class="main scroll">
        <div class="top">
          <h1>Specifications</h1>
          <span class="count">${this.specs ? `${fmtNum(list.length)} of ${fmtNum(all.length)}` : 'Loading…'}</span>
          <label class="input">
            ${icon('search', 'sm')}
            <input
              type="search"
              placeholder="Filter by number or title…"
              aria-label="Filter specifications"
              .value=${q}
              @input=${(e: Event) => this.set('q', (e.target as HTMLInputElement).value || undefined)}
            />
          </label>
          <div class="mobile-filters">
            <select aria-label="Series" @change=${(e: Event) => this.set('series', (e.target as HTMLSelectElement).value || undefined)}>
              <option value="">All series</option>
              ${Object.entries(SERIES).map(([k, n]) => html`<option value=${k} ?selected=${series === k}>${k} – ${n}</option>`)}
            </select>
            <select aria-label="Release" @change=${(e: Event) => this.set('rel', (e.target as HTMLSelectElement).value || undefined)}>
              <option value="">All releases</option>
              ${rels.map((r) => html`<option value=${r} ?selected=${rel === String(r)}>${relName(r)}</option>`)}
            </select>
            <select aria-label="Type" @change=${(e: Event) => this.set('type', (e.target as HTMLSelectElement).value || undefined)}>
              <option value="">TS + TR</option>
              <option value="TS" ?selected=${type === 'TS'}>TS only</option>
              <option value="TR" ?selected=${type === 'TR'}>TR only</option>
            </select>
          </div>
          ${series || rel || type
            ? html`<div class="active-filters">
                ${series ? html`<button class="chip" aria-pressed="true" @click=${() => this.set('series', undefined)}>Series ${series} ${icon('x', 'sm')}</button>` : nothing}
                ${rel ? html`<button class="chip" aria-pressed="true" @click=${() => this.set('rel', undefined)}>${relName(rel)} ${icon('x', 'sm')}</button>` : nothing}
                ${type ? html`<button class="chip" aria-pressed="true" @click=${() => this.set('type', undefined)}>${type} ${icon('x', 'sm')}</button>` : nothing}
              </div>`
            : nothing}
        </div>
        ${!this.specs
          ? html`<ul>
              ${Array.from({ length: 12 }, () => html`<li><a><span class="skel" style="height:18px"></span><span class="skel" style="height:18px"></span><span></span></a></li>`)}
            </ul>`
          : list.length === 0
            ? html`<div class="none">${icon('searchX')}<p>No specifications match these filters.</p></div>`
            : html`<ul>
                ${repeat(
                  list.slice(0, this.shown),
                  (s) => s.spec,
                  (s) => html`<li>
                    <a href=${this.ctx.href('spec', { spec: s.spec })} @click=${linkClick(this.ctx, 'spec', { spec: s.spec })}>
                      <span class="sid">${s.spec}</span>
                      <span class="title">${s.title}</span>
                      <span class="meta">
                        <span class="badge ${s.type.toLowerCase()}">${s.type}</span>
                        <span class="badge">${relName(s.rel)}</span>
                        ${s.source === 'archive'
                          ? html`<span class="badge outline" title=${`Converted from the official 3GPP archive${s.status ? ` · ${s.status}` : ''}`}
                              >${s.status && /withdrawn/i.test(s.status) ? 'Withdrawn' : 'Archive'}</span
                            >`
                          : nothing}
                        ${s.version ? html`<span class="badge outline mono">v${s.version}</span>` : nothing}
                        <span class="secs">${s.available ? `${fmtNum(s.sections)} §` : 'TOC only'}</span>
                      </span>
                    </a>
                  </li>`,
                )}
                ${this.shown < list.length ? html`<li class="sentinel" aria-hidden="true" style="height:1px"></li>` : nothing}
              </ul>`}
      </div>
    </div>`;
  }
}
customElements.get('se-browse') || customElements.define('se-browse', SeBrowse);
