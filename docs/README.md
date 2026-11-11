# 3GPP Spec Explorer documentation

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Requirements, install, a first run with a few specs, Docker |
| [Building the data](data-pipeline.md) | The pipeline that turns itecspec.com and the official 3GPP archive into `data/3gpp.db` + `data/images/` |
| [Coverage](coverage.md) | What the database contains, how gaps in the sources were filled, and what no source has |
| [Embedding the widget](embedding.md) | `<spec-explorer>` attributes, routing modes, methods, events, theming, frameworks |
| [Running the server](server.md) | Standalone server, configuration, Docker, reverse proxies, mounting inside your own Node app |
| [HTTP API](api.md) | Every endpoint with example responses, and the search query syntax |
| [Architecture](architecture.md) | How the pieces fit: project layout, rendering, database schema, search, web component |
| [Development](development.md) | Dev loop, scripts, testing changes on a small database, conventions, CI |

New here? Start with [Getting started](getting-started.md).
