'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SEED_EDGE_TYPES } = require('../lib/edge-types');

const VALID_CATEGORIES = new Set(['structural', 'data_flow', 'documentary', 'informational']);

describe('SEED_EDGE_TYPES', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(SEED_EDGE_TYPES));
    assert.ok(SEED_EDGE_TYPES.length > 0);
  });

  it('every entry has the required shape', () => {
    for (const et of SEED_EDGE_TYPES) {
      assert.equal(typeof et.name, 'string', `name must be string (got ${JSON.stringify(et)})`);
      assert.ok(VALID_CATEGORIES.has(et.category), `invalid category "${et.category}" for ${et.name}`);
      assert.equal(typeof et.followsForBlastRadius, 'boolean', `${et.name}.followsForBlastRadius must be boolean`);
      assert.equal(typeof et.impliesStaleness, 'boolean', `${et.name}.impliesStaleness must be boolean`);
      assert.equal(typeof et.description, 'string', `${et.name}.description must be string`);
      assert.ok(et.description.length > 0, `${et.name} must have a non-empty description`);
    }
  });

  it('names are unique', () => {
    const names = SEED_EDGE_TYPES.map(et => et.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `duplicate edge-type name(s): ${names.join(', ')}`);
  });

  it('load-bearing baseline types are present', () => {
    const names = new Set(SEED_EDGE_TYPES.map(et => et.name));
    for (const required of ['imports', 'exports', 'calls', 'queries_table', 'describes', 'references']) {
      assert.ok(names.has(required), `missing required edge type: ${required}`);
    }
  });

  it('all structural types follow blast radius', () => {
    const structural = SEED_EDGE_TYPES.filter(et => et.category === 'structural');
    for (const et of structural) {
      assert.equal(et.followsForBlastRadius, true, `structural type ${et.name} should follow for blast radius`);
    }
  });

  it('no informational type follows blast radius or implies staleness', () => {
    const info = SEED_EDGE_TYPES.filter(et => et.category === 'informational');
    for (const et of info) {
      assert.equal(et.followsForBlastRadius, false, `informational ${et.name} should not follow blast radius`);
      assert.equal(et.impliesStaleness, false, `informational ${et.name} should not imply staleness`);
    }
  });
});
