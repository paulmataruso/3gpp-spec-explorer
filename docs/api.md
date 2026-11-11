# HTTP API

Every endpoint is `GET` and returns JSON. Paths are relative to the server root, or to `BASE_PATH` when
one is set. Spec numbers are normalised, so `38331`, `TS 38.331` and `38.331` all work.

| Endpoint | Returns |
|---|---|
| [`/api/info`](#apiinfo) | Counts, releases, series, build time |
| [`/api/specs`](#apispecs) | All specs |
| [`/api/specs/:spec`](#apispecsspec) | One spec: metadata, version history, TOC tree |
| [`/api/specs/:spec/sections/:sid`](#apispecsspecsectionssid) | One section: HTML, parents, children, prev/next, citations |
| [`/api/search`](#apisearch) | Ranked full-text results with snippets |
| `/api/search/facets` | Hit counts per spec, series, release and type, for the same parameters |
| [`/api/suggest?q=`](#apisuggest) | Command-palette suggestions |
| [`/api/term?t=&spec=`](#apiterm) | Where a term is described, across specs |
| `/api/terms/:spec` | Abbreviations usable in a spec: its own abbreviations clause plus the TR 21.905 vocabulary |
| `/api/images/:spec/images/:file` | Figures |
| `/api/health` | `{"ok":true,"specs":4500}` |

Errors use the matching HTTP status and a JSON body: `{"error":"Unknown spec 99.999"}`.

## `/api/info`

```json
{
  "builtAt": "2026-11-10T22:02:50.403Z",
  "specs": 4500,
  "specsWithContent": 4165,
  "sections": 797551,
  "textChars": 1435935322,
  "releases": [{ "release": "rel-21", "rel_num": 21, "n": 11 }, { "release": "rel-20", "rel_num": 20, "n": 441 }, "…"],
  "series": [{ "key": "10", "name": "GSM service interworking (pre-Rel-4)", "count": 25 }, "…"],
  "source": "itecspec.com/3gpp + www.3gpp.org/ftp/Specs/archive",
  "archiveOnlySpecs": 1297,
  "sectionsFilledFromDocx": 3346,
  "specsWithZipFiles": 347,
  "zipFiles": 45778
}
```

## `/api/specs`

An array with one entry per spec:

```json
{ "spec": "23.501", "title": "System architecture for the 5G System (5GS); Stage 2", "type": "TS",
  "release": "rel-20", "series": "23", "sections": 1205, "available": 1205,
  "version": "20.3.0", "date": "2026-09-24", "source": "itecspec" }
```

Archive-only specs carry `"source": "archive"` and a portal `status`, such as
`"Withdrawn under change control"`.

## `/api/specs/:spec`

```json
{
  "spec": "23.501",
  "title": "3rd Generation Partnership Project; …; System architecture for the 5G System (5GS); Stage 2",
  "short_title": "System architecture for the 5G System (5GS); Stage 2",
  "tsg": "SA", "type": "TS", "release": "rel-20", "rel_num": 20, "series": "23",
  "section_count": 1205, "available": 1205,
  "latest_version": "20.3.0", "latest_date": "2026-09-24",
  "source": "itecspec", "status": null,
  "versions": [
    { "release": "Rel-20", "version": "20.3.0", "date": "2026-09-24", "size": "8.4 MB",
      "url": "https://www.3gpp.org/ftp/Specs/archive/23_series/23.501/23501-k30.zip" }
  ],
  "toc": [["foreword", "", "Foreword", 1], "…"]
}
```

## `/api/specs/:spec/sections/:sid`

```json
{
  "spec": "23.501", "specTitle": "System architecture for the 5G System (5GS); Stage 2",
  "release": "rel-20", "type": "TS", "version": "20.3.0",
  "sid": "6.2.6", "num": "6.2.6", "title": "NRF",
  "html": "", "hasContent": false, "truncated": false,
  "parents":  [{ "sid": "6", "num": "6", "title": "Network Functions" }, "…"],
  "children": [{ "sid": "6.2.6.1", "num": "6.2.6.1", "title": "General", "hasContent": true, "childCount": 0 }, "…"],
  "prev": { "sid": "6.2.5.1", "num": "6.2.5.1", "title": "Support for CAPIF" },
  "next": { "sid": "6.2.6.1", "num": "6.2.6.1", "title": "General" },
  "refBy": { "total": 16, "items": [{ "spec": "23.501", "sid": "6.3.1", "num": "6.3.1", "title": "General", "…": "…" }] }
}
```

- `?deep=1` also returns every subsection in `parts` (`sid`, `num`, `title`, `depth`, `html`). The output
  stops at about 600,000 characters, and `truncated` is then `true`.
- `refBy` lists the sections, in any spec, that cite this one.
- The HTML is clean and semantic: headings, paragraphs, tables, `<figure>` with `<img>`, code blocks
  (`pre.asn1`, `pre.ld` for character drawings, `pre.file` for files from the zip), and KaTeX for
  equations.

## `/api/search`

| Parameter | |
|---|---|
| `q` | Query, see [search syntax](#search-syntax) |
| `spec`, `series`, `rel`, `type` | Filters (`type` is `TS` or `TR`) |
| `in=title` | Search section titles only |
| `limit`, `offset` | Paging |

```json
{
  "query": { "terms": ["pdu", "session", "establishment"], "phrases": [], "excluded": [], "inTitle": false, "spec": "23.502" },
  "total": 165,
  "hits": [{
    "spec": "23.502", "sid": "4.22.3", "num": "4.22.3",
    "title": "UE Requested PDU Session Establishment with Network Modification to MA PDU Session",
    "specTitle": "Procedures for the 5G System (5GS); Stage 2",
    "release": "rel-20", "type": "TS", "snippet": "…", "score": 33.82
  }],
  "took": 130
}
```

## `/api/suggest`

```json
{
  "specs": [],
  "sections": [
    { "spec": "38.331", "sid": "5.3.3", "num": "5.3.3", "title": "RRC connection establishment",
      "specTitle": "NR; Radio Resource Control (RRC) protocol specification" }
  ]
}
```

## `/api/term`

Where a term is described: its expansion, plus ranked sections grouped per spec. The kinds are
definition, stage 2 services, stage 3 API and section. It works for:

- NF names (`AUSF`, `NRF`);
- interfaces (`Nnrf`);
- services (`Nnrf_NFManagement`);
- operations (`Nnrf_NFManagement_NFRegister`).

```json
{
  "term": "AUSF",
  "expansion": "Authentication Server Function",
  "expansionFrom": "23.501",
  "groups": [{
    "spec": "23.501", "type": "TS", "stage": "Stage 2",
    "title": "System architecture for the 5G System (5GS); Stage 2",
    "hits": [
      { "sid": "6.2.8", "num": "6.2.8", "title": "AUSF", "kind": "definition" },
      { "sid": "7.2.7", "num": "7.2.7", "title": "AUSF Services", "kind": "services" }
    ]
  }, { "spec": "29.509", "stage": "Stage 3", "…": "…" }]
}
```

## Search syntax

| Query | Meaning |
|---|---|
| `RRC reconfiguration` | All the words. Ranked by BM25, with titles weighted ×6. |
| `"measurement gap"` | Exact phrase |
| `handover -conditional` | Leave out a word |
| `beam*` | Prefix |
| `NG-RAN` | A hyphenated word is searched as a phrase: "ng" "ran", adjacent |
| `spec:38.331 T310` | Within one spec (also `TS 38.331 T310`) |
| `series:23 rel:18 type:TS` | Filter by series, release, type |
| `in:title PDU session` | Section titles only |
| `38.331 5.3.3`, `TS 23.501 §5.6` | Jump straight to a section |
