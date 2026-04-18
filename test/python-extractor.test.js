'use strict';

// @tests extractors/python.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/python');

describe('Python Extractor', () => {
  it('has correct extension', () => {
    assert.deepEqual(extractor.extensions, ['.py']);
  });

  it('extracts function definitions', () => {
    const result = extractor.extract(
      "def process_data(items):\n    return [x for x in items]\n",
      'lib/utils.py', 'p'
    );
    const fn = result.nodes.find(n => n.name === 'process_data');
    assert.ok(fn);
    assert.equal(fn.type, 'function');
    assert.equal(fn.line, 1);
  });

  it('extracts class definitions', () => {
    const result = extractor.extract(
      "class DataProcessor:\n    def __init__(self):\n        pass\n    def run(self):\n        pass\n",
      'lib/processor.py', 'p'
    );
    const cls = result.nodes.find(n => n.name === 'DataProcessor');
    assert.ok(cls);
    assert.equal(cls.type, 'class');
  });

  it('extracts imports', () => {
    const result = extractor.extract(
      "import os\nfrom pathlib import Path\nfrom .utils import helper\n",
      'lib/main.py', 'p'
    );
    const imports = result.edges.filter(e => e.type === 'imports');
    assert.ok(imports.length >= 1);
    assert.ok(imports.some(e => e.target === '.utils'));
  });

  it('extracts decorators', () => {
    const result = extractor.extract(
      "@app.route('/api/data')\ndef get_data():\n    return {}\n",
      'routes.py', 'p'
    );
    const decorates = result.edges.filter(e => e.type === 'decorates');
    assert.ok(decorates.length >= 1);
  });

  it('extracts class methods with correct type and scope', () => {
    const content = `
class DataProcessor:
    def __init__(self, data):
        self.data = data

    def process(self):
        return self.data

def standalone_function():
    pass
`;
    const result = extractor.extract(content, 'processor.py', 'test');

    const initMethod = result.nodes.find(n => n.name === '__init__');
    assert.ok(initMethod, '__init__ should be extracted');
    assert.strictEqual(initMethod.type, 'method', '__init__ should be type method');
    const meta = JSON.parse(initMethod.metadata_json);
    assert.strictEqual(meta.scope, 'DataProcessor', '__init__ scope should be DataProcessor');

    const processMethod = result.nodes.find(n => n.name === 'process');
    assert.ok(processMethod, 'process should be extracted');
    assert.strictEqual(processMethod.type, 'method', 'process should be type method');

    const standalone = result.nodes.find(n => n.name === 'standalone_function');
    assert.ok(standalone, 'standalone_function should be extracted');
    assert.strictEqual(standalone.type, 'function', 'standalone should be type function');
  });

  describe('testPairs.isTestFile', () => {
    it('matches test_ prefix and _test suffix', () => {
      assert.equal(extractor.testPairs.isTestFile('pkg/test_foo.py'), true);
      assert.equal(extractor.testPairs.isTestFile('pkg/foo_test.py'), true);
      assert.equal(extractor.testPairs.isTestFile('pkg/foo.py'), false);
    });

    it('matches test/ and tests/ directories', () => {
      assert.equal(extractor.testPairs.isTestFile('tests/anything.py'), true);
      assert.equal(extractor.testPairs.isTestFile('test/anything.py'), true);
    });
  });

  describe('testPairs.candidateTestPaths', () => {
    it('emits sibling test_<name>.py and <name>_test.py', () => {
      const candidates = extractor.testPairs.candidateTestPaths('pkg/foo.py');
      assert.ok(candidates.includes('pkg/test_foo.py'));
      assert.ok(candidates.includes('pkg/foo_test.py'));
    });

    it('emits flat + mirror tests/ paths', () => {
      const candidates = extractor.testPairs.candidateTestPaths('pkg/foo.py');
      assert.ok(candidates.includes('tests/pkg/test_foo.py'));
      assert.ok(candidates.includes('tests/test_foo.py'));
    });

    it('handles src-layout by stripping src/ prefix for tests mirror', () => {
      const candidates = extractor.testPairs.candidateTestPaths('src/pkg/foo.py');
      assert.ok(candidates.includes('tests/pkg/test_foo.py'));
      assert.ok(candidates.includes('test/pkg/test_foo.py'));
    });
  });

  describe('testPairs.parseAnnotations', () => {
    it('captures # @tests annotations', () => {
      const sources = extractor.testPairs.parseAnnotations(
        "# @tests pkg/foo.py\nimport os\n"
      );
      assert.deepEqual(sources, ['pkg/foo.py']);
    });

    it('does not capture across newlines for bare # @tests', () => {
      const sources = extractor.testPairs.parseAnnotations(
        "# @tests\nimport os\n"
      );
      assert.deepEqual(sources, []);
    });

    it('only scans the first 20 lines', () => {
      const preamble = Array(25).fill('# header').join('\n');
      const sources = extractor.testPairs.parseAnnotations(
        `${preamble}\n# @tests pkg/late.py\n`
      );
      assert.deepEqual(sources, []);
    });
  });
});
