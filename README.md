# claude-token-tracker

Per-turn token and cost tracking for [Claude Code](https://claude.ai/code).

Hooks into Claude Code's `Stop` event to record input, output, and cache tokens plus USD cost for every turn. Also renders a live status bar at the bottom of the terminal.

## Status bar

```
Sonnet 4.6 | ~/project | $7.7321 | ctx:15% in:1 out:388 cache:29804 | rl5h:33%
```

Fields: model · working directory · cumulative session cost · context window % · token counts · 5-hour rate-limit usage.

## Requirements

- Node.js ≥ 18
- Claude Code CLI

## Install

```bash
git clone https://github.com/persson86/claude-token-tracker.git
cd claude-token-tracker
bash install.sh
```

Restart Claude Code after installing.

To preview changes without applying:

```bash
bash install.sh --dry-run
```

## Usage history

Every turn is appended to `~/.claude/token-usage.json`:

```json
[
  {
    "date": "2026-04-26",
    "timestamp": "2026-04-26T14:32:00.000Z",
    "session_id": "...",
    "session_name": "my-session-slug",
    "project": "/home/user/my-project",
    "git_branch": "feat/my-branch",
    "model": "claude-sonnet-4-6",
    "api_calls": 4,
    "in": 9,
    "out": 1500,
    "cache_r": 120000,
    "cache_write": 8000,
    "cost_usd": 0.0628
  }
]
```

`api_calls` is the number of API round-trips in the turn — turns with tool use make several calls (one per tool round-trip), and all of them are summed.

This file is local — it is never committed to the repository.

## Uninstall

```bash
bash uninstall.sh
```

Removes the hook and statusline from `~/.claude/settings.json`. The usage log (`token-usage.json`) is preserved.

## License

MIT
