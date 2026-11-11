#!/usr/bin/env python3
"""
Convert a 3GPP spec from its official .docx files into per-section HTML.
Runs inside the converter container (docker/converter/Dockerfile); see scraper/docx.ts.

  python3 convert_docx.py <spec> <zip url> <data dir>

Reads   <data>/raw/specs/<spec>.json          (table of contents from the crawl)
Writes  <data>/raw/sections/<spec>.ndjson.gz  lines {"id": ..., "html": ..., "src": "docx"}
        <data>/images/<spec>/images/p<part>-imageN.png

Used for the handful of huge conformance specs that are impractical to crawl section by section.
Each .docx part of the zip goes through pandoc with split.lua, which cuts it at the headings that
match the TOC ids; figures referenced by the output are rendered with figures/convert.py.
"""
import gzip, html, io, json, os, re, subprocess, sys, tempfile, time, zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'figures'))
import convert  # noqa: E402
from convert import download, log, write_figures  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chardraw  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TAB_RUN = '<w:t xml:space="preserve">\ue000</w:t>'.encode('utf-8')  # U+E000 marks a tab
VERSION = 6  # bump to make scraper/docx.ts redo earlier conversions

# <w:sym w:font=".." w:char="F0AE"/> glyphs (pandoc drops them) -> Unicode
_FONTS = {'symbol': chardraw.SYMBOL, 'wingdings': chardraw.WINGDINGS}
_SYM_RE = re.compile(rb'<w:sym\b[^>]*?w:font="([^"]+)"[^>]*?w:char="([0-9A-Fa-f]{2,4})"[^>]*/>')


def _sym(m):
    table = _FONTS.get(m.group(1).decode('utf-8', 'replace').strip().lower())
    ch = table and table.get(int(m.group(2), 16) & 0xFF)
    if not ch:
        return m.group(0)
    # Symbol-font "<", ">" and "&" exist too (37.571-1): unescaped they make the whole part unreadable
    ch = ch.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return ('<w:t xml:space="preserve">' + ch + '</w:t>').encode('utf-8')


def toc_ids(meta):
    out = []

    def walk(nodes, depth):
        for n in nodes:
            out.append(f"{n['id']}\t{depth}")
            walk(n.get('children') or [], depth + 1)

    walk(meta.get('toc') or [], 0)
    return out


def write_toc(data_dir, spec, meta, order, heads):
    """nest the discovered headings by clause number (5.3.2 under 5.3, A.1 under annex-a) and store them as the spec's TOC"""
    nodes = {}
    roots = []
    for sid in order:
        num, title, _ = heads[sid]
        nodes[sid] = {'id': sid, 'number': num, 'title': title, 'children': []}
    stack = []  # open headings: (level, sid)
    for sid in order:
        node = nodes[sid]
        level = heads[sid][2]
        parent = None
        while stack and stack[-1][0] >= level:
            stack.pop()
        if not node['number']:
            # unnumbered headings (initial conditions, message contents, documents with Word auto-numbering)
            # belong to the nearest enclosing heading of a higher level
            parent = stack[-1][1] if stack else None
        stack.append((level, sid))
        if node['number']:
            # 9.1.19.2_1.5 -> 9.1.19.2_1 -> 9.1.19.2 -> 9.1.19 …
            cuts = [m.start() for m in re.finditer(r'[._]', sid)]
            for k in reversed(cuts):
                cand = sid[:k]
                if cand in nodes and cand != sid:
                    parent = cand
                    break
            if parent is None and re.match(r'^[a-z]\.', sid) and 'annex-' + sid[0] in nodes:
                parent = 'annex-' + sid[0]
            if parent is None and len(stack) > 1 and stack[-2][0] < level:
                parent = stack[-2][1]
        (nodes[parent]['children'] if parent else roots).append(node)
    meta['toc'] = roots
    meta['sectionCount'] = len(order)
    meta['tocSource'] = 'docx'
    path = os.path.join(data_dir, 'raw', 'specs', f'{spec}.json')
    json.dump(meta, open(path + '.part', 'w'), ensure_ascii=False)
    os.replace(path + '.part', path)
    log(f'{spec}: table of contents rebuilt from the document headings ({len(order)} entries)')


_P_RE = re.compile(rb'<w:p[ >].*?</w:p>', re.S)
_WT_RE = re.compile(rb'(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)')
_NBSP = '\u00a0'.encode('utf-8')


