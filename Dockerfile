# syntax=docker/dockerfile:1

FROM node:22-bullseye AS base
WORKDIR /usr/src/app

FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential g++ pkg-config libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run vite-build

FROM base AS production-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bullseye AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/public ./public
COPY --from=build /usr/src/app/lib ./lib
COPY --from=build /usr/src/app/models ./models
COPY --from=build /usr/src/app/scripts ./scripts
COPY --from=build /usr/src/app/server.js ./server.js
COPY --from=build /usr/src/app/training-data.json ./training-data.json
COPY --from=build /usr/src/app/PRODUCTION_VERIFICATION.md ./PRODUCTION_VERIFICATION.md
COPY --from=build /usr/src/app/PROJECT_STATUS.md ./PROJECT_STATUS.md
COPY --from=build /usr/src/app/README.md ./README.md
COPY --from=build /usr/src/app/render.yaml ./render.yaml

RUN mkdir -p uploads exports logs && chown -R node:node uploads exports logs

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "server.js"]
