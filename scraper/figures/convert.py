#!/usr/bin/env python3
"""
Runs inside the converter container (see docker/converter/Dockerfile).

  python3 convert.py <jobs.json> <out_dir>

jobs.json: [{"spec": "38.300", "urls": ["https://www.3gpp.org/.../38300-j20.zip", ...],
             "needed": ["images/image3.png", ...], "sizes": {"image3": [508, 288], ...},
             "order": [["image3", 508, 288], ...]}]      # figures in document order

For every needed figure "images/imageN.<ext>" we find the matching word/media/* file of the
official document and write <out_dir>/<spec>/images/imageN.png|.jpg|.gif
  - .docx releases: itecspec's imageN is normally word/media/imageN (checked via display sizes)
  - legacy .doc/.rtf releases are converted to .docx with LibreOffice first; the media numbering
    then differs, so figures are matched by aligning both sequences (document order + size)
Vector EMF/WMF figures are converted with headless LibreOffice: rendered at 4x (384 dpi) on
the page, trimmed to the drawing, then shrunk to 2x the display width the spec uses
(sharp on high-DPI screens, small files).
"""
import io, json, os, re, shutil, struct, subprocess, sys, tempfile, time, urllib.request, zipfile

RASTER = {'.png': '.png', '.jpg': '.jpg', '.jpeg': '.jpg', '.gif': '.gif'}
VECTOR = {'.emf', '.wmf'}
CONVERT_IM = {'.bmp', '.tif', '.tiff'}
# A4 at 384 dpi; LibreOffice places a metafile at its natural size on an A4 page
PNG_4X = 'png:draw_png_Export:{"PixelWidth":{"type":"long","value":"3176"},"PixelHeight":{"type":"long","value":"4492"}}'

def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)

def download(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'spec-explorer-figures/1.0'})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:
            log('  download failed', url, e)
            time.sleep(3 * (i + 1))
    return None

def load_documents(zbytes):
    """[(name, ZipFile)] for the .docx parts of an official spec zip (legacy .doc/.rtf converted)"""
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    docs = []
    for n in sorted(x for x in z.namelist() if x.lower().endswith('.docx')):
        try:
            docs.append((n, zipfile.ZipFile(io.BytesIO(z.read(n)))))
        except Exception as e:
            log('  bad docx', n, e)
    if docs:
        return docs, False
    legacy = sorted(x for x in z.namelist() if x.lower().endswith(('.doc', '.rtf')) and not x.endswith('/'))
    if not legacy:
        return [], False
    tmp = tempfile.mkdtemp()
    try:
        paths = []
        for i, n in enumerate(legacy):
            p = os.path.join(tmp, f'{i:03d}_' + re.sub(r'[^\w.-]', '_', os.path.basename(n)))
            open(p, 'wb').write(z.read(n))
            paths.append(p)
        subprocess.run(['soffice', '--headless', '--norestore', '--convert-to', 'docx', '--outdir', tmp] + paths,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3600)
        for p in paths:
            q = os.path.splitext(p)[0] + '.docx'
            if os.path.exists(q):
                docs.append((os.path.basename(q), zipfile.ZipFile(io.BytesIO(open(q, 'rb').read()))))
    except subprocess.TimeoutExpired:
        log('  soffice .doc conversion timeout')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return docs, True

SEQ_RE = re.compile(r'<wp:extent cx="(\d+)" cy="(\d+)"|r:embed="([^"]+)"|<v:shape\b[^>]*?style="([^"]*)"|<v:imagedata\b[^>]*?r:id="([^"]+)"')

UNIT_PX = {'pt': 4 / 3, 'in': 96, 'cm': 96 / 2.54, 'mm': 96 / 25.4, 'px': 1, 'pc': 16}

def css_px(style, prop):
    m = re.search(prop + r':\s*([\d.]+)\s*(pt|in|cm|mm|px|pc)?', style)
    return round(float(m.group(1)) * UNIT_PX[m.group(2) or 'px']) if m else None

