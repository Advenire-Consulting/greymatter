'use strict';

module.exports = {
  extensions: ['.bad-noid'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { category: 'middleware', defaultTerm: 'X', detect: () => null },
  ],
};
