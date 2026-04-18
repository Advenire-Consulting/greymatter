'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ExtractorRegistry } = require('../lib/extractor-registry');
const {
  buildAnnotationMap,
  invertAnnotationMap,
  resolvePair,
  isTestFile,
} = require('../lib/test-alerts/pairing');

let tmpRoot;
function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-pairing-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('test-alerts pairing', () => {
  let registry;
  beforeEach(() => {
    tmpRoot = mkTmp();
    registry = new ExtractorRegistry();
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('matches a .test.js sibling by convention', () => {
    write(tmpRoot, 'src/foo.js', 'module.exports = {};');
    write(tmpRoot, 'src/foo.test.js', '// pretend test');
    const pairs = resolvePair('src/foo.js', tmpRoot, registry, new Map());
    assert.deepEqual(pairs, ['src/foo.test.js']);
  });

  it('matches a __tests__/ subdirectory test', () => {
    write(tmpRoot, 'src/bar.js', 'module.exports = {};');
    write(tmpRoot, 'src/__tests__/bar.test.js', '// pretend test');
    const pairs = resolvePair('src/bar.js', tmpRoot, registry, new Map());
    assert.deepEqual(pairs, ['src/__tests__/bar.test.js']);
  });

  it('matches a top-level tests/ mirror', () => {
    write(tmpRoot, 'lib/baz.js', 'module.exports = {};');
    write(tmpRoot, 'tests/lib/baz.js', '// pretend test');
    const pairs = resolvePair('lib/baz.js', tmpRoot, registry, new Map());
    assert.deepEqual(pairs, ['tests/lib/baz.js']);
  });

  it('annotation override beats convention', () => {
    write(tmpRoot, 'src/alpha.js', 'module.exports = {};');
    write(tmpRoot, 'src/alpha.test.js', '// convention test');
    write(tmpRoot, 'test/custom-alpha.test.js', '// @tests src/alpha.js\n');
    const map = buildAnnotationMap(tmpRoot, registry, [
      'src/alpha.test.js',
      'test/custom-alpha.test.js',
    ]);
    const inv = invertAnnotationMap(map);
    const pairs = resolvePair('src/alpha.js', tmpRoot, registry, inv);
    assert.deepEqual(pairs, ['test/custom-alpha.test.js']);
  });

  it('annotation with multiple source paths fans out', () => {
    write(tmpRoot, 'src/a.js', '');
    write(tmpRoot, 'src/b.js', '');
    write(tmpRoot, 'test/combined.test.js', '// @tests src/a.js\n// @tests src/b.js\n');
    const map = buildAnnotationMap(tmpRoot, registry, ['test/combined.test.js']);
    const inv = invertAnnotationMap(map);
    assert.deepEqual(resolvePair('src/a.js', tmpRoot, registry, inv), ['test/combined.test.js']);
    assert.deepEqual(resolvePair('src/b.js', tmpRoot, registry, inv), ['test/combined.test.js']);
  });

  it('one test annotating two sources: both sources pair to that test', () => {
    write(tmpRoot, 'src/x.js', '');
    write(tmpRoot, 'src/y.js', '');
    write(tmpRoot, 'test/pair.test.js', '// @tests src/x.js\n// @tests src/y.js\n');
    const map = buildAnnotationMap(tmpRoot, registry, ['test/pair.test.js']);
    assert.deepEqual(map.get('test/pair.test.js'), ['src/x.js', 'src/y.js']);
  });

  it('no convention match and no annotation → empty array', () => {
    write(tmpRoot, 'src/orphan.js', '');
    const pairs = resolvePair('src/orphan.js', tmpRoot, registry, new Map());
    assert.deepEqual(pairs, []);
  });

  it('extension with no extractor → empty array (e.g. .rs)', () => {
    write(tmpRoot, 'src/thing.rs', 'fn main() {}');
    const pairs = resolvePair('src/thing.rs', tmpRoot, registry, new Map());
    assert.deepEqual(pairs, []);
  });

  it('malformed annotation (missing path) is silently ignored', () => {
    write(tmpRoot, 'src/q.js', '');
    write(tmpRoot, 'test/q.test.js', '// @tests\nmodule.exports = {};');
    const map = buildAnnotationMap(tmpRoot, registry, ['test/q.test.js']);
    // matchAll with \S+ won't match a bare "@tests" followed by newline — so no entry.
    assert.equal(map.has('test/q.test.js'), false);
  });

  it('isTestFile recognizes .test.js and test/ layouts', () => {
    assert.equal(isTestFile('src/foo.test.js', registry), true);
    assert.equal(isTestFile('test/lib/baz.js', registry), true);
    assert.equal(isTestFile('src/foo.js', registry), false);
    assert.equal(isTestFile('src/thing.rs', registry), false);
  });
});
