'use strict';

// @tests extractors/python.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/python');
const { runDetectorsForNode } = require('../lib/extractor-registry');

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

describe('Python extractBody', () => {
  it('captures top-level def body up to next outdent', () => {
    const SOURCE = [
      '',
      'def login(request):',
      "    if request.method == 'POST':",
      '        return jsonify({})',
      '    return None',
      '',
      'def helper():',
      '    return 1',
    ].join('\n');
    const body = extractor.extractBody(SOURCE, { line: 2, name: 'login' });
    assert.ok(body, 'should return a string');
    assert.ok(body.startsWith('def login(request):'));
    assert.ok(body.includes('return jsonify({})'));
    assert.ok(!body.includes('def helper'));
  });

  it('captures nested method body (indented past class keyword)', () => {
    const source = [
      'class Foo:',
      '    def method(self):',
      '        return 1',
      '',
      '    def other(self):',
      '        return 2',
    ].join('\n');
    const body = extractor.extractBody(source, { line: 2, name: 'method' });
    assert.ok(body.startsWith('    def method(self):'));
    assert.ok(!body.includes('def other'));
  });

  it('trims trailing blank lines', () => {
    const source = 'def f():\n    return 1\n\n\ndef g():\n    pass\n';
    const body = extractor.extractBody(source, { line: 1, name: 'f' });
    assert.ok(!body.endsWith('\n'), 'trailing newlines trimmed');
    assert.ok(body.includes('return 1'));
  });

  it('returns null when node.line is past EOF', () => {
    assert.equal(extractor.extractBody('def f():\n    pass\n', { line: 999, name: 'f' }), null);
  });
});

describe('Python labelDetectors — flask-route', () => {
  function runPy(source, defLine, name) {
    const node = { name, type: 'function', line: defLine };
    const ctx = { project: 'p', filePath: 'app.py', content: source };
    return runDetectorsForNode(extractor, node, ctx);
  }

  it('detects @app.route decorator', () => {
    const source = "@app.route('/login', methods=['POST'])\ndef login():\n    return jsonify({})\n";
    const labels = runPy(source, 2, 'login');
    const label = labels.find(l => l.detectorId === 'flask-route');
    assert.ok(label, 'should detect flask-route');
    assert.equal(label.category, 'route-handler');
    assert.deepEqual(label.descriptors, ['flask']);
  });

  it('detects @bp.route decorator', () => {
    const source = "@bp.route('/users')\ndef list_users():\n    return []\n";
    const labels = runPy(source, 2, 'list_users');
    const label = labels.find(l => l.detectorId === 'flask-route');
    assert.ok(label, 'should detect blueprint route');
  });

  it('detects with stacked decorators', () => {
    const source = "@require_auth\n@app.route('/admin')\ndef admin():\n    return None\n";
    const labels = runPy(source, 3, 'admin');
    const label = labels.find(l => l.detectorId === 'flask-route');
    assert.ok(label, 'should detect through stacked decorators');
  });

  it('does not detect plain function', () => {
    const source = 'def helper():\n    return None\n';
    const labels = runPy(source, 1, 'helper');
    const label = labels.find(l => l.detectorId === 'flask-route');
    assert.ok(!label, 'should not detect plain function');
  });
});

describe('Python labelDetectors — django-view', () => {
  it('detects function with request param in views.py', () => {
    const source = 'def index(request):\n    return render(request, "index.html")\n';
    const node = { name: 'index', type: 'function', line: 1 };
    const labels = runDetectorsForNode(extractor, node, {
      project: 'p', filePath: 'app/views.py', content: source,
    });
    const label = labels.find(l => l.detectorId === 'django-view');
    assert.ok(label, 'should detect django view');
    assert.equal(label.category, 'route-handler');
  });

  it('does not detect same signature in utils.py', () => {
    const source = 'def index(request):\n    return None\n';
    const node = { name: 'index', type: 'function', line: 1 };
    const labels = runDetectorsForNode(extractor, node, {
      project: 'p', filePath: 'app/utils.py', content: source,
    });
    const label = labels.find(l => l.detectorId === 'django-view');
    assert.ok(!label, 'should not detect in utils.py');
  });
});

describe('Python labelDetectors — sqlalchemy-query', () => {
  it('detects session.query()', () => {
    const content = 'def get_users(session):\n    return session.query(User).all()\n';
    const node = { name: 'get_users', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'db.py', content });
    const label = labels.find(l => l.detectorId === 'sqlalchemy-query');
    assert.ok(label, 'should detect session.query');
    assert.equal(label.category, 'data-access');
  });

  it('detects Model.query chain', () => {
    const content = 'def get_active():\n    return User.query.filter_by(active=True).all()\n';
    const node = { name: 'get_active', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'db.py', content });
    const label = labels.find(l => l.detectorId === 'sqlalchemy-query');
    assert.ok(label, 'should detect Model.query chain');
  });

  it('does not detect bare query() call', () => {
    const content = 'def helper():\n    return query("SELECT 1")\n';
    const node = { name: 'helper', type: 'function', line: 1, body: content };
    const labels = runDetectorsForNode(extractor, node, { project: 'p', filePath: 'db.py', content });
    const label = labels.find(l => l.detectorId === 'sqlalchemy-query');
    assert.ok(!label, 'should not detect bare query()');
  });
});
