/** dry run of build-db's per-section .docx fill for some specs: node scraper/fill-check.ts 23.700-83 [...] */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { renderSection, finishDocxHtml, loadKatex } from '../shared/render.ts';

await loadKatex();
const read = (f: string) =>
  fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
for (const spec of process.argv.slice(2)) {
  const ctx = { spec, hasSpec: () => true, hasSection: () => true, imageUrl: (s: string) => `${spec}/${s}` };
  const crawled = new Map(read(`data/raw/sections/${spec}.ndjson.gz`).filter((o) => !o.error && !o.missing).map((o) => [o.id, o]));
  const docx = read(`data/raw/sections-docx/${spec}.ndjson.gz`).filter((o) => o.html?.trim() && crawled.has(o.id));
  let ct = 0;
  let dt = 0;
  const rows: [string, number, number][] = [];
  for (const o of docx) {
    const c = crawled.get(o.id);
    const r = Array.isArray(c.c) && c.c.length ? renderSection(c.c, ctx) : { text: '' };
    const d = finishDocxHtml(o.html, ctx);
    ct += r.text.length;
    dt += d.text.length;
    const imgs = (h?: string) => (h?.match(/<img\b/g) ?? []).length;
    const ri = imgs((r as any).html);
    const di = imgs(d.html);
    if (d.text.length > r.text.length * 1.15 + 60 || (di > ri && d.text.length >= r.text.length * 0.97))
      rows.push([`${o.id}${di > ri ? ` [img ${ri}→${di}]` : ''}`, r.text.length, d.text.length]);
  }
  console.log(`${spec}: ratio ${(dt / Math.max(1, ct)).toFixed(2)}, ${rows.length} sections would be filled: ${rows.map((r) => `${r[0]} ${r[1]}→${r[2]}`).join(', ')}`);
}
