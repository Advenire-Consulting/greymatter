'use strict';

// Runs the reconciliation transaction described in
// docs/superpowers/specs/2026-04-17-test-map-alerts-design.md:326-356.
//
// Inputs:
//   graphDb         — open GraphDB instance
//   project         — project name
//   headSha         — git HEAD at scan time (may be null for non-git projects)
//   mode            — 'incremental' | 'audit'
//   currentFindings — array of { source_file, kind, test_file } currently present
//   resolvedRows    — array of open-findings rows (from graphDb) determined
//                     by the caller to be resolved by this scan. Each row
//                     has { id, source_file, kind, test_file }.
//
// Returns:
//   { open, newlyResolved, newlyAdded, stillPresent, openAfter }
//
// All UPDATE/INSERT traffic runs inside one transaction per spec L356.

function reconcile({ graphDb, project, headSha, mode, currentFindings, resolvedRows }) {
  const existingOpen = graphDb.getOpenFindings(project);
  const resolvedIds = new Set(resolvedRows.map(r => r.id));

  const keyOf = (f) => `${f.source_file}\u0000${f.kind}\u0000${f.test_file || ''}`;

  const existingKeys = new Map();
  for (const row of existingOpen) {
    if (resolvedIds.has(row.id)) continue;
    existingKeys.set(keyOf(row), row);
  }

  const newlyAdded = [];
  const stillPresent = [];
  for (const f of currentFindings) {
    if (existingKeys.has(keyOf(f))) {
      stillPresent.push(f);
    } else {
      newlyAdded.push(f);
    }
  }

  graphDb.withTransaction(() => {
    for (const f of newlyAdded) {
      graphDb.insertFinding({
        project,
        source_file: f.source_file,
        kind: f.kind,
        test_file: f.test_file,
        first_seen_sha: headSha,
        last_seen_sha: headSha,
      });
    }
    for (const f of stillPresent) {
      graphDb.bumpFinding({
        project,
        source_file: f.source_file,
        kind: f.kind,
        test_file: f.test_file,
        last_seen_sha: headSha,
      });
    }
    for (const row of resolvedRows) {
      graphDb.resolveFinding(row.id, headSha);
    }
    graphDb.upsertScanState(project, headSha, mode);
  });

  const openAfter = graphDb.getOpenFindings(project);
  return {
    open: openAfter,
    newlyResolved: resolvedRows,
    newlyAdded,
    stillPresent,
    openAfter,
  };
}

module.exports = { reconcile };
