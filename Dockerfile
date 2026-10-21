# Use official lightweight Node.js 22 LTS Alpine image
FROM node:22-alpine

WORKDIR /app

# Copy dependency manifests
COPY bot/package*.json ./bot/

# Install production dependencies
WORKDIR /app/bot
RUN npm install

# Copy source code and build
COPY . /app
RUN npm run build

# Expose API port
EXPOSE 8443
EXPOSE 7860
ENV PORT=7860
ENV NODE_ENV=development

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

# Start service
CMD ["node", "dist/index.js"]
