'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadPolicy, isExcluded, purgeExcluded, policyChangedSince } = require('../lib/exclusion');
const { GraphDB } = require('../lib/graph-db');

const DEFAULT_CFG = {
  exclusion: { respect_gitignore: false, extra_patterns: [], respect_greymatterignore: true },
  redaction: { enabled: true, context_window_lines: 5, extra_patterns: [] },
};

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gm-excl-'));
}
function rmRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

describe('loadPolicy + isExcluded', () => {
  let root;
  beforeEach(() => { root = mkRoot(); });
  afterEach(() => { rmRoot(root); });

  it('built-ins exclude node_modules/foo.js', () => {
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(isExcluded(path.join(root, 'node_modules/foo.js'), policy), true);
  });

  it('built-ins exclude production.env (AC #1)', () => {
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(isExcluded(path.join(root, 'production.env'), policy), true);
  });

  it('with respect_gitignore=false, .gitignore secrets/ does NOT exclude secrets/x.js', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'secrets/\n');
    const policy = loadPolicy(root, { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_gitignore: false } });
    assert.equal(isExcluded(path.join(root, 'secrets/x.js'), policy), false);
  });

  it('with respect_gitignore=true, .gitignore secrets/ DOES exclude secrets/x.js', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'secrets/\n');
    const policy = loadPolicy(root, { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_gitignore: true } });
    assert.equal(isExcluded(path.join(root, 'secrets/x.js'), policy), true);
  });

  it('cross-source negation: .greymatterignore !templates/example.env re-includes built-in-excluded *.env (AC #11)', () => {
    fs.writeFileSync(path.join(root, '.greymatterignore'), '!templates/example.env\n');
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(isExcluded(path.join(root, 'templates/example.env'), policy), false);
    // Sibling not negated remains excluded
    assert.equal(isExcluded(path.join(root, 'production.env'), policy), true);
  });

  it('cross-source negation: gitignore *.log + greymatterignore !keep.log re-includes the one file', () => {
    // NOTE: gitignore semantics intentionally forbid re-including files under
    // a directory that was excluded with `dir/`. So we use a file-level
    // pattern (`*.log`) for the cross-source negation test instead of a
    // directory-level one. This is documented in observations.md for Chunk 2.
    fs.writeFileSync(path.join(root, '.gitignore'), '*.log\n');
    fs.writeFileSync(path.join(root, '.greymatterignore'), '!keep.log\n');
    const cfg = { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_gitignore: true } };
    const policy = loadPolicy(root, cfg);
    assert.equal(isExcluded(path.join(root, 'keep.log'), policy), false);
    assert.equal(isExcluded(path.join(root, 'drop.log'), policy), true);
  });

  it('respect_greymatterignore=false ignores the .greymatterignore file (AC #13)', () => {
    fs.writeFileSync(path.join(root, '.greymatterignore'), '!production.env\n');
    const cfg = { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_greymatterignore: false } };
    const policy = loadPolicy(root, cfg);
    // Negation in .greymatterignore would have re-included production.env, but the
    // file is ignored entirely, so the built-in *.env match still wins.
    assert.equal(isExcluded(path.join(root, 'production.env'), policy), true);
    // And the patterns array contains no greymatterignore entries
    assert.equal(policy.patterns.some(p => p.source === 'greymatterignore'), false);
  });

  it('config.exclusion.extra_patterns contributes to the engine', () => {
    const cfg = { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, extra_patterns: ['custom-secrets/'] } };
    const policy = loadPolicy(root, cfg);
    assert.equal(isExcluded(path.join(root, 'custom-secrets/foo.js'), policy), true);
  });

  it('hash is stable across two reloads with no source changes (AC #8)', () => {
    fs.writeFileSync(path.join(root, '.greymatterignore'), '*.log\n');
    const a = loadPolicy(root, DEFAULT_CFG);
    const b = loadPolicy(root, DEFAULT_CFG);
    assert.equal(a.hash, b.hash);
  });

  it('hash changes when .greymatterignore content changes', () => {
    fs.writeFileSync(path.join(root, '.greymatterignore'), '*.log\n');
    const a = loadPolicy(root, DEFAULT_CFG);
    fs.writeFileSync(path.join(root, '.greymatterignore'), '*.log\n*.tmp\n');
    const b = loadPolicy(root, DEFAULT_CFG);
    assert.notEqual(a.hash, b.hash);
  });

  it('policy.patterns is source-tagged for diagnostics', () => {
    fs.writeFileSync(path.join(root, '.greymatterignore'), '!production.env\n');
    const cfg = { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, extra_patterns: ['custom/'] } };
    const policy = loadPolicy(root, cfg);
    const sources = new Set(policy.patterns.map(p => p.source));
    assert.ok(sources.has('builtin'));
    assert.ok(sources.has('greymatterignore'));
    assert.ok(sources.has('config'));
  });

  it('nested .gitignore is honored when respect_gitignore=true', () => {
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub/.gitignore'), 'private/\n');
    const cfg = { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_gitignore: true } };
    const policy = loadPolicy(root, cfg);
    assert.equal(isExcluded(path.join(root, 'sub/private/x.js'), policy), true);
    assert.equal(isExcluded(path.join(root, 'private/x.js'), policy), false); // outside sub/
  });
});

