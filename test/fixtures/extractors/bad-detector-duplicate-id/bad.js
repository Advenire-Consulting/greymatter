'use strict';

module.exports = {
  extensions: ['.bad-dupid'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: 'same', category: 'middleware', defaultTerm: 'X', detect: () => null },
    { id: 'same', category: 'middleware', defaultTerm: 'Y', detect: () => null },
  ],
};
