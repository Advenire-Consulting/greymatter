'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseArgs, main } = require('../scripts/spec-check');

describe('spec-check.parseArgs', () => {
  it('parses --dir (repeatable)', () => {
    const opts = parseArgs(['--dir', 'a', '--dir', 'b']);
    assert.deepEqual(opts.dirs, ['a', 'b']);
  });

  it('parses --template', () => {
    assert.equal(parseArgs(['--template', 'spec']).template, 'spec');
  });

  it('parses --strict', () => {
    assert.equal(parseArgs(['--strict']).strict, true);
    assert.equal(parseArgs([]).strict, false);
  });

  it('parses --list-chunks, --chunk-range, --chunk-content', () => {
    assert.equal(parseArgs(['--list-chunks', 'p.md']).listChunks, 'p.md');
    assert.deepEqual(parseArgs(['--chunk-range', 'p.md', '3']).chunkRange, { plan: 'p.md', n: 3 });
    assert.deepEqual(parseArgs(['--chunk-content', 'p.md', '7']).chunkContent, { plan: 'p.md', n: 7 });
  });

  it('parses --dispatch', () => {
    assert.equal(parseArgs(['--dispatch', 'p.md']).dispatch, 'p.md');
  });

  it('--preamble and --no-preamble set tri-state', () => {
    assert.equal(parseArgs([]).preamble, null);
    assert.equal(parseArgs(['--preamble']).preamble, true);
    assert.equal(parseArgs(['--no-preamble']).preamble, false);
  });

  it('throws on conflicting preamble flags', () => {
    assert.throws(() => parseArgs(['--preamble', '--no-preamble']), /conflicting preamble flags/);
    assert.throws(() => parseArgs(['--no-preamble', '--preamble']), /conflicting preamble flags/);
  });

  it('--command-log=<path> sets commandLogPath', () => {
    assert.equal(parseArgs(['--command-log=/tmp/log.txt']).commandLogPath, '/tmp/log.txt');
  });

  it('--command-log= (empty) sets commandLogPath to "" (explicit disable)', () => {
    assert.equal(parseArgs(['--command-log=']).commandLogPath, '');
  });

  it('--command-log <path> consumes next arg', () => {
    assert.equal(parseArgs(['--command-log', '/tmp/x']).commandLogPath, '/tmp/x');
  });

  it('--command-log without a path throws', () => {
    assert.throws(() => parseArgs(['--command-log']), /--command-log requires a path/);
    assert.throws(() => parseArgs(['--command-log', '--strict']), /--command-log requires a path/);
  });

  it('recognizes --help / -h', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['-h']).help, true);
  });

  it('throws on unknown arguments', () => {
    assert.throws(() => parseArgs(['--unknown']), /unknown argument/);
  });
});

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (data) => { out += data; return true; };
  return fn().then((result) => {
    process.stdout.write = original;
    return { result, out };
  }, (err) => {
    process.stdout.write = original;
    throw err;
  });
}

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = (data) => { err += data; return true; };
  return fn().then((result) => {
    process.stderr.write = original;
    return { result, err };
  }, (e) => {
    process.stderr.write = original;
    throw e;
  });
}

describe('spec-check.main', () => {
  let tmp;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-speccheck-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns 0 for --help', async () => {
    const { result } = await captureStdout(() => main(['--help']));
    assert.equal(result, 0);
  });

  it('returns 0 and prints a template for --template spec', async () => {
    const { result, out } = await captureStdout(() => main(['--template', 'spec']));
    assert.equal(result, 0);
    assert.ok(out.length > 0);
  });

  it('returns 3 for --template with an unknown name', async () => {
    const { result } = await captureStderr(() => main(['--template', 'bogus']));
    assert.equal(result, 3);
  });

  it('returns 3 when no action flag is passed', async () => {
    const { result } = await captureStderr(() => main([]));
    assert.equal(result, 3);
  });

  it('returns 3 on unknown arguments', async () => {
    const { result } = await captureStderr(() => main(['--not-a-real-flag']));
    assert.equal(result, 3);
  });

  it('returns 3 for --list-chunks on a missing plan', async () => {
    const { result } = await captureStderr(() => main(['--list-chunks', path.join(tmp, 'missing.md')]));
    assert.equal(result, 3);
  });
});
