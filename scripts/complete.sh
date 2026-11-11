#!/bin/sh
# Completeness pass, after scripts/finish.sh:
#   leftovers -> re-conversions after converter fixes -> archive metadata again -> newest documents of the
#   specs itecspec lags behind on -> every other crawled spec once more from its .docx (build-db takes any
#   section itecspec rendered incompletely from it) -> figures -> database
#
#   setsid sh -c 'echo $$ > data/complete.pid; exec scripts/complete.sh' > data/complete.log 2>&1 < /dev/null &
#
# Resumable: every step skips what is already done.
cd "$(dirname "$0")/.." || exit 1
log() { echo "[$(date -u +%FT%TZ)] $*"; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

log "waiting for scripts/finish.sh"
while alive data/finish.pid; do sleep 60; done
while alive data/fill1.pid; do sleep 60; done

log "leftover .docx conversions (duplicate-id specs, archive-only specs that failed)"
node scraper/docx.ts --parallel 3 >> data/docx.log 2>&1
node scraper/docx.ts --archive --parallel 4 >> data/docx-archive.log 2>&1

log "re-conversions: unreadable parts (Strict OOXML, symbol glyphs) and GSM-era documents without heading styles"
node scraper/docx.ts --redo --parallel 4 >> data/docx-redo.log 2>&1

log "archive-only specs: versions and portal data again (titles, planned release of drafts)"
node scraper/archive.ts --refresh --parallel 4 >> data/archive.log 2>&1
node scraper/docx.ts --archive --parallel 4 >> data/docx-archive.log 2>&1   # new ones (drafts-only numbers)

log "crawled specs whose archive folder has a newer document than itecspec's text"
node scraper/archive.ts --latest --parallel 4 >> data/archive-latest.log 2>&1
node scraper/docx.ts --latest --parallel 5 >> data/docx-latest.log 2>&1

log "official .docx of every other crawled spec (fill)"
node scraper/docx.ts --fill --parallel 5 --first "$(cat data/fill-priority.txt 2>/dev/null)" >> data/docx-fill.log 2>&1

log "figures"
node scraper/figures.ts --parallel 4 --batch 4 --retry >> data/figures.log 2>&1

log "database"
node scraper/build-db.ts >> data/build-db.log 2>&1 && log "done: $(tail -1 data/build-db.log)"
