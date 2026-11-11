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
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/data/3gpp.db \
    IMAGES_DIR=/data/images \
    STATIC_DIR=/app/dist/web \
    BASE_PATH="" \
    CORS_ORIGIN="*"
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/api/health" || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/server.js"]
