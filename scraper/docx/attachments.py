"""Files a spec's zip carries beside the document: TTCN-3 test suites (36.523-3), codec reference code (26.104,
06.10), OSA/Parlay IDL and WSDL (29.198-x), YANG/YAML models (28.541), ASN.1 modules (33.108), XML schemas…

For many specs they are the specification itself ("the ATS is contained in the zip file"), and itecspec shows none
of them. Each file is recorded in <data>/raw/attachments/<spec>.ndjson.gz (first line {"src": zip url, "v": N}):

  {"path": ..., "size": n, "text": ...}       text file whose content the document does not contain - shown
  {"path": ..., "size": n, "in_text": true}  text the document already carries (OpenAPI YAML in annex A, …)
  {"path": ..., "size": n, "binary": true}   anything else (spreadsheets, bitstreams, executables) - listed
  {"path": ..., "size": n, "large": true}    text too large to show - listed
  {"path": ..., "size": n, "binary": true, "doc": html, "kind": k}
                                             Word file, spreadsheet or Visio drawing rendered (attachdocs.py)

Run standalone (docx.ts --attachments) for specs whose text was converted before this existed:
    attachments.py <spec> <zip url> <data dir>
"""

import gzip
import io
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import zipfile

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)), os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'figures')]
import attachdocs  # noqa: E402 - same directory
import inflate64  # noqa: E402

VERSION = 2
MAX_TEXT = 8 * 1024 * 1024  # bytes of one file shown
_JUNK = re.compile(r'(^|/)(__MACOSX/|\._|~\$|\.DS_Store$|Thumbs\.\w+$|desktop\.ini$)', re.I)
_DOC = ('.doc', '.docx', '.dot', '.dotx', '.rtf', '.pdf', '.wpd')


def _is_text(raw):
    if not raw:
        return True
    head = raw[:8192]
    if b'\x00' in head:
        return False
    bad = sum(1 for c in head if c < 9 or 13 < c < 32)
    return bad <= len(head) * 0.01


def _decode(raw):
    for enc in ('utf-8-sig', 'cp1252'):
        try:
            return raw.decode(enc).replace('\r\n', '\n').replace('\r', '\n')
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1').replace('\r\n', '\n').replace('\r', '\n')


def _squash(s):
    return re.sub(r'\s+', '', s)


