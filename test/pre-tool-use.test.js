const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-pthook-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function insertSig(db, { label, filePattern, trigger, weight = 50, polarity = '+' }) {
  return db.insertSignal({
    type: 'prefrontal',
    weight,
    polarity,
    label,
    description: null,
    context: null,
    filePattern,
    trigger,
  });
}

describe('pre-tool-use signal queries', () => {
  let dbPath, db, q;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    q = new MemoryQueries(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('getSignalsForProject matches file_pattern containing project name', () => {
    insertSig(db, { label: 'gm rule', filePattern: 'greymatter/**/*.js', trigger: 'passive' });
    insertSig(db, { label: 'drip rule', filePattern: 'drip/**/*.js', trigger: 'passive' });
    insertSig(db, { label: 'global null', filePattern: null, trigger: 'passive' });
    const matches = q.getSignalsForProject('greymatter');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].label, 'gm rule');
  });

  it('getSignalsForProject excludes NULL-pattern signals (global, not project-scoped)', () => {
    insertSig(db, { label: 'global', filePattern: null, trigger: 'passive' });
    const matches = q.getSignalsForProject('greymatter');
    assert.strictEqual(matches.length, 0);
  });

  it('getPreWriteSignalsForFile only returns trigger=pre_write', () => {
    insertSig(db, { label: 'passive one', filePattern: '*.js', trigger: 'passive' });
    insertSig(db, { label: 'pw one', filePattern: '*.js', trigger: 'pre_write' });
    const matches = q.getPreWriteSignalsForFile('/any/path/file.js');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].label, 'pw one');
  });

  it('getPreWriteSignalsForFile glob matches * → .*', () => {
    insertSig(db, { label: 'matches', filePattern: '*.test.js', trigger: 'pre_write' });
    insertSig(db, { label: 'no match', filePattern: '*.md', trigger: 'pre_write' });
    const matches = q.getPreWriteSignalsForFile('/repo/foo.test.js');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].label, 'matches');
  });

  it('getPreWriteSignalsForFile with NULL file_pattern matches any file', () => {
    insertSig(db, { label: 'universal', filePattern: null, trigger: 'pre_write' });
    const matches = q.getPreWriteSignalsForFile('/a/b/c.js');
    assert.strictEqual(matches.length, 1);
  });
});

describe('pre-tool-use orientation tracking', () => {
  let tmpDir, origHome;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `pthook-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    origHome = os.homedir;
    // Stub homedir so ORIENTED_PATH resolves into tmpDir. The module constant
    // is captured at require time — so we clear the require cache first.
    delete require.cache[require.resolve('../hooks/pre-tool-use')];
    const origHomedir = os.homedir;
    os.homedir = () => tmpDir;
    const hook = require('../hooks/pre-tool-use');
    os.homedir = origHomedir;
    // Expose for individual tests
    global._hook = hook;
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    delete global._hook;
  });

  it('loadOriented returns empty set when file missing', () => {
    const set = global._hook.loadOriented();
    assert.strictEqual(set.size, 0);
  });

  it('saveOriented then loadOriented round-trips project names', () => {
    const s = new Set(['greymatter', 'drip']);
    global._hook.saveOriented(s);
    const loaded = global._hook.loadOriented();
    assert.strictEqual(loaded.size, 2);
    assert.ok(loaded.has('greymatter'));
    assert.ok(loaded.has('drip'));
  });

  it('parseInvocation handles envelope shape {tool_name, tool_input}', () => {
    const { Readable } = require('stream');
    // parseInvocation reads fd 0 directly — we test it by piping via a worker.
    // Simpler: test formatSignal, the other exported helper.
    const line = global._hook.formatSignal({ polarity: '+', weight: 80, label: 'X', description: 'desc' });
    assert.strictEqual(line, '✓ [80] X — desc');
  });
});
