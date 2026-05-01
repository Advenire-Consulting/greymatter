'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { GraphDB } = require('../lib/graph-db');

function seedNode(db) {
  return db.upsertNode({ project: 'p', file: 'f.js', name: 'fn', type: 'function', line: 1 });
}

function insertLabel(db, nodeId, overrides = {}) {
  const defaults = {
    node_id: nodeId,
    detector_id: 'test.det',
    term: 'middleware',
    category: 'middleware',
    confidence: 0.9,
    source: 'heuristic',
    is_stale: 0,
    body_hash_at_label: null,
  };
  const row = { ...defaults, ...overrides };
  db.db.prepare(`
    INSERT INTO code_labels
      (node_id, detector_id, term, category, confidence, source, is_stale, body_hash_at_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.node_id, row.detector_id, row.term, row.category,
         row.confidence, row.source, row.is_stale, row.body_hash_at_label);
  return db.db.prepare('SELECT last_insert_rowid() as id').get().id;
}

describe('code_labels helpers', () => {
  let db, nodeId;

  beforeEach(() => {
    db = new GraphDB(':memory:');
    nodeId = seedNode(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Task 1.2: getLabels ────────────────────────────────────────────────────

  describe('getLabels', () => {
    it('priority: manual beats llm and heuristic regardless of confidence', () => {
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.95, detector_id: 'det.h' });
      insertLabel(db, nodeId, { source: 'llm',       confidence: 0.85, detector_id: 'det.l' });
      insertLabel(db, nodeId, { source: 'manual',    confidence: 0.75, detector_id: 'det.m' });
      const result = db.getLabels(nodeId);
      assert.equal(result.source, 'manual');
    });

    it('confidence tiebreak within same source', () => {
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.90, detector_id: 'det.a' });
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.95, detector_id: 'det.b' });
      const result = db.getLabels(nodeId);
      assert.equal(result.confidence, 0.95);
      assert.equal(result.detector_id, 'det.b');
    });

    it('excludes stale by default; includes stale with { all: true }', () => {
      insertLabel(db, nodeId, { source: 'llm',       confidence: 0.9, detector_id: 'det.l', is_stale: 1 });
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.7, detector_id: 'det.h', is_stale: 0 });
      const fresh = db.getLabels(nodeId);
      assert.equal(fresh.source, 'heuristic');
      const all = db.getLabels(nodeId, { all: true });
      // all returns single highest-priority — stale llm wins priority, still included
      assert.equal(all.source, 'llm');
    });

    it('multi: true returns all labels sorted by priority then confidence', () => {
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.9, detector_id: 'det.h1' });
      insertLabel(db, nodeId, { source: 'llm',       confidence: 0.8, detector_id: 'det.l' });
      insertLabel(db, nodeId, { source: 'heuristic', confidence: 0.7, detector_id: 'det.h2' });
      const results = db.getLabels(nodeId, { multi: true });
      assert.equal(results.length, 3);
      // llm before heuristic
      assert.equal(results[0].source, 'llm');
      // heuristic with higher confidence first
      assert.equal(results[1].confidence, 0.9);
      assert.equal(results[2].confidence, 0.7);
    });

    it('no labels returns null (default) or [] (multi)', () => {
      assert.equal(db.getLabels(nodeId), null);
      assert.deepEqual(db.getLabels(nodeId, { multi: true }), []);
    });
  });

  // ── Task 1.3: upsertLabel ─────────────────────────────────────────────────

  describe('upsertLabel', () => {
    it('insert path: creates row; getLabels returns it', () => {
      db.upsertLabel({
        nodeId, detectorId: 'js.express-middleware',
        term: 'middleware', category: 'middleware',
        descriptors: ['express', 'request'],
        confidence: 0.9, source: 'heuristic',
        bodyHashAtLabel: 'abc',
      });
      const row = db.getLabels(nodeId);
      assert.ok(row);
      assert.equal(row.detector_id, 'js.express-middleware');
      assert.equal(row.term, 'middleware');
      assert.equal(row.confidence, 0.9);
    });

    it('upsert path: updates existing row, resets is_stale, preserves created_at, refreshes updated_at', () => {
      db.upsertLabel({
        nodeId, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.8, source: 'heuristic',
        bodyHashAtLabel: 'old',
      });
      const before = db.getLabels(nodeId);
      // Mark stale manually
      db.db.prepare('UPDATE code_labels SET is_stale = 1 WHERE id = ?').run(before.id);

      db.upsertLabel({
        nodeId, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.95, source: 'heuristic',
        bodyHashAtLabel: 'new',
      });
      const count = db.db.prepare('SELECT COUNT(*) as c FROM code_labels WHERE node_id = ?').get(nodeId).c;
      assert.equal(count, 1);
      const after = db.getLabels(nodeId);
      assert.equal(after.confidence, 0.95);
      assert.equal(after.is_stale, 0);
      assert.equal(after.created_at, before.created_at);
      assert.ok(after.updated_at !== null);
    });

    it('confidence clamp: >1.0 becomes 1.0 with warning; <0.0 becomes 0.0 with warning', (t) => {
      const spy = t.mock.method(console, 'warn');

      db.upsertLabel({
        nodeId, detectorId: 'js.high', term: 'middleware',
        category: 'middleware', confidence: 1.5, source: 'heuristic',
      });
      const high = db.getLabels(nodeId, { all: true });
      assert.equal(high.confidence, 1.0);
      assert.equal(spy.mock.calls.length, 1);

      const nodeId2 = db.upsertNode({ project: 'p', file: 'f2.js', name: 'fn2', type: 'function', line: 1 });
      db.upsertLabel({
        nodeId: nodeId2, detectorId: 'js.low', term: 'middleware',
        category: 'middleware', confidence: -0.2, source: 'heuristic',
      });
      const low = db.getLabels(nodeId2, { all: true });
      assert.equal(low.confidence, 0.0);
      assert.equal(spy.mock.calls.length, 2);
    });

    it('different source same detector_id: both rows persist', () => {
      db.upsertLabel({
        nodeId, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.9, source: 'heuristic',
      });
      db.upsertLabel({
        nodeId, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.85, source: 'llm',
      });
      const count = db.db.prepare('SELECT COUNT(*) as c FROM code_labels WHERE node_id = ?').get(nodeId).c;
      assert.equal(count, 2);
    });

    it('descriptors_json round-trip; undefined descriptors stores NULL', () => {
      db.upsertLabel({
        nodeId, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.9, source: 'heuristic',
        descriptors: ['a', 'b'],
      });
      const row = db.getLabels(nodeId);
      assert.deepEqual(JSON.parse(row.descriptors_json), ['a', 'b']);

      const nodeId2 = db.upsertNode({ project: 'p', file: 'f2.js', name: 'fn2', type: 'function', line: 1 });
      db.upsertLabel({
        nodeId: nodeId2, detectorId: 'js.det', term: 'middleware',
        category: 'middleware', confidence: 0.9, source: 'heuristic',
      });
      const row2 = db.getLabels(nodeId2);
      assert.equal(row2.descriptors_json, null);
    });
  });

  // ── Task 1.4: markLabelsStale ─────────────────────────────────────────────

  describe('markLabelsStale', () => {
    it('marks rows stale when body_hash_at_label differs from new hash', () => {
      insertLabel(db, nodeId, { detector_id: 'det.a', body_hash_at_label: 'old', is_stale: 0 });
      insertLabel(db, nodeId, { detector_id: 'det.b', body_hash_at_label: 'old', is_stale: 0 });
      db.markLabelsStale(nodeId, 'new');
      const rows = db.db.prepare('SELECT is_stale, updated_at FROM code_labels WHERE node_id = ?').all(nodeId);
      for (const row of rows) {
        assert.equal(row.is_stale, 1);
        assert.ok(row.updated_at !== null);
      }
    });

    it('no-op when body_hash_at_label matches new hash', () => {
      insertLabel(db, nodeId, { detector_id: 'det.a', body_hash_at_label: 'same', is_stale: 0 });
      db.markLabelsStale(nodeId, 'same');
      const row = db.db.prepare('SELECT is_stale, updated_at FROM code_labels WHERE node_id = ?').get(nodeId);
      assert.equal(row.is_stale, 0);
      assert.equal(row.updated_at, null);
    });

    it('NULL body_hash_at_label is not marked stale (SQL NULL != string is NULL)', () => {
      insertLabel(db, nodeId, { detector_id: 'det.a', body_hash_at_label: null, is_stale: 0 });
      db.markLabelsStale(nodeId, 'new');
      const row = db.db.prepare('SELECT is_stale FROM code_labels WHERE node_id = ?').get(nodeId);
      assert.equal(row.is_stale, 0);
    });
  });

  // ── Task 1.5: getNodeBodyHash / setNodeBodyHash ───────────────────────────

  describe('body hash accessors', () => {
    it('getNodeBodyHash returns stored value after setNodeBodyHash', () => {
      db.setNodeBodyHash(nodeId, 'abc123');
      assert.equal(db.getNodeBodyHash(nodeId), 'abc123');
    });

    it('setNodeBodyHash updates the value', () => {
      db.setNodeBodyHash(nodeId, 'first');
      db.setNodeBodyHash(nodeId, 'new-hash');
      assert.equal(db.getNodeBodyHash(nodeId), 'new-hash');
    });

    it('getNodeBodyHash for non-existent id returns null', () => {
      assert.equal(db.getNodeBodyHash(99999), null);
    });
  });
});
