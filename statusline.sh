#!/bin/sh
input=$(cat)
python3 - "$input" <<'EOF'
import sys, json, os

data = json.loads(sys.argv[1])

cwd       = data.get("cwd", "")
model     = data.get("model", {}).get("display_name", "")
cost      = data.get("cost", {}).get("total_cost_usd", 0)
ctx       = data.get("context_window", {})
ctx_pct   = ctx.get("used_percentage", 0)
usage     = ctx.get("current_usage", {})
inp       = usage.get("input_tokens", 0)
out       = usage.get("output_tokens", 0)
cache_r   = usage.get("cache_read_input_tokens", 0)
rl5h      = data.get("rate_limits", {}).get("five_hour", {}).get("used_percentage", 0)

# ANSI colors
RESET  = "\033[00m"
GREEN  = "\033[01;32m"
BLUE   = "\033[01;34m"
YELLOW = "\033[01;33m"
CYAN   = "\033[01;36m"
GRAY   = "\033[00;37m"

home = os.path.expanduser("~")
short_cwd = cwd.replace(home, "~") if cwd.startswith(home) else cwd
parts = short_cwd.split("/")
if len(parts) > 3:
    short_cwd = ".../" + "/".join(parts[-2:])

line = (
    f"{GREEN}{model}{RESET} "
    f"{GRAY}|{RESET} "
    f"{BLUE}{short_cwd}{RESET} "
    f"{GRAY}|{RESET} "
    f"{YELLOW}${cost:.4f}{RESET} "
    f"{GRAY}|{RESET} "
    f"{CYAN}ctx:{ctx_pct}%{RESET} "
    f"{GRAY}in:{inp} out:{out} cache:{cache_r}{RESET} "
    f"{GRAY}| rl5h:{rl5h}%{RESET}"
)
print(line, end="")
EOF