def in_text(text, haystack):
    """does the document already carry this file (60 % of up to 20 sampled distinctive lines)"""
    if not haystack:
        return False
    lines = [_squash(l) for l in text.split('\n')]
    lines = [l for l in lines if 25 <= len(l) <= 200]
    if len(lines) < 3:
        return False
    sample = lines[:: max(1, len(lines) // 20)][:20]
    return sum(1 for l in sample if l in haystack) >= len(sample) * 0.6


def _legacy_doc(n, z):
    try:
        from legacy import legacy_kind  # noqa: E402 - same directory
        return bool(legacy_kind(n, z))
    except Exception:  # noqa: BLE001 - unreadable member: not a document part
        return False


def html_haystack(htmls):
    """converted sections' text, whitespace removed (for in_text)"""
    t = ''.join(re.sub(r'<[^>]+>', '', h) for h in htmls)
    return _squash(t.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&amp;', '&'))


def entries(z, skip=(), haystack='', depth=0, prefix='', keep=None):
    """every file of the zip (nested zips opened), document parts and junk left out; keep = (dir, {}) collects
    local copies of the files attachdocs.py renders"""
    out = []
    for info in z.infolist():
        n = info.filename
        if n.endswith('/') or _JUNK.search(n) or n in skip:
            continue
        path = prefix + n
        low = n.lower()
        if low.endswith('.zip') and depth < 2:
            if 'band' in os.path.basename(low) and 'combination' in os.path.basename(low) and 'bandcombos' in skip:
                out.append({'path': path, 'size': info.file_size, 'binary': True, 'note': 'rendered into the configuration clauses'})
                continue
            try:
                try:
                    blob = z.read(n)
                except NotImplementedError:
                    blob = inflate64.read_member(z, info)
                inner = zipfile.ZipFile(io.BytesIO(blob))
            except (zipfile.BadZipFile, OSError, ValueError, struct.error):
                out.append({'path': path, 'size': info.file_size, 'binary': True})
                continue
            out += entries(inner, (), haystack, depth + 1, path + '/', keep)
            continue
        if depth == 0 and (low.endswith(_DOC) or _legacy_doc(n, z)):
            continue  # the document itself, its revision-marked twin, cover notes, Word 6 parts (1110D3E1.WW6)
        try:
            raw = z.read(n)
        except NotImplementedError:  # Deflate64 (38.903's attachments)
            try:
                raw = inflate64.read_member(z, info)
            except (ValueError, OSError, struct.error):
                out.append({'path': path, 'size': info.file_size, 'binary': True})
                continue
        except (zipfile.BadZipFile, OSError):  # damaged member
            out.append({'path': path, 'size': info.file_size, 'binary': True})
            continue
        if keep is not None and low.endswith(attachdocs.CONVERTIBLE) and 0 < len(raw) <= attachdocs.MAX_BYTES:
            local = os.path.join(keep[0], f'{len(keep[1]):05d}{os.path.splitext(low)[1]}')
            open(local, 'wb').write(raw)
            keep[1][path] = local
            out.append({'path': path, 'size': info.file_size, 'binary': True})
            continue
        if low.endswith(_DOC):
            out.append({'path': path, 'size': info.file_size, 'binary': True})
            continue
        if not _is_text(raw):
            out.append({'path': path, 'size': info.file_size, 'binary': True})
        elif len(raw) > MAX_TEXT:
            out.append({'path': path, 'size': info.file_size, 'large': True})
        else:
            text = _decode(raw)
            if in_text(text, haystack):
                out.append({'path': path, 'size': info.file_size, 'in_text': True})
            else:
                out.append({'path': path, 'size': info.file_size, 'text': text})
    return out


def write(data_dir, spec, url, items):
    """one file per spec; a spec with none gets the header line only (checked, nothing there)"""
    d = os.path.join(data_dir, 'raw', 'attachments')
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{spec}.ndjson.gz')
    with gzip.open(path + '.part', 'wt', encoding='utf-8') as f:
        f.write(json.dumps({'src': url, 'v': VERSION}) + '\n')
        for e in sorted(items, key=lambda e: e['path'].lower()):
            f.write(json.dumps(e, ensure_ascii=False) + '\n')
    os.replace(path + '.part', path)
    return path


def from_zip(z, zpath, url, haystack, data_dir, spec, skip=(), log=print):
    """record the files of the spec's zip as published (legacy.py keeps the original as .orig)"""
    src = z
    if zpath and os.path.exists(zpath + '.orig'):
        try:
            src = zipfile.ZipFile(zpath + '.orig')
        except zipfile.BadZipFile:
            pass
    keep = (tempfile.mkdtemp(), {})
    try:
        items = entries(src, skip, haystack, keep=keep)
        if keep[1]:
            attachdocs.render(items, keep[1], data_dir, spec, log=log)
    finally:
        shutil.rmtree(keep[0], ignore_errors=True)
    write(data_dir, spec, url, items)
    shown = sum(1 for e in items if 'text' in e or 'doc' in e)
    if items:
        log(f'  zip files: {len(items)} ({shown} shown, {sum(1 for e in items if e.get("in_text"))} already in the text, '
            f'{sum(1 for e in items if e.get("binary") or e.get("large"))} listed)')
    return items


def spec_haystack(data_dir, spec):
    """the spec's text as stored (converted, filled or crawled), whitespace removed"""
    parts = []
    for sub in ('sections', 'sections-docx', 'sections-crawled'):
        p = os.path.join(data_dir, 'raw', sub, f'{spec}.ndjson.gz')
        if not os.path.exists(p):
            continue
        for line in gzip.open(p, 'rt', encoding='utf-8'):
            o = json.loads(line)
            if isinstance(o.get('html'), str):
                parts.append(html_haystack([o['html']]))
            elif o.get('c') is not None:
                parts.append(_squash(_rsc_text(o['c'])))
    return ''.join(parts)


def _rsc_text(n):
    if isinstance(n, str):
        return n
    if isinstance(n, list):
        if n and isinstance(n[0], str) and len(n) > 1 and (isinstance(n[1], dict) or n[1] in (0, None)):
            n = n[2:]
        return ''.join(_rsc_text(x) for x in n if not isinstance(x, dict))
    return ''


def main():
    spec, url, data_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    from convert import download, log  # noqa: E402 - scraper/figures
    from legacy import open_spec_zip  # noqa: E402
    cache = os.path.join(data_dir, 'tmp', 'docx')
    os.makedirs(cache, exist_ok=True)
    zpath = os.path.join(cache, os.path.basename(url))
    fetched = False
    if not os.path.exists(zpath):
        blob = download(url)
        if not blob:
            log(f'{spec}: download failed')
            sys.exit(2)
        open(zpath + '.part', 'wb').write(blob)
        os.replace(zpath + '.part', zpath)
        fetched = True
    try:
        z = open_spec_zip(zpath + '.orig' if os.path.exists(zpath + '.orig') else zpath, zpath)
        meta = json.load(open(os.path.join(data_dir, 'raw', 'specs', f'{spec}.json')))
        # 38.101-x: the band combinations are rendered into the clauses when the text came from this zip
        skip = {'bandcombos'} if meta.get('contentUrl') == url else set()
        items = from_zip(z, None, url, spec_haystack(data_dir, spec), data_dir, spec, skip, log=lambda m: log(f'{spec}:{m}'))
        log(f'{spec}: {len(items)} files beside the document in {os.path.basename(url)}')
    finally:
        if fetched:  # not kept, like the fill step's downloads
            os.remove(zpath)


if __name__ == '__main__':
    main()
