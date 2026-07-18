#!/usr/bin/env bash

# Build the self-contained KeepLocal image used by Unraid and Docker Hub.

set -Eeuo pipefail

DOCKER_IMAGE="${DOCKER_IMAGE:-valentin2177/keeplocal}"
VERSION="${VERSION:-latest}"
WHISPER_MODEL="${WHISPER_MODEL:-tiny}"
PLATFORM="${PLATFORM:-}"
NO_CACHE="${NO_CACHE:-false}"
FULL_IMAGE="${DOCKER_IMAGE}:${VERSION}"

case "${WHISPER_MODEL}" in
  tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large|large-v1|large-v2|large-v3|large-v3-turbo|turbo)
    ;;
  *)
    echo "Unsupported WHISPER_MODEL: ${WHISPER_MODEL}" >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available in PATH." >&2
  exit 1
fi

if [[ ! -f Dockerfile.allinone ]]; then
  echo "Run this script from the KeepLocal repository root." >&2
  exit 1
fi

build_args=(
  build
  --file Dockerfile.allinone
  --tag "${FULL_IMAGE}"
  --build-arg "WHISPER_MODEL=${WHISPER_MODEL}"
)

if [[ -n "${PLATFORM}" ]]; then
  build_args+=(--platform "${PLATFORM}")
fi

if [[ "${NO_CACHE}" == "true" ]]; then
  build_args+=(--no-cache)
elif [[ "${NO_CACHE}" != "false" ]]; then
  echo "NO_CACHE must be true or false." >&2
  exit 1
fi

echo "Building ${FULL_IMAGE} (Whisper: ${WHISPER_MODEL}${PLATFORM:+, platform: ${PLATFORM}})"
docker "${build_args[@]}" .

cat <<EOF

Image built: ${FULL_IMAGE}

Test it with persistent database and upload volumes:

  docker run -d \\
    --name keeplocal-test \\
    -p 3000:80 \\
    -e JWT_SECRET="\$(openssl rand -hex 48)" \\
    -e CSRF_SECRET="\$(openssl rand -hex 48)" \\
    -e ALLOWED_ORIGINS="http://localhost:3000" \\
    -e CLIENT_URL="http://localhost:3000" \\
    -v keeplocal-mongodb:/data/db \\
    -v keeplocal-uploads:/app/server/uploads \\
    ${FULL_IMAGE}

Then open http://localhost:3000. See docs/docker.md for publishing and
multi-architecture builds.
EOF
