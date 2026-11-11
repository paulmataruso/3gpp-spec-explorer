#!/usr/bin/env bash
# Start/stop the resumable crawler in the background.
#   scripts/crawl-bg.sh start [crawl args...]   e.g. start sections --max-sections 3000 --concurrency 12
#   scripts/crawl-bg.sh stop | status
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=data/crawl.pid
mkdir -p data
case "${1:-status}" in
  start)
    shift
    if [[ -f $PIDFILE ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then echo "already running (pid $(cat $PIDFILE))"; exit 1; fi
    setsid nohup node scraper/crawl.ts "$@" > data/crawl.out 2>&1 < /dev/null &
    echo $! > $PIDFILE
    echo "started pid $(cat $PIDFILE)";;
  stop)
    if [[ -f $PIDFILE ]]; then kill "$(cat $PIDFILE)" 2>/dev/null || true; rm -f $PIDFILE; echo stopped; fi;;
  status)
    if [[ -f $PIDFILE ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then echo "running (pid $(cat $PIDFILE))"; else echo "not running"; fi
    tail -n 2 data/crawl.log 2>/dev/null || true;;
esac
