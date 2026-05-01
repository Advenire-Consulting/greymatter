'use strict';

const path = require('path');

const USED_EDGE_TYPES = [
  { name: 'imports', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Python module import (relative only)' },
  { name: 'decorates', category: 'structural', followsForBlastRadius: false, impliesStaleness: false, description: 'Decorator applied to function or class' },
];

function extract(content, filePath, project) {
  const nodes = [];
  const edges = [];

  const moduleName = path.basename(filePath);
  nodes.push({ project, file: filePath, name: moduleName, type: 'module', line: 1 });

  const lines = content.split('\n');
  let pendingDecorators = [];
  let currentClass = null;
  let classIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNum = i + 1;

    // ── Decorator lines ──────────────────────────────────────────────────────
    // @decorator or @decorator.method or @decorator(args)
    const decoratorMatch = trimmed.match(/^@([\w.]+)/);
    if (decoratorMatch) {
      pendingDecorators.push({ name: decoratorMatch[1], line: lineNum });
      continue;
    }

    // ── Function definitions ─────────────────────────────────────────────────
    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if (funcMatch) {
      const fnName = funcMatch[1];
      const indent = line.search(/\S/);

      // If indented deeper than the class keyword, it's a method
      if (currentClass && indent > classIndent) {
        nodes.push({
          project, file: filePath, name: fnName, type: 'method', line: lineNum,
          metadata_json: JSON.stringify({ scope: currentClass }),
        });
      } else {
        // Top-level function (or class ended)
        currentClass = null;
        classIndent = -1;
        nodes.push({ project, file: filePath, name: fnName, type: 'function', line: lineNum });
      }
      // Attach pending decorators
      for (const dec of pendingDecorators) {
        edges.push({
          type: 'decorates', category: 'structural',
          source: fnName, target: dec.name,
          sourceProject: project, sourceFile: filePath,
        });
      }
      pendingDecorators = [];
      continue;
    }

    // ── Class definitions ────────────────────────────────────────────────────
    const classMatch = trimmed.match(/^class\s+(\w+)\s*[:(]/);
    if (classMatch) {
      const clsName = classMatch[1];
      // Track indentation level of the class keyword
      classIndent = line.search(/\S/);
      currentClass = clsName;
      nodes.push({ project, file: filePath, name: clsName, type: 'class', line: lineNum });
      // Attach pending decorators
      for (const dec of pendingDecorators) {
        edges.push({
          type: 'decorates', category: 'structural',
          source: clsName, target: dec.name,
          sourceProject: project, sourceFile: filePath,
        });
      }
      pendingDecorators = [];
      continue;
    }

    // Non-decorator/def/class line: clear any accumulated decorators that
    // turned out not to be followed by a def/class (e.g. standalone @expr)
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      pendingDecorators = [];
      // Reset class context if we encounter a non-empty, non-comment line
      // at the same or lesser indent than the class keyword
      if (currentClass) {
        const indent = line.search(/\S/);
        if (indent >= 0 && indent <= classIndent) {
          currentClass = null;
          classIndent = -1;
        }
      }
    }

    // ── Import statements ────────────────────────────────────────────────────
    // Only relative imports (from .module import ...) become edges.
    // Standard library and third-party imports are skipped.
    const fromRelativeMatch = trimmed.match(/^from\s+(\.[\w.]*)\s+import/);
    if (fromRelativeMatch) {
      edges.push({
        type: 'imports', category: 'structural',
        source: moduleName, target: fromRelativeMatch[1],
        sourceProject: project, sourceFile: filePath,
      });
      continue;
    }

    // absolute: `import os` or `from pathlib import Path` — skip (not relative)
  }

  return { nodes, edges, edge_types: USED_EDGE_TYPES };
}

