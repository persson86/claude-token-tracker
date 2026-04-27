'use strict';

const { test }  = require('node:test');
const assert    = require('node:assert/strict');
const fs        = require('fs');
const os        = require('os');
const path      = require('path');

const { getLastAssistantTurn, calculateCost, processEvent } = require('./token-tracker.cjs');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt2-test-'));
}

function writeTranscript(dir, entries) {
  const filePath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n'));
  return filePath;
}

function assistantEntry(model, usage, extra = {}) {
  return {
    type: 'assistant',
    uuid: Math.random().toString(36).slice(2),
    sessionId: 'sess-test',
    cwd: '/test',
    message: { model, role: 'assistant', content: [], usage, ...extra },
    ...extra,
  };
}

function userEntry(extra = {}) {
  return { type: 'user', message: { role: 'user', content: 'hello' }, ...extra };
}

const SONNET = 'claude-sonnet-4-6';
const HAIKU  = 'claude-haiku-4-5-20251001';

const sampleUsage = {
  input_tokens: 10,
  output_tokens: 200,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 1000,
};

// ── getLastAssistantTurn ─────────────────────────────────────────────────────

test('parsing: extrai tokens do último entry assistant', () => {
  const dir  = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userEntry(), assistantEntry(SONNET, sampleUsage)]);
    const turn = getLastAssistantTurn(tp);
    assert.equal(turn.model, SONNET);
    assert.equal(turn.usage.input_tokens, 10);
    assert.equal(turn.usage.output_tokens, 200);
    assert.equal(turn.usage.cache_read_input_tokens, 5000);
    assert.equal(turn.usage.cache_creation_input_tokens, 1000);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: retorna o ÚLTIMO assistant quando há vários', () => {
  const dir = makeTempDir();
  try {
    const first  = assistantEntry(SONNET, { ...sampleUsage, output_tokens: 100 });
    const second = assistantEntry(SONNET, { ...sampleUsage, output_tokens: 999 });
    const tp = writeTranscript(dir, [first, userEntry(), second]);
    const turn = getLastAssistantTurn(tp);
    assert.equal(turn.usage.output_tokens, 999);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: retorna null quando não há entries assistant', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [userEntry(), userEntry()]);
    assert.equal(getLastAssistantTurn(tp), null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: retorna null para transcript vazio', () => {
  const dir = makeTempDir();
  try {
    const tp = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(tp, '');
    assert.equal(getLastAssistantTurn(tp), null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: ignora linhas JSON inválidas sem crash', () => {
  const dir = makeTempDir();
  try {
    const tp = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(tp, 'not-json\n' + JSON.stringify(assistantEntry(SONNET, sampleUsage)));
    const turn = getLastAssistantTurn(tp);
    assert.ok(turn !== null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

// ── calculateCost ────────────────────────────────────────────────────────────

test('pricing: Sonnet 4.6 — cálculo correto', () => {
  // $3/M input + $15/M output + $0.30/M cache_read + $3.75/M cache_write
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
  const costUnknown = calculateCost('claude-unknown-model', {
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  const costSonnet = calculateCost(SONNET, {
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  assert.equal(costUnknown, costSonnet);
});

test('pricing: campos ausentes no usage tratados como zero', () => {
  const cost = calculateCost(SONNET, { output_tokens: 1_000_000 });
  assert.equal(cost, 15.00);
});

// ── processEvent (integração) ─────────────────────────────────────────────────

test('integração: appenda entry correto em usage.json', async () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [assistantEntry(SONNET, sampleUsage)]);
    const usagePath = path.join(dir, 'usage.json');

    await processEvent(
      { hook_event_name: 'Stop', transcript_path: tp, session_id: 'sess-1', cwd: '/my/project' },
      { usagePath }
    );

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].model, SONNET);
    assert.equal(entries[0].in, 10);
    assert.equal(entries[0].out, 200);
    assert.equal(entries[0].cache_r, 5000);
    assert.equal(entries[0].cache_write, 1000);
    assert.equal(entries[0].session_id, 'sess-1');
    assert.equal(entries[0].project, '/my/project');
    assert.ok(entries[0].cost_usd > 0);
    assert.ok(entries[0].date);
    assert.ok(entries[0].timestamp);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: cria usage.json quando não existe', async () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [assistantEntry(SONNET, sampleUsage)]);
    const usagePath = path.join(dir, 'nonexistent', 'usage.json');

    await processEvent(
      { hook_event_name: 'Stop', transcript_path: tp, session_id: 's', cwd: '/p' },
      { usagePath }
    );

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: acumula múltiplas entradas', async () => {
  const dir = makeTempDir();
  try {
    const usagePath = path.join(dir, 'usage.json');

    const tp1 = writeTranscript(dir, [assistantEntry(SONNET, { ...sampleUsage, output_tokens: 100 })]);
    await processEvent({ transcript_path: tp1, session_id: 's', cwd: '/p' }, { usagePath });

    const tp2 = path.join(dir, 'transcript2.jsonl');
    fs.writeFileSync(tp2, JSON.stringify(assistantEntry(SONNET, { ...sampleUsage, output_tokens: 200 })));
    await processEvent({ transcript_path: tp2, session_id: 's', cwd: '/p' }, { usagePath });

    const entries = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    assert.equal(entries.length, 2);
    assert.equal(entries[0].out, 100);
    assert.equal(entries[1].out, 200);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: extrai gitBranch do transcript (ignora HEAD)', () => {
  const dir = makeTempDir();
  try {
    const entries = [
      userEntry({ gitBranch: 'HEAD' }),
      assistantEntry(SONNET, sampleUsage),
      userEntry({ gitBranch: 'feat/AIOX-123-token-tracking', slug: 'minha-sessao-gifted-turing' }),
    ];
    const tp = writeTranscript(dir, entries);
    const turn = getLastAssistantTurn(tp);
    assert.equal(turn.gitBranch, 'feat/AIOX-123-token-tracking');
    assert.equal(turn.sessionSlug, 'minha-sessao-gifted-turing');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('parsing: gitBranch e sessionSlug null quando ausentes', () => {
  const dir = makeTempDir();
  try {
    const tp = writeTranscript(dir, [assistantEntry(SONNET, sampleUsage)]);
    const turn = getLastAssistantTurn(tp);
    assert.equal(turn.gitBranch, null);
    assert.equal(turn.sessionSlug, null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('integração: grava git_branch e session_name no entry', async () => {
  const dir = makeTempDir();
  try {
    const entries = [
      userEntry({ gitBranch: 'feat/AIOX-42-my-story', slug: 'sessao-de-teste-jolly-fox' }),
      assistantEntry(SONNET, sampleUsage),
    ];
    const tp = writeTranscript(dir, entries);
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
