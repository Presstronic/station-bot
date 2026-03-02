# Use the latest LTS version of Node.js
FROM node:22.14.0-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies (including dev deps because runtime uses tsx)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Optional safety check during build
RUN npm run typecheck

# Use a minimal Node.js runtime for the final image
FROM node:22.14.0-alpine AS runner

# Set the working directory
WORKDIR /app

# Copy runtime files and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/package.json ./

# Set environment variables
ENV NODE_ENV=production

# Run the bot from source via tsx
CMD ["node_modules/.bin/tsx", "src/index.ts"]
