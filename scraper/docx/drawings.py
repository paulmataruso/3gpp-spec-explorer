"""Figures drawn with Word's own shapes have no picture for pandoc to keep: Word charts (38.863's simulation
results), drawing canvases and shape groups (23.801-02), and the drawing-layer figures of GSM-era documents
that LibreOffice turns into DrawingML shapes (04.08's message sequences). pandoc drops them, and so does
itecspec: 1,500+ figure captions stood above nothing.

Here such a figure is rendered: the paragraphs that hold its drawings are put on a page of their own (their text
blanked), LibreOffice prints the pages to PDF, poppler rasterises them, and the cropped picture replaces the
drawings in the document - as an ordinary inline picture that the rest of the pipeline handles like any other.

Which drawings make a figure:
  - those in the paragraphs right before a figure caption (style TF, or "Figure 4.2-1: …"), back to the first
    paragraph that carries text and no drawing, when none of them has a picture already;
  - any other chart, canvas or shape group (26.855's charts have no caption).
Single shapes elsewhere (cover-page text boxes, logos) are left alone.
"""

import os
import re
import subprocess
import zipfile

DPI = 150
_BLOCK = re.compile(rb'<(/?)(w:p|w:tbl|w:sdt)(?=[\s>/])[^>]*?(/?)>')
_CONT = re.compile(rb'<(/?)(w:drawing|w:pict|mc:AlternateContent|w:object)(?=[\s>/])[^>]*?(/?)>')
_WT = re.compile(rb'(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)')
_BITMAP = re.compile(rb'<a:blip\b|<v:imagedata\b')
_NATIVE = re.compile(rb'<wpc:wpc\b|<wpg:wgp\b|<c:chart\b|<wps:wsp\b|<v:group\b|<v:shape\b|<v:rect\b|<v:line\b|'
                     rb'<v:oval\b|<v:roundrect\b|<v:polyline\b|<v:arc\b|<v:curve\b|<v:shapetype\b|<cx:chart\b')
_FIGURE_KIND = re.compile(rb'<wpc:wpc\b|<wpg:wgp\b|<c:chart\b|<cx:chart\b|<v:group\b')
_CAPTION = re.compile(r'^\s*Fig(?:ure|\.)\s*[\w.\-/]+', re.I)
_SECT = re.compile(rb'<w:sectPr\b.*?</w:sectPr>', re.S)


def _spans(xml, rx, lo, hi):
    """(start, end) of the outermost elements matched by rx (open/close/self-closing tags) in xml[lo:hi]"""
    out, depth, start = [], 0, None
    for m in rx.finditer(xml, lo, hi):
        close, selfclose = m.group(1), m.group(3)
        if selfclose:
            if depth == 0:
                out.append((m.start(), m.end()))
            continue
        if not close:
            if depth == 0:
                start = m.start()
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0 and start is not None:
                out.append((start, m.end()))
                start = None
    return out


class Block:
    def __init__(self, xml, s, e):
        self.s, self.e = s, e
        self.xml = xml[s:e]
        self.table = self.xml.startswith(b'<w:tbl')
        self.draw = [] if self.table else [(a - s, b - s) for a, b in _spans(xml, _CONT, s, e)]
        inside = b''.join(self.xml[a:b] for a, b in self.draw)
        self.bitmap = bool(_BITMAP.search(inside)) or (self.table and bool(_BITMAP.search(self.xml)))
        self.native = bool(self.draw) and bool(_NATIVE.search(inside)) and not _BITMAP.search(inside)
        self.figure_kind = self.native and bool(_FIGURE_KIND.search(inside))
        outside, last = [], 0
        for a, b in self.draw:
            outside.append(self.xml[last:a])
            last = b
        outside.append(self.xml[last:])
        self.text = b''.join(t.group(2) for t in _WT.finditer(b''.join(outside))).decode('utf-8', 'replace').strip()
        self.caption = not self.table and (b'<w:pStyle w:val="TF"' in self.xml or bool(_CAPTION.match(self.text))) \
            and 0 < len(self.text) < 400

    def blanked(self):
        """the block for the render: its own text and list numbering gone, the drawings kept"""
        out, last = [], 0
        for a, b in self.draw + [(len(self.xml), len(self.xml))]:
            seg = self.xml[last:a]
            seg = _WT.sub(lambda t: t.group(1) + t.group(3), seg)
            seg = re.sub(rb'<w:numPr>.*?</w:numPr>', b'', seg, flags=re.S)
            out.append(seg + self.xml[a:b])
            last = b
        return b''.join(out)

    def without_drawings(self):
        out, last = [], 0
        for a, b in self.draw:
            out.append(self.xml[last:a])
            last = b
        out.append(self.xml[last:])
        return b''.join(out)


