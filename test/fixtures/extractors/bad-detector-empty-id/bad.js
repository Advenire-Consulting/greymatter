'use strict';

module.exports = {
  extensions: ['.bad-emptyid'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: '', category: 'middleware', defaultTerm: 'X', detect: () => null },
  ],
};
