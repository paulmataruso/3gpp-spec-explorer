/**
 * Minimal router supporting three modes so the component can live anywhere:
 *  - hash:    #/spec/38.331/5.3.3   (default; never conflicts with the host app's router)
 *  - history: /base/spec/38.331/5.3.3 (standalone deployments; server falls back to index.html)
 *  - memory:  no URL changes at all (widgets, modals, apps that own the URL)
 */
export type RouteName = 'home' | 'browse' | 'spec' | 'read' | 'search' | 'saved';

export interface Route {
  name: RouteName;
  spec?: string;
  sid?: string;
  params: URLSearchParams;
}

export type RoutingMode = 'hash' | 'history' | 'memory';

export function parsePath(path: string): Route {
  const [p, q = ''] = path.replace(/^#?\/?/, '').split('?');
  const params = new URLSearchParams(q);
  const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg[0] === 'spec' && seg[1]) {
    if (seg[2]) return { name: 'read', spec: seg[1], sid: seg.slice(2).join('/'), params };
    return { name: 'spec', spec: seg[1], params };
  }
  if (seg[0] === 'search') return { name: 'search', params };
  if (seg[0] === 'browse') return { name: 'browse', params };
  if (seg[0] === 'saved') return { name: 'saved', params };
  return { name: 'home', params };
}

export function buildPath(r: Partial<Route> & { name: RouteName }, params?: Record<string, string | number | undefined>): string {
  let p = '';
  switch (r.name) {
    case 'home':
      p = '';
      break;
    case 'browse':
      p = 'browse';
      break;
    case 'search':
      p = 'search';
      break;
    case 'saved':
      p = 'saved';
      break;
    case 'spec':
      p = `spec/${encodeURIComponent(r.spec!)}`;
      break;
    case 'read':
      p = `spec/${encodeURIComponent(r.spec!)}/${r.sid!.split('/').map(encodeURIComponent).join('/')}`;
      break;
  }
  const u = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, String(v));
  const qs = u.toString();
  return p + (qs ? `?${qs}` : '');
}

export class Router {
  mode: RoutingMode;
  base: string;
  private memory: string[] = [];
  private onChange: (r: Route) => void;
  private handler = () => this.onChange(this.current());

  constructor(mode: RoutingMode, base: string, onChange: (r: Route) => void, initial = '') {
    this.mode = mode;
    this.base = '/' + base.replace(/^\/+|\/+$/g, '');
    if (this.base === '/') this.base = '';
    this.onChange = onChange;
    if (mode === 'memory') this.memory = [initial];
  }

  start() {
    if (this.mode === 'hash') window.addEventListener('hashchange', this.handler);
    if (this.mode === 'history') window.addEventListener('popstate', this.handler);
  }

  stop() {
    window.removeEventListener('hashchange', this.handler);
    window.removeEventListener('popstate', this.handler);
  }

  currentPath(): string {
    if (this.mode === 'hash') return location.hash.replace(/^#\/?/, '');
    if (this.mode === 'history') {
      let p = location.pathname;
      if (this.base && p.startsWith(this.base)) p = p.slice(this.base.length);
      return p.replace(/^\//, '') + location.search;
    }
    return this.memory[this.memory.length - 1] ?? '';
  }

  current(): Route {
    return parsePath(this.currentPath());
  }

  href(path: string): string {
    if (this.mode === 'hash') return '#/' + path;
    if (this.mode === 'history') return `${this.base}/${path}`;
    return '#';
  }

  /** absolute, shareable URL for a path (memory mode falls back to hash form) */
  shareUrl(path: string): string {
    if (this.mode === 'history') return location.origin + `${this.base}/${path}`;
    return location.href.split('#')[0] + '#/' + path;
  }

  go(path: string, replace = false) {
    if (this.currentPath() === path) return;
    if (this.mode === 'hash') {
      if (replace) history.replaceState(history.state, '', '#/' + path);
      else location.hash = '/' + path;
      if (replace) this.handler();
    } else if (this.mode === 'history') {
      const url = `${this.base}/${path}`;
      if (replace) history.replaceState({}, '', url);
      else history.pushState({}, '', url);
      this.handler();
    } else {
      if (replace) this.memory[this.memory.length - 1] = path;
      else this.memory.push(path);
      this.handler();
    }
  }

  back() {
    if (this.mode === 'memory') {
      if (this.memory.length > 1) this.memory.pop();
      this.handler();
    } else history.back();
  }
}
