'use strict';

// Import paths verified against @modelcontextprotocol/sdk@1.29.0 CJS exports:
//   require('@modelcontextprotocol/sdk/server')       → { Server }
//   require('@modelcontextprotocol/sdk/server/stdio.js') → { StdioServerTransport }
//   require('@modelcontextprotocol/sdk/types.js')     → { ListToolsRequestSchema, CallToolRequestSchema,
//                                                          ListPromptsRequestSchema, GetPromptRequestSchema, ... }

const errors = require('./errors');
const path = require('path');
const { absolutePathFor } = require('./path-helpers');
const { isExcluded } = require('../exclusion');
const { redactContent } = require('../redaction');

// spec L108-L145
function getStatus(_args, deps) {
  const { queries, serverInfo, dbError, dbPath } = deps;
  if (dbError || !queries) {
    return {
      server: serverInfo,
      graph_db: { path: dbPath || null, error: dbError || 'Graph DB not available' },
    };
  }
  const data = queries.getStatus();
  return {
    server: serverInfo,
    graph_db: data.graphDb,   // queries returns camelCase; spec uses snake_case
    labels: data.labels,
    projects: data.projects,
  };
}

// spec L151-L171
function getProjectOverview({ project }, { queries }) {
  if (typeof project !== 'string' || !project) throw new errors.BadRequestError('project required');
  const r = queries.getProjectOverview(project);
  if (r === null) throw new errors.UnknownProjectError(`unknown project: ${project}`);
  return r;
}

// spec L173-L188 — composes trivially from getNodeBundle (same ambiguity logic, less data)
function getNode({ project, file, name, line }, { queries, graphDb, policy }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  const pol = policy ? policy(project) : null;
  const abs = graphDb ? absolutePathFor(graphDb, project, file) : null;
  if (pol && abs && isExcluded(abs, pol)) return { excluded: true, file, reason: 'path is excluded by policy' };
  const bundle = queries.getNodeBundle(project, file, name, line ?? null);
  if (bundle === null) return null;
  let body = bundle.body;
  if (body != null) {
    const r = redactContent(body);
    if (r.skipped) {
      return { identifier: bundle.identifier, body: null, body_redacted: true, body_skip_reason: r.reason };
    }
    body = r.text;
  }
  return { identifier: bundle.identifier, body };
}

// spec L189-L216
function getNodeBundle({ project, file, name, line }, { queries, graphDb, policy }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  const pol = policy ? policy(project) : null;
  const abs = graphDb ? absolutePathFor(graphDb, project, file) : null;
  if (pol && abs && isExcluded(abs, pol)) return { excluded: true, file, reason: 'path is excluded by policy' };

  const bundle = queries.getNodeBundle(project, file, name, line ?? null);
  if (!bundle) return null;

  // Filter outgoing/incoming edges pointing to excluded counterpart files
  const filterEdge = (e, fileField) => {
    const counterpartAbs = graphDb ? absolutePathFor(graphDb, project, e[fileField]) : null;
    return !counterpartAbs || !pol || !isExcluded(counterpartAbs, pol);
  };
  if (Array.isArray(bundle.outgoing)) bundle.outgoing = bundle.outgoing.filter(e => filterEdge(e, 'target_file'));
  if (Array.isArray(bundle.incoming)) bundle.incoming = bundle.incoming.filter(e => filterEdge(e, 'source_file'));

  // Redact body at egress boundary
  if (bundle.body != null) {
    const r = redactContent(bundle.body);
    if (r.skipped) {
      bundle.body = null;
      bundle.body_redacted = true;
      bundle.body_skip_reason = r.reason;
    } else {
      bundle.body = r.text;
      if (r.redactions.length) bundle.body_redactions = r.redactions.length;
    }
  }
  return bundle;
}

// spec L218-L238
function walkFlow({ project, file, name, max_depth }, { queries, graphDb, policy }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  const pol = policy ? policy(project) : null;
  const result = queries.walkFlow(project, file, name, max_depth ?? 8);
  if (!result) return null;
  if (pol && graphDb && Array.isArray(result.steps)) {
    result.steps = result.steps.filter(step => {
      if (!step.file) return true;
      const stepAbs = absolutePathFor(graphDb, project, step.file);
      return !stepAbs || !isExcluded(stepAbs, pol);
    });
  }
  return result;
}

// spec L240-L254 — compose imports + imported_by from direct DB queries
function queryBlastRadius({ project, file }, { queries, graphDb, policy }) {
  if (!project || !file) throw new errors.BadRequestError('project, file required');

  const pol = policy ? policy(project) : null;
  const abs = graphDb ? absolutePathFor(graphDb, project, file) : null;
  if (pol && abs && isExcluded(abs, pol)) return { excluded: true, file, reason: 'path is excluded by policy' };

  const db = queries.graphDb.db;

  // Check file is in scanned set
  const fileExists = db.prepare(
    'SELECT 1 FROM file_hashes WHERE project = ? AND file = ?'
  ).get(project, file);
  if (!fileExists) return null;

  // Files this file imports (outbound edge targets in other files)
  const importsRows = db.prepare(`
    SELECT DISTINCT n.file
    FROM edges e JOIN nodes n ON e.target_id = n.id
    WHERE e.source_project = ? AND e.source_file = ? AND n.file != ?
  `).all(project, file, file);

  // Files that import this file (inbound edge sources targeting nodes in this file)
  const importedByRows = db.prepare(`
    SELECT DISTINCT e.source_file
    FROM edges e JOIN nodes n ON e.target_id = n.id
    WHERE n.project = ? AND n.file = ? AND e.source_file != ?
  `).all(project, file, file);

  let imports = importsRows.map(r => r.file);
  let importedBy = importedByRows.map(r => r.source_file);

  if (graphDb && pol) {
    imports = imports.filter(f => {
      const a = absolutePathFor(graphDb, project, f);
      return !a || !isExcluded(a, pol);
    });
    importedBy = importedBy.filter(f => {
      const a = absolutePathFor(graphDb, project, f);
      return !a || !isExcluded(a, pol);
    });
  }

  return { file, imports, imported_by: importedBy };
}

