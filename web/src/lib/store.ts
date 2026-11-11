/** Tiny persistent store (localStorage, fail-safe) for prefs, bookmarks and history. */
const NS = 'spec-explorer:';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(NS + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(v));
  } catch {
    /* storage disabled / full */
  }
}

export interface SavedItem {
  spec: string;
  sid?: string;
  num?: string | null;
  title: string;
  specTitle?: string;
  at: number;
}

export type ThemePref = 'auto' | 'light' | 'dark';

const listeners = new Set<() => void>();
export const onStoreChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((f) => f());

export const store = {
  get theme(): ThemePref {
    return read<ThemePref>('theme', 'auto');
  },
  set theme(v: ThemePref) {
    write('theme', v);
    emit();
  },
  get fontSize(): number {
    return read<number>('fontSize', 16);
  },
  set fontSize(v: number) {
    write('fontSize', Math.min(22, Math.max(13, v)));
    emit();
  },
  get tocOpen(): boolean {
    return read<boolean>('tocOpen', true);
  },
  set tocOpen(v: boolean) {
    write('tocOpen', v);
  },
  get recent(): SavedItem[] {
    return read<SavedItem[]>('recent', []);
  },
  pushRecent(item: Omit<SavedItem, 'at'>) {
    const list = store.recent.filter((x) => !(x.spec === item.spec && x.sid === item.sid));
    list.unshift({ ...item, at: Date.now() });
    write('recent', list.slice(0, 30));
    emit();
  },
  clearRecent() {
    write('recent', []);
    emit();
  },
  get bookmarks(): SavedItem[] {
    return read<SavedItem[]>('bookmarks', []);
  },
  isBookmarked(spec: string, sid?: string) {
    return store.bookmarks.some((b) => b.spec === spec && b.sid === sid);
  },
  toggleBookmark(item: Omit<SavedItem, 'at'>) {
    const list = store.bookmarks;
    const i = list.findIndex((b) => b.spec === item.spec && b.sid === item.sid);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ ...item, at: Date.now() });
    write('bookmarks', list.slice(0, 200));
    emit();
    return i < 0;
  },
  get recentQueries(): string[] {
    return read<string[]>('queries', []);
  },
  pushQuery(q: string) {
    q = q.trim();
    if (!q) return;
    write('queries', [q, ...store.recentQueries.filter((x) => x !== q)].slice(0, 12));
  },
};
