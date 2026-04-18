'use strict';
const Database = require('better-sqlite3');
const { tokenize } = require('./tokenize');

class MemoryDB {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
    this._prepareStatements();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        start_time DATETIME,
        end_time DATETIME,
        projects_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        seq INTEGER NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        start_time DATETIME,
        end_time DATETIME,
        scope TEXT,
        summary TEXT,
        boundary_type TEXT DEFAULT 'compact',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS conversation_content (
        window_id INTEGER PRIMARY KEY REFERENCES windows(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        format TEXT DEFAULT 'jsonl',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS window_files (
        window_id INTEGER NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        lines INTEGER,
        tool TEXT,
        UNIQUE(window_id, file_path)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        window_id INTEGER NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
        seq INTEGER,
        summary TEXT NOT NULL,
        terms TEXT,
        file_anchors TEXT,
        status TEXT DEFAULT 'active',
        start_line INTEGER,
        end_line INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        user_terms, assistant_terms, content=''
      );

      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('amygdala', 'nucleus_accumbens', 'prefrontal', 'hippocampus')),
        weight REAL NOT NULL DEFAULT 50,
        polarity TEXT NOT NULL CHECK(polarity IN ('+', '-')),
        label TEXT NOT NULL,
        description TEXT,
        context TEXT,
        file_pattern TEXT,
        trigger TEXT DEFAULT 'passive',
        archived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS forces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        score REAL NOT NULL DEFAULT 50,
        archived BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alias TEXT NOT NULL,
        project TEXT NOT NULL,
        file TEXT,
        source TEXT DEFAULT 'seed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(alias, project)
      );