def media_sequence(dz):
    """[(media file name, (w, h) display px or None)] in document order"""
    try:
        rels = dz.read('word/_rels/document.xml.rels').decode('utf-8', 'replace')
        doc = dz.read('word/document.xml').decode('utf-8', 'replace')
    except KeyError:
        return []
    rid = {}
    for tag in re.findall(r'<Relationship\b[^>]*>', rels):
        i, t = re.search(r'Id="([^"]+)"', tag), re.search(r'Target="([^"]+)"', tag)
        if i and t and 'media/' in t.group(1):
            rid[i.group(1)] = t.group(1).rsplit('/', 1)[-1]
    seq, dims = [], None
    for m in SEQ_RE.finditer(doc):
        if m.group(1):
            dims = (round(int(m.group(1)) / 9525), round(int(m.group(2)) / 9525))
        elif m.group(4) is not None:
            w, h = css_px(m.group(4), 'width'), css_px(m.group(4), 'height')
            dims = (w, h) if w and h else None
        else:
            name = rid.get(m.group(3) or m.group(5))
            if name:
                seq.append((name, dims))
    return seq

def same_size(a, b, tol=3):
    return bool(a and b) and abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol

def align(want_seq, doc_seq):
    """longest common subsequence on display size: {wanted name: index into doc_seq}"""
    n, m = len(want_seq), len(doc_seq)
    if n * m > 20_000_000:  # ~160 MB of DP rows
        return {}
    prev = [0] * (m + 1)
    rows = []
    for i in range(1, n + 1):
        cur = [0] * (m + 1)
        wd = want_seq[i - 1][1]
        for j in range(1, m + 1):
            if same_size(wd, doc_seq[j - 1][1]):
                cur[j] = prev[j - 1] + 1
            else:
                cur[j] = cur[j - 1] if cur[j - 1] > prev[j] else prev[j]
        rows.append(cur)
        prev = cur
    out, i, j = {}, n, m
    while i > 0 and j > 0:
        row, up = rows[i - 1], rows[i - 2] if i > 1 else [0] * (m + 1)
        if same_size(want_seq[i - 1][1], doc_seq[j - 1][1]) and row[j] == up[j - 1] + 1:
            out.setdefault(want_seq[i - 1][0], j - 1)
            i, j = i - 1, j - 1
        elif up[j] >= row[j - 1]:
            i -= 1
        else:
            j -= 1
    return out

_renderer = None

def uno_renderer():
    """one long-lived LibreOffice per process (None when python3-uno is unavailable)"""
    global _renderer
    if _renderer is None:
        try:
            from render_uno import Renderer
            _renderer = Renderer()
            _renderer.start()
        except Exception as e:
            log('  UNO renderer unavailable, using soffice --convert-to:', e)
            _renderer = False
    return _renderer or None

def emf_embedded_image(b):
    """Bitmap (PNG/JPEG/...) embedded in an EMF+ image object or texture brush. Some EMF+ files paint
    the whole figure with such a brush, which LibreOffice renders as a blank page."""
    objs, off = {}, 0
    while off + 8 <= len(b):
        t, n = struct.unpack_from('<II', b, off)
        if n < 8:
            break
        if t == 70 and b[off + 12:off + 16] == b'EMF+':
            p, end = off + 16, off + n
            while p + 12 <= end:
                pt, pf, ps, pd = struct.unpack_from('<HHII', b, p)
                if ps < 12:
                    break
                if pt == 0x4008:  # EmfPlusObject; continued objects carry a 4-byte total size first
                    start = p + 16 if pf & 0x8000 else p + 12
                    objs.setdefault((pf & 0xff, (pf >> 8) & 0x7f), bytearray()).extend(b[start:p + 12 + pd])
                p += ps
        off += n
    best = None
    for (_, otype), d in objs.items():
        try:
            if otype == 1 and struct.unpack_from('<I', d, 4)[0] == 2:  # texture brush
                q = 16 + (24 if struct.unpack_from('<I', d, 8)[0] & 0x02 else 0)
            elif otype == 5:  # image
                q = 0
            else:
                continue
            if struct.unpack_from('<I', d, q + 4)[0] == 1 and struct.unpack_from('<I', d, q + 24)[0] == 1:
                img = bytes(d[q + 28:])
                if best is None or len(img) > len(best):
                    best = img
        except struct.error:
            continue
    return best

