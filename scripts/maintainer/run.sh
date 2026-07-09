#!/bin/zsh
# Daily maintainer-agent run. Installed via launchd (see
# scripts/maintainer/com.agentwatch.maintainer.plist) or run manually:
#   scripts/maintainer/run.sh [--dry-run]
set -euo pipefail

REPO="${AGENTWATCH_MAINTAINER_REPO:-$HOME/IdeaProjects/agentwatch-maintainer}"
LOGDIR="$HOME/.agentwatch-maintainer/logs"
mkdir -p "$LOGDIR"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$REPO"
git checkout -q main
git pull -q --ff-only

exec claude -p "/maintain $*" \
  --permission-mode acceptEdits \
  --max-turns 100 \
  >>"$LOGDIR/$(date +%Y-%m-%d).log" 2>&1
