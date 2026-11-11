#!/bin/sh
# Container entrypoint: on the first start, download the spec data into /data (scripts/fetch-data.mjs,
# resumable), then run the server as the unprivileged "node" user.
set -e

node /app/scripts/fetch-data.mjs &
pid=$!
# pass `docker compose stop` on to the download instead of waiting for the kill timeout
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit 143' TERM INT
wait "$pid"
trap - TERM INT

if [ "$(id -u)" = "0" ]; then
  exec su-exec node "$@"
fi
exec "$@"