describe('isExcluded — symlink edge cases (AC #9)', () => {
  let root, outside;
  beforeEach(() => {
    root = mkRoot();
    outside = mkRoot();
  });
  afterEach(() => {
    rmRoot(root);
    rmRoot(outside);
  });

  it('symlink whose target is outside projectRoot is excluded', () => {
    const target = path.join(outside, 'bar.txt');
    fs.writeFileSync(target, 'x');
    const link = path.join(root, 'foo');
    fs.symlinkSync(target, link);
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(isExcluded(link, policy), true);
  });

  it('broken symlink is excluded (fail-closed)', () => {
    const link = path.join(root, 'broken');
    fs.symlinkSync('/does/not/exist/anywhere', link);
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(isExcluded(link, policy), true);
  });
});

describe('purgeExcluded + policyChangedSince', () => {
  let root, db, dbPath;
  beforeEach(() => {
    root = mkRoot();
    dbPath = path.join(root, 'graph.db');
    db = new GraphDB(dbPath);
  });
  afterEach(() => {
    db.close();
    rmRoot(root);
  });

  it('purges nodes/edges/labels for excluded files; returns counts; leaves included files alone', () => {
    // Seed two files: secrets/x.js (will be excluded) and src/y.js (kept)
    const secId = db.upsertNode({ project: 'p', file: 'secrets/x.js', name: 'fnSec', type: 'function', line: 1 });
    const srcId = db.upsertNode({ project: 'p', file: 'src/y.js',     name: 'fnSrc', type: 'function', line: 1 });
    db.insertEdge({ sourceId: secId, targetId: srcId, type: 'calls', category: 'structural', sourceProject: 'p', sourceFile: 'secrets/x.js' });
    // A label on the secret node
    db.db.prepare(`
      INSERT INTO code_labels (node_id, detector_id, term, category, confidence, source)
      VALUES (?, 'd1', 'leaks', 'sensitivity', 1.0, 'heuristic')
    `).run(secId);
    db.setProjectRoot('p', root);

    fs.writeFileSync(path.join(root, '.gitignore'), 'secrets/\n');
    const policy = loadPolicy(root, { ...DEFAULT_CFG, exclusion: { ...DEFAULT_CFG.exclusion, respect_gitignore: true } });

    const counts = purgeExcluded(db, 'p', policy);

    assert.equal(counts.files_purged, 1);
    assert.equal(counts.nodes_purged, 1);
    assert.equal(counts.edges_purged, 1);
    assert.equal(counts.labels_purged, 1);
    assert.equal(counts.observations_purged, 0); // node_observations table not yet shipped

    // secrets/x.js gone from nodes; cascade removed the edge
    const secRows = db.db.prepare('SELECT * FROM nodes WHERE project=? AND file=?').all('p', 'secrets/x.js');
    assert.equal(secRows.length, 0);
    const edgeRows = db.db.prepare('SELECT * FROM edges').all();
    assert.equal(edgeRows.length, 0);
    const labelRows = db.db.prepare('SELECT * FROM code_labels').all();
    assert.equal(labelRows.length, 0);

    // src/y.js untouched
    const kept = db.db.prepare('SELECT * FROM nodes WHERE project=? AND file=?').all('p', 'src/y.js');
    assert.equal(kept.length, 1);

    // exclusion_policy_hash recorded
    const state = db.getExclusionState('p');
    assert.equal(state.exclusion_policy_hash, policy.hash);
  });

  it('policyChangedSince returns true when no prior hash, false after setExclusionState matches current', () => {
    db.setProjectRoot('p', root);
    const policy = loadPolicy(root, DEFAULT_CFG);
    assert.equal(policyChangedSince(db, 'p', policy), true);
    db.setExclusionState('p', policy.hash);
    assert.equal(policyChangedSince(db, 'p', policy), false);
  });

  it('policyChangedSince returns true when stored hash differs from policy.hash', () => {
    db.setProjectRoot('p', root);
    const policy = loadPolicy(root, DEFAULT_CFG);
    db.setExclusionState('p', 'stale-hash');
    assert.equal(policyChangedSince(db, 'p', policy), true);
  });
});
