#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig, writeConfig } = require('../lib/config');
const { generate } = require('./generate-tools-rules');

function getRulesPath() {
  return path.join(os.homedir(), '.claude', 'rules', 'greymatter-tools.md');
}

function getBinPath() {
  return path.resolve(__dirname, 'mcp-server.js');
}

function cmdEnable(dataDir) {
  const config = loadConfig(dataDir);
  config.mcp_server = true;
  writeConfig(config, dataDir);
  generate({ dataDir, config, force: true });
}

function cmdDisable(dataDir) {
  const config = loadConfig(dataDir);
  config.mcp_server = false;
  writeConfig(config, dataDir);
  generate({ dataDir, config, force: true });
}

function cmdStatus(dataDir) {
  const config = loadConfig(dataDir);
  const flag = config.mcp_server === true;
  const binPath = getBinPath();
  const rulePath = getRulesPath();
  let ruleMtime = null;
  try { ruleMtime = fs.statSync(rulePath).mtime.toISOString(); } catch { /* rule file may not exist yet */ }
  return { flag, binPath, ruleMtime };
}

if (require.main === module) {
  const sub = process.argv[2];
  const dataDir = path.join(os.homedir(), '.claude', 'greymatter');

  if (sub === 'enable') {
    cmdEnable(dataDir);
    console.log('mcp_server: enabled. greymatter-tools.md regenerated.');
    console.log(`See ${path.resolve(__dirname, '..', 'docs', 'mcp-server.md')} for client configuration.`);
  } else if (sub === 'disable') {
    cmdDisable(dataDir);
    console.log('mcp_server: disabled. greymatter-tools.md regenerated.');
  } else if (sub === 'status') {
    const { flag, binPath, ruleMtime } = cmdStatus(dataDir);
    console.log(`mcp_server: ${flag ? 'enabled' : 'disabled'}`);
    console.log(`server binary: ${binPath}`);
    console.log(`rule file last regenerated: ${ruleMtime || 'unknown'}`);
    console.log(`See docs/mcp-server.md for client configuration.`);
  } else {
    console.error('usage: node scripts/mcp.js <enable|disable|status>');
    process.exit(1);
  }
}

module.exports = { cmdEnable, cmdDisable, cmdStatus };
