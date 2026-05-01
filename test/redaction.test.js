'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PATTERNS, redactContent } = require('../lib/redaction.js');

// ---------------------------------------------------------------------------
// Task 1.1 — baseline: no secrets → no redactions
// ---------------------------------------------------------------------------
describe('baseline', () => {
  it('returns input unchanged when no patterns match', () => {
    const result = redactContent('plain text with no secrets');
    assert.equal(result.text, 'plain text with no secrets');
    assert.deepEqual(result.redactions, []);
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 — AWS access key
// ---------------------------------------------------------------------------
describe('AWS access key', () => {
  it('redacts AKIA… key and reports metadata', () => {
    const result = redactContent("aws_secret = 'AKIAIOSFODNN7EXAMPLE'");
    assert.ok(result.text.includes('[REDACTED:aws_access_key]'), `got: ${result.text}`);
    assert.ok(!result.text.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.equal(result.redactions.length, 1);
    const r = result.redactions[0];
    assert.equal(r.kind, 'aws_access_key');
    assert.equal(r.line, 1);
    assert.equal(r.original_length, 20);
  });
});

// ---------------------------------------------------------------------------
// Task 1.3 — GitHub tokens
// ---------------------------------------------------------------------------
describe('GitHub tokens', () => {
  const prefixes = ['ghp', 'gho', 'ghu', 'ghs', 'ghr'];
  const suffix = 'A'.repeat(36);

  for (const prefix of prefixes) {
    it(`redacts ${prefix}_ token`, () => {
      const token = `${prefix}_${suffix}`;
      const result = redactContent(`token = "${token}"`);
      assert.ok(result.text.includes('[REDACTED:github_token]'), `got: ${result.text}`);
      assert.ok(!result.text.includes(token));
      assert.equal(result.redactions[0].kind, 'github_token');
    });
  }
});

// ---------------------------------------------------------------------------
// Task 1.4 — JWT
// ---------------------------------------------------------------------------
describe('JWT', () => {
  const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0';
  const sig = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const jwt = `${header}.${payload}.${sig}`;

  it('redacts a valid JWT (≥40 chars total)', () => {
    assert.ok(jwt.length >= 40);
    const result = redactContent(`Authorization: Bearer ${jwt}`);
    assert.ok(result.text.includes('[REDACTED:jwt]'), `got: ${result.text}`);
    assert.ok(!result.text.includes(jwt));
    assert.equal(result.redactions[0].kind, 'jwt');
  });

  it('does not redact a short dot-separated string', () => {
    const short = 'a.b.c'; // 5 chars — well under 40
    const result = redactContent(`version: ${short}`);
    assert.ok(!result.text.includes('[REDACTED:jwt]'), `got: ${result.text}`);
    assert.equal(result.redactions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Task 1.5 — Private-key blocks
// ---------------------------------------------------------------------------
describe('private key blocks', () => {
  const types = ['RSA', 'EC', 'OPENSSH', ''];

  for (const type of types) {
    const label = type ? `${type} PRIVATE KEY` : 'PRIVATE KEY';
    it(`redacts -----BEGIN ${label}----- block`, () => {
      const block = `-----BEGIN ${label}-----\nMIIEowIBAAKCAQEA\n-----END ${label}-----`;
      const result = redactContent(block);
      assert.ok(result.text.includes('[REDACTED:private_key_block]'), `got: ${result.text}`);
      assert.ok(!result.text.includes('MIIEowIBAAKCAQEA'));
      assert.equal(result.redactions[0].kind, 'private_key_block');
    });
  }
});

// ---------------------------------------------------------------------------
// Task 1.6 — High-entropy near keyword
// ---------------------------------------------------------------------------
describe('high-entropy near keyword', () => {
  // 60-char high-entropy string (mixed chars → high entropy)
  const highEntropyVal = 'x9Q4mLp7BzN2kRfV8jHtY3sWcDgEoUaPiJbXnZeMqAlOuTrFhSyNvKwGd';
  // 40-char low-entropy string
  const lowEntropyVal = 'a'.repeat(40);

  it('redacts high-entropy string near SECRET keyword on same line', () => {
    const result = redactContent(`const SECRET_KEY = "${highEntropyVal}"`);
    assert.ok(result.text.includes('[REDACTED:high_entropy_near_keyword]'), `got: ${result.text}`);
    assert.equal(result.redactions[0].kind, 'high_entropy_near_keyword');
  });

  it('redacts high-entropy string near keyword within contextWindow lines', () => {
    const lines = ['// SECRET', ...Array(4).fill('// filler'), `value = "${highEntropyVal}"`];
    const result = redactContent(lines.join('\n'));
    assert.ok(result.text.includes('[REDACTED:high_entropy_near_keyword]'), `got: ${result.text}`);
  });

  it('does NOT redact high-entropy string with no keyword nearby', () => {
    // 6 lines of separation (beyond contextWindow of 5)
    const lines = ['// TOKEN', ...Array(6).fill('// filler'), `value = "${highEntropyVal}"`];
    const result = redactContent(lines.join('\n'));
    // Should not contain the high_entropy redaction for this token
    const hasEntropyRedaction = result.redactions.some(r => r.kind === 'high_entropy_near_keyword');
    assert.ok(!hasEntropyRedaction, `unexpected entropy redaction: ${JSON.stringify(result.redactions)}`);
  });

  it('does NOT redact a low-entropy string near a keyword', () => {
    const result = redactContent(`const SECRET = "${lowEntropyVal}"`);
    const hasEntropyRedaction = result.redactions.some(r => r.kind === 'high_entropy_near_keyword');
    assert.ok(!hasEntropyRedaction, `unexpected entropy redaction: ${JSON.stringify(result.redactions)}`);
  });
});

// ---------------------------------------------------------------------------
// Task 1.7 — Multi-rule overlap + extra_patterns
// ---------------------------------------------------------------------------
describe('multi-rule overlap and extra_patterns', () => {
  it('longer match wins when two patterns overlap the same span', () => {
    // Craft a string that matches both aws_access_key and high_entropy_near_keyword.
    // AKIA… is 20 chars; the high-entropy rule requires ≥40 chars, so they won't actually overlap.
    // Instead test with a custom pattern that overlaps a default one.
    const customPattern = {
      name: 'custom_long',
      regex: /AKIA[0-9A-Z]{16}EXTRA/g,
      replacement: '[REDACTED:custom_long]',
    };
    const text = "key = 'AKIAIOSFODNN7EXAMPLEEXTRA'";
    const result = redactContent(text, { patterns: [...DEFAULT_PATTERNS, customPattern] });
    // custom_long is longer (26 chars vs 20 for aws_access_key), starts at same index → should win
    const kinds = result.redactions.map(r => r.kind);
    assert.ok(kinds.includes('custom_long'), `redactions: ${JSON.stringify(result.redactions)}`);
    assert.ok(!kinds.includes('aws_access_key'), `should not have aws_access_key: ${JSON.stringify(result.redactions)}`);
    assert.equal(result.redactions.length, 1);
  });

  it('honors caller-supplied extra_patterns', () => {
    const custom = {
      name: 'my_secret',
      regex: /MYSECRET[0-9]{8}/g,
      replacement: '[REDACTED:my_secret]',
    };
    const result = redactContent('val = MYSECRET12345678', { patterns: [...DEFAULT_PATTERNS, custom] });
    assert.ok(result.text.includes('[REDACTED:my_secret]'), `got: ${result.text}`);
    assert.equal(result.redactions[0].kind, 'my_secret');
  });
});

// ---------------------------------------------------------------------------
// Task 1.8 — Oversize fail-closed
// ---------------------------------------------------------------------------
describe('oversize content', () => {
  it('returns text:null and skipped:true for content >5MB', () => {
    const big = 'a'.repeat(5 * 1024 * 1024 + 1);
    const result = redactContent(big);
    assert.equal(result.text, null);
    assert.deepEqual(result.redactions, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'oversize');
  });
});
