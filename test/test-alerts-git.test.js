'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
  isGitRepo, getCurrentHead, getChangedFiles, fileExists,
} = require('../lib/test-alerts/git');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-git-'));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initRepo(dir) {
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

describe('isGitRepo', () => {
  let repo;

  beforeEach(() => { repo = makeTmp(); });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('returns false for a plain directory', () => {
    assert.equal(isGitRepo(repo), false);
  });

  it('returns true inside an initialized repo', () => {
    initRepo(repo);
    assert.equal(isGitRepo(repo), true);
  });

  it('returns false for a path that does not exist', () => {
    assert.equal(isGitRepo(path.join(repo, 'missing')), false);
  });
});

describe('getCurrentHead', () => {
  let repo;

  beforeEach(() => {
    repo = makeTmp();
    initRepo(repo);
  });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('returns null on a repo with no commits', () => {
    assert.equal(getCurrentHead(repo), null);
  });

  it('returns the HEAD sha after a commit', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hi');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-m', 'first', '--quiet');
    const sha = getCurrentHead(repo);
    assert.match(sha, /^[0-9a-f]{40}$/);
  });
});

describe('getChangedFiles', () => {
  let repo;

  beforeEach(() => {
    repo = makeTmp();
    initRepo(repo);
  });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('categorizes modified, added, and deleted files', () => {
    fs.writeFileSync(path.join(repo, 'keep.txt'), 'v1');
    fs.writeFileSync(path.join(repo, 'remove.txt'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'init', '--quiet');
    const first = getCurrentHead(repo);

    fs.writeFileSync(path.join(repo, 'keep.txt'), 'v2');
    fs.writeFileSync(path.join(repo, 'added.txt'), 'new');
    fs.unlinkSync(path.join(repo, 'remove.txt'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'changes', '--quiet');
    const second = getCurrentHead(repo);

    const diff = getChangedFiles(repo, first, second);
    assert.deepEqual(diff.modified.sort(), ['keep.txt']);
    assert.deepEqual(diff.added.sort(), ['added.txt']);
    assert.deepEqual(diff.deleted.sort(), ['remove.txt']);
  });

  it('handles renames as delete + add', () => {
    fs.writeFileSync(path.join(repo, 'old.txt'), 'content that should survive rename');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'init', '--quiet');
    const first = getCurrentHead(repo);

    git(repo, 'mv', 'old.txt', 'new.txt');
    git(repo, 'commit', '-m', 'rename', '--quiet');
    const second = getCurrentHead(repo);

    const diff = getChangedFiles(repo, first, second);
    // Rename may show as R (handled as delete+add) OR as separate A+D
    const deletedNames = diff.deleted;
    const addedNames = diff.added;
    assert.ok(deletedNames.includes('old.txt'), `old.txt should be in deleted (got ${JSON.stringify(diff)})`);
    assert.ok(addedNames.includes('new.txt'), `new.txt should be in added (got ${JSON.stringify(diff)})`);
  });

  it('returns empty arrays when shas point at the same commit', () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'init', '--quiet');
    const sha = getCurrentHead(repo);
    const diff = getChangedFiles(repo, sha, sha);
    assert.deepEqual(diff.modified, []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.deleted, []);
  });
});

describe('fileExists', () => {
  let repo;

  beforeEach(() => { repo = makeTmp(); });
  afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

  it('returns true for present file', () => {
    fs.writeFileSync(path.join(repo, 'here.txt'), 'x');
    assert.equal(fileExists(repo, 'here.txt'), true);
  });

  it('returns false for missing file', () => {
    assert.equal(fileExists(repo, 'absent.txt'), false);
  });
});
