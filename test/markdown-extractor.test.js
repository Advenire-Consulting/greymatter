'use strict';

// @tests extractors/markdown.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/markdown');

describe('Markdown Extractor', () => {
  it('has correct extension', () => {
    assert.deepEqual(extractor.extensions, ['.md']);
  });

  it('extracts heading sections as doc_section nodes', () => {
    const result = extractor.extract(
      "# Main Title\n\nSome text.\n\n## Section One\n\nMore text.\n\n### Subsection\n\nDetails.\n",
      'docs/README.md', 'p'
    );
    const sections = result.nodes.filter(n => n.type === 'doc_section');
    assert.ok(sections.length >= 3);
    assert.ok(sections.some(n => n.name === 'Main Title'));
    assert.ok(sections.some(n => n.name === 'Section One'));
  });

  it('extracts file path references from fenced code blocks', () => {
    const result = extractor.extract(
      "# Usage\n\n```\nnode scripts/scan.js --full\n```\n\nSee `lib/graph-db.js` for schema.\n",
      'docs/guide.md', 'p'
    );
    const refEdges = result.edges.filter(e => e.type === 'triggers' || e.type === 'references');
    assert.ok(refEdges.length >= 1);
  });

  it('extracts command invocations', () => {
    const result = extractor.extract(
      "# Commands\n\nUse `/dopamine` to record a lesson.\nUse `/oxytocin` for relational dynamics.\n",
      'docs/commands.md', 'p'
    );
    const commands = result.nodes.filter(n => n.type === 'command');
    assert.ok(commands.length >= 2);
    assert.ok(commands.some(n => n.name === '/dopamine'));
  });

  it('classifies code block with node command as triggers edge', () => {
    const result = extractor.extract(
      "# Run\n\n```\nnode scripts/signals.js --review\n```\n",
      'docs/usage.md', 'p'
    );
    const triggers = result.edges.filter(e => e.type === 'triggers');
    assert.ok(triggers.length >= 1);
    assert.ok(triggers.some(e => e.target.includes('signals.js')));
  });

  it('returns documentary edge_types', () => {
    const result = extractor.extract("# Hello\n\nSee `lib/foo.js`.\n", 'docs/x.md', 'p');
    const typeNames = result.edge_types.map(et => et.name);
    assert.ok(typeNames.some(n => ['references', 'describes', 'triggers', 'mentions'].includes(n)));
  });

  it('emits describes edges from headings containing file paths', () => {
    const content = `# Project Docs

## lib/graph-db.js — Graph Database

This file manages the graph.

## scripts/scan.js

Scanner documentation.
`;
    const result = extractor.extract(content, 'docs/overview.md', 'test');

    const describesEdges = result.edges.filter(e => e.type === 'describes');
    assert.ok(describesEdges.length >= 2, 'should have at least 2 describes edges');

    const graphDbEdge = describesEdges.find(e => e.target === 'lib/graph-db.js');
    assert.ok(graphDbEdge, 'should have describes edge for lib/graph-db.js');

    const scanEdge = describesEdges.find(e => e.target === 'scripts/scan.js');
    assert.ok(scanEdge, 'should have describes edge for scripts/scan.js');
  });
});
