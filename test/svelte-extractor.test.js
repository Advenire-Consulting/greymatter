'use strict';

// @tests extractors/svelte.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/svelte');

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
