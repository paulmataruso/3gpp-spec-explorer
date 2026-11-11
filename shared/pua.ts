/**
 * Symbol-font characters that reached the text as private-use code points (U+F020-U+F0FF): Word stores a
 * character of Symbol, Wingdings or a line-draw font (MS LineDraw, Terminal) at U+F000 + its code when it is
 * typed as text. Without the font the code means nothing - the reader showed "T0  148 chips" for
 * "T0 ± 148 chips" (25.214) and "DPCCH" for "ΔDPCCH". itecspec's text has no fonts, so the paragraph's
 * characters decide: horizontal lines, corners with verticals, runs of spaces or of letters are a code page
 * 437 line drawing (whole GSM-era diagrams are typed that way: 23.046, 10.68, 03.97) and become a <pre class="ld">,
 * anything else is Symbol - but for the bullets, arrows and check marks 3GPP documents take from Wingdings.
 * scraper/docx/chardraw.py does the same with the fonts at hand; its tables generate the ones below.
 */

/** U+F020..U+F0FF without a font: Symbol, Wingdings' bullets/arrows/check marks ("\0": unmapped) */
const GUESS = " !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000·•€ϒ′≤⁄∞ƒ▪♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…|⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅➢∧∨⇔⇐⇑⇒⇓→〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪⇨〉∫⌠⎮⌡⎞⎟⎠⎤⎥✗✓☒☑\u0000";
/** Wingdings, for bullets and for paragraphs that hold a Wingdings-only mark ("☑YES / ❒NO", 36.912) */
const WINGDINGS = " \u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000☺\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000●\u0000■□\u0000❑❒\u0000\u0000◆❖⬥\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000·•\u0000\u0000\u0000\u0000\u0000\u0000\u0000▪◻\u0000\u0000★\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000➔\u0000\u0000\u0000\u0000\u0000\u0000\u0000➢\u0000\u0000\u0000\u0000\u0000\u0000←→↑↓↖↗↙↘⇦⇨⇧⇩\u0000\u0000\u0000\u0000⇦⇨⇧⇩⬄\u0000\u0000\u0000\u0000\u0000\u0000\u0000✗✓☒☑\u0000";
/** code page 437, 0x80..0xFF */
const CP437_HI = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

const PUA_G = /[\uf020-\uf0ff]/g;
const HAS_PUA = /[\uf020-\uf0ff]/;
const CORNERS = new Set([0xda, 0xbf, 0xc0, 0xd9, 0xc9, 0xbb, 0xc8, 0xbc, 0xc3, 0xb4, 0xc2, 0xc1, 0xcc, 0xb9, 0xcb, 0xca, 0xce]);
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** a paragraph's private-use characters look like a code page 437 drawing or text typed in a line-draw font:
 * a horizontal line, corners with verticals, or adjacent private-use spaces / letters (one Symbol β here and
 * there is no typed word) */
export function oemLike(s: string): boolean {
  const t = s.replace(/<[^>]*>/g, '');
  let corners = 0;
  let verts = 0;
  let spaces = 0;
  let alnum = 0;
  let prev = -1;
  for (let i = 0; i < t.length; i++) {
    const u = t.charCodeAt(i);
    if (u < 0xf020 || u > 0xf0ff) {
      spaces = alnum = 0;
      prev = -1;
      continue;
    }
    const c = u & 0xff;
    if ((c === 0xc4 || c === 0xcd) && prev === c) return true;
    prev = c;
    if (CORNERS.has(c)) corners++;
    if (c === 0xb3 || c === 0xba) verts++;
    spaces = c === 0x20 ? spaces + 1 : 0;
    alnum = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ? alnum + 1 : 0;
    if (spaces >= 3 || alnum >= 4) return true;
  }
  return corners > 0 && verts > 0;
}

function mapChar(ch: string, oem: boolean, wing = false): string {
  const c = ch.charCodeAt(0) & 0xff;
  if (oem) return c === 0xa0 || c === 0xff ? ' ' : c < 0x80 ? String.fromCharCode(c) : CP437_HI[c - 0x80];
  const w = wing ? WINGDINGS[c - 0x20] : '\0';
  const g = w !== '\0' ? w : GUESS[c - 0x20];
  return g && g !== '\0' ? g : ch;
}

/** marks only Wingdings has (☑ ☒ ✓ ✗ ➢ ▪): the paragraph's other symbols are Wingdings too */
const WING_ONLY = /[\uf0fb-\uf0fe\uf0d8\uf0a7]/;
/** a symbol that starts a paragraph or cell and is followed by a tab is a bullet */
const BULLET = /^(\s*)([\uf020-\uf0ff])(?=\s*<span class="(?:tab|inl))/;
const esc1 = (m: string) => m.replace(/[&<>]/g, (x) => ESC[x]);
/** a bullet: Wingdings' glyph; Symbol's own •, −, →, ⇒; any other code (38.769's 0xB2) a plain bullet */
function bullet(ch: string): string {
  const c = ch.charCodeAt(0) & 0xff;
  if (WINGDINGS[c - 0x20] !== '\0') return WINGDINGS[c - 0x20];
  return c === 0xb7 || c === 0x2d || c === 0xae || c === 0xde ? mapChar(ch, false) : '•';
}

/** map the private-use characters of a piece of HTML text (no tags inside) */
function mapText(s: string, oem: boolean, escape: boolean): string {
  return s.replace(PUA_G, (ch) => {
    const m = mapChar(ch, oem);
    return escape ? m.replace(/[&<>]/g, (x) => ESC[x]) : m;
  });
}

/** section HTML: paragraphs typed in a line-draw font become <pre class="ld">, other symbols their character */
export function fixPuaHtml(html: string): string {
  if (!HAS_PUA.test(html)) return html;
  let h = html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (whole, inner: string) => {
    if (!HAS_PUA.test(inner)) return whole;
    if (!oemLike(inner)) {
      const wing = WING_ONLY.test(inner);
      const open = whole.slice(0, whole.length - inner.length - 4);
      const body = inner.replace(BULLET, (_, sp: string, ch: string) => sp + esc1(bullet(ch)));
      return `${open}${body.replace(PUA_G, (ch) => esc1(mapChar(ch, false, wing)))}</p>`;
    }
    const text = mapText(inner, true, true)
      .replace(/<br\s*\/?>\n?/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|\u00a0/g, ' ');
    return `<pre class="ld"><code>${text}</code></pre>`;
  });
  // a drawing typed one paragraph per line is one block
  h = h.replace(/<\/code><\/pre>\s*<pre class="ld"><code>/g, '\n');
  // whatever is left (table cells, list items, headings, code): by the run of private-use characters itself
  return h.replace(/[\uf020-\uf0ff]+/g, (run) => mapText(run, oemLike(run), true));
}

/** search text: line by line */
export function fixPuaText(text: string): string {
  if (!HAS_PUA.test(text)) return text;
  return text
    .split('\n')
    .map((l) => (HAS_PUA.test(l) ? mapText(l, oemLike(l), false) : l))
    .join('\n');
}
