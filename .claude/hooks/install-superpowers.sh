#!/bin/bash
# クラウド（Claude Code on the web / アプリ）のセッション開始時に superpowers プラグインを入れる。
# リポジトリの .claude/settings.json に enabledPlugins を書いても、クラウドでは
# プラグインがインストールされないため、この hook で毎回入れる。
# すでに入っていれば何もしない。手元のPCで動かしたときも何もしない。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

MARKETPLACE_REPO="obra/superpowers"
MARKETPLACE_NAME="superpowers-dev"
PLUGIN_ID="superpowers@${MARKETPLACE_NAME}"

# 通信の一時的な失敗に備えて、最大3回まで試す
retry() {
  local n
  for n in 1 2 3; do
    if "$@" >&2; then
      return 0
    fi
    echo "失敗しました（${n}回目）: $*" >&2
    sleep $((n * 2))
  done
  return 1
}

if ! claude plugin marketplace list --json | jq -e --arg n "$MARKETPLACE_NAME" 'any(.[]; .name == $n)' > /dev/null; then
  retry claude plugin marketplace add "$MARKETPLACE_REPO"
fi

if ! claude plugin list --json | jq -e --arg id "$PLUGIN_ID" 'any(.[]; .id == $id)' > /dev/null; then
  retry claude plugin install "$PLUGIN_ID"
fi
