'use strict';

module.exports = {
  extensions: ['.bad-noterm'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  labelDetectors: [
    { id: 'x', category: 'middleware', detect: () => null },
  ],
};
