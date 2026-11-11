"""
Prepare a spec zip whose text is in pre-2007 formats (Word 2/6/95/97 .doc, .rtf, WordPerfect) for
convert_docx.py: the parts are converted to .docx with a current LibreOffice (docker/legacy image;
the converter image's LibreOffice 7.4 hangs on some Word 97 files) and the cached zip is replaced by
one holding the .docx parts (the original is kept as <zip>.orig).

    python3 legacy.py <zip url> <cache dir>

A Word file LibreOffice hangs on (a few GSM-era Word 6/95 files, 51.010-2) goes through wvWare instead:
wvHtml keeps the paragraph style names, so headings, tables and figures survive into the HTML that
LibreOffice then turns into .docx. A zip with nothing but a .txt note (45.014: "consult 05.14") gives that note.

Exit codes: 0 prepared or nothing to do, 2 download failed, 3 no part could be converted.
"""
import base64
import html as htmllib
import io
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from html.parser import HTMLParser

import drawings  # noqa: E402 - same directory

_NOT_TEXT = ('.xls', '.xlsx', '.ppt', '.pptx', '.vsd', '.mdb', '.zip', '.exe', '.dot', '.pdf', '.htm', '.html')


def legacy_kind(name, z):
    """extension LibreOffice should see for a pre-docx text document in the zip, or None"""
    low = name.lower()
    if low.endswith('/') or low.endswith(_NOT_TEXT):
        return None
    with z.open(name) as f:
        head = f.read(8)
    if head.startswith(b'\xd0\xcf\x11\xe0'):
        return 'doc'
    if head.startswith(b'{\\rtf'):
        return 'rtf'
    if head.startswith(b'\xffWPC'):
        return 'wpd'
    if head[:2] in (b'\xdb\xa5', b'\x31\xbe') or head[:4] == b'\x9b\xa5\x21\x00':
        return 'doc'  # Word 2.0 / Word for DOS / Write
    return None


def is_ooxml(name, z):
    """a Word 2007+ part, whatever its name says (36714-00-00-e00.doc is a .docx inside; ~$x.docx is a lock file)"""
    low = name.lower()
    if low.endswith('/') or not low.endswith(('.docx', '.doc', '.rtf')):
        return False
    with z.open(name) as f:
        if f.read(4) != b'PK\x03\x04':
            return False
    if low.endswith('.docx'):
        return True
    try:
        return 'word/document.xml' in zipfile.ZipFile(io.BytesIO(z.read(name))).namelist()
    except zipfile.BadZipFile:
        return False


# names of the revision-marked twin that drafts ship next to the clean copy (23138-111_rm.docx,
# TR_33802_v020_change_marks.doc, ..._wChangeBars.docx, ..._TrackingChanges.docx, ... v0.2.0 ..._cm.docx)
_REV_RE = re.compile(r'(?:^|[-_ .])(?:rm|rev|cm|revmarks?|rev[-_ ]?marks|change[-_ ]?(?:marks|bars)|w?changebars|'
                     r'(?:diff)?marked|track(?:ed|ing)?[-_ ]?changes|tracked)$', re.I)
# spec number and version code of a file or zip name: 24067-j00, 36579-3-100, 0408-7l0, 36714-00-00-e00
_VER_RE = re.compile(r'^(?:\d{3}_)?(\d{4,5}(?:-\d+)*)-([0-9a-z]{3})(?![0-9a-z])', re.I)


_SPLIT_RE = re.compile(r'annex|appendix|clause|chapter|part|section|_s\d|\bs\d', re.I)


