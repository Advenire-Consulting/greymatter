'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ExtractorRegistry, runDetectorsForNode, CATEGORY_VOCAB } = require('../lib/extractor-registry');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'extractors');

function makeValidDetector(overrides = {}) {
  return {
    id: 'test-detector',
    category: 'middleware',
    defaultTerm: 'Test',
    detect: () => null,
    ...overrides,
  };
}

// Build a minimal extractor module object (not on disk — injected via path tricks)
function makeExtractorMod(overrides = {}) {
  return {
    extensions: ['.test-ext'],
    extract: () => ({ nodes: [], edges: [], edge_types: [] }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Existing tests (unchanged)
// ---------------------------------------------------------------------------

describe('ExtractorRegistry — baseline', () => {
  it('discovers extractors from directory', () => {
    const registry = new ExtractorRegistry();
    const exts = registry.supportedExtensions();
    assert.ok(exts.includes('.js'));
    assert.ok(exts.includes('.mjs'));
    assert.ok(exts.includes('.cjs'));
  });

  it('getExtractor returns extractor for known extension', () => {
    const registry = new ExtractorRegistry();
    const ext = registry.getExtractor('.js');
    assert.ok(ext);
    assert.ok(typeof ext.extract === 'function');
  });

  it('getExtractor returns null for unknown extension', () => {
    const registry = new ExtractorRegistry();
    assert.equal(registry.getExtractor('.xyz'), null);
  });

  it('extractFile routes to correct extractor', () => {
    const registry = new ExtractorRegistry();
    const result = registry.extractFile(
      "const foo = require('./bar');\nfunction doStuff() { return 42; }\nmodule.exports = { doStuff };",
      'lib/test.js',
      'myproject'
    );
    assert.ok(result.nodes.length > 0);
    assert.ok(result.edges.length > 0);
  });

  it('returns empty result for unknown extension', () => {
    const registry = new ExtractorRegistry();
    const result = registry.extractFile('some content', 'file.xyz', 'p');
    assert.deepEqual(result.nodes, []);
    assert.deepEqual(result.edges, []);
    assert.deepEqual(result.edge_types, []);
  });
});

// ---------------------------------------------------------------------------
// Task 2.1 — Discovery of labelDetectors and extractBody
// ---------------------------------------------------------------------------

describe('ExtractorRegistry — labelDetectors + extractBody discovery', () => {
  it('2.1 case 1: extractor with labelDetectors and extractBody — accessible via getExtractor', () => {
    const registry = new ExtractorRegistry(FIXTURES_DIR);
    const mod = registry.getExtractor('.good-ext');
    assert.ok(mod, 'extractor not found');
    assert.ok(Array.isArray(mod.labelDetectors), 'labelDetectors not an array');
    assert.ok(typeof mod.extractBody === 'function', 'extractBody not a function');
  });

  it('2.1 case 2: extractor without labelDetectors or extractBody — loads without error, undefined fields', () => {
    const registry = new ExtractorRegistry(FIXTURES_DIR);
    const mod = registry.getExtractor('.plain-ext');
    assert.ok(mod, 'plain extractor not found');
    assert.equal(mod.labelDetectors, undefined);
    assert.equal(mod.extractBody, undefined);
  });

  it('2.1 case 3: extractor with labelDetectors as string — load throws with path and message', () => {
    assert.throws(
      () => new ExtractorRegistry(path.join(FIXTURES_DIR, 'bad-label-detectors')),
      (err) => {
        assert.ok(err.message.includes('labelDetectors must be an array'), err.message);
        return true;
      }
    );
  });

  it('2.1 case 4: extractor with extractBody as string — load throws with path and message', () => {
    assert.throws(
      () => new ExtractorRegistry(path.join(FIXTURES_DIR, 'bad-extract-body')),
      (err) => {
        assert.ok(err.message.includes('extractBody must be a function'), err.message);
        return true;
      }
    );
  });

  it('2.1 case 5: extractor that throws during require — error propagates with path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-fixture-'));
    const badFile = path.join(tmpDir, 'throws-bad.js');
    fs.writeFileSync(badFile, "'use strict';\nthrow new Error('intentional load failure for testing');\n");
    try {
      assert.throws(
        () => new ExtractorRegistry(tmpDir),
        (err) => {
          assert.ok(err.message.includes('extractor load failed'), err.message);
          return true;
        }
      );
    } finally {
      fs.unlinkSync(badFile);
      fs.rmdirSync(tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2.2 — Detector shape validation
// ---------------------------------------------------------------------------

describe('ExtractorRegistry — detector shape validation', () => {
  it('2.2 case 1: missing id — load fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-no-id');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes("missing required field 'id'"), err.message);
        return true;
      }
    );
  });

  it('2.2 case 2: id is empty string — load fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-empty-id');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes('invalid id'), err.message);
        return true;
      }
    );
  });

  it('2.2 case 3: missing defaultTerm — load fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-no-defaultterm');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes("missing required field 'defaultTerm'"), err.message);
        return true;
      }
    );
  });

  it('2.2 case 4: detect not a function — load fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-detect-not-fn');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes('detect must be a function'), err.message);
        return true;
      }
    );
  });

  it('2.2 case 5: duplicate detector id within extractor — load fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-duplicate-id');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes('duplicate detector id'), err.message);
        return true;
      }
    );
  });

  it('2.2 case 6: valid detector — loads without error', () => {
    const registry = new ExtractorRegistry(FIXTURES_DIR);
    const mod = registry.getExtractor('.good-ext');
    assert.ok(mod);
    assert.equal(mod.labelDetectors.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Task 2.3 — Controlled vocabulary category enforcement
// ---------------------------------------------------------------------------

describe('ExtractorRegistry — category vocabulary enforcement', () => {
  it('2.3 case 1: known category (middleware) — loads', () => {
    const registry = new ExtractorRegistry(FIXTURES_DIR);
    const mod = registry.getExtractor('.good-ext');
    assert.ok(mod);
    assert.equal(mod.labelDetectors[0].category, 'middleware');
  });

  it('2.3 case 2: unknown category — fails with helpful message', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-unknown-category');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes("unknown category"), err.message);
        assert.ok(err.message.includes('Allowed:'), err.message);
        return true;
      }
    );
  });

  it('2.3 case 3: missing category field — fails', () => {
    const dir = path.join(FIXTURES_DIR, 'bad-detector-no-category');
    assert.throws(
      () => new ExtractorRegistry(dir),
      (err) => {
        assert.ok(err.message.includes("missing required field 'category'"), err.message);
        return true;
      }
    );
  });

  it('CATEGORY_VOCAB is exported and contains expected values', () => {
    assert.ok(Array.isArray(CATEGORY_VOCAB));
    assert.ok(CATEGORY_VOCAB.includes('middleware'));
    assert.ok(CATEGORY_VOCAB.includes('route-handler'));
    assert.equal(CATEGORY_VOCAB.length, 10);
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 — Runner harness
// ---------------------------------------------------------------------------

describe('runDetectorsForNode', () => {
  it('2.4 case 1: returns result for good detector; bad detectors skipped', () => {
    const mod = makeExtractorMod({
      labelDetectors: [
        makeValidDetector({ id: 'good', detect: () => ({ confidence: 0.9 }) }),
        makeValidDetector({ id: 'boom', detect: () => { throw new Error('oops'); } }),
        makeValidDetector({ id: 'weird', detect: () => ({ confidence: 'high' }) }),
      ],
    });
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    const results = runDetectorsForNode(mod, node, {});
    assert.equal(results.length, 1);
    assert.equal(results[0].detectorId, 'good');
  });

  it('2.4 case 2: console.warn called for throw and malformed return', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    const mod = makeExtractorMod({
      labelDetectors: [
        makeValidDetector({ id: 'boom', detect: () => { throw new Error('boom'); } }),
        makeValidDetector({ id: 'weird', detect: () => ({ confidence: 'high' }) }),
      ],
    });
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    runDetectorsForNode(mod, node, {});
    console.warn = origWarn;

    assert.equal(warnings.length, 2, `expected 2 warnings, got: ${warnings.join(' | ')}`);
  });

  it('2.4 case 3: null return is silently skipped', () => {
    const mod = makeExtractorMod({
      labelDetectors: [
        makeValidDetector({ id: 'null-det', detect: () => null }),
      ],
    });
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    const results = runDetectorsForNode(mod, node, {});
    assert.equal(results.length, 0);
  });

  it('2.4 case 4: term override from detect() return', () => {
    const mod = makeExtractorMod({
      labelDetectors: [
        makeValidDetector({ id: 'override', defaultTerm: 'Default', detect: () => ({ term: 'Override', confidence: 0.8 }) }),
      ],
    });
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    const results = runDetectorsForNode(mod, node, {});
    assert.equal(results[0].term, 'Override');
  });

  it('2.4 case 5: out-of-range confidence preserved as-is (clamp is upsertLabel responsibility)', () => {
    const mod = makeExtractorMod({
      labelDetectors: [
        makeValidDetector({ id: 'high-conf', detect: () => ({ confidence: 1.5 }) }),
      ],
    });
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    const results = runDetectorsForNode(mod, node, {});
    assert.equal(results[0].confidence, 1.5);
  });

  it('2.4 case 6: extractor without labelDetectors returns []', () => {
    const mod = makeExtractorMod(); // no labelDetectors
    const node = { name: 'x', body: 'y', metadata_json: '{}' };
    const results = runDetectorsForNode(mod, node, {});
    assert.deepEqual(results, []);
  });
});
