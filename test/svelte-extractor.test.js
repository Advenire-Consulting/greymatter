'use strict';

// @tests extractors/svelte.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/svelte');
const { runDetectorsForNode } = require('../lib/extractor-registry');

describe('Svelte Extractor', () => {
  it('has correct extension', () => {
    assert.deepEqual(extractor.extensions, ['.svelte']);
  });

  it('extracts component name from filename', () => {
    const result = extractor.extract(
      "<script>\n  export let name;\n</script>\n<p>{name}</p>\n",
      'components/Header.svelte', 'p'
    );
    const component = result.nodes.find(n => n.type === 'component');
    assert.ok(component);
    assert.equal(component.name, 'Header');
  });

  it('extracts imports from script block', () => {
    const result = extractor.extract(
      "<script>\n  import { onMount } from 'svelte';\n  import Button from './Button.svelte';\n</script>\n",
      'App.svelte', 'p'
    );
    const imports = result.edges.filter(e => e.type === 'imports');
    assert.ok(imports.some(e => e.target === './Button.svelte'));
  });

  it('extracts exported props', () => {
    const result = extractor.extract(
      "<script>\n  export let title = 'Default';\n  export let count;\n</script>\n",
      'Card.svelte', 'p'
    );
    const props = result.nodes.filter(n => n.type === 'prop');
    assert.ok(props.length >= 2);
    assert.ok(props.some(n => n.name === 'title'));
  });

  it('extracts event dispatchers', () => {
    const result = extractor.extract(
      "<script>\n  import { createEventDispatcher } from 'svelte';\n  const dispatch = createEventDispatcher();\n  function handleClick() { dispatch('select', { id: 1 }); }\n</script>\n",
      'Item.svelte', 'p'
    );
    const dispatches = result.edges.filter(e => e.type === 'dispatches');
    assert.ok(dispatches.some(e => e.target === 'select'));
  });

  describe('testPairs.isTestFile', () => {
    it('matches .test.svelte and .spec.svelte', () => {
      assert.equal(extractor.testPairs.isTestFile('Button.test.svelte'), true);
      assert.equal(extractor.testPairs.isTestFile('Button.spec.svelte'), true);
      assert.equal(extractor.testPairs.isTestFile('Button.svelte'), false);
    });

    it('matches test/ and __tests__/ directories', () => {
      assert.equal(extractor.testPairs.isTestFile('test/Button.svelte'), true);
      assert.equal(extractor.testPairs.isTestFile('src/__tests__/Button.svelte'), true);
    });
  });

  describe('testPairs.candidateTestPaths', () => {
    it('crosses extensions to TS/JS test files', () => {
      const candidates = extractor.testPairs.candidateTestPaths('src/lib/Button.svelte');
      assert.ok(candidates.includes('src/lib/Button.test.ts'));
      assert.ok(candidates.includes('src/lib/Button.spec.ts'));
      assert.ok(candidates.includes('src/lib/Button.test.js'));
      assert.ok(candidates.includes('src/lib/Button.spec.js'));
    });

    it('includes __tests__ subdirectory and top-level test dirs', () => {
      const candidates = extractor.testPairs.candidateTestPaths('src/lib/Button.svelte');
      assert.ok(candidates.includes('src/lib/__tests__/Button.test.ts'));
      assert.ok(candidates.includes('test/Button.test.ts'));
      assert.ok(candidates.includes('tests/Button.test.ts'));
    });
  });

  describe('testPairs.parseAnnotations', () => {
    it('captures // @tests annotations from script block', () => {
      const sources = extractor.testPairs.parseAnnotations(
        "<script lang=\"ts\">\n  // @tests src/lib/Button.svelte\n  import Button from './Button.svelte';\n</script>\n"
      );
      assert.deepEqual(sources, ['src/lib/Button.svelte']);
    });

    it('does not capture across newlines for bare // @tests', () => {
      const sources = extractor.testPairs.parseAnnotations(
        "<script>\n  // @tests\n  import x from './x';\n</script>\n"
      );
      assert.deepEqual(sources, []);
    });
  });
});

