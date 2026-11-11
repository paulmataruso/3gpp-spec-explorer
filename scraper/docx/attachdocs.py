"""Documents a spec's zip carries beside the specification - made readable.

Some reports are mostly attachments: the test tolerance analyses of 38.903 / 38.905 / 36.903 / 36.904 / 34.902
(one Word file and one spreadsheet per test case), the ITU-R submission templates of 37.910 / 37.911, the
annexes 26.997 and 38.769 ship as separate files, Visio drawings (23.840, 33.805). attachments.py lists them;
here each one gets an "html" rendering for the reader:

  Word (.doc .docx .rtf)   LibreOffice -> .docx, then the specs' own path (prepare_docx, pandoc + split.lua),
                           headings kept, figures written like the spec's (images/zf<N>-imageK.png)
  spreadsheets             LibreOffice's HTML export, reduced to plain tables (one per sheet)
  Visio (.vsd .vsdx)       LibreOffice Draw -> PNG (first page)

The entry gains {"doc": html, "kind": "word"|"sheet"|"drawing"}.
"""

import html as htmllib
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile
from html.parser import HTMLParser

WORD = ('.doc', '.docx', '.rtf', '.dot', '.dotx')
SHEET = ('.xls', '.xlsx', '.xlsm', '.ods')
DRAW = ('.vsd', '.vsdx')
CONVERTIBLE = WORD + SHEET + DRAW
MAX_BYTES = 40 * 1024 * 1024  # larger files stay listed only
MAX_HTML = 6 * 1024 * 1024
MAX_ROWS = 4000  # per sheet
HERE = os.path.dirname(os.path.abspath(__file__))


def _soffice(args, timeout):
    from legacy import soffice  # noqa: E402 - same directory; kills the whole process group on timeout
    return soffice(args, timeout)


