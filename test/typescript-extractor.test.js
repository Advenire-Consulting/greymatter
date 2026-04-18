'use strict';

// @tests extractors/typescript.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const extractor = require('../extractors/typescript');

describe('TypeScript Extractor', () => {
  it('has correct extensions', () => {
    assert.deepEqual(extractor.extensions, ['.ts', '.tsx']);
  });

  it('extracts interfaces', () => {
    const result = extractor.extract(
      "export interface UserConfig {\n  name: string;\n  port: number;\n}\n",
      'types.ts', 'p'
    );
    const iface = result.nodes.find(n => n.name === 'UserConfig');
    assert.ok(iface);
    assert.equal(iface.type, 'interface');
  });

  it('extracts type aliases', () => {
    const result = extractor.extract(
      "export type Status = 'active' | 'inactive';\n",
      'types.ts', 'p'
    );
    const alias = result.nodes.find(n => n.name === 'Status');
    assert.ok(alias);
    assert.equal(alias.type, 'type_alias');
  });

  it('extracts enums', () => {
    const result = extractor.extract(
      "enum Color {\n  Red,\n  Green,\n  Blue\n}\n",
      'colors.ts', 'p'
    );
    const enumNode = result.nodes.find(n => n.name === 'Color');
    assert.ok(enumNode);
    assert.equal(enumNode.type, 'enum');
  });

  it('extracts regular JS constructs too', () => {
    const result = extractor.extract(
      "import { foo } from './bar';\nfunction doStuff(): void {}\nexport default doStuff;\n",
      'lib/mod.ts', 'p'
    );
    const fn = result.nodes.find(n => n.name === 'doStuff');
    assert.ok(fn);
    const imports = result.edges.filter(e => e.type === 'imports');
    assert.ok(imports.length >= 1);
  });

  describe('testPairs.parseAnnotations', () => {
    it('captures well-formed same-line annotations', () => {
      const sources = extractor.testPairs.parseAnnotations(
        "// @tests src/foo.ts\nimport { foo } from '../src/foo';\n"
      );
      assert.deepEqual(sources, ['src/foo.ts']);
    });

    it('does not capture across newlines for bare @tests', () => {
      // Matches JS extractor's hardened regex: a bare "// @tests" followed by
      // a newline must NOT silently grab the next non-whitespace token.
      const sources = extractor.testPairs.parseAnnotations(
        "// @tests\nimport { foo } from '../src/foo';\n"
      );
      assert.deepEqual(sources, []);
    });

    it('only scans the first 20 lines', () => {
      const preamble = Array(25).fill('// header').join('\n');
      const sources = extractor.testPairs.parseAnnotations(
        `${preamble}\n// @tests src/late.ts\n`
      );
      assert.deepEqual(sources, []);
    });
  });
});
