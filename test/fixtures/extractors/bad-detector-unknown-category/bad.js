'use strict';

module.exports = {
  extensions: ['.bad-unk-cat'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: 'x', category: 'auth-middleware', defaultTerm: 'X', detect: () => null },
  ],
};
