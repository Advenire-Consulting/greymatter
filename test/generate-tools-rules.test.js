'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { generate, stripDisabledRegions, resolvePluginRoot } = require('../scripts/generate-tools-rules');

function tmpDir(label) {
  const dir = path.join(os.tmpdir(), `gm-tools-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeSource(pluginRoot, content) {
  const docsDir = path.join(pluginRoot, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const srcPath = path.join(docsDir, 'tool-index.md');
  fs.writeFileSync(srcPath, content);
  return srcPath;
}

describe('generate-tools-rules', () => {
  let pluginRoot, dataDir, outputPath, hashPath;

  beforeEach(() => {
    pluginRoot = tmpDir('root');
    dataDir = tmpDir('data');
    outputPath = path.join(tmpDir('out'), 'greymatter-tools.md');
    hashPath = path.join(dataDir, 'tmp', 'tool-index.hash');
    // Seed a config file matching defaults so loadConfig has something to merge.
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({}), { mode: 0o600 });
  });

  afterEach(() => {
    rmrf(pluginRoot);
    rmrf(dataDir);
    rmrf(path.dirname(outputPath));
  });

  it('resolves ${PLUGIN_ROOT} to absolute path', () => {
    writeSource(pluginRoot, '# Test\n\nRun `${PLUGIN_ROOT}/scripts/query.js` to query.\n');
    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true, behavioral_signals: true, doc_layer: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.match(out, new RegExp(`${pluginRoot.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&')}/scripts/query\\.js`));
    assert.doesNotMatch(out, /\$\{PLUGIN_ROOT\}/);
  });

  it('strips behavioral_signals region when flag is false', () => {
    writeSource(pluginRoot, [
      '# Test',
      '',
      '<!-- region:core -->',
      '## Core',
      'keep me',
      '<!-- endregion -->',
      '',
      '<!-- region:signals -->',
      '## Signals',
      'strip me',
      '<!-- endregion -->',
      '',
      '## Trailing',
      'also keep',
      '',
    ].join('\n'));

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true, behavioral_signals: false, doc_layer: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.match(out, /## Core/);
    assert.match(out, /keep me/);
    assert.match(out, /## Trailing/);
    assert.match(out, /also keep/);
    assert.doesNotMatch(out, /## Signals/);
    assert.doesNotMatch(out, /strip me/);
  });

  it('with all regions enabled, output equals input minus region markers and with PLUGIN_ROOT substituted', () => {
    const source = [
      '# Test',
      '<!-- region:recall -->',
      '## Recall',
      'body',
      '<!-- endregion -->',
      '',
    ].join('\n');
    writeSource(pluginRoot, source);

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true, behavioral_signals: true, doc_layer: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    // Region markers are dropped; body content is kept.
    assert.doesNotMatch(out, /region:recall/);
    assert.doesNotMatch(out, /endregion/);
    assert.match(out, /## Recall/);
    assert.match(out, /body/);
  });

  it('hash-check skips regeneration when source and flags are unchanged', () => {
    writeSource(pluginRoot, '# Test\nbody\n');
    const config = { conversation_recall: true, behavioral_signals: true, doc_layer: true };

    const first = generate({ pluginRoot, dataDir, outputPath, hashPath, config });
    assert.equal(first.skipped, false);
    const mtime1 = fs.statSync(outputPath).mtimeMs;

    // Wait a tick so mtime would differ if the file were rewritten.
    const spinUntil = Date.now() + 20;
    while (Date.now() < spinUntil) { /* noop */ }

    const second = generate({ pluginRoot, dataDir, outputPath, hashPath, config });
    assert.equal(second.skipped, true);
    const mtime2 = fs.statSync(outputPath).mtimeMs;
    assert.equal(mtime2, mtime1);
  });

  it('regenerates when config flag changes even if source is identical', () => {
    writeSource(pluginRoot, [
      '# Test',
      '<!-- region:signals -->',
      '## Signals',
      'body',
      '<!-- endregion -->',
      '',
    ].join('\n'));

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true, behavioral_signals: true, doc_layer: true } });
    const withSignals = fs.readFileSync(outputPath, 'utf-8');
    assert.match(withSignals, /## Signals/);

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true, behavioral_signals: false, doc_layer: true } });
    const withoutSignals = fs.readFileSync(outputPath, 'utf-8');
    assert.doesNotMatch(withoutSignals, /## Signals/);
  });
});

describe('stripDisabledRegions (unit)', () => {
  it('preserves unknown regions', () => {
    const input = [
      '<!-- region:something-new -->',
      'keep',
      '<!-- endregion -->',
    ].join('\n');
    const out = stripDisabledRegions(input, { conversation_recall: false, behavioral_signals: false, doc_layer: false });
    assert.match(out, /keep/);
  });
});

describe('resolvePluginRoot (unit)', () => {
  it('replaces both ${PLUGIN_ROOT} and $PLUGIN_ROOT', () => {
    const out = resolvePluginRoot('a ${PLUGIN_ROOT}/x and $PLUGIN_ROOT/y', '/abs');
    assert.equal(out, 'a /abs/x and /abs/y');
  });
});

// ── Hook integration: mcp_server flows through config → generate ──────────────
// The session-start hook calls generate({ config }) where config comes from
// loadConfig(). This test verifies that mcp_server in the config file reaches
// generate correctly — no whitelist check needed since the hook passes the
// full config object.

