'use strict';
const fs = require('fs');
const path = require('path');
const { tokenize, extractTerms } = require('./tokenize');

// Extract file path from a tool_use block's input.
function getToolFilePath(input) {
  if (!input) return null;
  return input.file_path || input.path || null;
}

// Extract text content from a message content field (string or block array).
function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join(' ');
  }
  return '';
}

// ---- Decision detection (ported from CC2, simplified) ----

const EXPLORE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Bash']);
const WRITE_TOOLS = new Set(['Write', 'Edit']);

function detectDecisions(lines, startIdx, endIdx) {
  const decisions = [];
  let exploredFiles = new Set();
  let userTexts = [];
  let blockStart = startIdx;
  let hasDiscussion = false;
  let writeAnchors = [];

  for (let i = startIdx; i <= endIdx && i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // Malformed JSONL line — expected, skip

    // Handle nested tool_use in assistant messages (real CC2 format)
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block.type !== 'tool_use') continue;
        const fp = getToolFilePath(block.input);
        if (EXPLORE_TOOLS.has(block.name) && fp) {
          exploredFiles.add(fp);
        }
        if (WRITE_TOOLS.has(block.name) && fp) {
          if (exploredFiles.has(fp) || exploredFiles.size > 0) {
            writeAnchors.push(fp);
            const terms = extractTerms(userTexts);
            if (terms.length > 0 || writeAnchors.length > 0) {
              decisions.push({
                seq: decisions.length,
                summary: buildSummary(terms, writeAnchors),
                terms,
                fileAnchors: [...writeAnchors],
                status: 'decided',
                startLine: blockStart,
                endLine: i,
              });
            }
            exploredFiles = new Set();
            userTexts = [];
            writeAnchors = [];
            blockStart = i + 1;
            hasDiscussion = false;
          } else {
            writeAnchors.push(fp);
          }
        }
      }
    }

    // Handle top-level tool_use (fixture / simplified format)
    if (obj.type === 'tool_use' && obj.input) {
      const fp = getToolFilePath(obj.input);
      if (EXPLORE_TOOLS.has(obj.name) && fp) {
        exploredFiles.add(fp);
      }
      if (WRITE_TOOLS.has(obj.name) && fp) {
        writeAnchors.push(fp);
        if (exploredFiles.has(fp) || exploredFiles.size > 0) {
          const terms = extractTerms(userTexts);
          if (terms.length > 0 || writeAnchors.length > 0) {
            decisions.push({
              seq: decisions.length,
              summary: buildSummary(terms, writeAnchors),
              terms,
              fileAnchors: [...writeAnchors],
              status: 'decided',
              startLine: blockStart,
              endLine: i,
            });
          }
          exploredFiles = new Set();
          userTexts = [];
          writeAnchors = [];
          blockStart = i + 1;
          hasDiscussion = false;
        }
      }
    }

    // Collect user text
    if ((obj.type === 'user' || obj.type === 'human') && obj.message) {
      const text = extractMessageText(obj.message.content || obj.message);
      if (text && text.trim().length > 0) {
        userTexts.push(text);
        hasDiscussion = true;
      }
    }
  }

  // Trailing window with discussion but no write
  if (hasDiscussion && userTexts.length > 0) {
    const terms = extractTerms(userTexts);
    if (terms.length > 0) {
      decisions.push({
        seq: decisions.length,
        summary: buildSummary(terms, writeAnchors.length > 0 ? writeAnchors : null),
        terms,
        fileAnchors: writeAnchors.length > 0 ? writeAnchors : null,
        status: writeAnchors.length > 0 ? 'decided' : 'parked',
        startLine: blockStart,
        endLine: endIdx,
      });
    }
  }

  return decisions;
}

function buildSummary(terms, fileAnchors) {
  const termPart = (terms || []).slice(0, 4).join(', ');
  if (!fileAnchors || fileAnchors.length === 0) return termPart || '(discussion)';
  const fileNames = fileAnchors.map(f => f.split('/').pop());
  const uniqueFiles = [...new Set(fileNames)];
  return (termPart ? termPart + ' — ' : '') + uniqueFiles.join(', ');
}

// ---- File path extraction from any JSONL line ----

function extractFilePathsFromLine(obj) {
  const results = [];
  // Top-level tool_use
  if (obj.type === 'tool_use' && obj.input) {
    const fp = getToolFilePath(obj.input);
    if (fp) results.push({ filePath: fp, tool: obj.name || '' });
  }
  // Nested tool_use in assistant message
  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'tool_use' && block.input) {
        const fp = getToolFilePath(block.input);
        if (fp) results.push({ filePath: fp, tool: block.name || '' });
      }
    }
  }
  return results;
}

// ---- Window boundary detection (synchronous) ----

