import { SERIES, relName, releaseName } from '../../../shared/catalog.ts';
export { SERIES, relName, releaseName };

export const relLabel = (r: string | number) => (typeof r === 'number' || /^\d+$/.test(r) ? relName(r) : releaseName(r));

export function fmtNum(n: number) {
  return n.toLocaleString('en-US');
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(+dt)) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function sectionLabel(num: string | null | undefined, title: string) {
  return num ? `${num} ${title}` : title;
}

/** 3GPP-style citation: "3GPP TS 38.331 V19.2.0, clause 5.3.3" */
export function citation(type: string, spec: string, version: string | null, num?: string | null) {
  return `3GPP ${type} ${spec}${version ? ` V${version}` : ''}${num ? `, clause ${num}` : ''}`;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** lightweight ASN.1 highlighter -> HTML (input is plain text) */
const KW =
  /\b(SEQUENCE|SET|CHOICE|ENUMERATED|INTEGER|BOOLEAN|NULL|OPTIONAL|DEFAULT|SIZE|OF|BIT|OCTET|STRING|CONTAINING|EXTENSIBILITY|IMPLIED|DEFINITIONS|AUTOMATIC|TAGS|BEGIN|END|IMPORTS|FROM|EXPORTS|ALL|WITH|COMPONENTS|COMPONENT|PRESENT|ABSENT|CLASS|UNIQUE|IDENTIFIED|BY|OBJECT|IDENTIFIER|MIN|MAX|TRUE|FALSE|UTF8String|IA5String|PrintableString|VisibleString|REAL|ProtocolIE-Field|ProtocolExtensionField)\b/g;
export function highlightAsn1(src: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return src
    .split('\n')
    .map((line) => {
      const ci = line.indexOf('--');
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const com = ci >= 0 ? line.slice(ci) : '';
      let h = esc(code)
        .replace(KW, '\u0001k\u0002$1\u0003')
        .replace(/\b(\d+)\b/g, '\u0001n\u0002$1\u0003')
        .replace(/(^|[\s{(,])([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)(?=\s*(::=|\{|,|\)|$|\s+OPTIONAL|\s))/g, (m, pre, name) =>
          /^[A-Z]+$/.test(name) && name.length > 2 ? m : `${pre}\u0001t\u0002${name}\u0003`,
        );
      h = h.replace(/\u0001(\w)\u0002/g, '<span class="$1">').replace(/\u0003/g, '</span>');
      return h + (com ? `<span class="c">${esc(com)}</span>` : '');
    })
    .join('\n');
}

/** light YAML highlighting for the OpenAPI definitions: keys, strings, comments, $ref targets, numbers */
export function highlightYaml(src: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return src
    .split('\n')
    .map((line) => {
      // comment: a '#' at line start or after whitespace, outside quotes (good enough for OpenAPI files)
      const ci = line.search(/(^|\s)#/);
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const com = ci >= 0 ? line.slice(ci) : '';
      const m = /^(\s*(?:-\s+)?)([^\s:'"#][^:#]*?|'[^']*'|"[^"]*")(:)(\s|$)(.*)$/.exec(code);
      let h: string;
      if (m) {
        const val = m[5];
        let v = esc(val);
        if (/^\s*'.*'\s*$|^\s*".*"\s*$/.test(val)) v = `<span class="s">${v}</span>`;
        else if (/^\s*-?\d+(\.\d+)?\s*$|^\s*(true|false|null)\s*$/.test(val)) v = `<span class="n">${v}</span>`;
        h = `${esc(m[1])}<span class="k">${esc(m[2])}</span>${m[3]}${m[4]}${v}`;
      } else {
        h = esc(code).replace(/('[^']*'|"[^"]*")/g, '<span class="s">$1</span>');
      }
      return h + (com ? `<span class="c">${esc(com)}</span>` : '');
    })
    .join('\n');
}
