'use strict';

const path = require('path');
const fs = require('fs');

// Returns the extractor that owns this file's extension, or null.
// Only extractors that export `testPairs` are eligible here.
function getPairingExtractor(relPath, registry) {
  const ext = path.extname(relPath);
  const extractor = registry.getExtractor(ext);
  if (!extractor || !extractor.testPairs) return null;
  return extractor;
}

// Given an iterable of project-relative test file paths, read each, run
// `parseAnnotations`, and return a Map<testPath, string[] sourcePaths>.
function buildAnnotationMap(projectRoot, registry, testFilePaths) {
  const map = new Map();
  for (const rel of testFilePaths) {
    const ext = path.extname(rel);
    const extractor = registry.getExtractor(ext);
    if (!extractor || !extractor.testPairs) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(projectRoot, rel), 'utf8');
    } catch {
      continue;  // deleted, unreadable, etc.
    }
    try {
      const sources = extractor.testPairs.parseAnnotations(content);
      if (Array.isArray(sources) && sources.length > 0) {
        map.set(rel, sources.filter(s => typeof s === 'string' && s.length > 0));
      }
    } catch {
      // Extractor threw; caller has already logged at the scan level.
    }
  }
  return map;
}

// Given the annotation map, build a reverse index: source → [test, test, ...]
function invertAnnotationMap(annotationMap) {
  const rev = new Map();
  for (const [testPath, sources] of annotationMap.entries()) {
    for (const src of sources) {
      if (!rev.has(src)) rev.set(src, []);
      rev.get(src).push(testPath);
    }
  }
  return rev;
}

// Given a source file's project-relative path, resolve its paired tests.
// Returns an array of project-relative test paths (possibly empty).
//
// Algorithm (from spec L183-L189):
//   1. If any test's annotations name this source, return all those tests.
//   2. Else consult the extractor's candidateTestPaths; first existing wins.
//   3. Else return [].
function resolvePair(sourceRelPath, projectRoot, registry, invertedAnnotations) {
  const extractor = getPairingExtractor(sourceRelPath, registry);
  if (!extractor) return [];

  const annotated = invertedAnnotations.get(sourceRelPath);
  if (annotated && annotated.length > 0) {
    return [...annotated];
  }

  let candidates;
  try {
    candidates = extractor.testPairs.candidateTestPaths(sourceRelPath);
  } catch {
    return [];
  }
  if (!Array.isArray(candidates)) return [];

  for (const cand of candidates) {
    try {
      if (fs.existsSync(path.join(projectRoot, cand))) {
        return [cand];
      }
    } catch { /* keep looking */ }
  }
  return [];
}

// Thin helper for "is this file a test file according to its extractor?"
function isTestFile(relPath, registry) {
  const ext = path.extname(relPath);
  const extractor = registry.getExtractor(ext);
  if (!extractor || !extractor.testPairs) return false;
  try {
    return Boolean(extractor.testPairs.isTestFile(relPath));
  } catch {
    return false;
  }
}

module.exports = {
  getPairingExtractor,
  buildAnnotationMap,
  invertAnnotationMap,
  resolvePair,
  isTestFile,
};
