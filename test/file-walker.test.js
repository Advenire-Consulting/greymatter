'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { collectFiles, SKIP_DIRS, TEXT_EXTENSIONS } = require('../lib/file-walker');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-walker-'));
}

describe('collectFiles', () => {
  let root;

  beforeEach(() => { root = makeTmp(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('collects text files recursively', () => {
    fs.writeFileSync(path.join(root, 'a.js'), '//');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.ts'), '//');
    fs.writeFileSync(path.join(root, 'sub', 'c.md'), '#');
    const files = collectFiles(root).map(f => path.relative(root, f)).sort();
    assert.deepEqual(files, ['a.js', 'sub/b.ts', 'sub/c.md']);
  });

  it('skips SKIP_DIRS', () => {
    for (const skipped of ['node_modules', '.git', 'dist', 'build', 'coverage']) {
      fs.mkdirSync(path.join(root, skipped));
      fs.writeFileSync(path.join(root, skipped, 'junk.js'), '//');
    }
    fs.writeFileSync(path.join(root, 'real.js'), '//');
    const files = collectFiles(root).map(f => path.relative(root, f));
    assert.deepEqual(files, ['real.js']);
  });

  it('skips dotfiles except .env.example', () => {
    fs.writeFileSync(path.join(root, '.hidden.js'), '//');
    fs.writeFileSync(path.join(root, '.env.example'), 'FOO=bar');
    fs.writeFileSync(path.join(root, 'shown.js'), '//');
    const files = collectFiles(root).map(f => path.relative(root, f)).sort();
    assert.deepEqual(files, ['.env.example', 'shown.js']);
  });

  it('skips non-text extensions', () => {
    fs.writeFileSync(path.join(root, 'keep.js'), '//');
    fs.writeFileSync(path.join(root, 'ignore.png'), 'x');
    fs.writeFileSync(path.join(root, 'ignore.zip'), 'x');
    const files = collectFiles(root).map(f => path.relative(root, f)).sort();
    assert.deepEqual(files, ['keep.js']);
  });

  it('skips LICENSE when it has no extension', () => {
    fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT');
    fs.writeFileSync(path.join(root, 'keep.md'), '#');
    const files = collectFiles(root).map(f => path.relative(root, f)).sort();
    assert.deepEqual(files, ['keep.md']);
  });

  it('accepts extensionless files that are not LICENSE', () => {
    fs.writeFileSync(path.join(root, 'Makefile'), 'all:\n\techo');
    const files = collectFiles(root).map(f => path.relative(root, f));
    assert.deepEqual(files, ['Makefile']);
  });

  it('returns empty array on unreadable directory and logs to stderr', () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = '';
    process.stderr.write = (data) => { captured += data; return true; };
    try {
      const files = collectFiles(path.join(root, 'does-not-exist'));
      assert.deepEqual(files, []);
      assert.ok(captured.includes('collectFiles:'), 'should log to stderr');
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it('exposes SKIP_DIRS and TEXT_EXTENSIONS as sets', () => {
    assert.ok(SKIP_DIRS instanceof Set);
    assert.ok(TEXT_EXTENSIONS instanceof Set);
    assert.ok(SKIP_DIRS.has('node_modules'));
    assert.ok(TEXT_EXTENSIONS.has('.js'));
    assert.ok(TEXT_EXTENSIONS.has('.md'));
  });
});
