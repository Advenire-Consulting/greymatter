'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'defaults.json');

function getDataDir() {
  return path.join(os.homedir(), '.claude', 'greymatter');
}

function getConfigPath(dataDir) {
  return path.join(dataDir || getDataDir(), 'config.json');
}

function loadConfig(dataDir) {
  const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));
  const configPath = getConfigPath(dataDir);

  if (!fs.existsSync(configPath)) {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), { mode: 0o600 });
    } catch { /* can't write — return defaults */ }
    return defaults;
  }

  try {
    const user = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return mergeConfig(defaults, user);
  } catch {
    return defaults;
  }
}

function mergeConfig(defaults, user) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(user)) {
    if (
      value !== null && typeof value === 'object' && !Array.isArray(value) &&
      defaults[key] !== null && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])
    ) {
      merged[key] = { ...defaults[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

module.exports = { loadConfig, getDataDir, getConfigPath };
