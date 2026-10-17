#!/usr/bin/env bash
# おもいでプリントのテストを全部流す（1回のコマンドで完結）
#   bash tests/omoide-print/run.sh
# 必要なもの: python3（Pillow）、node 18 以上、playwright（Chromium）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8765}"

# テスト用の写真（なければ作る）
if [ ! -f "$HERE/fixtures/land_exif.jpg" ]; then
  python3 "$HERE/make_fixtures.py" "$HERE/fixtures"
fi

echo "== 計算部分のテスト（core.js）"
node --test "$HERE/core.test.cjs"

echo "== 画面テスト（Chromium・iPhone の画面サイズ）"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT/suuji-nazori" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/print/" && break
  sleep 0.1
done
NODE_PATH="${NODE_PATH:-$(npm root -g)}" \
BASE_URL="http://127.0.0.1:$PORT/print/" FIXTURES="$HERE/fixtures" SHOTS="${SHOTS:-}" \
  node "$HERE/e2e.cjs"
