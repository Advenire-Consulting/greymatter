'use strict';

class McpError extends Error {
  constructor(message, code, jsonRpcCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.jsonRpcCode = jsonRpcCode;
  }
}

class BadRequestError extends McpError {
  constructor(msg) { super(msg, 'BAD_REQUEST', -32602); }
}

class AmbiguousIdentifierError extends McpError {
  constructor(msg) { super(msg, 'AMBIGUOUS_OR_MISSING_LINE', -32602); }
}

class GraphUnavailableError extends McpError {
  constructor(msg) { super(msg, 'GRAPH_UNAVAILABLE', -32000); }
}

class SchemaVersionMismatchError extends McpError {
  constructor(msg) { super(msg, 'SCHEMA_VERSION_MISMATCH', -32000); }
}

class UnknownProjectError extends McpError {
  constructor(msg) { super(msg, 'UNKNOWN_PROJECT', -32602); }
}

module.exports = {
  McpError,
  BadRequestError,
  AmbiguousIdentifierError,
  GraphUnavailableError,
  SchemaVersionMismatchError,
  UnknownProjectError,
};
