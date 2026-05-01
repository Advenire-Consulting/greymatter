'use strict';

const crypto = require('crypto');

module.exports = function bodyHash(text) {
  if (text === null || text === undefined || text === '') return null;
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
};
