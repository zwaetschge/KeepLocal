#!/bin/bash
# KeepLocal Container Entrypoint Script
# Fixes permissions for MongoDB data directory before starting services

set -e

echo "=== KeepLocal Container Starting ==="

# Validate JWT_SECRET is set and secure
echo "Checking JWT_SECRET configuration..."
if [ -z "$JWT_SECRET" ]; then
    echo "ERROR: JWT_SECRET environment variable is not set!"
    echo "Please set a secure JWT_SECRET (minimum 32 characters)."
    echo "Example: docker run -e JWT_SECRET=\$(openssl rand -base64 32) ..."
    exit 1
fi

if [ ${#JWT_SECRET} -lt 32 ]; then
    echo "ERROR: JWT_SECRET must be at least 32 characters long!"
    echo "Current length: ${#JWT_SECRET}"
    echo "Please use a stronger secret. Example: openssl rand -base64 32"
    exit 1
fi
echo "✓ JWT_SECRET is configured correctly"

# Fix MongoDB data directory permissions
echo "Checking /data/db permissions..."
if [ -d "/data/db" ]; then
    echo "Setting correct ownership for MongoDB data directory..."
    chown -R mongodb:mongodb /data/db
    chmod -R 755 /data/db
    echo "✓ Permissions fixed"
else
    echo "Creating /data/db directory..."
    mkdir -p /data/db
    chown -R mongodb:mongodb /data/db
    chmod -R 755 /data/db
    echo "✓ Directory created with correct permissions"
fi

# Fix log directory permissions
chown -R mongodb:mongodb /var/log/mongodb

# Fix uploads directory permissions
echo "Checking /app/server/uploads permissions..."
if [ -d "/app/server/uploads" ]; then
    echo "Setting correct permissions for uploads directory..."
    chown -R node:node /app/server/uploads
    chmod -R 755 /app/server/uploads
    echo "✓ Permissions fixed"
else
    echo "Creating /app/server/uploads directory..."
    mkdir -p /app/server/uploads/images
    chown -R node:node /app/server/uploads
    chmod -R 755 /app/server/uploads
    echo "✓ Directory created with correct permissions"
fi

# Ensure node user has access to server directory
chown -R node:node /app/server
chmod -R 755 /app/server

echo "=== Starting Supervisor ==="
echo ""

# Start supervisor (which manages all services)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
