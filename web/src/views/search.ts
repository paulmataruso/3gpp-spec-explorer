import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { tokens, base } from '../styles/tokens.ts';
import { icon } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import type { SearchResult, Facets, SearchHit } from '../lib/api.ts';
import { SERIES, fmtNum, debounce, relName } from '../lib/format.ts';
import { store } from '../lib/store.ts';

const PAGE = 25;

/** Full-text results with facets (spec / series / release / type). */
export class SeSearch extends LitElement {
  static properties = {
    ctx: { attribute: false },
    params: { attribute: false },
    result: { state: true },
    hits: { state: true },
    facets: { state: true },
    loading: { state: true },
    more: { state: true },
    draft: { state: true },
    active: { state: true },
  };
  declare ctx: Ctx;
  declare params: URLSearchParams;
  declare result: SearchResult | null;
  declare hits: SearchHit[];
  declare facets: Facets | null;
  declare loading: boolean;
  declare more: boolean;
  declare draft: string;
  declare active: number;
  private abort?: AbortController;
  private lastKey = '';

  constructor() {
    super();
    this.result = null;
    this.hits = [];
    this.facets = null;
    this.loading = false;
    this.more = false;
    this.draft = '';
    this.active = -1;
  }

  private get q() {
    return this.params.get('q') ?? '';
  }
  private filters() {
    return {
      spec: this.params.get('spec') ?? undefined,
      series: this.params.get('series') ?? undefined,
      rel: this.params.get('rel') ? Number(this.params.get('rel')) : undefined,
      type: this.params.get('type') ?? undefined,
      in: (this.params.get('in') as 'title' | null) ?? undefined,
    };
  }

