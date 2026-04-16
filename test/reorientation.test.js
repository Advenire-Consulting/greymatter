'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const { buildProjectContext, getProjectContext, listProjectContexts } = require('../lib/reorientation');

describe('reorientation', () => {
  let tmpDir, graphDbPath, memoryDbPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-reorient-'));
    graphDbPath = path.join(tmpDir, 'graph.db');
    memoryDbPath = path.join(tmpDir, 'memory.db');

    // Seed graph.db with known project nodes
    const graphDb = new Database(graphDbPath);
    graphDb.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, file TEXT NOT NULL,
        name TEXT NOT NULL, type TEXT NOT NULL,
        line INTEGER, metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_unique
        ON nodes(project, file, name, type, COALESCE(line, -1));
    `);
    graphDb.prepare('INSERT INTO nodes (project, file, name, type, line) VALUES (?, ?, ?, ?, ?)')
      .run('my-project', 'lib/foo.js', 'foo.js', 'module', 1);
    graphDb.prepare('INSERT INTO nodes (project, file, name, type, line) VALUES (?, ?, ?, ?, ?)')
      .run('other-project', 'index.js', 'index.js', 'module', 1);
    graphDb.close();

    // Seed memory.db with sessions, windows, window_files, decisions
    const memDb = new Database(memoryDbPath);
    memDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, start_time DATETIME, end_time DATETIME,
        projects_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seq INTEGER NOT NULL, start_line INTEGER, end_line INTEGER,
        start_time DATETIME, end_time DATETIME,
        scope TEXT, summary TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        boundary_type TEXT DEFAULT 'compact',
        UNIQUE(session_id, seq)
      );
      CREATE TABLE window_files (
        window_id INTEGER NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL, lines INTEGER, tool TEXT,
        UNIQUE(window_id, file_path)
      );
      CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        window_id INTEGER NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
        seq INTEGER, summary TEXT NOT NULL,
        terms TEXT, file_anchors TEXT, status TEXT DEFAULT 'active',
        start_line INTEGER, end_line INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Session 1 — touches my-project
    memDb.prepare('INSERT INTO sessions (id, start_time) VALUES (?, ?)').run('sess-1', '2026-04-16T10:00:00Z');
    memDb.prepare('INSERT INTO windows (session_id, seq) VALUES (?, ?)').run('sess-1', 0);
    const w1 = memDb.prepare('SELECT last_insert_rowid() as id').get().id;
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w1, '/home/user/websites/my-project/lib/foo.js');
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w1, '/home/user/websites/my-project/lib/bar.js');
    memDb.prepare('INSERT INTO decisions (window_id, seq, summary, terms) VALUES (?, ?, ?, ?)').run(w1, 0, 'refactor, auth, tokens', 'refactor,auth,tokens');
    memDb.prepare('INSERT INTO decisions (window_id, seq, summary, terms) VALUES (?, ?, ?, ?)').run(w1, 1, 'auth, session, cookies', 'auth,session,cookies');

    // Session 2 — touches both projects
    memDb.prepare('INSERT INTO sessions (id, start_time) VALUES (?, ?)').run('sess-2', '2026-04-15T10:00:00Z');
    memDb.prepare('INSERT INTO windows (session_id, seq) VALUES (?, ?)').run('sess-2', 0);
    const w2 = memDb.prepare('SELECT last_insert_rowid() as id').get().id;
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w2, '/home/user/websites/my-project/routes.js');
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w2, '/home/user/websites/other-project/index.js');
    memDb.prepare('INSERT INTO decisions (window_id, seq, summary, terms) VALUES (?, ?, ?, ?)').run(w2, 0, 'routing, endpoints, api', 'routing,endpoints,api');

    // Session 3 — touches only other-project
    memDb.prepare('INSERT INTO sessions (id, start_time) VALUES (?, ?)').run('sess-3', '2026-04-14T10:00:00Z');
    memDb.prepare('INSERT INTO windows (session_id, seq) VALUES (?, ?)').run('sess-3', 0);
    const w3 = memDb.prepare('SELECT last_insert_rowid() as id').get().id;
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w3, '/home/user/websites/other-project/lib/utils.js');
    memDb.prepare('INSERT INTO decisions (window_id, seq, summary, terms) VALUES (?, ?, ?, ?)').run(w3, 0, 'utility, helpers', 'utility,helpers');

    memDb.close();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds context for projects that have sessions', () => {
    const result = buildProjectContext(memoryDbPath, graphDbPath);
    assert.equal(result.projectCount, 2);
    assert.ok(result.sessionCount >= 2);
  });

  it('stores correct sessions per project', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const ctx = getProjectContext(graphDbPath, 'my-project');
    assert.ok(ctx);
    assert.equal(ctx.length, 2); // sess-1 and sess-2
    assert.equal(ctx[0].session_id, 'sess-1'); // most recent first
    assert.equal(ctx[0].date, '2026-04-16');
  });

  it('includes files scoped to the project', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const ctx = getProjectContext(graphDbPath, 'my-project');
    // Session 1 files should be project-relative
    assert.ok(ctx[0].files.includes('lib/foo.js'));
    assert.ok(ctx[0].files.includes('lib/bar.js'));
    // Should NOT include other-project files
    assert.ok(!ctx[0].files.some(f => f.includes('other-project')));
  });

  it('includes decision summaries', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const ctx = getProjectContext(graphDbPath, 'my-project');
    assert.ok(ctx[0].decisions.length > 0);
    // 'auth' appears in both decisions for sess-1, should be top term
    assert.ok(ctx[0].decisions.includes('auth'));
  });

  it('cross-project session appears in both', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const myCtx = getProjectContext(graphDbPath, 'my-project');
    const otherCtx = getProjectContext(graphDbPath, 'other-project');
    // sess-2 touched both — should appear in both
    assert.ok(myCtx.some(s => s.session_id === 'sess-2'));
    assert.ok(otherCtx.some(s => s.session_id === 'sess-2'));
  });

  it('listProjectContexts returns all projects with dates', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const list = listProjectContexts(graphDbPath);
    assert.equal(list.length, 2);
    const myEntry = list.find(l => l.project === 'my-project');
    assert.ok(myEntry);
    assert.equal(myEntry.lastDate, '2026-04-16');
    assert.ok(myEntry.sessionCount >= 1);
  });

  it('returns null for unknown project', () => {
    const ctx = getProjectContext(graphDbPath, 'nonexistent');
    assert.equal(ctx, null);
  });

  it('uses terms column when present, not summary with em-dash leakage', () => {
    const memDb = new Database(memoryDbPath);
    memDb.prepare('INSERT INTO sessions (id, start_time) VALUES (?, ?)').run('sess-emdash', '2026-04-13T10:00:00Z');
    memDb.prepare('INSERT INTO windows (session_id, seq) VALUES (?, ?)').run('sess-emdash', 0);
    const w = memDb.prepare('SELECT last_insert_rowid() as id').get().id;
    memDb.prepare('INSERT INTO window_files (window_id, file_path) VALUES (?, ?)').run(w, '/home/user/websites/my-project/x.js');
    memDb.prepare('INSERT INTO decisions (window_id, seq, summary, terms) VALUES (?, ?, ?, ?)').run(
      w, 0, 'design, spec, user — x.js', 'design,spec,user'
    );
    memDb.close();

    buildProjectContext(memoryDbPath, graphDbPath);
    const ctx = getProjectContext(graphDbPath, 'my-project');
    const emdashSession = ctx.find(s => s.session_id === 'sess-emdash');
    assert.ok(emdashSession, 'sess-emdash should be indexed');
    for (const term of emdashSession.decisions) {
      assert.ok(!term.includes('—'), `decision "${term}" leaked em-dash`);
      assert.ok(!term.endsWith('.js'), `decision "${term}" leaked a filename`);
    }
  });

  it('is idempotent — running twice produces same result', () => {
    buildProjectContext(memoryDbPath, graphDbPath);
    const first = getProjectContext(graphDbPath, 'my-project');
    buildProjectContext(memoryDbPath, graphDbPath);
    const second = getProjectContext(graphDbPath, 'my-project');
    assert.deepEqual(first, second);
  });
});
