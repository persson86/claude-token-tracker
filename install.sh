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

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Required for the statusline display." >&2
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
STATUSLINE_CMD="bash $PLUGIN_DIR/statusline.sh"

PATCHED=$(node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));

// Stop hook
if (!settings.hooks) settings.hooks = {};
if (!settings.hooks.Stop) settings.hooks.Stop = [];
const hookCmd = '$HOOK_CMD';
const hookExists = settings.hooks.Stop.some(g =>
  Array.isArray(g.hooks) && g.hooks.some(h => h.command === hookCmd)
);
if (!hookExists) {
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: hookCmd, timeout: 10 }] });
}

// Statusline (only set if not already configured)
if (!settings.statusLine) {
  settings.statusLine = { type: 'command', command: '$STATUSLINE_CMD' };
}

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
