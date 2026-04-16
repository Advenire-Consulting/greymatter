'use strict';

const Database = require('better-sqlite3');

/**
 * Build per-project session context summaries.
 * Reads recent sessions from memory.db, groups by project using
 * graph.db's known project roots, writes compact summaries to
 * graph.db's project_context table.
 *
 * @param {string} memoryDbPath — path to memory.db
 * @param {string} graphDbPath — path to graph.db
 * @param {object} [options]
 * @param {number} [options.sessionsPerProject=3] — how many recent sessions to keep per project
 * @param {number} [options.maxDecisions=5] — max decision summaries per session
 * @param {number} [options.maxFiles=8] — max files listed per session
 * @returns {{ projectCount: number, sessionCount: number }}
 */
function buildProjectContext(memoryDbPath, graphDbPath, options) {
  const opts = Object.assign({ sessionsPerProject: 3, maxDecisions: 5, maxFiles: 8 }, options);

  const memDb = new Database(memoryDbPath, { readonly: true });
  const graphDb = new Database(graphDbPath);
  graphDb.pragma('journal_mode = WAL');

  try {
    // Ensure table exists (idempotent for scan.js path where graph-db.js may not have run yet)
    graphDb.exec(`
      CREATE TABLE IF NOT EXISTS project_context (
          project TEXT PRIMARY KEY,
          context_json TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get known project roots from graph.db
    const projects = graphDb.prepare('SELECT DISTINCT project FROM nodes').all().map(r => r.project);
    if (projects.length === 0) return { projectCount: 0, sessionCount: 0 };

    // Build a workspace prefix map: project name → directory prefix in file paths.
    // window_files stores absolute paths like /home/user/websites/sonder-runtime/lib/foo.js
    // We need to match these to project names. Get a sample file path per project to
    // extract the workspace root.
    const projectPrefixes = new Map();
    for (const project of projects) {
      const sample = graphDb.prepare(
        'SELECT file FROM nodes WHERE project = ? LIMIT 1'
      ).get(project);
      if (!sample) continue;
      // graph.db stores project-relative paths. We need the absolute workspace path.
      // The workspace is typically CWD — infer from the memory.db file paths.
      // We'll match by checking if any window_files path contains /<project>/ as a segment.
      projectPrefixes.set(project, '/' + project + '/');
    }

    // Get all sessions with their window_files and decisions
    const sessions = memDb.prepare(
      'SELECT id, start_time FROM sessions ORDER BY start_time DESC'
    ).all();

    // Map: project → [{ session_id, date, decisions[], files[] }]
    const projectSessions = new Map();
    for (const project of projects) projectSessions.set(project, []);

    for (const session of sessions) {
      // Get all file paths touched in this session
      const filePaths = memDb.prepare(`
        SELECT DISTINCT wf.file_path
        FROM window_files wf
        JOIN windows w ON wf.window_id = w.id
        WHERE w.session_id = ?
      `).all(session.id).map(r => r.file_path);

      // Determine which projects this session touched
      const touchedProjects = new Set();
      const projectFilesMap = new Map(); // project → [relative paths]

      for (const fp of filePaths) {
        if (!fp) continue;
        for (const [project, prefix] of projectPrefixes) {
          const idx = fp.indexOf(prefix);
          if (idx !== -1) {
            touchedProjects.add(project);
            if (!projectFilesMap.has(project)) projectFilesMap.set(project, []);
            // Extract project-relative path
            const relPath = fp.substring(idx + prefix.length);
            if (relPath) projectFilesMap.get(project).push(relPath);
          }
        }
      }

      if (touchedProjects.size === 0) continue;

      // Get decisions for this session
      const decisions = memDb.prepare(`
        SELECT d.terms, d.summary, d.file_anchors
        FROM decisions d
        JOIN windows w ON d.window_id = w.id
        WHERE w.session_id = ?
        ORDER BY w.seq, d.seq
      `).all(session.id);

      // Prefer the `terms` column (clean comma list). `summary` is "terms — file-anchor"
      // format; used as a fallback only for legacy rows that never populated `terms`
      // but DO contain an em-dash (so we can cleanly separate terms from file anchors).
      // Rows with empty `terms` and no em-dash are skipped — the upstream extractor
      // declined to produce decision terms, so the summary is typically just filenames.
      const termCounts = new Map();
      for (const d of decisions) {
        let raw = d.terms;
        if (!raw) {
          const summary = d.summary || '';
          if (!summary.includes('—')) continue;
          raw = summary.split('—')[0];
        }
        const terms = String(raw).split(',').map(t => t.trim()).filter(Boolean);
        for (const term of terms) {
          termCounts.set(term, (termCounts.get(term) || 0) + 1);
        }
      }

      // Top N terms by frequency
      const topTerms = [...termCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, opts.maxDecisions)
        .map(([term]) => term);

      // Build per-project entry for this session
      const dateStr = session.start_time
        ? session.start_time.substring(0, 10)
        : null;

      for (const project of touchedProjects) {
        const list = projectSessions.get(project);
        if (!list || list.length >= opts.sessionsPerProject) continue;

        // Get top files for this project by frequency
        const pFiles = projectFilesMap.get(project) || [];
        const fileCounts = new Map();
        for (const f of pFiles) fileCounts.set(f, (fileCounts.get(f) || 0) + 1);
        const topFiles = [...fileCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, opts.maxFiles)
          .map(([f]) => f);

        list.push({
          session_id: session.id,
          date: dateStr,
          decisions: topTerms,
          files: topFiles,
        });
      }
    }

    // Write to graph.db
    const upsert = graphDb.prepare(`
      INSERT INTO project_context (project, context_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(project) DO UPDATE SET
        context_json = excluded.context_json,
        updated_at = excluded.updated_at
    `);

    let projectCount = 0;
    let sessionCount = 0;

    const writeAll = graphDb.transaction(() => {
      for (const [project, entries] of projectSessions) {
        if (entries.length === 0) continue;
        upsert.run(project, JSON.stringify(entries));
        projectCount++;
        sessionCount += entries.length;
      }
    });

    writeAll();
    return { projectCount, sessionCount };

  } finally {
    memDb.close();
    graphDb.close();
  }
}

/**
 * Read pre-computed context for a project.
 * Returns parsed array or null if no context exists.
 *
 * @param {string} graphDbPath
 * @param {string} project
 * @returns {Array|null}
 */
function getProjectContext(graphDbPath, project) {
  const db = new Database(graphDbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT context_json FROM project_context WHERE project = ?').get(project);
    if (!row) return null;
    try { return JSON.parse(row.context_json); } catch { return null; }
  } finally {
    db.close();
  }
}

/**
 * List all projects with context and their most recent session date.
 *
 * @param {string} graphDbPath
 * @returns {Array<{ project: string, lastDate: string, sessionCount: number }>}
 */
function listProjectContexts(graphDbPath) {
  const db = new Database(graphDbPath, { readonly: true });
  try {
    const rows = db.prepare('SELECT project, context_json FROM project_context ORDER BY project').all();
    return rows.map(r => {
      let entries;
      try { entries = JSON.parse(r.context_json); } catch { entries = []; }
      return {
        project: r.project,
        lastDate: entries.length > 0 ? entries[0].date : null,
        sessionCount: entries.length,
      };
    });
  } finally {
    db.close();
  }
}

module.exports = { buildProjectContext, getProjectContext, listProjectContexts };
