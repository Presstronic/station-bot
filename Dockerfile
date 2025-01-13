# Dockerfile (placed in project root)
FROM node:18-alpine

# 1. Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 2. Copy and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# 3. Copy source files
COPY . .

# 4. Switch to non-root user
USER appuser

# 5. Expose port if your bot has a webserver (slash commands, etc.)
EXPOSE 3000

# 6. Start command
CMD ["npm", "start"]
