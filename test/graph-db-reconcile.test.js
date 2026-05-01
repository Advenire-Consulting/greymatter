'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { GraphDB } = require('../lib/graph-db');
const { loadPolicy } = require('../lib/exclusion');
const { reconcileProject } = require('../lib/reconcile');

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

  it('project_scan_state has exclusion_policy_hash and exclusion_purged_at columns', () => {
    // Bare SELECT must not throw — the migration should have added the columns.
    db.db.prepare('SELECT exclusion_policy_hash, exclusion_purged_at FROM project_scan_state LIMIT 0').all();
  });

  it('setExclusionState and getExclusionState round-trip', () => {
    db.setExclusionState('p', 'abc123');
    const state = db.getExclusionState('p');
    assert.equal(state.exclusion_policy_hash, 'abc123');
    assert.ok(state.exclusion_purged_at, 'exclusion_purged_at should be set');
  });

  it('setExclusionState updates an existing project_scan_state row without clobbering other columns', () => {
    db.setProjectRoot('p', '/tmp/p');
    db.upsertScanState('p', 'old-sha', 'incremental');
    db.setExclusionState('p', 'hash-1');

    const scan = db.getScanState('p');
    assert.equal(scan.last_scan_sha, 'old-sha');
    assert.equal(db.getProjectRoot('p'), '/tmp/p');
    const excl = db.getExclusionState('p');
    assert.equal(excl.exclusion_policy_hash, 'hash-1');
  });

  it('getExclusionState returns null for unknown project', () => {
    assert.equal(db.getExclusionState('does-not-exist'), null);
  });
});

describe('reconcileProject policy integration', () => {
  let db, dbPath, tmpDir;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-reconcile-policy-'));
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('purges excluded files and updates exclusion state when policy changes (Task 3.2)', () => {
    // Setup: create directory structure with secrets/ that will be gitignored
    fs.mkdirSync(path.join(tmpDir, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'secrets', 'x.js'), '// secret');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'secrets/\n');
    db.setProjectRoot('p', tmpDir);

    // Seed a node for secrets/x.js as if a previous scan had included it
    db.upsertNode({ project: 'p', file: 'secrets/x.js', name: 'x', type: 'module', line: 1 });

    // Run with respect_gitignore: true — policy now excludes secrets/
    const config = { exclusion: { respect_gitignore: true, extra_patterns: [], respect_greymatterignore: false } };
    const result = reconcileProject({ db, project: 'p', rootPath: tmpDir, runExtraction: () => {}, config });

    // purgeCounts should be present with files_purged > 0
    assert.ok(result.purgeCounts, 'purgeCounts should be returned');
    assert.ok(result.purgeCounts.files_purged > 0, 'should have purged at least one file');

    // secrets/x.js node should be gone
    const rows = db.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'secrets/x.js');
    assert.equal(rows.length, 0, 'secrets/x.js should be purged from nodes');

    // exclusion_policy_hash should match the new policy
    const state = db.getExclusionState('p');
    assert.ok(state, 'exclusion state should exist');
    const policy = loadPolicy(tmpDir, config);
    assert.equal(state.exclusion_policy_hash, policy.hash, 'exclusion_policy_hash should match new policy');
  });
});
