/** Static 3GPP reference data shared by the builder, server and UI. */

export const SERIES: Record<string, string> = {
  '00': 'GSM / 3GPP working procedures',
  '01': 'GSM general',
  '02': 'GSM service aspects (pre-Rel-4)',
  '03': 'GSM network aspects (pre-Rel-4)',
  '04': 'GSM MS–BSS interface and protocols (pre-Rel-4)',
  '05': 'GSM physical layer on the radio path (pre-Rel-4)',
  '06': 'GSM speech codecs (pre-Rel-4)',
  '07': 'GSM terminal adaptors (pre-Rel-4)',
  '08': 'GSM BSS–MSC interface (pre-Rel-4)',
  '09': 'GSM network interworking (pre-Rel-4)',
  '10': 'GSM service interworking (pre-Rel-4)',
  '11': 'GSM equipment and type approval (pre-Rel-4)',
  '12': 'GSM operation and maintenance (pre-Rel-4)',
  '21': 'Requirements',
  '22': 'Service aspects (stage 1)',
  '23': 'Technical realization (stage 2)',
  '24': 'Signalling protocols (stage 3) – UE to network',
  '25': 'Radio aspects (UTRA)',
  '26': 'Codecs',
  '27': 'Data',
  '28': 'Signalling protocols – RSS-CN, OAM&P and charging',
  '29': 'Signalling protocols (stage 3) – intra-fixed-network',
  '30': 'Programme management',
  '31': 'SIM / USIM, IC cards',
  '32': 'OAM&P and charging',
  '33': 'Security aspects',
  '34': 'UE and (U)SIM test specifications',
  '35': 'Security algorithms',
  '36': 'LTE (E-UTRA)',
  '37': 'Multiple radio access technologies',
  '38': 'NR (5G radio)',
  '41': 'GSM requirements',
  '42': 'GSM service aspects',
  '43': 'GSM technical realization',
  '44': 'GSM signalling protocols',
  '45': 'GSM radio aspects (GERAN)',
  '46': 'GSM codecs',
  '47': 'GSM data',
  '48': 'GSM signalling – BSS',
  '49': 'GSM signalling – intra-fixed-network',
  '50': 'GSM programme management',
  '51': 'GSM SIM and test specifications',
  '52': 'GSM OAM&P and charging',
  '55': 'GSM security algorithms',
};

export function seriesOf(spec: string): string {
  return spec.slice(0, 2);
}

/**
 * Release as a sortable number. Releases before Rel-4 map below 4:
 * R99 → 3, R98 → 2, R97 → 1, R96 and the GSM phases → 0.
 */
export function relNum(release: string): number {
  const r = release.trim().toLowerCase();
  const legacy = /^r(?:el-?)?(9[6-9])$/.exec(r);
  if (legacy) return Number(legacy[1]) - 96;
  if (/^ph/.test(r)) return 0;
  const m = /(\d+)/.exec(r);
  return m ? Number(m[1]) : 0;
}

/** display name of relNum(): 19 → "Rel-19", 3 → "R99", 0 → "R96 & GSM phases" */
export function relName(n: number | string): string {
  const v = Number(n);
  if (v >= 4) return `Rel-${v}`;
  return ['R96 & GSM phases', 'R97', 'R98', 'R99'][v] ?? `Rel-${v}`;
}

/** display name of a release string: "rel-19" → "Rel-19", "R98" → "R98", "Ph2" → "GSM Phase 2" */
export function releaseName(release: string): string {
  if (/^ph(\d)/i.test(release)) return `GSM Phase ${release.slice(2)}`;
  if (/^r9\d$/i.test(release)) return release.toUpperCase();
  return relName(relNum(release));
}

export interface VersionEntry {
  release: string;
  version: string;
  date: string;
  size: string;
  url: string;
}

const GSM_MAJOR: Record<number, string> = { 3: 'Ph1', 4: 'Ph2', 5: 'R96', 6: 'R97', 7: 'R98', 8: 'R99' };
const isGsmPhase = (spec: string) => Number(spec.slice(0, 2)) <= 12;

/**
 * release of a spec version ("rel-19", "R99", "Ph2"). GSM phase-1/2 series (01–12) number their versions
 * differently; versions 0.x–2.x are drafts that belong to no release by their number - `draft` (the
 * release of the spec's first approved version, or the itecspec / portal release) is used for those.
 */
export function releaseOfVersion(spec: string, version: string, draft?: string): string {
  const major = Number(version.split('.')[0]);
  if (isGsmPhase(spec)) return GSM_MAJOR[major] ?? (major < 3 ? (draft ?? 'Ph1') : 'R99');
  if (major >= 4) return `rel-${major}`;
  if (major === 3) return 'R99';
  return draft ?? 'R99';
}

const vkey = (v: string) => v.split('.').map((x) => x.padStart(4, '0')).join('.');
/** newest first */
export const byVersionDesc = (a: { version: string }, b: { version: string }) => vkey(b.version).localeCompare(vkey(a.version));

/** relabel a version list (newest first) with releaseOfVersion(); `fallback` for drafts of a never-approved spec */
export function labelReleases(spec: string, versions: VersionEntry[], fallback?: string): VersionEntry[] {
  const approved = versions.filter((v) => Number(v.version.split('.')[0]) >= 3).sort(byVersionDesc);
  const first = approved.length ? releaseOfVersion(spec, approved[approved.length - 1].version) : undefined;
  const draft = first ?? fallback;
  return versions.map((v) => ({ ...v, release: releaseOfVersion(spec, v.version, draft).replace(/^rel-/, 'Rel-') }));
}

/** "3rd Generation Partnership Project; Technical Specification Group Radio Access Network; NR; Foo" → {tsg:"RAN", short:"NR; Foo"} */
export function splitTitle(title: string): { tsg: string; short: string } {
  let t = title.replace(/\s+/g, ' ').trim();
  // some titles are duplicated "A; A"
  const half = t.length / 2;
  if (t.length > 40 && t.slice(0, Math.floor(half - 1)) === t.slice(Math.ceil(half + 1))) t = t.slice(0, Math.floor(half - 1)).trim();
  let tsg = '';
  t = t.replace(/^3rd Generation Partnership Project;?\s*/i, '');
  const m = /^Technical Specification Group ([^;]+);\s*/i.exec(t);
  if (m) {
    const g = m[1].trim();
    tsg = /radio access/i.test(g)
      ? 'RAN'
      : /services? and system/i.test(g)
        ? 'SA'
        : /core network/i.test(g)
          ? 'CT'
          : /GERAN|GSM EDGE/i.test(g)
            ? 'GERAN'
            : /terminals/i.test(g)
              ? 'CT'
              : g;
    t = t.slice(m[0].length);
  }
  t = t.replace(/\s*\((Release|Rel-?)\s*\d+\)\s*$/i, '').trim();
  return { tsg, short: t || title };
}
