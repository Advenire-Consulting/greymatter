'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { GraphDB } = require('../lib/graph-db');
const { reconcile } = require('../lib/test-alerts/reconcile');

function tmpDbPath() {
  return path.join(os.tmpdir(), `gm-reconcile-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

const PROJECT = 'myproject';

function openCountFor(db, project) {
  return db.db.prepare(
    'SELECT COUNT(*) AS c FROM test_findings WHERE project = ? AND resolved_at IS NULL'
  ).get(project).c;
}
function allRows(db, project) {
  return db.db.prepare(
    'SELECT * FROM test_findings WHERE project = ? ORDER BY id'
  ).all(project);
}
function scanState(db, project) {
  return db.db.prepare(
    'SELECT * FROM project_scan_state WHERE project = ?'
  ).get(project);
}

describe('test-alerts reconcile', () => {
  let db, dbPath;
  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
  });
  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch {}
    }
  });

  it('first scan inserts all current findings as newly_added', () => {
    const result = reconcile({
      graphDb: db, project: PROJECT, headSha: 'aaaaaaa',
      mode: 'incremental',
      currentFindings: [
        { source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' },
        { source_file: 'src/b.js', kind: 'missing_test', test_file: null },
      ],
      resolvedRows: [],
    });
    assert.equal(result.newlyAdded.length, 2);
    assert.equal(result.stillPresent.length, 0);
    assert.equal(openCountFor(db, PROJECT), 2);
    assert.equal(scanState(db, PROJECT).last_scan_sha, 'aaaaaaa');
    assert.equal(scanState(db, PROJECT).last_scan_mode, 'incremental');
  });

  it('second scan with same set keeps them open and bumps last_seen_sha + seen_count', () => {
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'aaaaaaa', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'bbbbbbb', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    const rows = allRows(db, PROJECT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_seen_sha, 'aaaaaaa');
    assert.equal(rows[0].last_seen_sha, 'bbbbbbb');
    assert.equal(rows[0].seen_count, 2);
  });

  it('caller-supplied resolvedRows transition to resolved status', () => {
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'aaaaaaa', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    const [existingOpen] = db.getOpenFindings(PROJECT);
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'bbbbbbb', mode: 'incremental',
      currentFindings: [],
      resolvedRows: [existingOpen],
    });
    const rows = allRows(db, PROJECT);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].resolved_at);
    assert.equal(rows[0].resolved_sha, 'bbbbbbb');
    assert.equal(openCountFor(db, PROJECT), 0);
  });

  it('a finding resolved at X and re-flagged at Y creates a new row', () => {
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'x0000000', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    const [firstOpen] = db.getOpenFindings(PROJECT);
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'x1111111', mode: 'incremental',
      currentFindings: [],
      resolvedRows: [firstOpen],
    });
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'y2222222', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    const rows = allRows(db, PROJECT);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].resolved_at, 'old row stays resolved');
    assert.equal(rows[1].resolved_at, null, 'new row is open');
    assert.equal(rows[1].first_seen_sha, 'y2222222');
  });

  it('project_scan_state advances only on successful reconcile', () => {
    assert.equal(scanState(db, PROJECT), undefined);
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'aaaaaaa', mode: 'audit',
      currentFindings: [], resolvedRows: [],
    });
    assert.equal(scanState(db, PROJECT).last_scan_sha, 'aaaaaaa');
    assert.equal(scanState(db, PROJECT).last_scan_mode, 'audit');
  });

  it('throwing inside the transaction leaves state unchanged', () => {
    // Seed one open finding.
    reconcile({
      graphDb: db, project: PROJECT, headSha: 'aaaaaaa', mode: 'incremental',
      currentFindings: [{ source_file: 'src/a.js', kind: 'stale_pair', test_file: 'src/a.test.js' }],
      resolvedRows: [],
    });
    const before = allRows(db, PROJECT);
    const beforeState = scanState(db, PROJECT);

    // Simulate mid-txn failure by passing a currentFindings entry whose
    // kind violates the CHECK constraint.
    assert.throws(() => {
      reconcile({
        graphDb: db, project: PROJECT, headSha: 'bbbbbbb', mode: 'incremental',
        currentFindings: [{ source_file: 'src/c.js', kind: 'garbage', test_file: null }],
        resolvedRows: [],
      });
    });

    const after = allRows(db, PROJECT);
    const afterState = scanState(db, PROJECT);
    assert.deepEqual(after, before, 'findings unchanged after rollback');
    assert.equal(afterState.last_scan_sha, beforeState.last_scan_sha, 'scan state unchanged after rollback');
  });
});
