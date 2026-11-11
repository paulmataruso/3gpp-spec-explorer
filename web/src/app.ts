import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { tokens, palette, base } from './styles/tokens.ts';
import { icon } from './lib/icons.ts';
import { ApiClient } from './lib/api.ts';
import { Router, type Route, type RoutingMode, type RouteName } from './lib/router.ts';
import { makePath, linkClick, type Ctx } from './lib/context.ts';
import { store, onStoreChange, type ThemePref } from './lib/store.ts';
import type { SePalette } from './components/palette.ts';
import './components/palette.ts';
import './components/navmenu.ts';
import './views/home.ts';
import './views/browse.ts';
import './views/reader.ts';
import './views/search.ts';
import './views/saved.ts';

const scriptBase = new URL(/* @vite-ignore */ '.', import.meta.url).href;

/**
 * <spec-explorer> — embeddable 3GPP specification explorer.
 *
 * Attributes
 *   api           API base URL (default: "<script dir>/api")
 *   routing       "hash" (default) | "history" | "memory"
 *   base          path prefix for history routing (default "/")
 *   start         initial route for memory routing, e.g. "spec/38.331/5.3.3"
 *   theme         "auto" (default) | "light" | "dark" — overrides the user's toggle
 *   no-shortcuts  disable global keyboard shortcuts (Ctrl/⌘+K, "/")
 *   manage-title  keep document.title in sync (standalone pages)
 *   hide-header   hide the top bar (host app provides its own chrome)
 *
 * Events
 *   se-navigate   detail: { path, name, spec?, sid? }
 *
 * Methods
 *   navigate(path) · openSearch(query?)
 */
export class SpecExplorer extends LitElement {
  static properties = {
    api: {},
    routing: {},
    base: {},
    start: {},
    theme: {},
    noShortcuts: { type: Boolean, attribute: 'no-shortcuts' },
    manageTitle: { type: Boolean, attribute: 'manage-title' },
    hideHeader: { type: Boolean, attribute: 'hide-header' },
    route: { state: true },
    toastMsg: { state: true },
    menuOpen: { state: true },
  };
  declare api: string;
  declare routing: RoutingMode;
  declare base: string;
  declare start: string;
  declare theme: ThemePref | '';
  declare noShortcuts: boolean;
  declare manageTitle: boolean;
  declare hideHeader: boolean;
  declare route: Route;
  declare toastMsg: string;
  declare menuOpen: boolean;

