'use strict';

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
});
