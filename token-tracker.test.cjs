'use strict';

const { test }  = require('node:test');
const assert    = require('node:assert/strict');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');

const { getCurrentTurn, calculateCost, processEvent } = require('./token-tracker.cjs');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt2-test-'));
}

function writeTranscript(dir, entries) {
  const filePath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n'));
  return filePath;
}

let msgCounter = 0;
function assistantEntry(model, usage, opts = {}) {
  msgCounter++;
  return {
    type: 'assistant',
    uuid: Math.random().toString(36).slice(2),
    sessionId: 'sess-test',
    cwd: '/test',
    isSidechain: opts.isSidechain || false,
    message: {
      id: opts.messageId || `msg-${msgCounter}`,
      model,
      role: 'assistant',
      content: [],
      usage,
    },
    ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
    ...(opts.slug ? { slug: opts.slug } : {}),
  };
}

function userPrompt(text = 'hello', opts = {}) {
  return {
    type: 'user',
    isSidechain: opts.isSidechain || false,
    message: { role: 'user', content: text },
    ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
    ...(opts.slug ? { slug: opts.slug } : {}),
  };
}

function toolResultEntry() {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  };
}

const SONNET = 'claude-sonnet-4-6';
const HAIKU  = 'claude-haiku-4-5-20251001';

const sampleUsage = {
  input_tokens: 10,
  output_tokens: 200,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 1000,
};

// ── getCurrentTurn ───────────────────────────────────────────────────────────

