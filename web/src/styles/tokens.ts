import { css } from 'lit';

/**
 * Design tokens. Every token is overridable from the host page, e.g.
 *   spec-explorer { --se-accent: #e11d48; --se-font: "Inter", sans-serif; }
 * Light/dark values are selected by the [theme] attribute on the root element,
 * which inherits down through nested shadow roots via custom properties.
 */
export const tokens = css`
  :host {
    --_font: var(--se-font, 'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    --_mono: var(--se-mono, 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace);
    --_radius: var(--se-radius, 10px);
    --_radius-sm: 6px;
    --_ease: cubic-bezier(0.2, 0, 0, 1);
    --_dur: 180ms;
  }
`;

/** palette — applied on the root element only, inherited by every child shadow root */
export const palette = css`
  :host {
    color-scheme: light;
    --c-bg: var(--se-bg, #f8fafc);
    --c-surface: var(--se-surface, #ffffff);
    --c-surface-2: var(--se-surface-2, #f8fafc);
    --c-surface-3: var(--se-surface-3, #f1f5f9);
    --c-border: var(--se-border, #e2e8f0);
    --c-border-strong: var(--se-border-strong, #cbd5e1);
    --c-text: var(--se-text, #0f172a);
    --c-text-2: var(--se-text-2, #334155);
    --c-muted: var(--se-muted, #64748b);
    --c-accent: var(--se-accent, #2563eb);
    --c-accent-hover: var(--se-accent-hover, #1d4ed8);
    --c-accent-soft: var(--se-accent-soft, #eff6ff);
    --c-accent-text: var(--se-accent-text, #1d4ed8);
    --c-on-accent: var(--se-on-accent, #ffffff);
    --c-tr: var(--se-tr, #7c3aed);
    --c-tr-soft: var(--se-tr-soft, #f5f3ff);
    --c-mark: var(--se-mark, #fef08a);
    --c-mark-text: var(--se-mark-text, #0f172a);
    --c-success: #16a34a;
    --c-warn: #b45309;
    --c-code-bg: var(--se-code-bg, #f8fafc);
    --c-shadow: 0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px rgb(15 23 42 / 0.06);
    --c-shadow-lg: 0 24px 64px -12px rgb(15 23 42 / 0.25), 0 2px 6px rgb(15 23 42 / 0.06);
    --c-overlay: rgb(15 23 42 / 0.35);
    --c-figure-bg: #ffffff;
    --c-syn-kw: #7c3aed;
    --c-syn-type: #0369a1;
    --c-syn-com: #64748b;
    --c-syn-num: #b45309;
    --c-syn-field: #0f172a;
  }
  :host([data-theme='dark']) {
    color-scheme: dark;
    --c-bg: var(--se-bg-dark, #020617);
    --c-surface: var(--se-surface-dark, #0b1220);
    --c-surface-2: var(--se-surface-2-dark, #0f172a);
    --c-surface-3: var(--se-surface-3-dark, #1e293b);
    --c-border: var(--se-border-dark, #1e293b);
    --c-border-strong: var(--se-border-strong-dark, #334155);
    --c-text: var(--se-text-dark, #f8fafc);
    --c-text-2: var(--se-text-2-dark, #cbd5e1);
    --c-muted: var(--se-muted-dark, #94a3b8);
    --c-accent: var(--se-accent-dark, #60a5fa);
    --c-accent-hover: var(--se-accent-hover-dark, #93c5fd);
    --c-accent-soft: var(--se-accent-soft-dark, rgb(96 165 250 / 0.12));
    --c-accent-text: var(--se-accent-text-dark, #93c5fd);
    --c-on-accent: var(--se-on-accent-dark, #020617);
    --c-tr: var(--se-tr-dark, #a78bfa);
    --c-tr-soft: var(--se-tr-soft-dark, rgb(167 139 250 / 0.12));
    --c-mark: var(--se-mark-dark, rgb(250 204 21 / 0.3));
    --c-mark-text: var(--se-mark-text-dark, #fef9c3);
    --c-code-bg: var(--se-code-bg-dark, #0f172a);
    --c-shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 4px 16px rgb(0 0 0 / 0.25);
    --c-shadow-lg: 0 24px 64px -12px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(148 163 184 / 0.12);
    --c-overlay: rgb(2 6 23 / 0.6);
    --c-figure-bg: #f8fafc;
    --c-syn-kw: #c4b5fd;
    --c-syn-type: #7dd3fc;
    --c-syn-com: #64748b;
    --c-syn-num: #fcd34d;
    --c-syn-field: #e2e8f0;
  }
`;

