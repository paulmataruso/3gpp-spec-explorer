# Getting started

This repository holds the **code**. The specification text, the figures and the search database are
built on your machine by the [data pipeline](data-pipeline.md), or copied from a machine that has built
them. They are not in the repository: they are large (about 15 GB of working data, a 2 GB database and
7 GB of figures), and the content remains © 3GPP Organizational Partners.

## Requirements

| To | You need |
|---|---|
| Run the app | Node.js **≥ 22.13** (it uses the built-in `node:sqlite`). No npm packages at runtime. |
| Build the web component and server | npm (dev dependencies: Vite, esbuild, TypeScript) |
| Build the data | Docker for the two converter images, about 20 GB of free disk, and network access to `itecspec.com` and `www.3gpp.org` |

## 1. Install and build

```bash
git clone https://github.com/paulmataruso/3gpp-spec-explorer.git
cd 3gpp-spec-explorer
npm ci
npm run build      # dist/web: embed.js, fonts, index.html   dist/server: server.js, index.js
```

## 2. Get the data

The server needs two things under `data/`:

- `data/3gpp.db`: the SQLite database (specs, sections, full-text index, cross-references)
- `data/images/`: the figures

You can get them in one of two ways:

- **Copy them** from a machine that already built them. These two paths are all the server needs.
- **Build them** with the [data pipeline](data-pipeline.md). A complete build takes most of a day. Most of
  that is the crawl, which is limited by the origin server, not by your machine.

### Trying it with a couple of specs first

A small database is the quickest way to see the app working and to check your Docker setup:

```bash
docker build -t spec-explorer-converter:1 docker/converter    # LibreOffice, pandoc, ImageMagick

npm run crawl -- catalog                                       # the spec list (one request)
npm run crawl -- specs    --only 23.501,38.331                 # TOCs and version history
npm run crawl -- sections --only 23.501,38.331                 # section content
npm run figures -- --only 23.501,38.331                        # figures from the official zips
ONLY=23.501,38.331 npm run build:db                            # data/3gpp.db with just these two
```

## 3. Run it

```bash
npm start                     # http://localhost:8080
curl localhost:8080/api/health
```

Or with Docker. This serves `./data` read-only:

```bash
docker compose up --build     # http://localhost:8080
```

The app image is `node:24-alpine` plus about 1 MB of built files. The database and figures are mounted,
not copied, so you can rebuild them without rebuilding the image. The server reopens the database by
itself when the file changes.

## Where next

- Put the reader into your own site: [Embedding the widget](embedding.md)
- Host settings, sub-paths, reverse proxies, Express/Fastify/Koa: [Running the server](server.md)
- Build the full data set: [Building the data](data-pipeline.md)
- Query it from your own tools: [HTTP API](api.md)
