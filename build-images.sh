#!/usr/bin/env bash

# Build the split MongoDB, AI, API, and web deployment defined by Compose.

set -Eeuo pipefail

WHISPER_MODEL="${WHISPER_MODEL:-base}"
export WHISPER_MODEL

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 (the 'docker compose' command) is required." >&2
  exit 1
fi

if [[ ! -f docker-compose.yml ]]; then
  echo "Run this script from the KeepLocal repository root." >&2
  exit 1
fi

docker compose config >/dev/null
docker compose build

cat <<'EOF'

Split images built successfully. Start them with:

  docker compose up -d

The public Docker Hub release is the all-in-one image. Use
./build-allinone.sh when you need a tag that can be pushed to a registry.
EOF
