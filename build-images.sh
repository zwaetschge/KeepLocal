#!/bin/bash

# KeepLocal Docker Image Build Script
# This script builds the Docker images for KeepLocal

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         KeepLocal Docker Image Build Script             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Configuration
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
VERSION="${VERSION:-latest}"
SERVER_IMAGE="${DOCKER_REGISTRY}keeplocal-server:${VERSION}"
CLIENT_IMAGE="${DOCKER_REGISTRY}keeplocal-client:${VERSION}"

echo "Building images with tags:"
echo "  Server: ${SERVER_IMAGE}"
echo "  Client: ${CLIENT_IMAGE}"
echo ""

# Build server image
echo "📦 Building server image..."
docker build -t "${SERVER_IMAGE}" \
    -f server/Dockerfile \
    ./server
echo "✅ Server image built successfully"
echo ""

# Build client image
echo "📦 Building client image..."
docker build -t "${CLIENT_IMAGE}" \
    -f client/Dockerfile \
    ./client
echo "✅ Client image built successfully"
echo ""

echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  Build Complete!                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Images built:"
echo "  - ${SERVER_IMAGE}"
echo "  - ${CLIENT_IMAGE}"
echo ""
echo "To push to Docker Hub (optional):"
echo "  docker push ${SERVER_IMAGE}"
echo "  docker push ${CLIENT_IMAGE}"
echo ""
echo "To run with Docker Compose:"
echo "  docker-compose up -d"
