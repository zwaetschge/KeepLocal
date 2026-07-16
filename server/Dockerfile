FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY --chown=node:node . .

# Uploaded files must be writable by the unprivileged application user.
RUN mkdir -p /app/uploads/images /app/uploads/temp \
    && chown -R node:node /app

USER node

# Expose port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
