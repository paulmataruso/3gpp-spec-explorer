/** Polite HTTP client: bounded concurrency, retries with backoff, global cool-down on 429/503. */

const UA =
  process.env.CRAWL_UA ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const BASE = process.env.CRAWL_BASE || 'https://itecspec.com';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private active = 0;
  private queue: (() => void)[] = [];
  private pausedUntil = 0;
  private lastStart = 0;
  stats = { ok: 0, retries: 0, failed: 0, bytes: 0, notFound: 0 };

  concurrency: number;
  minIntervalMs: number;

  constructor(concurrency = Number(process.env.CRAWL_CONCURRENCY || 6), minIntervalMs = Number(process.env.CRAWL_MIN_INTERVAL_MS || 40)) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
  }

  private async acquire() {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    // global pause + minimum spacing between request starts
    for (;;) {
      const now = Date.now();
      const wait = Math.max(this.pausedUntil - now, this.lastStart + this.minIntervalMs - now);
      if (wait <= 0) break;
      await sleep(wait);
    }
    this.lastStart = Date.now();
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Returns body buffer, or null for 404. Throws after exhausting retries. */
  async get(path: string, headers: Record<string, string> = {}, maxRetries = 6): Promise<Buffer | null> {
    const url = path.startsWith('http') ? path : BASE + path;
    let attempt = 0;
    for (;;) {
      await this.acquire();
      let status = 0;
      let retryAfter = 0;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...headers },
          signal: AbortSignal.timeout(90_000),
        });
        status = res.status;
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          this.stats.ok++;
          this.stats.bytes += buf.length;
          return buf;
        }
        retryAfter = Number(res.headers.get('retry-after') || 0);
        await res.arrayBuffer().catch(() => undefined);
        if (status === 404) {
          this.stats.notFound++;
          return null;
        }
      } catch (e) {
        status = -1;
      } finally {
        this.release();
      }
      attempt++;
      if (status === 429 || status === 503 || status === 403) {
        // global cool-down so we don't hammer the origin
        const pause = Math.max(retryAfter * 1000, Math.min(120_000, 5_000 * 2 ** Math.min(attempt, 5)));
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + pause);
        console.warn(`[http] ${status} on ${path} — pausing ${Math.round(pause / 1000)}s`);
      }
      if (attempt > maxRetries) {
        this.stats.failed++;
        throw new Error(`GET ${path} failed with status ${status} after ${attempt} attempts`);
      }
      this.stats.retries++;
      await sleep(Math.min(60_000, 1000 * 2 ** attempt) + Math.random() * 1000);
    }
  }
}

/* ---------- Next.js RSC helpers ---------- */

type Tree = unknown[];

function rnd() {
  return Math.random().toString(36).slice(2, 7);
}

/**
 * Build a router-state tree for a *neighbouring* page so the server only streams
 * the changed (page) segment instead of the full layout (which embeds a ~1 MB catalog).
 */
export function routerTree(rel: string, spec: string, section?: string): Tree {
  const leaf =
    section === undefined
      ? [['specNumber', spec, 'd'], { children: ['__PAGE__', {}] }]
      : [['specNumber', spec, 'd'], { children: ['s', { children: [['sectionId', section, 'd'], { children: ['__PAGE__', {}] }] }] }];
  return ['', { children: ['3gpp', { children: [['slug', rel, 'd'], { children: leaf }] }] }, null, null, true];
}

export async function getRsc(http: HttpClient, path: string, fromTree: Tree, fromUrl: string): Promise<Buffer | null> {
  return http.get(`${path}?_rsc=${rnd()}`, {
    RSC: '1',
    'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(fromTree)),
    'Next-Url': fromUrl,
  });
}
