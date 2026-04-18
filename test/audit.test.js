'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { GraphDB } = require('../lib/graph-db');
const { SEED_EDGE_TYPES } = require('../lib/edge-types');
const {
  checkOrphanedNodes,
  checkMissingEdgeTypeRegistrations,
  checkOrphanedAnnotations,
  checkStaleDocumentaryEdges,
  checkFileHashMismatches,
  formatItem,
} = require('../scripts/audit');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-audit-'));
}

function tmpDbPath() {
  return path.join(os.tmpdir(), `gm-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('audit.formatItem', () => {
  it('renders msg only when no file/line', () => {
    assert.equal(formatItem({ msg: 'oops' }), '  oops');
  });

  it('appends file', () => {
    assert.equal(formatItem({ msg: 'oops', file: 'a.js' }), '  oops\n  a.js');
  });

  it('appends file:line', () => {
    assert.equal(formatItem({ msg: 'oops', file: 'a.js', line: 42 }), '  oops\n  a.js:42');
  });
});

describe('audit.checkOrphanedNodes', () => {
  let dbPath, graphDb, db;

  beforeEach(() => {
    dbPath = tmpDbPath();
    graphDb = new GraphDB(dbPath);
    db = graphDb.db;
    for (const et of SEED_EDGE_TYPES) graphDb.registerEdgeType(et);
  });

  afterEach(() => {
    graphDb.close();
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('flags nodes with no edges', () => {
    graphDb.upsertNode({ project: 'p', file: 'orphan.js', name: 'orphan', type: 'function', line: 1 });
    const findings = checkOrphanedNodes(db);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'warning');
    assert.match(findings[0].msg, /Orphaned node/);
  });

  it('does not flag nodes with at least one edge', () => {
    const a = graphDb.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    const b = graphDb.upsertNode({ project: 'p', file: 'b.js', name: 'b', type: 'function', line: 1 });
    graphDb.insertEdge({ sourceId: a, targetId: b, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'a.js' });
    assert.equal(checkOrphanedNodes(db).length, 0);
  });

  it('filters by project when passed', () => {
    graphDb.upsertNode({ project: 'p1', file: 'x.js', name: 'x', type: 'function', line: 1 });
    graphDb.upsertNode({ project: 'p2', file: 'y.js', name: 'y', type: 'function', line: 1 });
    assert.equal(checkOrphanedNodes(db, 'p1').length, 1);
    assert.equal(checkOrphanedNodes(db, 'p2').length, 1);
    assert.equal(checkOrphanedNodes(db).length, 2);
  });
});

describe('audit.checkMissingEdgeTypeRegistrations', () => {
  let dbPath, graphDb, db;

  beforeEach(() => {
    dbPath = tmpDbPath();
    graphDb = new GraphDB(dbPath);
    db = graphDb.db;
  });

  afterEach(() => {
    graphDb.close();
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('returns [] when every edge type used is registered', () => {
    for (const et of SEED_EDGE_TYPES) graphDb.registerEdgeType(et);
    const a = graphDb.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    const b = graphDb.upsertNode({ project: 'p', file: 'b.js', name: 'b', type: 'function', line: 1 });
    graphDb.insertEdge({ sourceId: a, targetId: b, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'a.js' });
    assert.deepEqual(checkMissingEdgeTypeRegistrations(db), []);
  });

  it('flags an edge type that is not in edge_types', () => {
    // Manually register a type, insert edges, then delete the type row to simulate drift.
    graphDb.registerEdgeType({ name: 'rogue', category: 'structural', followsForBlastRadius: false });
    const a = graphDb.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    const b = graphDb.upsertNode({ project: 'p', file: 'b.js', name: 'b', type: 'function', line: 1 });
    graphDb.insertEdge({ sourceId: a, targetId: b, type: 'rogue', category: 'structural', sourceProject: 'p', sourceFile: 'a.js' });
    db.prepare("DELETE FROM edge_types WHERE name = 'rogue'").run();
    const findings = checkMissingEdgeTypeRegistrations(db);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
    assert.match(findings[0].msg, /rogue/);
  });
});

describe('audit.checkOrphanedAnnotations', () => {
  let dbPath, graphDb, db;

  beforeEach(() => {
    dbPath = tmpDbPath();
    graphDb = new GraphDB(dbPath);
    db = graphDb.db;
  });

  afterEach(() => {
    graphDb.close();
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('returns [] when every annotation has a matching node', () => {
    const id = graphDb.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    db.prepare('INSERT INTO annotations (node_id, content) VALUES (?, ?)').run(id, 'note');
    assert.deepEqual(checkOrphanedAnnotations(db), []);
  });

  it('flags annotations that reference missing nodes', () => {
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare('INSERT INTO annotations (node_id, content) VALUES (?, ?)').run(9999, 'orphan note');
    db.prepare('PRAGMA foreign_keys = ON').run();
    const findings = checkOrphanedAnnotations(db);
    assert.equal(findings.length, 1);
    assert.match(findings[0].msg, /Orphaned annotation/);
  });
});

describe('audit.checkStaleDocumentaryEdges', () => {
  let dbPath, graphDb, db, workspace;

  beforeEach(() => {
    dbPath = tmpDbPath();
    graphDb = new GraphDB(dbPath);
    db = graphDb.db;
    for (const et of SEED_EDGE_TYPES) graphDb.registerEdgeType(et);
    workspace = makeTmp();
  });

  afterEach(() => {
    graphDb.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('flags documentary edges whose target file is missing on disk', () => {
    const projectDir = path.join(workspace, 'p');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# ok');

    const source = graphDb.upsertNode({ project: 'p', file: 'README.md', name: 'Main', type: 'doc_section', line: 1 });
    const target = graphDb.upsertNode({ project: 'p', file: 'deleted.js', name: 'deleted.js', type: 'module', line: 1 });
    graphDb.insertEdge({ sourceId: source, targetId: target, type: 'describes', category: 'documentary', sourceProject: 'p', sourceFile: 'README.md' });

    const findings = checkStaleDocumentaryEdges(db, null, workspace);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
    assert.match(findings[0].msg, /target file "deleted.js" no longer exists/);
  });

  it('does not flag when target exists', () => {
    const projectDir = path.join(workspace, 'p');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# ok');
    fs.writeFileSync(path.join(projectDir, 'real.js'), '//');

    const s = graphDb.upsertNode({ project: 'p', file: 'README.md', name: 'Main', type: 'doc_section', line: 1 });
    const t = graphDb.upsertNode({ project: 'p', file: 'real.js', name: 'real.js', type: 'module', line: 1 });
    graphDb.insertEdge({ sourceId: s, targetId: t, type: 'describes', category: 'documentary', sourceProject: 'p', sourceFile: 'README.md' });

    assert.deepEqual(checkStaleDocumentaryEdges(db, null, workspace), []);
  });
});

describe('audit.checkFileHashMismatches', () => {
  let dbPath, graphDb, db, workspace;

  beforeEach(() => {
    dbPath = tmpDbPath();
    graphDb = new GraphDB(dbPath);
    db = graphDb.db;
    workspace = makeTmp();
    const projectDir = path.join(workspace, 'p');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    graphDb.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it('returns [] without a workspace dir (cannot check)', () => {
    graphDb.setFileHash('p', 'a.js', 'abc');
    assert.deepEqual(checkFileHashMismatches(db, null, null), []);
  });

  it('flags files that have been deleted', () => {
    graphDb.setFileHash('p', 'gone.js', 'abc123');
    const findings = checkFileHashMismatches(db, null, workspace);
    assert.equal(findings.length, 1);
    assert.match(findings[0].msg, /no longer exists on disk/);
  });

  it('flags files whose content changed (hash mismatch)', () => {
    const filePath = path.join(workspace, 'p', 'a.js');
    fs.writeFileSync(filePath, 'current content');
    graphDb.setFileHash('p', 'a.js', 'stale-hash-that-does-not-match');
    const findings = checkFileHashMismatches(db, null, workspace);
    assert.equal(findings.length, 1);
    assert.match(findings[0].msg, /changed since last scan/);
  });

  it('returns [] when hashes match', () => {
    const filePath = path.join(workspace, 'p', 'a.js');
    fs.writeFileSync(filePath, 'content');
    const crypto = require('crypto');
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    graphDb.setFileHash('p', 'a.js', actualHash);
    assert.deepEqual(checkFileHashMismatches(db, null, workspace), []);
  });
});
