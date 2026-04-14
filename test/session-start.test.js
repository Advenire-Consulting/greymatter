'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-test-ss-'));
}

describe('SessionStart', () => {
  let dataDir;
  let rulesDir;
  // Capture and restore stdout.write across each test
  let originalWrite;
  let captured;

  beforeEach(() => {
    dataDir = makeTempDir();
    rulesDir = makeTempDir();
    captured = '';
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (data) => { captured += data; return true; };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(rulesDir, { recursive: true, force: true });
  });

  it('creates data directory structure on first run', () => {
    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir });
    assert.ok(fs.existsSync(rulesDir), 'rulesDir should exist');
    assert.ok(fs.existsSync(path.join(dataDir, 'tmp')), 'tmp/ should exist');
  });

  it('copies defaults.json to config.json on first run', () => {
    const configPath = path.join(dataDir, 'config.json');
    assert.ok(!fs.existsSync(configPath), 'config.json should not exist yet');
    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir });
    assert.ok(fs.existsSync(configPath), 'config.json should be created');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(typeof config.hypothalamus === 'object', 'hypothalamus section should be present');
  });

  it('cleans tmp files older than maxAgeMs', () => {
    const tmpDir = path.join(dataDir, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    const oldFile = path.join(tmpDir, 'old-state.json');
    fs.writeFileSync(oldFile, 'test');

    // Backdate the file's mtime by 25 hours
    const oneDay = 25 * 60 * 60 * 1000;
    const oldTimeSec = (Date.now() - oneDay) / 1000;
    fs.utimesSync(oldFile, oldTimeSec, oldTimeSec);

    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir, maxAgeMs: 24 * 60 * 60 * 1000 });

    assert.ok(!fs.existsSync(oldFile), 'old tmp file should have been deleted');
  });

  it('generates greymatter-tools.md from tool-index.md when missing', () => {
    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir });
    const toolsMd = path.join(rulesDir, 'greymatter-tools.md');
    assert.ok(fs.existsSync(toolsMd), 'greymatter-tools.md should be generated');
    const content = fs.readFileSync(toolsMd, 'utf-8');
    // $PLUGIN_ROOT should be resolved to the actual path
    assert.ok(!content.includes('$PLUGIN_ROOT'), '$PLUGIN_ROOT placeholders should be resolved');
  });

  it('generates empty signals.md when missing', () => {
    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir });
    const signalsMd = path.join(rulesDir, 'signals.md');
    assert.ok(fs.existsSync(signalsMd), 'signals.md should be generated');
    const content = fs.readFileSync(signalsMd, 'utf-8');
    assert.ok(content.includes('Behavioral Signals'), 'signals.md should have a heading');
  });

  it('outputs project list line', () => {
    const { run } = require('../hooks/session-start');
    run({ dataDir, rulesDir });
    assert.ok(captured.includes('Projects:'), 'stdout should contain Projects: line');
  });
});
