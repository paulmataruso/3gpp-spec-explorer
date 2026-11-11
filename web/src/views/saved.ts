import { LitElement, html, css } from 'lit';
import { tokens, base } from '../styles/tokens.ts';
import { icon } from '../lib/icons.ts';
import type { Ctx } from '../lib/context.ts';
import { linkClick } from '../lib/context.ts';
import { store, onStoreChange, type SavedItem } from '../lib/store.ts';

export class SeSaved extends LitElement {
  static properties = { ctx: { attribute: false } };
  declare ctx: Ctx;
  private unsub?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.unsub = onStoreChange(() => this.requestUpdate());
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
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
        max-width: 880px;
        margin: 0 auto;
        padding: 32px 24px 80px;
      }
      h1 {
        font-size: 22px;
        letter-spacing: -0.02em;
        margin: 0 0 4px;
      }
      p.sub {
        color: var(--c-muted);
        margin: 0 0 24px;
        font-size: 14px;
      }
      h2 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--c-muted);
        margin: 32px 0 10px;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 6px;
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
        border-radius: 8px;
      }
      li:hover {
        background: var(--c-surface-3);
      }
      li a {
        flex: 1;
        min-width: 0;
        display: flex;
        gap: 14px;
        align-items: baseline;
        padding: 12px;
        color: var(--c-text-2);
      }
      .spec-id {
        flex: none;
        font-size: 13px;
        color: var(--c-muted);
        min-width: 8ch;
      }
      .t {
        min-width: 0;
      }
      .t small {
        display: block;
        color: var(--c-muted);
        font-size: 12.5px;
        margin-top: 2px;
      }
      .empty {
        padding: 28px;
        text-align: center;
        color: var(--c-muted);
        font-size: 14px;
      }
    `,
  ];

  private list(items: SavedItem[], removable: boolean) {
    if (!items.length) return html`<div class="card empty">Nothing here yet.</div>`;
    return html`<ul class="card">
      ${items.map(
        (r) => html`<li>
          <a href=${this.ctx.href(r.sid ? 'read' : 'spec', { spec: r.spec, sid: r.sid })} @click=${linkClick(this.ctx, r.sid ? 'read' : 'spec', { spec: r.spec, sid: r.sid })}>
            <span class="spec-id">${r.spec}</span>
            <span class="t">${r.sid ? `${r.num ? r.num + ' ' : ''}${r.title}` : r.title}${r.specTitle ? html`<small>${r.specTitle}</small>` : ''}</span>
          </a>
          ${removable
            ? html`<button class="btn ghost icon-only" aria-label="Remove bookmark" title="Remove" @click=${() => store.toggleBookmark(r)}>${icon('x', 'sm')}</button>`
            : ''}
        </li>`,
      )}
    </ul>`;
  }

  render() {
    return html`<div class="scroll" style="height:100%">
      <div class="wrap">
        <h1>Saved</h1>
        <p class="sub">Bookmarks and history are stored in this browser only.</p>
        <h2>Bookmarks</h2>
        ${this.list(store.bookmarks, true)}
        <h2>History</h2>
        ${this.list(store.recent, false)}
      </div>
    </div>`;
  }
}
customElements.get('se-saved') || customElements.define('se-saved', SeSaved);
