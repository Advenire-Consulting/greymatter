'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadConfig, addMissingKeys } = require('../lib/config');

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-config-'));
}

describe('addMissingKeys', () => {
  it('inserts missing top-level key with default value', () => {
    const defaults = { a: 1, b: 2 };
    const user = { a: 99 };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.deepEqual(result, { a: 99, b: 2 });
    assert.deepEqual(added, ['b']);
  });

  it('does not modify existing top-level values', () => {
    const defaults = { a: 1 };
    const user = { a: 99 };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.equal(result.a, 99);
    assert.deepEqual(added, []);
  });

  it('recurses into nested objects to fill missing sub-keys', () => {
    const defaults = { nested: { x: 1, y: 2 } };
    const user = { nested: { x: 99 } };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.deepEqual(result, { nested: { x: 99, y: 2 } });
    assert.deepEqual(added, ['nested.y']);
  });

  it('treats arrays as leaves — never merges array contents', () => {
    const defaults = { list: ['a', 'b', 'c'] };
    const user = { list: ['only-mine'] };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.deepEqual(result.list, ['only-mine']);
    assert.deepEqual(added, []);
  });

  it('inserts missing arrays with the default array', () => {
    const defaults = { list: ['a', 'b'] };
    const user = {};
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.deepEqual(result.list, ['a', 'b']);
    assert.deepEqual(added, ['list']);
  });

  it('preserves user-only keys not present in defaults', () => {
    const defaults = { a: 1 };
    const user = { a: 99, legacy: 'keep-me' };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.equal(result.legacy, 'keep-me');
    assert.deepEqual(added, []);
  });

  it('returns empty added[] when nothing is missing', () => {
    const defaults = { a: 1, nested: { x: 1 } };
    const user = { a: 99, nested: { x: 99 } };
    const added = [];
    addMissingKeys(defaults, user, '', added);
    assert.deepEqual(added, []);
  });

  it('reports nested added keys with dot-path', () => {
    const defaults = { a: { b: { c: 3 } } };
    const user = { a: { b: {} } };
    const added = [];
    addMissingKeys(defaults, user, '', added);
    assert.deepEqual(added, ['a.b.c']);
  });

  it('does not descend when user value is an array even if default is an object', () => {
    // User manually replaced a nested-object setting with an array — respect it.
    const defaults = { setting: { a: 1, b: 2 } };
    const user = { setting: ['user', 'chose', 'array'] };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.deepEqual(result.setting, ['user', 'chose', 'array']);
    assert.deepEqual(added, []);
  });

  it('does not descend when user value is null (respects explicit null)', () => {
    const defaults = { setting: { a: 1 } };
    const user = { setting: null };
    const added = [];
    const result = addMissingKeys(defaults, user, '', added);
    assert.equal(result.setting, null);
    assert.deepEqual(added, []);
  });
});

describe('loadConfig additive migration', () => {
  let dataDir;
  let origStderrWrite;
  let stderrBuf;

  beforeEach(() => {
    dataDir = tmpDataDir();
    stderrBuf = '';
    origStderrWrite = process.stderr.write;
    process.stderr.write = (chunk) => { stderrBuf += chunk; return true; };
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('seeds full defaults when config.json does not exist', () => {
    const config = loadConfig(dataDir);
    assert.ok(config.test_alerts, 'test_alerts should be present');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf-8'));
    assert.ok(onDisk.test_alerts);
    assert.equal(stderrBuf, '', 'no migration message on fresh seed');
  });

  it('adds missing top-level keys to existing config and writes backup', () => {
    const configPath = path.join(dataDir, 'config.json');
    const userConfig = { conversation_recall: true, signals: { threshold: 80 } };
    fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));

    loadConfig(dataDir);

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(onDisk.test_alerts, 'test_alerts should now be in the file');
    assert.equal(onDisk.signals.threshold, 80, 'user overrides preserved');
    assert.ok(fs.existsSync(configPath + '.bak'), 'backup file should exist');
    assert.match(stderrBuf, /greymatter: added \d+ new config key/);
  });

  it('preserves user arrays and never modifies existing values', () => {
    const configPath = path.join(dataDir, 'config.json');
    const userConfig = {
      watch_directories: ['~/custom'],
      extraction: { skip_directories: ['only-this'] },
    };
    fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));

    loadConfig(dataDir);

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepEqual(onDisk.watch_directories, ['~/custom']);
    assert.deepEqual(onDisk.extraction.skip_directories, ['only-this']);
    // extraction.max_file_size_kb should have been added (default 500)
    assert.equal(onDisk.extraction.max_file_size_kb, 500);
  });

  it('preserves user-only keys that are not in defaults', () => {
    const configPath = path.join(dataDir, 'config.json');
    const userConfig = {
      conversation_recall: true,
      legacy_experimental_key: 'keep-me',
    };
    fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));

    loadConfig(dataDir);

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(onDisk.legacy_experimental_key, 'keep-me');
  });

  it('does not write, backup, or log when nothing is missing', () => {
    const configPath = path.join(dataDir, 'config.json');
    // Seed with full defaults by calling loadConfig once on a fresh dir.
    loadConfig(dataDir);
    const seeded = fs.readFileSync(configPath, 'utf-8');
    const seededMtime = fs.statSync(configPath).mtimeMs;
    stderrBuf = '';

    // Sleep 5ms to ensure any write would produce a different mtime
    const until = Date.now() + 5;
    while (Date.now() < until) { /* spin */ }

    loadConfig(dataDir);

    assert.equal(fs.readFileSync(configPath, 'utf-8'), seeded, 'file content unchanged');
    assert.equal(fs.statSync(configPath).mtimeMs, seededMtime, 'mtime unchanged — no write');
    assert.equal(fs.existsSync(configPath + '.bak'), false, 'no backup created');
    assert.equal(stderrBuf, '', 'no stderr log');
  });

  it('returns defaults when existing config is unparseable', () => {
    const configPath = path.join(dataDir, 'config.json');
    fs.writeFileSync(configPath, '{ not valid json');
    const config = loadConfig(dataDir);
    assert.ok(config.test_alerts, 'defaults returned');
  });
});
