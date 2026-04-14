'use strict';

// Seed edge types — registered on first scan.
// Extractors can add more at runtime; these are the baseline.
const SEED_EDGE_TYPES = [
  // structural — breaking changes propagate along these
  { name: 'imports', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'ES/CJS module import' },
  { name: 'exports', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Module export declaration' },
  { name: 'calls', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Function/method call' },
  { name: 'attaches', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Middleware/handler attachment (app.use, router.get)' },
  { name: 'extends', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Class inheritance' },
  { name: 'implements', category: 'structural', followsForBlastRadius: true, impliesStaleness: false, description: 'Interface implementation' },

  // data_flow — pipeline tracing follows these
  { name: 'queries_table', category: 'data_flow', followsForBlastRadius: false, impliesStaleness: false, description: 'SQL table access (SELECT/INSERT/UPDATE/DELETE)' },
  { name: 'reads_config', category: 'data_flow', followsForBlastRadius: false, impliesStaleness: false, description: 'Configuration value read' },
  { name: 'writes_to', category: 'data_flow', followsForBlastRadius: false, impliesStaleness: true, description: 'File/stream write operation' },
  { name: 'reads_from', category: 'data_flow', followsForBlastRadius: false, impliesStaleness: false, description: 'File/stream read operation' },
  { name: 'generates', category: 'data_flow', followsForBlastRadius: false, impliesStaleness: true, description: 'Script generates output file' },

  // documentary — staleness detection watches these
  { name: 'describes', category: 'documentary', followsForBlastRadius: false, impliesStaleness: true, description: 'Documentation describes a code entity' },
  { name: 'references', category: 'documentary', followsForBlastRadius: false, impliesStaleness: true, description: 'Inline code reference to a file/function' },
  { name: 'triggers', category: 'documentary', followsForBlastRadius: false, impliesStaleness: false, description: 'Command/skill invokes a script' },
  { name: 'documents', category: 'documentary', followsForBlastRadius: false, impliesStaleness: true, description: 'README/doc section covers a topic' },

  // informational — included in results but not weighted
  { name: 'mentions', category: 'informational', followsForBlastRadius: false, impliesStaleness: false, description: 'Ambiguous reference (informational only)' },
  { name: 'tags', category: 'informational', followsForBlastRadius: false, impliesStaleness: false, description: 'Metadata tag association' },
];

module.exports = { SEED_EDGE_TYPES };
