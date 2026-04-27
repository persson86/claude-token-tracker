#!/usr/bin/env bash
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"

if [[ ! -f "$SETTINGS" ]]; then
  echo "Nothing to do: $SETTINGS not found."
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak"

node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf8'));

// Path-agnostic match: removes any token-tracker install regardless of where
// uninstall is run from.
const isTrackerHook   = (c) => typeof c === 'string' && /\/token-tracker\.cjs(\s|\$)/.test(c);
const isTrackerStatus = (c) => typeof c === 'string' && /\/statusline\.cjs(\s|\$)/.test(c);

if (settings.hooks?.Stop) {
  settings.hooks.Stop = settings.hooks.Stop
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isTrackerHook(h.command)) }))
    .filter(g => g.hooks.length > 0);
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

if (isTrackerStatus(settings.statusLine?.command)) {
  delete settings.statusLine;
}

fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
" && echo "✓ claude-token-tracker uninstalled. token-usage.json preserved."
