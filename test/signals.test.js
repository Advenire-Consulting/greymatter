'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');

function tmpDbPath() {
  return path.join(__dirname, `test-signals-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('Signals', () => {
  let db, queries, dbPath;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new MemoryDB(dbPath);
    queries = new MemoryQueries(db);
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('insertSignal creates and returns id', () => {
    const id = db.insertSignal({
      type: 'nucleus_accumbens', weight: 85, polarity: '+',
      label: 'Ask before acting', description: 'User wants to be consulted',
      trigger: 'passive'
    });
    assert.ok(id > 0);
  });

  it('updateSignalWeight changes weight', () => {
    const id = db.insertSignal({ type: 'amygdala', weight: 50, polarity: '-', label: 'test', trigger: 'passive' });
    db.updateSignalWeight(id, 80);
    const row = db.db.prepare('SELECT weight FROM signals WHERE id = ?').get(id);
    assert.equal(row.weight, 80);
  });

  it('archiveSignal sets archived flag', () => {
    const id = db.insertSignal({ type: 'amygdala', weight: 50, polarity: '-', label: 'test', trigger: 'passive' });
    db.archiveSignal(id);
    const row = db.db.prepare('SELECT archived FROM signals WHERE id = ?').get(id);
    assert.equal(row.archived, 1);
  });

  it('getActiveSignals filters by trigger and threshold', () => {
    db.insertSignal({ type: 'amygdala', weight: 90, polarity: '-', label: 'high', trigger: 'passive' });
    db.insertSignal({ type: 'amygdala', weight: 40, polarity: '-', label: 'low', trigger: 'passive' });
    db.insertSignal({ type: 'amygdala', weight: 90, polarity: '-', label: 'pre_write', trigger: 'pre_write' });
    const active = queries.getActiveSignals('passive', 75);
    assert.equal(active.length, 1);
    assert.equal(active[0].label, 'high');
  });

  it('insertForce + getActiveForces', () => {
    db.insertForce({ name: 'Engage, don\'t validate', description: 'Push back on incomplete ideas', score: 82 });
    const forces = queries.getActiveForces(75);
    assert.equal(forces.length, 1);
    assert.equal(forces[0].name, 'Engage, don\'t validate');
  });

  it('generateSignalsMd produces markdown', () => {
    db.insertSignal({ type: 'nucleus_accumbens', weight: 90, polarity: '+', label: 'Ask before acting', description: 'Consult user', trigger: 'passive' });
    db.insertForce({ name: 'Second seat', description: 'Optimize for the next reader', score: 88 });
    const md = queries.generateSignalsMd(75);
    assert.ok(md.includes('Ask before acting'));
    assert.ok(md.includes('Second seat'));
    assert.ok(md.includes('Behavioral Rules'));
    assert.ok(md.includes('Relational Forces'));
  });
});
