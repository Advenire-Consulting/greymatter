'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ExtractorRegistry } = require('../lib/extractor-registry');

describe('ExtractorRegistry', () => {
  it('discovers extractors from directory', () => {
    const registry = new ExtractorRegistry();
    const exts = registry.supportedExtensions();
    assert.ok(exts.includes('.js'));
    assert.ok(exts.includes('.mjs'));
    assert.ok(exts.includes('.cjs'));
  });

  it('getExtractor returns extractor for known extension', () => {
    const registry = new ExtractorRegistry();
    const ext = registry.getExtractor('.js');
    assert.ok(ext);
    assert.ok(typeof ext.extract === 'function');
  });

  it('getExtractor returns null for unknown extension', () => {
    const registry = new ExtractorRegistry();
    assert.equal(registry.getExtractor('.xyz'), null);
  });

  it('extractFile routes to correct extractor', () => {
    const registry = new ExtractorRegistry();
    const result = registry.extractFile(
      "const foo = require('./bar');\nfunction doStuff() { return 42; }\nmodule.exports = { doStuff };",
      'lib/test.js',
      'myproject'
    );
    assert.ok(result.nodes.length > 0);
    assert.ok(result.edges.length > 0);
  });

  it('returns empty result for unknown extension', () => {
    const registry = new ExtractorRegistry();
    const result = registry.extractFile('some content', 'file.xyz', 'p');
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.edges, []);
    assert.deepEqual(result.edge_types, []);
  });
});
