'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function runGit(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGitRepo(projectRoot) {
  try {
    const out = runGit(projectRoot, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

function getCurrentHead(projectRoot) {
  try {
    return runGit(projectRoot, ['rev-parse', 'HEAD']).trim();
  } catch {
    return null;
  }
}

// Returns { modified, added, deleted } with project-relative paths.
// Throws on git failure (caller decides whether to baseline-reset or bail).
function getChangedFiles(projectRoot, fromSha, toSha) {
  const raw = runGit(projectRoot, [
    'diff', '--name-status', '-z', `${fromSha}..${toSha}`,
  ]);
  const modified = [];
  const added = [];
  const deleted = [];
  // With -z, `git diff --name-status` uses NUL between every field.
  //   Normal:  STATUS\0PATH\0
  //   Rename/Copy: STATUS\0OLDPATH\0NEWPATH\0
  const parts = raw.split('\0').filter(Boolean);
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    const code = (status || '').charAt(0);
    if (code === 'R' || code === 'C') {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (oldPath) deleted.push(oldPath);
      if (newPath) added.push(newPath);
      i += 3;
    } else {
      const p = parts[i + 1];
      if (!p) { i += 1; continue; }
      if (code === 'M') modified.push(p);
      else if (code === 'A') added.push(p);
      else if (code === 'D') deleted.push(p);
      else if (code === 'T') modified.push(p);  // typechange
      i += 2;
    }
  }
  return { modified, added, deleted };
}

function fileExists(projectRoot, relPath) {
  try {
    return fs.existsSync(path.join(projectRoot, relPath));
  } catch {
    return false;
  }
}

module.exports = { isGitRepo, getCurrentHead, getChangedFiles, fileExists };
