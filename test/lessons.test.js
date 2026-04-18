'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOverlaps, surfaceStale, consolidationSuggestion,
  tokenize, jaccard,
} = require('../scripts/lessons');

describe('lessons.tokenize', () => {
  it('lowercases and keeps words of 3+ chars', () => {
    const set = tokenize('Hi The Quick Brown Fox');
    assert.ok(set instanceof Set);
    assert.ok(set.has('quick'));
    assert.ok(set.has('brown'));
    assert.ok(set.has('the'), 'the is 3 chars (>= min length 3)');
    assert.ok(set.has('fox'));
    assert.ok(!set.has('hi'), 'hi is 2 chars (below min length 3)');
  });

  it('returns empty Set for falsy input', () => {
    assert.equal(tokenize(null).size, 0);
    assert.equal(tokenize('').size, 0);
  });

  it('splits on non-alphanumeric', () => {
    const set = tokenize('hello_world, foo-bar/baz');
    assert.ok(set.has('hello'));
    assert.ok(set.has('world'));
    assert.ok(set.has('foo'));
    assert.ok(set.has('bar'));
    assert.ok(set.has('baz'));
  });
});

describe('lessons.jaccard', () => {
  it('returns 0 for two empty sets', () => {
    assert.equal(jaccard(new Set(), new Set()), 0);
  });

  it('returns 1 for identical sets', () => {
    assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  });

  it('returns 0 for disjoint sets', () => {
    assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
  });

  it('computes partial overlap correctly', () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} = 2
    // {a,b,c} ∪ {b,c,d} = {a,b,c,d} = 4
    // 2/4 = 0.5
    assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5);
  });
});

describe('detectOverlaps', () => {
  it('returns [] when fewer than 2 signals', () => {
    assert.deepEqual(detectOverlaps([{ label: 'alone', weight: 50 }]), []);
    assert.deepEqual(detectOverlaps([]), []);
    assert.deepEqual(detectOverlaps(null), []);
  });

  it('filters out archived signals', () => {
    const out = detectOverlaps([
      { id: 1, label: 'mock database tests carefully', weight: 50, archived: true },
      { id: 2, label: 'mock database tests carefully', weight: 50, archived: false },
    ]);
    assert.deepEqual(out, []);
  });

  it('groups signals with similar labels above threshold', () => {
    const groups = detectOverlaps([
      { id: 1, label: 'review pull request carefully', weight: 50 },
      { id: 2, label: 'review pull request thoroughly', weight: 60 },
      { id: 3, label: 'database migration safety', weight: 70 },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 2);
    const ids = groups[0].map(s => s.id).sort();
    assert.deepEqual(ids, [1, 2]);
  });

  it('groups signals with identical file_pattern even if labels differ', () => {
    const groups = detectOverlaps([
      { id: 1, label: 'alpha beta gamma', weight: 50, file_pattern: '**/*.ts' },
      { id: 2, label: 'entirely different words here', weight: 50, file_pattern: '**/*.ts' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 2);
  });

  it('does not group signals with blank file_pattern on both sides', () => {
    const groups = detectOverlaps([
      { id: 1, label: 'alpha unique words', weight: 50 },
      { id: 2, label: 'totally different terms', weight: 50 },
    ]);
    assert.deepEqual(groups, []);
  });
});

describe('surfaceStale', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

  it('surfaces signals older than the cutoff with low weight', () => {
    const stale = surfaceStale([
      { id: 1, label: 'old low', weight: 20, updated_at: daysAgo(365) },
      { id: 2, label: 'old high', weight: 80, updated_at: daysAgo(365) },
      { id: 3, label: 'new low', weight: 20, updated_at: daysAgo(1) },
    ], 6);
    assert.deepEqual(stale.map(s => s.id), [1]);
  });

  it('falls back to created_at when updated_at is missing', () => {
    const stale = surfaceStale([
      { id: 1, label: 'old', weight: 10, created_at: daysAgo(365) },
    ], 6);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, 1);
  });

  it('skips archived signals', () => {
    const stale = surfaceStale([
      { id: 1, label: 'archived', weight: 10, updated_at: daysAgo(365), archived: true },
    ], 6);
    assert.deepEqual(stale, []);
  });

  it('skips signals with unparseable timestamps', () => {
    const stale = surfaceStale([
      { id: 1, label: 'bad ts', weight: 10, updated_at: 'not a date' },
    ], 6);
    assert.deepEqual(stale, []);
  });

  it('honors custom weightCap', () => {
    const stale = surfaceStale([
      { id: 1, label: 'mid', weight: 60, updated_at: daysAgo(365) },
    ], 6, { weightCap: 70 });
    assert.equal(stale.length, 1);
  });
});

describe('consolidationSuggestion', () => {
  it('picks the longest label', () => {
    const out = consolidationSuggestion([
      { id: 1, label: 'short', weight: 50, polarity: '+', type: 'amygdala' },
      { id: 2, label: 'a much longer descriptive label', weight: 40, polarity: '-', type: 'prefrontal' },
    ]);
    assert.equal(out.label, 'a much longer descriptive label');
  });

  it('picks the max weight', () => {
    const out = consolidationSuggestion([
      { id: 1, label: 'a', weight: 50, polarity: '+', type: 'amygdala' },
      { id: 2, label: 'b', weight: 90, polarity: '+', type: 'amygdala' },
    ]);
    assert.equal(out.weight, 90);
  });

  it('concatenates non-empty descriptions with newlines', () => {
    const out = consolidationSuggestion([
      { id: 1, label: 'a', weight: 50, description: 'first', polarity: '+', type: 'amygdala' },
      { id: 2, label: 'b', weight: 40, description: null, polarity: '+', type: 'amygdala' },
      { id: 3, label: 'c', weight: 60, description: 'third', polarity: '+', type: 'amygdala' },
    ]);
    assert.equal(out.description, 'first\nthird');
  });

  it('preserves polarity/type from highest-weight member', () => {
    const out = consolidationSuggestion([
      { id: 1, label: 'low', weight: 30, polarity: '+', type: 'amygdala' },
      { id: 2, label: 'high', weight: 90, polarity: '-', type: 'prefrontal' },
    ]);
    assert.equal(out.polarity, '-');
    assert.equal(out.type, 'prefrontal');
  });

  it('returns ids in member order', () => {
    const out = consolidationSuggestion([
      { id: 5, label: 'a', weight: 50, polarity: '+', type: 'amygdala' },
      { id: 3, label: 'b', weight: 50, polarity: '+', type: 'amygdala' },
    ]);
    assert.deepEqual(out.ids, [5, 3]);
  });

  it('returns null for empty/invalid group', () => {
    assert.equal(consolidationSuggestion([]), null);
    assert.equal(consolidationSuggestion(null), null);
  });
});
