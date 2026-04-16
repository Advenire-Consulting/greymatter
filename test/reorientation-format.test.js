'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatReorient } = require('../scripts/query');

describe('formatReorient basename disambiguation', () => {
  it('disambiguates colliding basenames with parent directory', () => {
    const entries = [{
      session_id: 'sess-a',
      date: '2026-04-16',
      decisions: ['alpha', 'beta'],
      files: [
        'tools/form-signing/routes/packages.js',
        'tools/form-signing/public/assets/js/packages.js',
      ],
    }];
    const out = formatReorient(entries, 'my-project');
    assert.ok(out.includes('routes/packages.js'), `expected routes/packages.js in:\n${out}`);
    assert.ok(out.includes('js/packages.js'), `expected js/packages.js in:\n${out}`);
    assert.ok(!/packages\.js, packages\.js/.test(out), `unexpected duplicate basenames in:\n${out}`);
  });

  it('leaves unique basenames alone (no unnecessary prefixing)', () => {
    const entries = [{
      session_id: 'sess-b',
      date: '2026-04-16',
      decisions: ['alpha'],
      files: ['lib/foo.js', 'lib/bar.js'],
    }];
    const out = formatReorient(entries, 'my-project');
    assert.ok(/Files: foo\.js, bar\.js/.test(out), `expected bare basenames in:\n${out}`);
  });
});
