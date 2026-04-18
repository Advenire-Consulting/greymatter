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
                      'ingested_files', 'stopword_candidates', 'test_alert_runs']) {
      assert.ok(tables.includes(t), `Missing table: ${t}`);
    }
  });

  it('insertWindow persists startLine/endLine/boundaryType', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {
      startLine: 42, endLine: 138, boundaryType: 'manual',
    });
    const row = db.db.prepare('SELECT start_line, end_line, boundary_type FROM windows WHERE id = ?').get(winId);
    assert.equal(row.start_line, 42);
    assert.equal(row.end_line, 138);
    assert.equal(row.boundary_type, 'manual');
  });

  it('insertWindow defaults boundaryType to "compact"', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    const row = db.db.prepare('SELECT boundary_type FROM windows WHERE id = ?').get(winId);
    assert.equal(row.boundary_type, 'compact');
  });

  it('insertDecisions persists startLine/endLine and normalizes array terms/anchors', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    db.insertDecisions(winId, [
      {
        summary: 'Range decision',
        terms: ['sqlite', 'graph'],
        fileAnchors: ['lib/a.js', 'lib/b.js'],
        startLine: 10,
        endLine: 25,
      },
    ]);
    const row = db.db.prepare('SELECT terms, file_anchors, start_line, end_line FROM decisions WHERE window_id = ?').get(winId);
    assert.equal(row.terms, 'sqlite,graph');
    assert.equal(row.file_anchors, JSON.stringify(['lib/a.js', 'lib/b.js']));
    assert.equal(row.start_line, 10);
    assert.equal(row.end_line, 25);
  });
});

describe('MemoryDB signals + forces', () => {
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

  it('insertSignal returns id and stores defaults', () => {
    const id = db.insertSignal({
      type: 'amygdala',
      polarity: '-',
      label: 'Be careful with rm',
    });
    assert.ok(id > 0);
    const row = db.db.prepare('SELECT * FROM signals WHERE id = ?').get(id);
    assert.equal(row.weight, 50);
    assert.equal(row.trigger, 'passive');
    assert.equal(row.archived, 0);
  });

  it('updateSignalWeight + archiveSignal', () => {
    const id = db.insertSignal({ type: 'prefrontal', polarity: '+', label: 'Pause' });
    db.updateSignalWeight(id, 80);
    const updated = db.db.prepare('SELECT weight, updated_at FROM signals WHERE id = ?').get(id);
    assert.equal(updated.weight, 80);
    assert.ok(updated.updated_at, 'updated_at should be set');

    db.archiveSignal(id);
    const archived = db.db.prepare('SELECT archived FROM signals WHERE id = ?').get(id);
    assert.equal(archived.archived, 1);
  });

  it('rejects invalid signal type via CHECK constraint', () => {
    assert.throws(() => {
      db.insertSignal({ type: 'invalid_type', polarity: '+', label: 'x' });
    });
  });

  it('insertForce + updateForceScore + archiveForce', () => {
    const id = db.insertForce({ name: 'Cadence', description: 'Pace of work', score: 70 });
    assert.ok(id > 0);
    db.updateForceScore(id, 85);
    const row = db.db.prepare('SELECT score, archived FROM forces WHERE id = ?').get(id);
    assert.equal(row.score, 85);
    assert.equal(row.archived, 0);
    db.archiveForce(id);
    const after = db.db.prepare('SELECT archived FROM forces WHERE id = ?').get(id);
    assert.equal(after.archived, 1);
  });
});

describe('MemoryDB search index', () => {
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

  it('insertSearchTerms is a no-op when both sides are empty', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    db.insertSearchTerms(winId, '', '');
    const count = db.db.prepare('SELECT COUNT(*) AS c FROM search_index').get().c;
    assert.equal(count, 0);
  });

  it('insertSearchTerms accepts arrays and indexes the joined strings', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    db.insertSearchTerms(winId, ['hello', 'world'], ['greeting']);
    // search_index is a contentless FTS5 table — values aren't stored as rows.
    // Verify via MATCH that the tokens are indexed under this rowid.
    const hits = db.db.prepare(
      "SELECT rowid FROM search_index WHERE search_index MATCH ?"
    ).all('hello world greeting');
    assert.ok(hits.some(h => h.rowid === Number(winId)),
      `rowid ${winId} should match query (got rowids ${hits.map(h => h.rowid).join(',')})`);
  });

  it('rebuildSearchIndex extracts tokens from conversation content', () => {
    db.insertSession('sess-1', '2026-04-12T10:00:00', []);
    const winId = db.insertWindow('sess-1', 0, {});
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'graph database query' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'sqlite nodes edges' }] } }),
    ].join('\n');
    db.insertConversationContent(winId, jsonl);
    db.rebuildSearchIndex();
    // MATCH across both columns — contentless FTS doesn't let us read column text back,
    // so verify the indexed tokens are findable.
    const userHits = db.db.prepare(
      "SELECT rowid FROM search_index WHERE user_terms MATCH ?"
    ).all('graph');
    assert.ok(userHits.some(h => h.rowid === Number(winId)), 'user tokens should be indexed');
    const assistantHits = db.db.prepare(
      "SELECT rowid FROM search_index WHERE assistant_terms MATCH ?"
    ).all('sqlite');
    assert.ok(assistantHits.some(h => h.rowid === Number(winId)), 'assistant tokens should be indexed');
  });
});

describe('MemoryDB.insertTestAlertRun', () => {
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

  it('stores a run and returns its id', () => {
    const id = db.insertTestAlertRun({
      project: 'greymatter',
      sha: 'abc1234',
      mode: 'incremental',
      findingsJson: JSON.stringify({ stalePairs: [], missingTests: [] }),
      openCount: 0,
      resolvedCount: 0,
    });
    assert.ok(id > 0);
    const row = db.db.prepare('SELECT * FROM test_alert_runs WHERE id = ?').get(id);
    assert.equal(row.project, 'greymatter');
    assert.equal(row.sha, 'abc1234');
    assert.equal(row.mode, 'incremental');
    assert.equal(row.open_count, 0);
  });

  it('rejects invalid mode via CHECK constraint', () => {
    assert.throws(() => {
      db.insertTestAlertRun({
        project: 'p', sha: 'x', mode: 'bogus',
        findingsJson: '{}', openCount: 0, resolvedCount: 0,
      });
    });
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
    db.insertAlias('api', 'api-gateway', null, 'seed');
    db.insertAlias('api', 'api-gateway', null, 'seed');
    const count = db.db.prepare("SELECT COUNT(*) as c FROM aliases WHERE alias = 'api'").get().c;
    assert.equal(count, 1);
  });
});
