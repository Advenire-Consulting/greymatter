#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('../lib/config');
const { GraphDB } = require('../lib/graph-db');
const { GraphQueries } = require('../lib/graph-queries');
const { MemoryDB } = require('../lib/memory-db');
const { scanForSessions, ingestSession } = require('../lib/ingest');
const { buildProjectContext } = require('../lib/reorientation');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TOOL_INDEX_SRC = path.join(PLUGIN_ROOT, 'docs', 'tool-index.md');
const SHARED_RULES_DIR = path.join(os.homedir(), '.claude', 'rules');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// Remove stale rules files from the pre-Phase-2 nested path (`~/.claude/greymatter/rules/`).
// Rules now live flat at `~/.claude/rules/` alongside brain-tools.md.
function cleanupLegacyRulesDir(dataDir) {
  const legacy = path.join(dataDir, 'rules');
  try {
    const entries = fs.readdirSync(legacy);
    for (const entry of entries) {
      try { fs.unlinkSync(path.join(legacy, entry)); } catch { /* ignore per-file errors */ }
    }
    try { fs.rmdirSync(legacy); } catch { /* dir may be non-empty or gone */ }
  } catch { /* legacy dir never existed */ }
}

function cleanTmp(tmpDir, maxAgeMs) {
  const maxAge = maxAgeMs != null ? maxAgeMs : 24 * 60 * 60 * 1000;
  try {
    const now = Date.now();
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      const full = path.join(tmpDir, entry);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(full);
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* tmp dir may not exist yet */ }
}

function generateEmptySignals(destPath) {
  const content = [
    '# Behavioral Signals',
    '',
    '*No signals recorded yet. Use /dopamine or /oxytocin to add signals.*',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content, { mode: 0o644 });
}

// Convert a filesystem path to Claude Code's projects subdirectory name.
// e.g. /home/user/projects → -home-user-projects
function cwdToClaudeProjectDir(cwdPath) {
  return cwdPath.replace(/\//g, '-');
}

// Resolve which conversation directories to scan.
// Uses config.conversation_directories if set, otherwise auto-detects from CWD.
function resolveConversationDirs(config, dataDir) {
  if (config.conversation_directories && config.conversation_directories.length > 0) {
    return config.conversation_directories
      .map(d => d.replace('~', os.homedir()))
      .filter(d => fs.existsSync(d));
  }
  // Auto-detect: convert CWD to Claude Code project dir format
  const cwd = process.cwd();
  const claudeProjectDirName = cwdToClaudeProjectDir(cwd);
  const autoDir = path.join(os.homedir(), '.claude', 'projects', claudeProjectDirName);
  if (fs.existsSync(autoDir)) return [autoDir];
  return [];
}

function outputJson(content) {
  process.stdout.write(JSON.stringify({
    additional_context: content,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: content,
    },
  }) + '\n');
}

