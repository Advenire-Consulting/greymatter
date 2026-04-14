'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-rw-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// Minimal JSONL content simulating a conversation window
function makeWindowContent(lines) {
  return lines.join('\n');
}

const SAMPLE_LINES = [
  JSON.stringify({ type: 'user', message: { content: 'How do I implement auth?' }, timestamp: '2026-04-10T10:00:00' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Use bcrypt for password hashing.' }] }, requestId: 'req1', timestamp: '2026-04-10T10:00:01' }),
  JSON.stringify({ type: 'user', message: { content: 'What about sessions?' }, timestamp: '2026-04-10T10:01:00' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Use signed cookies with httpOnly flag.' }] }, requestId: 'req2', timestamp: '2026-04-10T10:01:01' }),
];

describe('read-window queries', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    queries = new MemoryQueries(db);

    db.insertSession('sess-abc', '2026-04-10T10:00:00', ['myproject']);
    const w1 = db.insertWindow('sess-abc', 0, {
      startLine: 0,
      endLine: SAMPLE_LINES.length - 1,
      startTime: '2026-04-10T10:00:00',
      endTime: '2026-04-10T10:01:01',
      scope: 'myproject',
      summary: 'auth implementation',
    });
    db.insertConversationContent(w1, makeWindowContent(SAMPLE_LINES));
    db.insertDecisions(w1, [
      { seq: 0, summary: 'Use bcrypt for passwords', terms: 'bcrypt,auth', status: 'active' },
      { seq: 1, summary: 'Signed httpOnly cookies for sessions', terms: 'session,cookie', status: 'active' },
    ]);
    db.insertSearchTerms(w1, ['auth', 'sessions'], ['bcrypt', 'cookies']);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('findWindow locates window by session prefix and seq', () => {
    const win = queries.findWindow('sess-abc', 0);
    assert.ok(win);
    assert.equal(win.session_id, 'sess-abc');
    assert.equal(win.seq, 0);
  });

  it('findWindow returns null for nonexistent session/seq', () => {
    const missing = queries.findWindow('nonexistent', 0);
    assert.equal(missing, null);
  });

  it('getWindowDigest returns metadata and decisions without full content', () => {
    const digest = queries.getWindowDigest('sess-abc', 0);
    assert.ok(digest);
    assert.ok(digest.window);
    assert.equal(digest.window.scope, 'myproject');
    assert.ok(Array.isArray(digest.decisions));
    assert.equal(digest.decisions.length, 2);
    assert.equal(digest.decisions[0].summary, 'Use bcrypt for passwords');
    // Should not include full content
    assert.equal(digest.content, undefined);
  });

  it('getWindowDecisionsBySeq returns decisions for the window', () => {
    const decisions = queries.getWindowDecisionsBySeq('sess-abc', 0);
    assert.ok(Array.isArray(decisions));
    assert.equal(decisions.length, 2);
    assert.equal(decisions[1].summary, 'Signed httpOnly cookies for sessions');
  });

  it('getWindowDecisionsBySeq returns null for nonexistent window', () => {
    const result = queries.getWindowDecisionsBySeq('nope', 99);
    assert.equal(result, null);
  });

  it('getWindowFullContent returns stored JSONL text for the window', () => {
    const result = queries.getWindowFullContent('sess-abc', 0);
    assert.ok(result);
    assert.ok(result.window);
    assert.ok(typeof result.content === 'string');
    assert.ok(result.content.includes('bcrypt'));
  });

  it('getWindowFullContent returns empty content for window with no stored content', () => {
    // Insert a window with no content
    db.insertSession('sess-empty', '2026-04-11T00:00:00', []);
    db.insertWindow('sess-empty', 0, { scope: 'x', summary: 'no content' });
    const result = queries.getWindowFullContent('sess-empty', 0);
    assert.ok(result);
    assert.equal(result.content, '');
  });

  it('getWindowFullContent returns null for nonexistent window', () => {
    const result = queries.getWindowFullContent('missing', 5);
    assert.equal(result, null);
  });

  it('searchConversations finds the seeded window', () => {
    const results = queries.searchConversations([['auth']]);
    assert.ok(results.length >= 1);
    assert.equal(results[0].session_id, 'sess-abc');
    assert.ok(Array.isArray(results[0].decisions));
  });
});
