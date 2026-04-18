'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function escapePath(p) {
  // Defensive: backticks in a path would break the markdown inline-code rendering.
  return String(p).replace(/`/g, '\\`');
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '(unknown)';
}

function seenPhrase(seenCount) {
  if (seenCount <= 1) return 'this scan';
  return `${seenCount} scans ago`;
}

function renderReport({ project, headSha, ranAt, mode, open, newlyResolved }) {
  const stale = open.filter(r => r.kind === 'stale_pair');
  const missing = open.filter(r => r.kind === 'missing_test');

  const lines = [];
  lines.push(`# Test-map findings — ${project}`);
  lines.push('');
  lines.push(`_Scan: ${shortSha(headSha)}, ${ranAt} (mode: ${mode})_`);
  lines.push(`_Open: ${open.length}  •  Newly resolved this scan: ${newlyResolved.length}_`);
  lines.push('');

  if (open.length === 0 && newlyResolved.length === 0) {
    lines.push('_No findings — all tracked source files have up-to-date tests._');
    lines.push('');
    return lines.join('\n');
  }

  if (stale.length > 0) {
    lines.push(`## Open — stale pairs (${stale.length})`);
    lines.push('');
    for (const r of stale) {
      lines.push(`- [ ] \`${escapePath(r.source_file)}\` — first seen at \`${shortSha(r.first_seen_sha)}\`, ${seenPhrase(r.seen_count)}`);
      lines.push(`      test: \`${escapePath(r.test_file)}\``);
    }
    lines.push('');
  }

  if (missing.length > 0) {
    lines.push(`## Open — missing tests (${missing.length})`);
    lines.push('');
    for (const r of missing) {
      lines.push(`- [ ] \`${escapePath(r.source_file)}\` — first seen at \`${shortSha(r.first_seen_sha)}\`, ${seenPhrase(r.seen_count)}`);
    }
    lines.push('');
  }

  if (newlyResolved.length > 0) {
    lines.push(`## Resolved since last scan (${newlyResolved.length})`);
    lines.push('');
    for (const r of newlyResolved) {
      const note = r.kind === 'missing_test'
        ? `test added`
        : (r.test_file ? `test updated` : `source file deleted`);
      lines.push(`- ✓ \`${escapePath(r.source_file)}\` — ${note} at \`${shortSha(headSha)}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Regenerated each scan. Previous report archived in greymatter's memory.db._`);
  lines.push('');
  return lines.join('\n');
}

function writeReport(outputDir, project, markdown) {
  const dir = expandHome(outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${project}.md`);
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, markdown, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

module.exports = { renderReport, writeReport, expandHome };
