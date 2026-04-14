'use strict';

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
});
