'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { parseArgs } = require('../scripts/ingest-archive');

const scriptPath = path.join(__dirname, '..', 'scripts', 'ingest-archive.js');

describe('ingest-archive.parseArgs', () => {
  it('parses --dir and --before', () => {
    const args = parseArgs(['node', 'x', '--dir', '/tmp/convs', '--before', '2026-01-01']);
    assert.equal(args.dir, '/tmp/convs');
    assert.equal(args.before, '2026-01-01');
    assert.equal(args.dryRun, false);
  });

  it('parses --dry-run as boolean', () => {
    const args = parseArgs(['node', 'x', '--dir', '/a', '--before', '2026-01-01', '--dry-run']);
    assert.equal(args.dryRun, true);
  });

  it('throws on unknown args (via process.exit — spawn verifies)', () => {
    // parseArgs calls process.exit on unknown args. Use a child to verify.
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, '--bogus'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      exitCode = err.status;
      stderr = err.stderr || '';
    }
    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown arg/);
  });

  it('defaults flags when omitted', () => {
    const args = parseArgs(['node', 'x']);
    assert.equal(args.dir, null);
    assert.equal(args.before, null);
    assert.equal(args.dryRun, false);
  });
});

describe('ingest-archive.js CLI', () => {
  let dir;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-ingest-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('exits 1 with usage when --dir is missing', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, '--before', '2026-01-01'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = err.status;
      stderr = err.stderr || '';
    }
    assert.equal(code, 1);
    assert.match(stderr, /Usage:/);
  });

  it('exits 1 with usage when --before is missing', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, '--dir', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = err.status;
      stderr = err.stderr || '';
    }
    assert.equal(code, 1);
    assert.match(stderr, /Usage:/);
  });

  it('exits 1 on invalid --before date', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, '--dir', dir, '--before', 'garbage'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      code = err.status;
      stderr = err.stderr || '';
    }
    assert.equal(code, 1);
    assert.match(stderr, /Invalid --before date/);
  });

  it('--dry-run enumerates files without touching memory.db', () => {
    // Create two fake session files with different mtimes
    const old = path.join(dir, 'old.jsonl');
    fs.writeFileSync(old, JSON.stringify({ type: 'summary', summary: 'x' }) + '\n');
    const oldTime = new Date('2025-01-01T00:00:00Z').getTime() / 1000;
    fs.utimesSync(old, oldTime, oldTime);

    const recent = path.join(dir, 'recent.jsonl');
    fs.writeFileSync(recent, JSON.stringify({ type: 'summary', summary: 'y' }) + '\n');

    const out = execFileSync(
      'node',
      [scriptPath, '--dir', dir, '--before', '2025-06-01', '--dry-run'],
      { encoding: 'utf8' }
    );
    assert.match(out, /DRY RUN: no writes/);
    assert.match(out, /old\.jsonl/);
    assert.ok(!out.includes('recent.jsonl'), 'recent.jsonl is past the cutoff and should not appear');
  });
});
