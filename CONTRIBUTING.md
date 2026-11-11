# Contributing

Thanks for helping. The short version:

1. `npm ci && npm run typecheck && npm run build` must pass. CI runs the same.
2. Keep the runtime dependency-free: the server uses only Node built-ins, and the widget only Lit, KaTeX,
   Lucide icons and the bundled fonts.
3. For converter changes (`scraper/docx/`), say which specs you checked before and after. One fix often
   changes many specs.
4. Never commit anything from `data/`. The specification content is © 3GPP Organizational Partners and
   is rebuilt by the pipeline.

The details (dev loop, small test databases, conventions) are in [docs/development.md](docs/development.md).
