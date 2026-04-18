'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { GraphDB } = require('../lib/graph-db');
const { scanProject } = require('../scripts/scan');

const scriptPath = path.join(__dirname, '..', 'scripts', 'grep.js');

function runCli(args, extraOpts = {}) {
  try {
    return { code: 0, stdout: execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', ...extraOpts }), stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('grep.js CLI', () => {
  let workspace, dbPath;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-grep-'));
    dbPath = path.join(workspace, 'graph.db');

    const projectDir = path.join(workspace, 'demo');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'a.js'),
      "const apiBase = '/api/v1';\nfunction doThing() {\n  fetch(apiBase + '/things');\n}\nmodule.exports = { doThing };\n"
    );
    fs.writeFileSync(path.join(projectDir, 'b.js'),
      "function other() {\n  console.log('hi');\n}\nmodule.exports = { other };\n"
    );

    const db = new GraphDB(dbPath);
    scanProject(projectDir, 'demo', db);
    db.close();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('prints usage and exits 1 when no pattern is given', () => {
    // Run with truly no args; override HOME so DEFAULT_DB doesn't hit the user's real greymatter db.
    const fakeHome = path.join(workspace, 'fake-home');
    fs.mkdirSync(fakeHome, { recursive: true });
    const { code, stdout } = runCli([], {
      env: { ...process.env, HOME: fakeHome },
    });
    assert.equal(code, 1);
    assert.match(stdout, /Usage:/);
  });

  it('returns matches grouped by project', () => {
    const { code, stdout } = runCli([
      'apiBase', '--db', dbPath, '--workspace', workspace,
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /demo \(/);
    assert.match(stdout, /a\.js/);
    assert.match(stdout, /apiBase/);
  });

  it('prints "No matches" with a clear summary when pattern has no hits', () => {
    const { code, stdout } = runCli([
      'zzzz_nothing_matches_this_zzzz',
      '--db', dbPath, '--workspace', workspace,
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /No matches/);
  });

  it('--project filter narrows results', () => {
    const { code, stdout } = runCli([
      'apiBase',
      '--db', dbPath, '--workspace', workspace,
      '--project', 'demo',
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /demo/);
  });

  it('--project with no match exits 1', () => {
    const { code, stderr } = runCli([
      'apiBase',
      '--db', dbPath, '--workspace', workspace,
      '--project', 'notthere',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /No project matching/);
  });

  it('reports invalid regex cleanly', () => {
    const { code, stderr } = runCli([
      '[unclosed',
      '--db', dbPath, '--workspace', workspace,
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /Invalid regex/);
  });

  it('exits 1 when graph.db has no projects', () => {
    const emptyDbPath = path.join(workspace, 'empty.db');
    const empty = new GraphDB(emptyDbPath);
    empty.close();
    const { code, stderr } = runCli([
      'anything',
      '--db', emptyDbPath, '--workspace', workspace,
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /No projects found/);
  });
});
