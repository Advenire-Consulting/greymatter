// Unit tests for the canonical frontmatter schema and template generator.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMA, renderTemplate, getValidTypes } = require('./schema.js');

test('getValidTypes returns both doc types', () => {
  assert.deepEqual(getValidTypes(), ['spec', 'plan']);
});

test('renderTemplate spec returns a frontmatter block with doc_type: spec', () => {
  const out = renderTemplate('spec');
  assert.match(out, /^---\n/);
  assert.match(out, /\n---\n?$/);
  assert.match(out, /doc_type: spec/);
  assert.doesNotMatch(out, /implements:/);
});

test('renderTemplate plan returns a frontmatter block with implements field', () => {
  const out = renderTemplate('plan');
  assert.match(out, /doc_type: plan/);
  assert.match(out, /implements: /);
});

test('renderTemplate throws on unknown doc type', () => {
  assert.throws(() => renderTemplate('foo'), /doc type/i);
});

test('SCHEMA declares all required scalars', () => {
  assert.ok(SCHEMA.required.doc_type);
  assert.ok(SCHEMA.required.date);
  assert.ok(SCHEMA.required.status);
  assert.ok(SCHEMA.required.feature_area);
});

test('SCHEMA does NOT declare a spec field (decision: id = filename stem)', () => {
  assert.equal(SCHEMA.required.spec, undefined);
});

test('SCHEMA declares all required arrays', () => {
  assert.ok(SCHEMA.requiredArrays['touches.files']);
  assert.ok(SCHEMA.requiredArrays['touches.schema']);
  assert.ok(SCHEMA.requiredArrays['touches.events.emits']);
  assert.ok(SCHEMA.requiredArrays['touches.events.subscribes']);
  assert.ok(SCHEMA.requiredArrays['depends_on']);
});

test('SCHEMA depends_on item shape uses `doc` not `spec`', () => {
  const shape = SCHEMA.requiredArrays['depends_on'].itemShape;
  assert.ok(shape.doc);
  assert.equal(shape.spec, undefined);
});

test('spec_section is requiredFor plan, not spec, on every itemShape that carries it', () => {
  const paths = ['touches.files', 'touches.schema', 'touches.events.emits', 'touches.events.subscribes'];
  for (const p of paths) {
    const shape = SCHEMA.requiredArrays[p].itemShape;
    assert.ok(shape.spec_section, `${p} should declare spec_section`);
    assert.deepEqual(shape.spec_section.requiredFor, ['plan'], `${p}.spec_section requiredFor should be ['plan']`);
    assert.notEqual(shape.spec_section.required, true, `${p}.spec_section should not be unconditionally required`);
  }
});

test('renderTemplate spec does NOT prescribe line refs in the example', () => {
  const out = renderTemplate('spec');
  assert.doesNotMatch(out, /spec_section: L\d+/, 'spec template should not include a line-ref example');
});

test('renderTemplate plan DOES prescribe line refs in the example', () => {
  const out = renderTemplate('plan');
  assert.match(out, /spec_section: L\d+/, 'plan template should include a line-ref example');
});
