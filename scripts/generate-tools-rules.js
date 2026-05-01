#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { loadConfig } = require('../lib/config');

// Map tool-index.md region names to config feature flags.
// Regions not in this map are always kept.
const REGION_TO_FLAG = {
  recall: 'conversation_recall',
  signals: 'behavioral_signals',
  'doc-layer': 'doc_layer',
};

// Mutually exclusive region pairs gated by a single flag.
// Entry format: { flagName: [keepWhenTrue, keepWhenFalse] }
// When config[flagName] === true, keep the first region and strip the second.
// When false or unset, keep the second and strip the first.
const EXCLUSIVE_REGIONS = {
  mcp_server: ['mcp', 'cli-fallback'],
};

function getPluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
}

function getRulesDir() {
  return path.join(os.homedir(), '.claude', 'rules');
}

function getHashPath() {
  return path.join(os.homedir(), '.claude', 'greymatter', 'tmp', 'tool-index.hash');
}

function getOutputPath() {
  return path.join(getRulesDir(), 'greymatter-tools.md');
}

// Strip `<!-- region:NAME -->` ... `<!-- endregion -->` blocks whose flag is disabled.
// Preserves blocks whose region is not mapped to a flag.
// Uses a skip stack to handle nesting: if a parent region is stripped, all
// child regions are stripped regardless of their own flag state.
function stripDisabledRegions(content, config) {
  // Build reverse lookup: regionName → { flag, keepWhen }
  // keepWhen: true = keep when config[flag] === true; false = keep when not true.
  const exclusiveLookup = {};
  for (const [flag, [whenTrue, whenFalse]] of Object.entries(EXCLUSIVE_REGIONS)) {
    exclusiveLookup[whenTrue] = { flag, keepWhen: true };
    exclusiveLookup[whenFalse] = { flag, keepWhen: false };
  }

  const lines = content.split('\n');
  const out = [];
  // Stack of booleans: true = this region level is actively stripping.
  // The top of the stack reflects the effective skip state (inherits parent strip).
  const skipStack = [];
  const regionStart = /^<!--\s*region:([a-zA-Z0-9_-]+)\s*-->\s*$/;
  const regionEnd = /^<!--\s*endregion\s*-->\s*$/;

  function isCurrentlySkipping() {
    return skipStack.length > 0 && skipStack[skipStack.length - 1];
  }

  for (const line of lines) {
    const startMatch = line.match(regionStart);
    if (startMatch) {
      const region = startMatch[1];
      let shouldStrip;
      if (exclusiveLookup[region]) {
        const { flag, keepWhen } = exclusiveLookup[region];
        shouldStrip = (config[flag] === true) !== keepWhen;
      } else {
        const flag = REGION_TO_FLAG[region];
        shouldStrip = !!(flag && config[flag] === false);
      }
      // If a parent region is already stripping, this child also strips.
      skipStack.push(isCurrentlySkipping() || shouldStrip);
      continue; // Drop the region marker line.
    }
    if (regionEnd.test(line)) {
      skipStack.pop();
      continue; // Drop the endregion marker line.
    }
    if (!isCurrentlySkipping()) out.push(line);
  }
  return out.join('\n');
}

function resolvePluginRoot(content, pluginRoot) {
  return content.replace(/\$\{PLUGIN_ROOT\}/g, pluginRoot).replace(/\$PLUGIN_ROOT/g, pluginRoot);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readCachedHash() {
  try {
    return fs.readFileSync(getHashPath(), 'utf-8').trim();
  } catch {
    return null;
  }
}

function writeCachedHash(hash) {
  const hashPath = getHashPath();
  fs.mkdirSync(path.dirname(hashPath), { recursive: true });
  fs.writeFileSync(hashPath, hash, { mode: 0o644 });
}

// Compute a composite hash over the source file AND the config flags that drive stripping.
// If either changes, regeneration is required.
function computeInputHash(sourceBuf, config) {
  const flagState = [
    ...Object.values(REGION_TO_FLAG).map(flag => `${flag}=${config[flag] === false ? '0' : '1'}`),
    ...Object.keys(EXCLUSIVE_REGIONS).map(flag => `${flag}=${config[flag] === true ? '1' : '0'}`),
  ].join('|');
  return sha256(Buffer.concat([sourceBuf, Buffer.from(flagState)]));
}

function generate(opts = {}) {
  const pluginRoot = opts.pluginRoot || getPluginRoot();
  const outputPath = opts.outputPath || getOutputPath();
  const hashPath = opts.hashPath || getHashPath();
  const sourcePath = opts.sourcePath || path.join(pluginRoot, 'docs', 'tool-index.md');
  const force = !!opts.force;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`tool-index.md not found at ${sourcePath}`);
  }

  const dataDir = opts.dataDir || path.join(os.homedir(), '.claude', 'greymatter');
  const config = opts.config || loadConfig(dataDir);

  const sourceBuf = fs.readFileSync(sourcePath);
  const inputHash = computeInputHash(sourceBuf, config);

  // Hash-check: skip regeneration when inputs and output are unchanged.
  if (!force && fs.existsSync(outputPath)) {
    let cached;
    try {
      cached = fs.readFileSync(hashPath, 'utf-8').trim();
    } catch {
      cached = null;
    }
    if (cached === inputHash) {
      return { skipped: true, outputPath };
    }
  }

  let content = sourceBuf.toString('utf-8');
  content = resolvePluginRoot(content, pluginRoot);
  content = stripDisabledRegions(content, config);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, { mode: 0o644 });

  // Update hash after successful write so a partial write never poisons the cache.
  fs.mkdirSync(path.dirname(hashPath), { recursive: true });
  fs.writeFileSync(hashPath, inputHash, { mode: 0o644 });

  return { skipped: false, outputPath };
}

if (require.main === module) {
  try {
    const result = generate({ force: process.argv.includes('--force') });
    if (result.skipped) {
      console.log(`greymatter-tools.md unchanged (${result.outputPath})`);
    } else {
      console.log(`Generated ${result.outputPath}`);
    }
  } catch (err) {
    process.stderr.write(`generate-tools-rules: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { generate, stripDisabledRegions, resolvePluginRoot, REGION_TO_FLAG, EXCLUSIVE_REGIONS };
