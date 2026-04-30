# Use Node.js 18 official image
FROM node:18

# Set working directory inside the container
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app
COPY . .

# Expose app port
EXPOSE 8118

# Default command
CMD ["npm", "run", "dev"]


