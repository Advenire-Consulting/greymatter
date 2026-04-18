'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  run, validate, findForceByName, REINFORCE_DELTA,
} = require('../scripts/oxytocin-helper');
const { MemoryDB } = require('../lib/memory-db');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-oxy-'));
}

describe('oxytocin-helper.validate', () => {
  it('throws when name is missing or blank', () => {
    assert.throws(() => validate({ name: null, action: 'add' }), /name is required/);
    assert.throws(() => validate({ name: '   ', action: 'add' }), /name is required/);
  });

  it('throws on invalid action', () => {
    assert.throws(() => validate({ name: 'x', action: 'delete' }), /action must be one of/);
  });

  it('allows null score for update/reinforce', () => {
    assert.doesNotThrow(() => validate({ name: 'x', action: 'update', score: null }));
    assert.doesNotThrow(() => validate({ name: 'x', action: 'reinforce', score: null }));
  });

  it('rejects non-integer score', () => {
    assert.throws(() => validate({ name: 'x', action: 'add', score: 50.5 }), /integer between 0 and 100/);
  });

  it('rejects out-of-range score', () => {
    assert.throws(() => validate({ name: 'x', action: 'add', score: -1 }), /integer between 0 and 100/);
    assert.throws(() => validate({ name: 'x', action: 'add', score: 101 }), /integer between 0 and 100/);
  });
});

describe('findForceByName', () => {
  let dir, memDb;

  beforeEach(() => {
    dir = makeTmp();
    memDb = new MemoryDB(path.join(dir, 'memory.db'));
  });

  afterEach(() => {
    memDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the active force by name', () => {
    memDb.insertForce({ name: 'Cadence', description: null, score: 50 });
    const row = findForceByName(memDb, 'Cadence');
    assert.ok(row);
    assert.equal(row.score, 50);
  });

  it('ignores archived forces', () => {
    const id = memDb.insertForce({ name: 'Archived', description: null, score: 50 });
    memDb.archiveForce(id);
    assert.equal(findForceByName(memDb, 'Archived'), undefined);
  });

  it('returns the newest when duplicates exist', () => {
    memDb.insertForce({ name: 'Dup', description: 'first', score: 30 });
    memDb.insertForce({ name: 'Dup', description: 'second', score: 70 });
    const row = findForceByName(memDb, 'Dup');
    assert.equal(row.score, 70);
  });
});

describe('oxytocin-helper.run', () => {
  let dir;

  beforeEach(() => { dir = makeTmp(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('action=add inserts a new force and returns the row', () => {
    const row = run(
      { name: 'NewForce', description: 'desc', score: 60, action: 'add' },
      { dataDir: dir, skipGenerate: true }
    );
    assert.equal(row.name, 'NewForce');
    assert.equal(row.score, 60);
    assert.equal(row.description, 'desc');
  });

  it('action=add requires a score', () => {
    assert.throws(
      () => run({ name: 'NoScore', action: 'add' }, { dataDir: dir, skipGenerate: true }),
      /score is required for action=add/
    );
  });

  it('action=update modifies score and description', () => {
    run({ name: 'F', score: 50, action: 'add' }, { dataDir: dir, skipGenerate: true });
    const updated = run(
      { name: 'F', description: 'new desc', score: 75, action: 'update' },
      { dataDir: dir, skipGenerate: true }
    );
    assert.equal(updated.score, 75);
    assert.equal(updated.description, 'new desc');
  });

  it('action=update throws when no active force exists', () => {
    assert.throws(
      () => run({ name: 'ghost', score: 50, action: 'update' }, { dataDir: dir, skipGenerate: true }),
      /no active force named "ghost"/
    );
  });

  it(`action=reinforce bumps score by REINFORCE_DELTA (${REINFORCE_DELTA})`, () => {
    run({ name: 'R', score: 50, action: 'add' }, { dataDir: dir, skipGenerate: true });
    const out = run({ name: 'R', action: 'reinforce' }, { dataDir: dir, skipGenerate: true });
    assert.equal(out.score, 50 + REINFORCE_DELTA);
  });

  it('action=reinforce caps at 100', () => {
    run({ name: 'Capped', score: 98, action: 'add' }, { dataDir: dir, skipGenerate: true });
    const out = run({ name: 'Capped', action: 'reinforce' }, { dataDir: dir, skipGenerate: true });
    assert.equal(out.score, 100);
  });

  it('action=reinforce throws when force is missing', () => {
    assert.throws(
      () => run({ name: 'missing', action: 'reinforce' }, { dataDir: dir, skipGenerate: true }),
      /no active force named "missing"/
    );
  });
});
