#!/usr/bin/env node
'use strict';

const os = require('os');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    process.stdin.on('error', () => resolve({}));
  });
}

function shortenCwd(cwd) {
  if (!cwd) return '';
  const home = os.homedir();
  let short = cwd.startsWith(home) ? cwd.replace(home, '~') : cwd;
  const parts = short.split('/');
  if (parts.length > 3) short = '.../' + parts.slice(-2).join('/');
  return short;
}

async function main() {
  const data = await readStdin();

  const model   = data.model?.display_name ?? '';
  const cwd     = data.cwd ?? '';
  const cost    = data.cost?.total_cost_usd ?? 0;
  const ctx     = data.context_window ?? {};
  const ctxPct  = ctx.used_percentage ?? 0;
  const usage   = ctx.current_usage ?? {};
  const inp     = usage.input_tokens ?? 0;
  const out     = usage.output_tokens ?? 0;
  const cacheR  = usage.cache_read_input_tokens ?? 0;
  const rl5h    = data.rate_limits?.five_hour?.used_percentage ?? 0;

  const RESET  = '\x1b[00m';
  const GREEN  = '\x1b[01;32m';
  const BLUE   = '\x1b[01;34m';
  const YELLOW = '\x1b[01;33m';
  const CYAN   = '\x1b[01;36m';
  const GRAY   = '\x1b[00;37m';

  const shortCwd = shortenCwd(cwd);

  const line =
    `${GREEN}${model}${RESET} ` +
    `${GRAY}|${RESET} ` +
    `${BLUE}${shortCwd}${RESET} ` +
    `${GRAY}|${RESET} ` +
    `${YELLOW}$${cost.toFixed(4)}${RESET} ` +
    `${GRAY}|${RESET} ` +
    `${CYAN}ctx:${ctxPct}%${RESET} ` +
    `${GRAY}in:${inp} out:${out} cache:${cacheR}${RESET} ` +
    `${GRAY}| rl5h:${rl5h}%${RESET}`;

  process.stdout.write(line);
}

main();
