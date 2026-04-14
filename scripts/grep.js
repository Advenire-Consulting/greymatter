'use strict';

// Project-aware grep — searches all files in known project directories.
// Discovers projects from graph.db instead of DIR files.
// Returns matches with surrounding context, grouped by project.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { GraphDB } = require('../lib/graph-db');

const DEFAULT_DB = path.join(os.homedir(), '.claude', 'greymatter', 'graph.db');

const args = process.argv.slice(2);

function flag(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const pattern = args.find(a => !a.startsWith('--'));
const contextLines = parseInt(flag('--context') || flag('-C') || '3', 10);
const projectFilter = flag('--project');
const maxPerFile = parseInt(flag('--max-per-file') || '20', 10);
const dbPath = flag('--db') || DEFAULT_DB;
const workspace = flag('--workspace') || process.env.CLAUDE_WORKSPACE || process.cwd();

if (!pattern) {
  console.log(`Usage: node greymatter/scripts/grep.js <pattern> [options]

Options:
  --context N, -C N       Lines of context around each match (default: 3)
  --project <name>        Filter to one project (substring match)
  --max-per-file N        Max matches shown per file (default: 20)
  --db <path>             Path to graph.db (default: ~/.claude/greymatter/graph.db)
  --workspace <path>      Workspace root containing project directories (default: CLAUDE_WORKSPACE or cwd)

Examples:
  node greymatter/scripts/grep.js "apiBase"
  node greymatter/scripts/grep.js "apiBase" --project myapp
  node greymatter/scripts/grep.js "fetch.*booking" --context 5`);
  process.exit(1);
}

const { collectFiles } = require('../lib/file-walker');

function searchFile(filePath, regex, ctx) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch { return []; }

  if (content.includes('\0')) return [];

  const lines = content.split('\n');
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const start = Math.max(0, i - ctx);
      const end = Math.min(lines.length - 1, i + ctx);

      if (matches.length > 0) {
        const prev = matches[matches.length - 1];
        if (start <= prev.end + 1) {
          prev.end = end;
          prev.matchLines.push(i + 1);
          continue;
        }
      }

      matches.push({ start, end, matchLines: [i + 1] });
    }
  }

  return matches.map(m => {
    const snippet = [];
    for (let j = m.start; j <= m.end; j++) {
      const lineNum = j + 1;
      const marker = m.matchLines.includes(lineNum) ? '>' : ' ';
      snippet.push(marker + ' ' + String(lineNum).padStart(4) + '  ' + lines[j]);
    }
    return { matchLines: m.matchLines, snippet: snippet.join('\n') };
  });
}

// Load project names from graph.db
function loadProjects(dbPath) {
  try {
    fs.accessSync(dbPath);
  } catch {
    return [];
  }
  const db = new GraphDB(dbPath);
  try {
    const rows = db.db.prepare('SELECT DISTINCT project FROM nodes ORDER BY project').all();
    return rows.map(r => r.project);
  } finally {
    db.close();
  }
}

// Main
const projectNames = loadProjects(dbPath);
if (projectNames.length === 0) {
  console.error('No projects found in graph.db. Run: node greymatter/scripts/scan.js');
  process.exit(1);
}

const filteredProjects = projectFilter
  ? projectNames.filter(n => n.toLowerCase().includes(projectFilter.toLowerCase()))
  : projectNames;

if (filteredProjects.length === 0) {
  console.error('No project matching "' + projectFilter + '"');
  process.exit(1);
}

let regex;
try { regex = new RegExp(pattern); }
catch (err) {
  console.error('Invalid regex: ' + err.message);
  process.exit(1);
}

let totalMatches = 0;
let totalFiles = 0;
const output = [];

for (const projectName of filteredProjects) {
  const projectRoot = path.join(workspace, projectName);
  if (!fs.existsSync(projectRoot)) continue;

  const files = collectFiles(projectRoot);
  const projectMatches = [];

  for (const filePath of files) {
    const results = searchFile(filePath, regex, contextLines);
    if (results.length === 0) continue;

    const relPath = path.relative(projectRoot, filePath);
    const capped = results.slice(0, maxPerFile);
    const matchCount = capped.reduce((sum, r) => sum + r.matchLines.length, 0);

    projectMatches.push({
      file: relPath,
      matchCount,
      snippets: capped,
      truncated: results.length > maxPerFile,
    });

    totalMatches += matchCount;
    totalFiles++;
  }

  if (projectMatches.length > 0) {
    output.push({ project: projectName, matches: projectMatches });
  }
}

if (output.length === 0) {
  console.log('No matches for /' + pattern + '/ across ' + filteredProjects.length + ' projects');
  process.exit(0);
}

console.log('/' + pattern + '/ — ' + totalMatches + ' matches in ' + totalFiles + ' files\n');

for (const proj of output) {
  const fileCount = proj.matches.length;
  const matchCount = proj.matches.reduce((s, m) => s + m.matchCount, 0);
  console.log('━━ ' + proj.project + ' (' + matchCount + ' matches in ' + fileCount + ' files) ━━\n');

  for (const file of proj.matches) {
    console.log('  ' + file.file);
    for (const snippet of file.snippets) {
      console.log('  ┌─');
      for (const line of snippet.snippet.split('\n')) {
        console.log('  │' + line);
      }
      console.log('  └─');
    }
    if (file.truncated) {
      console.log('  ... (truncated, --max-per-file ' + maxPerFile + ')');
    }
    console.log('');
  }
}