def spec_parts(names, ok, zip_name=''):
    """the zip entries that make up the spec document, in order: entries for which ok(name) holds, without
    macOS resource forks (__MACOSX/, ._x.docx), cover pages, attachments in deeper folders (26.956 ships
    simulation logs as .docx), the revision-marked copy of a draft that also comes clean, or - when the
    spec's own parts carry its number (zip_name 21919-100.zip) - accompanying TDocs such as the plenary
    cover note SP-260225.docx or an "editorial issues" list"""
    parts = [n for n in names if ok(n) and '__MACOSX' not in n and not os.path.basename(n).startswith('._')
             and 'cover' not in n.lower() and not re.match(r'thumbs\.\w+$', os.path.basename(n), re.I)]
    if not parts:
        return []
    depth = min(n.count('/') for n in parts)
    parts = [n for n in parts if n.count('/') == depth]
    rev = [n for n in parts if _REV_RE.search(os.path.splitext(os.path.basename(n))[0].strip())]
    if rev and len(rev) < len(parts):
        parts = [n for n in parts if n not in rev]
    # an older version's file that came along (24067-i00.docx in 24067-j00.zip): the zip's own version only
    zv = _VER_RE.match(os.path.basename(zip_name or ''))
    if zv and len(parts) > 1:
        ver = {n: _VER_RE.match(os.path.basename(n)) for n in parts}
        same = [n for n in parts if ver[n] and ver[n].group(1) == zv.group(1) and ver[n].group(2).lower() == zv.group(2).lower()]
        older = [n for n in parts if ver[n] and ver[n].group(1) == zv.group(1) and ver[n].group(2).lower() != zv.group(2).lower()]
        if same and older:
            parts = [n for n in parts if n not in older]
    own = own_number(zip_name)
    if own and len(parts) > 1:
        other = [n for n in parts if not own.search(os.path.basename(n)) and not _SPLIT_RE.search(os.path.basename(n))]
        if other and len(other) < len(parts):
            parts = [n for n in parts if n not in other]
    if len(parts) > 1:
        notes = [n for n in parts if _NOTE_RE.search(os.path.basename(n))]
        if notes and len(notes) < len(parts):
            parts = [n for n in parts if n not in notes]
    return sorted(parts)


# the presentation of a spec to the plenary (SP-230684_Presentation_of_TS_23545_v100_for_Information.doc)
_NOTE_RE = re.compile(r'presentation[ _-]of|for[ _-](?:information|approval)', re.I)
# a TDoc number at the start of a file name: R5-106613, SP-230684, S4aP260150, C3-175380
_TDOC_RE = re.compile(r'^(?:\d{3}_)?[A-Z]{1,2}\d?[A-Za-z]{0,2}-?\d{5,}')


def own_number(zip_name):
    """pattern for the spec number in file names, from the zip's name (36571-1-100.zip -> 36[ ._-]?571)"""
    num = re.match(r'(\d\d)(\d{3})', os.path.basename(zip_name or ''))
    return re.compile(num.group(1) + r'[ ._-]?' + num.group(2)) if num else None


def open_spec_zip(path, zip_name=None):
    """the zip, or the zip inside it that holds the spec: when the archive wraps one, or when the documents
    next to it are only TDocs (the cover note R5-106613.doc next to 36571-1-100.zip)"""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    inner = sorted(n for n in names if n.lower().endswith('.zip') and '__MACOSX' not in n)
    if not inner:
        return z
    own = own_number(zip_name or path)
    mine = [n for n in inner if own and own.search(os.path.basename(n))]
    docs = [n for n in names if n.lower().endswith(('.docx', '.doc', '.rtf')) and '__MACOSX' not in n]
    if not docs:
        z = zipfile.ZipFile(io.BytesIO(z.read((mine or inner)[0])))
    elif mine and all(_TDOC_RE.match(os.path.basename(n)) for n in docs):
        z = zipfile.ZipFile(io.BytesIO(z.read(mine[0])))
    return z


_HEAD_RE = re.compile(r'^(?:annex\s+\w{1,3}\b|appendix\s+\w{1,3}\b|(?:\d{1,2}|[A-Z])(?:\.\d{1,3})*\.?\s+[A-Z(])', re.I)
_LEADER_RE = re.compile(r'(\.\s?){4,}|_{4,}')
_ITEM_RE = re.compile(r'^(\(?[a-z0-9ivx]{1,4}\)|[-\u2022*\u2013]|\d{1,2}\))\s')


def ocr(pdf):
    """page texts of a scanned PDF (tesseract on 300 dpi renders)"""
    d = tempfile.mkdtemp()
    subprocess.run(['pdftoppm', '-r', '300', '-gray', '-png', pdf, os.path.join(d, 'p')], check=True, timeout=1800)
    pages = []
    for img in sorted(os.listdir(d)):
        r = subprocess.run(['tesseract', os.path.join(d, img), 'stdout', '-l', 'eng', '--psm', '4',
                            '-c', 'preserve_interword_spaces=1'],
                           capture_output=True, text=True, timeout=600)
        pages.append(r.stdout)
    print(f'{os.path.basename(pdf)}: OCR of {len(pages)} scanned pages', flush=True)
    return pages


