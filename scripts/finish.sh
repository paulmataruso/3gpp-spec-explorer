#!/bin/sh
# Finish the data pipeline unattended:
#   wait for the section crawl -> one retry pass -> archive-only specs -> .docx conversions -> figures -> database
#
#   setsid nohup scripts/finish.sh > data/finish.log 2>&1 < /dev/null &
#
# Every step is resumable, so running this again only does what is still missing.
cd "$(dirname "$0")/.." || exit 1
log() { echo "[$(date -u +%FT%TZ)] $*"; }

busy() { pgrep -f "$1" >/dev/null 2>&1; }

log "waiting for the section crawl"
while scripts/crawl-bg.sh status | grep -q '^running'; do sleep 60; done

log "retry pass for sections that failed or are missing"
node scraper/crawl.ts sections --max-sections 3000 --concurrency 12 --spec-parallel 6 >> data/crawl.out 2>&1

log "specs only the official archive has: versions + portal metadata"
node scraper/archive.ts --parallel 4 >> data/archive.log 2>&1

log "waiting for other docx / figure runs to finish"
while busy "scraper/docx.ts" || busy "scraper/figures.ts"; do sleep 60; done

# huge specs + specs whose itecspec TOC repeats ids (heading discovery), and the archive-only specs, side by side
log "official .docx: huge / duplicate-id specs and archive-only specs"
node scraper/docx.ts --parallel 3 >> data/docx.log 2>&1 &
node scraper/docx.ts --archive --parallel 5 >> data/docx-archive.log 2>&1 &
wait

log "specs with OpenAPI definitions from the official .docx (exact YAML)"
node scraper/docx.ts --openapi --parallel 3 >> data/docx.log 2>&1

log "figures"
node scraper/figures.ts --parallel 4 --batch 4 --retry >> data/figures.log 2>&1

log "database"
node scraper/build-db.ts >> data/build-db.log 2>&1 && log "done: $(tail -1 data/build-db.log)"
