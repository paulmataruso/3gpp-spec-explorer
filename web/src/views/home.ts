import { LitElement, html, css, nothing } from 'lit';
import { tokens, base } from '../styles/tokens.ts';
import { icon, SERIES_ICON } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import type { Info } from '../lib/api.ts';
import { store, type SavedItem } from '../lib/store.ts';
import { fmtNum, relName } from '../lib/format.ts';

const QUICK = [
  ['38.331', 'NR RRC'],
  ['38.300', 'NR overall'],
  ['23.501', '5GS architecture'],
  ['23.502', '5GS procedures'],
  ['24.501', '5G NAS'],
  ['38.211', 'NR PHY'],
  ['38.213', 'NR control'],
  ['33.501', '5G security'],
  ['29.500', 'SBA'],
  ['36.331', 'LTE RRC'],
];

export class SeHome extends LitElement {
  static properties = { ctx: { attribute: false }, info: { state: true } };
  declare ctx: Ctx;
  declare info: Info | null;

  constructor() {
    super();
    this.info = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.ctx.api
      .info()
      .then((i) => (this.info = i))
      .catch(() => {});
  }

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        height: 100%;
      }
      .wrap {
        height: 100%;
      }
      .inner {
        max-width: 1120px;
        margin: 0 auto;
        padding: 0 24px 64px;
      }
      .hero {
        padding: clamp(40px, 9vh, 96px) 0 40px;
        text-align: center;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px 4px 6px;
        border: 1px solid var(--c-border);
        border-radius: 999px;
        font-size: 12.5px;
        color: var(--c-muted);
        background: var(--c-surface);
      }
      .eyebrow .dot {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
      }
      h1 {
        margin: 20px auto 12px;
        max-width: 18ch;
        font-size: clamp(30px, 4.6vw, 48px);
        line-height: 1.08;
        letter-spacing: -0.03em;
        font-weight: 650;
        text-wrap: balance;
      }
      .lede {
        margin: 0 auto 32px;
        max-width: 58ch;
        color: var(--c-muted);
        font-size: 16.5px;
        line-height: 1.6;
        text-wrap: pretty;
      }
      .searchbox {
        display: flex;
        align-items: center;
        gap: 12px;
        width: min(680px, 100%);
        height: 60px;
        margin: 0 auto;
        padding: 0 10px 0 20px;
        border: 1px solid var(--c-border-strong);
        border-radius: 14px;
        background: var(--c-surface);
        box-shadow: var(--c-shadow);
        color: var(--c-muted);
        cursor: text;
        font-size: 16.5px;
        transition:
          border-color var(--_dur) var(--_ease),
          box-shadow var(--_dur) var(--_ease);
      }
      .searchbox:hover {
        border-color: var(--c-accent);
      }
      .searchbox span.ph {
        flex: 1;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .searchbox .keys {
        display: flex;
        gap: 4px;
      }
      .quick {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin: 22px auto 0;
        max-width: 760px;
      }
      .quick a {
        text-decoration: none;
      }
      .quick .chip b {
        font-family: var(--_mono);
        font-weight: 600;
        color: var(--c-text);
        font-size: 12.5px;
      }
      .stats {
        display: flex;
        justify-content: center;
        gap: clamp(20px, 5vw, 56px);
        margin: 40px 0 8px;
        flex-wrap: wrap;
      }
      .stat {
        text-align: center;
      }
      .stat b {
        display: block;
        font-size: 26px;
        font-weight: 650;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .stat span {
        font-size: 13px;
        color: var(--c-muted);
      }
      h2 {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 48px 0 16px;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      h2 a {
        font-size: 13.5px;
        font-weight: 500;
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
      }
      .series {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        padding: 16px;
        text-decoration: none;
        color: inherit;
        transition:
          border-color var(--_dur) var(--_ease),
          transform var(--_dur) var(--_ease),
          box-shadow var(--_dur) var(--_ease);
      }
      .series:hover {
        border-color: var(--c-border-strong);
        box-shadow: var(--c-shadow);
      }
      .series .ic {
        flex: none;
        width: 38px;
        height: 38px;
        border-radius: 9px;
        display: grid;
        place-items: center;
        background: var(--c-accent-soft);
        color: var(--c-accent-text);
      }
      .series .num {
        font-family: var(--_mono);
        font-size: 12.5px;
        font-weight: 600;
        color: var(--c-muted);
      }
      .series .name {
        display: block;
        font-size: 14.5px;
        font-weight: 550;
        color: var(--c-text);
        margin: 2px 0 2px;
        line-height: 1.35;
      }
      .series .cnt {
        font-size: 12.5px;
        color: var(--c-muted);
      }
      .rels {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .rels a {
        text-decoration: none;
      }
      .rels .chip {
        min-width: 92px;
        justify-content: space-between;
      }
      .rels .chip b {
        font-weight: 600;
        color: var(--c-text);
      }
      .two {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .list {
        padding: 6px;
      }
      .list a {
        display: flex;
        gap: 12px;
        align-items: baseline;
        padding: 10px 12px;
        border-radius: 8px;
        color: var(--c-text-2);
        font-size: 14px;
      }
      .list a:hover {
        background: var(--c-surface-3);
      }
      .list .spec-id {
        flex: none;
        font-size: 12.5px;
        color: var(--c-muted);
        min-width: 7ch;
      }
      .list .t {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        padding: 18px;
        font-size: 13.5px;
        color: var(--c-muted);
      }
      @media (max-width: 760px) {
        .two {
          grid-template-columns: 1fr;
        }
        .inner {
          padding: 0 16px 48px;
        }
        .searchbox .keys {
          display: none;
        }
      }
    `,
  ];

  private savedList(items: SavedItem[], emptyMsg: string) {
    if (!items.length) return html`<div class="empty">${emptyMsg}</div>`;
    return items.slice(0, 6).map(
      (r) => html`<a href=${this.ctx.href(r.sid ? 'read' : 'spec', { spec: r.spec, sid: r.sid })} @click=${linkClick(this.ctx, r.sid ? 'read' : 'spec', { spec: r.spec, sid: r.sid })}>
        <span class="spec-id">${r.spec}</span><span class="t">${r.sid ? `${r.num ? r.num + ' ' : ''}${r.title}` : r.title}</span>
      </a>`,
    );
  }

  render() {
    const i = this.info;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    return html`<div class="wrap scroll">
      <div class="inner">
        <section class="hero">
          <span class="eyebrow"><span class="dot">${icon('radio', 'sm')}</span> 3GPP specifications · Release 4 – 21</span>
          <h1>Every 3GPP spec, instantly searchable.</h1>
          <p class="lede">
            Read ${i ? fmtNum(i.specs) : '3,200+'} technical specifications and reports section by section — NR, LTE, 5G Core, NAS, security
            and more — with full-text search across ${i ? fmtNum(i.sections) : 'half a million'} clauses.
          </p>
          <div class="searchbox" role="button" tabindex="0" aria-label="Open search" @click=${() => this.ctx.openPalette()} @keydown=${(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.ctx.openPalette())}>
            ${icon('search', 'lg')}
            <span class="ph">Search “RRCReconfiguration”, “38.331 5.3.3”, “PDU session”…</span>
            <span class="keys"><kbd>${mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
          </div>
          <div class="quick">
            ${QUICK.map(
              ([spec, t]) => html`<a href=${this.ctx.href('spec', { spec })} @click=${linkClick(this.ctx, 'spec', { spec })}><span class="chip"><b>${spec}</b>${t}</span></a>`,
            )}
          </div>
          ${i
            ? html`<div class="stats">
                <div class="stat"><b>${fmtNum(i.specs)}</b><span>specifications</span></div>
                <div class="stat"><b>${fmtNum(i.sections)}</b><span>sections</span></div>
                <div class="stat"><b>${i.releases.length}</b><span>releases</span></div>
                <div class="stat"><b>${i.series.length}</b><span>series</span></div>
              </div>`
            : nothing}
        </section>

        <div class="two">
          <div>
            <h2>Recently viewed ${store.recent.length ? html`<a href="#" @click=${(e: Event) => (e.preventDefault(), store.clearRecent(), this.requestUpdate())}>Clear</a>` : nothing}</h2>
            <div class="card list">${this.savedList(store.recent, 'Sections you open will appear here.')}</div>
          </div>
          <div>
            <h2>Bookmarks <a href=${this.ctx.href('saved')} @click=${linkClick(this.ctx, 'saved')}>All ${icon('chevronRight', 'sm')}</a></h2>
            <div class="card list">${this.savedList(store.bookmarks, 'Bookmark sections with the ☆ button while reading.')}</div>
          </div>
        </div>

        <h2>Browse by series <a href=${this.ctx.href('browse')} @click=${linkClick(this.ctx, 'browse')}>All specifications ${icon('chevronRight', 'sm')}</a></h2>
        <div class="grid">
          ${(i?.series ?? []).map(
            (s) => html`<a class="card series" href=${this.ctx.href('browse', { params: { series: s.key } })} @click=${linkClick(this.ctx, 'browse', { params: { series: s.key } })}>
              <span class="ic">${icon(SERIES_ICON[s.key] ?? 'folder')}</span>
              <span><span class="num">${s.key} series</span><span class="name">${s.name}</span><span class="cnt">${s.count} documents</span></span>
            </a>`,
          )}
          ${i ? nothing : Array.from({ length: 9 }, () => html`<div class="card series"><div class="skel" style="width:100%;height:56px"></div></div>`)}
        </div>

        <h2>Browse by release</h2>
        <div class="rels">
          ${(i?.releases ?? []).map(
            (r) => html`<a href=${this.ctx.href('browse', { params: { rel: r.rel_num } })} @click=${linkClick(this.ctx, 'browse', { params: { rel: r.rel_num } })}>
              <span class="chip"><b>${relName(r.rel_num)}</b><span class="count">${r.n}</span></span>
            </a>`,
          )}
        </div>
      </div>
    </div>`;
  }
}
customElements.get('se-home') || customElements.define('se-home', SeHome);
