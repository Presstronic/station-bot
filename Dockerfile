# Use the latest LTS version of Node.js
FROM node:22.14.0-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies (builder includes dev deps for type checking)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

# Enforced type-checking step during build
RUN npm run typecheck

# Use a minimal Node.js runtime for the final image
FROM node:22.14.0-alpine AS runner

# Set the working directory
WORKDIR /app

# Install runtime dependencies only
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev

# Copy runtime files
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/migrations ./migrations

# Set environment variables
ENV NODE_ENV=production

# Run the bot from source via tsx
CMD ["node_modules/.bin/tsx", "src/index.ts"]
