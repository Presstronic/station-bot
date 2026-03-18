# Build stage — compile TypeScript to dist/
FROM node:22.14.0-alpine AS builder

WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (dev deps needed for tsc)
RUN npm ci

# Copy source and config
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

# Compile TypeScript
RUN npm run build

# Runner stage — production image with compiled output only
FROM node:22.14.0-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output and runtime assets
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# /app/certs is the bind-mount target for the CA cert when SSL is enabled (see docker-compose.ssl.yml)
RUN mkdir -p /app/certs

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
