'use strict';

// Escapes LIKE wildcards in user-supplied search terms
function escapeLike(str) {
  return str.replace(/[%_]/g, c => '\\' + c);
}

class GraphQueries {
  constructor(graphDb) {
    this.graphDb = graphDb;
    this.db = graphDb.db;
  }

  // Returns [{file, nodes: [{name, type, line}]}] for all files in a project
  getProjectMap(project) {
    const rows = this.db.prepare(`
      SELECT file, name, type, line
      FROM nodes
      WHERE project = ?
      ORDER BY file, line
    `).all(project);

    const fileMap = new Map();
    for (const row of rows) {
      if (!fileMap.has(row.file)) fileMap.set(row.file, []);
      fileMap.get(row.file).push({ name: row.name, type: row.type, line: row.line });
    }

    return Array.from(fileMap.entries()).map(([file, nodes]) => ({ file, nodes }));
  }

  // Finds nodes by name. Optional project filter. Exact match first, then prefix.
  findNodes(name, project = null) {
    const params = project ? [name, project] : [name];
    const projectClause = project ? 'AND project = ?' : '';

    const exact = this.db.prepare(`
      SELECT id, project, file, name, type, line, metadata_json FROM nodes WHERE name = ? ${projectClause} ORDER BY project, file, line
    `).all(...params);

    if (exact.length > 0) return exact;

    const prefixParams = project ? [`${escapeLike(name)}%`, project] : [`${escapeLike(name)}%`];
    return this.db.prepare(`
      SELECT id, project, file, name, type, line, metadata_json FROM nodes WHERE name LIKE ? ESCAPE '\\' ${projectClause} ORDER BY project, file, line
    `).all(...prefixParams);
  }

  // Returns all nodes in a specific file
  getFileNodes(project, file) {
    return this.db.prepare(`
      SELECT id, name, type, line, metadata_json FROM nodes WHERE project = ? AND file = ? ORDER BY line
    `).all(project, file);
  }

  // BFS following inbound structural edges. Returns dependent files (depth limit 3).
  getBlastRadius(project, file) {
    const visited = new Set([file]);
    const result = [];
    let frontier = [file];

    const getInboundSources = this.db.prepare(`
      SELECT DISTINCT e.source_file as file, e.source_project as project
      FROM edges e
      JOIN nodes n ON e.target_id = n.id
      JOIN edge_types et ON e.type = et.name
      WHERE n.project = ? AND n.file = ? AND et.follows_for_blast_radius = 1
    `);

    for (let depth = 0; depth < 3; depth++) {
      const nextFrontier = [];
      for (const f of frontier) {
        const sources = getInboundSources.all(project, f);
        for (const src of sources) {
          if (!visited.has(src.file)) {
            visited.add(src.file);
            result.push(src);
            nextFrontier.push(src.file);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return result;
  }

  // Returns all edges flowing in and out of a file's nodes
  getFileFlow(project, file) {
    const outbound = this.db.prepare(`
      SELECT id, source_id, target_id, type, category, source_project, source_file, data_json, sequence FROM edges WHERE source_project = ? AND source_file = ?
    `).all(project, file);

    const inbound = this.db.prepare(`
      SELECT e.id, e.source_id, e.target_id, e.type, e.category, e.source_project, e.source_file, e.data_json, e.sequence FROM edges e
      JOIN nodes n ON e.target_id = n.id
      WHERE n.project = ? AND n.file = ?
    `).all(project, file);

    return { inbound, outbound };
  }

  // Find a node by name, get all edges where it is source or target
  traceIdentifier(name, project = null) {
    const params = project ? [name, project] : [name];
    const projectClause = project ? 'AND project = ?' : '';

    const node = this.db.prepare(`
      SELECT id, project, file, name, type, line, metadata_json FROM nodes WHERE name = ? ${projectClause} LIMIT 1
    `).get(...params);

    if (!node) return { node: null, edges: [] };

    const outEdges = this.db.prepare(`SELECT id, source_id, target_id, type, category, source_project, source_file, data_json, sequence FROM edges WHERE source_id = ?`).all(node.id);
    const inEdges = this.db.prepare(`SELECT id, source_id, target_id, type, category, source_project, source_file, data_json, sequence FROM edges WHERE target_id = ?`).all(node.id);

    return { node, edges: [...outEdges, ...inEdges] };
  }

  // Returns node definitions ordered by line number
  getStructure(project, file) {
    return this.db.prepare(`
      SELECT name, type, line, metadata_json FROM nodes
      WHERE project = ? AND file = ?
      ORDER BY COALESCE(line, 0)
    `).all(project, file);
  }

  // Returns nodes of db-related types (tables, columns, indexes)
  getSchema(project) {
    const projectClause = project ? 'WHERE project = ? AND type IN (\'table\', \'column\', \'index\')' : 'WHERE type IN (\'table\', \'column\', \'index\')';
    const params = project ? [project] : [];
    return this.db.prepare(`SELECT id, project, file, name, type, line, metadata_json FROM nodes ${projectClause} ORDER BY file, line`).all(...params);
  }

  // Returns distinct project names
  listProjects() {
    const rows = this.db.prepare(`SELECT DISTINCT project FROM nodes ORDER BY project`).all();
    return rows.map(r => r.project);
  }

  // Returns [{name, root_path}] — root_path may be null for projects scanned
  // before the root_path column existed. LEFT JOIN so nodes-only projects
  // still appear.
  listProjectsWithRoots() {
    const rows = this.db.prepare(`
      SELECT DISTINCT n.project AS name, s.root_path AS root_path
      FROM nodes n
      LEFT JOIN project_scan_state s ON s.project = n.project
      ORDER BY n.project
    `).all();
    return rows;
  }

  // Returns annotations for a node
  getNodeAnnotations(nodeId) {
    return this.db.prepare(`
      SELECT id, node_id, content, author, created_at FROM annotations WHERE node_id = ? ORDER BY created_at
    `).all(nodeId);
  }
}

module.exports = { GraphQueries };
