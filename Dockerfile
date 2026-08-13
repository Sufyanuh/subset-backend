# Use Node.js 18 official image
FROM node:18

# Set working directory inside the container
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Prevent Puppeteer from downloading heavy Chromium binaries during build
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the app
COPY . .

# Expose app port
EXPOSE 8118

# Default command
CMD ["npm", "run", "dev"]


