#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// USD per 1 million tokens — update as Anthropic publishes new prices
const PRICING = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cache_read: 0.30, cache_write: 3.75  },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cache_read: 0.08, cache_write: 1.00  },
  'claude-opus-4-7':           { input: 15.00, output: 75.00, cache_read: 1.50, cache_write: 18.75 },
};
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6'];

const DEFAULT_USAGE_PATH = path.join(os.homedir(), '.claude', 'token-usage.json');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    process.stdin.on('error', () => resolve({}));
  });
}

function getLastAssistantTurn(transcriptPath) {
  let content;
  try { content = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }

  const lines = content.trim().split('\n');
  let assistantTurn = null;
  let gitBranch = null;
  let sessionSlug = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (!assistantTurn && entry.type === 'assistant' && entry.message?.usage) {
        assistantTurn = { model: entry.message.model, usage: entry.message.usage };
      }
      if (!gitBranch && entry.gitBranch && entry.gitBranch !== 'HEAD') {
        gitBranch = entry.gitBranch;
      }
      if (!sessionSlug && entry.slug) {
        sessionSlug = entry.slug;
      }
      if (assistantTurn && gitBranch && sessionSlug) break;
    } catch { /* skip malformed lines */ }
  }

  if (!assistantTurn) return null;
  return { model: assistantTurn.model, usage: assistantTurn.usage, gitBranch, sessionSlug };
}

function calculateCost(model, usage = {}) {
  const p = PRICING[model] || DEFAULT_PRICING;
  const {
    input_tokens               = 0,
    output_tokens              = 0,
    cache_read_input_tokens    = 0,
    cache_creation_input_tokens = 0,
  } = usage;
  return (
    input_tokens                * p.input  +
    output_tokens               * p.output +
    cache_read_input_tokens     * p.cache_read +
    cache_creation_input_tokens * p.cache_write
  ) / 1_000_000;
}

async function processEvent(input, config = {}) {
  const { transcript_path, session_id, cwd } = input;
  if (!transcript_path) return;

  const turn = getLastAssistantTurn(transcript_path);
  if (!turn) return;

  const cost    = calculateCost(turn.model, turn.usage);
  const { usage } = turn;
  const now     = new Date();

  const usagePath = config.usagePath || DEFAULT_USAGE_PATH;
  const dir       = path.dirname(usagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch { /* new file */ }

  entries.push({
    date:          now.toISOString().split('T')[0],
    timestamp:     now.toISOString(),
    session_id:    session_id || null,
    session_name:  turn.sessionSlug || null,
    project:       cwd || null,
    git_branch:    turn.gitBranch || null,
    model:         turn.model,
    in:            usage.input_tokens               || 0,
    out:           usage.output_tokens              || 0,
    cache_r:       usage.cache_read_input_tokens    || 0,
    cache_write:   usage.cache_creation_input_tokens || 0,
    cost_usd:      Math.round(cost * 1e8) / 1e8,
  });

  fs.writeFileSync(usagePath, JSON.stringify(entries, null, 2));
}

async function main() {
  const input = await readStdin();
  await processEvent(input);
}

function run() {
  const timer = setTimeout(() => process.exit(0), 9000);
  timer.unref();
  main()
    .then(() => { clearTimeout(timer); process.exitCode = 0; })
    .catch(() => { clearTimeout(timer); process.exitCode = 0; });
}

if (require.main === module) run();
module.exports = { main, processEvent, getLastAssistantTurn, calculateCost };
