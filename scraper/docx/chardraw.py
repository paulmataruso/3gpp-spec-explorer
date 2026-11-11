"""Character drawings and symbol-font characters in a Word document, fixed before pandoc reads it.

GSM-era documents draw message flows, frame formats, whole tables and network diagrams with box
characters (or ASCII "+---+", "---->") in a monospaced font - one paragraph per line, or lines split by
<w:br/> - in style Normal or a table style instead of LD. pandoc collapses their spaces and the reader
shows them as prose. mark_drawings gives the paragraphs of such a drawing style LD, so split.lua makes
them a <pre class="ld"> like the documents that use LD themselves, and turns their tabs into the spaces
up to Word's tab stop (a <pre> would put them every 4 characters).

Symbol, Wingdings and line-draw fonts (MS LineDraw, Terminal) store their characters at U+F020-U+F0FF
when they are typed as text rather than inserted as a <w:sym>: the private-use code means nothing without
the font (the reader showed "T0  148 chips" for "T0 ± 148 chips", "DPCCH" for "ΔDPCCH"). fix_pua maps them
to the Unicode character the font draws there. shared/pua.ts does the same, by context, for itecspec's
text, which has no fonts.
"""

import html
import re

# Adobe Symbol encoding -> Unicode
SYMBOL = {c: chr(c) for c in b' !#%&()+,./0123456789:;<=>?[]_{|}'}
SYMBOL.update(zip(range(0x41, 0x5B), 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'))
SYMBOL.update(zip(range(0x61, 0x7B), 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'))
SYMBOL.update({0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2A: '∗', 0x2D: '−', 0x40: '≅', 0x5C: '∴', 0x5E: '⊥', 0x60: '‾',
               0x7E: '∼', 0xA0: '€', 0xA1: 'ϒ', 0xA2: '′', 0xA3: '≤', 0xA4: '⁄', 0xA5: '∞', 0xA6: 'ƒ', 0xA7: '♣',
               0xA8: '♦', 0xA9: '♥', 0xAA: '♠', 0xAB: '↔', 0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓', 0xB0: '°',
               0xB1: '±', 0xB2: '″', 0xB3: '≥', 0xB4: '×', 0xB5: '∝', 0xB6: '∂', 0xB7: '•', 0xB8: '÷', 0xB9: '≠',
               0xBA: '≡', 0xBB: '≈', 0xBC: '…', 0xBD: '|', 0xBE: '⎯', 0xBF: '↵', 0xC0: 'ℵ', 0xC1: 'ℑ', 0xC2: 'ℜ',
               0xC3: '℘', 0xC4: '⊗', 0xC5: '⊕', 0xC6: '∅', 0xC7: '∩', 0xC8: '∪', 0xC9: '⊃', 0xCA: '⊇', 0xCB: '⊄',
               0xCC: '⊂', 0xCD: '⊆', 0xCE: '∈', 0xCF: '∉', 0xD0: '∠', 0xD1: '∇', 0xD2: '®', 0xD3: '©', 0xD4: '™',
               0xD5: '∏', 0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔', 0xDC: '⇐', 0xDD: '⇑',
               0xDE: '⇒', 0xDF: '⇓', 0xE0: '◊', 0xE1: '〈', 0xE2: '®', 0xE3: '©', 0xE4: '™', 0xE5: '∑', 0xE6: '⎛',
               0xE7: '⎜', 0xE8: '⎝', 0xE9: '⎡', 0xEA: '⎢', 0xEB: '⎣', 0xEC: '⎧', 0xED: '⎨', 0xEE: '⎩', 0xEF: '⎪',
               0xF1: '〉', 0xF2: '∫', 0xF3: '⌠', 0xF4: '⎮', 0xF5: '⌡', 0xF6: '⎞', 0xF7: '⎟', 0xF8: '⎠', 0xF9: '⎤',
               0xFA: '⎥', 0xFB: '⎦', 0xFC: '⎫', 0xFD: '⎬', 0xFE: '⎭'})
WINGDINGS = {0x20: ' ', 0x4A: '☺', 0x6C: '●', 0x6E: '■', 0x71: '❑', 0x75: '◆', 0x9E: '·', 0x9F: '•', 0xA7: '▪',
             0xA8: '◻', 0xD0: '➔', 0xD8: '➢', 0xDF: '←', 0xE0: '→', 0xE1: '↑', 0xE2: '↓', 0xE3: '↖', 0xE4: '↗',
             0xE5: '↙', 0xE6: '↘', 0xE7: '⇦', 0xE8: '⇨', 0xE9: '⇧', 0xEA: '⇩', 0xEF: '⇦', 0xF0: '⇨', 0xF1: '⇧',
             0xF2: '⇩', 0xF3: '⬄', 0xFB: '✗', 0xFC: '✓', 0xFD: '☒', 0xFE: '☑', 0x6F: '□', 0x72: '❒', 0x76: '❖',
             0x77: '⬥', 0xAB: '★'}
# without the font (shared/pua.ts has the same table): Symbol, but for the codes 3GPP documents use from
# Wingdings - bullets, arrows, check marks; ♣, ¬, ◊ hardly ever occur in them
GUESS = dict(SYMBOL)
GUESS.update({c: WINGDINGS[c] for c in (0x9E, 0x9F, 0xA7, 0xD8, 0xE0, 0xF0, 0xFB, 0xFC, 0xFD, 0xFE)})
CP437 = bytes(range(256)).decode('cp437')

_MONO = re.compile(r'(?i)courier|mono|consol|terminal|line ?draw|^modern|letter gothic|prestige|elite|pica|fixedsys|'
                   r'typewriter|lucida console')
_PUA_B = re.compile(rb'\xef(?:\x80[\xa0-\xbf]|[\x81-\x83][\x80-\xbf])')  # U+F020-U+F0FF in UTF-8
_P_RE = re.compile(rb'<w:p[ >].*?</w:p>', re.S)
_R_RE = re.compile(rb'<w:r[ >].*?</w:r>', re.S)
_T_RE = re.compile(rb'(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)')
_RUN_TOK = re.compile(rb'<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:tab\s*/>|<w:br\b[^>]*/>|<w:cr\s*/>')


def font_kind(font):
    f = (font or '').split(';')[0].strip().lower()
    if 'symbol' in f:
        return 'symbol'
    if 'wingding' in f:
        return 'wingdings'
    if _MONO.search(f):
        return 'oem'
    return None


def oem_like(text):
    """a paragraph's private-use characters look like a code page 437 line drawing or text typed in a line-draw
    font: a horizontal line, corners with verticals, or adjacent private-use spaces / letters (one Symbol β here
    and there is no typed word)"""
    corners = verts = spaces = alnum = 0
    prev = -1
    for ch in text:
        u = ord(ch)
        if not 0xF020 <= u <= 0xF0FF:
            spaces = alnum = 0
            prev = -1
            continue
        c = u & 0xFF
        if c in (0xC4, 0xCD) and prev == c:
            return True
        prev = c
        corners += c in _CORNERS
        verts += c in (0xB3, 0xBA)
        spaces = spaces + 1 if c == 0x20 else 0
        alnum = alnum + 1 if (0x30 <= c <= 0x39 or 0x41 <= c <= 0x5A or 0x61 <= c <= 0x7A) else 0
        if spaces >= 3 or alnum >= 4:
            return True
    return bool(corners and verts)


_CORNERS = set(b'\xda\xbf\xc0\xd9\xc9\xbb\xc8\xbc\xc3\xb4\xc2\xc1\xcc\xb9\xcb\xca\xce')


def map_char(c, kind):
    if kind == 'oem':
        return ' ' if c in (0xA0, 0xFF) else CP437[c]
    if kind == 'symbol':
        return SYMBOL.get(c)
    if kind == 'wingdings':
        return WINGDINGS.get(c)
    return GUESS.get(c)


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class Styles:
    """paragraph style -> font and size (half points), through basedOn; document defaults"""

    def __init__(self, xml):
        self.base, self.font, self.sz = {}, {}, {}
        for m in re.finditer(rb'<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>(.*?)</w:style>', xml or b'', re.S):
            sid, body = m.group(1).decode(), m.group(2)
            b = re.search(rb'<w:basedOn w:val="([^"]+)"', body)
            f = re.search(rb'<w:rFonts\b[^>]*w:(?:ascii|hAnsi)="([^"]+)"', body)
            z = re.search(rb'<w:sz w:val="(\d+)"', body)
            self.base[sid] = b and b.group(1).decode()
            self.font[sid] = f and f.group(1).decode()
            self.sz[sid] = z and int(z.group(1))
        d = re.search(rb'<w:docDefaults>(.*?)</w:docDefaults>', xml or b'', re.S)
        f = d and re.search(rb'<w:rFonts\b[^>]*w:(?:ascii|hAnsi)="([^"]+)"', d.group(1))
        z = d and re.search(rb'<w:sz w:val="(\d+)"', d.group(1))
        self.dfont = f.group(1).decode() if f else ''
        self.dsz = int(z.group(1)) if z else 20
        self.has_ld = b'w:styleId="LD"' in (xml or b'')

    def _walk(self, table, sid, default):
        for _ in range(20):
            if not sid:
                break
            if table.get(sid):
                return table[sid]
            sid = self.base.get(sid)
        return default

    def font_of(self, sid):
        return self._walk(self.font, sid, self.dfont)

    def size_of(self, sid):
        return self._walk(self.sz, sid, self.dsz)


def _pstyle(p):
    m = re.search(rb'<w:pStyle w:val="([^"]+)"', p)
    return m.group(1).decode() if m else 'Normal'


def _run_font(r, default):
    m = re.search(rb'<w:rFonts\b[^>]*w:(?:ascii|hAnsi)="([^"]+)"', r)
    return m.group(1).decode() if m else default


def _run_size(r, default):
    m = re.search(rb'<w:sz w:val="(\d+)"', r)
    return int(m.group(1)) if m else default


def _text(p):
    return html.unescape(b''.join(t.group(2) for t in _T_RE.finditer(p)).decode('utf-8', 'replace'))


_SYM = re.compile(rb'<w:sym\b([^>]*)/>')


def fix_sym(doc):
    """<w:sym w:font=".." w:char="F0C4"/> -> the character as text, for every font kind (a line-draw font's
    "MS LineDraw;Symbol" too); unknown fonts are left to convert_docx._sym"""
    def sub(m):
        a = dict(re.findall(rb'w:(font|char)="([^"]*)"', m.group(1)))
        if b'font' not in a or not re.fullmatch(rb'[0-9A-Fa-f]{2,4}', a.get(b'char', b'')):
            return m.group(0)
        kind = font_kind(a[b'font'].decode('utf-8', 'replace'))
        ch = kind and map_char(int(a[b'char'], 16) & 0xFF, kind)
        if not ch:
            return m.group(0)
        return b'<w:t xml:space="preserve">' + _esc(ch).encode('utf-8') + b'</w:t>'

    return _SYM.sub(sub, doc) if b'<w:sym' in doc else doc


def fix_pua(doc, styles):
    """U+F020-U+F0FF characters -> what their font draws (the run's font; by context where it names none)"""
    if not _PUA_B.search(doc):
        return doc

    def para(m):
        p = m.group(0)
        if not _PUA_B.search(p):
            return p
        sfont = styles.font_of(_pstyle(p))
        guess = 'oem' if oem_like(_text(p)) else None

        def run(rm):
            r = rm.group(0)
            if not _PUA_B.search(r):
                return r
            kind = font_kind(_run_font(r, sfont)) or guess

            def sub(t):
                s = html.unescape(t.group(2).decode('utf-8'))
                out = ''.join((map_char(ord(c) & 0xFF, kind) or c) if 0xF020 <= ord(c) <= 0xF0FF else c for c in s)
                return t.group(1) + _esc(out).encode('utf-8') + t.group(3)

            return _T_RE.sub(sub, r)

        return _R_RE.sub(run, p)

    return _P_RE.sub(para, doc)


_H = '─━═▀▄█▌▐░▒▓╌╍┄┅┈┉'
_HRUN = re.compile('[' + _H + ']{2,}')
_CORNER = re.compile('[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬╒╓╕╖╘╙╛╜╞╟╡╢╤╥╧╨╪╫┏┓┗┛┣┫┳┻╋]')
_VERT = re.compile('[│║┃]')
_ART = re.compile(r'-{3,}>|<-{3,}|\+-{2,}\+?|\|[  ]{2,}\||-{2,}\+|={3,}>|<={3,}|\+={2,}\+')
# captions, headings, code, existing drawings; figures, text boxes and formulas are no character drawing
_SKIP = re.compile(rb'<w:pStyle w:val="(?:TH|TF|LD|PL\w*|[Hh]eading\s?\d|H\d|Title|TT)"|<w:drawing|<w:pict|<w:object|'
                   rb'<mc:AlternateContent|<m:oMath')
_SPACEY = re.compile('[  ]{3,}|\t')


def _mono(p, styles):
    sfont = styles.font_of(_pstyle(p))
    seen = False
    for r in _R_RE.finditer(p):
        rr = r.group(0)
        if not b''.join(t.group(2) for t in _T_RE.finditer(rr)).strip() and b'<w:tab' not in rr:
            continue
        if font_kind(_run_font(rr, sfont)) != 'oem':
            return False
        seen = True
    return seen


def _seed(t, mono):
    h = len(_HRUN.findall(t))
    c = len(_CORNER.findall(t))
    v = len(_VERT.findall(t))
    if h and (c or v or h >= 2 or mono):
        return True
    if c >= 2 or (c and v):
        return True
    # vertical bars alone are absolute values in a formula (38.101-1 "│ãt(t,0)│") unless the font is monospaced
    return mono and (v >= 2 or bool(_ART.search(t)))


def _expand(p, styles, settings_tab, shift):
    """a drawing paragraph's tabs -> the spaces up to Word's next tab stop, its indentation -> leading spaces
    (relative to the drawing's least indented paragraph: `shift` twips), box padding "á" -> space"""
    ppr = _ppr(p)
    sid = _pstyle(p)
    psz = styles.size_of(sid)
    ind = _indent(ppr)
    left, first = ind
    stops = sorted(int(v) for v in re.findall(rb'<w:tab w:val="(?!clear)\w+"[^>]*w:pos="(-?\d+)"', ppr))
    box = bool(re.search('[─-▟]', _text(p)))
    state = {'pos': first, 'line_start': True, 'cw': psz * 6}

    def next_stop(pos):
        for s in stops:
            if s > pos:
                return s
        return (pos // settings_tab + 1) * settings_tab

    def lead(at, cw):
        n = max(0, round((at - shift) / cw))
        return ' ' * n

    def run(rm):
        r = rm.group(0)
        cw = _run_size(r, psz) * 6  # a monospaced character is 0.6 em: 6 twips per half point
        state['cw'] = cw
        out, last = [], 0
        for tok in _RUN_TOK.finditer(r):
            out.append(r[last:tok.start()])
            last = tok.end()
            g = tok.group(0)
            if tok.group(1) is not None:
                s = html.unescape(tok.group(1).decode('utf-8', 'replace'))
                if box:
                    s = s.replace('á', ' ')
                pre = ''
                if state['line_start'] and s:
                    pre = lead(state['pos'], cw)
                    state['line_start'] = False
                state['pos'] += len(s) * cw
                out.append(b'<w:t xml:space="preserve">' + _esc(pre + s).encode('utf-8') + b'</w:t>')
            elif g.startswith(b'<w:tab'):
                pre = ''
                if state['line_start']:
                    pre = lead(state['pos'], cw)
                    state['line_start'] = False
                stop = next_stop(state['pos'])
                n = max(1, round((stop - state['pos']) / cw))
                state['pos'] += n * cw
                out.append(b'<w:t xml:space="preserve">' + (pre + ' ' * n).encode() + b'</w:t>')
            else:  # line break: the next line starts at the paragraph's left indent
                out.append(g)
                state['pos'] = left
                state['line_start'] = True
        out.append(r[last:])
        return b''.join(out)

    return _R_RE.sub(run, p)


def _ppr(p):
    m = re.search(rb'<w:pPr>.*?</w:pPr>', p, re.S)
    return m.group(0) if m else b''


def _indent(ppr):
    m = re.search(rb'<w:ind\b([^>]*)/>', ppr)
    if not m:
        return 0, 0
    a = dict((k.decode(), int(v)) for k, v in re.findall(rb'w:(\w+)="(-?\d+)"', m.group(1)))
    left = a.get('left', a.get('start', 0))
    first = left + a.get('firstLine', 0) - a.get('hanging', 0)
    return max(0, left), max(0, first)


def _set_ld(p):
    if re.search(rb'<w:pStyle w:val="[^"]*"\s*/>', p):
        return re.sub(rb'<w:pStyle w:val="[^"]*"\s*/>', b'<w:pStyle w:val="LD"/>', p, count=1)
    if b'<w:pPr>' in p:
        return p.replace(b'<w:pPr>', b'<w:pPr><w:pStyle w:val="LD"/>', 1)
    if re.search(rb'<w:pPr\s*/>', p):
        return re.sub(rb'<w:pPr\s*/>', b'<w:pPr><w:pStyle w:val="LD"/></w:pPr>', p, count=1)
    return re.sub(rb'^(<w:p\b[^>]*>)', rb'\1<w:pPr><w:pStyle w:val="LD"/></w:pPr>', p, count=1)


def mark_drawings(doc, styles, settings=b''):
    """(document.xml, number of paragraphs made LD)"""
    paras = list(_P_RE.finditer(doc))
    if not paras:
        return doc, 0
    info = []
    for m in paras:
        p = m.group(0)
        t = _text(p)
        skip = bool(_SKIP.search(p))
        mono = not skip and _mono(p, styles)
        info.append((t, skip, mono, not skip and _seed(t, mono)))
    mark = [i[3] for i in info]
    seeds = [k for k, i in enumerate(info) if i[3]]
    # the lines between two drawn lines belong to the drawing when they are monospaced, blank or spaced out
    for a, b in zip(seeds, seeds[1:]):
        gap = range(a + 1, b)
        if 0 < len(gap) <= 4 and all(not info[k][1] and (info[k][2] or not info[k][0].strip() or _SPACEY.search(info[k][0]))
                                     for k in gap):
            for k in gap:
                mark[k] = True
    # and so do monospaced, spaced-out lines right above or below one (column headings, "MS    MSC    VLR")
    for k in [k for k, x in enumerate(mark) if x]:
        for j in (k - 1, k + 1):
            if 0 <= j < len(info) and not mark[j]:
                t, skip, mono, _ = info[j]
                if not skip and mono and t.strip() and len(t) < 160 and (_SPACEY.search(t) or b'<w:tab' in paras[j].group(0)):
                    mark[j] = True
    if not any(mark):
        return doc, 0
    m = re.search(rb'<w:defaultTabStop w:val="(\d+)"', settings or b'')
    tab = int(m.group(1)) if m and int(m.group(1)) > 0 else 720
    out, last, n, k = [], 0, 0, 0
    while k < len(paras):
        if not mark[k]:
            k += 1
            continue
        j = k
        while j < len(paras) and mark[j]:
            j += 1
        group = paras[k:j]
        shift = min(_indent(_ppr(g.group(0)))[0] for g in group)
        for g in group:
            out.append(doc[last:g.start()])
            out.append(_set_ld(_expand(g.group(0), styles, tab, shift)))
            last = g.end()
            n += 1
        k = j
    out.append(doc[last:])
    return b''.join(out), n


LD_STYLE = (b'<w:style w:type="paragraph" w:customStyle="1" w:styleId="LD"><w:name w:val="LD"/>'
            b'<w:pPr><w:keepLines/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>')


def add_ld_style(styles_xml):
    if b'w:styleId="LD"' in styles_xml or b'</w:styles>' not in styles_xml:
        return styles_xml
    return styles_xml.replace(b'</w:styles>', LD_STYLE + b'</w:styles>', 1)
