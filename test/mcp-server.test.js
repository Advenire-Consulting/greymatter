'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  McpError,
  BadRequestError,
  AmbiguousIdentifierError,
  GraphUnavailableError,
  SchemaVersionMismatchError,
  UnknownProjectError,
} = require('../lib/mcp/errors');

const { TOOLS } = require('../lib/mcp/tools');
const { PROMPTS } = require('../lib/mcp/prompts');

// ── Error classes ─────────────────────────────────────────────────────────────

describe('MCP error classes', () => {
  it('BadRequestError has correct code and jsonRpcCode', () => {
    const e = new BadRequestError('missing param');
    assert.equal(e.code, 'BAD_REQUEST');
    assert.equal(e.jsonRpcCode, -32602);
    assert.ok(e instanceof McpError);
    assert.ok(e instanceof Error);
    assert.equal(e.message, 'missing param');
  });

  it('AmbiguousIdentifierError has correct code and jsonRpcCode', () => {
    const e = new AmbiguousIdentifierError('ambiguous');
    assert.equal(e.code, 'AMBIGUOUS_OR_MISSING_LINE');
    assert.equal(e.jsonRpcCode, -32602);
    assert.ok(e instanceof McpError);
  });

  it('GraphUnavailableError has correct code and jsonRpcCode', () => {
    const e = new GraphUnavailableError('db missing');
    assert.equal(e.code, 'GRAPH_UNAVAILABLE');
    assert.equal(e.jsonRpcCode, -32000);
    assert.ok(e instanceof McpError);
  });

  it('SchemaVersionMismatchError has correct code and jsonRpcCode', () => {
    const e = new SchemaVersionMismatchError('version mismatch');
    assert.equal(e.code, 'SCHEMA_VERSION_MISMATCH');
    assert.equal(e.jsonRpcCode, -32000);
    assert.ok(e instanceof McpError);
  });

  it('UnknownProjectError has correct code and jsonRpcCode', () => {
    const e = new UnknownProjectError('unknown: foo');
    assert.equal(e.code, 'UNKNOWN_PROJECT');
    assert.equal(e.jsonRpcCode, -32602);
    assert.ok(e instanceof McpError);
  });
});

// ── Tool handler tests ────────────────────────────────────────────────────────

function findTool(name) {
  const t = TOOLS.find(t => t.name === name);
  assert.ok(t, `tool ${name} not found`);
  return t;
}

const BASE_STATUS = {
  graphDb: { path: '/tmp/g.db', schema_version: '3.1.0', total_nodes: 10, total_edges: 5, total_files: 3, last_scan_at: '2026-04-30T00:00:00Z' },
  labels: { total: 2, by_source: { heuristic: 2, llm: 0, manual: 0 }, stale_count: 0 },
  projects: [{ name: 'myproj', root_path: '/tmp/myproj', scanned_files: 3, node_count: 10, label_count: 2, last_scan_at: '2026-04-30T00:00:00Z' }],
};

const BUNDLE = {
  identifier: { kind: 'function', name: 'verifyToken', file: 'lib/auth.js', line: 42 },
  body: 'function verifyToken(token) { return true; }',
  labels: [{ source: 'heuristic', category: 'auth-step', descriptors: ['jwt'], confidence: 0.9, detector_id: 'js.jwt', summary: null }],
  outgoing: [{ kind: 'calls', target: 'parseToken', target_label: null }],
  incoming: [{ kind: 'called_by', source: 'loginHandler', source_label: null }],
};

describe('get_status tool', () => {
  const tool = findTool('get_status');
  const serverInfo = { name: 'greymatter-mcp', version: '0.1.0', started_at: '2026-04-30T00:00:00Z' };

  it('happy path returns server + graph_db + labels + projects', () => {
    const queries = { getStatus: () => BASE_STATUS };
    const result = tool.handler({}, { queries, serverInfo, dbError: null });
    assert.deepEqual(result.server, serverInfo);
    assert.ok(result.graph_db);
    assert.ok(result.labels);
    assert.ok(Array.isArray(result.projects));
  });

  it('when dbError is set, returns error shape without labels/projects', () => {
    const result = tool.handler({}, { queries: null, serverInfo, dbError: 'db missing', dbPath: '/tmp/g.db' });
    assert.deepEqual(result.server, serverInfo);
    assert.ok(result.graph_db.error);
    assert.equal(result.labels, undefined);
    assert.equal(result.projects, undefined);
  });
});

