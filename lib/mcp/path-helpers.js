'use strict';
const path = require('path');

// Resolve a project-relative file path to absolute, using the GraphDB's
// recorded project root. Returns null when the project is unknown or file
// is absent (callers treat null as "cannot resolve" and skip exclusion).
function absolutePathFor(graphDb, project, file) {
  const root = graphDb.getProjectRoot(project);
  if (!root || !file) return null;
  return path.join(root, file);
}

module.exports = { absolutePathFor };
