/**
 * Turn the first mention of every known term in a block of spec text into a "concept link":
 * abbreviations from the spec's own abbreviation clause (+ the 3GPP vocabulary, TR 21.905) and
 * service-based interface / service / operation names (Nnrf, Nnrf_NFManagement, Nnrf_NFManagement_NFRegister).
 */

interface Matcher {
  re: RegExp;
  abbr: Map<string, string>;
}

const STOP = new Set(
  'AND OR NOT IF TO IN ON AT BY NO OF IS IT BE ALL ANY FOR THE NULL TRUE FALSE MAY SHALL MUST SHOULD NOTE EXAMPLE ID OK SET GET PUT POST'.split(' '),
);
/** English words that look like "N" + lower-case abbreviation */
const N_WORDS = new Set(
  'name names near need needs never new next node nodes none nor normal not note notes now null number numbers no non'.split(' '),
);
const SKIP = /^(A|BUTTON|PRE|CODE|H1|H2|H3|H4|H5|H6|FIGURE|SCRIPT|STYLE|TEXTAREA|SVG|MATH)$/;
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cache = new Map<string, Matcher>();

export function matcherFor(spec: string, abbrevs: [string, string][]): Matcher {
  let m = cache.get(spec);
  if (m) return m;
  const abbr = new Map<string, string>();
  const ifaces: string[] = [];
  for (const [a, e] of abbrevs) {
    const t = a.trim();
    if (t.length < 2 || t.length > 20 || STOP.has(t)) continue;
    const upper = (t.match(/[A-Z]/g) ?? []).length;
    if (upper < 2 && !(upper >= 1 && /\d/.test(t))) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]*[A-Za-z0-9)]$/.test(t)) continue;
    abbr.set(t, e);
    // network function abbreviation -> service-based interface name (NRF -> Nnrf)
    if (/^[A-Z0-9-]{2,8}$/.test(t) && /F$|^(UDM|UDR|NRF|AMF|SMF|PCF|NEF|AUSF|NSSF|CHF|UPF|BSF|LMF|SEPP|SCP|NWDAF|UCMF|5G-EIR|AF|GMLC|MB-SMF|NSACF|DCCF|ADRF|MFAF|EASDF|TSCTSF|NSSAAF|NSWOF|PANF|AANF|MBSF|MBSTF|EES|ECS|EAS)$/.test(t)) {
      const n = 'N' + t.toLowerCase();
      if (!N_WORDS.has(n.toLowerCase())) ifaces.push(n);
    }
  }
  const alts = [...abbr.keys(), ...ifaces].sort((a, b) => b.length - a.length).map(reEsc);
  // service / operation names first (they contain the interface name)
  const svc = String.raw`N[a-z0-9][a-z0-9-]{1,10}_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?`;
  const re = new RegExp(String.raw`(?<![A-Za-z0-9_-])(${svc}${alts.length ? '|' + alts.join('|') : ''})(?![A-Za-z0-9_-])`, 'g');
  m = { re, abbr };
  if (cache.size > 12) cache.clear();
  cache.set(spec, m);
  return m;
}

/** wrap first occurrences in `scope` (not descending into `exclude` elements); returns links created */
export function linkTerms(scope: HTMLElement, m: Matcher, exclude?: (el: Element) => boolean, limit = 250): number {
  const seen = new Set<string>();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentElement; p && p !== scope; p = p.parentElement) {
        if (SKIP.test(p.tagName) || p.classList.contains('katex') || p.classList.contains('term') || exclude?.(p)) return NodeFilter.FILTER_REJECT;
      }
      return n.nodeValue && n.nodeValue.length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let made = 0;
  for (const node of nodes) {
    if (made >= limit) break;
    const text = node.nodeValue!;
    m.re.lastIndex = 0;
    const cuts: { from: number; to: number; term: string }[] = [];
    for (let r = m.re.exec(text); r; r = m.re.exec(text)) {
      const term = r[1];
      if (seen.has(term)) continue;
      seen.add(term);
      let from = r.index;
      let to = from + term.length;
      // include the spelled-out name: "Authentication Server Function (AUSF)"
      const exp = m.abbr.get(term);
      if (exp && text[from - 1] === '(' && text[to] === ')') {
        const before = text.slice(0, from - 1).replace(/\s+$/, '');
        if (before.toLowerCase().endsWith(exp.toLowerCase())) {
          from = before.length - exp.length;
          to += 1;
        }
      }
      cuts.push({ from, to, term });
      if (made + cuts.length >= limit) break;
    }
    if (!cuts.length) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const c of cuts) {
      if (c.from < at) continue;
      if (c.from > at) frag.append(text.slice(at, c.from));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'term';
      b.dataset.term = c.term;
      b.setAttribute('aria-haspopup', 'dialog');
      b.textContent = text.slice(c.from, c.to);
      const exp = m.abbr.get(c.term);
      if (exp) b.title = exp;
      frag.append(b);
      at = c.to;
      made++;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
  return made;
}
