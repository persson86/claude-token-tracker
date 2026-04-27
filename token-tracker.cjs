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

// A "real user prompt" delimits the start of a turn. tool_result entries are
// part of the ongoing turn, not new prompts. Sidechain (sub-agent) entries
// don't delimit the parent turn either.
function isRealUserPrompt(e) {
  if (e.type !== 'user' || e.isSidechain) return false;
  const c = e.message?.content;
  if (typeof c === 'string') return true;
  if (Array.isArray(c) && !c.some(p => p?.type === 'tool_result')) return true;
  return false;
}

// Aggregates usage for the current turn: every assistant API call since the
// last real user prompt, deduped by message.id (the transcript stores one
// line per content block — text + each tool_use — all sharing the same
// message.id and usage payload from a single API call).
function getCurrentTurn(transcriptPath) {
  let content;
  try { content = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }

  const lines = content.trim().split('\n');
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  let gitBranch = null;
  let sessionSlug = null;
  let turnStart = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!gitBranch && e.gitBranch && e.gitBranch !== 'HEAD') gitBranch = e.gitBranch;
    if (!sessionSlug && e.slug) sessionSlug = e.slug;
    if (isRealUserPrompt(e)) { turnStart = i; break; }
  }

  const seen = new Set();
  const total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let model = null;
  let apiCalls = 0;

  for (let i = turnStart; i < entries.length; i++) {
    const e = entries[i];
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    const id = e.message.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const u = e.message.usage;
    total.input_tokens               += u.input_tokens               || 0;
    total.output_tokens              += u.output_tokens              || 0;
    total.cache_read_input_tokens    += u.cache_read_input_tokens    || 0;
    total.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    model = e.message.model || model;
    apiCalls++;
  }

  if (apiCalls === 0) return null;
  return { model, usage: total, apiCalls, gitBranch, sessionSlug };
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

  const turn = getCurrentTurn(transcript_path);
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
    api_calls:     turn.apiCalls,
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
module.exports = { main, processEvent, getCurrentTurn, calculateCost };
