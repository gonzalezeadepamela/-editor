#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_cache="${npm_config_cache:-/tmp/editor-npm}"
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
npm ci --no-audit --no-fund
if [ ! -x /usr/bin/chromium ]; then
  npx remotion browser ensure
fi
npm run build
npm test
