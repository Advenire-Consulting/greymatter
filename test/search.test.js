'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('conversation search', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    queries = new MemoryQueries(db);
    // Seed test data: two sessions with searchable content
    db.insertSession('s1', '2026-04-10T10:00:00', ['projectA']);
    const w1 = db.insertWindow('s1', 0, { scope: 'projectA', summary: 'worked on auth' });
    db.insertSearchTerms(w1, ['auth', 'login', 'session', 'cookie'], ['secureCookieOptions', 'bcrypt']);
    db.insertDecisions(w1, [{ summary: 'Use bcrypt with 12 rounds', terms: 'bcrypt,auth', status: 'active' }]);

    db.insertSession('s2', '2026-04-11T14:00:00', ['projectB']);
    const w2 = db.insertWindow('s2', 0, { scope: 'projectB', summary: 'database migration' });
    db.insertSearchTerms(w2, ['database', 'migration', 'schema'], ['ALTER', 'sqlite']);
    db.insertDecisions(w2, [{ summary: 'Add index on company_id', terms: 'index,schema', status: 'active' }]);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('searches by single term', () => {
    const results = queries.searchConversations([['auth']]);
    assert.ok(results.length >= 1);
    assert.equal(results[0].session_id, 's1');
  });

  it('OR terms within a cluster broaden results', () => {
    const results = queries.searchConversations([['auth', 'database']]);
    assert.ok(results.length >= 2);
  });

  it('multiple clusters narrow results (AND)', () => {
    const results = queries.searchConversations([['auth'], ['bcrypt']]);
    assert.ok(results.length >= 1);
    assert.ok(results.every(r => r.session_id === 's1'));
  });

  it('results include decision digests', () => {
    const results = queries.searchConversations([['auth']]);
    assert.ok(results[0].decisions);
    assert.ok(results[0].decisions.length >= 1);
  });

  it('limit caps results', () => {
    const results = queries.searchConversations([['auth', 'database']], 1);
    assert.equal(results.length, 1);
  });
});
