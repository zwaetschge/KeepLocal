#!/bin/bash

# KeepLocal All-in-One Docker Image Build Script
# This script builds the all-in-one Docker image for KeepLocal (Unraid)

set -e

echo "╔══════════════════════════════════════════════════════════╗"
echo "║    KeepLocal All-in-One Docker Image Build Script       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Configuration
DOCKER_USERNAME="${DOCKER_USERNAME:-valentin2177}"
IMAGE_NAME="${IMAGE_NAME:-keeplocal}"
VERSION="${VERSION:-latest}"
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"

# Optional: Build argument for API URL
REACT_APP_API_URL="${REACT_APP_API_URL:-/api}"

echo "Build Configuration:"
echo "  Docker Username: ${DOCKER_USERNAME}"
echo "  Image Name:      ${IMAGE_NAME}"
echo "  Version Tag:     ${VERSION}"
echo "  Full Image:      ${FULL_IMAGE}"
echo "  API URL:         ${REACT_APP_API_URL}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Dockerfile exists
if [ ! -f "Dockerfile.allinone" ]; then
    echo "❌ Error: Dockerfile.allinone not found"
    echo "Please run this script from the KeepLocal root directory"
    exit 1
fi

# Build the image
echo "📦 Building all-in-one Docker image..."
echo ""
docker build \
    -f Dockerfile.allinone \
    -t "${FULL_IMAGE}" \
    --build-arg REACT_APP_API_URL="${REACT_APP_API_URL}" \
    .

if [ $? -eq 0 ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║                  Build Complete! ✅                       ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    echo "Image built successfully: ${FULL_IMAGE}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Test the image locally:"
    echo "   docker run -d \\"
    echo "     --name keeplocal-test \\"
    echo "     -p 3000:80 \\"
    echo "     -e JWT_SECRET=\"\$(openssl rand -base64 32)\" \\"
    echo "     -v keeplocal-data:/data/db \\"
    echo "     ${FULL_IMAGE}"
    echo ""
    echo "   Then open http://localhost:3000 in your browser"
    echo ""
    echo "2. Push to Docker Hub (requires login):"
    echo "   docker login"
    echo "   docker push ${FULL_IMAGE}"
    echo ""
    echo "3. Stop and remove test container:"
    echo "   docker stop keeplocal-test"
    echo "   docker rm keeplocal-test"
    echo ""
else
    echo "❌ Build failed!"
    exit 1
fi
