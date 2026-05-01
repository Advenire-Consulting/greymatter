'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphDB, SCHEMA_VERSION } = require('../lib/graph-db');
const { GraphQueries } = require('../lib/graph-queries');
const { AmbiguousIdentifierError } = require('../lib/mcp/errors');

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

  it('listProjectsWithRoots joins project_scan_state, null for unrecorded roots', () => {
    // beforeEach seeds project 'p' with no root_path; add two more projects.
    db.upsertNode({ project: 'has-root', file: 'a.js', name: 'x', type: 'function', line: 1 });
    db.upsertNode({ project: 'no-root', file: 'a.js', name: 'y', type: 'function', line: 1 });
    db.setProjectRoot('has-root', '/home/user/has-root');

    const rows = queries.listProjectsWithRoots();
    const byName = Object.fromEntries(rows.map(r => [r.name, r.root_path]));
    assert.equal(byName['has-root'], '/home/user/has-root');
    assert.equal(byName['no-root'], null, 'project with no scan state has null root_path');
    assert.equal(byName['p'], null, 'seeded project p has no root_path recorded');
    assert.equal(rows.length, 3);
  });
});

// ── getStatus ──────────────────────────────────────────────────────────────────

describe('GraphQueries.getStatus', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = path.join(__dirname, `test-status-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);

    // Seed two projects with nodes and edges
    const n1 = db.upsertNode({ project: 'alpha', file: 'lib/a.js', name: 'fnA', type: 'function', line: 1 });
    const n2 = db.upsertNode({ project: 'alpha', file: 'lib/b.js', name: 'fnB', type: 'function', line: 5 });
    db.upsertNode({ project: 'beta', file: 'lib/c.js', name: 'fnC', type: 'function', line: 3 });
    db.registerEdgeType({ name: 'calls', category: 'structural' });
    db.insertEdge({ sourceId: n1, targetId: n2, type: 'calls', category: 'structural', sourceProject: 'alpha', sourceFile: 'lib/a.js' });
    db.setFileHash('alpha', 'lib/a.js', 'h1');
    db.setFileHash('alpha', 'lib/b.js', 'h2');
    db.setFileHash('beta',  'lib/c.js', 'h3');
    db.setProjectRoot('alpha', '/tmp/alpha');
    db.setProjectRoot('beta',  '/tmp/beta');

    // Seed labels: one heuristic, one llm, one stale
    db.upsertLabel({ nodeId: n1, detectorId: 'det.h', term: 'middleware', category: 'middleware', confidence: 0.9, source: 'heuristic' });
    db.upsertLabel({ nodeId: n2, detectorId: 'det.l', term: 'handler', category: 'handler', confidence: 0.8, source: 'llm' });
    // Mark n2's label stale
    db.db.prepare('UPDATE code_labels SET is_stale = 1 WHERE node_id = ?').run(n2);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('returns object with graphDb, labels, projects keys', () => {
    const status = queries.getStatus();
    assert.ok(status && typeof status === 'object');
    assert.ok('graphDb' in status);
    assert.ok('labels' in status);
    assert.ok('projects' in status);
  });

  it('graphDb block has expected shape and schema_version matches constant', () => {
    const { graphDb } = queries.getStatus();
    assert.equal(typeof graphDb.path, 'string');
    assert.equal(graphDb.schema_version, SCHEMA_VERSION);
    assert.equal(graphDb.total_nodes, 3);
    assert.equal(graphDb.total_edges, 1);
    assert.equal(graphDb.total_files, 3);
  });

  it('labels block counts total (all including stale), by_source (non-stale), stale_count', () => {
    const { labels } = queries.getStatus();
    assert.equal(labels.total, 2);         // both labels counted
    assert.equal(labels.stale_count, 1);   // one is stale
    assert.equal(labels.by_source.heuristic, 1); // non-stale heuristic
    assert.equal(labels.by_source.llm, 0);        // llm label is stale → excluded from by_source
    assert.equal(labels.by_source.manual, 0);
  });

  it('projects array has one entry per project with correct aggregates', () => {
    const { projects } = queries.getStatus();
    assert.equal(projects.length, 2);
    const alpha = projects.find(p => p.name === 'alpha');
    assert.ok(alpha);
    assert.equal(alpha.root_path, '/tmp/alpha');
    assert.equal(alpha.scanned_files, 2);
    assert.equal(alpha.node_count, 2);
  });
});

// ── getProjectOverview ─────────────────────────────────────────────────────────

describe('GraphQueries.getProjectOverview', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = path.join(__dirname, `test-overview-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);

    // Seed project 'register' with nodes, scan state, labels, and context
    const n1 = db.upsertNode({ project: 'register', file: 'lib/auth.js', name: 'verifyToken', type: 'function', line: 10 });
    const n2 = db.upsertNode({ project: 'register', file: 'lib/db.js',   name: 'query',       type: 'function', line: 5  });
    db.upsertScanState('register', 'sha1', 'audit');
    db.setFileHash('register', 'lib/auth.js', 'h1');
    db.setFileHash('register', 'lib/db.js',   'h2');
    db.upsertLabel({ nodeId: n1, detectorId: 'det', term: 'auth', category: 'auth', confidence: 0.9, source: 'heuristic' });

    // Seed project_context with two sessions
    db.db.prepare(`
      INSERT INTO project_context (project, context_json) VALUES (?, ?)
    `).run('register', JSON.stringify([
      { session_id: 'sess1', date: '2026-04-29', decisions: ['auth', 'jwt'], files: ['lib/auth.js'] },
      { session_id: 'sess2', date: '2026-04-28', decisions: ['db'],          files: ['lib/db.js']   },
      { session_id: 'sess3', date: '2026-04-27', decisions: ['index'],       files: ['lib/index.js'] },
      { session_id: 'sess4', date: '2026-04-26', decisions: ['router'],      files: ['lib/router.js'] },
      { session_id: 'sess5', date: '2026-04-25', decisions: ['schema'],      files: ['lib/schema.js'] },
      { session_id: 'sess6', date: '2026-04-24', decisions: ['migrate'],     files: ['lib/migrate.js'] },
    ]));
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('returns null for non-existent project', () => {
    assert.equal(queries.getProjectOverview('nonexistent'), null);
  });

  it('returns overview with recent_sessions, file_map, totals', () => {
    const overview = queries.getProjectOverview('register');
    assert.ok(overview);
    assert.equal(overview.project, 'register');
    assert.ok(Array.isArray(overview.recent_sessions));
    assert.ok(Array.isArray(overview.file_map));
    assert.ok(overview.totals && typeof overview.totals === 'object');
  });

  it('recent_sessions capped at 5', () => {
    const overview = queries.getProjectOverview('register');
    assert.ok(overview.recent_sessions.length <= 5);
    assert.equal(overview.recent_sessions[0].session_id, 'sess1');
  });

  it('totals.labeled_nodes counts distinct non-stale labeled nodes', () => {
    const overview = queries.getProjectOverview('register');
    assert.equal(overview.totals.labeled_nodes, 1); // only n1 has a label
    assert.equal(overview.totals.files, 2);
    assert.equal(overview.totals.nodes, 2);
  });

  it('file_map has path and purpose for each file', () => {
    const overview = queries.getProjectOverview('register');
    const authFile = overview.file_map.find(f => f.path === 'lib/auth.js');
    assert.ok(authFile, 'lib/auth.js should appear in file_map');
    assert.equal(typeof authFile.purpose, 'string');
  });
});

