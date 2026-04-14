const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { MemoryDB } = require('../lib/memory-db');
const { MemoryQueries } = require('../lib/memory-queries');
const { parseArgs, parseGitLog, formatSessionText } = require('../scripts/recent');

function tmpDbPath() {
  return path.join(__dirname, `test-recent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

// Insert a session + one window + file/decision rows. Projects is a JSON array.
function seedSession(db, id, projects, startTime, endTime, files, decisions) {
  db.insertSession(id, startTime, projects);
  db.db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?').run(endTime, id);
  const winId = db.insertWindow(id, 0, { startLine: 0, endLine: 10, startTime, endTime, scope: projects[0] || null });
  if (files && files.length) db.insertWindowFiles(winId, files.map(fp => ({ filePath: fp, tool: 'Read' })));
  if (decisions && decisions.length) db.insertDecisions(winId, decisions);
}

describe('recent.js', () => {
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

  it('empty memory.db returns empty array', () => {
    const r = q.getRecentSessionsForProject('anything', 3);
    assert.deepStrictEqual(r, []);
  });

  it('returns only sessions that touched the project, ordered by end_time DESC', () => {
    seedSession(db, 's1', ['greymatter'], '2026-04-10T00:00:00Z', '2026-04-10T01:00:00Z',
      ['a.js'], [{ seq: 0, summary: 'fix bug', status: 'decided' }]);
    seedSession(db, 's2', ['greymatter'], '2026-04-11T00:00:00Z', '2026-04-11T01:00:00Z',
      ['b.js'], []);
    seedSession(db, 's3', ['unrelated'], '2026-04-12T00:00:00Z', '2026-04-12T01:00:00Z',
      ['c.js'], []);
    seedSession(db, 's4', ['greymatter'], '2026-04-09T00:00:00Z', '2026-04-09T01:00:00Z',
      ['d.js'], []);

    const r = q.getRecentSessionsForProject('greymatter', 3);
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[0].session_id, 's2');
    assert.strictEqual(r[1].session_id, 's1');
    assert.strictEqual(r[2].session_id, 's4');
    assert.strictEqual(r[0].files[0].file_path, 'b.js');
    assert.strictEqual(r[1].decisions.length, 1);
  });

  it('--limit 1 returns only the most recent', () => {
    seedSession(db, 'a', ['p'], '2026-04-10T00:00:00Z', '2026-04-10T01:00:00Z', ['x.js'], []);
    seedSession(db, 'b', ['p'], '2026-04-11T00:00:00Z', '2026-04-11T01:00:00Z', ['y.js'], []);
    const r = q.getRecentSessionsForProject('p', 1);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].session_id, 'b');
  });

  it('exact project match — substring false positive is rejected', () => {
    // 'greymatter-old' in projects_json contains 'greymatter' as substring, but
    // the JSON parse / includes check must reject it.
    seedSession(db, 's1', ['greymatter-old'], '2026-04-10T00:00:00Z', '2026-04-10T01:00:00Z', ['a.js'], []);
    const r = q.getRecentSessionsForProject('greymatter', 3);
    assert.strictEqual(r.length, 0);
  });

  it('parseArgs handles all flags', () => {
    const o = parseArgs(['--project', 'greymatter', '--limit', '5', '--no-git', '--json']);
    assert.strictEqual(o.project, 'greymatter');
    assert.strictEqual(o.limit, 5);
    assert.strictEqual(o.noGit, true);
    assert.strictEqual(o.json, true);
  });

  it('parseGitLog parses --shortstat output', () => {
    const raw = `abc1234567890abcdef
first subject
 2 files changed, 10 insertions(+), 3 deletions(-)

def9876543210fedcba
second subject
 1 file changed, 1 insertion(+)
`;
    const commits = parseGitLog(raw);
    assert.strictEqual(commits.length, 2);
    assert.strictEqual(commits[0].subject, 'first subject');
    assert.strictEqual(commits[0].stats.files, 2);
    assert.strictEqual(commits[0].stats.insertions, 10);
    assert.strictEqual(commits[0].stats.deletions, 3);
    assert.strictEqual(commits[1].stats.files, 1);
    assert.strictEqual(commits[1].stats.insertions, 1);
  });

  it('formatSessionText shows "(not a git repo)" when commits is null', () => {
    const session = {
      session_id: 's1', start_time: 't1', end_time: 't2',
      files: [{ file_path: 'a.js' }],
      decisions: [{ summary: 'did thing' }],
    };
    const out = formatSessionText(session, null);
    assert.match(out, /commits: \(not a git repo\)/);
    assert.match(out, /did thing/);
  });

  it('formatSessionText shows commit count and stats when commits present', () => {
    const session = {
      session_id: 's1', start_time: 't1', end_time: 't2',
      files: [], decisions: [],
    };
    const out = formatSessionText(session, [
      { hash: 'abcdef1234567890', subject: 'msg', stats: { files: 1, insertions: 2, deletions: 0 } },
    ]);
    assert.match(out, /commits \(1\)/);
    assert.match(out, /\+2 -0 across 1 files/);
  });
});