def finish_png(png, out, w):
    """flatten on white, trim margins, pad, shrink to 2x display width (never enlarge); False if blank"""
    part = out + '.part'  # same directory as the target, so the rename below is atomic
    subprocess.run(['convert', png, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-trim', '+repage',
                    '-bordercolor', 'white', '-border', '12', '-resize', f'{max(2 * w, 160)}x>', '-strip',
                    '-define', 'png:compression-level=9', 'png:' + part], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(part):
        return False
    dims = subprocess.run(['identify', '-format', '%w %h', 'png:' + part], capture_output=True, text=True).stdout.split()
    if len(dims) == 2 and int(dims[0]) < 40 and int(dims[1]) < 40 and w > 40:
        os.remove(part)  # a blank drawing trims down to almost nothing
        return False
    os.replace(part, out)
    return True

def write_figures(found, dest, sizes, label=''):
    """found: {name: (bytes, ext)} -> dest/name.png|.jpg|.gif (vector formats rendered via LibreOffice)"""
    tmp = tempfile.mkdtemp()
    vec = []
    for k, (blob, ext) in found.items():
        # go by content: LibreOffice names the metafiles of converted .doc files ".wmf" even when they are EMF,
        # and some documents carry a placeable WMF under ".emf" (29.842) - misnamed, LibreOffice renders neither
        if ext in ('.wmf', '.emf'):
            if blob[40:44] == b' EMF':
                ext = '.emf'
            elif blob[:4] == b'\xd7\xcd\xc6\x9a' or (blob[:2] in (b'\x01\x00', b'\x02\x00') and blob[2:4] == b'\x09\x00'):
                ext = '.wmf'
        if ext in RASTER:
            final = os.path.join(dest, k + RASTER[ext])
            open(final + '.part', 'wb').write(blob)
            os.replace(final + '.part', final)
        elif ext in VECTOR or ext in CONVERT_IM:
            p = os.path.join(tmp, k + ext)
            open(p, 'wb').write(blob)
            vec.append(p)
    # 1) fast path: export each drawing's bounding box at 2x display width
    pending = []
    r = uno_renderer() if vec else None
    for p in vec:
        k = os.path.splitext(os.path.basename(p))[0]
        w = (sizes.get(k) or [0, 0])[0] or 0
        png = os.path.join(tmp, k + '.uno.png')
        ok = False
        if r:
            try:
                ok = bool(r.render(p, png, width_px=2 * w if w else None)) and finish_png(png, os.path.join(dest, k + '.png'), w or 600)
            except Exception as e:
                log('  uno render failed', label, k, type(e).__name__)
                try:
                    r.restart()
                except Exception:
                    r = None
        if not ok:
            pending.append(p)
    # 2) fallback: full-page bitmap at 384 dpi, trimmed
    for i in range(0, len(pending), 25):
        batch = pending[i:i + 25]
        try:
            subprocess.run(['soffice', '--headless', '--norestore', '--convert-to', PNG_4X, '--outdir', tmp] + batch,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
        except subprocess.TimeoutExpired:
            log('  soffice timeout', label)
    for p in pending:
        k = os.path.splitext(os.path.basename(p))[0]
        w = (sizes.get(k) or [0, 0])[0] or 600
        out = os.path.join(dest, k + '.png')
        png = os.path.join(tmp, k + '.png')
        if os.path.exists(png) and os.path.getsize(png) > 0 and finish_png(png, out, w):
            continue
        # 3) last resort: the bitmap embedded in an EMF+ brush / image object
        if p.lower().endswith('.emf'):
            img = emf_embedded_image(open(p, 'rb').read())
            if img:
                raw = os.path.join(tmp, k + '.embedded')
                open(raw, 'wb').write(img)
                finish_png(raw, out, w)
    shutil.rmtree(tmp, ignore_errors=True)

def main():
    jobs = json.load(open(sys.argv[1]))
    out_root = sys.argv[2]
    for job in jobs:
        spec, needed, sizes = job['spec'], job['needed'], job.get('sizes', {})
        dest = os.path.join(out_root, spec, 'images')
        os.makedirs(dest, exist_ok=True)
        want = {}
        for src in needed:
            m = re.match(r'images/(image\d+)\.\w+$', src)
            if m:
                want[m.group(1)] = src
        # skip what we already have
        have = {os.path.splitext(f)[0] for f in os.listdir(dest)}
        want = {k: v for k, v in want.items() if k not in have}
        if not want:
            open(os.path.join(out_root, spec, '.done'), 'w').write(json.dumps({'ok': True, 'missing': []}))
            continue
        found, method = {}, '-'
        order = [(o[0], (o[1], o[2]) if o[1] and o[2] else None) for o in job.get('order', [])]
        for url in job['urls']:
            data = download(url)
            if not data:
                continue
            try:
                docs, legacy = load_documents(data)
            except zipfile.BadZipFile as e:
                log('  bad zip', url, e)
                continue
            if not docs:
                continue
            # (part, media name) occurrences in document order
            seq = []
            for pi, (_, dz) in enumerate(docs):
                prev = None
                for name, dims in media_sequence(dz):
                    # Office "Graphic": an SVG stored right after its PNG fallback - keep the PNG
                    if name.lower().endswith('.svg') and prev and prev[1] == dims:
                        continue
                    seq.append(((pi, name), dims))
                    prev = (name, dims)
            by_stem = {}
            for pi, (_, dz) in enumerate(docs):
                for n in dz.namelist():
                    mm = re.match(r'word/media/(image\d+)(\.\w+)$', n)
                    if mm and mm.group(1) not in by_stem:
                        by_stem[mm.group(1)] = (pi, mm.group(1) + mm.group(2))
            seq_dims = {}
            for key, dims in seq:
                seq_dims.setdefault(key, dims)
            # direct numbering works when the sizes agree
            checked = [(k, by_stem.get(k)) for k in want if sizes.get(k) and by_stem.get(k) and seq_dims.get(by_stem[k])]
            agree = sum(1 for k, ref in checked if same_size(tuple(sizes[k]), seq_dims.get(ref)))
            mapping = {}
            if not legacy and len(docs) == 1 and (not checked or agree >= 0.85 * len(checked)):
                mapping = {k: by_stem[k] for k in want if k in by_stem}
                method = 'direct'
            elif order and seq:
                idx = align([o for o in order if o[0] in want], seq)
                mapping = {k: seq[i][0] for k, i in idx.items()}
                used = set(mapping.values())
                for k, dims in order:  # leftovers: an unused image of the same size
                    if k in want and k not in mapping:
                        for key, d in seq:
                            if key not in used and same_size(dims, d):
                                mapping[k] = key
                                used.add(key)
                                break
                method = 'aligned'
            for k, (pi, name) in mapping.items():
                if k not in found:
                    try:
                        found[k] = (docs[pi][1].read('word/media/' + name), os.path.splitext(name)[1].lower())
                    except KeyError:
                        pass
            if len(found) == len(want):
                break
        write_figures(found, dest, sizes, spec)
        have = {os.path.splitext(f)[0] for f in os.listdir(dest)}
        missing = sorted(k for k in want if k not in have)
        open(os.path.join(out_root, spec, '.done'), 'w').write(json.dumps({'ok': not missing, 'missing': missing, 'found': len(found), 'method': method}))
        log(f'{spec}: {len(want) - len(missing)}/{len(want)} figures [{method}]' + (f' (missing {len(missing)})' if missing else ''))

if __name__ == '__main__':
    try:
        main()
    finally:
        if _renderer:
            _renderer.stop()
