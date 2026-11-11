/** Choosing which official archive version to download for a spec. */
export interface Version {
  release: string;
  version: string;
  url: string;
}

const vkey = (v: string) =>
  v
    .split('.')
    .map((x) => x.padStart(4, '0'))
    .join('.');

/** newest version within the spec's release (what itecspec renders), else newest overall */
export function pickUrl(release: string, versions: Version[]): string | undefined {
  return pickUrls(release, versions, 1)[0];
}

/** the n newest versions within the spec's release (fallbacks when a figure changed between versions) */
export function pickUrls(release: string, versions: Version[], n: number): string[] {
  const rel = release.replace(/\D/g, '');
  const same = versions.filter((v) => v.release.replace(/\D/g, '') === rel && v.url);
  const pool = same.length ? same : versions.filter((v) => v.url);
  pool.sort((a, b) => vkey(b.version).localeCompare(vkey(a.version)));
  return pool.slice(0, n).map((v) => v.url);
}

/** "i00" -> [18,0,0]: 3GPP version digits are base 36 (0-9, a=10 …); 6-digit codes use two digits each */
function decodeVersion(code: string): number[] {
  if (code.length === 6 && /^\d+$/.test(code)) return [code.slice(0, 2), code.slice(2, 4), code.slice(4)].map(Number);
  return [...code].map((c) => parseInt(c, 36));
}

/**
 * Zips listed in the spec's folder of the official archive (newest first, same release first) —
 * for specs whose itecspec metadata carries no download link. Cached in <data>/raw/archive/.
 */
export async function archiveUrls(spec: string, release: string, dataDir: string, n = 3): Promise<string[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const cacheDir = path.join(dataDir, 'raw', 'archive');
  const cache = path.join(cacheDir, `${spec}.json`);
  let zips: string[] = [];
  if (fs.existsSync(cache)) zips = JSON.parse(fs.readFileSync(cache, 'utf8'));
  else {
    try {
      const url = `https://www.3gpp.org/ftp/Specs/archive/${spec.slice(0, 2)}_series/${spec}/`;
      const res = await fetch(url, { headers: { 'User-Agent': 'spec-explorer/1.0' } });
      if (res.ok) zips = [...(await res.text()).matchAll(/href="([^"]+\.zip)"/g)].map((m) => m[1]);
    } catch {
      /* offline: no fallback */
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(zips));
  }
  const rel = Number(release.replace(/\D/g, ''));
  const parsed = zips
    .map((u) => ({ u, v: decodeVersion(/-(\w+)\.zip$/.exec(u)?.[1] ?? '') }))
    .filter((x) => x.v.length && x.v.every((d) => Number.isFinite(d)));
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  parsed.sort((a, b) => Number(b.v[0] === rel) - Number(a.v[0] === rel) || cmp(a.v, b.v));
  return parsed.slice(0, n).map((x) => x.u);
}
