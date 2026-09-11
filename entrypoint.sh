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

# Validate CSRF_SECRET length when explicitly set. The server falls back to
# JWT_SECRET when unset, but a short explicit CSRF_SECRET only fails later at
# request time — every mutation returns 500 while /api/health stays green.
if [ -n "$CSRF_SECRET" ] && [ ${#CSRF_SECRET} -lt 32 ]; then
    echo "ERROR: CSRF_SECRET must be at least 32 characters long!"
    echo "Current length: ${#CSRF_SECRET}"
    echo "Leave it unset to reuse JWT_SECRET, or use: openssl rand -base64 32"
    exit 1
fi
echo "✓ CSRF_SECRET is configured correctly"

# The all-in-one image bakes the Whisper model at build time. Overriding
# WHISPER_MODEL at runtime would force a download at every boot and can leave
# the AI service dead on offline hosts — fail fast with instructions instead.
if [ -n "$BAKED_WHISPER_MODEL" ] && [ -n "$WHISPER_MODEL" ] && [ "$WHISPER_MODEL" != "$BAKED_WHISPER_MODEL" ]; then
    echo "ERROR: WHISPER_MODEL=$WHISPER_MODEL does not match the model baked into this image ($BAKED_WHISPER_MODEL)."
    echo "The model is downloaded during the image build; a runtime change is not supported."
    echo "Rebuild with --build-arg WHISPER_MODEL=$WHISPER_MODEL, or unset the variable to use the baked model."
    exit 1
fi

# Fix MongoDB data directory permissions
echo "Checking /data/db permissions..."
if [ -d "/data/db" ]; then
    if [ "$(stat -c '%U:%G' /data/db)" != "mongodb:mongodb" ]; then
        echo "Setting correct ownership for MongoDB data directory..."
        chown -R mongodb:mongodb /data/db
        chmod -R u=rwX,go= /data/db
    fi
    chmod 700 /data/db
    echo "✓ Permissions fixed"
else
    echo "Creating /data/db directory..."
    mkdir -p /data/db
    chown -R mongodb:mongodb /data/db
    chmod -R u=rwX,go= /data/db
    echo "✓ Directory created with correct permissions"
fi

# Fix log directory permissions
chown -R mongodb:mongodb /var/log/mongodb

# Fix uploads directory permissions
echo "Checking /app/server/uploads permissions..."
if [ -d "/app/server/uploads" ]; then
    if [ "$(stat -c '%U:%G' /app/server/uploads)" != "node:node" ]; then
        echo "Setting correct permissions for uploads directory..."
        chown -R node:node /app/server/uploads
        chmod -R u=rwX,g=rX,o= /app/server/uploads
    fi
    chmod 750 /app/server/uploads
    echo "✓ Permissions fixed"
else
    echo "Creating /app/server/uploads directory..."
    mkdir -p /app/server/uploads/images
    chown -R node:node /app/server/uploads
    chmod -R u=rwX,g=rX,o= /app/server/uploads
    echo "✓ Directory created with correct permissions"
fi

echo "=== Starting Supervisor ==="
echo ""

# Start supervisor (which manages all services)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
