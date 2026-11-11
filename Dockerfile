# 3GPP Spec Explorer: `docker compose build && docker compose up -d`
# The spec data is not in the image: the first start downloads it into the mounted /data (./data), see
# scripts/fetch-data.mjs. Your own build of the data in ./data is used as is.

# ---- build: web component + bundled server ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN npm run build

# ---- runtime: zero npm dependencies, just Node + the built files ----
FROM node:24-alpine
# su-exec: the entrypoint downloads the data as root, then runs the server as "node"
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/data/3gpp.db \
    IMAGES_DIR=/data/images \
    STATIC_DIR=/app/dist/web \
    BASE_PATH="" \
    CORS_ORIGIN="*" \
    DATA_BUNDLE=/app/data-bundle.json \
    DATA_DOWNLOAD=auto
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json data-bundle.json ./
COPY scripts/fetch-data.mjs ./scripts/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/spec-explorer-entrypoint
EXPOSE 8080
VOLUME ["/data"]
# the long start period covers the first start's download
HEALTHCHECK --interval=30s --timeout=3s --start-period=3h CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/api/health" || exit 1
ENTRYPOINT ["spec-explorer-entrypoint"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/server.js"]
