'use strict';

module.exports = {
  extensions: ['.bad-nocat'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: 'x', defaultTerm: 'X', detect: () => null },
  ],
};
