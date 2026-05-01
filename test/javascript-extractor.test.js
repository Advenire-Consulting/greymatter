'use strict';

// @tests extractors/javascript.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/javascript');
const { runDetectorsForNode } = require('../lib/extractor-registry');

describe('JavaScript Extractor', () => {
  it('has correct extensions', () => {
    assert.deepEqual(extractor.extensions, ['.js', '.mjs', '.cjs']);
  });

  it('extracts function declarations', () => {
    const result = extractor.extract(
      "function doStuff(x) {\n  return x + 1;\n}\n",
      'lib/test.js', 'p'
    );
    const fn = result.nodes.find(n => n.name === 'doStuff');
    assert.ok(fn);
    assert.equal(fn.type, 'function');
    assert.equal(fn.line, 1);
  });

  it('extracts class declarations', () => {
    const result = extractor.extract(
      "class MyService {\n  constructor() {}\n  run() {}\n}\n",
      'lib/svc.js', 'p'
    );
    const cls = result.nodes.find(n => n.name === 'MyService');
    assert.ok(cls);
    assert.equal(cls.type, 'class');
  });

  it('extracts arrow functions assigned to const as function nodes', () => {
    const result = extractor.extract(
      "const greet = (name) => `Hello ${name}`;\n",
      'lib/util.js', 'p'
    );
    const fn = result.nodes.find(n => n.name === 'greet');
    assert.ok(fn);
    assert.equal(fn.type, 'function');
  });

  it('extracts require imports as edges', () => {
    const result = extractor.extract(
      "const foo = require('./foo');\nconst bar = require('./lib/bar');\nconst fs = require('fs');\n",
      'index.js', 'p'
    );
    // Should have edges for ./foo and ./lib/bar but NOT fs
    const importEdges = result.edges.filter(e => e.type === 'imports');
    assert.equal(importEdges.length, 2);
    assert.ok(importEdges.some(e => e.target === './foo'));
    assert.ok(importEdges.some(e => e.target === './lib/bar'));
  });

  it('extracts ES imports as edges', () => {
    const result = extractor.extract(
      "import { helper } from './utils';\nimport path from 'path';\n",
      'lib/mod.js', 'p'
    );
    const importEdges = result.edges.filter(e => e.type === 'imports');
    assert.equal(importEdges.length, 1);
    assert.equal(importEdges[0].target, './utils');
  });

  it('extracts module.exports', () => {
    const result = extractor.extract(
      "function a() {}\nfunction b() {}\nmodule.exports = { a, b };\n",
      'lib/mod.js', 'p'
    );
    const exportEdges = result.edges.filter(e => e.type === 'exports');
    assert.ok(exportEdges.length >= 2);
  });

  it('extracts Express routes', () => {
    const result = extractor.extract(
      "const router = require('express').Router();\nrouter.get('/api/items', (req, res) => {});\nrouter.post('/api/items', (req, res) => {});\n",
      'routes/items.js', 'p'
    );
    const routes = result.nodes.filter(n => n.type === 'route');
    assert.equal(routes.length, 2);
    assert.ok(routes.some(n => n.name === 'GET /api/items'));
  });

  it('extracts SQL table references', () => {
    const result = extractor.extract(
      "function getUsers() {\n  db.prepare('SELECT * FROM users WHERE id = ?');\n}\n",
      'lib/data.js', 'p'
    );
    const tableEdges = result.edges.filter(e => e.type === 'queries_table');
    assert.ok(tableEdges.length >= 1);
    assert.ok(tableEdges.some(e => e.target === 'users'));
  });

  it('skips builtin modules for imports', () => {
    const result = extractor.extract(
      "const fs = require('fs');\nconst path = require('path');\nconst myLib = require('./myLib');\n",
      'lib/test.js', 'p'
    );
    const importEdges = result.edges.filter(e => e.type === 'imports');
    assert.equal(importEdges.length, 1);
    assert.equal(importEdges[0].target, './myLib');
  });

  it('returns edge_types for all types it uses', () => {
    const result = extractor.extract(
      "const foo = require('./bar');\nmodule.exports = { foo };\n",
      'lib/test.js', 'p'
    );
    assert.ok(result.edge_types.length > 0);
    const names = result.edge_types.map(et => et.name);
    assert.ok(names.includes('imports'));
    assert.ok(names.includes('exports'));
  });

  it('candidateTestPaths includes flattened-parent convention for nested dirs', () => {
    const paths = extractor.testPairs.candidateTestPaths('lib/test-alerts/pairing.js');
    assert.ok(
      paths.includes('test/test-alerts-pairing.test.js'),
      'should include flattened test/<parent>-<name>.test.js'
    );
    assert.ok(
      paths.includes('tests/test-alerts-pairing.test.js'),
      'should include flattened tests/<parent>-<name>.test.js'
    );
  });

  it('candidateTestPaths skips flattened-parent when source is at project root', () => {
    const paths = extractor.testPairs.candidateTestPaths('index.js');
    // dir is '.' → no sensible parent name, so no flattened candidate with '.-index.test.js'
    assert.ok(
      !paths.some(p => p.includes('.-')),
      'no malformed parent-prefix candidates when source is at root'
    );
  });
});