def pdf_to_html(pdf, html_path):
    """text of a PDF-only spec (some 1990s GSM specs) as HTML with clause headings, for LibreOffice -> .docx"""
    txt = pdf + '.txt'
    subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', pdf, txt], check=True, timeout=600)
    pages = open(txt, encoding='utf-8', errors='replace').read().split('\f')
    if sum(len(p.split()) for p in pages) < 30 * max(1, len(pages) - 1):
        pages = ocr(pdf)  # a scan without a text layer (Acrobat Capture)
    norm = lambda l: re.sub(r'\d+', '#', re.sub(r'\s+', ' ', l.strip()))
    # running headers / footers: first and last lines that recur on many pages
    edge = {}
    for pg in pages:
        lines = [l for l in pg.split('\n') if l.strip()]
        for l in lines[:2] + lines[-2:]:
            edge[norm(l)] = edge.get(norm(l), 0) + 1
    running = {k for k, n in edge.items() if n >= max(3, len(pages) // 4)}
    out, para = [], []
    esc = lambda t: t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def flush():
        if para:
            out.append('<p>' + esc(' '.join(para)) + '</p>')
            para.clear()

    # paragraphs only: a line that starts with a clause number stays a paragraph of its own, and
    # split.lua decides which of those are headings (numbers that follow on, contents list dropped)
    for pg in pages:
        for raw in pg.split('\n'):
            line = re.sub(r'\s{2,}', ' ', raw.strip())
            if not line:
                flush()
                continue
            if norm(raw) in running or (re.fullmatch(r'(page\s*)?[\dA-Z.\- ]{1,8}', line, re.I) and len(line) < 9):
                continue
            if _LEADER_RE.search(raw):  # list of contents / form lines
                flush()
                continue
            if _HEAD_RE.match(line) and len(line) <= 160:
                flush()
                para.append(line)
                flush()
                continue
            if _ITEM_RE.match(line):
                flush()
            para.append(line)
        flush()
    open(html_path, 'w', encoding='utf-8').write(
        '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' + '\n'.join(out) + '\n</body></html>')
    return len(out)


def soffice(args, timeout):
    """LibreOffice in a process group of its own, all of it killed on timeout (a hung soffice.bin left
    behind keeps the profile locked and takes the next conversion down with it); None on timeout"""
    p = subprocess.Popen(['soffice', '--headless', '--norestore', *args], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        return p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()
        return None


_IMG_TYPES = {'.wmf': 'image/x-wmf', '.emf': 'image/x-emf', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.pict': 'image/x-pict'}


class _WvClean(HTMLParser):
    """wvHtml output -> plain HTML: one element per paragraph, the paragraph style deciding what it is
    (Heading N -> hN, 3GPP's H6 -> h6, annex headings 8/9 -> h1, TOC / header / footer lines dropped),
    tables kept with their spans, figures embedded as data: URIs"""
    INLINE = ('b', 'i', 'u', 'sup', 'sub')

    def __init__(self, img_dir):
        super().__init__(convert_charrefs=True)
        self.dir, self.out, self.buf, self.style, self.skip, self.blocks = img_dir, [], [], 'Normal', 0, 0

    def flush(self):
        body = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
        self.buf = []
        if not re.sub(r'<(?!img)[^>]*>', '', body).strip():
            return
        st = self.style.strip()
        if re.match(r'(toc|header|footer|index)', st, re.I):
            return
        m = re.fullmatch(r'heading (\d)', st, re.I)
        lvl = int(m.group(1)) if m else 6 if st == 'H6' else 0
        tag = 'h1' if lvl >= 8 else f'h{min(lvl, 6)}' if lvl else 'p'
        self.out.append(f'<{tag}>{body}</{tag}>')
        self.blocks += 1

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('head', 'title', 'style', 'script'):
            self.skip += 1
        elif tag == 'div':
            self.flush()
            self.style = a.get('name') or self.style
        elif tag == 'p':
            self.flush()
        elif tag == 'table':
            self.flush()
            self.out.append('<table border="1">')
        elif tag == 'tr':
            self.flush()
            self.out.append('<tr>')
        elif tag in ('td', 'th'):
            self.flush()
            self.style = 'Normal'
            span = ''.join(f' {k}="{a[k]}"' for k in ('colspan', 'rowspan') if (a.get(k) or '1') != '1')
            self.out.append(f'<{tag}{span}>')
        elif tag in self.INLINE:
            self.buf.append(f'<{tag}>')
        elif tag == 'br':
            self.buf.append('<br>')
        elif tag == 'img':
            f = os.path.join(self.dir, os.path.basename(a.get('src') or ''))
            kind = _IMG_TYPES.get(os.path.splitext(f)[1].lower())
            if kind and os.path.isfile(f):
                data = base64.b64encode(open(f, 'rb').read()).decode()
                size = ''.join(f' {k}="{a[k]}"' for k in ('width', 'height') if a.get(k))
                self.buf.append(f'<img src="data:{kind};base64,{data}"{size}>')

    def handle_endtag(self, tag):
        if tag in ('head', 'title', 'style', 'script'):
            self.skip = max(0, self.skip - 1)
        elif tag in ('div', 'p'):
            self.flush()
        elif tag in ('td', 'th', 'tr', 'table'):
            self.flush()
            self.out.append(f'</{tag}>')
        elif tag in self.INLINE:
            self.buf.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(htmllib.escape(data, quote=False))


def wv_to_html(doc, html_path):
    """a Word 6/95/97 file through wvWare (see the module docs); number of blocks written"""
    d = tempfile.mkdtemp()
    subprocess.run(['wvHtml', f'--targetdir={d}', doc, 'wv.html'], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=900)
    src = os.path.join(d, 'wv.html')
    if not os.path.exists(src):
        return 0
    raw = open(src, 'rb').read()
    m = re.search(rb'charset=([\w-]+)', raw[:4000])
    try:
        text = raw.decode(m.group(1).decode() if m else 'cp1252', errors='replace')
    except LookupError:
        text = raw.decode('cp1252', errors='replace')
    p = _WvClean(d)
    p.feed(text)
    p.close()
    p.flush()
    open(html_path, 'w', encoding='utf-8').write(
        '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' + '\n'.join(p.out) + '\n</body></html>')
    return p.blocks


def download(url, dest):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'spec-explorer/1.0'})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest + '.part', 'wb') as f:
                shutil.copyfileobj(r, f)
            os.replace(dest + '.part', dest)
            return True
        except Exception as e:  # noqa: BLE001 - retried
            print(f'download attempt {attempt + 1}: {e}', flush=True)
            time.sleep(2 ** attempt)
    return False


def _drawn(z, n):
    """does the .docx part hold figures drawn with Word shapes only (drawings.py renders them)"""
    try:
        return drawings.needs(zipfile.ZipFile(io.BytesIO(z.read(n))).read('word/document.xml')) > 0
    except (KeyError, zipfile.BadZipFile, OSError):
        return False


def main():
    url, cache = sys.argv[1], sys.argv[2]
    os.makedirs(cache, exist_ok=True)
    zpath = os.path.join(cache, os.path.basename(url))
    if not os.path.exists(zpath) and not download(url, zpath):
        sys.exit(2)
    # always from the zip as published, so that a spec prepared before a fix here is prepared again
    z = open_spec_zip(zpath + '.orig' if os.path.exists(zpath + '.orig') else zpath, zpath)
    names = z.namelist()
    docx = spec_parts(names, lambda n: is_ooxml(n, z), zpath)
    legacy = spec_parts(names, lambda n: legacy_kind(n, z), zpath)
    if docx:
        # a .doc next to .docx parts is a part of its own (36889-d00.doc is the body of a TR whose annexes are
        # .docx) - unless it is the same document in the older format, or a TDoc that came along
        key = lambda n: re.sub(r'[^a-z0-9]', '', os.path.splitext(os.path.basename(n))[0].lower())
        stems = {key(n) for n in docx}
        legacy = [n for n in legacy if key(n) not in stems and not _TDOC_RE.match(os.path.basename(n))
                  and not _NOTE_RE.search(os.path.basename(n))]
        if not legacy and all(n.lower().endswith('.docx') for n in docx) and not any(_drawn(z, n) for n in docx):
            if os.path.exists(zpath + '.orig'):  # prepared earlier under other rules: back to the original
                os.replace(zpath + '.orig', zpath)
            return
    tmp = tempfile.mkdtemp()
    paths = []
    order = sorted(docx + legacy)  # the parts keep their order: 000_36889-d00.docx, 001_36889-d00_AnnexB1.docx
    for n in docx:
        base = re.sub(r'[^\w.-]', '_', os.path.splitext(os.path.basename(n))[0])
        open(os.path.join(tmp, f'{order.index(n):03d}_{base}.docx'), 'wb').write(z.read(n))
    if not legacy and not docx:
        # only a PDF (some GSM phase 1/2 specs): its text, with headings rebuilt from the clause numbers
        pdfs = spec_parts(names, lambda n: n.lower().endswith('.pdf'), zpath)
        for i, n in enumerate(pdfs):
            pdf = os.path.join(tmp, f'{i:03d}.pdf')
            open(pdf, 'wb').write(z.read(n))
            base = re.sub(r'[^\w.-]', '_', os.path.splitext(os.path.basename(n))[0])
            html = os.path.join(tmp, f'{i:03d}_{base}.html')
            try:
                blocks = pdf_to_html(pdf, html)
            except Exception as e:  # noqa: BLE001 - a damaged PDF must not stop the others
                print(f'{n}: {e}', flush=True)
                continue
            print(f'{n}: {blocks} blocks of text', flush=True)
            if blocks:
                paths.append(html)
        if not pdfs:
            # a note in place of the document (45014-4xx.zip: "Release-independent. Consult 05.14 v7.y.z")
            for i, n in enumerate(spec_parts(names, lambda n: n.lower().endswith('.txt'), zpath)):
                txt = z.read(n).decode('cp1252', errors='replace')
                paras = [re.sub(r'\s+', ' ', b).strip() for b in re.split(r'\n\s*\n|\r\n\s*\r\n', txt)]
                html = os.path.join(tmp, f'{i:03d}_note.html')
                open(html, 'w', encoding='utf-8').write('<!doctype html><html><head><meta charset="utf-8"></head><body>\n' + ''.join(
                    f'<p>{htmllib.escape(b)}</p>\n' for b in paras if b) + '</body></html>')
                paths.append(html)
        if not paths:
            return
    for n in legacy:
        base = re.sub(r'[^\w.-]', '_', os.path.splitext(os.path.basename(n))[0])
        q = os.path.join(tmp, f'{order.index(n):03d}_{base}.{legacy_kind(n, z)}')
        open(q, 'wb').write(z.read(n))
        paths.append(q)
    for q in paths:  # one at a time: a part that still fails must not take the others with it
        html = q.endswith('.html')
        target = 'docx:MS Word 2007 XML' if html else 'docx'
        # a few minutes for the largest Word files; LibreOffice either converts quickly or hangs for good
        limit = 900 if html else min(900, 120 + os.path.getsize(q) // 40000)
        rc = soffice(['--writer', '--convert-to', target, '--outdir', tmp, q], limit)
        out = os.path.splitext(q)[0] + '.docx'
        if not os.path.exists(out) and q.endswith('.doc'):
            print(f'{os.path.basename(q)}: LibreOffice ' + ('timed out' if rc is None else f'failed ({rc})') + ', trying wvWare', flush=True)
            via = os.path.splitext(q)[0] + '.html'
            try:
                blocks = wv_to_html(q, via)
            except Exception as e:  # noqa: BLE001 - reported, the other parts go on
                print(f'{os.path.basename(q)}: wvWare: {e}', flush=True)
                blocks = 0
            print(f'{os.path.basename(q)}: {blocks} blocks from wvWare', flush=True)
            if blocks and soffice(['--writer', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', tmp, via], 900) is None:
                print(f'{os.path.basename(via)}: timed out', flush=True)
    done = [os.path.splitext(q)[0] + '.docx' for q in paths if os.path.exists(os.path.splitext(q)[0] + '.docx')]
    print(f'{os.path.basename(zpath)}: {len(done)}/{len(paths)} legacy parts converted', flush=True)
    if not done and not docx:
        sys.exit(3)
    done = sorted(done + [os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith('.docx') and os.path.join(tmp, f) not in done])
    for d in done:  # charts, drawing canvases, shape groups: a picture of each (pandoc keeps no drawing)
        try:
            drawings.patch(d, tmp, soffice, log=lambda m: print(m, flush=True))
        except Exception as e:  # noqa: BLE001 - the text is worth more than its drawings
            print(f'{os.path.basename(d)}: drawings not rendered ({type(e).__name__}: {e})', flush=True)
    with zipfile.ZipFile(zpath + '.new', 'w', zipfile.ZIP_DEFLATED) as out:
        for d in done:
            out.write(d, os.path.basename(d))
    if not os.path.exists(zpath + '.orig'):
        os.replace(zpath, zpath + '.orig')
    os.replace(zpath + '.new', zpath)


if __name__ == '__main__':
    main()