      CREATE TABLE IF NOT EXISTS ingested_files (
        file_path TEXT PRIMARY KEY,
        file_size INTEGER,
        ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stopword_candidates (
        term TEXT PRIMARY KEY,
        noise_count INTEGER DEFAULT 0,
        relevant_count INTEGER DEFAULT 0,
        promoted BOOLEAN DEFAULT 0,
        last_seen DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_windows_session ON windows(session_id);
      CREATE INDEX IF NOT EXISTS idx_window_files_window ON window_files(window_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_window ON decisions(window_id);
      CREATE INDEX IF NOT EXISTS idx_signals_trigger ON signals(trigger, archived);
      CREATE INDEX IF NOT EXISTS idx_signals_weight ON signals(weight);
      CREATE INDEX IF NOT EXISTS idx_aliases_project ON aliases(project);

      CREATE TABLE IF NOT EXISTS test_alert_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        sha TEXT,
        mode TEXT NOT NULL CHECK(mode IN ('incremental', 'audit')),
        ran_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        findings_json TEXT NOT NULL,
        open_count INTEGER NOT NULL,
        resolved_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_test_alert_runs_project
        ON test_alert_runs(project, ran_at DESC);
    `);

    // Idempotent migration for pre-existing databases lacking boundary_type column.
    try {
      this.db.exec("ALTER TABLE windows ADD COLUMN boundary_type TEXT DEFAULT 'compact'");
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }

  _prepareStatements() {
    this._stmts = {
      insertSession: this.db.prepare(
        'INSERT OR IGNORE INTO sessions (id, start_time, projects_json) VALUES (?, ?, ?)'
      ),
      insertSignal: this.db.prepare(
        'INSERT INTO signals (type, weight, polarity, label, description, context, file_pattern, trigger) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      updateSignalWeight: this.db.prepare(
        'UPDATE signals SET weight = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ),
      archiveSignal: this.db.prepare(
        'UPDATE signals SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ),
      insertForce: this.db.prepare(
        'INSERT INTO forces (name, description, score) VALUES (?, ?, ?)'
      ),
      updateForceScore: this.db.prepare(
        'UPDATE forces SET score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ),
      archiveForce: this.db.prepare(
        'UPDATE forces SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ),
      insertWindow: this.db.prepare(
        'INSERT INTO windows (session_id, seq, start_line, end_line, start_time, end_time, scope, summary, boundary_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      insertConversationContent: this.db.prepare(
        'INSERT OR REPLACE INTO conversation_content (window_id, content) VALUES (?, ?)'
      ),
      insertWindowFile: this.db.prepare(
        'INSERT OR IGNORE INTO window_files (window_id, file_path, lines, tool) VALUES (?, ?, ?, ?)'
      ),
      insertDecision: this.db.prepare(
        'INSERT INTO decisions (window_id, seq, summary, terms, file_anchors, status, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      markFileIngested: this.db.prepare(
        'INSERT OR REPLACE INTO ingested_files (file_path, file_size) VALUES (?, ?)'
      ),
      isFileIngested: this.db.prepare(
        'SELECT 1 FROM ingested_files WHERE file_path = ?'
      ),
      insertAlias: this.db.prepare(
        'INSERT OR IGNORE INTO aliases (alias, project, file, source) VALUES (?, ?, ?, ?)'
      ),
      insertSearchTerms: this.db.prepare(
        'INSERT INTO search_index(rowid, user_terms, assistant_terms) VALUES (?, ?, ?)'
      ),
    };
    this._stmtInsertTestAlertRun = this.db.prepare(`
      INSERT INTO test_alert_runs
        (project, sha, mode, findings_json, open_count, resolved_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  insertSession(id, startTime, projects) {
    const projectsJson = JSON.stringify(Array.isArray(projects) ? projects : []);
    this._stmts.insertSession.run(id, startTime || null, projectsJson);
  }

  insertWindow(sessionId, seq, data) {
    const d = data || {};
    const result = this._stmts.insertWindow.run(
      sessionId,
      seq,
      d.startLine != null ? d.startLine : null,
      d.endLine != null ? d.endLine : null,
      d.startTime || null,
      d.endTime || null,
      d.scope || null,
      d.summary || null,
      d.boundaryType || 'compact'
    );
    return result.lastInsertRowid;
  }

  insertConversationContent(windowId, content) {
    this._stmts.insertConversationContent.run(windowId, content);
  }

  insertWindowFiles(windowId, files) {
    const stmt = this._stmts.insertWindowFile;
    const insert = this.db.transaction((rows) => {
      for (const f of rows) {
        stmt.run(
          windowId,
          f.filePath || f.file_path || '',
          f.lines != null ? f.lines : null,
          f.tool || null
        );
      }
    });
    insert(files);
  }

  insertDecisions(windowId, decisions) {
    const stmt = this._stmts.insertDecision;
    const insert = this.db.transaction((rows) => {
      for (const d of rows) {
        const terms = d.terms
          ? (Array.isArray(d.terms) ? d.terms.join(',') : d.terms)
          : null;
        const fileAnchors = d.fileAnchors
          ? (Array.isArray(d.fileAnchors) ? JSON.stringify(d.fileAnchors) : d.fileAnchors)
          : null;
        stmt.run(
          windowId,
          d.seq != null ? d.seq : null,
          d.summary,
          terms,
          fileAnchors,
          d.status || 'active',
          d.startLine != null ? d.startLine : null,
          d.endLine != null ? d.endLine : null
        );
      }
    });
    insert(decisions);
  }

  markFileIngested(filePath, fileSize) {
    this._stmts.markFileIngested.run(filePath, fileSize != null ? fileSize : null);
  }

  isFileIngested(filePath) {
    return !!this._stmts.isFileIngested.get(filePath);
  }

  insertAlias(alias, project, file, source) {
    this._stmts.insertAlias.run(alias, project, file || null, source || 'seed');
  }

  insertSearchTerms(windowId, userTerms, assistantTerms) {
    const userStr = Array.isArray(userTerms) ? userTerms.join(' ') : (userTerms || '');
    const assistantStr = Array.isArray(assistantTerms) ? assistantTerms.join(' ') : (assistantTerms || '');
    if (!userStr && !assistantStr) return;
    this._stmts.insertSearchTerms.run(windowId, userStr, assistantStr);
  }

  insertSignal({ type, weight, polarity, label, description, context, filePattern, trigger }) {
    const result = this._stmts.insertSignal.run(
      type,
      weight != null ? weight : 50,
      polarity,
      label,
      description || null,
      context || null,
      filePattern || null,
      trigger || 'passive'
    );
    return result.lastInsertRowid;
  }

  updateSignalWeight(id, newWeight) {
    this._stmts.updateSignalWeight.run(newWeight, id);
  }

  archiveSignal(id) {
    this._stmts.archiveSignal.run(id);
  }

  insertForce({ name, description, score }) {
    const result = this._stmts.insertForce.run(
      name,
      description || null,
      score != null ? score : 50
    );
    return result.lastInsertRowid;
  }

  updateForceScore(id, newScore) {
    this._stmts.updateForceScore.run(newScore, id);
  }

  archiveForce(id) {
    this._stmts.archiveForce.run(id);
  }

  rebuildSearchIndex() {
    this.db.exec('DELETE FROM search_index');
    const windows = this.db.prepare('SELECT id FROM windows').all();
    const getContent = this.db.prepare('SELECT content FROM conversation_content WHERE window_id = ?');
    const insertFts = this._stmts.insertSearchTerms;
    const rebuild = this.db.transaction(() => {
      for (const win of windows) {
        const row = getContent.get(win.id);
        if (!row) continue;
        const userTexts = [];
        const assistantTexts = [];
        for (const line of row.content.split('\n')) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type === 'user' && obj.message) {
            const c = obj.message.content;
            const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : '';
            if (t) userTexts.push(t);
          } else if (obj.type === 'assistant' && obj.message) {
            const c = obj.message.content;
            const t = Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ') : '';
            if (t) assistantTexts.push(t);
          }
        }
        // Use shared tokenizer — dedup within each category
        const uTokens = [...new Set(tokenize(userTexts.join(' ')))];
        const aTokens = [...new Set(tokenize(assistantTexts.join(' ')))];
        const uStr = uTokens.join(' ');
        const aStr = aTokens.join(' ');
        if (uStr || aStr) insertFts.run(win.id, uStr, aStr);
      }
    });
    rebuild();
  }

  insertTestAlertRun({ project, sha, mode, findingsJson, openCount, resolvedCount }) {
    const result = this._stmtInsertTestAlertRun.run(
      project, sha, mode, findingsJson, openCount, resolvedCount
    );
    return Number(result.lastInsertRowid);
  }

  close() {
    this.db.close();
  }
}

module.exports = { MemoryDB };
