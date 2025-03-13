# Use the latest LTS version of Node.js
FROM node:22.14.0-alpine AS builder

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript files
RUN npm run build

# Use a minimal Node.js runtime for the final image
FROM node:22.14.0-alpine AS runner

# Set the working directory
WORKDIR /app

# Copy only the built files and dependencies (NO `src/`)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "dist/index.js"]