describe('get_project_overview tool', () => {
  const tool = findTool('get_project_overview');

  it('happy path returns project overview', () => {
    const overview = { project: 'myproj', recent_sessions: [], file_map: [], totals: { files: 3, nodes: 10, labeled_nodes: 0 } };
    const queries = { getProjectOverview: () => overview };
    const result = tool.handler({ project: 'myproj' }, { queries });
    assert.deepEqual(result, overview);
  });

  it('returns UnknownProjectError when project not found', () => {
    const queries = { getProjectOverview: () => null };
    assert.throws(
      () => tool.handler({ project: 'missing' }, { queries }),
      (e) => e instanceof UnknownProjectError
    );
  });

  it('throws BadRequestError when project is missing', () => {
    const queries = { getProjectOverview: () => null };
    assert.throws(
      () => tool.handler({}, { queries }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('get_node tool', () => {
  const tool = findTool('get_node');

  it('happy path returns identifier and body', () => {
    const queries = { getNodeBundle: () => BUNDLE };
    const result = tool.handler({ project: 'p', file: 'f.js', name: 'verifyToken' }, { queries });
    assert.deepEqual(result, { identifier: BUNDLE.identifier, body: BUNDLE.body });
  });

  it('returns null when node not found', () => {
    const queries = { getNodeBundle: () => null };
    const result = tool.handler({ project: 'p', file: 'f.js', name: 'missing' }, { queries });
    assert.equal(result, null);
  });

  it('throws BadRequestError when required args missing', () => {
    const queries = { getNodeBundle: () => null };
    assert.throws(
      () => tool.handler({ project: 'p', file: 'f.js' }, { queries }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('get_node_bundle tool', () => {
  const tool = findTool('get_node_bundle');

  it('happy path returns full bundle', () => {
    const queries = { getNodeBundle: () => BUNDLE };
    const result = tool.handler({ project: 'p', file: 'f.js', name: 'verifyToken' }, { queries });
    assert.deepEqual(result, BUNDLE);
  });

  it('returns null when node not found', () => {
    const queries = { getNodeBundle: () => null };
    const result = tool.handler({ project: 'p', file: 'f.js', name: 'missing' }, { queries });
    assert.equal(result, null);
  });

  it('throws BadRequestError when required args missing', () => {
    const queries = { getNodeBundle: () => null };
    assert.throws(
      () => tool.handler({ project: 'p' }, { queries }),
      (e) => e instanceof BadRequestError
    );
  });

  it('AmbiguousIdentifierError propagates from getNodeBundle', () => {
    const { AmbiguousIdentifierError: AE } = require('../lib/mcp/errors');
    const queries = { getNodeBundle: () => { throw new AE('ambiguous'); } };
    assert.throws(
      () => tool.handler({ project: 'p', file: 'f.js', name: 'x' }, { queries }),
      (e) => e instanceof AE
    );
  });
});

describe('walk_flow tool', () => {
  const tool = findTool('walk_flow');

  const FLOW = {
    start: { kind: 'function', name: 'loginHandler', file: 'routes/auth.js', line: 14 },
    steps: [
      { depth: 0, kind: 'function', name: 'loginHandler', file: 'routes/auth.js', line: 14, edge_in: null },
      { depth: 1, kind: 'function', name: 'verifyToken', file: 'lib/auth.js', line: 42, edge_in: 'calls' },
    ],
    truncated: false,
  };

  it('happy path returns flow', () => {
    const queries = { walkFlow: () => FLOW };
    const result = tool.handler({ project: 'p', file: 'routes/auth.js', name: 'loginHandler' }, { queries });
    assert.deepEqual(result, FLOW);
  });

  it('returns null when start node not found', () => {
    const queries = { walkFlow: () => null };
    const result = tool.handler({ project: 'p', file: 'f.js', name: 'missing' }, { queries });
    assert.equal(result, null);
  });

  it('throws BadRequestError when required args missing', () => {
    const queries = { walkFlow: () => null };
    assert.throws(
      () => tool.handler({ project: 'p', file: 'f.js' }, { queries }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('query_blast_radius tool', () => {
  const tool = findTool('query_blast_radius');

  it('happy path returns blast radius shape', () => {
    const mockDb = {
      prepare: (sql) => ({
        get: () => ({ file: 'lib/auth.js' }),
        all: (project, file, notFile) => {
          if (sql.includes('target_id')) return [{ file: 'lib/util.js' }];
          return [{ source_file: 'routes/auth.js' }];
        },
      }),
    };
    const queries = { graphDb: { db: mockDb } };
    const result = tool.handler({ project: 'p', file: 'lib/auth.js' }, { queries });
    assert.equal(result.file, 'lib/auth.js');
    assert.ok(Array.isArray(result.imports));
    assert.ok(Array.isArray(result.imported_by));
  });

  it('returns null when file not in scanned set', () => {
    const mockDb = {
      prepare: () => ({ get: () => null }),
    };
    const queries = { graphDb: { db: mockDb } };
    const result = tool.handler({ project: 'p', file: 'notscanned.js' }, { queries });
    assert.equal(result, null);
  });

  it('throws BadRequestError when required args missing', () => {
    const queries = { graphDb: { db: {} } };
    assert.throws(
      () => tool.handler({ project: 'p' }, { queries }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('find_identifier tool', () => {
  const tool = findTool('find_identifier');

  const NODES = [
    { project: 'p', file: 'lib/auth.js', name: 'verifyToken', type: 'function', line: 42 },
  ];

  it('happy path returns array of matches with kind field', () => {
    const queries = { findNodes: () => NODES, graphDb: { getProjectRoot: () => '/tmp/p' } };
    const result = tool.handler({ name: 'verifyToken' }, { queries });
    assert.ok(Array.isArray(result));
    assert.equal(result[0].kind, 'function');
  });

  it('returns [] when no matches', () => {
    const queries = { findNodes: () => [], graphDb: { getProjectRoot: () => null } };
    const result = tool.handler({ name: 'nothing' }, { queries });
    assert.deepEqual(result, []);
  });

  it('throws BadRequestError when name is missing', () => {
    const queries = { findNodes: () => [], graphDb: { getProjectRoot: () => null } };
    assert.throws(
      () => tool.handler({}, { queries }),
      (e) => e instanceof BadRequestError
    );
  });

  it('throws UnknownProjectError when project filter is unknown', () => {
    const queries = { findNodes: () => [], graphDb: { getProjectRoot: () => null } };
    assert.throws(
      () => tool.handler({ name: 'foo', project: 'noproject' }, { queries }),
      (e) => e instanceof UnknownProjectError
    );
  });
});

describe('get_label_coverage tool', () => {
  const tool = findTool('get_label_coverage');

  const COVERAGE = {
    scope: 'project',
    total_nodes: 10,
    labeled_count: 5,
    percent_labeled: 0.5,
    by_source: { heuristic: 5, llm: 0, manual: 0 },
  };

  it('happy path returns coverage stats', () => {
    const queries = { getLabelCoverage: () => COVERAGE };
    const result = tool.handler({ project: 'myproj' }, { queries });
    assert.deepEqual(result, COVERAGE);
  });

  it('project scope (file+name omitted) works', () => {
    const queries = { getLabelCoverage: () => COVERAGE };
    const result = tool.handler({ project: 'myproj' }, { queries });
    assert.ok(result);
  });

  it('throws BadRequestError when project is missing', () => {
    const queries = { getLabelCoverage: () => COVERAGE };
    assert.throws(
      () => tool.handler({}, { queries }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('grep_project tool', () => {
  const tool = findTool('grep_project');

  const MATCHES = [
    {
      file: 'lib/auth.js',
      matches: [{ line: 42, before: [], match: 'verifyToken', after: [] }],
    },
  ];

  it('happy path returns match array', () => {
    const deps = { grepProject: () => MATCHES };
    const result = tool.handler({ project: 'p', pattern: 'verifyToken' }, deps);
    assert.deepEqual(result, MATCHES);
  });

  it('returns [] when no matches', () => {
    const deps = { grepProject: () => [] };
    const result = tool.handler({ project: 'p', pattern: 'zzzz' }, deps);
    assert.deepEqual(result, []);
  });

  it('throws BadRequestError when project or pattern missing', () => {
    const deps = { grepProject: () => [] };
    assert.throws(
      () => tool.handler({ project: 'p' }, deps),
      (e) => e instanceof BadRequestError
    );
    assert.throws(
      () => tool.handler({ pattern: 'x' }, deps),
      (e) => e instanceof BadRequestError
    );
  });
});

// ── TOOLS array shape ─────────────────────────────────────────────────────────

describe('TOOLS array', () => {
  it('exports exactly 9 tools', () => {
    assert.equal(TOOLS.length, 9);
  });

  it('each tool has name, description, inputSchema, handler', () => {
    for (const t of TOOLS) {
      assert.ok(typeof t.name === 'string', `${t.name} missing name`);
      assert.ok(typeof t.description === 'string', `${t.name} missing description`);
      assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `${t.name} missing inputSchema`);
      assert.ok(typeof t.handler === 'function', `${t.name} missing handler`);
    }
  });
});

// ── Prompt handler tests ──────────────────────────────────────────────────────

function findPrompt(name) {
  const p = PROMPTS.find(p => p.name === name);
  assert.ok(p, `prompt ${name} not found`);
  return p;
}

describe('orient_project prompt', () => {
  const prompt = findPrompt('orient_project');

  it('returns string mentioning project, get_project_overview, get_status', () => {
    const text = prompt.handler({ project: 'register' });
    assert.ok(typeof text === 'string');
    assert.match(text, /register/);
    assert.match(text, /get_project_overview/);
    assert.match(text, /get_status/);
  });

  it('throws BadRequestError when project is missing', () => {
    assert.throws(
      () => prompt.handler({}),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('safe_to_delete prompt', () => {
  const prompt = findPrompt('safe_to_delete');

  it('returns string mentioning query_blast_radius, grep_project, and file basename', () => {
    const text = prompt.handler({ project: 'register', file: 'lib/auth/token.js' });
    assert.ok(typeof text === 'string');
    assert.match(text, /query_blast_radius/);
    assert.match(text, /grep_project/);
    assert.match(text, /token\.js/);
  });

  it('throws BadRequestError when project or file missing', () => {
    assert.throws(
      () => prompt.handler({ project: 'p' }),
      (e) => e instanceof BadRequestError
    );
    assert.throws(
      () => prompt.handler({ file: 'f.js' }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('understand_flow prompt', () => {
  const prompt = findPrompt('understand_flow');

  it('returns string mentioning walk_flow and get_node_bundle', () => {
    const text = prompt.handler({ project: 'p', file: 'routes/auth.js', name: 'loginHandler' });
    assert.ok(typeof text === 'string');
    assert.match(text, /walk_flow/);
    assert.match(text, /get_node_bundle/);
  });

  it('throws BadRequestError when required args missing', () => {
    assert.throws(
      () => prompt.handler({ project: 'p', file: 'f.js' }),
      (e) => e instanceof BadRequestError
    );
  });
});

describe('PROMPTS array', () => {
  it('exports exactly 3 prompts', () => {
    assert.equal(PROMPTS.length, 3);
  });

  it('each prompt has name, description, arguments, handler', () => {
    for (const p of PROMPTS) {
      assert.ok(typeof p.name === 'string', `${p.name} missing name`);
      assert.ok(typeof p.description === 'string', `${p.name} missing description`);
      assert.ok(Array.isArray(p.arguments), `${p.name} missing arguments`);
      assert.ok(typeof p.handler === 'function', `${p.name} missing handler`);
    }
  });
});