// ── getNodeBundle ──────────────────────────────────────────────────────────────

describe('GraphQueries.getNodeBundle', () => {
  let db, queries, dbPath;
  let verifyId, parseId, loginId;

  beforeEach(() => {
    dbPath = path.join(__dirname, `test-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);

    verifyId = db.upsertNode({ project: 'tp', file: 'lib/auth.js', name: 'verifyToken', type: 'function', line: 42 });
    parseId  = db.upsertNode({ project: 'tp', file: 'lib/auth.js', name: 'parseToken',  type: 'function', line: 18 });
    loginId  = db.upsertNode({ project: 'tp', file: 'routes/auth.js', name: 'loginHandler', type: 'function', line: 14 });

    db.registerEdgeType({ name: 'calls', category: 'structural' });
    db.insertEdge({ sourceId: verifyId, targetId: parseId, type: 'calls', category: 'structural', sourceProject: 'tp', sourceFile: 'lib/auth.js' });
    db.insertEdge({ sourceId: loginId, targetId: verifyId, type: 'calls', category: 'structural', sourceProject: 'tp', sourceFile: 'routes/auth.js' });

    // Labels for verifyToken: heuristic 0.9, manual 0.7
    db.upsertLabel({ nodeId: verifyId, detectorId: 'det.h', term: 'auth-step', category: 'auth-step', descriptors: ['jwt', 'validation'], confidence: 0.9, source: 'heuristic' });
    db.upsertLabel({ nodeId: verifyId, detectorId: 'det.m', term: 'auth-step', category: 'auth-step', descriptors: ['jwt'],              confidence: 0.7, source: 'manual' });
    // Label for parseToken
    db.upsertLabel({ nodeId: parseId, detectorId: 'det.p', term: 'parser', category: 'parser', descriptors: ['jwt'], confidence: 0.8, source: 'heuristic' });
    // Label for loginHandler (llm)
    db.upsertLabel({ nodeId: loginId, detectorId: 'det.l', term: 'route', category: 'route-handler', descriptors: ['express', 'auth'], confidence: 0.85, source: 'llm' });
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('returns null for missing node', () => {
    assert.equal(queries.getNodeBundle('tp', 'lib/auth.js', 'noSuchNode'), null);
  });

  it('returns bundle with identifier, body, labels, outgoing, incoming', () => {
    const bundle = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    assert.ok(bundle);
    assert.ok('identifier' in bundle);
    assert.ok('body' in bundle);
    assert.ok('labels' in bundle);
    assert.ok('outgoing' in bundle);
    assert.ok('incoming' in bundle);
  });

  it('identifier has correct kind, name, file, line', () => {
    const { identifier } = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    assert.equal(identifier.kind, 'function');
    assert.equal(identifier.name, 'verifyToken');
    assert.equal(identifier.file, 'lib/auth.js');
    assert.equal(identifier.line, 42);
  });

  it('labels ordered manual-first despite lower confidence', () => {
    const { labels } = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    assert.equal(labels.length, 2);
    assert.equal(labels[0].source, 'manual');
    assert.equal(labels[1].source, 'heuristic');
    assert.deepEqual(labels[0].descriptors, ['jwt']);
    assert.deepEqual(labels[1].descriptors, ['jwt', 'validation']);
  });

  it('outgoing has target_label with category and descriptors', () => {
    const { outgoing } = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].kind, 'calls');
    assert.equal(outgoing[0].target, 'parseToken');
    assert.ok(outgoing[0].target_label);
    assert.equal(outgoing[0].target_label.category, 'parser');
    assert.deepEqual(outgoing[0].target_label.descriptors, ['jwt']);
  });

  it('incoming has source_label from loginHandler', () => {
    const { incoming } = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].source, 'loginHandler');
    assert.ok(incoming[0].source_label);
    assert.equal(incoming[0].source_label.category, 'route-handler');
  });

  it('counterpart with no labels yields null label', () => {
    // Add a target with no labels
    const noLabelId = db.upsertNode({ project: 'tp', file: 'lib/auth.js', name: 'logAccess', type: 'function', line: 60 });
    db.insertEdge({ sourceId: verifyId, targetId: noLabelId, type: 'calls', category: 'structural', sourceProject: 'tp', sourceFile: 'lib/auth.js' });
    const { outgoing } = queries.getNodeBundle('tp', 'lib/auth.js', 'verifyToken');
    const logEdge = outgoing.find(e => e.target === 'logAccess');
    assert.ok(logEdge);
    assert.equal(logEdge.target_label, null);
  });

  it('throws AmbiguousIdentifierError when name is ambiguous', () => {
    // Two nodes named 'dupFn' in same file, different lines
    db.upsertNode({ project: 'tp', file: 'lib/dup.js', name: 'dupFn', type: 'function', line: 1 });
    db.upsertNode({ project: 'tp', file: 'lib/dup.js', name: 'dupFn', type: 'function', line: 20 });
    assert.throws(
      () => queries.getNodeBundle('tp', 'lib/dup.js', 'dupFn'),
      (e) => e instanceof AmbiguousIdentifierError && e.code === 'AMBIGUOUS_OR_MISSING_LINE'
    );
  });
});

// ── walkFlow ───────────────────────────────────────────────────────────────────

describe('GraphQueries.walkFlow', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = path.join(__dirname, `test-walk-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);
    db.registerEdgeType({ name: 'calls', category: 'structural' });
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('returns null for missing start node', () => {
    assert.equal(queries.walkFlow('p', 'lib/a.js', 'noSuchFn'), null);
  });

  it('linear chain A→B→C→D returns 4 steps, truncated: false', () => {
    const a = db.upsertNode({ project: 'p', file: 'f.js', name: 'A', type: 'function', line: 1 });
    const b = db.upsertNode({ project: 'p', file: 'f.js', name: 'B', type: 'function', line: 2 });
    const c = db.upsertNode({ project: 'p', file: 'f.js', name: 'C', type: 'function', line: 3 });
    const d = db.upsertNode({ project: 'p', file: 'f.js', name: 'D', type: 'function', line: 4 });
    db.insertEdge({ sourceId: a, targetId: b, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });
    db.insertEdge({ sourceId: b, targetId: c, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });
    db.insertEdge({ sourceId: c, targetId: d, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });

    const result = queries.walkFlow('p', 'f.js', 'A');
    assert.ok(result);
    assert.equal(result.steps.length, 4);
    assert.equal(result.steps[0].edge_in, null);
    assert.equal(result.steps[1].edge_in, 'calls');
    assert.equal(result.steps[2].edge_in, 'calls');
    assert.equal(result.steps[3].edge_in, 'calls');
    assert.equal(result.truncated, false);
  });

  it('maxDepth=2 on A→B→C→D returns 3 steps (A,B,C) and truncated: true', () => {
    const a = db.upsertNode({ project: 'p', file: 'f.js', name: 'A', type: 'function', line: 1 });
    const b = db.upsertNode({ project: 'p', file: 'f.js', name: 'B', type: 'function', line: 2 });
    const c = db.upsertNode({ project: 'p', file: 'f.js', name: 'C', type: 'function', line: 3 });
    const d = db.upsertNode({ project: 'p', file: 'f.js', name: 'D', type: 'function', line: 4 });
    db.insertEdge({ sourceId: a, targetId: b, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });
    db.insertEdge({ sourceId: b, targetId: c, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });
    db.insertEdge({ sourceId: c, targetId: d, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'f.js' });

    const result = queries.walkFlow('p', 'f.js', 'A', 2);
    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].name, 'A');
    assert.equal(result.steps[2].name, 'C');
    assert.equal(result.truncated, true);
  });

  it('start block matches first step identifier', () => {
    const a = db.upsertNode({ project: 'p', file: 'f.js', name: 'A', type: 'function', line: 7 });
    const result = queries.walkFlow('p', 'f.js', 'A');
    assert.equal(result.start.name, 'A');
    assert.equal(result.start.line, 7);
    assert.equal(result.start.kind, 'function');
  });
});