function run(options = {}) {
  const dataDir = options.dataDir || path.join(os.homedir(), '.claude', 'greymatter');
  const rulesDir = options.rulesDir || SHARED_RULES_DIR;
  const tmpDir = path.join(dataDir, 'tmp');
  const dbPath = path.join(dataDir, 'graph.db');
  const signalsDest = path.join(rulesDir, 'greymatter-signals.md');

  // 1. Load config — creates config.json on first run, returns merged config
  const config = loadConfig(dataDir);

  // 2. Ensure data dirs exist (rulesDir is shared across plugins; greymatter just ensures it's there)
  ensureDir(dataDir);
  ensureDir(rulesDir);
  ensureDir(tmpDir);

  // 2a. One-time migration: clear out pre-Phase-2 nested rules dir if present.
  cleanupLegacyRulesDir(dataDir);

  // 2b. Seed starter signals and forces on first run (no-op if tables already populated).
  try {
    const { seed } = require('../scripts/seed-signals');
    seed(dataDir);
  } catch (err) {
    process.stderr.write(`greymatter session-start: seed: ${err.message}\n`);
  }

  // 3. Clean tmp files older than maxAgeMs
  cleanTmp(tmpDir, options.maxAgeMs);

  // 4. Ingest new conversations into memory.db
  const memoryDbPath = path.join(dataDir, 'memory.db');
  try {
    // config already loaded above — no second call needed
    const convDirs = resolveConversationDirs(config, dataDir);
    if (convDirs.length > 0) {
      const memDb = new MemoryDB(memoryDbPath);
      // One-time migration: add start_line/end_line to decisions if missing
      try {
        memDb.db.prepare('SELECT start_line FROM decisions LIMIT 0').run();
      } catch {
        memDb.db.exec('ALTER TABLE decisions ADD COLUMN start_line INTEGER');
        memDb.db.exec('ALTER TABLE decisions ADD COLUMN end_line INTEGER');
      }
      let totalIngested = 0;
      let totalWindows = 0;
      try {
        for (const convDir of convDirs) {
          const files = scanForSessions(convDir);
          for (const filePath of files) {
            const stats = ingestSession(filePath, memDb);
            if (!stats.skipped) {
              totalIngested++;
              totalWindows += stats.windowsCreated;
            }
          }
        }
      } finally {
        memDb.close();
      }
      if (totalIngested > 0) {
        process.stderr.write(`greymatter: Ingested ${totalIngested} new sessions (${totalWindows} windows)\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`greymatter session-start: ingest error: ${err.message}\n`);
  }

  // 5. Regenerate greymatter-tools.md from tool-index.md (hash-gated inside the generator).
  try {
    const { generate } = require('../scripts/generate-tools-rules');
    generate({
      pluginRoot: PLUGIN_ROOT,
      dataDir,
      config,
      outputPath: path.join(rulesDir, 'greymatter-tools.md'),
    });
  } catch (err) {
    process.stderr.write(`greymatter session-start: tools-rules regen: ${err.message}\n`);
  }

  // 6. Regenerate greymatter-signals.md from memory.db if possible; fall back to empty placeholder.
  try {
    if (fs.existsSync(path.join(dataDir, 'memory.db'))) {
      const { cmdGenerate } = require('../scripts/signals');
      cmdGenerate(dataDir, config, rulesDir);
    } else if (!fs.existsSync(signalsDest)) {
      generateEmptySignals(signalsDest);
    }
  } catch (err) {
    process.stderr.write(`greymatter session-start: signals regen: ${err.message}\n`);
    if (!fs.existsSync(signalsDest)) {
      try { generateEmptySignals(signalsDest); } catch { /* give up */ }
    }
  }

  // 7. Build per-project reorientation context from memory.db → graph.db
  try {
    if (fs.existsSync(memoryDbPath) && fs.existsSync(dbPath)) {
      const result = buildProjectContext(memoryDbPath, dbPath);
      if (result.projectCount > 0) {
        process.stderr.write(`greymatter: Reorientation context built for ${result.projectCount} projects\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`greymatter session-start: reorientation: ${err.message}\n`);
  }

  // 9. Output project list from graph.db
  let projects = [];
  if (fs.existsSync(dbPath)) {
    let db;
    try {
      db = new GraphDB(dbPath);
      const queries = new GraphQueries(db);
      projects = queries.listProjects();
    } catch { /* db may be corrupt or not yet initialized */ }
    finally {
      if (db) try { db.close(); } catch (e) { process.stderr.write(`greymatter session-start: close: ${e.message}\n`); }
    }
  }

  const projectLine = `Projects: ${projects.length > 0 ? projects.join(', ') : '(none)'}`;
  outputJson(projectLine);
}

// When run directly as a hook
if (require.main === module) {
  try {
    run();
  } catch (err) {
    process.stderr.write(`greymatter session-start: ${err.message}\n`);
    process.exit(0);
  }
}

module.exports = { run };
