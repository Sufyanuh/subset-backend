# Use Node.js 18 official image
FROM node:18

# Install system dependencies & Chromium for Puppeteer on Linux Docker
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt-get/lists/*

# Prevent Puppeteer from downloading heavy Chromium binaries during build
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Set working directory inside the container
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the app
COPY . .

# Expose app port (matching PORT=8116 in .env)
EXPOSE 8116

# Default command
CMD ["npm", "run", "dev"]


