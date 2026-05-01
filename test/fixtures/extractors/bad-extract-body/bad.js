'use strict';

module.exports = {
  extensions: ['.bad-eb'],
  extract: () => ({ nodes: [], edges: [], edge_types: [] }),
  extractBody: 'not-a-function',
};
