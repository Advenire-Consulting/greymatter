const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { ingestSession, scanForSessions } = require('../lib/ingest');

function tmpDbPath() {
  return path.join(__dirname, `test-ingest-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tmpDir() {
  const dir = path.join(__dirname, `test-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Create a minimal JSONL fixture simulating a Claude Code conversation
function createFixtureJsonl(dir, sessionId) {
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({ type: 'summary', session_id: sessionId, cwd: '/home/user/project' }),
    JSON.stringify({ type: 'human', message: { role: 'user', content: 'Fix the bug in lib/server.js' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'I\'ll look at the file.' } }),
    JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: '/home/user/project/lib/server.js' } }),
    JSON.stringify({ type: 'tool_result', content: 'file contents here' }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Found the issue. Fixing now.' } }),
    JSON.stringify({ type: 'tool_use', name: 'Edit', input: { file_path: '/home/user/project/lib/server.js' } }),
    JSON.stringify({ type: 'tool_result', content: 'edit applied' }),
    JSON.stringify({ type: 'result', session_id: sessionId }),
  ];
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

describe('ingest', () => {
  let dbPath, db, convDir;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    convDir = tmpDir();
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.rmSync(convDir, { recursive: true, force: true }); } catch {}
  });

  it('ingests a session from JSONL', () => {
    const jsonlPath = createFixtureJsonl(convDir, 'test-session-1');
    const stats = ingestSession(jsonlPath, db);
    assert.ok(stats.windowsCreated >= 1);
    // Session should exist in DB
    const session = db.db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-session-1');
    assert.ok(session);
  });

  it('stores conversation content', () => {
    const jsonlPath = createFixtureJsonl(convDir, 'test-session-2');
    ingestSession(jsonlPath, db);
    const windows = db.db.prepare(
      'SELECT w.id FROM windows w JOIN sessions s ON w.session_id = s.id WHERE s.id = ?'
    ).all('test-session-2');
    assert.ok(windows.length >= 1);
    const content = db.db.prepare('SELECT * FROM conversation_content WHERE window_id = ?').get(windows[0].id);
    assert.ok(content);
  });

  it('extracts file paths from tool calls', () => {
    const jsonlPath = createFixtureJsonl(convDir, 'test-session-3');
    ingestSession(jsonlPath, db);
    const windows = db.db.prepare(
      'SELECT w.id FROM windows w WHERE w.session_id = ?'
    ).all('test-session-3');
    const files = db.db.prepare('SELECT * FROM window_files WHERE window_id = ?').all(windows[0].id);
    assert.ok(files.length >= 1);
    assert.ok(files.some(f => f.file_path.includes('server.js')));
  });

  it('skips already-ingested files', () => {
    const jsonlPath = createFixtureJsonl(convDir, 'test-session-4');
    ingestSession(jsonlPath, db);
    const stats2 = ingestSession(jsonlPath, db);
    assert.equal(stats2.windowsCreated, 0);
    assert.equal(stats2.skipped, true);
  });

  it('scanForSessions finds JSONL files in directory', () => {
    createFixtureJsonl(convDir, 'sess-a');
    createFixtureJsonl(convDir, 'sess-b');
    const files = scanForSessions(convDir);
    assert.ok(files.length >= 2);
  });

  // Boundary-type assignment — Chunk 5

  function writeJsonl(filePath, objects) {
    fs.writeFileSync(filePath, objects.map(o => JSON.stringify(o)).join('\n') + '\n');
  }

  it('boundary_type: single window with no compact boundary is session_start', () => {
    const jsonlPath = path.join(convDir, 'bound-a.jsonl');
    writeJsonl(jsonlPath, [
      { type: 'summary', session_id: 'bound-a', cwd: '/tmp/p', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'hello' }, timestamp: '2026-01-01T00:00:01Z' },
    ]);
    ingestSession(jsonlPath, db);
    const rows = db.db.prepare('SELECT boundary_type FROM windows ORDER BY seq').all();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].boundary_type, 'session_start');
  });

  it('boundary_type: compact boundary with default trigger yields session_start then compact', () => {
    const jsonlPath = path.join(convDir, 'bound-b.jsonl');
    writeJsonl(jsonlPath, [
      { type: 'summary', session_id: 'bound-b', cwd: '/tmp/p', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'first' }, timestamp: '2026-01-01T00:00:01Z' },
      { type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:02Z' },
      { type: 'user', message: { content: 'second' }, timestamp: '2026-01-01T00:00:03Z' },
    ]);
    ingestSession(jsonlPath, db);
    const rows = db.db.prepare('SELECT boundary_type FROM windows ORDER BY seq').all();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].boundary_type, 'session_start');
    assert.strictEqual(rows[1].boundary_type, 'compact');
  });

  it('boundary_type: compact boundary with clear trigger yields session_start then clear', () => {
    const jsonlPath = path.join(convDir, 'bound-c.jsonl');
    writeJsonl(jsonlPath, [
      { type: 'summary', session_id: 'bound-c', cwd: '/tmp/p', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'first' }, timestamp: '2026-01-01T00:00:01Z' },
      { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'clear' }, timestamp: '2026-01-01T00:00:02Z' },
      { type: 'user', message: { content: 'second' }, timestamp: '2026-01-01T00:00:03Z' },
    ]);
    ingestSession(jsonlPath, db);
    const rows = db.db.prepare('SELECT boundary_type FROM windows ORDER BY seq').all();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].boundary_type, 'session_start');
    assert.strictEqual(rows[1].boundary_type, 'clear');
  });

  it('boundary_type: no window is ever tagged session_end (regression guard)', () => {
    const jsonlPath = path.join(convDir, 'bound-d.jsonl');
    writeJsonl(jsonlPath, [
      { type: 'summary', session_id: 'bound-d', cwd: '/tmp/p', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { content: 'only' }, timestamp: '2026-01-01T00:00:01Z' },
    ]);
    ingestSession(jsonlPath, db);
    const row = db.db.prepare("SELECT COUNT(*) AS n FROM windows WHERE boundary_type = 'session_end'").get();
    assert.strictEqual(row.n, 0);
  });

  it('ingestSession rolls back on mid-ingest failure', () => {
    const jsonlPath = path.join(convDir, 'test-rollback.jsonl');
    const lines = [
      JSON.stringify({ type: 'summary', session_id: 'rollback-test', cwd: '/tmp/test', timestamp: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'user', message: { content: 'hello world test' }, timestamp: '2026-01-01T00:00:01Z' }),
    ];
    fs.writeFileSync(jsonlPath, lines.join('\n'));

    // Sabotage: replace insertSearchTerms to throw after session+window are inserted
    const origStmt = db._stmts.insertSearchTerms;
    db._stmts.insertSearchTerms = { run: () => { throw new Error('deliberate test failure'); } };

    // ingestSession should throw (transaction aborts)
    assert.throws(() => ingestSession(jsonlPath, db), /deliberate test failure/);

    // Verify rollback: no session, no windows, file not marked ingested
    const sessions = db.db.prepare('SELECT * FROM sessions').all();
    assert.strictEqual(sessions.length, 0, 'session should be rolled back');
    const windows = db.db.prepare('SELECT * FROM windows').all();
    assert.strictEqual(windows.length, 0, 'windows should be rolled back');
    assert.strictEqual(db.isFileIngested(jsonlPath), false, 'file should not be marked ingested');

    // Restore
    db._stmts.insertSearchTerms = origStmt;
  });
});
