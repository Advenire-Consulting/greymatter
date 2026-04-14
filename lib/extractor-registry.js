'use strict';

const path = require('path');
const fs = require('fs');

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
      try {
        const mod = require(path.join(this._dir, file));
        if (Array.isArray(mod.extensions) && typeof mod.extract === 'function') {
          for (const ext of mod.extensions) {
            this._map.set(ext, mod);
          }
        }
      } catch {
        // Skip extractors that fail to load
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

module.exports = { ExtractorRegistry };