def _keep_code_spaces(m):
    """code paragraphs - style PL (ASN.1, OpenAPI YAML…), LD (line drawings) or any paragraph that starts indented
    (lines added to a YAML listing without the PL style): pandoc collapses spaces, so pin them as U+00A0"""
    p = m.group(0)
    if b'<w:pStyle w:val="PL' not in p and b'<w:pStyle w:val="LD"' not in p:
        # indentation may be spread over several runs (" " + "       key:")
        lead = b''.join(t.group(2) for t in _WT_RE.finditer(p))
        if not lead.startswith(b'  '):
            return p
    return _WT_RE.sub(lambda t: t.group(1) + t.group(2).replace(b' ', _NBSP) + t.group(3), p)


# ISO 29500 "Strict" documents (Word's "Strict Open XML" save option; 22.839, 25.133 j00, parts of 36.521-3)
# use purl.oclc.org namespaces that pandoc does not know: map them to the Transitional ones
_STRICT_RE = re.compile(rb'http://purl\.oclc\.org/ooxml/(officeDocument|wordprocessingml|drawingml|schemaLibrary)(?:/(\w+))?(?:/(\w+))?')
_KEBAB = {b'extendedProperties': b'extended-properties', b'customProperties': b'custom-properties'}


def _transitional(m):
    area, a, b = m.group(1), m.group(2) or b'', m.group(3)
    if area == b'officeDocument':
        if a == b'relationships':
            return b'http://schemas.openxmlformats.org/officeDocument/2006/relationships' + (b'/' + _KEBAB.get(b, b) if b else b'')
        return b'http://schemas.openxmlformats.org/officeDocument/2006/' + _KEBAB.get(a, a) + (b'/' + b if b else b'')
    return b'http://schemas.openxmlformats.org/' + area + b'/2006/' + a + (b'/' + b if b else b'')


# Word's Strict save (22.839) wraps OLE objects as <mc:AlternateContent><mc:Choice Requires="v"><w:object>..VML
# picture..</w:object></mc:Choice><mc:Fallback>..</mc:Fallback>: pandoc reads a Choice only when it starts with
# something it knows as a run part and drops the whole run otherwise - figure gone. The Choice's own object it reads.
_ALT_VML = re.compile(rb'<mc:AlternateContent\b[^>]*>\s*<mc:Choice\b[^>]*>\s*(<w:(object|pict)\b.*?</w:\2>)\s*</mc:Choice>'
                      rb'\s*<mc:Fallback\b[^>]*>.*?</mc:Fallback>\s*</mc:AlternateContent>', re.S)


# tracked changes, accepted before pandoc sees them (what pandoc's default --track-changes=accept means): pandoc
# 2.17 drops a picture run inside <w:ins> - 369 figures in 45 documents (23.920's, inserted in 1999 with
# revision marks on). Deleted runs go, inserted ones stay; <w:insideH>/<w:delText> are other elements (\b).
_TRACK_DEL = re.compile(rb'<w:(del|moveFrom)\b[^>/]*>.*?</w:\1>|<w:(?:del|moveFrom)\b[^>]*/>', re.S)
_TRACK_INS = re.compile(rb'</?w:(?:ins|moveTo)\b[^>]*>')


def accept_changes(doc):
    if b'<w:ins' not in doc and b'<w:del' not in doc and b'<w:move' not in doc:
        return doc
    return _TRACK_INS.sub(b'', _TRACK_DEL.sub(b'', doc))


_LD_TOK = re.compile(rb'<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:br\b[^>]*/>|<w:cr\s*/>|<w:tab\s*/>')


def _ld_lines(p):
    """the lines of a line-drawing paragraph (<w:br/> ends one) and where each break is"""
    lines, breaks, cur = [], [], ''
    for t in _LD_TOK.finditer(p):
        if t.group(1) is not None:
            cur += html.unescape(t.group(1).decode('utf-8', 'replace'))
        elif t.group(0).startswith(b'<w:tab'):
            cur += ' '
        else:
            lines.append(cur)
            breaks.append(t.end())
            cur = ''
    lines.append(cur)
    return lines, breaks


