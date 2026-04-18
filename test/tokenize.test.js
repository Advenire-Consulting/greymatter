'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, extractTerms, STOPWORDS, MIN_LENGTH } = require('../lib/tokenize');

describe('tokenize', () => {
  it('returns [] for empty or nullish input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(null), []);
    assert.deepEqual(tokenize(undefined), []);
  });

  it('lowercases tokens', () => {
    const tokens = tokenize('Database Schema');
    assert.ok(tokens.includes('database'));
    assert.ok(tokens.includes('schema'));
    assert.ok(!tokens.includes('Database'));
  });

  it('strips HTML tags', () => {
    const tokens = tokenize('<script>malicious</script> benign content here');
    assert.ok(tokens.includes('malicious'));
    assert.ok(tokens.includes('benign'));
    assert.ok(tokens.includes('content'));
    assert.ok(!tokens.some(t => t.includes('<')));
  });

  it('drops stopwords', () => {
    const tokens = tokenize('the data and the function from that code');
    for (const stop of ['the', 'and', 'from', 'that', 'data', 'code', 'function']) {
      assert.ok(!tokens.includes(stop), `should drop stopword "${stop}"`);
    }
  });

  it(`drops tokens below MIN_LENGTH (${MIN_LENGTH})`, () => {
    const tokens = tokenize('a bc def forty');
    assert.ok(!tokens.includes('a'));
    assert.ok(!tokens.includes('bc'));
    assert.ok(!tokens.includes('def'), 'def is 3 chars, below MIN_LENGTH=4');
    assert.ok(tokens.includes('forty'));
  });

  it('allows alphanumeric and underscores, splits on everything else', () => {
    const tokens = tokenize('snake_case + camelCase / kebab-word');
    assert.ok(tokens.includes('snake_case'));
    assert.ok(tokens.includes('camelcase'));
    assert.ok(tokens.includes('kebab'));
    assert.ok(tokens.includes('word'));
  });

  it('keeps numeric-only tokens if long enough', () => {
    const tokens = tokenize('version 2026 build 42');
    assert.ok(tokens.includes('2026'));
    assert.ok(tokens.includes('version'));
    assert.ok(tokens.includes('build'));
    assert.ok(!tokens.includes('42'));
  });
});

describe('extractTerms', () => {
  it('strips <system-reminder> blocks before tokenizing', () => {
    const input = [
      'keep this content',
      '<system-reminder>ignore this entirely including ignored terms</system-reminder> more content',
    ];
    const terms = extractTerms(input);
    assert.ok(terms.includes('keep'));
    assert.ok(!terms.includes('ignore'));
    assert.ok(!terms.includes('ignored'));
  });

  it('returns tokens sorted by frequency descending', () => {
    const input = [
      'bravo bravo bravo',
      'alpha alpha',
      'charlie',
    ];
    const terms = extractTerms(input);
    assert.equal(terms[0], 'bravo', 'most frequent should be first');
    assert.equal(terms[1], 'alpha');
    assert.equal(terms[2], 'charlie');
  });

  it('caps output at 8 terms', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo'.split(' ');
    const input = [words.join(' ')];
    const terms = extractTerms(input);
    assert.equal(terms.length, 8);
  });

  it('STOPWORDS is a Set and contains expected entries', () => {
    assert.ok(STOPWORDS instanceof Set);
    assert.ok(STOPWORDS.has('the'));
    assert.ok(STOPWORDS.has('function'));
  });
});
