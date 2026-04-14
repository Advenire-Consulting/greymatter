'use strict';

// Consolidation + review helpers for signals. Surfaces candidates only —
// human decides whether to merge, archive, or leave alone.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_JACCARD_THRESHOLD = 0.5;
const DEFAULT_STALE_WEIGHT = 30;

// Tokenize a label for text-similarity — lowercase, alphanumeric words ≥3 chars.
function tokenize(label) {
  if (!label) return new Set();
  return new Set(
    String(label)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3)
  );
}

// Jaccard similarity of two token sets: |A ∩ B| / |A ∪ B|.
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const w of a) if (b.has(w)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// Detect groups of signals with similar labels or identical file_patterns.
// Uses union-find so transitive overlaps cluster into a single group.
function detectOverlaps(signals, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : DEFAULT_JACCARD_THRESHOLD;
  const list = (signals || []).filter(s => s && !s.archived);
  const n = list.length;
  if (n < 2) return [];

  const parent = list.map((_, i) => i);
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i, j) { const ri = find(i); const rj = find(j); if (ri !== rj) parent[ri] = rj; }

  const tokens = list.map(s => tokenize(s.label));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const labelSim = jaccard(tokens[i], tokens[j]);
      const samePattern = list[i].file_pattern
        && list[j].file_pattern
        && list[i].file_pattern === list[j].file_pattern;
      if (labelSim > threshold || samePattern) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(list[i]);
  }
  // Only return groups with 2+ members.
  return [...groups.values()].filter(g => g.length >= 2);
}

// Signals older than N months AND weight below threshold. Uses updated_at if
// present, falling back to created_at.
function surfaceStale(signals, stalenessMonths, opts = {}) {
  const months = stalenessMonths != null ? stalenessMonths : 6;
  const weightCap = opts.weightCap != null ? opts.weightCap : DEFAULT_STALE_WEIGHT;
  const cutoffMs = Date.now() - months * 30 * MS_PER_DAY;

  return (signals || []).filter(s => {
    if (!s || s.archived) return false;
    if (s.weight >= weightCap) return false;
    const ts = s.updated_at || s.created_at;
    if (!ts) return false;
    const t = Date.parse(ts);
    if (isNaN(t)) return false;
    return t < cutoffMs;
  });
}

// Propose a merge: longest label, max weight, concatenated descriptions.
function consolidationSuggestion(group) {
  if (!Array.isArray(group) || group.length === 0) return null;
  const label = group.reduce((best, s) => (s.label && s.label.length > best.length ? s.label : best), '');
  const weight = group.reduce((max, s) => (s.weight > max ? s.weight : max), 0);
  const description = group
    .map(s => s.description)
    .filter(Boolean)
    .join('\n');
  return {
    ids: group.map(s => s.id),
    label,
    weight,
    description: description || null,
    // Preserve polarity/type from the highest-weight member as a sensible default.
    polarity: [...group].sort((a, b) => b.weight - a.weight)[0].polarity,
    type: [...group].sort((a, b) => b.weight - a.weight)[0].type,
  };
}

module.exports = {
  detectOverlaps,
  surfaceStale,
  consolidationSuggestion,
  tokenize,
  jaccard,
};
