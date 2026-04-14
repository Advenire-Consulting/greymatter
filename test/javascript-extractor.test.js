'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/javascript');

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
});
