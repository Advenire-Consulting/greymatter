'use strict';

module.exports = {
  extensions: ['.good-ext'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  extractBody: (content, node) => null,
  labelDetectors: [
    {
      id: 'good-detector',
      category: 'middleware',
      defaultTerm: 'Good',
      detect: () => null,
    },
  ],
};