// ── getLabelCoverage ───────────────────────────────────────────────────────────

describe('GraphQueries.getLabelCoverage', () => {
  let db, queries, dbPath;
  let n1, n2, n3, n4;

  beforeEach(() => {
    dbPath = path.join(__dirname, `test-coverage-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new GraphDB(dbPath);
    queries = new GraphQueries(db);

    n1 = db.upsertNode({ project: 'cov', file: 'lib/a.js', name: 'anchor',    type: 'function', line: 1 });
    n2 = db.upsertNode({ project: 'cov', file: 'lib/a.js', name: 'neighbor1', type: 'function', line: 2 });
    n3 = db.upsertNode({ project: 'cov', file: 'lib/b.js', name: 'neighbor2', type: 'function', line: 3 });
    n4 = db.upsertNode({ project: 'cov', file: 'lib/b.js', name: 'unlabeled', type: 'function', line: 4 });

    db.registerEdgeType({ name: 'calls', category: 'structural' });
    db.insertEdge({ sourceId: n1, targetId: n2, type: 'calls', category: 'structural', sourceProject: 'cov', sourceFile: 'lib/a.js' });
    db.insertEdge({ sourceId: n3, targetId: n1, type: 'calls', category: 'structural', sourceProject: 'cov', sourceFile: 'lib/b.js' });

    db.upsertLabel({ nodeId: n1, detectorId: 'd1', term: 'x', category: 'cat-a', confidence: 0.9, source: 'heuristic' });
    db.upsertLabel({ nodeId: n2, detectorId: 'd2', term: 'x', category: 'cat-a', confidence: 0.8, source: 'llm' });
    db.upsertLabel({ nodeId: n3, detectorId: 'd3', term: 'x', category: 'cat-b', confidence: 0.7, source: 'heuristic' });
    // n4 has no label
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('project scope returns total_nodes, labeled_count, percent_labeled, by_source', () => {
    const cov = queries.getLabelCoverage('cov');
    assert.equal(cov.scope, 'project');
    assert.equal(cov.total_nodes, 4);
    assert.equal(cov.labeled_count, 3);
    assert.ok(Math.abs(cov.percent_labeled - 0.75) < 0.01);
    assert.equal(cov.by_source.heuristic, 2);
    assert.equal(cov.by_source.llm, 1);
    assert.equal(cov.by_source.manual, 0);
  });

  it('file scope returns stats for one file', () => {
    const cov = queries.getLabelCoverage('cov', 'lib/a.js');
    assert.equal(cov.scope, 'file');
    assert.equal(cov.total_nodes, 2);
    assert.equal(cov.labeled_count, 2);
  });

  it('neighborhood scope uses anchor + 1-hop counterparts', () => {
    // anchor=n1, outgoing=n2, incoming=n3 → neighborhood_size=3; n4 not in neighborhood
    const cov = queries.getLabelCoverage('cov', 'lib/a.js', 'anchor');
    assert.equal(cov.scope, 'neighborhood');
    assert.equal(cov.neighborhood_size, 3);
    assert.equal(cov.labeled_count, 3);
    assert.ok(Array.isArray(cov.unlabeled_nodes));
    assert.equal(cov.unlabeled_nodes.length, 0);
  });

  it('neighborhood scope lists unlabeled nodes when present', () => {
    // Add n4 as a neighbor
    db.insertEdge({ sourceId: n1, targetId: n4, type: 'calls', category: 'structural', sourceProject: 'cov', sourceFile: 'lib/a.js' });
    const cov = queries.getLabelCoverage('cov', 'lib/a.js', 'anchor');
    assert.equal(cov.neighborhood_size, 4);
    assert.equal(cov.labeled_count, 3);
    assert.equal(cov.unlabeled_nodes.length, 1);
    assert.equal(cov.unlabeled_nodes[0].name, 'unlabeled');
  });

  it('empty project returns zero counts without error', () => {
    const cov = queries.getLabelCoverage('empty_project');
    assert.equal(cov.scope, 'project');
    assert.equal(cov.total_nodes, 0);
    assert.equal(cov.labeled_count, 0);
    assert.equal(cov.percent_labeled, 0);
  });
});
