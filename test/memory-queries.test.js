const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-mq-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// Helper: seed a fully populated memory.db for query tests
function seed(db) {
  db.insertSession('sess-a', '2026-04-10T08:00:00', ['proj-alpha']);
  db.insertSession('sess-b', '2026-04-11T09:00:00', ['proj-beta', 'proj-alpha']);
  db.insertSession('sess-c', '2026-04-12T10:00:00', ['proj-gamma']);

  const wA0 = db.insertWindow('sess-a', 0, { startLine: 0, endLine: 50, scope: 'proj-alpha' });
  const wB0 = db.insertWindow('sess-b', 0, { startLine: 0, endLine: 80, scope: 'proj-beta' });
  const wB1 = db.insertWindow('sess-b', 1, { startLine: 81, endLine: 160, scope: 'proj-alpha' });
  const wC0 = db.insertWindow('sess-c', 0, { startLine: 0, endLine: 40, scope: 'proj-gamma' });

  db.insertConversationContent(wA0, 'user: hello\nassistant: world');
  db.insertConversationContent(wB0, 'user: fix it\nassistant: done');

  db.insertWindowFiles(wA0, [
    { filePath: 'lib/a.js', tool: 'Read' },
    { filePath: 'lib/b.js', tool: 'Edit' },
  ]);
  db.insertWindowFiles(wB0, [
    { filePath: 'lib/c.js', tool: 'Write' },
  ]);

  db.insertDecisions(wA0, [
    { seq: 0, summary: 'Use WAL mode', terms: 'wal,sqlite', fileAnchors: 'lib/db.js', status: 'active' },
  ]);
  db.insertDecisions(wB0, [
    { seq: 0, summary: 'Refactor scanner', terms: 'scanner,refactor', status: 'active' },
  ]);

  db.insertAlias('brain', 'thebrain', 'lib/brain.js', 'seed');
  db.insertAlias('alpha', 'proj-alpha', null, 'seed');
  db.insertAlias('beta-lib', 'proj-beta', 'lib/beta.js', 'seed');

  return { wA0, wB0, wB1, wC0 };
}

describe('MemoryQueries', () => {
  let db, mq, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    mq = new MemoryQueries(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('getRecentSessions returns sessions ordered by start_time DESC, capped at limit', () => {
    seed(db);
    const sessions = mq.getRecentSessions(2);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, 'sess-c');
    assert.equal(sessions[1].id, 'sess-b');
  });

  it('getWindowsForSession returns all windows for a session in seq order', () => {
    seed(db);
    const windows = mq.getWindowsForSession('sess-b');
    assert.equal(windows.length, 2);
    assert.equal(windows[0].seq, 0);
    assert.equal(windows[1].seq, 1);
  });

  it('getWindowContent returns conversation text for a window', () => {
    const { wA0 } = seed(db);
    const content = mq.getWindowContent(wA0);
    assert.ok(content);
    assert.ok(content.content.includes('hello'));
  });

  it('getWindowContent returns null for a window with no content', () => {
    const { wB1 } = seed(db);
    const content = mq.getWindowContent(wB1);
    assert.equal(content, null);
  });

  it('getWindowFiles returns file records for a window', () => {
    const { wA0 } = seed(db);
    const files = mq.getWindowFiles(wA0);
    assert.equal(files.length, 2);
    assert.ok(files.some(f => f.file_path === 'lib/a.js'));
  });

  it('getDecisions returns decisions for a window in seq order', () => {
    const { wA0 } = seed(db);
    const decs = mq.getDecisions(wA0);
    assert.equal(decs.length, 1);
    assert.equal(decs[0].summary, 'Use WAL mode');
  });

  it('getLastSessionForProject finds session by exact project name', () => {
    seed(db);
    const sess = mq.getLastSessionForProject('proj-alpha');
    // sess-b (2026-04-11) and sess-a (2026-04-10) both have proj-alpha; sess-b is more recent
    assert.equal(sess.id, 'sess-b');
  });

  it('getLastSessionForProject returns null for unknown project', () => {
    seed(db);
    const sess = mq.getLastSessionForProject('proj-unknown');
    assert.equal(sess, null);
  });

  it('resolveAliases returns project + file rows for known alias', () => {
    seed(db);
    const rows = mq.resolveAliases('brain');
    assert.ok(rows.length > 0);
    assert.equal(rows[0].project, 'thebrain');
    assert.equal(rows[0].file, 'lib/brain.js');
  });

  it('resolveAliases returns empty array for unknown alias', () => {
    seed(db);
    const rows = mq.resolveAliases('nonexistent');
    assert.deepEqual(rows, []);
  });

  it('listAliases returns all aliases when no project filter', () => {
    seed(db);
    const aliases = mq.listAliases();
    assert.equal(aliases.length, 3);
  });

  it('listAliases filters by project', () => {
    seed(db);
    const aliases = mq.listAliases('proj-beta');
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].alias, 'beta-lib');
  });
});