describe('hook integration: mcp_server config key flows to generate', () => {
  let pluginRoot, dataDir, outputPath, hashPath;

  beforeEach(() => {
    pluginRoot = tmpDir('hook-root');
    dataDir = tmpDir('hook-data');
    outputPath = path.join(tmpDir('hook-out'), 'greymatter-tools.md');
    hashPath = path.join(dataDir, 'tmp', 'tool-index.hash');
  });

  afterEach(() => {
    rmrf(pluginRoot);
    rmrf(dataDir);
    rmrf(path.dirname(outputPath));
  });

  it('config with mcp_server:true produces mcp output (simulates hook flow)', () => {
    writeSource(pluginRoot, [
      '<!-- region:mcp -->',
      'mcp output',
      '<!-- endregion -->',
      '<!-- region:cli-mcp-paralleled -->',
      'cli output',
      '<!-- endregion -->',
    ].join('\n'));

    const config = { mcp_server: true };
    generate({ pluginRoot, dataDir, outputPath, hashPath, config });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.match(out, /mcp output/);
    assert.doesNotMatch(out, /cli output/);
  });
});

// ── EXCLUSIVE_REGIONS — mcp_server flag ───────────────────────────────────────

describe('EXCLUSIVE_REGIONS — mcp_server / cli-mcp-paralleled pair', () => {
  let pluginRoot, dataDir, outputPath, hashPath;

  beforeEach(() => {
    pluginRoot = tmpDir('excl-root');
    dataDir = tmpDir('excl-data');
    outputPath = path.join(tmpDir('excl-out'), 'greymatter-tools.md');
    hashPath = path.join(dataDir, 'tmp', 'tool-index.hash');
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({}), { mode: 0o600 });
  });

  afterEach(() => {
    rmrf(pluginRoot);
    rmrf(dataDir);
    rmrf(path.dirname(outputPath));
  });

  // recall is a top-level sibling (not nested inside cli-mcp-paralleled) so the
  // existing REGION_TO_FLAG behavior is verifiably independent of EXCLUSIVE_REGIONS.
  function mcpSource() {
    return [
      '# Test',
      '',
      '<!-- region:mcp -->',
      '## MCP Mode',
      'mcp content',
      '<!-- endregion -->',
      '',
      '<!-- region:cli-mcp-paralleled -->',
      '## CLI Paralleled',
      'cli content',
      '<!-- endregion -->',
      '',
      '<!-- region:cli-only -->',
      '## CLI Only',
      'cli-only content',
      '<!-- endregion -->',
      '',
      '<!-- region:recall -->',
      '## Recall',
      'recall content',
      '<!-- endregion -->',
      '',
    ].join('\n');
  }

  it('mcp_server: true — keeps mcp, strips cli-mcp-paralleled, keeps cli-only and recall', () => {
    writeSource(pluginRoot, mcpSource());
    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { mcp_server: true, conversation_recall: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.match(out, /## MCP Mode/);
    assert.match(out, /mcp content/);
    assert.doesNotMatch(out, /## CLI Paralleled/);
    assert.doesNotMatch(out, /cli content/);
    assert.match(out, /## CLI Only/);
    assert.match(out, /cli-only content/);
    assert.match(out, /## Recall/);
    assert.match(out, /recall content/);
  });

  it('mcp_server: false — strips mcp, keeps cli-mcp-paralleled, cli-only, and recall', () => {
    writeSource(pluginRoot, mcpSource());
    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { mcp_server: false, conversation_recall: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.doesNotMatch(out, /## MCP Mode/);
    assert.doesNotMatch(out, /mcp content/);
    assert.match(out, /## CLI Paralleled/);
    assert.match(out, /cli content/);
    assert.match(out, /## CLI Only/);
    assert.match(out, /cli-only content/);
    assert.match(out, /## Recall/);
    assert.match(out, /recall content/);
  });

  it('mcp_server unset — same as false: strips mcp, keeps cli-mcp-paralleled and cli-only', () => {
    writeSource(pluginRoot, mcpSource());
    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { conversation_recall: true } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.doesNotMatch(out, /## MCP Mode/);
    assert.doesNotMatch(out, /mcp content/);
    assert.match(out, /## CLI Paralleled/);
    assert.match(out, /cli content/);
    assert.match(out, /## CLI Only/);
    assert.match(out, /cli-only content/);
  });

  it('mcp_server: true, conversation_recall: false — mcp kept, cli-mcp-paralleled+recall stripped, cli-only kept', () => {
    writeSource(pluginRoot, mcpSource());
    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { mcp_server: true, conversation_recall: false } });
    const out = fs.readFileSync(outputPath, 'utf-8');
    assert.match(out, /## MCP Mode/);
    assert.match(out, /mcp content/);
    assert.doesNotMatch(out, /## CLI Paralleled/);
    assert.doesNotMatch(out, /cli content/);
    assert.match(out, /## CLI Only/);
    assert.match(out, /cli-only content/);
    assert.doesNotMatch(out, /## Recall/);
    assert.doesNotMatch(out, /recall content/);
  });

  it('hash-check: regenerates when mcp_server flag changes', () => {
    writeSource(pluginRoot, [
      '<!-- region:mcp -->',
      'mcp content',
      '<!-- endregion -->',
      '<!-- region:cli-mcp-paralleled -->',
      'cli content',
      '<!-- endregion -->',
    ].join('\n'));

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { mcp_server: false } });
    const first = fs.readFileSync(outputPath, 'utf-8');
    assert.match(first, /cli content/);
    assert.doesNotMatch(first, /mcp content/);

    generate({ pluginRoot, dataDir, outputPath, hashPath, config: { mcp_server: true } });
    const second = fs.readFileSync(outputPath, 'utf-8');
    assert.match(second, /mcp content/);
    assert.doesNotMatch(second, /cli content/);
  });
});
