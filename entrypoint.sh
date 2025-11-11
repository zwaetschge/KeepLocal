#!/bin/bash
# KeepLocal Container Entrypoint Script
# Fixes permissions for MongoDB data directory before starting services

set -e

echo "=== KeepLocal Container Starting ==="

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

echo "=== Starting Supervisor ==="
echo ""

# Start supervisor (which manages all services)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
