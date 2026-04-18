'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { renderReport, writeReport, expandHome } = require('../lib/test-alerts/output');

describe('expandHome', () => {
  it('returns the value unchanged when there is no tilde', () => {
    assert.equal(expandHome('/tmp/foo'), '/tmp/foo');
  });

  it('expands a bare tilde to the home directory', () => {
    assert.equal(expandHome('~'), os.homedir());
  });

  it('expands ~/ prefix to home + path', () => {
    assert.equal(expandHome('~/reports/x.md'), path.join(os.homedir(), 'reports/x.md'));
  });

  it('passes through nullish values', () => {
    assert.equal(expandHome(''), '');
    assert.equal(expandHome(null), null);
  });

  it('does not expand tilde that is not the first character', () => {
    assert.equal(expandHome('/tmp/~/weird'), '/tmp/~/weird');
  });
});

describe('renderReport', () => {
  const baseMeta = {
    project: 'myproj',
    headSha: 'abc1234def5678',
    ranAt: '2026-04-18T10:00:00Z',
    mode: 'incremental',
  };

  it('emits the "no findings" line when both lists are empty', () => {
    const md = renderReport({ ...baseMeta, open: [], newlyResolved: [] });
    assert.ok(md.includes('# Test-map findings — myproj'));
    assert.ok(md.includes('_No findings — all tracked source files have up-to-date tests._'));
    assert.ok(!md.includes('Open — stale pairs'));
  });

  it('renders a short sha, not the full sha', () => {
    const md = renderReport({ ...baseMeta, open: [], newlyResolved: [] });
    assert.ok(md.includes('abc1234'));
    assert.ok(!md.includes('abc1234def5678'));
  });

  it('renders stale pairs with test path', () => {
    const md = renderReport({
      ...baseMeta,
      open: [{
        kind: 'stale_pair',
        source_file: 'lib/foo.js',
        test_file: 'test/foo.test.js',
        first_seen_sha: 'deadbeef1234',
        seen_count: 3,
      }],
      newlyResolved: [],
    });
    assert.ok(md.includes('## Open — stale pairs (1)'));
    assert.ok(md.includes('`lib/foo.js`'));
    assert.ok(md.includes('`test/foo.test.js`'));
    assert.ok(md.includes('3 scans ago'));
  });

  it('uses "this scan" when seen_count is 1 or less', () => {
    const md = renderReport({
      ...baseMeta,
      open: [{
        kind: 'missing_test',
        source_file: 'lib/bar.js',
        first_seen_sha: 'abc1234',
        seen_count: 1,
      }],
      newlyResolved: [],
    });
    assert.ok(md.includes('this scan'));
    assert.ok(!md.includes('scans ago'));
  });

  it('renders missing tests separately from stale pairs', () => {
    const md = renderReport({
      ...baseMeta,
      open: [
        { kind: 'stale_pair', source_file: 'a.js', test_file: 't/a.test.js', first_seen_sha: 'abc', seen_count: 2 },
        { kind: 'missing_test', source_file: 'b.js', first_seen_sha: 'abc', seen_count: 2 },
      ],
      newlyResolved: [],
    });
    assert.ok(md.includes('## Open — stale pairs (1)'));
    assert.ok(md.includes('## Open — missing tests (1)'));
  });

  it('renders newly resolved with per-kind notes', () => {
    const md = renderReport({
      ...baseMeta,
      open: [],
      newlyResolved: [
        { kind: 'stale_pair', source_file: 'a.js', test_file: 't/a.test.js' },
        { kind: 'missing_test', source_file: 'b.js' },
        { kind: 'stale_pair', source_file: 'c.js', test_file: null },
      ],
    });
    assert.ok(md.includes('## Resolved since last scan (3)'));
    assert.ok(md.includes('a.js'));
    assert.ok(md.includes('test updated'));
    assert.ok(md.includes('test added'));
    assert.ok(md.includes('source file deleted'));
  });

  it('escapes backticks in paths so markdown inline-code does not break', () => {
    const md = renderReport({
      ...baseMeta,
      open: [{
        kind: 'missing_test',
        source_file: 'weird`name.js',
        first_seen_sha: 'abc',
        seen_count: 1,
      }],
      newlyResolved: [],
    });
    assert.ok(md.includes('weird\\`name.js'), 'backtick should be escaped');
  });

  it('handles a missing headSha as "(unknown)"', () => {
    const md = renderReport({ ...baseMeta, headSha: null, open: [], newlyResolved: [] });
    assert.ok(md.includes('(unknown)'));
  });
});

describe('writeReport', () => {
  let tmp;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-output-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writes the markdown to <outputDir>/<project>.md', () => {
    const written = writeReport(tmp, 'myproj', '# Hello\n');
    assert.equal(written, path.join(tmp, 'myproj.md'));
    assert.equal(fs.readFileSync(written, 'utf8'), '# Hello\n');
  });

  it('creates the output directory if it does not exist', () => {
    const nested = path.join(tmp, 'a', 'b', 'c');
    const written = writeReport(nested, 'p', 'hi');
    assert.ok(fs.existsSync(written));
  });

  it('overwrites an existing report (atomic via rename)', () => {
    writeReport(tmp, 'p', 'first');
    writeReport(tmp, 'p', 'second');
    assert.equal(fs.readFileSync(path.join(tmp, 'p.md'), 'utf8'), 'second');
  });

  it('leaves no .tmp file behind after a successful write', () => {
    writeReport(tmp, 'p', 'content');
    const leftovers = fs.readdirSync(tmp).filter(f => f.includes('.tmp.'));
    assert.deepEqual(leftovers, []);
  });
});
