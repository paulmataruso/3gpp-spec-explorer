# Development

## Scripts

| Command | |
|---|---|
| `npm run dev` | API server from source with `--watch` (port 8080) |
| `npm run dev:web` | Vite dev server for the widget, with hot reload. It proxies `/api` to `localhost:8080`. |
| `npm run build` | `build:web` (Vite library build → `dist/web`) + `build:server` (esbuild → `dist/server`) |
| `npm run typecheck` | `tsc --noEmit` over `scraper/`, `server/`, `shared/` and `web/` |
| `npm start` | The built server |
| `npm run crawl` / `docx` / `figures` / `build:db` | Pipeline steps, see [Building the data](data-pipeline.md) |

TypeScript runs natively in Node ≥ 22.13: the scraper, the server in dev mode and the build scripts are
all run straight from `.ts`, with no compile step. The code therefore uses only erasable syntax:
`erasableSyntaxOnly`, `verbatimModuleSyntax`, and `.ts` extensions in imports.

## Dev loop

```bash
npm run dev          # terminal 1: API on :8080 (needs data/3gpp.db)
npm run dev:web      # terminal 2: widget with hot reload, open the URL Vite prints
```

## Trying a change on a small database

Changes to rendering (`shared/render.ts`, `shared/pua.ts`) or to the database build only need a rebuild of
the specs you care about:

```bash
ONLY=04.08dcs,23.501,25.214 DB_PATH=/tmp/t.db node scraper/build-db.ts
DB_PATH=/tmp/t.db PORT=8799 node dist/server/server.js
```

Changes to the document converter (`scraper/docx/*.py`, `split.lua`) need a re-conversion of the affected
specs first:

```bash
npm run docx -- --only 04.08 --force               # specs converted from the .docx
npm run docx -- --fill --only 25.214 --force       # crawled specs: always --fill
npm run docx -- --redo                             # every spec listed in data/redo.txt
npm run docx -- --latest --dry                     # preview what a mode would do
```

## Conventions

- **Every pipeline step is resumable.** It skips what is already done. Give long jobs a pidfile, so they
  can be stopped and waited on:

  ```bash
  setsid sh -c 'echo $$ > data/job.pid; exec node scraper/docx.ts --fill' > data/job.log 2>&1 < /dev/null &
  ```

- **Stop jobs by pid.** Use `kill "$(cat data/job.pid)"`, not `pkill -f <pattern>`. A pattern can also
  match the shell that runs the command.
- **The Python converter scripts run inside the Docker images** (`docker/converter`, `docker/legacy`).
  Each one runs in a throwaway container (`docker run --rm`), with the code mounted read-only. Downloaded
  documents are only ever opened there.
- **Raw data formats** are gzipped NDJSON, one file per spec, under `data/raw/`:
  - `sections/` holds the text in use;
  - `sections-crawled/` keeps the crawled text of specs that were later converted;
  - `sections-docx/` holds the completeness-fill output;
  - `attachments/` holds the files from the zips.
- **Rendered HTML is final at build time.** The server never parses or rewrites section HTML. A
  rendering change therefore needs `npm run build:db`.

## Checks worth running after converter changes

- **Unmapped symbol characters.** No section HTML should contain U+F020–U+F0FF. Decompress `sections.html`
  and search for `[-]`.
- **Fill ratio per spec.** `node scraper/fill-check.ts <spec>` lists the sections the fill would replace
  and why.
- **Figure captions with nothing above them** point to a figure lost in conversion.
- **Runs of blank lines inside `<pre>`** point to an emptied code listing.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- `npm ci`
- the typecheck
- the full build
- a syntax check of the Python converter scripts

## Contributing

Issues and pull requests are welcome. Please:

1. Keep the runtime dependency-free: the server uses only Node built-ins, and the widget only Lit,
   KaTeX, Lucide icons and the bundled fonts.
2. Run `npm run typecheck` and `npm run build` before opening a PR.
3. For converter changes, name the specs you checked (before/after). A conversion fix for one spec
   often changes many others.
4. Do not commit anything from `data/`. The specification content is © 3GPP Organizational Partners and
   is rebuilt by the pipeline.
