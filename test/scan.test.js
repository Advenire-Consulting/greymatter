'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { GraphDB } = require('../lib/graph-db');
const { scanProject } = require('../scripts/scan');

function tmpDir() {
  const dir = path.join(__dirname, `test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tmpDbPath() {
  return path.join(__dirname, `test-scan-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('scanProject', () => {
  let projectDir, dbPath, db;

  beforeEach(() => {
    projectDir = tmpDir();
    dbPath = tmpDbPath();
    db = new GraphDB(dbPath);
    // Create test JS files
    fs.writeFileSync(path.join(projectDir, 'index.js'),
      "const utils = require('./lib/utils');\nfunction main() {}\nmodule.exports = { main };\n"
    );
    fs.mkdirSync(path.join(projectDir, 'lib'));
    fs.writeFileSync(path.join(projectDir, 'lib', 'utils.js'),
      "function helper() { return 42; }\nmodule.exports = { helper };\n"
    );
    // Create a node_modules dir that should be skipped
    fs.mkdirSync(path.join(projectDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};');
  });

  afterEach(() => {
    db.close();
    cleanup(projectDir);
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('creates nodes and edges for JS files', () => {
    const stats = scanProject(projectDir, 'testproj', db);
    assert.ok(stats.filesScanned >= 2);
    const nodes = db.db.prepare('SELECT * FROM nodes WHERE project = ?').all('testproj');
    assert.ok(nodes.length >= 3); // at least main, helper, and module-level nodes
  });

  it('skips node_modules', () => {
    scanProject(projectDir, 'testproj', db);
    const nmNodes = db.db.prepare("SELECT * FROM nodes WHERE file LIKE 'node_modules%'").all();
    assert.equal(nmNodes.length, 0);
  });

  it('skips unchanged files on second scan', () => {
    const stats1 = scanProject(projectDir, 'testproj', db);
    const stats2 = scanProject(projectDir, 'testproj', db);
    assert.equal(stats2.filesSkipped, stats1.filesScanned);
    assert.equal(stats2.filesScanned, 0);
  });

  it('re-extracts files when content changes', () => {
    scanProject(projectDir, 'testproj', db);
    // Modify a file
    fs.writeFileSync(path.join(projectDir, 'lib', 'utils.js'),
      "function helper() { return 99; }\nfunction newFn() {}\nmodule.exports = { helper, newFn };\n"
    );
    const stats2 = scanProject(projectDir, 'testproj', db);
    assert.ok(stats2.filesScanned >= 1);
    // newFn should now be in the graph
    const newNode = db.db.prepare("SELECT * FROM nodes WHERE name = 'newFn'").get();
    assert.ok(newNode);
  });

  it('registers edge types', () => {
    scanProject(projectDir, 'testproj', db);
    const types = db.db.prepare('SELECT * FROM edge_types').all();
    assert.ok(types.length > 0);
  });
});
