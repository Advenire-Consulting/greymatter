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
function stripDisabledRegions(content, config) {
  const lines = content.split('\n');
  const out = [];
  let skip = false;
  const regionStart = /^<!--\s*region:([a-zA-Z0-9_-]+)\s*-->\s*$/;
  const regionEnd = /^<!--\s*endregion\s*-->\s*$/;

  for (const line of lines) {
    const startMatch = line.match(regionStart);
    if (startMatch) {
      const region = startMatch[1];
      const flag = REGION_TO_FLAG[region];
      // Disable only if the region maps to a flag AND the flag is explicitly false.
      skip = !!(flag && config[flag] === false);
      // Drop the region marker line whether we're stripping or not.
      continue;
    }
    if (regionEnd.test(line)) {
      skip = false;
      continue;
    }
    if (!skip) out.push(line);
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
  const flagState = Object.values(REGION_TO_FLAG)
    .map(flag => `${flag}=${config[flag] === false ? '0' : '1'}`)
    .join('|');
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

module.exports = { generate, stripDisabledRegions, resolvePluginRoot, REGION_TO_FLAG };
