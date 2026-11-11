# Getting started

## With Docker (recommended)

You need Docker (with Compose) and about 10 GB of free disk.

```bash
git clone https://github.com/paulmataruso/3gpp-spec-explorer.git
cd 3gpp-spec-explorer
docker compose build && docker compose up -d
```

Open **http://localhost:8080**.

### What happens on the first start

The repository holds the code. The spec data, meaning the database with every spec and section plus the
figures, is published as a [GitHub release](https://github.com/paulmataruso/3gpp-spec-explorer/releases) of
this repository, because GitHub does not accept files this large in git. `data-bundle.json` names the release
the code expects.

On the first start, the container's entrypoint (`scripts/fetch-data.mjs`) does the following:

1. Downloads the release files into `./data`: the database (zstd-compressed) and the figures in three
   archives, about 6.7 GB in total. Downloads resume after an interruption.
2. Checks every file's size and SHA-256.
3. Unpacks each file, then deletes it. About 7.5 GB stays in `./data`.
4. Starts the server.

Until then, http://localhost:8080 shows a progress page, and that page becomes the app when the download is
done. To follow it in the terminal:

```bash
docker compose logs -f
```

Later starts find the data in `./data` and start at once.

### Everyday use

| | |
|---|---|
| Stop / start | `docker compose down` / `docker compose up -d` (the data stays in `./data`) |
| Another port | `SPEC_EXPLORER_PORT=9000 docker compose up -d` |
| Update | `git pull && docker compose build && docker compose up -d`. If `data-bundle.json` names a newer release, the new data replaces the old on the next start. |
| Your own data | Put your own `3gpp.db` and `images/` in `./data`. Data the container did not download is never touched. |
| Never download | Set `DATA_DOWNLOAD: "off"` in `docker-compose.yml` |
| Sub-path, CORS | `BASE_PATH`, `CORS_ORIGIN` in `docker-compose.yml`, see [Running the server](server.md) |

## Without Docker

You need Node.js **≥ 22.13**, which provides the built-in `node:sqlite`.

```bash
git clone https://github.com/paulmataruso/3gpp-spec-explorer.git
cd 3gpp-spec-explorer
npm ci
npm run build      # dist/web: embed.js, fonts, index.html   dist/server: server.js, index.js
```

The server needs `data/3gpp.db` and `data/images/`. The easiest way to get them is to let Docker download
them once (above), or to download the files of the
[latest data release](https://github.com/paulmataruso/3gpp-spec-explorer/releases) by hand and unpack them:

```bash
cd data
cat 3gpp.db.zst.* | zstd -d -o 3gpp.db
mkdir -p images && for f in images.*.tar; do tar -xf "$f" -C images; done
cd ..
npm start          # http://localhost:8080
```

### Building the data yourself

To build the data from the sources instead, use the [data pipeline](data-pipeline.md). A complete build takes
most of a day, mostly for the crawl.

To try the pipeline on a couple of specs first:

```bash
docker build -t spec-explorer-converter:1 docker/converter    # LibreOffice, pandoc, ImageMagick

npm run crawl -- catalog                                       # the spec list (one request)
npm run crawl -- specs    --only 23.501,38.331                 # TOCs and version history
npm run crawl -- sections --only 23.501,38.331                 # section content
npm run figures -- --only 23.501,38.331                        # figures from the official zips
ONLY=23.501,38.331 npm run build:db                            # data/3gpp.db with just these two
```

## Where next

- Put the reader into your own site: [Embedding the widget](embedding.md)
- Host settings, sub-paths, reverse proxies, Express/Fastify/Koa: [Running the server](server.md)
- Build or update the data: [Building the data](data-pipeline.md)
- Query it from your own tools: [HTTP API](api.md)
