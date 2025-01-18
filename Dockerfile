# Dockerfile (placed in project root)
FROM node:22-alpine

# 1. Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 2. Create working dir
WORKDIR /app

# 3. Copy and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# 4. Copy compiled files only
COPY dist/ ./dist/

# 5. Switch to non-root user
USER appuser

# 6. Expose port if your bot has a webserver (slash commands, etc.)
# EXPOSE 3000

# 7. Start command
CMD ["node", "dist/index.js"]
