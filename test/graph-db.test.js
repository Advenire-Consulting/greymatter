'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphDB } = require('../lib/graph-db');

function tmpDbPath() {
  return path.join(__dirname, `test-graph-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GraphDB', () => {
  let db, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('creates all tables and indexes', () => {
    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map(r => r.name);
    assert.ok(tables.includes('nodes'));
    assert.ok(tables.includes('edges'));
    assert.ok(tables.includes('edge_types'));
    assert.ok(tables.includes('file_hashes'));
    assert.ok(tables.includes('annotations'));
  });

  it('upsertNode inserts and returns id', () => {
    const id = db.upsertNode({
      project: 'myproject', file: 'lib/foo.js',
      name: 'doStuff', type: 'function', line: 10, metadata: { async: true }
    });
    assert.ok(id > 0);
    const row = db.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    assert.equal(row.name, 'doStuff');
    assert.equal(row.type, 'function');
    assert.equal(row.line, 10);
    assert.deepEqual(JSON.parse(row.metadata_json), { async: true });
  });

  it('upsertNode updates on duplicate (project, file, name, type, line)', () => {
    const id1 = db.upsertNode({
      project: 'p', file: 'f.js', name: 'fn', type: 'function', line: 5,
      metadata: { v: 1 }
    });
    const id2 = db.upsertNode({
      project: 'p', file: 'f.js', name: 'fn', type: 'function', line: 5,
      metadata: { v: 2 }
    });
    assert.equal(id1, id2);
    const row = db.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id1);
    assert.deepEqual(JSON.parse(row.metadata_json), { v: 2 });
  });

  it('insertEdge creates an edge between nodes', () => {
    const src = db.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    const tgt = db.upsertNode({ project: 'p', file: 'b.js', name: 'b', type: 'module', line: 1 });
    const edgeId = db.insertEdge({
      sourceId: src, targetId: tgt,
      type: 'imports', category: 'structural',
      sourceProject: 'p', sourceFile: 'a.js'
    });
    assert.ok(edgeId > 0);
  });

  it('registerEdgeType inserts new types', () => {
    db.registerEdgeType({
      name: 'imports', category: 'structural',
      followsForBlastRadius: true, impliesStaleness: false,
      description: 'ES/CJS module import'
    });
    const row = db.db.prepare('SELECT * FROM edge_types WHERE name = ?').get('imports');
    assert.equal(row.category, 'structural');
    assert.equal(row.follows_for_blast_radius, 1);
  });

  it('registerEdgeType is idempotent for existing names', () => {
    db.registerEdgeType({ name: 'imports', category: 'structural' });
    db.registerEdgeType({ name: 'imports', category: 'structural' });
    const count = db.db.prepare('SELECT COUNT(*) as c FROM edge_types WHERE name = ?').get('imports').c;
    assert.equal(count, 1);
  });

  it('setFileHash inserts and updates', () => {
    db.setFileHash('p', 'lib/foo.js', 'abc123');
    let row = db.db.prepare('SELECT hash FROM file_hashes WHERE project = ? AND file = ?').get('p', 'lib/foo.js');
    assert.equal(row.hash, 'abc123');
    db.setFileHash('p', 'lib/foo.js', 'def456');
    row = db.db.prepare('SELECT hash FROM file_hashes WHERE project = ? AND file = ?').get('p', 'lib/foo.js');
    assert.equal(row.hash, 'def456');
  });

  it('deleteFileNodes removes nodes and cascading edges', () => {
    const src = db.upsertNode({ project: 'p', file: 'a.js', name: 'a', type: 'function', line: 1 });
    const tgt = db.upsertNode({ project: 'p', file: 'b.js', name: 'b', type: 'module', line: 1 });
    db.insertEdge({ sourceId: src, targetId: tgt, type: 'imports', category: 'structural', sourceProject: 'p', sourceFile: 'a.js' });
    db.deleteFileNodes('p', 'a.js');
    const nodes = db.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'a.js');
    assert.equal(nodes.length, 0);
    const edges = db.db.prepare('SELECT * FROM edges WHERE source_id = ?').all(src);
    assert.equal(edges.length, 0);
  });

  it('addAnnotation creates annotation; cascade-deletes with node', () => {
    const nodeId = db.upsertNode({ project: 'p', file: 'a.js', name: 'fn', type: 'function', line: 1 });
    const annId = db.addAnnotation(nodeId, 'This handles auth');
    assert.ok(annId > 0);
    db.deleteFileNodes('p', 'a.js');
    const anns = db.db.prepare('SELECT * FROM annotations WHERE id = ?').all(annId);
    assert.equal(anns.length, 0);
  });
});
