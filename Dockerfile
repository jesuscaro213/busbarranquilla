# Dockerfile raíz — usado por Railway para deployar el backend desde el monorepo
# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ .
RUN npm run build

# ── Stage 2: production ──────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
