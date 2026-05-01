'use strict';

// Import paths verified against @modelcontextprotocol/sdk@1.29.0 CJS exports:
//   require('@modelcontextprotocol/sdk/server')       → { Server }
//   require('@modelcontextprotocol/sdk/server/stdio.js') → { StdioServerTransport }
//   require('@modelcontextprotocol/sdk/types.js')     → { ListToolsRequestSchema, CallToolRequestSchema,
//                                                          ListPromptsRequestSchema, GetPromptRequestSchema, ... }

const errors = require('./errors');
const path = require('path');

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
function getNode({ project, file, name, line }, { queries }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  const bundle = queries.getNodeBundle(project, file, name, line ?? null);
  if (bundle === null) return null;
  return { identifier: bundle.identifier, body: bundle.body };
}

// spec L189-L216
function getNodeBundle({ project, file, name, line }, { queries }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  return queries.getNodeBundle(project, file, name, line ?? null);  // throws AmbiguousIdentifierError on its own
}

// spec L218-L238
function walkFlow({ project, file, name, max_depth }, { queries }) {
  if (!project || !file || !name) throw new errors.BadRequestError('project, file, name required');
  return queries.walkFlow(project, file, name, max_depth ?? 8);
}

// spec L240-L254 — compose imports + imported_by from direct DB queries
function queryBlastRadius({ project, file }, { queries }) {
  if (!project || !file) throw new errors.BadRequestError('project, file required');

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

  return {
    file,
    imports: importsRows.map(r => r.file),
    imported_by: importedByRows.map(r => r.source_file),
  };
}

// spec L256-L269
function findIdentifier({ name, project }, { queries }) {
  if (!name) throw new errors.BadRequestError('name required');
  if (project && !queries.graphDb.getProjectRoot(project)) {
    throw new errors.UnknownProjectError(`unknown project: ${project}`);
  }
  const nodes = queries.findNodes(name, project ?? null);
  return nodes.map(n => ({
    project: n.project,
    file: n.file,
    name: n.name,
    kind: n.type,    // DB stores as 'type'; spec calls it 'kind'
    line: n.line,
  }));
}

// spec L271-L298
function getLabelCoverage({ project, file, name }, { queries }) {
  if (!project) throw new errors.BadRequestError('project required');
  return queries.getLabelCoverage(project, file ?? null, name ?? null);
}

// spec L300-L323
function grepProjectTool({ project, pattern, options }, { grepProject }) {
  if (!project || !pattern) throw new errors.BadRequestError('project, pattern required');
  return grepProject(project, pattern, options ?? {});
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
