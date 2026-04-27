#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if ! command -v node &>/dev/null; then
  echo "Error: node not found. Install Node.js >= 18 first." >&2
  exit 1
fi

# Ensure settings.json exists
if [[ ! -f "$SETTINGS" ]]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
fi

# Backup
cp "$SETTINGS" "$SETTINGS.bak"

HOOK_CMD="node $PLUGIN_DIR/token-tracker.cjs"
STATUSLINE_CMD="node $PLUGIN_DIR/statusline.cjs"

PATCHED=$(node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));

const hookCmd   = '$HOOK_CMD';
const statusCmd = '$STATUSLINE_CMD';

// Match any token-tracker invocation regardless of path — handles reinstalls
// from different folders and clears stale entries from previous installs.
const isTrackerHook   = (c) => typeof c === 'string' && /\/token-tracker\.cjs(\s|\$)/.test(c);
const isTrackerStatus = (c) => typeof c === 'string' && /\/statusline\.cjs(\s|\$)/.test(c);

// Stop hook: drop any existing token-tracker hook (any path), then add this one.
if (!settings.hooks) settings.hooks = {};
if (Array.isArray(settings.hooks.Stop)) {
  settings.hooks.Stop = settings.hooks.Stop
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isTrackerHook(h.command)) }))
    .filter(g => g.hooks.length > 0);
} else {
  settings.hooks.Stop = [];
}
settings.hooks.Stop.push({ hooks: [{ type: 'command', command: hookCmd, timeout: 10 }] });

// Statusline: always point to this install. Warn when replacing something unrelated.
const currentStatus = settings.statusLine?.command;
if (currentStatus && !isTrackerStatus(currentStatus)) {
  console.error('⚠  Replacing existing statusLine: ' + currentStatus);
}
settings.statusLine = { type: 'command', command: statusCmd };

console.log(JSON.stringify(settings, null, 2));
")

if $DRY_RUN; then
  echo "=== Dry run — settings.json after install ==="
  echo "$PATCHED"
  echo ""
  echo "No changes written. Run without --dry-run to apply."
else
  echo "$PATCHED" > "$SETTINGS"
  echo "✓ claude-token-tracker installed."
  echo "  Hook:      Stop → $HOOK_CMD"
  echo "  Statusline: $STATUSLINE_CMD"
  echo "  Usage log: ~/.claude/token-usage.json"
  echo ""
  echo "Restart Claude Code to activate."
fi
