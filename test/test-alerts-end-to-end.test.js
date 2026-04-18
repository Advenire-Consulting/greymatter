'use strict';

// @tests scripts/test-alerts.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { runScan } = require('../scripts/test-alerts');

function sh(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  sh(root, ['init', '-q', '--initial-branch=main']);
  sh(root, ['config', 'user.email', 'test@example.com']);
  sh(root, ['config', 'user.name', 'Test']);
  sh(root, ['config', 'commit.gpgsign', 'false']);
}
function commit(root, message) {
  sh(root, ['add', '-A']);
  sh(root, ['commit', '-q', '-m', message]);
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

function makeConfig(outputDir) {
  return {
    test_alerts: {
      enabled_projects: ['project-a'],
      check_stale_pairs: true,
      check_missing_tests: false,
      alert_output_dir: outputDir,
    },
  };
}

describe('test-alerts end-to-end', () => {
  let tmp, dataDir, projectRoot, outputDir, graphDbPath, memoryDbPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-e2e-'));
    dataDir = path.join(tmp, 'data');
    outputDir = path.join(tmp, 'testalerts');
    projectRoot = path.join(tmp, 'project-a');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    graphDbPath = path.join(dataDir, 'graph.db');
    memoryDbPath = path.join(dataDir, 'memory.db');
    const { GraphDB } = require('../lib/graph-db');
    const { MemoryDB } = require('../lib/memory-db');
    new GraphDB(graphDbPath).close();
    new MemoryDB(memoryDbPath).close();

    initRepo(projectRoot);
    write(projectRoot, 'src/a.js', 'module.exports = () => 1;');
    write(projectRoot, 'src/a.test.js', '// @tests src/a.js\n');
    commit(projectRoot, 'initial');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('baseline on first run, stale pair after source-only commit, resolved after test commit', () => {
    const config = makeConfig(outputDir);

    let r = runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });
    assert.equal(r.baseline, true, 'first run must be baseline');

    write(projectRoot, 'src/a.js', 'module.exports = () => 2;');
    commit(projectRoot, 'source only');

    r = runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });
    assert.equal(r.baseline, false);
    assert.equal(r.openCount, 1, 'one stale pair expected');
    const md = read(r.outputPath);
    assert.match(md, /Open — stale pairs \(1\)/);
    assert.match(md, /`src\/a\.js`/);

    write(projectRoot, 'src/a.test.js', '// @tests src/a.js\n// updated test\n');
    commit(projectRoot, 'test catches up');

    r = runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });
    assert.equal(r.openCount, 0);
    assert.equal(r.resolvedCount, 1);
    const md2 = read(r.outputPath);
    assert.match(md2, /Resolved since last scan \(1\)/);
  });

  it('check_missing_tests flags sources with no paired test', () => {
    const config = makeConfig(outputDir);
    config.test_alerts.check_missing_tests = true;

    runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });

    write(projectRoot, 'src/b.js', 'module.exports = () => 3;');
    commit(projectRoot, 'add b without test');

    const r = runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });
    const md = read(r.outputPath);
    assert.match(md, /Open — missing tests \(1\)/);
    assert.match(md, /`src\/b\.js`/);
  });

  it('audit mode catches stale pair even when incremental diff is empty', () => {
    const config = makeConfig(outputDir);

    const { GraphDB } = require('../lib/graph-db');
    const g = new GraphDB(graphDbPath);
    g.setFileHash('project-a', 'src/a.test.js', 'h1');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    return (async () => {
      await sleep(5);
      g.setFileHash('project-a', 'src/a.js', 'h2');
      g.close();

      const r = runScan({
        project: 'project-a', mode: 'audit',
        dataDir, projectRoot, config, memoryDbPath, graphDbPath,
        logger: { info() {}, warn() {} },
      });
      assert.ok(!r.skipped, `audit scan must not skip (reason: ${r.reason || 'n/a'})`);
      assert.ok(r.openCount >= 1, 'audit mode should flag the newer-source/older-test pair');
    })();
  });

  it('memory.db gains exactly one test_alert_runs row per successful scan', () => {
    const config = makeConfig(outputDir);
    runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });
    write(projectRoot, 'src/a.js', 'module.exports = () => 2;');
    commit(projectRoot, 'c');
    runScan({
      project: 'project-a', mode: 'incremental',
      dataDir, projectRoot, config, memoryDbPath, graphDbPath,
      logger: { info() {}, warn() {} },
    });

    const { MemoryDB } = require('../lib/memory-db');
    const m = new MemoryDB(memoryDbPath);
    const rows = m.db.prepare('SELECT * FROM test_alert_runs ORDER BY id').all();
    m.close();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].project, 'project-a');
    assert.ok(rows[1].findings_json.length > 0);
  });
});
