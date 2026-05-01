'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

function tmpDir(label) {
  const dir = path.join(os.tmpdir(), `gm-mcp-cli-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

const { cmdEnable, cmdDisable, cmdStatus } = require('../scripts/mcp');

describe('mcp CLI subcommands', () => {
  let dataDir;

  before(() => {
    dataDir = tmpDir('data');
    // Seed an initial config with mcp_server: false
    const configPath = path.join(dataDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ mcp_server: false }), { mode: 0o600 });
  });

  after(() => {
    rmrf(dataDir);
  });

  it('cmdEnable sets mcp_server: true in config', () => {
    cmdEnable(dataDir);
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf-8'));
    assert.equal(config.mcp_server, true);
  });

  it('cmdDisable sets mcp_server: false in config', () => {
    cmdDisable(dataDir);
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf-8'));
    assert.equal(config.mcp_server, false);
  });

  it('cmdStatus returns an object with flag, binPath, and ruleMtime fields', () => {
    const result = cmdStatus(dataDir);
    assert.ok('flag' in result, 'result has flag');
    assert.ok('binPath' in result, 'result has binPath');
    assert.ok('ruleMtime' in result, 'result has ruleMtime');
    assert.equal(typeof result.flag, 'boolean');
    assert.equal(typeof result.binPath, 'string');
  });

  it('cmdEnable then cmdStatus returns flag: true', () => {
    cmdEnable(dataDir);
    const result = cmdStatus(dataDir);
    assert.equal(result.flag, true);
  });

  it('cmdDisable then cmdStatus returns flag: false', () => {
    cmdDisable(dataDir);
    const result = cmdStatus(dataDir);
    assert.equal(result.flag, false);
  });
});
