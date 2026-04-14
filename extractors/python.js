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

module.exports = { extensions: ['.py'], extract };
