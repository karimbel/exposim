# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Étape 1 : build de l'application (Vite + tsc)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server

RUN npm run build

# ---------------------------------------------------------------------------
# Étape 2 : image d'exécution minimale
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-build ./server-build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

USER node

CMD ["node", "server-build/server/index.js"]