'use strict';

// Post-tool-use hook: fires after Edit/Write/MultiEdit.
// Re-extracts the changed file into graph.db incrementally.
// Errors are swallowed — hook must not block the session.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { GraphDB } = require('../lib/graph-db');
const { ExtractorRegistry } = require('../lib/extractor-registry');

const DATA_DIR = path.join(os.homedir(), '.claude', 'greymatter');
const DB_PATH = path.join(DATA_DIR, 'graph.db');

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
  let toolInput;
  try {
    // Claude Code hooks deliver tool input as JSON on stdin (fd 0)
    toolInput = JSON.parse(fs.readFileSync(0, 'utf-8'));
  } catch {
    process.exit(0);
  }

  // Normalize file path from tool input
  const filePath = toolInput.file_path || toolInput.path || null;
  if (!filePath || !path.isAbsolute(filePath)) process.exit(0);

  const registry = new ExtractorRegistry();
  const ext = path.extname(filePath);
  if (!registry.getExtractor(ext)) process.exit(0);

  // Check DB exists before trying to open
  try { fs.accessSync(DB_PATH); } catch { process.exit(0); }

  let db;
  try {
    db = new GraphDB(DB_PATH);
  } catch (err) {
    process.stderr.write(`greymatter post-tool-use: db open failed: ${err.message}\n`);
    process.exit(0);
  }

  try {
    // Find the project this file belongs to.
    // Check CLAUDE_WORKSPACE env var, then CWD.
    // project dirs are workspace/<project-name>/ by convention.
    const workspace = process.env.CLAUDE_WORKSPACE || process.cwd();
    const projects = db.db.prepare('SELECT DISTINCT project FROM nodes ORDER BY project').all();

    let projectName = null;
    let projectDir = null;
    let relPath = null;

    for (const { project } of projects) {
      const candidateDir = path.join(workspace, project);
      try {
        const rel = path.relative(candidateDir, filePath);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          projectName = project;
          projectDir = candidateDir;
          relPath = rel;
          break;
        }
      } catch {
        // path.relative can throw on Windows with cross-drive paths — skip this project
      }
    }

    if (!projectName || !relPath) {
      db.close();
      process.exit(0);
    }

    // Read file content
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      process.stderr.write(`greymatter post-tool-use: cannot read ${filePath}: ${err.message}\n`);
      db.close();
      process.exit(0);
    }

    // Hash check — skip if unchanged
    const hash = hashContent(content);
    const existingHash = db.getFileHash(projectName, relPath);
    if (existingHash === hash) {
      db.close();
      process.exit(0);
    }

    // Extract
    const extracted = registry.extractFile(content, relPath, projectName);

    // Register any new edge types
    for (const et of extracted.edge_types || []) {
      db.registerEdgeType(et);
    }

    // Replace nodes and edges for this file
    db.deleteFileEdges(projectName, relPath);
    db.deleteFileNodes(projectName, relPath);

    const nameMap = new Map();
    for (const node of extracted.nodes) {
      const id = db.upsertNode(node);
      if (!nameMap.has(node.name)) nameMap.set(node.name, id);
    }

    // Insert edges — best-effort, no import resolution (hook is fast-path only)
    for (const edge of extracted.edges) {
      let sourceId = nameMap.get(edge.source);
      if (sourceId == null) {
        const first = nameMap.values().next();
        sourceId = first.done ? null : first.value;
      }
      if (sourceId == null) continue;

      let targetId = nameMap.get(edge.target);
      if (targetId == null) {
        // Look up globally
        const row = db.db.prepare(
          'SELECT id FROM nodes WHERE name = ? AND project = ? LIMIT 1'
        ).get(edge.target, projectName);
        if (row) targetId = row.id;
      }
      if (targetId == null) {
        // Create stub
        const stubType = edge.type === 'queries_table' ? 'table' : 'stub';
        targetId = db.upsertNode({
          project: projectName,
          file: relPath,
          name: edge.target,
          type: stubType,
          line: null,
        });
      }

      try {
        db.insertEdge({
          sourceId,
          targetId,
          type: edge.type,
          category: edge.category,
          sourceProject: projectName,
          sourceFile: relPath,
        });
      } catch {
        // Duplicate edge — skip silently
      }
    }

    db.setFileHash(projectName, relPath, hash);
    db.close();
    process.exit(0);
  } catch (err) {
    process.stderr.write(`greymatter post-tool-use: ${err.message}\n`);
    try { db.close(); } catch (e) { process.stderr.write(`greymatter post-tool-use: close: ${e.message}\n`); }
    process.exit(0);
  }
}

main();