function detectWindows(lines) {
  let firstTimestamp = null;
  let lastTimestamp = null;
  const boundaryIndices = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // Malformed JSONL line — expected, skip

    const ts = obj.timestamp || null;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
    }
    if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
      // Detect clear vs compact trigger from compactMetadata
      const trigger = obj.compactMetadata && obj.compactMetadata.trigger;
      const nextBoundaryType = trigger === 'clear' ? 'clear' : 'compact';
      boundaryIndices.push({ idx: i, timestamp: ts, nextBoundaryType });
    }
  }

  const totalLines = lines.length;

  if (boundaryIndices.length === 0) {
    return [{
      seq: 0,
      startLine: 0,
      endLine: totalLines - 1,
      startTime: firstTimestamp,
      endTime: lastTimestamp,
      boundaryType: 'session_start',
    }];
  }

  const windows = [];

  // First window — always session_start
  windows.push({
    seq: 0,
    startLine: 0,
    endLine: boundaryIndices[0].idx,
    startTime: firstTimestamp,
    endTime: boundaryIndices[0].timestamp,
    boundaryType: 'session_start',
  });

  // Middle windows — boundary_type from the boundary that STARTED them
  for (let i = 0; i < boundaryIndices.length - 1; i++) {
    windows.push({
      seq: i + 1,
      startLine: boundaryIndices[i].idx + 1,
      endLine: boundaryIndices[i + 1].idx,
      startTime: null,
      endTime: boundaryIndices[i + 1].timestamp,
      boundaryType: boundaryIndices[i].nextBoundaryType,
    });
  }

  // Final window — started by the last boundary
  const lastB = boundaryIndices[boundaryIndices.length - 1];
  windows.push({
    seq: boundaryIndices.length,
    startLine: lastB.idx + 1,
    endLine: totalLines - 1,
    startTime: null,
    endTime: lastTimestamp,
    boundaryType: lastB.nextBoundaryType,
  });

  // Fill missing startTimes for post-boundary windows
  for (const win of windows) {
    if (win.startTime !== null) continue;
    for (let i = win.startLine; i <= win.endLine; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.timestamp) { win.startTime = obj.timestamp; break; }
      } catch { /* Malformed line — skip */ }
    }
  }

  return windows;
}

// ---- Public API ----

/**
 * Scan a directory for JSONL conversation files.
 * Returns an array of absolute file paths.
 */
function scanForSessions(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f));
  } catch (err) {
    process.stderr.write(`greymatter: scanForSessions: ${err.message}\n`);
    return [];
  }
}

/**
 * Ingest a single JSONL conversation file into memory.db.
 *
 * Returns { skipped: true, windowsCreated: 0 } if already ingested.
 * Returns { skipped: false, windowsCreated: N } on success.
 */
function ingestSession(jsonlPath, memoryDb) {
  if (memoryDb.isFileIngested(jsonlPath)) {
    return { skipped: true, windowsCreated: 0 };
  }

  let rawText;
  try {
    rawText = fs.readFileSync(jsonlPath, 'utf-8');
  } catch {
    return { skipped: false, windowsCreated: 0, error: 'unreadable' };
  }

  const fileSize = Buffer.byteLength(rawText, 'utf-8');
  const lines = rawText.split('\n');

  // Extract session metadata from summary line
  let sessionId = path.basename(jsonlPath, '.jsonl');
  let cwd = null;
  let firstTimestamp = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; } // Malformed JSONL line — skip

    if (obj.type === 'summary' && obj.session_id) {
      sessionId = obj.session_id;
      cwd = obj.cwd || null;
    }
    if (obj.timestamp && !firstTimestamp) {
      firstTimestamp = obj.timestamp;
    }
    if (obj.type === 'result' && obj.session_id && !sessionId) {
      sessionId = obj.session_id;
    }
  }

  const windows = detectWindows(lines);

  // Determine projects touched (use cwd basename as a rough signal)
  const projects = [];
  if (cwd) {
    const projectName = path.basename(cwd);
    if (projectName) projects.push(projectName);
  }

  // Wrap all DB writes in a single transaction — crash-safe
  let windowsCreated = 0;
  const doIngest = memoryDb.db.transaction(() => {
    memoryDb.insertSession(sessionId, firstTimestamp, projects);

  for (const win of windows) {
    // Collect raw JSONL content for this window
    const windowLines = lines.slice(win.startLine, win.endLine + 1);
    const contentText = windowLines.join('\n');

    // Collect file paths touched in this window
    const fileMap = new Map(); // filePath → tool (last tool wins)
    for (const line of windowLines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; } // Malformed JSONL line — expected, skip
      for (const { filePath, tool } of extractFilePathsFromLine(obj)) {
        fileMap.set(filePath, tool);
      }
    }

    // Run decision detection
    const decisions = detectDecisions(lines, win.startLine, win.endLine);

    // Determine scope from first project or decisions
    const scope = projects.length > 0 ? projects[0] : null;

    // Insert window
    const winId = memoryDb.insertWindow(sessionId, win.seq, {
      startLine: win.startLine,
      endLine: win.endLine,
      startTime: win.startTime,
      endTime: win.endTime,
      scope,
      summary: decisions.length > 0 ? decisions[0].summary : null,
      boundaryType: win.boundaryType,
    });

    // Insert conversation content
    if (contentText.trim().length > 0) {
      memoryDb.insertConversationContent(winId, contentText);
    }

    // Insert file records
    if (fileMap.size > 0) {
      const fileRecords = [];
      for (const [filePath, tool] of fileMap) {
        fileRecords.push({ filePath, tool });
      }
      memoryDb.insertWindowFiles(winId, fileRecords);
    }

    // Insert decisions
    if (decisions.length > 0) {
      memoryDb.insertDecisions(winId, decisions);
    }

    // Populate FTS5 search index
    const userTextsForFts = [];
    const assistantTextsForFts = [];
    for (const line of windowLines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; } // Malformed JSONL line — expected, skip
      if ((obj.type === 'user' || obj.type === 'human') && obj.message) {
        const text = extractMessageText(obj.message.content || obj.message);
        if (text) userTextsForFts.push(text);
      } else if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
        const text = obj.message.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        if (text) assistantTextsForFts.push(text);
      }
    }
    const userFtsTerms = extractTerms(userTextsForFts);
    const assistantFtsTerms = extractTerms(assistantTextsForFts);
    memoryDb.insertSearchTerms(winId, userFtsTerms, assistantFtsTerms);

    windowsCreated++;
  }

    // Mark file as ingested
    memoryDb.markFileIngested(jsonlPath, fileSize);
  });

  doIngest();
  return { skipped: false, windowsCreated };
}

module.exports = { scanForSessions, ingestSession };
