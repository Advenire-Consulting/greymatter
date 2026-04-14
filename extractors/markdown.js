'use strict';

// Edge types produced by this extractor
const USED_EDGE_TYPES = [
  { name: 'references', category: 'documentary', followsForBlastRadius: false, impliesStaleness: true, description: 'Doc file references a code file by path' },
  { name: 'describes', category: 'documentary', followsForBlastRadius: false, impliesStaleness: true, description: 'Doc section describes what a file or function does' },
  { name: 'triggers', category: 'documentary', followsForBlastRadius: false, impliesStaleness: false, description: 'Doc example triggers a script invocation' },
  { name: 'mentions', category: 'informational', followsForBlastRadius: false, impliesStaleness: false, description: 'Ambiguous/indirect reference to a file path' },
];

// File path: must contain '/' and end with a known extension
// Matches things like lib/foo.js, scripts/bar.js, path/to/file.ext
const FILE_PATH_RE = /(?:^|[\s`'"(,\[])([a-zA-Z0-9_.][a-zA-Z0-9_./:-]*\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,10})(?=$|[\s`'",)\]])/g;

// DB file references: signals.db, graph.db, memory.db
const DB_REF_RE = /\b([a-z][a-z0-9_-]*\.(?:db|sqlite|sqlite3))\b/g;

// Slash command: /dopamine, /wrapup — simple single-segment, no extension
function isSlashCommand(str) {
  return /^\/[a-z][a-z0-9-]+$/.test(str);
}

// File path: has at least one slash and ends with an extension
function isFilePath(str) {
  return /\//.test(str) && /\.[a-zA-Z]{1,10}$/.test(str);
}

// Parse YAML frontmatter — returns key/value object or null
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const yaml = content.slice(4, end);
  const result = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) result[m[1].trim()] = m[2].trim();
  }
  return result;
}

function extract(content, filePath, project) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();

  function addNode(node) {
    const key = `${node.type}:${node.name}`;
    if (!seenNodes.has(key)) {
      seenNodes.add(key);
      nodes.push(node);
    }
  }

  function addEdge(edge) {
    const key = `${edge.type}:${edge.source}:${edge.target}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push(edge);
    }
  }

  // Skill nodes from frontmatter (name + description fields)
  const fm = parseFrontmatter(content);
  if (fm && fm.name) {
    addNode({ project, file: filePath, name: fm.name, type: 'skill', line: 1 });
  }

  const lines = content.split('\n');
  let inFencedBlock = false;
  let fenceLines = [];
  // Track current heading for use as edge source
  let currentSection = filePath;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Fenced code block boundary (``` at start of trimmed line)
    if (/^```/.test(line.trimStart())) {
      if (!inFencedBlock) {
        inFencedBlock = true;
        fenceLines = [];
      } else {
        // End of fence — process accumulated block lines
        for (const fl of fenceLines) {
          // `node scripts/foo.js [args]` → triggers edge
          const nodeMatch = fl.match(/\bnode\s+([\w./:-]+\.js\b)/);
          if (nodeMatch) {
            addEdge({
              type: 'triggers', category: 'documentary',
              source: currentSection, target: nodeMatch[1],
              sourceProject: project, sourceFile: filePath,
            });
          }

          // Other file paths in code block → references
          FILE_PATH_RE.lastIndex = 0;
          let m;
          while ((m = FILE_PATH_RE.exec(fl)) !== null) {
            const p = m[1];
            // Don't double-add what was already added as triggers
            if (nodeMatch && p === nodeMatch[1]) continue;
            addEdge({
              type: 'references', category: 'documentary',
              source: currentSection, target: p,
              sourceProject: project, sourceFile: filePath,
            });
          }
        }

        inFencedBlock = false;
        fenceLines = [];
      }
      continue;
    }

    if (inFencedBlock) {
      fenceLines.push(line);
      continue;
    }

    // Heading detection (h1–h3)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const title = headingMatch[2].trim();
      addNode({ project, file: filePath, name: title, type: 'doc_section', line: lineNum });
      currentSection = title;

      // Check if heading text contains a file path — emit describes edge
      FILE_PATH_RE.lastIndex = 0;
      let fpMatch;
      while ((fpMatch = FILE_PATH_RE.exec(title)) !== null) {
        addEdge({
          type: 'describes', category: 'documentary',
          source: title, target: fpMatch[1],
          sourceProject: project, sourceFile: filePath,
        });
      }

      continue;
    }

    // Inline code spans: `...`
    const inlineCodeRe = /`([^`]+)`/g;
    let icMatch;
    const handledInline = new Set();
    while ((icMatch = inlineCodeRe.exec(line)) !== null) {
      const inner = icMatch[1].trim();
      if (handledInline.has(inner)) continue;
      handledInline.add(inner);

      if (isSlashCommand(inner)) {
        // /dopamine, /oxytocin etc.
        addNode({ project, file: filePath, name: inner, type: 'command', line: lineNum });
        addEdge({
          type: 'triggers', category: 'documentary',
          source: currentSection, target: inner,
          sourceProject: project, sourceFile: filePath,
        });
      } else if (isFilePath(inner)) {
        // lib/graph-db.js, scripts/scan.js etc.
        addEdge({
          type: 'references', category: 'documentary',
          source: currentSection, target: inner,
          sourceProject: project, sourceFile: filePath,
        });
      }
    }

    // DB file references in prose (outside inline code)
    // Note: these may duplicate references from inline code — deduplication via seenEdges
    DB_REF_RE.lastIndex = 0;
    let dbMatch;
    while ((dbMatch = DB_REF_RE.exec(line)) !== null) {
      addEdge({
        type: 'references', category: 'documentary',
        source: currentSection, target: dbMatch[1],
        sourceProject: project, sourceFile: filePath,
      });
    }
  }

  return { nodes, edges, edge_types: USED_EDGE_TYPES };
}

module.exports = { extensions: ['.md'], extract };
