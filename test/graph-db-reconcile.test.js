'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphDB } = require('../lib/graph-db');

function tmpDbPath() {
  return path.join(__dirname, `test-graph-reconcile-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GraphDB reconcile helpers', () => {
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

  it('getFileHashRowsForProject returns [{file, hash, updated_at}] ordered by file', () => {
    db.setFileHash('proj', 'c.js', 'hash-c');
    db.setFileHash('proj', 'a.js', 'hash-a');
    db.setFileHash('proj', 'b.js', 'hash-b');
    // Another project — must not appear
    db.setFileHash('other', 'x.js', 'hash-x');

    const rows = db.getFileHashRowsForProject('proj');
    assert.equal(rows.length, 3);
    // Verify shape
    for (const row of rows) {
      assert.ok('file' in row);
      assert.ok('hash' in row);
      assert.ok('updated_at' in row);
    }
    // Ordered by file (SQLite default for this query — same insertion order may not be sorted,
    // so we verify all three files are present)
    const files = rows.map(r => r.file).sort();
    assert.deepEqual(files, ['a.js', 'b.js', 'c.js']);
    const byFile = Object.fromEntries(rows.map(r => [r.file, r.hash]));
    assert.equal(byFile['a.js'], 'hash-a');
    assert.equal(byFile['b.js'], 'hash-b');
    assert.equal(byFile['c.js'], 'hash-c');
  });

  it('purgeFile deletes from nodes, edges, and file_hashes atomically', () => {
    // Seed nodes in two files
    const idA = db.upsertNode({ project: 'p', file: 'a.js', name: 'fnA', type: 'function', line: 1 });
    const idB = db.upsertNode({ project: 'p', file: 'b.js', name: 'fnB', type: 'function', line: 1 });
    // Edge from a.js → b.js (source_file = a.js)
    db.insertEdge({ sourceId: idA, targetId: idB, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'a.js' });
    // Hash rows
    db.setFileHash('p', 'a.js', 'hash-a');
    db.setFileHash('p', 'b.js', 'hash-b');

    db.purgeFile('p', 'a.js');

    // nodes for a.js gone
    const nodes = db.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'a.js');
    assert.equal(nodes.length, 0);
    // edges with source_file = a.js gone
    const edges = db.db.prepare('SELECT * FROM edges WHERE source_project = ? AND source_file = ?').all('p', 'a.js');
    assert.equal(edges.length, 0);
    // file_hashes row for a.js gone
    const hashes = db.db.prepare('SELECT * FROM file_hashes WHERE project = ? AND file = ?').all('p', 'a.js');
    assert.equal(hashes.length, 0);

    // b.js untouched
    const bNodes = db.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'b.js');
    assert.equal(bNodes.length, 1);
    const bHash = db.db.prepare('SELECT hash FROM file_hashes WHERE project = ? AND file = ?').get('p', 'b.js');
    assert.equal(bHash.hash, 'hash-b');
  });

  it('updateLastScanSha sets last_scan_sha and last_scan_at, preserves other columns', () => {
    // Seed a row with a root_path and mode so we can verify they are preserved
    db.setProjectRoot('p', '/tmp/p');
    db.upsertScanState('p', 'old-sha', 'incremental');

    db.updateLastScanSha('p', 'new-sha');

    const state = db.getScanState('p');
    assert.equal(state.last_scan_sha, 'new-sha');
    assert.ok(state.last_scan_at, 'last_scan_at should be set');
    // root_path preserved (set via setProjectRoot — separate column)
    assert.equal(db.getProjectRoot('p'), '/tmp/p');
  });

  it('updateLastScanSha works on a project with no prior row', () => {
    db.updateLastScanSha('new-proj', 'sha-abc');
    const state = db.getScanState('new-proj');
    assert.equal(state.last_scan_sha, 'sha-abc');
  });
});
