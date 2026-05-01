'use strict';

function shannonEntropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const ENTROPY_KEYWORD_RE = /SECRET|KEY|PASSWORD|TOKEN|CREDENTIAL|PRIVATE_KEY|API_KEY/gi;
const HIGH_ENTROPY_TOKEN_RE = /[A-Za-z0-9+/=_-]{40,}/g;

function findHighEntropyMatches(text, contextWindow) {
  const lines = text.split('\n');
  const results = [];

  // Build a set of line indices (0-based) that contain a keyword.
  const keywordLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (ENTROPY_KEYWORD_RE.test(lines[i])) keywordLines.add(i);
    ENTROPY_KEYWORD_RE.lastIndex = 0;
  }

  // Walk every high-entropy token in the full text.
  let m;
  HIGH_ENTROPY_TOKEN_RE.lastIndex = 0;
  while ((m = HIGH_ENTROPY_TOKEN_RE.exec(text)) !== null) {
    const token = m[0];
    if (shannonEntropy(token) < 4.5) continue;
    const tokenLine = lineOf(text, m.index) - 1; // 0-based
    let nearKeyword = false;
    for (
      let li = Math.max(0, tokenLine - contextWindow);
      li <= Math.min(lines.length - 1, tokenLine + contextWindow);
      li++
    ) {
      if (keywordLines.has(li)) { nearKeyword = true; break; }
    }
    if (nearKeyword) {
      results.push({ start: m.index, end: m.index + token.length, token, line1: tokenLine + 1 });
    }
  }
  return results;
}

const DEFAULT_PATTERNS = [
  {
    name: 'aws_access_key',
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED:aws_access_key]',
  },
  {
    name: 'github_token',
    regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,
    replacement: '[REDACTED:github_token]',
  },
  {
    name: 'jwt',
    regex: /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED:jwt]',
    minLength: 40,
  },
  {
    name: 'private_key_block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key_block]',
  },
];

function redactContent(text, options = {}) {
  if (text.length > 5 * 1024 * 1024) {
    process.stderr.write(`redaction: skipped oversize content (${text.length} bytes)\n`);
    return { text: null, redactions: [], skipped: true, reason: 'oversize' };
  }

  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const contextWindow = options.contextWindow ?? 5;

  // Collect all candidate match spans from regex-based patterns.
  const candidates = [];

  for (const pat of patterns) {
    if (pat.name === 'high_entropy_near_keyword') continue; // handled separately
    pat.regex.lastIndex = 0;
    let m;
    while ((m = pat.regex.exec(text)) !== null) {
      const raw = m[0];
      if (pat.minLength && raw.length < pat.minLength) continue;
      candidates.push({
        start: m.index,
        end: m.index + raw.length,
        kind: pat.name,
        replacement: pat.replacement,
        original_length: raw.length,
        line: lineOf(text, m.index),
      });
    }
    pat.regex.lastIndex = 0;
  }

  // High-entropy near-keyword (operates on lines, not a simple regex).
  const entropyPatterns = patterns.filter(p => p.name === 'high_entropy_near_keyword');
  const useEntropyRule = entropyPatterns.length > 0 ||
    // Always run the built-in entropy rule when using DEFAULT_PATTERNS (no explicit override that removed it).
    !options.patterns;

  if (useEntropyRule) {
    const entropyReplacement =
      entropyPatterns.length > 0
        ? entropyPatterns[0].replacement
        : '[REDACTED:high_entropy_near_keyword]';

    for (const hit of findHighEntropyMatches(text, contextWindow)) {
      candidates.push({
        start: hit.start,
        end: hit.end,
        kind: 'high_entropy_near_keyword',
        replacement: entropyReplacement,
        original_length: hit.token.length,
        line: hit.line1,
      });
    }
  }

  // Sort: by start asc, then by length desc (longest-match wins on same start).
  candidates.sort((a, b) => a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start));

  // Greedy non-overlapping sweep.
  const accepted = [];
  let cursor = 0;
  for (const c of candidates) {
    if (c.start < cursor) continue; // overlaps previous — skip
    accepted.push(c);
    cursor = c.end;
  }

  // Build output string.
  let out = '';
  let pos = 0;
  for (const c of accepted) {
    out += text.slice(pos, c.start) + c.replacement;
    pos = c.end;
  }
  out += text.slice(pos);

  const redactions = accepted.map(c => ({ kind: c.kind, line: c.line, original_length: c.original_length }));

  return { text: out, redactions };
}

module.exports = { DEFAULT_PATTERNS, redactContent };