/** primitives shared by every view */
export const base = css`
  :host {
    font-family: var(--_font);
    color: var(--c-text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    box-sizing: border-box;
  }
  *,
  *::before,
  *::after {
    box-sizing: inherit;
  }
  [hidden] {
    display: none !important;
  }
  a {
    color: var(--c-accent-text);
    text-decoration: none;
  }
  button {
    font: inherit;
    color: inherit;
  }
  :focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .mono {
    font-family: var(--_mono);
    font-feature-settings: 'zero' 0, 'calt' 0;
  }
  .muted {
    color: var(--c-muted);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .icon {
    width: 18px;
    height: 18px;
    flex: none;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .icon.sm {
    width: 15px;
    height: 15px;
  }
  .icon.lg {
    width: 22px;
    height: 22px;
  }

  /* buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--c-border);
    background: var(--c-surface);
    color: var(--c-text-2);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--_dur) var(--_ease),
      border-color var(--_dur) var(--_ease),
      color var(--_dur) var(--_ease);
  }
  .btn:hover {
    background: var(--c-surface-3);
    color: var(--c-text);
    border-color: var(--c-border-strong);
  }
  .btn.primary {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: var(--c-on-accent);
  }
  .btn.primary:hover {
    background: var(--c-accent-hover);
    border-color: var(--c-accent-hover);
  }
  .btn.ghost {
    border-color: transparent;
    background: transparent;
  }
  .btn.ghost:hover {
    background: var(--c-surface-3);
  }
  .btn.icon-only {
    padding: 0;
    width: 36px;
  }
  .btn[aria-pressed='true'] {
    color: var(--c-accent-text);
    background: var(--c-accent-soft);
    border-color: transparent;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* badges / chips */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    background: var(--c-surface-3);
    color: var(--c-text-2);
    white-space: nowrap;
  }
  .badge.ts {
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
  }
  .badge.tr {
    background: var(--c-tr-soft);
    color: var(--c-tr);
  }
  .badge.outline {
    background: transparent;
    border: 1px solid var(--c-border);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--c-border);
    background: var(--c-surface);
    color: var(--c-text-2);
    font-size: 13px;
    cursor: pointer;
    transition:
      background var(--_dur) var(--_ease),
      border-color var(--_dur) var(--_ease),
      color var(--_dur) var(--_ease);
  }
  .chip:hover {
    border-color: var(--c-border-strong);
    color: var(--c-text);
  }
  .chip[aria-pressed='true'] {
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
    border-color: color-mix(in srgb, var(--c-accent) 35%, transparent);
  }
  .chip .count {
    font-size: 11px;
    color: var(--c-muted);
  }
  .spec-id {
    font-family: var(--_mono);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* inputs */
  .input {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border: 1px solid var(--c-border);
    border-radius: 8px;
    background: var(--c-surface);
    color: var(--c-muted);
    transition:
      border-color var(--_dur) var(--_ease),
      box-shadow var(--_dur) var(--_ease);
  }
  .input:focus-within {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-accent) 18%, transparent);
  }
  .input input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font: inherit;
    font-size: 14px;
    color: var(--c-text);
  }
  .input input::placeholder {
    color: var(--c-muted);
  }
  kbd,
  .kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 5px;
    border: 1px solid var(--c-border);
    border-bottom-width: 2px;
    background: var(--c-surface-2);
    color: var(--c-muted);
    font-family: var(--_font);
    font-size: 11px;
    font-weight: 500;
  }

  /* cards */
  .card {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--_radius);
  }

  /* skeleton */
  .skel {
    border-radius: 6px;
    background: linear-gradient(90deg, var(--c-surface-3) 0%, var(--c-surface-2) 50%, var(--c-surface-3) 100%);
    background-size: 200% 100%;
    animation: skel 1.3s ease-in-out infinite;
  }
  @keyframes skel {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
  mark {
    background: var(--c-mark);
    color: var(--c-mark-text);
    border-radius: 3px;
    padding: 0 1px;
  }
  .scroll {
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--c-border-strong) transparent;
  }
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;
