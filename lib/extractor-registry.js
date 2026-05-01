'use strict';

/**
 * @typedef {object} DetectorCtx
 * @property {string} project   - project name (registry-known)
 * @property {string} filePath  - file path being processed
 * @property {string} content   - full file content as a UTF-8 string
 *
 * Detectors must NOT mutate ctx, must NOT perform I/O, and must NOT throw.
 * Return null when no match. Return {term?, descriptors?, confidence} when
 * matched. confidence is a number in [0.0, 1.0]; out-of-range values are
 * clamped at write time by db.upsertLabel.
 */

/**
 * @typedef {(content: string, node: object) => string | null} ExtractBody
 *
 * Optional extractor module export. Given the file content and an extracted
 * node (with at least `line` and `name`), return the body text the node
 * corresponds to, or null when no body can be extracted (e.g. markdown
 * heading). Used by scan.js and hooks/post-tool-use.js to populate
 * node.body and compute body_hash. Per-language: brace-counting for JS/TS,
 * indentation-aware for Python, script-block-then-brace for Svelte.
 */

const path = require('path');
const fs = require('fs');

const CATEGORY_VOCAB = Object.freeze([
  'middleware',
  'route-handler',
  'data-access',
  'auth-step',
  'validation',
  'transaction-boundary',
  'template',
  'background-task',
  'ipc-boundary',
  'error-handler',
]);

function validateDetector(extractorPath, detector, index) {
  const required = ['id', 'category', 'defaultTerm', 'detect'];
  for (const field of required) {
    if (!(field in detector)) {
      throw new Error(
        `extractor ${extractorPath}: detector at index ${index} missing required field '${field}'`
      );
    }
  }
  if (typeof detector.id !== 'string' || detector.id.length === 0) {
    throw new Error(
      `extractor ${extractorPath}: detector at index ${index} has invalid id`
    );
  }
  if (typeof detector.defaultTerm !== 'string' || detector.defaultTerm.length === 0) {
    throw new Error(
      `extractor ${extractorPath}: detector ${detector.id} has invalid defaultTerm`
    );
  }
  if (typeof detector.detect !== 'function') {
    throw new Error(
      `extractor ${extractorPath}: detector ${detector.id} detect must be a function`
    );
  }
  if (!CATEGORY_VOCAB.includes(detector.category)) {
    throw new Error(
      `extractor ${extractorPath}: detector ${detector.id} has unknown category ` +
      `'${detector.category}'. Allowed: ${CATEGORY_VOCAB.join(', ')}`
    );
  }
}

class ExtractorRegistry {
  constructor(extractorsDir) {
    this._map = new Map();
    this._dir = extractorsDir || path.join(__dirname, '..', 'extractors');
    this._discover();
  }

  _discover() {
    let files;
    try {
      files = fs.readdirSync(this._dir).filter(f => f.endsWith('.js'));
    } catch {
      return;
    }
    for (const file of files) {
      const fullPath = path.join(this._dir, file);
      let mod;
      try {
        mod = require(fullPath);
      } catch (e) {
        throw new Error(`extractor load failed at ${fullPath}: ${e.message}`);
      }
      if (!Array.isArray(mod.extensions) || typeof mod.extract !== 'function') {
        continue;
      }
      if ('labelDetectors' in mod && !Array.isArray(mod.labelDetectors)) {
        throw new Error(
          `extractor ${fullPath}: labelDetectors must be an array, got ${typeof mod.labelDetectors}`
        );
      }
      if ('extractBody' in mod && typeof mod.extractBody !== 'function') {
        throw new Error(
          `extractor ${fullPath}: extractBody must be a function, got ${typeof mod.extractBody}`
        );
      }
      if (Array.isArray(mod.labelDetectors)) {
        const seen = new Set();
        for (let i = 0; i < mod.labelDetectors.length; i++) {
          validateDetector(fullPath, mod.labelDetectors[i], i);
          const detId = mod.labelDetectors[i].id;
          if (seen.has(detId)) {
            throw new Error(
              `extractor ${fullPath}: duplicate detector id '${detId}'`
            );
          }
          seen.add(detId);
        }
      }
      for (const ext of mod.extensions) {
        this._map.set(ext, mod);
      }
    }
  }

  getExtractor(ext) {
    return this._map.get(ext) || null;
  }

  supportedExtensions() {
    return [...this._map.keys()];
  }

  extractFile(content, filePath, project) {
    const ext = path.extname(filePath);
    const extractor = this.getExtractor(ext);
    if (!extractor) return { nodes: [], edges: [], edge_types: [] };
    return extractor.extract(content, filePath, project);
  }
}

function runDetectorsForNode(extractorMod, node, ctx) {
  const detectors = Array.isArray(extractorMod?.labelDetectors)
    ? extractorMod.labelDetectors
    : [];
  const results = [];
  for (const detector of detectors) {
    let raw;
    try {
      raw = detector.detect(node, ctx);
    } catch (e) {
      console.warn(`detector ${detector.id} threw on node ${node.name}: ${e.message}`);
      continue;
    }
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== 'object' || typeof raw.confidence !== 'number') {
      console.warn(`detector ${detector.id} returned malformed shape: ${JSON.stringify(raw)}`);
      continue;
    }
    if (raw.descriptors !== undefined && !Array.isArray(raw.descriptors)) {
      console.warn(`detector ${detector.id} returned non-array descriptors`);
      continue;
    }
    results.push({
      detectorId: detector.id,
      term: raw.term || detector.defaultTerm,
      category: detector.category,
      descriptors: raw.descriptors,
      confidence: raw.confidence,
    });
  }
  return results;
}

module.exports = { ExtractorRegistry, runDetectorsForNode, CATEGORY_VOCAB };
