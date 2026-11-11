import { unsafeCSS } from 'lit';
import katexCss from 'katex/dist/katex.min.css?raw';

/** KaTeX rules without @font-face (fonts must be registered on the document — see embed.ts). */
export const katexRules = katexCss.replace(/@font-face\s*\{[^}]*\}/g, '');
export const katexFontFaces = (fontsBase: string) =>
  (katexCss.match(/@font-face\s*\{[^}]*\}/g) ?? []).map((r) => r.replace(/url\(fonts\//g, `url(${fontsBase}katex/`)).join('\n');
export const katexStyles = unsafeCSS(katexRules);
