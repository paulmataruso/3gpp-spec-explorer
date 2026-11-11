/**
 * Entry point: `<script type="module" src="https://your-host/embed.js"></script>`
 * then `<spec-explorer></spec-explorer>` anywhere on the page.
 */
import { SpecExplorer } from './app.ts';
import { katexFontFaces } from './styles/katex.ts';

declare global {
  interface Window {
    SPEC_EXPLORER_FONTS?: string | false;
  }
}

function injectFonts() {
  if (document.getElementById('spec-explorer-fonts') || window.SPEC_EXPLORER_FONTS === false) return;
  const base = window.SPEC_EXPLORER_FONTS || new URL(/* @vite-ignore */ "fonts/", import.meta.url).href;
  const face = (family: string, file: string, weight: number, style = 'normal') =>
    `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(${base}${file}) format('woff2');}`;
  const css = [
    face('IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', 400),
    face('IBM Plex Sans', 'ibm-plex-sans-latin-400-italic.woff2', 400, 'italic'),
    face('IBM Plex Sans', 'ibm-plex-sans-latin-500-normal.woff2', 500),
    face('IBM Plex Sans', 'ibm-plex-sans-latin-600-normal.woff2', 600),
    face('IBM Plex Sans', 'ibm-plex-sans-latin-700-normal.woff2', 700),
    face('JetBrains Mono', 'jetbrains-mono-latin-400-normal.woff2', 400),
    face('JetBrains Mono', 'jetbrains-mono-latin-500-normal.woff2', 500),
    face('JetBrains Mono', 'jetbrains-mono-latin-600-normal.woff2', 600),
    katexFontFaces(base),
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'spec-explorer-fonts';
  style.textContent = css;
  document.head.appendChild(style);
}

injectFonts();
if (!customElements.get('spec-explorer')) customElements.define('spec-explorer', SpecExplorer);

export { SpecExplorer };
