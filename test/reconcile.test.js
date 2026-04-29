'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { GraphDB } = require('../lib/graph-db.js');
const { computeWorkSet, reconcileProject, reconcileAll } = require('../lib/reconcile.js');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-'));
}

function makeDb() {
  return new GraphDB(':memory:');
}

function seedFileHash(db, project, file, updatedAt) {
  db.db.prepare(
    'INSERT INTO file_hashes (project, file, hash, updated_at) VALUES (?, ?, ?, ?)'
  ).run(project, file, 'h-' + file, updatedAt);
}

// ─── computeWorkSet ───────────────────────────────────────────────────────────

describe('computeWorkSet', () => {
  test('existence purge: deleted file appears in missing, others do not', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    for (const f of ['file1.js', 'file2.js', 'file3.js']) {
      fs.writeFileSync(path.join(tmpDir, f), f);
    }

    const updatedAt = new Date().toISOString();
    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('p', tmpDir);
    for (const f of ['file1.js', 'file2.js', 'file3.js']) seedFileHash(db, 'p', f, updatedAt);

    fs.unlinkSync(path.join(tmpDir, 'file2.js'));

    const result = computeWorkSet({ db, project: 'p', rootPath: tmpDir });

    assert.ok(result.missing.includes('file2.js'), 'file2.js should be in missing');
    assert.ok(!result.missing.includes('file1.js'), 'file1.js should not be in missing');
    assert.ok(!result.missing.includes('file3.js'), 'file3.js should not be in missing');

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('mtime-newer detection: touched file appears in mtimeNewerFiles, others do not', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    for (const f of ['file1.js', 'file2.js', 'file3.js']) {
      fs.writeFileSync(path.join(tmpDir, f), f);
    }

    // Set all files' mtime to the past
    const past = new Date(Date.now() - 5000);
    for (const f of ['file1.js', 'file2.js', 'file3.js']) {
      fs.utimesSync(path.join(tmpDir, f), past, past);
    }

    // updated_at = now, so disk mtime (past) < db updated_at for file1/file3
    const updatedAt = new Date().toISOString();
    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('p', tmpDir);
    for (const f of ['file1.js', 'file2.js', 'file3.js']) seedFileHash(db, 'p', f, updatedAt);

    // Advance file2's mtime to the future
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(tmpDir, 'file2.js'), future, future);

    const result = computeWorkSet({ db, project: 'p', rootPath: tmpDir });

    assert.ok(result.mtimeNewerFiles.includes('file2.js'), 'file2.js should be in mtimeNewerFiles');
    assert.ok(!result.mtimeNewerFiles.includes('file1.js'), 'file1.js should not be in mtimeNewerFiles');
    assert.ok(!result.mtimeNewerFiles.includes('file3.js'), 'file3.js should not be in mtimeNewerFiles');

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('git diff inclusion: committed file appears in gitDiffFiles, unchanged files do not', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });

    for (const f of ['file1.js', 'file2.js', 'file3.js']) {
      fs.writeFileSync(path.join(tmpDir, f), f);
    }
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: tmpDir });
    const sha1 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).trim();

    fs.writeFileSync(path.join(tmpDir, 'file2.js'), 'modified');
    execFileSync('git', ['add', 'file2.js'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'second'], { cwd: tmpDir });

    db.db.prepare('INSERT INTO project_scan_state (project, last_scan_sha, root_path) VALUES (?, ?, ?)').run('p', sha1, tmpDir);
    const updatedAt = new Date().toISOString();
    for (const f of ['file1.js', 'file2.js', 'file3.js']) seedFileHash(db, 'p', f, updatedAt);

    const result = computeWorkSet({ db, project: 'p', rootPath: tmpDir });

    assert.ok(result.gitDiffFiles.includes('file2.js'), 'file2.js should be in gitDiffFiles');
    assert.ok(!result.gitDiffFiles.includes('file1.js'), 'file1.js should not be in gitDiffFiles');
    assert.ok(!result.gitDiffFiles.includes('file3.js'), 'file3.js should not be in gitDiffFiles');

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── reconcileProject ─────────────────────────────────────────────────────────