test('parsing: extrai tokens de um turno com 1 API call', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userPrompt(), assistantEntry(SONNET, sampleUsage)]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.model, SONNET);
    assert.equal(turn.apiCalls, 1);
    assert.equal(turn.usage.input_tokens, 10);
    assert.equal(turn.usage.output_tokens, 200);
    assert.equal(turn.usage.cache_read_input_tokens, 5000);
    assert.equal(turn.usage.cache_creation_input_tokens, 1000);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('turn: soma usage de várias API calls (tool use)', () => {
  const dir = makeTempDir();
  try {
    const u1 = { input_tokens: 5,  output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    const u2 = { input_tokens: 3,  output_tokens: 400, cache_read_input_tokens: 2000, cache_creation_input_tokens: 50  };
    const u3 = { input_tokens: 1,  output_tokens: 50,  cache_read_input_tokens: 3000, cache_creation_input_tokens: 0   };
    const tp = writeTranscript(dir, [
      userPrompt('do stuff'),
      assistantEntry(SONNET, u1, { messageId: 'm1' }),
      toolResultEntry(),
      assistantEntry(SONNET, u2, { messageId: 'm2' }),
      toolResultEntry(),
      assistantEntry(SONNET, u3, { messageId: 'm3' }),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.apiCalls, 3);
    assert.equal(turn.usage.input_tokens, 9);
    assert.equal(turn.usage.output_tokens, 550);
    assert.equal(turn.usage.cache_read_input_tokens, 6000);
    assert.equal(turn.usage.cache_creation_input_tokens, 250);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('turn: dedup por message.id (blocos de conteúdo da mesma call)', () => {
  const dir = makeTempDir();
  try {
    const u = { input_tokens: 1, output_tokens: 1624, cache_read_input_tokens: 93186, cache_creation_input_tokens: 3695 };
    const tp = writeTranscript(dir, [
      userPrompt('x'),
      assistantEntry(SONNET, u, { messageId: 'msg_dup' }),
      assistantEntry(SONNET, u, { messageId: 'msg_dup' }),
      assistantEntry(SONNET, u, { messageId: 'msg_dup' }),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.apiCalls, 1, 'three lines with same message.id count as one API call');
    assert.equal(turn.usage.input_tokens, 1);
    assert.equal(turn.usage.output_tokens, 1624);
    assert.equal(turn.usage.cache_read_input_tokens, 93186);
    assert.equal(turn.usage.cache_creation_input_tokens, 3695);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('turn: ignora entries antes do último prompt user real', () => {
  const dir = makeTempDir();
  try {
    const oldUsage = { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 999, cache_creation_input_tokens: 999 };
    const newUsage = { input_tokens: 7,   output_tokens: 14,  cache_read_input_tokens: 21,  cache_creation_input_tokens: 28 };
    const tp = writeTranscript(dir, [
      userPrompt('previous turn'),
      assistantEntry(SONNET, oldUsage, { messageId: 'old' }),
      userPrompt('new turn'),
      assistantEntry(SONNET, newUsage, { messageId: 'new' }),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.apiCalls, 1);
    assert.equal(turn.usage.input_tokens, 7);
    assert.equal(turn.usage.output_tokens, 14);
    assert.equal(turn.usage.cache_read_input_tokens, 21);
    assert.equal(turn.usage.cache_creation_input_tokens, 28);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('turn: sidechain user prompt NÃO delimita turno', () => {
  const dir = makeTempDir();
  try {
    const u1 = { input_tokens: 5, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
    const u2 = { input_tokens: 3, output_tokens: 200, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };
    const tp = writeTranscript(dir, [
      userPrompt('main'),
      assistantEntry(SONNET, u1, { messageId: 'm1' }),
      userPrompt('sub-agent task', { isSidechain: true }),
      assistantEntry(SONNET, u2, { messageId: 'm2', isSidechain: true }),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.apiCalls, 2, 'sidechain entries count toward parent turn');
    assert.equal(turn.usage.input_tokens, 8);
    assert.equal(turn.usage.output_tokens, 300);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('turn: tool_result não delimita turno', () => {
  const dir = makeTempDir();
  try {
    const u1 = { input_tokens: 5, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
    const u2 = { input_tokens: 3, output_tokens: 200, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };
    const tp = writeTranscript(dir, [
      userPrompt('go'),
      assistantEntry(SONNET, u1, { messageId: 'm1' }),
      toolResultEntry(),
      assistantEntry(SONNET, u2, { messageId: 'm2' }),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.apiCalls, 2);
    assert.equal(turn.usage.output_tokens, 300);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: retorna null quando não há entries assistant', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userPrompt(), userPrompt()]);
    assert.equal(getCurrentTurn(tp), null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: retorna null para transcript vazio', () => {
  const dir = makeTempDir();
  try {
    const tp = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(tp, '');
    assert.equal(getCurrentTurn(tp), null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: ignora linhas JSON inválidas sem crash', () => {
  const dir = makeTempDir();
  try {
    const tp = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(tp, 'not-json\n' + JSON.stringify(userPrompt()) + '\n' + JSON.stringify(assistantEntry(SONNET, sampleUsage)));
    const turn = getCurrentTurn(tp);
    assert.ok(turn !== null);
    assert.equal(turn.apiCalls, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: extrai gitBranch do transcript (ignora HEAD)', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [
      userPrompt('x', { gitBranch: 'HEAD' }),
      userPrompt('y', { gitBranch: 'feat/AIOX-123-token-tracking', slug: 'minha-sessao-gifted-turing' }),
      assistantEntry(SONNET, sampleUsage),
    ]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.gitBranch, 'feat/AIOX-123-token-tracking');
    assert.equal(turn.sessionSlug, 'minha-sessao-gifted-turing');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: gitBranch e sessionSlug null quando ausentes', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userPrompt(), assistantEntry(SONNET, sampleUsage)]);
    const turn = getCurrentTurn(tp);
    assert.equal(turn.gitBranch, null);
    assert.equal(turn.sessionSlug, null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

// ── calculateCost ────────────────────────────────────────────────────────────

test('pricing: Sonnet 4.6 — cálculo correto', () => {
  const cost = calculateCost(SONNET, {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  });
  assert.equal(cost, 3.00 + 15.00 + 0.30 + 3.75);
});

test('pricing: Haiku 4.5 — cálculo correto', () => {
  const cost = calculateCost(HAIKU, {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  });
  assert.equal(cost, 0.80 + 4.00 + 0.08 + 1.00);
});

test('pricing: modelo desconhecido usa fallback Sonnet', () => {
  const costUnknown = calculateCost('claude-unknown-model', { input_tokens: 1_000_000 });
  const costSonnet  = calculateCost(SONNET, { input_tokens: 1_000_000 });
  assert.equal(costUnknown, costSonnet);
});

test('pricing: campos ausentes no usage tratados como zero', () => {
  const cost = calculateCost(SONNET, { output_tokens: 1_000_000 });
  assert.equal(cost, 15.00);
});

// ── processEvent (integração) ─────────────────────────────────────────────────

test('integração: appenda entry correto em usage.json (single call)', async () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userPrompt(), assistantEntry(SONNET, sampleUsage)]);
    const usagePath = path.join(dir, 'usage.json');

    await processEvent(
      { hook_event_name: 'Stop', transcript_path: tp, session_id: 'sess-1', cwd: '/my/project' },
      { usagePath }
    );

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].model, SONNET);
    assert.equal(entries[0].api_calls, 1);
    assert.equal(entries[0].in, 10);
    assert.equal(entries[0].out, 200);
    assert.equal(entries[0].cache_r, 5000);
    assert.equal(entries[0].cache_write, 1000);
    assert.equal(entries[0].session_id, 'sess-1');
    assert.equal(entries[0].project, '/my/project');
    assert.ok(entries[0].cost_usd > 0);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: appenda usage SOMADO em turno multi-call', async () => {
  const dir = makeTempDir();
  try {
    const u1 = { input_tokens: 5, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    const u2 = { input_tokens: 3, output_tokens: 400, cache_read_input_tokens: 2000, cache_creation_input_tokens: 50  };
    const tp = writeTranscript(dir, [
      userPrompt(),
      assistantEntry(SONNET, u1, { messageId: 'm1' }),
      toolResultEntry(),
      assistantEntry(SONNET, u2, { messageId: 'm2' }),
    ]);
    const usagePath = path.join(dir, 'usage.json');

    await processEvent({ transcript_path: tp, session_id: 's', cwd: '/p' }, { usagePath });

    const [entry] = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entry.api_calls, 2);
    assert.equal(entry.in,  8);
    assert.equal(entry.out, 500);
    assert.equal(entry.cache_r, 3000);
    assert.equal(entry.cache_write, 250);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: cria usage.json quando não existe', async () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userPrompt(), assistantEntry(SONNET, sampleUsage)]);
    const usagePath = path.join(dir, 'nonexistent', 'usage.json');

    await processEvent({ transcript_path: tp, session_id: 's', cwd: '/p' }, { usagePath });

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: acumula múltiplas entradas', async () => {
  const dir = makeTempDir();
  try {
    const usagePath = path.join(dir, 'usage.json');

    const tp1 = writeTranscript(dir, [userPrompt(), assistantEntry(SONNET, { ...sampleUsage, output_tokens: 100 })]);
    await processEvent({ transcript_path: tp1, session_id: 's', cwd: '/p' }, { usagePath });

    const tp2 = path.join(dir, 'transcript2.jsonl');
    fs.writeFileSync(tp2, JSON.stringify(userPrompt()) + '\n' + JSON.stringify(assistantEntry(SONNET, { ...sampleUsage, output_tokens: 200 })));
    await processEvent({ transcript_path: tp2, session_id: 's', cwd: '/p' }, { usagePath });

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].out, 100);
    assert.equal(entries[1].out, 200);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: grava git_branch e session_name no entry', async () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [
      userPrompt('go', { gitBranch: 'feat/AIOX-42-my-story', slug: 'sessao-de-teste-jolly-fox' }),
      assistantEntry(SONNET, sampleUsage),
    ]);
    const usagePath = path.join(dir, 'usage.json');
    await processEvent({ transcript_path: tp, session_id: 's', cwd: '/p' }, { usagePath });
    const [entry] = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entry.git_branch, 'feat/AIOX-42-my-story');
    assert.equal(entry.session_name, 'sessao-de-teste-jolly-fox');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('edge: transcript_path ausente — sai sem crash', async () => {
  const dir = makeTempDir();
  try {
    const usagePath = path.join(dir, 'usage.json');
    await processEvent({ session_id: 's', cwd: '/p' }, { usagePath });
    assert.throws(() => fs.readFileSync(usagePath));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('edge: transcript_path inexistente — sai sem crash', async () => {
  const dir = makeTempDir();
  try {
    const usagePath = path.join(dir, 'usage.json');
    await processEvent(
      { transcript_path: '/nonexistent/path.jsonl', session_id: 's', cwd: '/p' },
      { usagePath }
    );
    assert.throws(() => fs.readFileSync(usagePath));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