  private client!: ApiClient;
  private router!: Router;
  private ctx!: Ctx;
  private mql = matchMedia('(prefers-color-scheme: dark)');
  private unsub?: () => void;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.api = '';
    this.routing = 'hash';
    this.base = '/';
    this.start = '';
    this.theme = '';
    this.noShortcuts = false;
    this.manageTitle = false;
    this.hideHeader = false;
    this.toastMsg = '';
    this.menuOpen = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.client = new ApiClient(this.api || new URL('api', scriptBase).href);
    this.router = new Router(this.routing, this.base, (r) => this.onRoute(r), this.start);
    this.route = this.router.current();
    this.ctx = {
      api: this.client,
      router: this.router,
      go: (name, o = {}) => this.router.go(makePath(name, o), o.replace),
      href: (name, o = {}) => this.router.href(makePath(name, o)),
      share: (name, o = {}) => this.router.shareUrl(makePath(name, o)),
      openPalette: (q?: string) => this.palette?.show(q),
      toast: (m: string) => this.toast(m),
    };
    this.router.start();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onOutside, true);
    this.mql.addEventListener('change', this.applyTheme);
    this.unsub = onStoreChange(() => this.applyTheme());
    this.applyTheme();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.router.stop();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onOutside, true);
    this.mql.removeEventListener('change', this.applyTheme);
    this.unsub?.();
  }

  protected willUpdate(ch: PropertyValues) {
    if (ch.has('theme')) this.applyTheme();
  }

  private get palette() {
    return this.renderRoot?.querySelector('se-palette') as SePalette | null;
  }

  /* -------- public API -------- */
  navigate(path: string) {
    this.router.go(path.replace(/^[#/]+/, ''));
  }
  openSearch(q = '') {
    this.palette?.show(q);
  }

  private onRoute(r: Route) {
    this.route = r;
    this.menuOpen = false;
    this.palette?.hide();
    this.dispatchEvent(
      new CustomEvent('se-navigate', { detail: { path: this.router.currentPath(), name: r.name, spec: r.spec, sid: r.sid }, bubbles: true, composed: true }),
    );
    if (this.manageTitle) {
      const t =
        r.name === 'read'
          ? `${r.spec} § ${r.sid}`
          : r.name === 'spec'
            ? `${r.spec}`
            : r.name === 'search'
              ? `Search: ${r.params.get('q') ?? ''}`
              : r.name === 'browse'
                ? 'Browse'
                : '';
      document.title = t ? `${t} · 3GPP Spec Explorer` : '3GPP Spec Explorer';
    }
  }

  private onOutside = (e: PointerEvent) => {
    if (!this.menuOpen) return;
    const path = e.composedPath();
    if (path.some((n) => n instanceof HTMLElement && (n.tagName === 'SE-NAVMENU' || n.classList.contains('menu-trigger')))) return;
    this.menuOpen = false;
  };

  private toggleMenu(open = !this.menuOpen) {
    this.menuOpen = open;
  }

  private onMenuClose(e: CustomEvent<{ restoreFocus: boolean }>) {
    this.menuOpen = false;
    if (e.detail?.restoreFocus) this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.menu-trigger')?.focus());
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.noShortcuts) return;
    const typing = e.composedPath().some((n) => n instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (this.palette?.open) this.palette.hide();
      else this.palette?.show();
    } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      this.palette?.show();
    }
  };

  private applyTheme = () => {
    const pref = (this.theme || store.theme) as ThemePref;
    const dark = pref === 'dark' || (pref === 'auto' && this.mql.matches);
    this.dataset.theme = dark ? 'dark' : 'light';
    this.requestUpdate();
  };

  private cycleTheme() {
    const order: ThemePref[] = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(store.theme) + 1) % 3];
    store.theme = next;
    this.toast(`Theme: ${next === 'auto' ? 'match system' : next}`);
  }

  private toast(msg: string) {
    this.toastMsg = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastMsg = ''), 1800);
  }

  static styles = [
    tokens,
    palette,
    base,
    css`
      :host {
        display: block;
        position: relative;
        height: 100%;
        min-height: 480px;
        background: var(--c-bg);
        overflow: hidden;
        isolation: isolate;
        container-type: inline-size;
      }
      .shell {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
      }
      header {
        display: flex;
        align-items: center;
        gap: 16px;
        height: 60px;
        padding: 0 16px 0 20px;
        border-bottom: 1px solid var(--c-border);
        background: var(--c-surface);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--c-text);
        font-weight: 650;
        font-size: 15.5px;
        letter-spacing: -0.01em;
        white-space: nowrap;
      }
      .logo {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        background: var(--c-text);
        color: var(--c-bg);
      }
      .logo svg {
        width: 18px;
        height: 18px;
      }
      .brand small {
        font-weight: 500;
        color: var(--c-muted);
        font-size: 13px;
        margin-left: 2px;
      }
      nav.main {
        display: flex;
        gap: 2px;
      }
      nav.main a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 12px;
        border-radius: 8px;
        color: var(--c-muted);
        font-size: 14px;
        font-weight: 500;
        transition:
          color var(--_dur) var(--_ease),
          background var(--_dur) var(--_ease);
      }
      nav.main a:hover {
        color: var(--c-text);
        background: var(--c-surface-3);
      }
      nav.main a[aria-current='page'] {
        color: var(--c-text);
        background: var(--c-surface-3);
      }
      .menu-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 8px 0 12px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--c-muted);
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition:
          color var(--_dur) var(--_ease),
          background var(--_dur) var(--_ease);
      }
      .menu-trigger:hover,
      .menu-trigger[aria-current='page'] {
        color: var(--c-text);
        background: var(--c-surface-3);
      }
      .menu-trigger[aria-expanded='true'] {
        color: var(--c-accent-text);
        background: var(--c-accent-soft);
      }
      .menu-trigger:focus-visible {
        outline: 2px solid var(--c-accent);
        outline-offset: 2px;
      }
      .menu-trigger .caret {
        width: 14px;
        height: 14px;
        transition: transform var(--_dur) var(--_ease);
      }
      .menu-trigger[aria-expanded='true'] .caret {
        transform: rotate(180deg);
      }
      .navmenu {
        position: absolute;
        z-index: 90;
        top: 64px;
        left: 12px;
        right: 12px;
        max-width: 1180px;
        height: min(600px, calc(100% - 80px));
      }
      .search-trigger {
        flex: 1;
        max-width: 440px;
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        height: 38px;
        padding: 0 8px 0 12px;
        border: 1px solid var(--c-border);
        border-radius: 9px;
        background: var(--c-surface-2);
        color: var(--c-muted);
        font-size: 14px;
        cursor: pointer;
        transition: border-color var(--_dur) var(--_ease);
      }
      .search-trigger:hover {
        border-color: var(--c-border-strong);
      }
      .search-trigger span.t {
        flex: 1;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .search-trigger .keys {
        display: flex;
        gap: 3px;
      }
      .view {
        min-height: 0;
        position: relative;
      }
      .view > * {
        height: 100%;
      }
      .toast {
        position: absolute;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 120;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-radius: 10px;
        background: var(--c-text);
        color: var(--c-bg);
        font-size: 13.5px;
        font-weight: 500;
        box-shadow: var(--c-shadow-lg);
        animation: up 180ms var(--_ease);
      }
      @keyframes up {
        from {
          opacity: 0;
          transform: translate(-50%, 8px);
        }
      }
      @container (max-width: 820px) {
        nav.main a span,
        .menu-trigger span {
          display: none;
        }
        .brand small {
          display: none;
        }
        .search-trigger .keys {
          display: none;
        }
      }
      @container (max-width: 560px) {
        header {
          gap: 8px;
          padding: 0 10px 0 12px;
        }
        .brand .name {
          display: none;
        }
        .search-trigger span.t {
          display: none;
        }
        .search-trigger {
          flex: none;
          width: 38px;
          padding: 0;
          justify-content: center;
          margin-left: auto;
        }
      }
    `,
  ];

  private navLink(name: RouteName, label: string, ic: Parameters<typeof icon>[0]) {
    const current = this.route.name === name || (name === 'browse' && (this.route.name === 'spec' || this.route.name === 'read'));
    return html`<a href=${this.ctx.href(name)} @click=${linkClick(this.ctx, name)} aria-current=${current ? 'page' : nothing} title=${label}>${icon(ic, 'sm')}<span>${label}</span></a>`;
  }

  private renderView() {
    const r = this.route;
    switch (r.name) {
      case 'browse':
        return html`<se-browse .ctx=${this.ctx} .params=${r.params}></se-browse>`;
      case 'search':
        return html`<se-search .ctx=${this.ctx} .params=${r.params}></se-search>`;
      case 'saved':
        return html`<se-saved .ctx=${this.ctx}></se-saved>`;
      case 'spec':
      case 'read':
        return html`<se-reader .ctx=${this.ctx} .spec=${r.spec!} .sid=${r.sid}></se-reader>`;
      default:
        return html`<se-home .ctx=${this.ctx}></se-home>`;
    }
  }

  render() {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const pref = store.theme;
    return html`<div class="shell">
        ${this.hideHeader
          ? html`<span></span>`
          : html`<header>
              <a class="brand" href=${this.ctx.href('home')} @click=${linkClick(this.ctx, 'home')}>
                <span class="logo" aria-hidden="true"
                  ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                    <path d="M4.9 19.1a10 10 0 0 1 0-14.2" />
                    <path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
                    <circle cx="12" cy="12" r="2" />
                    <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
                    <path d="M19.1 4.9a10 10 0 0 1 0 14.2" /></svg
                ></span>
                <span class="name">3GPP Explorer <small>specs</small></span>
              </a>
              <nav class="main" aria-label="Primary">
                <button
                  class="menu-trigger"
                  aria-expanded=${this.menuOpen ? 'true' : 'false'}
                  aria-controls="se-navmenu"
                  aria-current=${['browse', 'spec', 'read'].includes(this.route.name) ? 'page' : nothing}
                  title="Browse all series, specifications and sections"
                  @click=${() => this.toggleMenu()}
                >
                  ${icon('library', 'sm')}<span>Browse</span>${icon('chevronDown', 'caret')}
                </button>
                ${this.navLink('search', 'Search', 'textSearch')} ${this.navLink('saved', 'Saved', 'bookmark')}
              </nav>
              <button class="search-trigger" aria-label="Search (${mac ? '⌘' : 'Ctrl'}+K)" @click=${() => this.palette?.show()}>
                ${icon('search', 'sm')}<span class="t">Search specs & sections…</span>
                <span class="keys"><kbd>${mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
              </button>
              ${this.theme
                ? nothing
                : html`<button class="btn ghost icon-only" aria-label="Theme: ${pref}. Click to change." title="Theme: ${pref}" @click=${() => this.cycleTheme()}>
                    ${icon(pref === 'dark' ? 'moon' : pref === 'light' ? 'sun' : 'monitor')}
                  </button>`}
            </header>`}
        <main class="view">${this.renderView()}</main>
      </div>
      ${this.menuOpen && !this.hideHeader
        ? html`<se-navmenu
            id="se-navmenu"
            class="navmenu"
            .ctx=${this.ctx}
            .current=${{ spec: this.route.spec, sid: this.route.sid }}
            @se-close=${this.onMenuClose}
          ></se-navmenu>`
        : nothing}
      <se-palette .ctx=${this.ctx}></se-palette>
      ${this.toastMsg ? html`<div class="toast" role="status">${icon('check', 'sm')} ${this.toastMsg}</div>` : nothing}`;
  }
}
