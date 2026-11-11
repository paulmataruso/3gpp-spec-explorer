"""Band combinations that TS 38.101-1/-2/-3 keep beside the document (from Rel-20 on).

The clauses that used to hold the CA / DC configuration tables now say "Configurations for inter-band CA are
specified utilizing the 3GPP Forge in [20] and found within the TS zip file. Directory: NR_Inter-band_CA_FR1"
and the zip carries "Band Combinations.zip": one JSON file per configuration, JSON schemas whose note flags
carry the note texts, and PDF renderings of the tables. Here the JSON becomes the tables again, laid out like
3GPP's own PDF renderings, in the clause that points to them:

  - a clause gets the configurations of its directory that fit its title: CA or DC, EN-DC (E-UTRA anchor first)
    or NE-DC (NR first) or NR-DC (no E-UTRA band), intra- or inter-band, contiguous or not, within FR1 / including
    FR2 / FR1 and FR2, "(three bands)";
  - a directory name the text gets wrong (38.101-3 says NR_Inter-band_DC_FR1, the zip has Inter-band_DC_FR1)
    falls back to every directory, the title still decides;
  - configurations no clause takes go to the first clause that took some of the same directory, so none is lost.
"""

import html
import io
import json
import os
import re
import zipfile

FR2_MIN = 257  # n257 and above are FR2 bands
_WORDS = {'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10}
_COMP = re.compile(r'(?:^|[_-])(\(n\))?(n)?(\d+)(\(n\))?')
_DIR = re.compile(r'Directory:?\s*(?:<[^>]+>\s*)*([A-Za-z0-9][\w\-]*)')


def data_zip(z, zpath):
    """the band combination archive inside the spec zip (as published, not as prepared by legacy.py)"""
    src = z
    if zpath and os.path.exists(zpath + '.orig'):
        try:
            src = zipfile.ZipFile(zpath + '.orig')
        except zipfile.BadZipFile:
            pass
    for n in src.namelist():
        low = os.path.basename(n).lower()
        if low.endswith('.zip') and 'band' in low and 'combination' in low:
            try:
                return zipfile.ZipFile(io.BytesIO(src.read(n)))
            except zipfile.BadZipFile:
                return None
    return None


def _collect_notes(o, notes):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'notes' and isinstance(v, dict) and isinstance(v.get('properties'), dict):
                for flag, d in v['properties'].items():
                    if isinstance(d, dict) and d.get('description'):
                        notes.setdefault(flag, d['description'])
            _collect_notes(v, notes)
    elif isinstance(o, list):
        for v in o:
            _collect_notes(v, notes)


def load(bz):
    """{directory: [configuration]} (band definitions left out: clause 5.3.5 keeps that table) and
    {note flag: note text}"""
    dirs, notes = {}, {}
    for n in sorted(bz.namelist()):
        if n.endswith('/') or not n.lower().endswith('.json'):
            continue
        parts = [p for p in n.split('/') if p]
        if len(parts) < 2:
            continue
        try:
            obj = json.loads(bz.read(n).decode('utf-8-sig'))
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(obj, dict):
            continue
        if '$schema' in obj or 'schema' in parts[-2].lower():
            _collect_notes(obj, notes)
        elif obj.get('bcId'):
            dirs.setdefault(parts[-2], []).append(obj)
    return dirs, notes


def features(bc):
    """what a configuration name says: CA_n1A-n3A, DC_1A-(n)3AA_n8A, DC_n28A_3A, DC_n77A_n257A"""
    kind, _, raw = bc.partition('_')
    # n261(A-2G), n77(2A): carriers of one band, not more bands
    body = re.sub(r'\((?!n\))[^)]*\)', '', raw)
    comps = []
    for m in _COMP.finditer(body):
        num = int(m.group(3))
        if m.group(1) or m.group(4):  # (n)3AA, 3(n)AA (NE-DC): E-UTRA and NR in the same band
            comps += [('lte', num, True), ('nr', num, True)]
        else:
            comps.append(('nr' if m.group(2) else 'lte', num, False))
    nums = {c[1] for c in comps}
    # 38.101-3 counts E-UTRA band 3 and NR band n3 as two bands: DC_(n)3AA-n28A is in "(three bands)"
    pairs = {(c[0], c[1]) for c in comps}
    lte = any(c[0] == 'lte' for c in comps)
    nr = [c[1] for c in comps if c[0] == 'nr']
    both = {c[1] for c in comps if c[0] == 'lte'} & set(nr)
    return {
        'kind': kind.upper(),
        'bands': len(pairs),
        'nums': len(nums),
        'lte': lte,
        'nr_first': bool(comps) and comps[0][0] == 'nr' and not comps[0][2],
        'fr2': any(n >= FR2_MIN for n in nr),
        'fr1': any(n < FR2_MIN for n in nr),
        'contig': '(n)' in raw if kind.upper() == 'DC' else '(' not in raw,
        'noncontig': bool(both) and '(n)' not in raw if kind.upper() == 'DC' else '(' in raw,
    }


def wants(title, f, notes=()):
    """does a clause titled so take this configuration"""
    t = ' ' + title.lower().replace('‑', '-') + ' '
    if re.search(r'\bca\b|carrier aggregation', t) and not re.search(r'\bdc\b|-dc\b', t) and f['kind'] != 'CA':
        return False
    if re.search(r'\b(?:en-|ne-|nr-)?dc\b|dual connectivity', t) and f['kind'] != 'DC':
        return False
    if 'en-dc' in t and not (f['lte'] and not f['nr_first']):
        return False
    if 'ne-dc' in t and not (f['lte'] and f['nr_first']):
        return False
    if 'nr-dc' in t and f['lte']:
        return False
    if 'intra-band' in t and f['nums'] != 1:
        return False
    if 'inter-band' in t and f['nums'] < 2:
        return False
    if 'intra-band' in t:
        both = 'intraBandENDC_both' in notes
        if 'non-contiguous' in t:
            if not (f['noncontig'] or both or 'intraBandENDC_nonCont' in notes):
                return False
        elif 'contiguous' in t and not (f['contig'] or both):
            return False
    if 'within fr1' in t and f['fr2']:
        return False
    if 'fr1 and fr2' in t:
        if not (f['fr2'] and f['fr1']):
            return False
    elif 'including fr2' in t and not (f['fr2'] and not f['fr1']):
        return False
    m = re.search(r'\((\w+) bands?\)', t)
    if m and _WORDS.get(m.group(1), -1) != f['bands']:
        return False
    return True


def _e(s):
    return html.escape(str(s), quote=False)


def _flags(notes):
    return [k for k, v in (notes or {}).items() if v]


def _ul(items):
    out = []
    for u in items or []:
        name = u.get('bcId') or u.get('bandNumber') or ''
        fl = _flags(u.get('notes'))
        out.append(_e(name) + (f' <span class="bc-note">({_e(", ".join(fl))})</span>' if fl else ''))
    return '<br>'.join(out)


def _bw(v):
    if isinstance(v, list):
        return ', '.join(_bw(x) for x in v)
    return _e(v)


def _carriers(band):
    """one line per variant; the carriers of a line are separated by ' | '"""
    lines = []
    for c in band.get('nonContiguousCarriers') or []:
        lines.append(_bw(c))
    for variant in band.get('contiguousCarriers') or []:
        lines.append(' | '.join(_bw(c) for c in variant))
    for r in band.get('referencedComponents') or []:
        if r.get('bcId'):
            lines.append(f'{_e(r["bcId"])}_BCS{_e(r.get("bcsId", ""))}')
        elif r.get('bandNumber'):
            lines.append(_e(r['bandNumber']))
    return '<br>'.join(lines)


def _bcs_label(ids):
    ids = [str(i) for i in ids]
    return ids[0] if len(ids) == 1 else ', '.join(ids[:-1]) + ' and ' + ids[-1]


def _ca_rows(cfg):
    """DL configuration | BCS | UL configurations | band | channel bandwidths | max aggregated BW"""
    groups = []  # identical bandwidth combination sets are shown once ("4 and 5")
    for bcs in cfg.get('bcsList') or []:
        key = json.dumps({k: v for k, v in bcs.items() if k != 'bcsId'}, sort_keys=True)
        for g in groups:
            if g[0] == key:
                g[1].append(bcs.get('bcsId'))
                break
        else:
            groups.append((key, [bcs.get('bcsId')], bcs))
    nrows = sum(max(1, len(g[2].get('bandList') or [])) for g in groups) or 1
    fl = _flags(cfg.get('notes'))
    name = _e(cfg['bcId']) + (f'<br><span class="bc-note">({_e(", ".join(fl))})</span>' if fl else '')
    rows, first = [], True
    for _, ids, bcs in groups or [(None, [''], {})]:
        bands = bcs.get('bandList') or [{}]
        for i, band in enumerate(bands):
            cells = []
            if first:
                cells.append(f'<td rowspan="{nrows}">{name}</td>')
                first = False
            if i == 0:
                span = f' rowspan="{len(bands)}"' if len(bands) > 1 else ''
                cells.append(f'<td{span}>{_e(_bcs_label(ids))}</td><td{span}>{_ul(bcs.get("ulConfigList"))}</td>')
            agg = band.get('maxAggBwPerBand')
            cells.append(f'<td>{_e(band.get("bandNumber", ""))}</td><td>{_carriers(band)}</td><td>{_e(agg) if agg is not None else ""}</td>')
            rows.append('<tr>' + ''.join(cells) + '</tr>')
    return rows


def _dc_rows(cfg):
    """DL configuration | UL configurations | single UL allowed | DL interruptions allowed"""
    fl = _flags(cfg.get('notes'))
    name = _e(cfg['bcId']) + (f'<br><span class="bc-note">({_e(", ".join(fl))})</span>' if fl else '')
    return [f'<tr><td>{name}</td><td>{_ul(cfg.get("ulConfigList"))}</td><td>{_e(cfg.get("singleUlAllowed", ""))}</td>'
            f'<td>{_e(cfg.get("dlInterruptionsAllowed", ""))}</td></tr>']


def _used_flags(cfgs):
    seen = []

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'notes' and isinstance(v, dict):
                    for f in _flags(v):
                        if f not in seen:
                            seen.append(f)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(cfgs)
    return seen


def table(cfgs, folder, notes, caption):
    """the configurations as one table, note texts below it"""
    ca = any('bcsList' in c for c in cfgs)
    head = ('<tr><th>DL configuration</th><th>BCS</th><th>UL configurations</th><th>Band</th>'
            '<th>Channel bandwidths [MHz]</th><th>Max aggregated BW [MHz]</th></tr>') if ca else (
            '<tr><th>DL configuration</th><th>UL configurations</th><th>Single UL allowed</th>'
            '<th>DL interruptions allowed</th></tr>')
    body = []
    for c in cfgs:
        body += _ca_rows(c) if ca else _dc_rows(c)
    out = [f'<div class="p-cap"><p>{_e(caption)}</p></div>',
           f'<table class="bc-table" data-bc-dir="{_e(folder)}"><thead>{head}</thead><tbody>{"".join(body)}</tbody></table>']
    if ca:
        out.append('<div class="p-note"><p>NOTE:<span class="tab"></span>Channel bandwidths: one line per variant; '
                   'contiguous carriers are separated by "|". CA_xxx_BCSn or a band number: the bandwidths of '
                   'that configuration or band apply.</p></div>')
    for f in _used_flags(cfgs):
        if f in notes:
            out.append(f'<div class="p-note"><p>{_e(f)}:<span class="tab"></span>{_e(notes[f])}</p></div>')
    return '\n'.join(out)


def _text(h):
    return html.unescape(re.sub(r'<[^>]+>', ' ', h))


def _sort_key(bc):
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', bc)]


def find_targets(sections, order, titles, dirs, parents=()):
    """(clause, title, directory named, directories to draw from) in document order"""
    lower = {d.lower(): d for d in dirs}
    targets, near = [], {}
    for sid in order:
        h = sections.get(sid) or ''
        if 'Directory' not in h:
            continue
        names = [m.group(1) for m in _DIR.finditer(h) if 'schema' not in m.group(1).lower()]
        if not names or not re.search(r'Forge|zip file', _text(h)):
            continue
        for name in dict.fromkeys(names):
            exact = lower.get(name.lower())
            pool = [exact] if exact else list(dirs)
            targets.append((sid, titles.get(sid) or '', name, pool))
            # 38.101-3 v20.1: 5.5B.6.2-6.4 say "Table 5.5B.6.3-1: Void", their configurations are in the directory
            # 5.5B.6.5 names - the other configuration clauses under the same clause (5.5b.) draw from it too
            fam = '.'.join(sid.split('.')[:2]) + '.'
            near.setdefault(fam, [])
            for d in pool:
                if d not in near[fam]:
                    near[fam].append(d)
    named = {t[0] for t in targets}
    for sid in order:
        fam = '.'.join(sid.split('.')[:2]) + '.'
        title = titles.get(sid) or ''
        if sid in named or fam not in near or not sid.startswith(fam) or sid in parents:
            continue
        if re.search(r'configurations?\b', title, re.I) and re.search(r'\b(?:CA|(?:EN-|NE-|NR-)?DC)\b', title):
            targets.append((sid, title, '', near[fam]))
    pos = {sid: i for i, sid in enumerate(order)}
    targets.sort(key=lambda t: pos.get(t[0], 0))
    return targets


def add(sections, order, titles, bz, log=print, parents=()):
    """put the configurations into the clauses that point at their directory; returns how many were placed"""
    dirs, notes = load(bz)
    if not dirs:
        return 0
    feats = {d: [(c, features(c['bcId'])) for c in sorted(cs, key=lambda c: _sort_key(c['bcId']))] for d, cs in dirs.items()}
    placed = {d: set() for d in dirs}
    first_of = {}
    targets = find_targets(sections, order, titles, dirs, parents)
    for sid, title, name, pool in targets:
        for d in pool:
            take = [c for c, f in feats[d] if wants(title, f, _flags(c.get('notes')))]
            if not take:
                continue
            for c in take:
                placed[d].add(c['bcId'])
            first_of.setdefault(d, sid)
            cap = f'Configurations from the TS zip file, directory {d} ({len(take)} configurations)'
            sections[sid] = sections[sid] + '\n' + table(take, d, notes, cap)
    total = 0
    for d, cs in dirs.items():
        left = [c for c in cs if c['bcId'] not in placed[d]]
        total += len(cs) - len(left)
        if left and d in first_of:
            sid = first_of[d]
            cap = f'Further configurations from the TS zip file, directory {d} ({len(left)} configurations)'
            sections[sid] = sections[sid] + '\n' + table(sorted(left, key=lambda c: _sort_key(c['bcId'])), d, notes, cap)
            total += len(left)
            log(f'  band combinations: {len(left)} of {d} matched no clause title, put in {sid}')
        elif left:
            log(f'  band combinations: directory {d} ({len(left)} configurations) is not referenced by any clause')
    log(f'  band combinations: {total} configurations from {len(dirs)} directories into {len({t[0] for t in targets})} clauses')
    return total
