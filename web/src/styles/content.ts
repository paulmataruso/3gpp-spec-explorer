import { css } from 'lit';

/** Typography for rendered specification content (output of shared/render.ts). */
export const content = css`
  .prose {
    font-size: var(--se-content-size, 16px);
    line-height: 1.7;
    color: var(--c-text-2);
    overflow-wrap: anywhere;
  }
  .prose > :first-child {
    margin-top: 0;
  }
  .prose p {
    margin: 0 0 0.85em;
  }
  .prose p.ctr {
    text-align: center;
  }
  .prose p.rgt {
    text-align: right;
  }
  .prose p.cap {
    text-align: center;
    font-size: 0.875em;
    font-weight: 600;
    color: var(--c-text);
    margin: 0.4em auto 1.6em;
    max-width: 60ch;
  }
  .prose p.note {
    position: relative;
    margin: 1em 0;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--c-border);
    background: var(--c-surface-2);
    font-size: 0.94em;
  }
  .prose .tab {
    display: inline-block;
    width: 1.6em;
  }
  .prose strong {
    color: var(--c-text);
    font-weight: 600;
  }
  .prose ul,
  .prose ol {
    margin: 0 0 1em;
    padding-left: 1.4em;
  }
  .prose li {
    margin: 0.25em 0;
  }
  .prose li::marker {
    color: var(--c-muted);
  }
  .prose sub,
  .prose sup {
    font-size: 0.72em;
    line-height: 0;
  }
  .prose a.xref {
    color: var(--c-accent-text);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--c-accent) 35%, transparent);
    text-underline-offset: 3px;
    cursor: pointer;
    transition: text-decoration-color var(--_dur) var(--_ease);
  }
  .prose a.xref:hover {
    text-decoration-color: currentColor;
  }
  .prose .ref {
    color: var(--c-text);
    font-weight: 500;
  }

  /* tables */
  .prose .tbl {
    margin: 0.5em 0 1.4em;
    overflow-x: auto;
    border: 1px solid var(--c-border);
    border-radius: 8px;
    background: var(--c-surface);
    scrollbar-width: thin;
  }
  .prose table {
    border-collapse: collapse;
    min-width: 100%;
    font-size: 13.5px;
    line-height: 1.45;
  }
  .prose th,
  .prose td {
    border: 1px solid var(--c-border);
    padding: 6px 10px;
    vertical-align: top;
    text-align: left;
  }
  .prose tr > :first-child {
    border-left: 0;
  }
  .prose tr > :last-child {
    border-right: 0;
  }
  .prose thead tr:first-child > *,
  .prose table > tr:first-child > *,
  .prose tbody:first-child tr:first-child > * {
    border-top: 0;
  }
  .prose tbody tr:last-child > * {
    border-bottom: 0;
  }
  .prose th {
    background: var(--c-surface-3);
    color: var(--c-text);
    font-weight: 600;
    position: sticky;
    top: 0;
  }
  .prose th strong {
    font-weight: 600;
  }
  /* one-cell "boxed text" tables (text proposals, solution flows) hold whole clauses with nested tables */
  .prose th:has(table, p + p) {
    position: static;
    font-weight: 400;
    text-align: start;
  }
  .prose td.ctr,
  .prose th.ctr {
    text-align: center;
  }
  .prose td.rgt,
  .prose th.rgt {
    text-align: right;
  }
  /* spreadsheets from a spec's zip (test tolerance analyses, link budgets): compact, numbers aligned */
  .prose table.sheet td,
  .prose table.sheet th {
    padding: 0.2rem 0.5rem;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .prose table.sheet td.wrap,
  .prose table.sheet th.wrap {
    white-space: normal;
    min-width: 16ch;
    max-width: 48ch;
  }
  .prose table.sheet td:empty {
    padding: 0;
  }
  /* "Document … from the specification's zip file" above a rendered zip document */
  .prose p.zip-doc {
    color: var(--c-muted);
    font-size: 0.8125rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--c-border);
  }
  .prose tbody tr:hover td {
    background: color-mix(in srgb, var(--c-accent) 4%, transparent);
  }
  .prose td p,
  .prose th p {
    margin: 0;
  }
  .prose td p + p,
  .prose th p + p {
    margin-top: 0.4em;
  }
  .prose td p.th {
    font-weight: 600;
    color: var(--c-text);
  }
  .prose td p.note {
    margin: 0.3em 0;
    padding: 4px 8px;
    font-size: 0.95em;
  }

  /* 3GPP list / definition paragraph styles (B1..B5 "-<tab>text", EX "[1]<tab>ref") */
  .prose p.b1,
  .prose p.b2,
  .prose p.b3,
  .prose p.b4,
  .prose p.b5 {
    --b: 1;
    padding-left: calc(var(--b) * 1.6em);
    text-indent: -1.6em;
    margin-bottom: 0.45em;
  }
  .prose p.b2 {
    --b: 2;
  }
  .prose p.b3 {
    --b: 3;
  }
  .prose p.b4 {
    --b: 4;
  }
  .prose p.b5 {
    --b: 5;
  }
  .prose p.b1 > .tab:first-child,
  .prose p.b2 > .tab:first-child,
  .prose p.b3 > .tab:first-child,
  .prose p.b4 > .tab:first-child,
  .prose p.b5 > .tab:first-child {
    width: 1.1em;
  }
  .prose p.ex {
    padding-left: 4.5em;
    text-indent: -4.5em;
    margin-bottom: 0.45em;
  }
  .prose p.ex > .tab:first-child {
    width: 2.4em;
  }
  /* "TERM<tab>description" rows: abbreviations, interface lists, definitions */
  .prose p.def {
    display: flex;
    gap: 0 1.2em;
    margin: 0 0 0.3em;
    padding: 2px 0;
  }
  .prose p.def .dt {
    flex: none;
    width: 9em;
    color: var(--c-text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .prose p.def .dt strong {
    font-weight: inherit;
  }
  .prose p.def .dd {
    flex: 1;
    min-width: 0;
  }
  .prose p.def + p:not(.def) {
    margin-top: 1em;
  }
  .prose p.ind {
    padding-left: 1.6em;
  }
  @container (max-width: 520px) {
    .prose p.def {
      flex-direction: column;
    }
    .prose p.def .dt {
      width: auto;
    }
  }

  /* concept links (first mention of an abbreviation / service name) */
  .prose button.term {
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: inherit;
    cursor: pointer;
    text-decoration: underline dotted;
    text-decoration-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    border-radius: 3px;
    transition:
      color var(--_dur) var(--_ease),
      background var(--_dur) var(--_ease);
  }
  .prose button.term:hover {
    color: var(--c-accent-text);
    background: var(--c-accent-soft);
  }
  .prose button.term:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }

  /* figures — always on a light card so black-on-white diagrams stay legible in dark mode */
  .prose figure.fig {
    margin: 1.2em auto 0.4em;
    text-align: center;
  }
  .prose figure.fig img {
    display: inline-block;
    max-width: 100%;
    height: auto;
    background: var(--c-figure-bg);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 0 0 1px var(--c-border);
    cursor: zoom-in;
  }
  .prose figure.fig img.inline-eq {
    padding: 2px 4px;
    box-shadow: none;
    cursor: default;
  }
  .prose figure.fig.missing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 72px;
    padding: 14px;
    border: 1px dashed var(--c-border-strong);
    border-radius: 8px;
    color: var(--c-muted);
    font-size: 13px;
    background: var(--c-surface-2);
  }

  /* ASN.1 */
  .prose pre {
    margin: 0.4em 0 1.4em;
    padding: 14px 16px;
    border: 1px solid var(--c-border);
    border-radius: 8px;
    background: var(--c-code-bg);
    overflow-x: auto;
    font-family: var(--_mono);
    font-size: 13px;
    line-height: 1.6;
    color: var(--c-syn-field);
    tab-size: 4;
    scrollbar-width: thin;
  }
  /* line drawings (style LD): a figure drawn with characters - centred, no code colours */
  .prose pre.ld {
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
    background: transparent;
    color: var(--c-text);
    line-height: 1.35;
    /* one font for every glyph: the bundled JetBrains Mono subset has no box-drawing characters, and a
       fallback font's wider "─" pushes the right edge of the drawing out of line */
    font-family: ui-monospace, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, 'Courier New', monospace;
    font-variant-ligatures: none;
  }
  .prose pre.ld code {
    font-family: inherit;
  }
  .prose pre .k {
    color: var(--c-syn-kw);
    font-weight: 500;
  }
  .prose pre .t {
    color: var(--c-syn-type);
  }
  .prose pre .c {
    color: var(--c-syn-com);
    font-style: italic;
  }
  .prose pre .n {
    color: var(--c-syn-num);
  }

  /* OpenAPI / YAML */
  .prose pre .s {
    color: var(--c-syn-type);
  }
  .prose .codebar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0.6em 0 0;
    padding: 6px 8px 6px 14px;
    border: 1px solid var(--c-border);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    background: var(--c-surface-2);
    font-size: 12.5px;
    color: var(--c-muted);
  }
  .prose .codebar + pre {
    margin-top: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .prose .codebar .lang {
    font-weight: 600;
    color: var(--c-text);
  }
  .prose .codebar .sp {
    flex: 1;
  }
  .prose .codebar button {
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid var(--c-border);
    border-radius: 6px;
    background: var(--c-surface);
    color: var(--c-text-2);
    font: inherit;
    cursor: pointer;
    transition:
      color var(--_dur) var(--_ease),
      border-color var(--_dur) var(--_ease);
  }
  .prose .codebar button:hover {
    color: var(--c-text);
    border-color: var(--c-border-strong);
  }
  .prose .codebar button:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 1px;
  }
  .prose pre.yaml.long:not(.open),
  .prose pre.file.long:not(.open) {
    max-height: 32em;
    overflow-y: auto;
  }

  /* KaTeX */
  .prose .katex {
    font-size: 1.08em;
  }
  .prose .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 0;
  }
  .prose table .katex {
    font-size: 1em;
  }
`;
