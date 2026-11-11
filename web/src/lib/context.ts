import type { ApiClient } from './api.ts';
import type { Router, RouteName } from './router.ts';
import { buildPath } from './router.ts';

/** Everything a view needs from the root element. */
export interface Ctx {
  api: ApiClient;
  router: Router;
  /** navigate to a route */
  go(name: RouteName, opts?: { spec?: string; sid?: string; params?: Record<string, string | number | undefined>; replace?: boolean }): void;
  /** href for <a> elements (hash/history); memory mode returns "#" and relies on click handlers */
  href(name: RouteName, opts?: { spec?: string; sid?: string; params?: Record<string, string | number | undefined> }): string;
  share(name: RouteName, opts?: { spec?: string; sid?: string }): string;
  openPalette(initial?: string): void;
  toast(msg: string): void;
}

export function makePath(name: RouteName, opts: { spec?: string; sid?: string; params?: Record<string, string | number | undefined> } = {}) {
  return buildPath({ name, spec: opts.spec, sid: opts.sid }, opts.params);
}

/** Intercept clicks on internal links so memory/history routing works without reloads. */
export function linkClick(ctx: Ctx, name: RouteName, opts: { spec?: string; sid?: string; params?: Record<string, string | number | undefined> } = {}) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    ctx.go(name, opts);
  };
}
