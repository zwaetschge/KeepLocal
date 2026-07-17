#!/usr/bin/env bash

set -euo pipefail

required_variables=(
  DOCKERHUB_USERNAME
  IMAGE_NAME
  GITHUB_EVENT_NAME
  GITHUB_OUTPUT
  GITHUB_REF_NAME
  GITHUB_REF_TYPE
  GITHUB_REPOSITORY
  GITHUB_SERVER_URL
  GITHUB_SHA
)

for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Missing required environment variable: ${variable}" >&2
    exit 1
  fi
done

if [[ ! "${DOCKERHUB_USERNAME}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
  echo 'DOCKERHUB_USERNAME is not a valid Docker Hub namespace' >&2
  exit 1
fi

if [[ ! "${IMAGE_NAME}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
  echo 'IMAGE_NAME is not a valid Docker image name' >&2
  exit 1
fi

if [[ ! "${GITHUB_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo 'GITHUB_SHA must be a 40-character hexadecimal commit SHA' >&2
  exit 1
fi

image="${DOCKERHUB_USERNAME}/${IMAGE_NAME}"
short_sha="${GITHUB_SHA:0:7}"
created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
immutable_tag="${created%%T*}-${short_sha}"
version="${immutable_tag}"
tags=()

add_tag() {
  local candidate="$1"
  local existing

  for existing in "${tags[@]:-}"; do
    if [[ "${existing}" == "${candidate}" ]]; then
      return
    fi
  done

  tags+=("${candidate}")
}

add_semver_tags() {
  local requested_version="${1#v}"
  local canonical_version
  local identifier
  local major
  local minor
  local prerelease
  local -a prerelease_identifiers

  if [[ ! "${requested_version}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$ ]]; then
    echo "Invalid semantic version: $1" >&2
    exit 1
  fi

  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  canonical_version="${requested_version%%+*}"

  if [[ "${canonical_version}" == *-* ]]; then
    prerelease="${canonical_version#*-}"
    IFS='.' read -r -a prerelease_identifiers <<< "${prerelease}"
    for identifier in "${prerelease_identifiers[@]}"; do
      if [[ "${identifier}" =~ ^0[0-9]+$ ]]; then
        echo "Invalid semantic version: $1" >&2
        exit 1
      fi
    done
  fi

  version="${canonical_version}"
  add_tag "${image}:${canonical_version}"

  # Pre-release versions must not replace the stable major/minor channels.
  if [[ "${canonical_version}" != *-* ]]; then
    add_tag "${image}:${major}.${minor}"
    add_tag "${image}:${major}"
    add_tag "${image}:latest"
  fi
}

add_tag "${image}:${immutable_tag}"

if [[ "${GITHUB_EVENT_NAME}" == 'workflow_dispatch' && "${INPUT_VERSION:-latest}" != 'latest' ]]; then
  if [[ "${GITHUB_REF_TYPE}" != 'branch' || "${GITHUB_REF_NAME}" != 'main' ]]; then
    echo 'Versioned manual releases must be dispatched from the main branch' >&2
    exit 1
  fi

  add_semver_tags "${INPUT_VERSION}"
elif [[ "${GITHUB_REF_TYPE}" == 'tag' ]]; then
  add_semver_tags "${GITHUB_REF_NAME}"
elif [[ "${GITHUB_REF_TYPE}" == 'branch' ]]; then
  if [[ "${GITHUB_REF_NAME}" != 'main' ]]; then
    echo "Refusing to publish an unconfigured branch: ${GITHUB_REF_NAME}" >&2
    exit 1
  fi

  version='main'
  add_tag "${image}:main"
  add_tag "${image}:latest"
else
  echo "Unsupported Git ref type: ${GITHUB_REF_TYPE}" >&2
  exit 1
fi

source_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"

{
  echo 'tags<<__DOCKER_TAGS__'
  printf '%s\n' "${tags[@]}"
  echo '__DOCKER_TAGS__'
  echo 'labels<<__DOCKER_LABELS__'
  echo "org.opencontainers.image.created=${created}"
  echo 'org.opencontainers.image.description=Vibecoded Google Keep Clone'
  echo 'org.opencontainers.image.licenses='
  echo "org.opencontainers.image.revision=${GITHUB_SHA}"
  echo "org.opencontainers.image.source=${source_url}"
  echo 'org.opencontainers.image.title=KeepLocal'
  echo "org.opencontainers.image.url=${source_url}"
  echo "org.opencontainers.image.version=${version}"
  echo '__DOCKER_LABELS__'
  echo "test-tag=${immutable_tag}"
  echo "version=${version}"
} >> "${GITHUB_OUTPUT}"