const testPairs = {
  isTestFile(relPath) {
    const base = path.basename(relPath);
    if (/^test_.+\.py$/.test(base)) return true;
    if (/.+_test\.py$/.test(base)) return true;
    return /(^|\/)(test|tests)\//.test(relPath);
  },

  candidateTestPaths(sourceRelPath) {
    const ext = path.extname(sourceRelPath);
    const dir = path.dirname(sourceRelPath);
    const name = path.basename(sourceRelPath, ext);
    const candidates = [
      path.join(dir, `test_${name}${ext}`),
      path.join(dir, `${name}_test${ext}`),
      path.join('tests', dir, `test_${name}${ext}`),
      path.join('test', dir, `test_${name}${ext}`),
      path.join('tests', `test_${name}${ext}`),
      path.join('test', `test_${name}${ext}`),
    ];
    // src-layout: src/pkg/foo.py → tests/pkg/test_foo.py
    const srcMatch = sourceRelPath.match(/^src\/(.+)$/);
    if (srcMatch) {
      const inner = path.dirname(srcMatch[1]);
      candidates.push(
        path.join('tests', inner, `test_${name}${ext}`),
        path.join('test', inner, `test_${name}${ext}`),
      );
    }
    return candidates;
  },

  parseAnnotations(content) {
    const header = content.split('\n').slice(0, 20).join('\n');
    const matches = [...header.matchAll(/#[ \t]*@tests[ \t]+(\S+)/g)];
    return matches.map(m => m[1]);
  },
};

function extractBody(content, node) {
  if (!node || typeof node.line !== 'number') return null;
  const lines = content.split('\n');
  const startIdx = node.line - 1;
  if (startIdx < 0 || startIdx >= lines.length) return null;

  const startIndent = lines[startIdx].search(/\S/);
  if (startIndent < 0) return null;

  let endIdx = startIdx;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { endIdx = i; continue; }
    if (/^\s*#/.test(line)) { endIdx = i; continue; }
    const indent = line.search(/\S/);
    if (indent <= startIndent) break;
    endIdx = i;
  }
  // Trim trailing blank/comment-only lines
  while (endIdx > startIdx) {
    const t = lines[endIdx].trim();
    if (t === '' || t.startsWith('#')) endIdx--;
    else break;
  }
  return lines.slice(startIdx, endIdx + 1).join('\n');
}

const labelDetectors = [
  {
    id: 'flask-route',
    category: 'route-handler',
    defaultTerm: 'route handler',
    detect: (node, ctx) => {
      if (!ctx?.content || typeof node.line !== 'number') return null;
      const lines = ctx.content.split('\n');
      for (let i = node.line - 2; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (trimmed === '' || trimmed.startsWith('#')) continue;
        if (/^@(app|bp)\.route\b/.test(trimmed)) {
          return { confidence: 0.95, descriptors: ['flask'] };
        }
        if (trimmed.startsWith('@')) continue;
        break;
      }
      return null;
    },
  },
  {
    id: 'django-view',
    category: 'route-handler',
    defaultTerm: 'view',
    detect: (node, ctx) => {
      if (!ctx?.filePath || !ctx?.content) return null;
      if (typeof node.line !== 'number') return null;
      const inViews = /(?:^|\/)views\.py$|\/views\//.test(ctx.filePath);
      if (!inViews) return null;
      const startLine = ctx.content.split('\n')[node.line - 1] || '';
      if (!/def\s+\w+\s*\(\s*request\b/.test(startLine)) return null;
      return { confidence: 0.9, descriptors: ['django'] };
    },
  },
  {
    id: 'sqlalchemy-query',
    category: 'data-access',
    defaultTerm: 'ORM query',
    detect: (node) => {
      if (!node.body) return null;
      if (/\b\w+\.(query|execute)\s*\(/.test(node.body)) {
        return { confidence: 0.9, descriptors: ['sqlalchemy'] };
      }
      if (/\b[A-Z]\w*\.query\.\w+/.test(node.body)) {
        return { confidence: 0.9, descriptors: ['sqlalchemy', 'model'] };
      }
      return null;
    },
  },
];

module.exports = { extensions: ['.py'], extract, testPairs, labelDetectors, extractBody };
