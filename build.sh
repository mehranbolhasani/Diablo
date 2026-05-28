#!/usr/bin/env bash
# Build script for Diablo Chrome Extension store bundle.
# Usage: ./build.sh
# Creates: diablo-cws-<version>.zip from the extension/ directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION=$(jq -r '.version' extension/manifest.json)
OUT="diablo-cws-${VERSION}.zip"

echo "Building $OUT ..."

# Exclude: assets, macOS metadata, zips, and git files.
cd extension
zip -r "../$OUT" . \
  -x "*.DS_Store" \
  -x "*.zip" \
  -x "diablo-assets/*" \
  -x "*.git*"

cd "$SCRIPT_DIR"
echo "Done: $OUT"
ls -lh "$OUT"
