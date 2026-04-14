'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { GraphDB } = require('../lib/graph-db');
const { GraphQueries } = require('../lib/graph-queries');
const { formatMap, formatFind, formatBlastRadius, formatStructure, formatFlow } = require('../scripts/query');

const queryScript = path.join(__dirname, '../scripts/query.js');

function tmpDbPath() {
  return path.join(__dirname, `test-query-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('query.js formatters', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);
    // Seed data
    db.registerEdgeType({ name: 'imports', category: 'structural', followsForBlastRadius: true });
    const modA = db.upsertNode({ project: 'p', file: 'lib/server.js', name: 'server', type: 'module', line: 1 });
    const fnA = db.upsertNode({ project: 'p', file: 'lib/server.js', name: 'startServer', type: 'function', line: 15 });
    const modB = db.upsertNode({ project: 'p', file: 'lib/db.js', name: 'db', type: 'module', line: 1 });
    db.insertEdge({ sourceId: modA, targetId: modB, type: 'imports', category: 'structural', sourceProject: 'p', sourceFile: 'lib/server.js' });
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('formatMap produces readable output', () => {
    const map = queries.getProjectMap('p');
    const output = formatMap(map, 'p');
    assert.ok(output.includes('lib/server.js'));
    assert.ok(output.includes('startServer'));
  });

  it('formatFind shows file:line', () => {
    const results = queries.findNodes('startServer');
    const output = formatFind(results);
    assert.ok(output.includes('lib/server.js:15'));
  });

  it('formatBlastRadius lists dependent files', () => {
    const radius = queries.getBlastRadius('p', 'lib/db.js');
    const output = formatBlastRadius(radius, 'lib/db.js');
    assert.ok(output.includes('lib/server.js'));
  });

  it('formatStructure shows definitions', () => {
    const structure = queries.getStructure('p', 'lib/server.js');
    const output = formatStructure(structure, 'lib/server.js');
    assert.ok(output.includes('function'));
    assert.ok(output.includes('startServer'));
  });
});

describe('query.js --body CLI', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(__dirname, 'tmp-body-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('--body escapes regex metacharacters in name', () => {
    const testFile = path.join(tmpDir, 'test.js');
    fs.writeFileSync(testFile, 'function normalFunc() {\n  return 1;\n}\n');

    // A name containing regex metacharacters should not crash or produce a false match
    const result = execFileSync('node', [queryScript, '--body', testFile, 'foo.bar('], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    assert.ok(result.includes('not found'), 'regex metacharacters should not cause ReDoS or false match');
  });
});
