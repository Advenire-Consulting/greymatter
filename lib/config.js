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

  let user;
  try {
    user = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return defaults;
  }

  // Additive migration: insert keys present in defaults but absent from the
  // user's file, so new knobs are discoverable on disk without flipping any
  // existing value. Existing user values (including arrays) are preserved
  // exactly; only missing keys get their default inserted.
  const added = [];
  const withNewKeys = addMissingKeys(defaults, user, '', added);
  if (added.length > 0) {
    try {
      fs.copyFileSync(configPath, configPath + '.bak');
      fs.writeFileSync(configPath, JSON.stringify(withNewKeys, null, 2), { mode: 0o600 });
      process.stderr.write(
        `greymatter: added ${added.length} new config key(s) to config.json `
        + `(${added.join(', ')}; backup at config.json.bak; see config/defaults.md)\n`
      );
    } catch (err) {
      process.stderr.write(`greymatter: config migration failed: ${err.message}\n`);
    }
  }

  return withNewKeys;
}

// Recursively insert keys from `defaults` that are missing in `user`.
// Never touches existing values. Treats arrays as leaves (won't merge).
// Pushes each inserted key's dot-path into `added` for the caller's summary.
function addMissingKeys(defaults, user, pathPrefix, added) {
  const result = { ...user };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const subpath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (!(key in user)) {
      result[key] = defaultValue;
      added.push(subpath);
      continue;
    }
    const userValue = user[key];
    if (
      defaultValue !== null && typeof defaultValue === 'object' && !Array.isArray(defaultValue) &&
      userValue !== null && typeof userValue === 'object' && !Array.isArray(userValue)
    ) {
      result[key] = addMissingKeys(defaultValue, userValue, subpath, added);
    }
  }
  return result;
}

// Write config atomically (tmp → rename) so partial writes don't corrupt.
function writeConfig(config, dataDir) {
  const configPath = getConfigPath(dataDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

module.exports = { loadConfig, writeConfig, getDataDir, getConfigPath, addMissingKeys };