describe('JS extractBody', () => {
  it('extracts a standard brace-delimited function body', () => {
    const SOURCE = [
      'function authMiddleware(req, res, next) {',
      '  next();',
      '}',
      '',
      'function helper() {',
      '  return 1;',
      '}',
    ].join('\n');
    const body = extractor.extractBody(SOURCE, { line: 1, name: 'authMiddleware' });
    assert.ok(body, 'extractBody should return a string');
    const lines = body.split('\n');
    assert.equal(lines.length, 3, 'three-line function');
    assert.ok(lines[0].includes('authMiddleware'));
    assert.equal(lines[2].trim(), '}');
  });

  it('returns single declaration line for arrow function with no braces', () => {
    const content = 'const f = () => 5';
    const body = extractor.extractBody(content, { line: 1, name: 'f' });
    assert.equal(body, 'const f = () => 5');
  });

  it('keeps the full outer block intact with nested braces', () => {
    const content = [
      'function outer() {',
      '  if (true) {',
      '    return { a: 1 };',
      '  }',
      '}',
      'function other() {}',
    ].join('\n');
    const body = extractor.extractBody(content, { line: 1, name: 'outer' });
    assert.ok(body.includes('if (true)'));
    assert.ok(!body.includes('function other'), 'must not bleed into next function');
  });

  it('returns null when node.line is past EOF', () => {
    assert.equal(extractor.extractBody('function f() {}', { line: 999, name: 'f' }), null);
  });

  it('returns null when node.line is missing', () => {
    assert.equal(extractor.extractBody('function f() {}', { name: 'f' }), null);
  });
});

describe('JS labelDetectors — express-middleware', () => {
  function run(content, name) {
    const node = { name, type: 'function', line: 1, body: content };
    const ctx = { project: 'p', filePath: 'app.js', content };
    return runDetectorsForNode(extractor, node, ctx);
  }

  it('detects named (req, res, next) signature at high confidence', () => {
    const labels = run('function authMiddleware(req, res, next) { next(); }', 'authMiddleware');
    const label = labels.find(l => l.detectorId === 'express-middleware');
    assert.ok(label, 'should detect express-middleware');
    assert.equal(label.category, 'middleware');
    assert.equal(label.term, 'middleware');
    assert.ok(label.confidence >= 0.9);
  });

  it('detects any 3-arity function at lower confidence', () => {
    const labels = run('function check(a, b, c) { c(); }', 'check');
    const label = labels.find(l => l.detectorId === 'express-middleware');
    assert.ok(label, 'should detect 3-arity as express-middleware');
    assert.ok(label.confidence < 0.9);
  });

  it('does not detect 2-arity function', () => {
    const labels = run('function notMiddleware(req, res) { res.send(); }', 'notMiddleware');
    const label = labels.find(l => l.detectorId === 'express-middleware');
    assert.ok(!label, 'should not detect 2-arity');
  });
});

describe('JS labelDetectors — express-route-handler', () => {
  it('detects 2-arity function bound via app.post()', () => {
    const content = [
      'function loginHandler(req, res) { res.json({}); }',
      "app.post('/login', loginHandler);",
    ].join('\n');
    const node = { name: 'loginHandler', type: 'function', line: 1, body: 'function loginHandler(req, res) { res.json({}); }' };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'routes.js', content });
    const label = labels.find(l => l.detectorId === 'express-route-handler');
    assert.ok(label, 'should detect route handler');
    assert.equal(label.category, 'route-handler');
  });

  it('does not detect when no route binding in content', () => {
    const content = 'function helper(req, res) { return req.body; }';
    const node = { name: 'helper', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'routes.js', content });
    const label = labels.find(l => l.detectorId === 'express-route-handler');
    assert.ok(!label, 'should not detect without route binding');
  });
});

describe('JS labelDetectors — parameterized-sql', () => {
  it('detects db.prepare() with placeholder', () => {
    const content = "function getUser(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }";
    const node = { name: 'getUser', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'db.js', content });
    const label = labels.find(l => l.detectorId === 'parameterized-sql');
    assert.ok(label, 'should detect parameterized query');
    assert.equal(label.category, 'data-access');
  });

  it('does not detect when no placeholder', () => {
    const content = "function getAll() { return db.prepare('SELECT * FROM users').all(); }";
    const node = { name: 'getAll', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'db.js', content });
    const label = labels.find(l => l.detectorId === 'parameterized-sql');
    assert.ok(!label, 'should not detect without ?');
  });
});

describe('JS labelDetectors — bcrypt-verify', () => {
  it('detects bcrypt.compare()', () => {
    const content = 'async function verify(p, h) { return await bcrypt.compare(p, h); }';
    const node = { name: 'verify', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'auth.js', content });
    const label = labels.find(l => l.detectorId === 'bcrypt-verify');
    assert.ok(label, 'should detect bcrypt.compare');
    assert.equal(label.category, 'auth-step');
  });

  it('detects bcryptjs.compare()', () => {
    const content = 'async function verify(p, h) { return await bcryptjs.compare(p, h); }';
    const node = { name: 'verify', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'auth.js', content });
    const label = labels.find(l => l.detectorId === 'bcrypt-verify');
    assert.ok(label, 'should detect bcryptjs.compare');
    assert.equal(label.category, 'auth-step');
  });

  it('does not detect plain equality check', () => {
    const content = 'async function check(a, b) { return a === b; }';
    const node = { name: 'check', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'auth.js', content });
    const label = labels.find(l => l.detectorId === 'bcrypt-verify');
    assert.ok(!label, 'should not detect plain equality');
  });
});

describe('JS labelDetectors — safe-json-parse', () => {
  it('detects call to safeJsonParse()', () => {
    const content = 'function load(s) { return safeJsonParse(s, []); }';
    const node = { name: 'load', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'util.js', content });
    const label = labels.find(l => l.detectorId === 'safe-json-parse');
    assert.ok(label, 'should detect safeJsonParse call');
    assert.equal(label.category, 'validation');
  });

  it('does not detect JSON.parse()', () => {
    const content = 'function load(s) { return JSON.parse(s); }';
    const node = { name: 'load', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'util.js', content });
    const label = labels.find(l => l.detectorId === 'safe-json-parse');
    assert.ok(!label, 'should not detect JSON.parse');
  });
});