describe('Svelte extractBody', () => {
  const SOURCE = [
    '<script>',
    '  export async function load({ fetch }) {',
    '    return { data: await fetch("/api").then(r => r.json()) };',
    '  }',
    '</script>',
    '',
    '<h1>Hello</h1>',
  ].join('\n');

  it('extracts function body from inside <script> block', () => {
    // load is at absolute file line 2 (lineOffset=0, scriptLine index 1 → line 0+1+1=2)
    const body = extractor.extractBody(SOURCE, { line: 2, name: 'load' });
    assert.ok(body, 'should return body string');
    assert.ok(body.includes('export async function load'));
    assert.ok(body.trimEnd().endsWith('}'));
    assert.equal(body.split('\n').length, 3, 'three-line body');
  });

  it('returns null for node.line outside the script block', () => {
    const body = extractor.extractBody(SOURCE, { line: 7, name: 'unknown' });
    assert.equal(body, null);
  });

  it('returns null when there is no <script> block', () => {
    const body = extractor.extractBody('<h1>Hello</h1>', { line: 1, name: 'x' });
    assert.equal(body, null);
  });
});

describe('Svelte labelDetectors — svelte-load', () => {
  const FIXTURE = "export async function load({ fetch }) { return { data: await fetch('/api').then(r => r.json()) }; }";

  function runSvelte(filePath) {
    const node = { name: 'load', type: 'function', line: 1, body: FIXTURE };
    const ctx = { project: 'p', filePath, content: FIXTURE };
    return runDetectorsForNode(extractor, node, ctx);
  }

  it('detects load in +page.js', () => {
    const label = runSvelte('src/routes/+page.js').find(l => l.detectorId === 'svelte-load');
    assert.ok(label, 'should detect in +page.js');
    assert.equal(label.category, 'data-access');
  });

  it('detects load in +page.server.js', () => {
    const label = runSvelte('src/routes/+page.server.js').find(l => l.detectorId === 'svelte-load');
    assert.ok(label, 'should detect in +page.server.js');
  });

  it('detects load in +layout.js', () => {
    const label = runSvelte('+layout.js').find(l => l.detectorId === 'svelte-load');
    assert.ok(label, 'should detect in +layout.js');
  });

  it('detects load in +layout.server.ts', () => {
    const label = runSvelte('+layout.server.ts').find(l => l.detectorId === 'svelte-load');
    assert.ok(label, 'should detect in +layout.server.ts');
  });

  it('does not detect load in regular.js', () => {
    const label = runSvelte('regular.js').find(l => l.detectorId === 'svelte-load');
    assert.ok(!label, 'should not detect in regular.js');
  });
});

describe('Svelte labelDetectors — svelte-server-endpoint', () => {
  function runEndpoint(name, filePath) {
    const content = `export async function ${name}({ url }) { return new Response('ok'); }`;
    const node = { name, type: 'function', line: 1, body: content };
    const ctx = { project: 'p', filePath, content };
    return runDetectorsForNode(extractor, node, ctx);
  }

  it('detects GET in +server.js', () => {
    const label = runEndpoint('GET', 'src/routes/+server.js').find(l => l.detectorId === 'svelte-server-endpoint');
    assert.ok(label, 'should detect GET endpoint');
    assert.equal(label.category, 'route-handler');
  });

  it('detects POST in +server.ts', () => {
    const label = runEndpoint('POST', 'src/routes/+server.ts').find(l => l.detectorId === 'svelte-server-endpoint');
    assert.ok(label, 'should detect POST endpoint');
  });

  it('does not detect GET in regular.js', () => {
    const label = runEndpoint('GET', 'regular.js').find(l => l.detectorId === 'svelte-server-endpoint');
    assert.ok(!label, 'should not detect in regular.js');
  });
});
