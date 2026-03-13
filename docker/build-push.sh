#!/usr/bin/env bash
set -euo pipefail

# ── Felt Like It — Build & Push Container Images ────────────────────────────
# Builds web + worker images and pushes to GHCR.
#
# Usage:
#   ./docker/build-push.sh              # tag with git short SHA
#   ./docker/build-push.sh v1.2.3       # tag with version
#   ./docker/build-push.sh latest       # tag as latest
#
# Prerequisites:
#   echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
REGISTRY="ghcr.io/micahchoo/felt-like-it"
TAG="${1:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)}"

echo "Building felt-like-it images (tag: $TAG)"
echo ""

images=(
  "web:docker/Dockerfile.web"
  "worker:docker/Dockerfile.worker"
)

for entry in "${images[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry#*:}"
  full_tag="${REGISTRY}/${name}:${TAG}"

  echo "── Building ${name} ──"
  docker build \
    -t "$full_tag" \
    -f "$PROJECT_ROOT/$dockerfile" \
    "$PROJECT_ROOT"

  echo "── Pushing ${name}:${TAG} ──"
  docker push "$full_tag"

  # Keep latest in sync when tagging with a specific version
  if [[ "$TAG" != "latest" ]]; then
    docker tag "$full_tag" "${REGISTRY}/${name}:latest"
    docker push "${REGISTRY}/${name}:latest"
  fi

  echo ""
done

echo "Done. Images pushed:"
echo "  ${REGISTRY}/web:${TAG}"
echo "  ${REGISTRY}/worker:${TAG}"
echo ""
echo "To deploy in Portainer, set IMAGE_TAG=${TAG} and redeploy the stack."
