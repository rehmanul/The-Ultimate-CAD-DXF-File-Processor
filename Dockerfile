# syntax=docker/dockerfile:1

FROM node:22-bullseye AS base
WORKDIR /usr/src/app

FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential g++ pkg-config libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS production-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bullseye AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PYTHON_EXECUTABLE=python3

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libsqlite3-dev python3 python3-pip python3-numpy \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-deps /usr/src/app/node_modules ./node_modules
COPY package*.json ./
COPY public ./public
COPY lib ./lib
COPY scripts ./scripts
COPY server.js ./server.js

RUN mkdir -p models

RUN mkdir -p uploads exports logs && chown -R node:node uploads exports logs

USER node

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:${PORT:-10000}/health || exit 1

CMD ["node", "server.js"]
