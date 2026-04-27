#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"

if [[ ! -f "$SETTINGS" ]]; then
  echo "Nothing to do: $SETTINGS not found."
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak"

HOOK_CMD="node $PLUGIN_DIR/token-tracker.cjs"
STATUSLINE_CMD="node $PLUGIN_DIR/statusline.cjs"

node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));

// Remove Stop hook
const hookCmd = '$HOOK_CMD';
if (settings.hooks?.Stop) {
  settings.hooks.Stop = settings.hooks.Stop.filter(g =>
    !(Array.isArray(g.hooks) && g.hooks.some(h => h.command === hookCmd))
  );
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

// Remove statusline only if it points to this plugin
if (settings.statusLine?.command === '$STATUSLINE_CMD') {
  delete settings.statusLine;
}

fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
" && echo "✓ claude-token-tracker uninstalled. token-usage.json preserved."