// spec L256-L269
function findIdentifier({ name, project }, { queries, graphDb, policy }) {
  if (!name) throw new errors.BadRequestError('name required');
  if (project && !queries.graphDb.getProjectRoot(project)) {
    throw new errors.UnknownProjectError(`unknown project: ${project}`);
  }
  const nodes = queries.findNodes(name, project ?? null);
  const mapped = nodes.map(n => ({
    project: n.project,
    file: n.file,
    name: n.name,
    kind: n.type,    // DB stores as 'type'; spec calls it 'kind'
    line: n.line,
  }));
  if (!graphDb || !policy) return mapped;
  return mapped.filter(n => {
    const pol = policy(n.project);
    if (!pol) return true;
    const a = absolutePathFor(graphDb, n.project, n.file);
    return !a || !isExcluded(a, pol);
  });
}

// spec L271-L298
function getLabelCoverage({ project, file, name }, { queries, graphDb, policy }) {
  if (!project) throw new errors.BadRequestError('project required');
  if (file && graphDb && policy) {
    const pol = policy(project);
    const abs = absolutePathFor(graphDb, project, file);
    if (pol && abs && isExcluded(abs, pol)) return { excluded: true, file, reason: 'path is excluded by policy' };
  }
  return queries.getLabelCoverage(project, file ?? null, name ?? null);
}

// spec L300-L323
function grepProjectTool({ project, pattern, options }, { grepProject, policy }) {
  if (!project || !pattern) throw new errors.BadRequestError('project, pattern required');
  const pol = policy ? policy(project) : null;
  return grepProject(project, pattern, { ...(options ?? {}), policy: pol });
}

const TOOLS = [
  {
    name: 'get_status',
    description: 'Returns server health, graph DB stats, label coverage, and the project list. Call this first to orient in a new session and discover valid project names.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: getStatus,
  },
  {
    name: 'get_project_overview',
    description: 'Returns recent session activity, decision terms, files modified, and the full file map for a project. Consolidates --reorient and --map into one call.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name as returned by get_status' },
      },
      required: ['project'],
    },
    handler: getProjectOverview,
  },
  {
    name: 'get_node',
    description: 'Returns a single node\'s identifier, kind, and body. Returns null when the node is not found. Throws AMBIGUOUS_OR_MISSING_LINE when multiple symbols share the name and line is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        file: { type: 'string', description: 'Relative file path within the project' },
        name: { type: 'string', description: 'Symbol name' },
        line: { type: 'number', description: 'Line number to disambiguate when multiple symbols share the name' },
      },
      required: ['project', 'file', 'name'],
    },
    handler: getNode,
  },
  {
    name: 'get_node_bundle',
    description: 'Returns identifier, body, labels, and 1-hop incoming/outgoing edges for a node. The highest-leverage single tool. Returns null when not found. Throws AMBIGUOUS_OR_MISSING_LINE when name is ambiguous.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        file: { type: 'string' },
        name: { type: 'string' },
        line: { type: 'number', description: 'Disambiguate when multiple symbols share the name' },
        depth: { type: 'number', description: 'Hop depth (default 1; values >1 deferred)' },
      },
      required: ['project', 'file', 'name'],
    },
    handler: getNodeBundle,
  },
  {
    name: 'walk_flow',
    description: 'Returns a BFS path skeleton starting from the named node. Each step includes the identifier and the edge connecting it to the previous step. Use get_node_bundle to drill into specific steps.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        file: { type: 'string' },
        name: { type: 'string' },
        max_depth: { type: 'number', description: 'Max BFS depth (default 8)' },
      },
      required: ['project', 'file', 'name'],
    },
    handler: walkFlow,
  },
  {
    name: 'query_blast_radius',
    description: 'Returns the file\'s direct outgoing imports and incoming importers at the file level. Returns null when the file is not in the scanned set. Pair with grep_project to catch textual contracts.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        file: { type: 'string', description: 'Relative file path within the project' },
      },
      required: ['project', 'file'],
    },
    handler: queryBlastRadius,
  },
  {
    name: 'find_identifier',
    description: 'Returns all nodes matching the given name across all projects (or filtered to one). Returns [] when no matches exist.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to search for' },
        project: { type: 'string', description: 'Optional project filter' },
      },
      required: ['name'],
    },
    handler: findIdentifier,
  },
  {
    name: 'get_label_coverage',
    description: 'Returns label coverage stats. Polymorphic: project-wide when only project is given, file-scoped when file is added, neighborhood-scoped when name is also provided.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        file: { type: 'string', description: 'Optional: scope to a specific file' },
        name: { type: 'string', description: 'Optional: scope to the 1-hop neighborhood of this symbol' },
      },
      required: ['project'],
    },
    handler: getLabelCoverage,
  },
  {
    name: 'grep_project',
    description: 'Project-scoped text search returning matches with surrounding context. Uses greymatter\'s scanned file set rather than filesystem globbing. Returns [] when no matches.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        options: {
          type: 'object',
          description: 'Search options',
          properties: {
            context: { type: 'number', description: 'Lines of context on each side (default 3)' },
            max_per_file: { type: 'number', description: 'Max matches per file (default 20)' },
          },
        },
      },
      required: ['project', 'pattern'],
    },
    handler: grepProjectTool,
  },
];

module.exports = { TOOLS };
