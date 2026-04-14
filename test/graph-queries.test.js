'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphDB } = require('../lib/graph-db');
const { GraphQueries } = require('../lib/graph-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-graph-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('GraphQueries', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);
    // Seed test data: two files with nodes and edges
    const modA = db.upsertNode({ project: 'p', file: 'lib/a.js', name: 'a', type: 'module', line: 1 });
    const fnA = db.upsertNode({ project: 'p', file: 'lib/a.js', name: 'doStuff', type: 'function', line: 10 });
    const modB = db.upsertNode({ project: 'p', file: 'lib/b.js', name: 'b', type: 'module', line: 1 });
    const fnB = db.upsertNode({ project: 'p', file: 'lib/b.js', name: 'helper', type: 'function', line: 5 });
    const modC = db.upsertNode({ project: 'p', file: 'lib/c.js', name: 'c', type: 'module', line: 1 });
    db.registerEdgeType({ name: 'imports', category: 'structural', followsForBlastRadius: true });
    db.registerEdgeType({ name: 'calls', category: 'structural', followsForBlastRadius: true });
    db.insertEdge({ sourceId: modA, targetId: modB, type: 'imports', category: 'structural', sourceProject: 'p', sourceFile: 'lib/a.js' });
    db.insertEdge({ sourceId: fnA, targetId: fnB, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'lib/a.js' });
    db.insertEdge({ sourceId: modC, targetId: modA, type: 'imports', category: 'structural', sourceProject: 'p', sourceFile: 'lib/c.js' });
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('getProjectMap returns files with node counts', () => {
    const map = queries.getProjectMap('p');
    assert.ok(map.length >= 2);
    const aEntry = map.find(m => m.file === 'lib/a.js');
    assert.ok(aEntry);
    assert.ok(aEntry.nodes.length >= 2);
  });

  it('findNodes locates nodes by name across projects', () => {
    const results = queries.findNodes('doStuff');
    assert.equal(results.length, 1);
    assert.equal(results[0].file, 'lib/a.js');
    assert.equal(results[0].line, 10);
  });

  it('getFileNodes returns all nodes in a file', () => {
    const nodes = queries.getFileNodes('p', 'lib/a.js');
    assert.ok(nodes.length >= 2);
    assert.ok(nodes.some(n => n.name === 'doStuff'));
    assert.ok(nodes.some(n => n.name === 'a'));
  });

  it('getBlastRadius follows structural edges', () => {
    const radius = queries.getBlastRadius('p', 'lib/b.js');
    // a.js imports b.js — a.js is in blast radius
    const files = radius.map(r => r.file);
    assert.ok(files.includes('lib/a.js'));
  });

  it('getFileFlow returns edges in and out', () => {
    const flow = queries.getFileFlow('p', 'lib/a.js');
    assert.ok(flow.outbound.length >= 2); // imports b, calls helper
    assert.ok(flow.inbound.length >= 1);  // c imports a
  });

  it('traceIdentifier finds node and its edges', () => {
    const trace = queries.traceIdentifier('doStuff', 'p');
    assert.equal(trace.node.name, 'doStuff');
    assert.ok(trace.edges.length >= 1);
  });

  it('getStructure returns definitions with lines', () => {
    const structure = queries.getStructure('p', 'lib/a.js');
    assert.ok(structure.length >= 2);
    const fn = structure.find(s => s.name === 'doStuff');
    assert.equal(fn.line, 10);
    assert.equal(fn.type, 'function');
  });

  it('getSchema returns db-related nodes', () => {
    // No db-type nodes in test data — just verify it returns an array
    const schema = queries.getSchema('p');
    assert.ok(Array.isArray(schema));
  });

  it('listProjects returns distinct project names', () => {
    const projects = queries.listProjects();
    assert.ok(projects.includes('p'));
  });

  it('getNodeAnnotations returns annotations for a node', () => {
    const nodeId = db.upsertNode({ project: 'p', file: 'lib/a.js', name: 'doStuff', type: 'function', line: 10 });
    db.addAnnotation(nodeId, 'handles auth');
    const anns = queries.getNodeAnnotations(nodeId);
    assert.ok(anns.length >= 1);
    assert.equal(anns[0].content, 'handles auth');
  });

  it('findNodes escapes LIKE wildcards in name', () => {
    db.upsertNode({ project: 'test', file: 'a.js', name: 'handleRequest', type: 'function', line: 1 });
    db.upsertNode({ project: 'test', file: 'b.js', name: 'handleResponse', type: 'function', line: 1 });

    // A '%' in the search should NOT match everything
    const results = queries.findNodes('%', 'test');
    assert.strictEqual(results.length, 0, 'wildcard % should not match all nodes');

    // An '_' in the search should NOT match single characters
    const results2 = queries.findNodes('_andleRequest', 'test');
    assert.strictEqual(results2.length, 0, 'wildcard _ should not match single chars');

    // Normal prefix search still works
    const results3 = queries.findNodes('handle', 'test');
    assert.strictEqual(results3.length, 2, 'prefix search should still work');
  });
});
