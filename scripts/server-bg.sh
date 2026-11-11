#!/bin/sh
# Run the built server detached (for local testing): scripts/server-bg.sh start|stop|restart|status
# Several instances can run side by side — each PORT gets its own pid/log file:
#   HOST=127.0.0.1 PORT=8745 scripts/server-bg.sh restart   -> data/server-8745.pid / .log
cd "$(dirname "$0")/.." || exit 1
SUFFIX=${PORT:+-$PORT}
PIDFILE=data/server$SUFFIX.pid
LOG=data/server$SUFFIX.log
export PIDFILE
running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
case "$1" in
  start)
    if running; then echo "already running ($(cat "$PIDFILE"))"; exit 0; fi
    # the inner shell records its own pid, then exec keeps that pid for node
    setsid sh -c 'echo $$ >"$PIDFILE"; exec node --disable-warning=ExperimentalWarning dist/server/server.js' >"$LOG" 2>&1 </dev/null &
    sleep 0.3
    echo "started ($(cat "$PIDFILE"))"
    ;;
  stop)
    if running; then
      pid=$(cat "$PIDFILE")
      kill "$pid"
      # wait for the port to be released
      i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
      echo stopped
    fi
    rm -f "$PIDFILE"
    ;;
  restart) "$0" stop; "$0" start ;;
  status) running && echo "running ($(cat "$PIDFILE"))" || echo "not running" ;;
  *) echo "usage: [HOST=… PORT=…] $0 start|stop|restart|status"; exit 1 ;;
esac
