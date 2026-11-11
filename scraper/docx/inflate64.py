"""Deflate64 ("enhanced deflate", zip method 9) - Python's zipfile cannot read it, Windows' zip tool writes it for
large archives (38.903's attachments). Deflate with a 64 KiB window, length code 285 = 3 + 16 extra bits, and
distance codes 30/31. A straightforward canonical-Huffman decoder after zlib's puff.c; slow, meant for the few
members that need it. The caller checks the CRC.
"""

import struct
import zlib

_LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 3]
_LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 16]
_DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097,
          6145, 8193, 12289, 16385, 24577, 32769, 49153]
_DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14]
_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]


class _In:
    def __init__(self, data):
        self.d, self.pos, self.buf, self.cnt = data, 0, 0, 0

    def bits(self, n):
        while self.cnt < n:
            if self.pos >= len(self.d):
                raise ValueError('deflate64: out of input')
            self.buf |= self.d[self.pos] << self.cnt
            self.pos += 1
            self.cnt += 8
        v = self.buf & ((1 << n) - 1)
        self.buf >>= n
        self.cnt -= n
        return v


def _table(lengths):
    counts = [0] * 16
    for n in lengths:
        counts[n] += 1
    counts[0] = 0
    offs = [0] * 16
    for i in range(1, 15):
        offs[i + 1] = offs[i] + counts[i]
    syms = [0] * len(lengths)
    for s, n in enumerate(lengths):
        if n:
            syms[offs[n]] = s
            offs[n] += 1
    return counts, syms


def _decode(src, t):
    counts, syms = t
    code = first = index = 0
    for n in range(1, 16):
        code |= src.bits(1)
        c = counts[n]
        if code - c < first:
            return syms[index + (code - first)]
        index += c
        first = (first + c) << 1
        code <<= 1
    raise ValueError('deflate64: bad code')


_FIXED = None


def _fixed():
    global _FIXED
    if _FIXED is None:
        ll = [8] * 144 + [9] * 112 + [7] * 24 + [8] * 8
        _FIXED = (_table(ll), _table([5] * 32))
    return _FIXED


def inflate64(data, size=None):
    src, out = _In(data), bytearray()
    last = 0
    while not last:
        last = src.bits(1)
        kind = src.bits(2)
        if kind == 0:
            src.buf = src.cnt = 0
            n, nn = struct.unpack('<HH', src.d[src.pos:src.pos + 4])
            if n != (~nn & 0xFFFF):
                raise ValueError('deflate64: bad stored block')
            out += src.d[src.pos + 4:src.pos + 4 + n]
            src.pos += 4 + n
            continue
        if kind == 1:
            lt, dt = _fixed()
        elif kind == 2:
            nlen, ndist, ncode = src.bits(5) + 257, src.bits(5) + 1, src.bits(4) + 4
            cl = [0] * 19
            for i in range(ncode):
                cl[_ORDER[i]] = src.bits(3)
            ct = _table(cl)
            lens = []
            while len(lens) < nlen + ndist:
                s = _decode(src, ct)
                if s < 16:
                    lens.append(s)
                elif s == 16:
                    if not lens:
                        raise ValueError('deflate64: repeat with no length')
                    lens += [lens[-1]] * (3 + src.bits(2))
                elif s == 17:
                    lens += [0] * (3 + src.bits(3))
                else:
                    lens += [0] * (11 + src.bits(7))
            lt, dt = _table(lens[:nlen]), _table(lens[nlen:nlen + ndist])
        else:
            raise ValueError('deflate64: bad block type')
        while True:
            s = _decode(src, lt)
            if s < 256:
                out.append(s)
            elif s == 256:
                break
            else:
                s -= 257
                n = _LBASE[s] + src.bits(_LEXT[s])
                d = _decode(src, dt)
                dist = _DBASE[d] + src.bits(_DEXT[d])
                if dist > len(out):
                    raise ValueError('deflate64: distance too far back')
                start = len(out) - dist
                if dist >= n:
                    out += out[start:start + n]
                else:
                    for i in range(n):
                        out.append(out[start + i])
        if size is not None and len(out) > size:
            raise ValueError('deflate64: more output than the zip says')
    return bytes(out)


def read_member(z, info):
    """the member's bytes when it is Deflate64-compressed (zip method 9), CRC checked; ValueError otherwise"""
    if info.compress_type != 9:
        raise ValueError('not Deflate64')
    fp = z.fp
    fp.seek(info.header_offset)
    head = fp.read(30)
    if head[:4] != b'PK\x03\x04':
        raise ValueError('bad local header')
    n, m = struct.unpack('<HH', head[26:30])
    fp.seek(info.header_offset + 30 + n + m)
    data = inflate64(fp.read(info.compress_size), info.file_size)
    if len(data) != info.file_size or zlib.crc32(data) & 0xFFFFFFFF != info.CRC:
        raise ValueError('Deflate64 member: CRC mismatch')
    return data
