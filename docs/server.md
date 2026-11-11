# Running the server

The server is plain Node with no runtime npm dependencies. It uses the built-in `node:sqlite`. One
process serves:

- the API (`/api/…`);
- the figures;
- the widget bundle and its standalone page.

## Standalone

```bash
npm run build
node dist/server/server.js          # or: npm start
```

To run it detached, with a pidfile and a log under `data/`:

```bash
scripts/server-bg.sh start          # stop | restart | status   → data/server.pid, data/server.log
PORT=8745 HOST=127.0.0.1 scripts/server-bg.sh restart   # a second instance → data/server-8745.pid / .log
```

Each `PORT` gets its own pidfile, so restart an instance with the same `PORT` setting it was started
with.

## Configuration

| Env | Default | |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DB_PATH` | `data/3gpp.db` | The SQLite database from `npm run build:db` |
| `IMAGES_DIR` | `data/images` | Figures from `npm run figures` / `npm run docx` |
| `STATIC_DIR` | `dist/web` | Widget bundle. Set it to an empty string to serve only the API. |
| `BASE_PATH` | (empty) | Mounts everything under a sub-path, e.g. `/3gpp` |
| `CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for the API |
| `LOG_REQUESTS` | off | `1` logs every request with its timing |

How it serves:

- **Compression and caching.** Responses are Brotli- or gzip-compressed and carry ETags. Static files are
  cached in memory after the first request, and hashed assets are served as immutable.
- **Deep links.** HTML navigations that are not a real file (`/spec/38.331/5.3.3`) fall back to
  `index.html` for `history` routing.
- **Database changes.** The server reopens the database by itself when the file changes, so a rebuild
  needs no restart.

## Docker

```bash
docker compose build && docker compose up -d     # http://localhost:8080, ./data mounted at /data
```

The image is `node:24-alpine` plus the built files.

- **First start.** The entrypoint (`docker/entrypoint.sh`) runs `scripts/fetch-data.mjs` as root. It
  downloads the data release named in `data-bundle.json` into `/data`, unless that folder already holds
  data. The server then runs as the unprivileged `node` user. See
  [Getting started](getting-started.md#what-happens-on-the-first-start).
- **Health check.** The container checks `/api/health`, with a start period long enough for the first
  download.
- **Settings.** The `docker-compose.yml` settings are:

| Setting | Default | |
|---|---|---|
| `SPEC_EXPLORER_PORT` (host env) | `8080` | Host port |
| `BASE_PATH` | (empty) | Sub-path behind a reverse proxy |
| `CORS_ORIGIN` | `*` | Allowed origin for the API |
| `DATA_DOWNLOAD` | `auto` | `off`: never download, serve only what is in `./data` |

## Behind a reverse proxy

Under a sub-path, set `BASE_PATH` and forward the path unchanged:

```nginx
# BASE_PATH=/3gpp
location /3gpp/ {
    proxy_pass http://127.0.0.1:8080;      # no trailing URI: /3gpp/... is passed through as-is
    proxy_set_header Host $host;
}
```

```caddy
example.com {
    handle /3gpp/* {
        reverse_proxy 127.0.0.1:8080
    }
}
```

## Inside your own Node app

`dist/server/index.js` exports a handler with the signature `(req, res, next?)` that works with any
framework:

```js
import express from 'express';
import { createHandler } from './dist/server/index.js';

const app = express();
app.use(createHandler({
  dbPath: '/srv/3gpp/3gpp.db',
  imagesDir: '/srv/3gpp/images',
  staticDir: '/srv/3gpp/web',   // omit to serve only the API
  basePath: '/3gpp',
  corsOrigin: 'https://example.com',
}));
app.listen(3000);
```

It also works with:

- plain `http.createServer(handler)`;
- Fastify, via `fastify.use` and `@fastify/middie`;
- Koa, via `koa-connect`.

Requests the handler does not own are passed to `next()`. If there is no `next`, they get a 404.
