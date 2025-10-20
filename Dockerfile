FROM node:18-bullseye

# Install build dependencies needed by native modules (e.g., better-sqlite3)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential g++ pkg-config libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy application source
COPY . .

# Prepare writable directories
RUN mkdir -p uploads exports logs && chown -R node:node uploads exports logs

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