def body(xml):
    b0 = xml.find(b'<w:body>')
    b1 = xml.rfind(b'</w:body>')
    if b0 < 0 or b1 < 0:
        return None, None
    b0 += len(b'<w:body>')
    return [Block(xml, s, e) for s, e in _spans(xml, _BLOCK, b0, b1)], (b0, b1)


def figures(blocks):
    """groups of block indexes, each one figure made of drawings without a picture"""
    groups, taken = [], set()
    for i, blk in enumerate(blocks):
        if not blk.caption:
            continue
        run, j = [], i - 1
        while j >= 0 and len(run) < 30:
            b = blocks[j]
            if b.table or b.bitmap or b.caption:
                run = [] if b.bitmap else run
                break
            if b.native:
                run.append(j)
                if b.text:
                    break  # a text paragraph the drawings are anchored to: where the figure starts
            elif b.text:
                break
            else:
                run.append(j)  # empty paragraphs between and around the drawings
            j -= 1
        while run and not blocks[run[-1]].native:
            run.pop()  # empty paragraphs before the first drawing
        if any(blocks[k].native for k in run) and not taken & set(run):
            groups.append(sorted(run))
            taken |= set(run)
    for i, b in enumerate(blocks):
        if b.figure_kind and i not in taken:
            groups.append([i])
            taken.add(i)
    groups.sort()
    return groups


def needs(document_xml):
    if not _NATIVE.search(document_xml):
        return 0
    blocks, _ = body(document_xml)
    return len(figures(blocks)) if blocks else 0


def _pgm_bbox(path, thr=235):
    """content box of a greyscale PGM (P5), or None for an empty page"""
    data = open(path, 'rb').read()
    m = re.match(rb'P5\s+(\d+)\s+(\d+)\s+(\d+)\s', data)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    px = data[m.end():]
    table = bytes(0 if v < thr else 255 for v in range(256))
    top = bottom = None
    left, right = w, -1
    for r in range(h):
        row = px[r * w:(r + 1) * w]
        if min(row) >= thr:
            continue
        t = row.translate(table)
        a, b = t.find(b'\x00'), t.rfind(b'\x00')
        top = r if top is None else top
        bottom = r
        left, right = min(left, a), max(right, b)
    if top is None:
        return None
    pad = 6
    x, y = max(0, left - pad), max(0, top - pad)
    return x, y, min(w, right + pad + 1) - x, min(h, bottom + pad + 1) - y


_POS_V = re.compile(rb'<wp:positionV relativeFrom="(?:paragraph|line)">\s*<wp:posOffset>(-\d+)</wp:posOffset>')
_VML_TOP = re.compile(rb'margin-top:\s*(-[\d.]+)pt[^"]*?mso-position-vertical-relative:\s*(?:text|line)')