  protected willUpdate(ch: PropertyValues) {
    if (ch.has('params')) {
      const key = this.params.toString();
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.draft = this.q;
        this.run();
      }
    }
  }

  private async run() {
    this.abort?.abort();
    const ac = (this.abort = new AbortController());
    const q = this.q;
    if (!q.trim()) {
      this.result = null;
      this.hits = [];
      this.facets = null;
      return;
    }
    this.loading = true;
    this.active = -1;
    const f = this.filters();
    try {
      const r = await this.ctx.api.search({ q, ...f, limit: PAGE }, ac.signal);
      if (ac.signal.aborted) return;
      this.result = r;
      this.hits = r.hits;
      this.ctx.api
        .facets({ q, ...f }, ac.signal)
        .then((x) => !ac.signal.aborted && (this.facets = x))
        .catch(() => {});
      this.renderRoot.querySelector('.main')?.scrollTo({ top: 0 });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.result = { total: 0, hits: [], took: 0, error: (e as Error).message, query: { terms: [] } };
    } finally {
      if (!ac.signal.aborted) this.loading = false;
    }
  }

  private async loadMore() {
    this.more = true;
    try {
      const r = await this.ctx.api.search({ q: this.q, ...this.filters(), limit: PAGE, offset: this.hits.length });
      this.hits = [...this.hits, ...r.hits];
    } finally {
      this.more = false;
    }
  }

  private setParam(key: string, value: string | undefined) {
    const p: Record<string, string> = {};
    for (const [k, v] of this.params.entries()) p[k] = v;
    if (value === undefined || value === '' || p[key] === value) delete p[key];
    else p[key] = value;
    this.ctx.go('search', { params: p, replace: true });
  }

  private submit = debounce((q: string) => {
    store.pushQuery(q);
    this.setParam('q', q || undefined);
  }, 300);

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.hits.length;
      if (!n) return;
      this.active = e.key === 'ArrowDown' ? Math.min(n - 1, this.active + 1) : Math.max(0, this.active - 1);
      this.updateComplete.then(() => (this.renderRoot.querySelector(`#hit-${this.active} a`) as HTMLElement | null)?.focus());
    }
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .main {
        height: 100%;
      }
      .wrap {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: 40px;
        max-width: 1180px;
        margin: 0 auto;
        padding: 28px 32px 80px;
      }
      .head {
        grid-column: 1 / -1;
      }
      .big {
        height: 52px;
        border-radius: 12px;
        padding: 0 16px;
      }
      .big input {
        font-size: 17px;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin-top: 14px;
      }
      .filters .lbl {
        font-size: 12.5px;
        color: var(--c-muted);
        margin-right: 2px;
      }
      .summary {
        font-size: 13.5px;
        color: var(--c-muted);
        margin: 0 0 12px;
        min-height: 20px;
      }
      .summary b {
        color: var(--c-text);
        font-weight: 600;
      }
      .direct {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        margin-bottom: 16px;
        border: 1px solid color-mix(in srgb, var(--c-accent) 40%, transparent);
        background: var(--c-accent-soft);
        border-radius: var(--_radius);
        color: var(--c-text);
        font-size: 14.5px;
      }
      .direct .icon {
        color: var(--c-accent-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        border-bottom: 1px solid var(--c-border);
      }
      li a {
        display: block;
        padding: 16px 14px;
        margin: 0 -14px;
        border-radius: 10px;
        color: inherit;
        transition: background var(--_dur) var(--_ease);
      }
      li a:hover,
      li a:focus-visible {
        background: var(--c-surface);
        outline-offset: -2px;
      }
      .where {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--c-muted);
        margin-bottom: 4px;
        min-width: 0;
      }
      .where .spec-id {
        color: var(--c-text-2);
        font-size: 12.5px;
      }
      .where .st {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ttl {
        font-size: 16.5px;
        font-weight: 600;
        color: var(--c-accent-text);
        line-height: 1.35;
        letter-spacing: -0.005em;
      }
      .ttl .n {
        font-family: var(--_mono);
        font-weight: 600;
        margin-right: 8px;
      }
      .snip {
        margin-top: 6px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--c-text-2);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .snip.heading {
        font-style: italic;
        color: var(--c-muted);
      }
      aside h3 {
        margin: 0 0 8px;
        font-size: 11.5px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--c-muted);
        font-weight: 600;
      }
      aside section {
        margin-bottom: 26px;
      }
      .facet {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-height: 32px;
        padding: 5px 8px;
        border: 0;
        border-radius: 7px;
        background: none;
        text-align: left;
        cursor: pointer;
        color: var(--c-text-2);
        font-size: 13px;
      }
      .facet:hover {
        background: var(--c-surface-3);
      }
      .facet[aria-pressed='true'] {
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
      }
      .facet .k {
        font-family: var(--_mono);
        font-size: 12px;
        font-weight: 600;
        min-width: 7ch;
      }
      .facet .l {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .facet .c {
        font-size: 12px;
        color: var(--c-muted);
        font-variant-numeric: tabular-nums;
      }
      .bar {
        position: relative;
        height: 3px;
        border-radius: 3px;
        background: var(--c-surface-3);
        margin: 0 8px 4px;
        overflow: hidden;
      }
      .bar i {
        position: absolute;
        inset: 0 auto 0 0;
        background: color-mix(in srgb, var(--c-accent) 55%, transparent);
        border-radius: 3px;
      }
      .rels {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .rels .chip {
        min-height: 28px;
        padding: 0 10px;
        font-size: 12.5px;
      }
      .empty {
        padding: 56px 0;
        text-align: center;
        color: var(--c-muted);
      }
      .empty .icon {
        width: 34px;
        height: 34px;
      }
      .empty h2 {
        color: var(--c-text);
        font-size: 18px;
        margin: 12px 0 6px;
      }
      .tips {
        max-width: 520px;
        margin: 18px auto 0;
        text-align: left;
        font-size: 13.5px;
        line-height: 1.7;
      }
      .tips code {
        font-family: var(--_mono);
        font-size: 12.5px;
        padding: 1px 6px;
        border-radius: 5px;
        background: var(--c-surface-3);
        color: var(--c-text);
      }
      .moreRow {
        display: flex;
        justify-content: center;
        padding: 24px 0;
      }
      .skel-hit {
        padding: 18px 0;
        border-bottom: 1px solid var(--c-border);
      }
      .skel-hit .skel {
        height: 12px;
        margin: 8px 0;
      }
      @media (max-width: 980px) {
        .wrap {
          grid-template-columns: minmax(0, 1fr);
          padding: 20px 16px 64px;
          gap: 8px;
        }
        aside {
          order: -1;
        }
        aside .specs,
        aside .series {
          display: none;
        }
      }
    `,
  ];

  private renderTips() {
    return html`<div class="tips">
      <div><code>RRCReconfiguration</code> — any word or identifier</div>
      <div><code>"PDU session establishment"</code> — exact phrase</div>
      <div><code>38.331 measurement</code> — search inside one spec</div>
      <div><code>38.331 5.3.3</code> — jump straight to a clause</div>
      <div><code>handover -LTE</code> — exclude a term · <code>rel:18</code> <code>series:23</code> <code>type:tr</code> <code>in:title</code> — filters</div>
    </div>`;
  }

  render() {
    const r = this.result;
    const f = this.filters();
    const fc = this.facets;
    const maxSpec = Math.max(1, ...(fc?.specs ?? []).map((x) => x.count));
    return html`<div class="main scroll">
      <div class="wrap">
        <div class="head">
          <label class="input big">
            ${icon('search', 'lg')}
            <input
              type="search"
              aria-label="Search all specifications"
              placeholder="Search all specifications…"
              .value=${this.draft}
              @input=${(e: Event) => {
                this.draft = (e.target as HTMLInputElement).value;
                this.submit(this.draft);
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  store.pushQuery(this.draft);
                  this.setParam('q', this.draft || undefined);
                } else this.onKey(e);
              }}
            />
          </label>
          <div class="filters">
            <span class="lbl">Filters</span>
            <button class="chip" aria-pressed=${f.in === 'title'} @click=${() => this.setParam('in', 'title')}>${icon('hash', 'sm')} Titles only</button>
            <button class="chip" aria-pressed=${f.type === 'TS'} @click=${() => this.setParam('type', 'TS')}>TS</button>
            <button class="chip" aria-pressed=${f.type === 'TR'} @click=${() => this.setParam('type', 'TR')}>TR</button>
            ${f.spec ? html`<button class="chip" aria-pressed="true" @click=${() => this.setParam('spec', undefined)}><span class="mono">${f.spec}</span> ${icon('x', 'sm')}</button>` : nothing}
            ${f.series ? html`<button class="chip" aria-pressed="true" @click=${() => this.setParam('series', undefined)}>Series ${f.series} ${icon('x', 'sm')}</button>` : nothing}
            ${f.rel ? html`<button class="chip" aria-pressed="true" @click=${() => this.setParam('rel', undefined)}>${relName(f.rel)} ${icon('x', 'sm')}</button>` : nothing}
          </div>
        </div>

        <div>
          <p class="summary" aria-live="polite">
            ${this.loading && !r
              ? 'Searching…'
              : r && this.q
                ? html`<b>${fmtNum(r.total)}</b> ${r.total === 1 ? 'section' : 'sections'} · ${r.took} ms`
                : nothing}
          </p>
          ${r?.direct
            ? html`<a
                class="direct"
                href=${this.ctx.href(r.direct.sid ? 'read' : 'spec', { spec: r.direct.spec, sid: r.direct.sid })}
                @click=${linkClick(this.ctx, r.direct.sid ? 'read' : 'spec', { spec: r.direct.spec, sid: r.direct.sid })}
              >
                ${icon('arrowRight')}
                <span>Go to <b class="mono">${r.direct.spec}${r.direct.sid ? ` § ${r.direct.sid}` : ''}</b></span>
              </a>`
            : nothing}
          ${!this.q
            ? html`<div class="empty">${icon('textSearch')}<h2>Search every clause of every spec</h2>${this.renderTips()}</div>`
            : this.loading && !this.hits.length
              ? Array.from({ length: 6 }, () => html`<div class="skel-hit"><div class="skel" style="width:30%"></div><div class="skel" style="width:60%;height:16px"></div><div class="skel" style="width:95%"></div><div class="skel" style="width:80%"></div></div>`)
              : r?.error
                ? html`<div class="empty">${icon('info')}<h2>That query couldn’t be parsed</h2><p>${r.error}</p></div>`
                : this.hits.length === 0
                  ? html`<div class="empty">${icon('searchX')}<h2>No results for “${this.q}”</h2><p>Try fewer or different words, remove filters, or search titles.</p>${this.renderTips()}</div>`
                  : html`<ol>
                        ${this.hits.map(
                          (h, i) => html`<li id="hit-${i}">
                            <a href=${this.ctx.href('read', { spec: h.spec, sid: h.sid })} @click=${linkClick(this.ctx, 'read', { spec: h.spec, sid: h.sid })}>
                              <div class="where">
                                <span class="badge ${h.type.toLowerCase()}">${h.type}</span>
                                <span class="spec-id">${h.spec}</span>
                                <span class="st">${h.specTitle}</span>
                              </div>
                              <div class="ttl">${h.num ? html`<span class="n">${h.num}</span>` : nothing}${h.title}</div>
                              ${h.snippet ? html`<div class="snip">${unsafeHTML(h.snippet)}</div>` : html`<div class="snip heading">Section heading — open to see subsections</div>`}
                            </a>
                          </li>`,
                        )}
                      </ol>
                      ${r && this.hits.length < r.total
                        ? html`<div class="moreRow"><button class="btn" ?disabled=${this.more} @click=${() => this.loadMore()}>${this.more ? 'Loading…' : `Show more results`}</button></div>`
                        : nothing}`}
        </div>

        <aside aria-label="Refine results">
          ${fc && this.q
            ? html`
                <section class="specs">
                  <h3>Top specifications</h3>
                  ${fc.specs.slice(0, 12).map(
                    (s) => html`<button class="facet" aria-pressed=${f.spec === s.key} title=${s.title} @click=${() => this.setParam('spec', s.key)}>
                        <span class="k">${s.key}</span><span class="l">${s.title}</span><span class="c">${fmtNum(s.count)}</span>
                      </button>
                      <div class="bar"><i style="width:${(s.count / maxSpec) * 100}%"></i></div>`,
                  )}
                </section>
                <section>
                  <h3>Release</h3>
                  <div class="rels">
                    ${fc.releases
                      .slice()
                      .sort((a, b) => Number(b.key) - Number(a.key))
                      .map(
                        (x) => html`<button class="chip" aria-pressed=${String(f.rel) === x.key} @click=${() => this.setParam('rel', x.key)}>
                          ${relName(x.key)}<span class="count">${fmtNum(x.count)}</span>
                        </button>`,
                      )}
                  </div>
                </section>
                <section class="series">
                  <h3>Series</h3>
                  ${fc.series.map(
                    (x) => html`<button class="facet" aria-pressed=${f.series === x.key} @click=${() => this.setParam('series', x.key)}>
                      <span class="k">${x.key}</span><span class="l">${SERIES[x.key] ?? ''}</span><span class="c">${fmtNum(x.count)}</span>
                    </button>`,
                  )}
                </section>
              `
            : nothing}
        </aside>
      </div>
    </div>`;
  }
}
customElements.get('se-search') || customElements.define('se-search', SeSearch);