def _batch(files, target, outdir, log, per=25):
    """LibreOffice conversion of many files (one start-up per chunk); a chunk that hangs is done file by file"""
    os.makedirs(outdir, exist_ok=True)
    out = lambda f: os.path.join(outdir, os.path.splitext(os.path.basename(f))[0] + '.' + target.split(':')[0])
    for i in range(0, len(files), per):
        chunk = files[i:i + per]
        if _soffice(['--convert-to', target, '--outdir', outdir, *chunk], 60 + 30 * len(chunk)) is None:
            for f in chunk:
                if not os.path.exists(out(f)):
                    # big spreadsheets (38.508-2's 13 MB band list) take a while
                    if _soffice(['--convert-to', target, '--outdir', outdir, f], 180 + os.path.getsize(f) // 30000) is None:
                        log(f'  {os.path.basename(f)}: LibreOffice timed out')
    return {f: out(f) for f in files if os.path.exists(out(f))}


# ---------------------------------------------------------------- Word


def _word_html(docx, spec, k, dest, tmp):
    from convert_docx import prepare_docx  # noqa: E402 - same directory
    from convert import write_figures  # noqa: E402 - scraper/figures
    raw = open(docx, 'rb').read()
    dz, prepared = prepare_docx(raw)
    src = os.path.join(tmp, f'zf{k}.docx')
    open(src, 'wb').write(prepared)
    out = os.path.join(tmp, f'zf{k}.ndjson')
    ids, seen, stack = (os.path.join(tmp, f'zf{k}.{x}') for x in ('ids', 'seen', 'stack'))
    for f in (out, ids, seen, stack):
        open(f, 'w').close()
    prefix = f'{spec}/images/zf{k}-'
    env = dict(os.environ, SPLIT_OUT=out, SPLIT_IDS=ids, SPLIT_IMG_PREFIX=prefix, SPLIT_DISCOVER='1', SPLIT_SEEN=seen,
               SPLIT_STACK=stack)
    r = subprocess.run(['pandoc', '-f', 'docx+styles', '-t', 'html5', '--lua-filter', os.path.join(HERE, 'split.lua'), '-o',
                        os.devnull, src], env=env, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise RuntimeError(f'pandoc: {r.stderr[-300:]}')
    lines = [json.loads(l) for l in open(out, encoding='utf-8') if l.strip()]
    media = {}
    for n in dz.namelist():
        m = re.match(r'word/media/([^/]+?)(\.\w+)$', n)
        if m:
            media[m.group(1)] = n
    found, sizes = {}, {}
    img_re = re.compile(r'data-src="' + re.escape(prefix) + r'([^"/]+?)\.png"(?: alt="[^"]*")?(?: width="(\d+)")?')
    parts = []
    for s in lines:
        for m in img_re.finditer(s['html']):
            key = f'zf{k}-{m.group(1)}'
            if m.group(1) in media and key not in found:
                found[key] = (dz.read(media[m.group(1)]), os.path.splitext(media[m.group(1)])[1].lower())
            if m.group(2):
                sizes[key] = [max(int(m.group(2)), (sizes.get(key) or [0])[0]), 0]
        title = ' '.join(x for x in (s.get('num'), s.get('title')) if x and x != s.get('id')) if s.get('title') else ''
        if title and not re.fullmatch(r'(front|foreword|preamble)', s['id']):
            lv = min(6, max(3, int(float(s.get('level') or 1)) + 2))
            parts.append(f'<h{lv}>{htmllib.escape(title)}</h{lv}>')
        parts.append(s['html'])
    if found:
        write_figures(found, dest, sizes, spec)
    for f in (src, out, ids, seen, stack):
        os.remove(f)
    return '\n'.join(parts)


# ---------------------------------------------------------------- spreadsheets


class _Sheet(HTMLParser):
    """LibreOffice Calc's HTML export -> [(sheet title, rows of (text, colspan, rowspan, align))]"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sheets, self.title, self.rows, self.cell, self.depth, self.in_h = [], '', None, None, 0, False
        self.htext = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'h1':
            self.in_h, self.htext = True, []
        elif tag == 'table':
            self.depth += 1
            if self.depth == 1:
                self.rows = []
        elif self.depth == 1 and tag == 'tr':
            self.rows.append([])
        elif self.depth == 1 and tag in ('td', 'th') and self.rows is not None:
            if not self.rows:
                self.rows.append([])
            self.cell = {'t': [], 'cs': int(a.get('colspan') or 1), 'rs': int(a.get('rowspan') or 1),
                         'al': (a.get('align') or '').lower(), 'th': tag == 'th'}
        elif tag == 'br' and self.cell is not None:
            self.cell['t'].append('\n')

    def handle_endtag(self, tag):
        if tag == 'h1':
            self.in_h = False
            self.title = re.sub(r'\s+', ' ', ''.join(self.htext)).strip()
            self.title = re.sub(r'^Sheet \d+:\s*', '', self.title)
        elif tag == 'table':
            if self.depth == 1 and self.rows is not None:
                self.sheets.append((self.title, self.rows))
                self.rows, self.title = None, ''
            self.depth = max(0, self.depth - 1)
        elif self.depth == 1 and tag in ('td', 'th') and self.cell is not None:
            self.rows[-1].append(self.cell)
            self.cell = None

    def handle_data(self, d):
        if self.in_h:
            self.htext.append(d)
        elif self.cell is not None:
            self.cell['t'].append(d)


def _sheet_html(path):
    """the sheets as tables; a workbook too large to show whole keeps the first rows of each sheet"""
    p = _Sheet()
    p.feed(open(path, encoding='utf-8', errors='replace').read())
    for cap in (MAX_ROWS, 1000, 250, 60):
        h = _sheets_html(p.sheets, cap)
        if len(h) <= MAX_HTML:
            return h
    return ''


def _sheets_html(sheets, max_rows):
    out = []
    for title, rows in sheets:
        clean = []
        for r in rows[:max_rows]:
            cells = [(re.sub(r'[ \t\xa0]+', ' ', ''.join(c['t'])).strip(), c) for c in r]
            while cells and not cells[-1][0] and cells[-1][1]['cs'] == 1 and cells[-1][1]['rs'] == 1:
                cells.pop()
            clean.append(cells)
        while clean and not clean[-1]:
            clean.pop()
        while clean and not clean[0]:
            clean.pop(0)
        if not clean:
            continue
        width = max(sum(c['cs'] for _, c in r) for r in clean)
        body, blank = [], 0
        for r in clean:
            if not r:
                blank += 1
                if blank > 1:
                    continue
            else:
                blank = 0
            tds = []
            for t, c in r:
                attrs = (f' colspan="{c["cs"]}"' if c['cs'] > 1 else '') + (f' rowspan="{c["rs"]}"' if c['rs'] > 1 else '')
                cl = ['rgt'] if c['al'] == 'right' else ['ctr'] if c['al'] == 'center' else []
                if len(t) > 32:  # notes and descriptions wrap; numbers and labels stay on one line
                    cl.append('wrap')
                cls = f' class="{" ".join(cl)}"' if cl else ''
                tag = 'th' if c['th'] else 'td'
                tds.append(f'<{tag}{attrs}{cls}>{htmllib.escape(t).replace(chr(10), "<br>")}</{tag}>')
            body.append('<tr>' + ''.join(tds) + (f'<td colspan="{width}"></td>' if not tds else '') + '</tr>')
        more = f'<p class="note">… {len(rows) - max_rows:,} more rows in the file.</p>' if len(rows) > max_rows else ''
        out.append((f'<h3>{htmllib.escape(title)}</h3>' if title else '') +
                   f'<div class="tbl"><table class="sheet"><tbody>{"".join(body)}</tbody></table></div>{more}')
    return '\n'.join(out)


# ---------------------------------------------------------------- Visio


def _png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def _drawing_html(png, spec, k, dest):
    # Draw exports the whole page: down to the drawing, with a margin (ImageMagick)
    trimmed = png + '.trim.png'
    try:
        subprocess.run(['convert', png, '-trim', '+repage', '-bordercolor', 'white', '-border', '16', trimmed],
                       capture_output=True, timeout=120)
        if os.path.exists(trimmed) and _png_size(trimmed):
            png = trimmed
    except subprocess.TimeoutExpired:
        pass
    size = _png_size(png)
    if not size or size[0] < 8 or size[1] < 8:
        return ''
    name = f'zf{k}-drawing.png'
    shutil.copyfile(png, os.path.join(dest, name + '.part'))  # the temporary folder is on another filesystem
    os.replace(os.path.join(dest, name + '.part'), os.path.join(dest, name))
    w = min(size[0], 1200)
    return (f'<figure class="fig"><img data-src="{htmllib.escape(spec)}/images/{name}" alt="Figure" width="{w}" '
            f'loading="lazy" decoding="async"></figure>')


# ---------------------------------------------------------------- all of them


def render(items, files, data_dir, spec, log=print):
    """items: attachments.entries() output; files: {entry path: local copy} of the convertible ones"""
    if not files:
        return 0
    dest = os.path.join(data_dir, 'images', spec, 'images')
    os.makedirs(dest, exist_ok=True)
    for f in os.listdir(dest):  # earlier renderings of the zip's documents
        if f.startswith('zf'):
            os.remove(os.path.join(dest, f))
    tmp = tempfile.mkdtemp()
    by_path = {e['path']: e for e in items}
    # stable numbering: the entry's position among the convertible files, sorted by path
    order = sorted(files)
    num = {p: i + 1 for i, p in enumerate(order)}
    ext = lambda p: os.path.splitext(p)[1].lower()
    word = [p for p in order if ext(p) in WORD]
    sheet = [p for p in order if ext(p) in SHEET]
    draw = [p for p in order if ext(p) in DRAW]
    done = 0
    # Word: .docx as they are (by content: a ".doc" may hold OOXML), the others through LibreOffice
    to_conv = []
    docx = {}
    for p in word:
        with open(files[p], 'rb') as f:
            magic = f.read(4)
        if magic == b'PK\x03\x04':
            try:
                if 'word/document.xml' in zipfile.ZipFile(files[p]).namelist():
                    docx[p] = files[p]
                    continue
            except zipfile.BadZipFile:
                pass
        to_conv.append(p)
    conv = _batch([files[p] for p in to_conv], 'docx', os.path.join(tmp, 'word'), log)
    for p in to_conv:
        if files[p] in conv:
            docx[p] = conv[files[p]]
    for p in word:
        if p not in docx:
            continue
        try:
            h = _word_html(docx[p], spec, num[p], dest, tmp)
        except Exception as e:  # noqa: BLE001 - one bad file must not stop the others
            log(f'  {p}: {type(e).__name__}: {str(e)[:200]}')
            continue
        if h.strip() and len(h) <= MAX_HTML:
            by_path[p].update(doc=h, kind='word')
            done += 1
    sheets = _batch([files[p] for p in sheet], 'html', os.path.join(tmp, 'sheet'), log)
    for p in sheet:
        if files[p] not in sheets:
            continue
        try:
            h = _sheet_html(sheets[files[p]])
        except Exception as e:  # noqa: BLE001
            log(f'  {p}: {type(e).__name__}: {str(e)[:200]}')
            continue
        if h.strip() and len(h) <= MAX_HTML:
            by_path[p].update(doc=h, kind='sheet')
            done += 1
    pngs = _batch([files[p] for p in draw], 'png', os.path.join(tmp, 'draw'), log)
    for p in draw:
        if files[p] in pngs:
            h = _drawing_html(pngs[files[p]], spec, num[p], dest)
            if h:
                by_path[p].update(doc=h, kind='drawing')
                done += 1
    shutil.rmtree(tmp, ignore_errors=True)
    log(f'  zip documents: {done} of {len(files)} rendered ({len(word)} Word, {len(sheet)} spreadsheets, {len(draw)} Visio)')
    return done