def _headroom(chunk):
    """twips a floating drawing reaches above its anchor paragraph (23.700-88's canvases sit 18 cm above it): the
    room to leave above the group, or the render page would cut it off"""
    up = max([-int(m.group(1)) // 635 for m in _POS_V.finditer(chunk)] +
             [int(-float(m.group(1)) * 20) for m in _VML_TOP.finditer(chunk)] + [0])
    return min(up, 40000)


def _sect_for_render(xml, span, extra=0):
    m = None
    for m in _SECT.finditer(xml, span[0], span[1]):
        pass
    sect = m.group(0) if m else b'<w:sectPr><w:pgSz w:w="11907" w:h="16840"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    sect = re.sub(rb'<w:(?:headerReference|footerReference)\b[^>]*/>', b'', sect)
    sect = re.sub(rb'<w:titlePg\b[^>]*/>', b'', sect)
    # a tall page, so that a large figure stays on one page
    sect = re.sub(rb'(<w:pgSz\b[^>]*?w:h=")(\d+)(")', lambda g: g.group(1) + str(max(int(g.group(2)), 23811 + extra)).encode() + g.group(3), sect)
    return sect


_PAGE_BREAK = b'<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
_PIC = ('<w:p><w:pPr><w:pStyle w:val="TH"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        '<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{pid}" name="Rendered drawing {k}"/>'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>'
        '<pic:cNvPr id="0" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rid}"/>'
        '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>'
        '<a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')


def _write_docx(src, path, replace):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            if info.filename in replace:
                continue
            out.writestr(info.filename, src.read(info.filename))
        for name, data in replace.items():
            out.writestr(name, data)


def _render(src, xml, blocks, groups, span, tmp, soffice, stem):
    """PDF pages of the groups (one page each); returns the PNG paths (None where nothing rendered)"""
    rooms = [_headroom(b''.join(xml[blocks[k].s:blocks[k].e] for k in g)) for g in groups]
    sect = _sect_for_render(xml, span, max(rooms))
    parts = []
    for gi, g in enumerate(groups):
        if gi:
            parts.append(_PAGE_BREAK)
        if rooms[gi]:  # an empty line as tall as the drawing reaches upwards
            parts.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="{rooms[gi] + 200}" w:lineRule="exact"/></w:pPr></w:p>'.encode())
        parts.append(b''.join(blocks[k].blanked() for k in g))
    doc = xml[:span[0]] + b''.join(parts) + sect + xml[span[1]:]
    rdocx = os.path.join(tmp, f'{stem}.docx')
    _write_docx(src, rdocx, {'word/document.xml': doc})
    pdf = os.path.join(tmp, f'{stem}.pdf')
    # generous: LibreOffice on a busy machine (several conversions at once) is slow to start
    soffice(['--writer', '--convert-to', 'pdf', '--outdir', tmp, rdocx], min(1200, 240 + 30 * len(groups)))
    if not os.path.exists(pdf):
        return None
    info = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout
    pages = int(re.search(r'Pages:\s+(\d+)', info).group(1)) if 'Pages:' in info else 0
    if pages != len(groups):
        return None  # a group spilled over a page: the caller renders them one by one
    pre = os.path.join(tmp, f'{stem}-g')
    subprocess.run(['pdftoppm', '-r', str(DPI), '-gray', pdf, pre], check=True, timeout=600)
    pgms = sorted((f for f in os.listdir(tmp) if f.startswith(f'{stem}-g') and f.endswith('.pgm')),
                  key=lambda f: int(re.search(r'-(\d+)\.pgm$', f).group(1)))
    out = []
    for p, f in enumerate(pgms, 1):
        box = _pgm_bbox(os.path.join(tmp, f))
        os.remove(os.path.join(tmp, f))
        if not box or box[2] < 12 or box[3] < 12:
            out.append(None)
            continue
        x, y, w, h = box
        png = os.path.join(tmp, f'{stem}-{p}')
        subprocess.run(['pdftoppm', '-r', str(DPI), '-png', '-singlefile', '-f', str(p), '-l', str(p),
                        '-x', str(x), '-y', str(y), '-W', str(w), '-H', str(h), pdf, png], check=True, timeout=300)
        out.append((png + '.png', w, h))
    return out


_OLE = re.compile(rb'<o:OLEObject\b[^>]*>')
_OLE_EXT = (('Word.', '.doc'), ('Visio.', '.vsd'), ('Excel.', '.xls'), ('PowerPoint.', '.ppt'))


def _ole_pic(src, xml, blocks, g, tmp, soffice, stem):
    """a figure that is an embedded object without a preview picture (23.402: "Word.Picture.8" objects whose
    picture only the embedded document holds): that document rendered on its own, first page, cropped"""
    chunk = b''.join(xml[blocks[k].s:blocks[k].e] for k in g)
    if _BITMAP.search(chunk):
        return None
    m = _OLE.search(chunk)
    if not m:
        return None
    prog = re.search(rb'ProgID="([^"]+)"', m.group(0))
    rid = re.search(rb'r:id="([^"]+)"', m.group(0))
    if not prog or not rid:
        return None
    rels = src.read('word/_rels/document.xml.rels')
    t = re.search(rb'<Relationship\b[^>]*Id="' + re.escape(rid.group(1)) + rb'"[^>]*>', rels)
    target = re.search(rb'Target="([^"]+)"', t.group(0)) if t else None
    if not target:
        return None
    name = 'word/' + target.group(1).decode().lstrip('/').replace('word/', '', 1)
    try:
        blob = src.read(name)
    except KeyError:
        return None
    ext = os.path.splitext(name)[1].lower()
    if ext == '.bin':
        ext = next((e for p, e in _OLE_EXT if prog.group(1).decode().startswith(p)), None)
        if not ext:
            return None
    obj = os.path.join(tmp, f'{stem}{ext}')
    open(obj, 'wb').write(blob)
    soffice(['--convert-to', 'pdf', '--outdir', tmp, obj], 180)
    pdf = os.path.join(tmp, f'{stem}.pdf')
    if not os.path.exists(pdf):
        return None
    pre = os.path.join(tmp, f'{stem}-o')
    subprocess.run(['pdftoppm', '-r', str(DPI), '-gray', '-f', '1', '-l', '1', '-singlefile', pdf, pre], timeout=300)
    if not os.path.exists(pre + '.pgm'):
        return None
    box = _pgm_bbox(pre + '.pgm')
    os.remove(pre + '.pgm')
    if not box or box[2] < 12 or box[3] < 12:
        return None
    x, y, w, h = box
    png = os.path.join(tmp, f'{stem}-ole')
    subprocess.run(['pdftoppm', '-r', str(DPI), '-png', '-singlefile', '-f', '1', '-l', '1', '-x', str(x), '-y', str(y),
                    '-W', str(w), '-H', str(h), pdf, png], check=True, timeout=300)
    return png + '.png', w, h


def patch(path, tmp, soffice, log=print):
    """render the picture-less figures of a .docx in place; returns how many"""
    src = zipfile.ZipFile(path)
    try:
        xml = src.read('word/document.xml')
    except KeyError:
        return 0
    if not _NATIVE.search(xml):
        return 0
    blocks, span = body(xml)
    groups = figures(blocks) if blocks else []
    if not groups:
        return 0
    stem = re.sub(r'\W', '_', os.path.splitext(os.path.basename(path))[0])
    pics = _render(src, xml, blocks, groups, span, tmp, soffice, f'{stem}_all')
    if pics is None:  # one page per group did not work out: one document per group
        pics = [None] * len(groups)
    for gi, g in enumerate(groups):
        # a page that came out blank among the others gets a document of its own (33.822's first figure, a group
        # inside a hyperlink, renders only alone)
        if not pics[gi]:
            r = _render(src, xml, blocks, [g], span, tmp, soffice, f'{stem}_{gi}')
            pics[gi] = r[0] if r else None
        # embedded objects that carry no picture of their own
        if not pics[gi]:
            try:
                pics[gi] = _ole_pic(src, xml, blocks, g, tmp, soffice, f'{stem}_ole{gi}')
            except (subprocess.SubprocessError, OSError):
                pass
    rels_name = 'word/_rels/document.xml.rels'
    rels = src.read(rels_name)
    ctypes = src.read('[Content_Types].xml')
    if b'Extension="png"' not in ctypes.lower().replace(b"'", b'"') and b'extension="png"' not in ctypes.lower():
        ctypes = ctypes.replace(b'</Types>', b'<Default Extension="png" ContentType="image/png"/></Types>')
    replace, new_rels = {}, []
    edits = []  # (start, end, new bytes) on xml
    done = 0
    for gi, (g, pic) in enumerate(zip(groups, pics)):
        if not pic:
            continue
        png, w, h = pic
        name = f'rendered_{gi + 1}.png'
        rid = f'rIdRendered{gi + 1}'
        replace[f'word/media/{name}'] = open(png, 'rb').read()
        os.remove(png)
        new_rels.append(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
                        f'Target="media/{name}"/>'.encode())
        cx, cy = w * 914400 // DPI, h * 914400 // DPI
        pic_xml = _PIC.format(cx=cx, cy=cy, pid=990000 + gi, k=gi + 1, name=name, rid=rid).encode()
        for n, k in enumerate(g):
            b = blocks[k]
            keep = b.without_drawings() if b.text else b''
            if n == len(g) - 1:
                keep += pic_xml
            edits.append((b.s, b.e, keep))
        done += 1
    if not done:
        log(f'{os.path.basename(path)}: 0 of {len(groups)} figures drawn with Word shapes rendered')
        return 0
    out = []
    last = 0
    for s, e, new in sorted(edits):
        out.append(xml[last:s])
        out.append(new)
        last = e
    out.append(xml[last:])
    doc = b''.join(out)
    root_end = doc.find(b'>', doc.find(b'<w:document'))
    root = doc[:root_end]
    for pfx, uri in ((b'wp', b'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'),
                     (b'r', b'http://schemas.openxmlformats.org/officeDocument/2006/relationships')):
        if b'xmlns:' + pfx + b'=' not in root:
            doc = doc[:root_end] + b' xmlns:' + pfx + b'="' + uri + b'"' + doc[root_end:]
            root_end = doc.find(b'>', doc.find(b'<w:document'))
            root = doc[:root_end]
    replace['word/document.xml'] = doc
    replace[rels_name] = rels.replace(b'</Relationships>', b''.join(new_rels) + b'</Relationships>')
    replace['[Content_Types].xml'] = ctypes
    _write_docx(src, path + '.new', replace)
    src.close()
    os.replace(path + '.new', path)
    log(f'{os.path.basename(path)}: {done} of {len(groups)} figures drawn with Word shapes rendered')
    return done
