'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { seed, seedAndRegenerate } = require('../scripts/seed-signals');
const { MemoryDB } = require('../lib/memory-db');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-seed-'));
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('seed-signals', () => {
  let dataDir, realHome;

  beforeEach(() => {
    dataDir = mkTmpDataDir();
    // cmdGenerate writes signals.md to ~/.claude/rules/. Point HOME at the test tmp dir
    // so tests don't clobber the user's real rules file.
    realHome = process.env.HOME;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-seed-home-'));
    process.env.HOME = fakeHome;
    // Stash for teardown
    this.fakeHome = fakeHome;
  });

  afterEach(() => {
    rmrf(dataDir);
    if (this.fakeHome) rmrf(this.fakeHome);
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
  });

  it('seeds empty tables with expected counts', () => {
    const result = seed(dataDir, { quiet: true });
    assert.equal(result.seeded, true);
    assert.ok(result.signals >= 8, `expected ≥8 signals, got ${result.signals}`);
    assert.equal(result.forces, 4);

    const db = new MemoryDB(path.join(dataDir, 'memory.db'));
    try {
      const sigCount = db.db.prepare('SELECT COUNT(*) AS n FROM signals').get().n;
      const forceCount = db.db.prepare('SELECT COUNT(*) AS n FROM forces').get().n;
      assert.equal(sigCount, result.signals);
      assert.equal(forceCount, 4);
    } finally {
      db.close();
    }
  });

  it('is a no-op when signals already exist', () => {
    // Pre-seed one signal manually.
    const db = new MemoryDB(path.join(dataDir, 'memory.db'));
    db.insertSignal({
      type: 'amygdala', weight: 50, polarity: '-', label: 'pre-existing',
      description: null, context: null, filePattern: null, trigger: 'passive',
    });
    db.close();

    const result = seed(dataDir, { quiet: true });
    assert.equal(result.seeded, false);
    assert.equal(result.reason, 'not_empty');

    const db2 = new MemoryDB(path.join(dataDir, 'memory.db'));
    try {
      const sigCount = db2.db.prepare('SELECT COUNT(*) AS n FROM signals').get().n;
      assert.equal(sigCount, 1, 'pre-existing signal must be untouched and no new rows added');
    } finally {
      db2.close();
    }
  });

  it('seedAndRegenerate writes ~/.claude/rules/signals.md (non-empty)', () => {
    const result = seedAndRegenerate(dataDir, { quiet: true });
    assert.equal(result.seeded, true);

    const signalsMd = path.join(process.env.HOME, '.claude', 'rules', 'signals.md');
    assert.ok(fs.existsSync(signalsMd), 'signals.md must exist after seed');
    const content = fs.readFileSync(signalsMd, 'utf-8');
    assert.ok(content.length > 50, 'signals.md should contain rendered rules, not just a placeholder');
  });
});
