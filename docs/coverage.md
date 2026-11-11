# Coverage

What a complete build contains, how gaps in the sources were filled, and what no source has.
The numbers are from the November 2026 build.

## At a glance

| | |
|---|---|
| Spec numbers | **4,500**: all 3GPP TS/TR numbers, series 00–55, GSM phase 1 to Rel-21 |
| Specs with a document | **4,165** |
| Sections | **797,551** (1.44 billion characters of text) |
| Figures | **114,823** files, shown in 186,442 places |
| Character-drawn diagrams | **4,818** in 193 specs |
| Files from the spec zips | **45,778** from 347 specs (test suites, codecs, schemas, spreadsheets) |
| Sections completed from the official `.docx` | **3,346** in 705 specs (where itecspec's rendering was incomplete) |
| Specs newer than itecspec | **599** |

## Where each spec comes from

| Source | Specs |
|---|---|
| itecspec.com, crawled | Most specs. Sections it renders incompletely are completed from the official `.docx`. |
| Official `.docx`, converted with the document's own headings | Conformance specs with > 3,000 sections; ~440 specs whose itecspec TOC repeats ids; specs whose itecspec TOC lacks whole clauses |
| Official archive only | ~1,000 specs itecspec does not publish: GSM phase 1/2 (series 01–12), early UMTS "xx.yyU", withdrawn specs |
| A newer document in the archive | 599 specs where itecspec is one or more versions behind |

Each spec page shows the version its text comes from, the full version history with links to the
official zips, and, for archive-only specs, the 3GPP portal status ("Archive" / "Withdrawn").

Draft versions (0.x–2.x) are listed under the release their spec was first approved in. A spec that
was never approved is listed under the release the 3GPP portal plans it for.

## Gaps in the sources that the pipeline fills

| Gap | Where | What the pipeline does |
|---|---|---|
| Specs missing from itecspec | ~1,000 GSM, early UMTS and withdrawn specs | Converted from the archive. Legacy Word, RTF, WordPerfect, PDF-only and scanned documents are all handled. |
| Outdated text | ~600 specs (23.501: v20.1 on itecspec, v20.3 in the archive) | Converted from the newest archive document |
| Repeated TOC ids | 441 specs (34.123-1 "Initial conditions", 21.905's letter groups) | Converted from the document's own headings |
| Whole clauses missing from the TOC | 23.748 clause 6 (512K characters), 23.783, 38.858, 36.881, 36.579-3 | Converted from the document's own headings |
| Tables and figures nested in table cells dropped | Common in TR solution clauses | Section taken from the official `.docx` |
| Character diagrams with collapsed spaces | ~12,000 LD lines in 136 specs; box/ASCII drawings in 65 GSM specs | Rendered as aligned monospaced blocks |
| Symbol / Wingdings characters shown as blank boxes | ~31,000 characters in 406 specs | Mapped to ≥ ± × β Δ ✓ ▪ etc. None are left in the database. |
| Figures lost in conversion | Pictures inside tracked changes (369 in 45 documents); Strict-format OLE objects (22.839); Word shape drawings and OLE objects without a preview (~1,200 figures) | Recovered and rendered |
| Band-combination tables kept outside the document | 38.101-1/-2/-3 from Rel-20 | Rendered back into their clauses from the JSON files in the zip |
| Specifications shipped as files beside the document | TTCN-3 suites, codec sources, ASN.1/YANG/XSD, tolerance spreadsheets | Shown in a "Files in the TS zip" annex |

## What no source has

These cannot be recovered from 3GPP, ETSI or itecspec:

| What | Why |
|---|---|
| **335 spec numbers without a document** | 293 numbers the 3GPP portal registers with no archive folder: 248 withdrawn before change control, 32 drafts with nothing uploaded, and 13 withdrawn under change control whose documents 3GPP no longer hosts and ETSI does not have. The other 42 are empty archive folders. They are listed as "no document published". |
| **05.50, figures 5–9** | The document links to an Excel chart on its author's own computer and stores no picture of it. |
| **About 40 figures in about 15 GSM-era specs** (08.16, 23.010, 03.40, 29.804, 32.015, 03.32, 08.52, 29.005, 22.971, 21.801, 09.60, 29.004, 51.010-3) | Word 6 embedded pictures saved without a preview image. Neither LibreOffice nor wvWare can draw them; only Microsoft Word can. |
| **23.882's "TBD" figure** | The source document has no figure there. |

## Known gaps

**111 figure references in 42 specs have no figure file.** Half of them are in 36.363 (55), whose metadata
has no archive link for the figure step to download from. The rest are spread thin: 26.813 and 33.833 have 4
each, and most others have 1–3. The reader shows these figures as missing. That is about 0.1% of all
figures, and it is still being investigated.

