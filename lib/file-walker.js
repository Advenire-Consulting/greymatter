'use strict';

const fs = require('fs');
const path = require('path');

// Directories to skip during recursive file collection
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  'coverage', '.nyc_output', '__pycache__', '.venv', 'vendor',
]);

// File extensions recognized as text (searchable) files
const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.svelte',
  '.html', '.htm', '.css', '.scss', '.less',
  '.json', '.md', '.txt', '.yml', '.yaml', '.toml',
  '.sql', '.sh', '.bash', '.zsh',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp',
  '.env', '.example', '.conf', '.cfg',
  '.xml', '.svg', '.ejs', '.hbs', '.pug',
]);

// Recursively collects text files from a directory, skipping
// SKIP_DIRS and non-text extensions.
function collectFiles(dirPath) {
  const results = [];

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (err) {
      process.stderr.write(`greymatter: collectFiles: ${err.message}\n`);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) || (ext === '' && entry.name !== 'LICENSE')) {
          results.push(path.join(current, entry.name));
        }
      }
    }
  }

  walk(dirPath);
  return results;
}

module.exports = { SKIP_DIRS, TEXT_EXTENSIONS, collectFiles };
