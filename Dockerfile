FROM node:18-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy application sources
COPY . .

# Ensure uploads and exports directories exist
RUN mkdir -p uploads exports logs || true

# Use non-root user for safety
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser || true
RUN chown -R appuser:appgroup /usr/src/app /usr/src/app/uploads /usr/src/app/exports /usr/src/app/logs || true

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
FROM node:18-alpine

WORKDIR /usr/src/app

# Install only production deps in the container for lightweight image
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy app sources
COPY . .

EXPOSE 3001

# Run the app
CMD ["node", "server.js"]
FROM node:18-bullseye

# Install system build tools and sqlite dev libs so better-sqlite3 can build reliably
RUN apt-get update && apt-get install -y python3 build-essential g++ pkg-config libsqlite3-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install only production dependencies in build step
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production

# Copy app source
COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