describe('reconcileProject', () => {
  test('fast path: no work → runExtraction not called, returns skipped shape', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    for (const f of ['file1.js', 'file2.js']) {
      fs.writeFileSync(path.join(tmpDir, f), f);
    }

    // Set files' mtime to the past, updated_at to now — disk mtime < db time, no drift
    const past = new Date(Date.now() - 5000);
    for (const f of ['file1.js', 'file2.js']) fs.utimesSync(path.join(tmpDir, f), past, past);
    const updatedAt = new Date().toISOString();

    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('p', tmpDir);
    for (const f of ['file1.js', 'file2.js']) seedFileHash(db, 'p', f, updatedAt);

    let spyCalled = false;
    const spy = () => { spyCalled = true; };

    const result = reconcileProject({ db, project: 'p', rootPath: tmpDir, runExtraction: spy });

    assert.equal(spyCalled, false, 'runExtraction should not be called on fast path');
    assert.equal(result.purged, 0);
    assert.equal(result.reextracted, 0);
    assert.equal(result.skipped, true);

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('purge + re-extract: missing file rows removed from all tables, modified file re-extracted', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    // file1.js: clean — past mtime, updated_at = now
    // file2.js: dirty — future mtime, updated_at = now
    // file3.js: missing — in DB only, not on disk
    fs.writeFileSync(path.join(tmpDir, 'file1.js'), 'a');
    fs.writeFileSync(path.join(tmpDir, 'file2.js'), 'b');

    const past = new Date(Date.now() - 5000);
    fs.utimesSync(path.join(tmpDir, 'file1.js'), past, past);

    const updatedAt = new Date().toISOString();
    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('p', tmpDir);
    for (const f of ['file1.js', 'file2.js', 'file3.js']) seedFileHash(db, 'p', f, updatedAt);

    // Insert a node + edge for file3 (the missing file) so we can verify purge of all three tables
    db.db.prepare(
      'INSERT INTO nodes (project, file, name, type) VALUES (?, ?, ?, ?)'
    ).run('p', 'file3.js', 'SomeExport', 'export');
    const nodeId = db.db.prepare(
      'SELECT id FROM nodes WHERE project = ? AND file = ?'
    ).get('p', 'file3.js').id;
    db.db.prepare(
      'INSERT INTO edges (source_id, target_id, type, category, source_project, source_file) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(nodeId, nodeId, 'import', 'structural', 'p', 'file3.js');

    // Advance file2's mtime to the future
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(tmpDir, 'file2.js'), future, future);

    const extractedFiles = [];
    const spy = (files) => extractedFiles.push(...files);

    const result = reconcileProject({ db, project: 'p', rootPath: tmpDir, runExtraction: spy });

    // file3 rows should be gone from all three tables
    const fhRow = db.db.prepare('SELECT * FROM file_hashes WHERE project = ? AND file = ?').get('p', 'file3.js');
    assert.equal(fhRow, undefined, 'file3 file_hashes row should be purged');

    const nodeRow = db.db.prepare('SELECT * FROM nodes WHERE project = ? AND file = ?').get('p', 'file3.js');
    assert.equal(nodeRow, undefined, 'file3 nodes row should be purged');

    const edgeRow = db.db.prepare('SELECT * FROM edges WHERE source_project = ? AND source_file = ?').get('p', 'file3.js');
    assert.equal(edgeRow, undefined, 'file3 edges row should be purged');

    // runExtraction called with file2 only
    assert.ok(extractedFiles.includes('file2.js'), 'file2.js should be re-extracted');
    assert.ok(!extractedFiles.includes('file1.js'), 'file1.js should not be re-extracted');
    assert.ok(!extractedFiles.includes('file3.js'), 'file3.js (missing) should not be re-extracted');

    assert.equal(result.purged, 1, 'purged count should be 1');
    assert.equal(result.reextracted, 1, 'reextracted count should be 1');

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('null rootPath: returns skipped with no_root reason without throwing', () => {
    const db = makeDb();

    const spy = () => { throw new Error('runExtraction should not be called'); };
    const result = reconcileProject({ db, project: 'p', rootPath: null, runExtraction: spy });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_root');

    db.close();
  });
});

// ─── reconcileAll ─────────────────────────────────────────────────────────────

describe('reconcileAll', () => {
  test('mixed projects: dirty logs a line, clean does not, unrooted emits trailing warning', () => {
    const db = makeDb();

    // Clean project: file exists, mtime in the past, updated_at = now
    const cleanDir = makeTmpDir();
    fs.writeFileSync(path.join(cleanDir, 'clean.js'), 'x');
    const past = new Date(Date.now() - 5000);
    fs.utimesSync(path.join(cleanDir, 'clean.js'), past, past);
    const updatedAt = new Date().toISOString();
    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('clean-proj', cleanDir);
    seedFileHash(db, 'clean-proj', 'clean.js', updatedAt);

    // Dirty project: has a file in file_hashes that doesn't exist on disk
    const dirtyDir = makeTmpDir();
    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('dirty-proj', dirtyDir);
    seedFileHash(db, 'dirty-proj', 'missing.js', updatedAt);

    // Unrooted project: no root_path
    db.db.prepare('INSERT INTO project_scan_state (project) VALUES (?)').run('unrooted-proj');

    const logLines = [];
    reconcileAll({ db, runExtraction: () => {}, logger: (l) => logLines.push(l) });

    const dirtyLine = logLines.find(l => l.includes('dirty-proj'));
    assert.ok(dirtyLine, 'should log a line for dirty-proj');
    assert.equal(dirtyLine, '[reconcile] dirty-proj: purged 1 missing file');

    const cleanLine = logLines.find(l => l.includes('clean-proj'));
    assert.equal(cleanLine, undefined, 'should NOT log a line for clean-proj');

    const unrootedLine = logLines.find(l => l.includes('no root_path'));
    assert.ok(unrootedLine, 'should emit unrooted warning line');
    assert.ok(unrootedLine.includes('unrooted-proj'), 'unrooted warning should name the project');

    db.close();
    fs.rmSync(cleanDir, { recursive: true });
    fs.rmSync(dirtyDir, { recursive: true });
  });

  test('all clean: logger never called', () => {
    const tmpDir = makeTmpDir();
    const db = makeDb();

    fs.writeFileSync(path.join(tmpDir, 'file1.js'), 'x');
    const past = new Date(Date.now() - 5000);
    fs.utimesSync(path.join(tmpDir, 'file1.js'), past, past);
    const updatedAt = new Date().toISOString();

    db.db.prepare('INSERT INTO project_scan_state (project, root_path) VALUES (?, ?)').run('p1', tmpDir);
    seedFileHash(db, 'p1', 'file1.js', updatedAt);

    let loggerCalled = false;
    reconcileAll({ db, runExtraction: () => {}, logger: () => { loggerCalled = true; } });

    assert.equal(loggerCalled, false, 'logger should never be called when all projects are clean');

    db.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
