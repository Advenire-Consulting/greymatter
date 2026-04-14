const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');

function tmpDbPath() {
  return path.join(__dirname, `test-memory-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('MemoryDB', () => {
  let db, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('creates all tables', () => {
    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(r => r.name);
    for (const t of ['sessions', 'windows', 'conversation_content', 'window_files',
                      'decisions', 'signals', 'forces', 'aliases',
                      'ingested_files', 'stopword_candidates']) {
      assert.ok(tables.includes(t), `Missing table: ${t}`);
    }
  });

  it('insertSession + insertWindow + insertConversationContent', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', ['proj1']);
    const winId = db.insertWindow('sess-1', 0, {
      startLine: 1, endLine: 100,
      startTime: '2026-04-12T10:00:00', endTime: '2026-04-12T10:30:00',
      scope: 'proj1 work', summary: 'Did stuff'
    });
    assert.ok(winId > 0);
    db.insertConversationContent(winId, '{"role":"user","content":"hello"}');
    const content = db.db.prepare('SELECT content FROM conversation_content WHERE window_id = ?').get(winId);
    assert.ok(content.content.includes('hello'));
  });

  it('insertWindowFiles stores file records', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    db.insertWindowFiles(winId, [
      { filePath: 'lib/a.js', lines: 50, tool: 'Edit' },
      { filePath: 'lib/b.js', lines: 30, tool: 'Read' },
    ]);
    const files = db.db.prepare('SELECT * FROM window_files WHERE window_id = ?').all(winId);
    assert.equal(files.length, 2);
  });

  it('insertDecisions stores decisions', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    db.insertDecisions(winId, [
      { summary: 'Use SQLite for graph', terms: 'sqlite,graph', fileAnchors: 'lib/db.js', status: 'active' },
    ]);
    const decs = db.db.prepare('SELECT * FROM decisions WHERE window_id = ?').all(winId);
    assert.equal(decs.length, 1);
    assert.equal(decs[0].summary, 'Use SQLite for graph');
  });

  it('markFileIngested + isFileIngested', () => {
    assert.equal(db.isFileIngested('/path/to/session.jsonl'), false);
    db.markFileIngested('/path/to/session.jsonl', 1024);
    assert.equal(db.isFileIngested('/path/to/session.jsonl'), true);
  });

  it('insertAlias is idempotent', () => {
    db.insertAlias('brain', 'thebrain', null, 'seed');
    db.insertAlias('brain', 'thebrain', null, 'seed');
    const count = db.db.prepare("SELECT COUNT(*) as c FROM aliases WHERE alias = 'brain'").get().c;
    assert.equal(count, 1);
  });
});