def _layout_ld(data):
    """style LD - message sequences drawn with characters (04.08, 23.082, 44.056): Word centres each line of a
    centred paragraph on its own, in a monospaced font; a <pre> cannot, so the lines get the leading spaces
    that put them where Word does, measured against the widest line of the drawing"""
    paras = list(_P_RE.finditer(data))
    # the text column in characters of 10 pt Courier (120 twips each), for drawings that mix centred lines
    # with left-aligned ones
    col = 80
    pg = list(re.finditer(rb'<w:pgSz\b[^>]*?w:w="(\d+)"', data))
    mar = list(re.finditer(rb'<w:pgMar\b([^>]*)>', data))
    if pg and mar:
        lr = [int(v) for v in re.findall(rb'w:(?:left|right|start|end)="(\d+)"', mar[-1].group(1))[:2]]
        if len(lr) == 2:
            col = max(40, (int(pg[-1].group(1)) - sum(lr)) // 120)
    out, last, i = [], 0, 0
    while i < len(paras):
        if b'<w:pStyle w:val="LD"/>' not in paras[i].group(0):
            i += 1
            continue
        j = i
        while j < len(paras) and b'<w:pStyle w:val="LD"/>' in paras[j].group(0):
            j += 1
        group = paras[i:j]
        layout = [_ld_lines(m.group(0)) for m in group]
        width = max((len(l) for lines, _ in layout for l in lines), default=0)
        centred = [b'<w:jc w:val="center"/>' in m.group(0) for m in group]
        if not all(c or not any(l.strip() for l in lines) for c, (lines, _) in zip(centred, layout)):
            width = max(width, col)  # Word centres in the column, the left-aligned lines start at its edge
        for m, (lines, breaks) in zip(group, layout):
            p = m.group(0)
            if b'<w:jc w:val="center"/>' not in p:
                continue
            pads = [(width - len(l)) // 2 if l.strip() else 0 for l in lines]
            ins = []  # (offset, bytes) - from the end so the offsets hold
            for k, b in enumerate(breaks, 1):
                if pads[k]:
                    ins.append((b, f'<w:t xml:space="preserve">{" " * pads[k]}</w:t>'.encode()))
            if pads[0]:
                at = p.find(b'</w:pPr>')
                at = at + len(b'</w:pPr>') if at >= 0 else p.find(b'>') + 1
                ins.append((at, f'<w:r><w:t xml:space="preserve">{" " * pads[0]}</w:t></w:r>'.encode()))
            for at, b in sorted(ins, reverse=True):
                p = p[:at] + b + p[at:]
            out.append(data[last:m.start()])
            out.append(p.replace(b'<w:jc w:val="center"/>', b''))
            last = m.end()
        i = j
    out.append(data[last:])
    return b''.join(out)


def prepare_docx(raw):
    """copy of the docx where run-level tabs survive pandoc (as U+E000), in Transitional namespaces"""
    src = zipfile.ZipFile(io.BytesIO(raw))
    names = set(src.namelist())
    strict = b'purl.oclc.org/ooxml' in src.read('_rels/.rels') if '_rels/.rels' in names else False

    def part(name):
        data = src.read(name) if name in names else b''
        return _STRICT_RE.sub(_transitional, data) if strict else data

    # symbol-font characters typed as text, and drawings made of characters (chardraw.py) - before the rest,
    # which treats the paragraphs that become LD like any other line drawing
    styles = chardraw.Styles(part('word/styles.xml'))
    doc = chardraw.fix_pua(chardraw.fix_sym(accept_changes(part('word/document.xml'))), styles)
    doc, drawn = chardraw.mark_drawings(doc, styles, part('word/settings.xml'))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if strict and info.filename.endswith(('.xml', '.rels')):
                data = _STRICT_RE.sub(_transitional, data)
            if info.filename == 'word/styles.xml' and drawn:
                data = chardraw.add_ld_style(data)
            if info.filename == 'word/document.xml':
                data = _ALT_VML.sub(rb'\1', doc) if b'<mc:Choice' in doc else doc
                if b'<w:pStyle w:val="LD"/>' in data:
                    data = _layout_ld(data)
                data = _SYM_RE.sub(_sym, data.replace(b'<w:tab/>', TAB_RUN))
                data = _P_RE.sub(_keep_code_spaces, data)
            dst.writestr(info.filename, data)  # not the ZipInfo: writestr mutates its offsets
    return src, buf.getvalue()


from legacy import legacy_kind, open_spec_zip, spec_parts  # noqa: E402 - same directory
import attachments  # noqa: E402
import bandcombos  # noqa: E402


def main():
    spec, url, data_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    force_discover = '--discover' in sys.argv[4:]
    # --fill: the official text of a crawled spec, cut along itecspec's own TOC ids, written beside the crawled
    # file (raw/sections-docx/) so build-db can take any section itecspec rendered incompletely from it
    fill = '--fill' in sys.argv[4:]
    meta = json.load(open(os.path.join(data_dir, 'raw', 'specs', f'{spec}.json')))
    dest = os.path.join(data_dir, 'images', spec, 'images')
    os.makedirs(dest, exist_ok=True)
    cache = os.path.join(data_dir, 'tmp', 'docx')
    os.makedirs(cache, exist_ok=True)
    zpath = os.path.join(cache, os.path.basename(url))
    if not os.path.exists(zpath):
        blob = download(url)
        if not blob:
            log(f'{spec}: download failed')
            sys.exit(2)
        open(zpath + '.part', 'wb').write(blob)
        os.replace(zpath + '.part', zpath)
    # a few archive zips wrap another zip (alone, or next to the TSG cover note: 36571-1-100.zip)
    z = open_spec_zip(zpath)
    names = z.namelist()
    parts = spec_parts(names, lambda n: n.lower().endswith('.docx'), zpath)
    tmp = tempfile.mkdtemp()
    blobs = [(n, z.read(n)) for n in parts]
    if not parts:
        # older specs ship Word 97 .doc / .rtf parts: convert them to .docx first
        # (Word 6/95 files of the GSM era carry names such as 1110D3E1.WW6 - go by content, not extension)
        legacy = spec_parts(names, lambda n: legacy_kind(n, z), zpath)
        conv = os.path.join(tmp, 'legacy')
        os.makedirs(conv)
        paths = []
        for i, n in enumerate(legacy):
            base = re.sub(r'[^\w.-]', '_', os.path.splitext(os.path.basename(n))[0])
            q = os.path.join(conv, f'{i:03d}_{base}.{legacy_kind(n, z)}')
            open(q, 'wb').write(z.read(n))
            paths.append(q)
        if paths:
            log(f'{spec}: converting {len(paths)} legacy .doc/.rtf parts')
            # LibreOffice 7.4 hangs on some Word 97 files: give up quickly (docx.ts prepares those zips with
            # a newer LibreOffice, docker/legacy, and they come back here as .docx)
            try:
                subprocess.run(['soffice', '--headless', '--norestore', '--convert-to', 'docx', '--outdir', conv] + paths,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
            except subprocess.TimeoutExpired:
                log(f'{spec}: legacy conversion timed out')
                sys.exit(4)
        for q in paths:
            d = os.path.splitext(q)[0] + '.docx'
            if os.path.exists(d):
                blobs.append((os.path.basename(d), open(d, 'rb').read()))
            else:
                log(f'  {os.path.basename(q)}: conversion failed')
    log(f'{spec}: {len(blobs)} docx parts from {os.path.basename(url)}')
    if not blobs:
        sys.exit(3)

    ids_file = os.path.join(tmp, 'ids.txt')
    open(ids_file, 'w').write('\n'.join(toc_ids(meta)))
    # no table of contents from itecspec: take the document's own headings
    discover = not fill and (force_discover or not meta.get('toc') or meta.get('tocSource') == 'docx')
    seen_file = os.path.join(tmp, 'seen.txt')
    stack_file = os.path.join(tmp, 'stack.txt')
    open(seen_file, 'w').close()
    heads = {}
    sections, order, failed = {}, [], []
    t0 = time.time()
    for i, (name, raw) in enumerate(blobs, 1):
        dz, prepared = prepare_docx(raw)
        docx = os.path.join(tmp, f'part{i}.docx')
        open(docx, 'wb').write(prepared)
        out = os.path.join(tmp, f'part{i}.ndjson')
        # a single-part document's figures keep the docx media names (itecspec's names: images/imageN.png)
        name_prefix = '' if fill and len(blobs) == 1 else f'p{i}-'
        prefix = f'{spec}/images/{name_prefix}'
        env = dict(os.environ, SPLIT_OUT=out, SPLIT_IDS=ids_file, SPLIT_IMG_PREFIX=prefix, SPLIT_DISCOVER='1' if discover else '0',
                   SPLIT_SEEN=seen_file, SPLIT_STACK=stack_file)
        open(out, 'w').close()
        r = subprocess.run(['pandoc', '-f', 'docx+styles', '-t', 'html5', '--lua-filter', os.path.join(HERE, 'split.lua'), '-o', os.devnull, docx],
                           env=env, capture_output=True, text=True, timeout=7200)
        if r.returncode != 0:
            log(f'  {name}: pandoc failed: {r.stderr[-800:]}')
            failed.append(name)
            continue
        lines = [json.loads(l) for l in open(out, encoding='utf-8') if l.strip()]
        with open(seen_file, 'a') as sf:
            sf.write(''.join(s['id'] + '\n' for s in lines))
        # figures referenced by this part
        media = {}
        for n in dz.namelist():
            m = re.match(r'word/media/([^/]+?)(\.\w+)$', n)
            if m:
                media[m.group(1)] = n
        found, sizes = {}, {}
        img_re = re.compile(r'data-src="' + re.escape(prefix) + r'([^"/]+?)\.png"(?: alt="[^"]*")?(?: width="(\d+)")?')
        for s in lines:
            for m in img_re.finditer(s['html']):
                base = m.group(1)
                key = f'{name_prefix}{base}'
                if base in media and key not in found:
                    found[key] = (dz.read(media[base]), os.path.splitext(media[base])[1].lower())
                if m.group(2):
                    sizes[key] = [max(int(m.group(2)), (sizes.get(key) or [0])[0]), 0]
        have = {os.path.splitext(f)[0] for f in os.listdir(dest)}
        found = {k: v for k, v in found.items() if k not in have}
        if found:
            write_figures(found, dest, sizes, spec)
        for s in lines:
            if discover and s['id'] not in heads:
                heads[s['id']] = (s.get('num'), s.get('title') or s['id'], s.get('level', 7))
            if s['id'] in sections:
                sections[s['id']] += '\n' + s['html']
            else:
                sections[s['id']] = s['html']
                order.append(s['id'])
        log(f'  part {i}/{len(blobs)} {name}: {len(lines)} sections, {len(found)} figures ({time.time() - t0:.0f}s)')

    if discover and order:
        write_toc(data_dir, spec, meta, order, heads)

    if not order:
        # nothing usable: keep whatever text the spec already has (the crawled one, for instance)
        log(f'{spec}: no sections from {len(blobs)} parts' + (f' ({len(failed)} unreadable)' if failed else ''))
        sys.exit(5)
    # 38.101-1/-2/-3 from Rel-20: the CA/DC configuration tables are JSON files beside the document
    bz = bandcombos.data_zip(z, zpath)
    if bz:
        titles, parents = {}, set()
        if discover:
            titles = {sid: h[1] or '' for sid, h in heads.items()}
            lv = [heads.get(sid, (None, '', 7))[2] or 7 for sid in order]
            parents = {sid for i, sid in enumerate(order[:-1]) if lv[i + 1] > lv[i]}
        else:
            def walk(nodes):
                for n in nodes:
                    titles[n['id']] = n.get('title') or ''
                    if n.get('children'):
                        parents.add(n['id'])
                        walk(n['children'])
            walk(meta.get('toc') or [])
        bandcombos.add(sections, order, titles, bz, log=log, parents=parents)
    # the files beside the document (test suites, codec sources, schemas): their own annex in the database
    try:
        attachments.from_zip(z, zpath, url, attachments.html_haystack(sections.values()), data_dir, spec,
                             {'bandcombos'} if bz else set(), log=log)
    except Exception as e:  # noqa: BLE001 - the text matters more; docx.ts --attachments retries
        log(f'  zip files: {e}')
    out_dir = os.path.join(data_dir, 'raw', 'sections-docx' if fill else 'sections')
    os.makedirs(out_dir, exist_ok=True)
    final = os.path.join(out_dir, f'{spec}.ndjson.gz')
    # a part pandoc could not read: the rest is kept, marked as converter version 0 so the next run retries it
    v = 0 if failed else VERSION
    with gzip.open(final + '.part', 'wt', encoding='utf-8') as f:
        for sid in order:
            f.write(json.dumps({'id': sid, 'html': sections[sid], 'src': 'docx', 'v': v}, ensure_ascii=False) + '\n')
    os.replace(final + '.part', final)
    if fill:
        for f in (zpath, zpath + '.orig'):  # ~40 GB for all crawled specs: not kept
            if os.path.exists(f):
                os.remove(f)
    nonempty = sum(1 for s in sections.values() if s.strip())
    log(f'{spec}: {len(sections)} sections ({nonempty} with content) of {len(toc_ids(meta))} in TOC, {time.time() - t0:.0f}s')


if __name__ == '__main__':
    try:
        main()
    finally:
        if convert._renderer:
            convert._renderer.stop()
