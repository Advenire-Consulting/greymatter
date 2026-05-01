'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { collectFiles, SKIP_DIRS, TEXT_EXTENSIONS } = require('../lib/file-walker');
const { loadPolicy } = require('../lib/exclusion');

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

describe('collectFiles policy integration', () => {
  let root;

  beforeEach(() => { root = makeTmp(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('excludes *.env files when policy is provided (Task 3.1)', () => {
    // Step 1: failing test before fix — production.env is in TEXT_EXTENSIONS so
    // collectFiles currently includes it; isExcluded should exclude it after fix.
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'index.js'), '//');
    fs.writeFileSync(path.join(root, 'src', 'production.env'), 'SECRET=1');
    const policy = loadPolicy(root, {
      exclusion: { respect_gitignore: false, extra_patterns: [], respect_greymatterignore: true },
    });
    const files = collectFiles(root, { policy }).map(f => path.relative(root, f)).sort();
    assert.ok(files.includes('src/index.js'), 'index.js should be collected');
    assert.ok(!files.some(f => f === 'src/production.env'), 'production.env should be excluded by *.env pattern');
  });

  it('falls back to default policy when called without opts (Task 3.1 backwards compat)', () => {
    // Step 5: backwards-compat test — *.env still excluded even without explicit policy
    fs.writeFileSync(path.join(root, 'index.js'), '//');
    fs.writeFileSync(path.join(root, 'secret.env'), 'KEY=val');
    const files = collectFiles(root).map(f => path.relative(root, f));
    assert.ok(files.includes('index.js'), 'index.js should be included');
    assert.ok(!files.includes('secret.env'), 'secret.env should be excluded by default BUILTIN patterns');
  });
});

describe('extractFiles policy integration (Task 3.3)', () => {
  const { GraphDB } = require('../lib/graph-db');
  let root, scanDb, scanDbPath;

  beforeEach(() => {
    root = makeTmp();
    scanDbPath = path.join(os.tmpdir(), `gm-scan-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    scanDb = new GraphDB(scanDbPath);
  });

  afterEach(() => {
    scanDb.close();
    try { fs.unlinkSync(scanDbPath); } catch {}
    try { fs.unlinkSync(scanDbPath + '-wal'); } catch {}
    try { fs.unlinkSync(scanDbPath + '-shm'); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('excludes files matched by extra_patterns from walkDir and extractFiles (Task 3.3)', () => {
    // Step 1: failing test before fix — extractFiles ignores config, extracts secrets/x.js
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.writeFileSync(path.join(root, 'secrets', 'x.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};');

    const { extractFiles } = require('../scripts/scan');
    const config = { exclusion: { respect_gitignore: false, extra_patterns: ['secrets/'], respect_greymatterignore: false } };
    extractFiles({ db: scanDb, project: 'p', rootPath: root, config });

    const rows = scanDb.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'secrets/x.js');
    assert.equal(rows.length, 0, 'secrets/x.js should be excluded by extra_patterns policy');

    // index.js should be extracted — verifies scan ran at all
    const idxRows = scanDb.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').all('p', 'index.js');
    assert.ok(idxRows.length > 0, 'index.js should be extracted');
  });
});
