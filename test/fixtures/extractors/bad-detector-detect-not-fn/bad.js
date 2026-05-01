'use strict';

module.exports = {
  extensions: ['.bad-detectfn'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: 'x', category: 'middleware', defaultTerm: 'X', detect: 'not-a-function' },
  ],
};
