'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../scripts/dopamine-helper');
const { MemoryDB } = require('../lib/memory-db');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Count signals in the temp memory.db.
function countSignals(dataDir) {
  const db = new MemoryDB(path.join(dataDir, 'memory.db'));
  try {
    return db.db.prepare('SELECT COUNT(*) AS n FROM signals').get().n;
  } finally {
    db.close();
  }
}

describe('dopamine-helper.run', () => {
  let dataDir, realHome, fakeHome, origStderrWrite, stderrBuf;

  beforeEach(() => {
    dataDir = mkTmpDir('gm-dopa-');
    // cmdGenerate writes ~/.claude/rules/greymatter-signals.md; point HOME at tmp.
    realHome = process.env.HOME;
    fakeHome = mkTmpDir('gm-dopa-home-');
    process.env.HOME = fakeHome;
    // Capture stderr for warning assertions.
    stderrBuf = '';
    origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrBuf += chunk; return true; };
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    rmrf(dataDir);
    rmrf(fakeHome);
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
  });

  it('inserts a valid +/nucleus_accumbens signal', () => {
    const before = countSignals(dataDir);
    const row = run({
      label: 'prefers terse summaries',
      description: 'user corrected verbose summary style',
      polarity: '+',
      type: 'nucleus_accumbens',
      weight: 80,
    }, { dataDir });
    assert.equal(countSignals(dataDir) - before, 1);
    assert.equal(row.label, 'prefers terse summaries');
    assert.equal(row.type, 'nucleus_accumbens');
    assert.equal(row.weight, 80);
  });

  it('rejects invalid type with no row inserted', () => {
    const before = countSignals(dataDir);
    assert.throws(
      () => run({ label: 'x', polarity: '+', type: 'dopamine', weight: 50 }, { dataDir }),
      /type must be one of/,
    );
    assert.equal(countSignals(dataDir), before);
  });

  it('rejects out-of-range weight', () => {
    const before = countSignals(dataDir);
    assert.throws(
      () => run({ label: 'x', polarity: '+', type: 'nucleus_accumbens', weight: 150 }, { dataDir }),
      /weight must be an integer/,
    );
    assert.equal(countSignals(dataDir), before);
  });

  it('warns but succeeds on polarity/type mismatch', () => {
    const before = countSignals(dataDir);
    const row = run({
      label: 'unconventional combo',
      polarity: '-',
      type: 'nucleus_accumbens',
      weight: 60,
    }, { dataDir });
    assert.equal(countSignals(dataDir) - before, 1);
    assert.equal(row.polarity, '-');
    assert.match(stderrBuf, /unconventional polarity\/type/);
  });

  it('rejects missing label', () => {
    const before = countSignals(dataDir);
    assert.throws(
      () => run({ polarity: '+', type: 'nucleus_accumbens', weight: 50 }, { dataDir }),
      /label is required/,
    );
    assert.equal(countSignals(dataDir), before);
  });
});
