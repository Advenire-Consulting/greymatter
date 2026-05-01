'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { GraphDB } = require('../lib/graph-db');
const { GraphQueries } = require('../lib/graph-queries');
const {
  formatMap, formatFind, formatBlastRadius, formatStructure,
  formatFlow, formatTrace, formatSchema,
  formatReorient, formatReorientList, formatRecent,
  renderLabels,
} = require('../scripts/query');

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

  it('formatFlow shows inbound and outbound edges', () => {
    const flow = queries.getFileFlow('p', 'lib/server.js');
    const output = formatFlow(flow, 'lib/server.js');
    assert.ok(output.includes('Flow for lib/server.js'));
    // server.js imports db.js → at least one outbound
    assert.ok(output.includes('outbound'));
  });

  it('formatFlow handles empty edges gracefully', () => {
    const output = formatFlow({ inbound: [], outbound: [] }, 'orphan.js');
    assert.ok(output.includes('(no edges)'));
  });
});

describe('query.js pure formatters', () => {
  it('formatTrace renders node location and edge sides', () => {
    const trace = {
      node: { id: 10, project: 'p', file: 'lib/x.js', line: 5, type: 'function', name: 'doThing' },
      edges: [
        { type: 'calls', source_id: 10, target_id: 20 },
        { type: 'called_by', source_id: 30, target_id: 10 },
      ],
    };
    const output = formatTrace(trace, 'doThing');
    assert.ok(output.includes('p/lib/x.js:5'));
    assert.ok(output.includes('doThing'));
    assert.ok(output.includes('outbound'));
    assert.ok(output.includes('inbound'));
  });

  it('formatTrace reports missing node', () => {
    const output = formatTrace({ node: null, edges: [] }, 'ghost');
    assert.ok(output.includes('(no node named "ghost")'));
  });

  it('formatSchema groups tables and columns', () => {
    const nodes = [
      { type: 'table', name: 'users', project: 'p', file: 'schema.sql', line: 1 },
      { type: 'column', name: 'id' },
      { type: 'column', name: 'email' },
    ];
    const output = formatSchema(nodes);
    assert.ok(output.includes('TABLE users'));
    assert.ok(output.includes('id'));
    assert.ok(output.includes('email'));
  });

  it('formatSchema handles empty input', () => {
    const output = formatSchema([]);
    assert.ok(output.includes('(no schema nodes found)'));
  });

  it('formatReorient shows session entries with decisions and files', () => {
    const entries = [
      {
        session_id: 'abcdef1234567890',
        date: '2026-04-17',
        decisions: ['schema change', 'add index'],
        files: ['lib/db.js', 'scripts/migrate.js'],
      },
    ];
    const output = formatReorient(entries, 'myproj');
    assert.ok(output.includes('Recent sessions for myproj'));
    assert.ok(output.includes('[abcdef12]'));
    assert.ok(output.includes('schema change'));
    assert.ok(output.includes('db.js'));
  });

  it('formatReorient disambiguates duplicate basenames with parent dir', () => {
    const entries = [
      {
        session_id: 'deadbeef',
        date: '2026-04-17',
        decisions: [],
        files: ['lib/utils/helpers.js', 'scripts/helpers.js'],
      },
    ];
    const output = formatReorient(entries, 'p');
    assert.ok(output.includes('utils/helpers.js'));
    assert.ok(output.includes('scripts/helpers.js'));
  });

  it('formatReorient handles empty entries', () => {
    const output = formatReorient([], 'nothing');
    assert.ok(output.includes('(no recent sessions for "nothing")'));
  });

  it('formatReorientList shows project + session count', () => {
    const output = formatReorientList([
      { project: 'alpha', sessionCount: 3, lastDate: '2026-04-17' },
      { project: 'beta', sessionCount: 1, lastDate: '2026-04-10' },
    ]);
    assert.ok(output.includes('alpha'));
    assert.ok(output.includes('3 sessions'));
    assert.ok(output.includes('2026-04-17'));
    assert.ok(output.includes('beta'));
  });

  it('formatReorientList handles empty input', () => {
    const output = formatReorientList([]);
    assert.ok(output.includes('(no project context available)'));
  });

  it('formatRecent shows multi-project sessions with time and decisions', () => {
    const entries = [
      {
        session_id: '01234567abcd',
        date: '2026-04-17',
        start_time: '2026-04-17T14:30:00',
        projects: ['alpha', 'beta'],
        decisions: ['migration', 'rollout'],
        files: [
          { project: 'alpha', path: 'lib/a.js' },
          { project: 'beta', path: 'lib/b.js' },
        ],
      },
    ];
    const output = formatRecent(entries);
    assert.ok(output.includes('[01234567]'));
    assert.ok(output.includes('14:30'));
    assert.ok(output.includes('alpha, beta'));
    assert.ok(output.includes('Terms: migration, rollout'));
    // Multi-project → file paths prefixed with project name
    assert.ok(output.includes('alpha/a.js'));
    assert.ok(output.includes('beta/b.js'));
  });

  it('formatRecent uses bare basename for single-project sessions', () => {
    const entries = [
      {
        session_id: '01234567',
        date: '2026-04-17',
        projects: ['alpha'],
        decisions: [],
        files: [{ project: 'alpha', path: 'lib/solo.js' }],
      },
    ];
    const output = formatRecent(entries);
    assert.ok(output.includes('solo.js'));
    assert.ok(!output.includes('alpha/solo.js'), 'single-project should not prefix');
  });

  it('formatRecent handles empty input', () => {
    const output = formatRecent([]);
    assert.ok(output.includes('(no recent sessions)'));
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

  function runBody(file, name) {
    return execFileSync('node', [queryScript, '--body', file, name], { encoding: 'utf-8', timeout: 5000 });
  }

  it('--body extracts a class declaration', () => {
    const f = path.join(tmpDir, 'cls.js');
    fs.writeFileSync(f, 'class Widget {\n  hello() { return 1; }\n}\n');
    const out = runBody(f, 'Widget');
    assert.ok(out.includes('class Widget {'), 'should extract class start');
    assert.ok(out.includes('hello()'), 'should include method');
    assert.ok(out.trim().endsWith('}'), 'should end at matching brace');
  });

  it('--body does not match a class name when used as a call site', () => {
    const f = path.join(tmpDir, 'callsite.js');
    fs.writeFileSync(f, 'function outer() {\n  Widget(args);\n}\n');
    const out = runBody(f, 'Widget');
    assert.ok(out.includes('not found'), 'call site should not match class declaration pattern');
  });

  it('--body extracts a class method', () => {
    const f = path.join(tmpDir, 'method.js');
    fs.writeFileSync(f, 'class Store {\n  insertSession(args) {\n    return 42;\n  }\n}\n');
    const out = runBody(f, 'insertSession');
    assert.ok(out.includes('insertSession(args) {'), 'should extract method start');
    assert.ok(out.includes('return 42'), 'should include method body');
  });

  it('--body does not match a method name at a call site', () => {
    const f = path.join(tmpDir, 'method-callsite.js');
    fs.writeFileSync(f, 'function outer() {\n  insertSession(args);\n}\n');
    const out = runBody(f, 'insertSession');
    // The function 'outer' contains a call to insertSession; the regex must not anchor to the call line.
    assert.ok(!out.includes('insertSession(args);\n}'), 'should not slice from call site');
  });

  it('--body extracts an object-literal method', () => {
    const f = path.join(tmpDir, 'obj.js');
    fs.writeFileSync(f, 'const api = {\n  fetchData: function (id) {\n    return id;\n  },\n};\n');
    const out = runBody(f, 'fetchData');
    assert.ok(out.includes('fetchData: function'), 'should extract object-method start');
    assert.ok(out.includes('return id'), 'should include body');
  });

  it('--body does not match a property name when used as a key elsewhere', () => {
    const f = path.join(tmpDir, 'obj-prop.js');
    fs.writeFileSync(f, 'const config = {\n  fetchData: someValue,\n};\n');
    const out = runBody(f, 'fetchData');
    assert.ok(out.includes('not found'), 'plain key:value (not function/arrow) should not match');
  });
});

describe('renderLabels', () => {
  let db, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
    const nodeA = db.upsertNode({ project: 'p', file: 'auth/middleware.js', name: 'authMiddleware', type: 'function', line: 12 });
    const nodeB = db.upsertNode({ project: 'p', file: 'auth/middleware.js', name: 'staleFn', type: 'function', line: 34 });
    db.upsertLabel({ nodeId: nodeA, detectorId: 'js.express-middleware', term: 'middleware', category: 'middleware', descriptors: ['express', 'request'], confidence: 0.9, source: 'heuristic' });
    db.upsertLabel({ nodeId: nodeB, detectorId: 'js.express-middleware', term: 'middleware', category: 'middleware', descriptors: [], confidence: 0.8, source: 'heuristic' });
    // Mark nodeB's label stale via raw SQL
    db.db.prepare('UPDATE code_labels SET is_stale = 1 WHERE node_id = ?').run(nodeB);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  // Task 5.1 — fresh-only default
  it('default (includeStale=false) shows only fresh labels', () => {
    const out = renderLabels({ db, file: 'auth/middleware.js', project: 'p', includeStale: false });
    assert.ok(out.includes('authMiddleware'), 'fresh label node should appear');
    assert.ok(!out.includes('staleFn'), 'stale label node should be omitted');
    assert.ok(!out.includes('[stale]'), 'no stale marker in default mode');
    assert.ok(out.includes('[express, request]'), 'descriptors rendered');
    assert.ok(out.includes('middleware'), 'category rendered');
  });

  it('returns "no labels" message when file has no nodes', () => {
    const out = renderLabels({ db, file: 'auth/other.js', project: 'p', includeStale: false });
    assert.ok(out.includes('no labels'));
  });

  it('returns "no labels" message when nodes exist but none have fresh labels', () => {
    // Only nodeB has a label and it is stale; use a fresh db with only a stale node
    const p2 = tmpDbPath();
    const db2 = new GraphDB(p2);
    const n = db2.upsertNode({ project: 'p', file: 'x.js', name: 'fn', type: 'function', line: 1 });
    db2.upsertLabel({ nodeId: n, detectorId: 'js.t', term: 't', category: 'middleware', descriptors: [], confidence: 0.5, source: 'heuristic' });
    db2.db.prepare('UPDATE code_labels SET is_stale = 1 WHERE node_id = ?').run(n);
    const out = renderLabels({ db: db2, file: 'x.js', project: 'p', includeStale: false });
    db2.close();
    try { fs.unlinkSync(p2); } catch {}
    assert.ok(out.includes('no labels'));
  });

  // Task 5.2 — --all includes stale
  it('includeStale=true includes stale labels with [stale] marker', () => {
    const out = renderLabels({ db, file: 'auth/middleware.js', project: 'p', includeStale: true });
    assert.ok(out.includes('authMiddleware'), 'fresh node should appear');
    assert.ok(out.includes('staleFn'), 'stale node should appear with --all');
    assert.ok(out.includes('[stale]'), '[stale] marker present on stale labels');
  });

  it('output header line is the file path', () => {
    const out = renderLabels({ db, file: 'auth/middleware.js', project: 'p', includeStale: false });
    assert.ok(out.startsWith('auth/middleware.js'), 'first line is the file path');
  });
});
