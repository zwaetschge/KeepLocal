# Docker Build & Publish Guide

This guide explains how to build and publish the KeepLocal Docker images.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building Images](#building-images)
  - [All-in-One Image (Recommended for Unraid)](#all-in-one-image-recommended-for-unraid)
  - [Separate Images (For Docker Compose)](#separate-images-for-docker-compose)
- [Testing Locally](#testing-locally)
- [Publishing to Docker Hub](#publishing-to-docker-hub)
- [Automated Builds with GitHub Actions](#automated-builds-with-github-actions)
- [Troubleshooting](#troubleshooting)

## Prerequisites

1. **Docker installed** (version 20.10 or later)
   ```bash
   docker --version
   ```

2. **Docker Hub account** (for publishing)
   - Sign up at https://hub.docker.com

3. **Git repository cloned**
   ```bash
   git clone https://github.com/zwaetschge/KeepLocal.git
   cd KeepLocal
   ```

## Building Images

### All-in-One Image (Recommended for Unraid)

The all-in-one image combines MongoDB, Node.js backend, and React frontend into a single container.

#### Using the Build Script (Recommended)

```bash
# Make the script executable
chmod +x build-allinone.sh

# Build with default settings (zwaetschge/keeplocal:latest)
./build-allinone.sh

# Build with custom settings
DOCKER_USERNAME=yourusername VERSION=v1.0.0 ./build-allinone.sh
```

#### Manual Build

```bash
docker build \
  -f Dockerfile.allinone \
  -t zwaetschge/keeplocal:latest \
  --build-arg REACT_APP_API_URL=/api \
  .
```

**Build Arguments:**
- `REACT_APP_API_URL`: API endpoint for the React frontend (default: `/api`)

**Size Optimization:**
The all-in-one image uses multi-stage builds to minimize size:
- Build stages are discarded after copying artifacts
- Only production dependencies are included
- Final image size: ~500-600 MB (including MongoDB)

### Separate Images (For Docker Compose)

If you prefer to run services separately with docker-compose:

#### Using the Build Script

```bash
# Make the script executable
chmod +x build-images.sh

# Build with default settings
./build-images.sh

# Build with custom settings
DOCKER_REGISTRY=yourusername/ VERSION=v1.0.0 ./build-images.sh
```

#### Manual Build

```bash
# Build server image
docker build -t keeplocal-server:latest -f server/Dockerfile ./server

# Build client image
docker build -t keeplocal-client:latest -f client/Dockerfile ./client
```

## Testing Locally

### Testing All-in-One Image

1. **Generate a JWT secret:**
   ```bash
   JWT_SECRET=$(openssl rand -base64 32)
   echo "Generated JWT_SECRET: $JWT_SECRET"
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name keeplocal-test \
     -p 3000:80 \
     -e JWT_SECRET="$JWT_SECRET" \
     -e ALLOWED_ORIGINS="http://localhost:3000" \
     -e NODE_ENV="production" \
     -v keeplocal-test-data:/data/db \
     zwaetschge/keeplocal:latest
   ```

3. **Wait for services to start (~30 seconds):**
   ```bash
   docker logs -f keeplocal-test
   ```

   Look for these messages:
   ```
   MongoDB started successfully
   Server running on port 5000
   Nginx started
   ```

4. **Test the application:**
   - Open browser: http://localhost:3000
   - Register a new account
   - Create some notes
   - Test features (colors, pins, search, etc.)

5. **Check health:**
   ```bash
   curl http://localhost:3000/api/health
   ```

6. **View logs:**
   ```bash
   # All logs
   docker logs keeplocal-test

   # Follow logs
   docker logs -f keeplocal-test

   # Last 100 lines
   docker logs --tail 100 keeplocal-test
   ```

7. **Cleanup:**
   ```bash
   docker stop keeplocal-test
   docker rm keeplocal-test
   docker volume rm keeplocal-test-data
   ```

### Testing Separate Images with Docker Compose

1. **Start services:**
   ```bash
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Test at http://localhost:3000**

4. **Cleanup:**
   ```bash
   docker-compose down -v
   ```

## Publishing to Docker Hub

### One-Time Setup

1. **Login to Docker Hub:**
   ```bash
   docker login
   ```
   Enter your Docker Hub username and password.

2. **Verify login:**
   ```bash
   docker info | grep Username
   ```

### Publishing All-in-One Image

```bash
# Tag the image (if not already tagged correctly)
docker tag keeplocal:latest zwaetschge/keeplocal:latest

# Optional: Create version tag
docker tag zwaetschge/keeplocal:latest zwaetschge/keeplocal:v1.0.0

# Push to Docker Hub
docker push zwaetschge/keeplocal:latest

# Optional: Push version tag
docker push zwaetschge/keeplocal:v1.0.0
```

### Publishing Separate Images

```bash
# Tag images
docker tag keeplocal-server:latest zwaetschge/keeplocal-server:latest
docker tag keeplocal-client:latest zwaetschge/keeplocal-client:latest

# Push to Docker Hub
docker push zwaetschge/keeplocal-server:latest
docker push zwaetschge/keeplocal-client:latest
```

### Multi-Architecture Builds (Advanced)

To build for multiple architectures (amd64, arm64):

```bash
# Create buildx builder (one-time setup)
docker buildx create --name keeplocal-builder --use
docker buildx inspect --bootstrap

# Build and push multi-arch image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f Dockerfile.allinone \
  -t zwaetschge/keeplocal:latest \
  --build-arg REACT_APP_API_URL=/api \
  --push \
  .
```

## Automated Builds with GitHub Actions

GitHub Actions can automatically build and push Docker images when you push to the repository.

### Setup

1. **Add Docker Hub credentials to GitHub Secrets:**
   - Go to your GitHub repository
   - Settings → Secrets and variables → Actions
   - Add secrets:
     - `DOCKERHUB_USERNAME`: Your Docker Hub username
     - `DOCKERHUB_TOKEN`: Your Docker Hub access token
       (Create at https://hub.docker.com/settings/security)

2. **The workflow is already configured** in `.github/workflows/docker-build.yml`

### Workflow Triggers

The workflow automatically builds and publishes:

- **On push to `main` branch** → Tags: `latest`, `YYYY-MM-DD-SHA`
- **On git tags** (e.g., `v1.0.0`) → Tags: `v1.0.0`, `latest`
- **Manual trigger** → Custom version tag

### Manual Workflow Trigger

1. Go to **Actions** tab on GitHub
2. Select **Docker Build and Push** workflow
3. Click **Run workflow**
4. Choose branch and version
5. Click **Run workflow**

### Monitoring Builds

- View progress in the **Actions** tab
- Check Docker Hub for published images: https://hub.docker.com/r/zwaetschge/keeplocal

## Troubleshooting

### Build Fails with "No space left on device"

```bash
# Clean up Docker system
docker system prune -a --volumes

# Remove unused images
docker image prune -a
```

### Build is Very Slow

```bash
# Check if you're using BuildKit (recommended)
export DOCKER_BUILDKIT=1

# Build with BuildKit
docker build -f Dockerfile.allinone -t keeplocal:latest .
```

### "Cannot connect to Docker daemon"

```bash
# Check Docker service status
sudo systemctl status docker

# Start Docker service
sudo systemctl start docker

# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Log out and log back in
```

### Image Build Fails During npm install

```bash
# Clear Docker build cache
docker builder prune -a

# Rebuild without cache
docker build --no-cache -f Dockerfile.allinone -t keeplocal:latest .
```

### "denied: requested access to the resource is denied"

```bash
# Make sure you're logged in
docker login

# Verify the image tag matches your username
docker tag keeplocal:latest yourusername/keeplocal:latest
docker push yourusername/keeplocal:latest
```

### Container Starts but WebUI is Inaccessible

```bash
# Check container logs
docker logs keeplocal-test

# Check if port is already in use
sudo netstat -tlnp | grep 3000

# Try a different port
docker run -d --name keeplocal-test -p 8080:80 ... keeplocal:latest
```

### MongoDB fails to start in container

```bash
# Check permissions of MongoDB data volume
docker exec keeplocal-test ls -la /data/db

# If needed, fix permissions
docker exec keeplocal-test chown -R mongodb:mongodb /data/db
docker restart keeplocal-test
```

## Image Tags Strategy

### Recommended Tagging

- `latest` - Always points to the most recent stable build
- `v1.0.0` - Semantic version tags for releases
- `YYYY-MM-DD-SHA` - Date and git commit SHA for tracking
- `dev` - Development/unstable builds (optional)

### Example

```bash
# Build with multiple tags
docker build -f Dockerfile.allinone -t zwaetschge/keeplocal:latest .
docker tag zwaetschge/keeplocal:latest zwaetschge/keeplocal:v1.0.0
docker tag zwaetschge/keeplocal:latest zwaetschge/keeplocal:2025-01-10-abc123

# Push all tags
docker push zwaetschge/keeplocal:latest
docker push zwaetschge/keeplocal:v1.0.0
docker push zwaetschge/keeplocal:2025-01-10-abc123
```

## Best Practices

1. ✅ **Always test locally** before pushing to Docker Hub
2. ✅ **Use semantic versioning** for releases (v1.0.0, v1.1.0, etc.)
3. ✅ **Tag stable releases** with both `latest` and version number
4. ✅ **Document breaking changes** in release notes
5. ✅ **Keep build logs** for troubleshooting
6. ✅ **Use .dockerignore** to reduce build context size
7. ✅ **Scan images for vulnerabilities**:
   ```bash
   docker scan zwaetschge/keeplocal:latest
   ```

## Additional Resources

- **Docker Documentation:** https://docs.docker.com
- **Docker Hub:** https://hub.docker.com
- **Docker Buildx:** https://docs.docker.com/buildx/working-with-buildx/
- **GitHub Actions for Docker:** https://github.com/docker/build-push-action

---

**Happy building! 🐳**
