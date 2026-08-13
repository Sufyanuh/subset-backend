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
RUN npm install

# Copy the rest of the app
COPY . .

# Expose app port (matching PORT=8116 in .env)
EXPOSE 8116

# Default command
CMD ["npm", "run", "dev"]


