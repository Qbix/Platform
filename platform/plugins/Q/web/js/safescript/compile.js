/**
 * SafeScript compiler — orchestrates the pipeline.
 *
 * parse → validate → transform → emit
 *
 * Also provides AST hashing for deduplication/caching.
 */
'use strict';

var parser = require('./parse');
var validator = require('./validate');
var transformer = require('./transform');
var emitter = require('./emit');
var crypto;
try { crypto = require('crypto'); } catch(e) { /* browser */ }

/**
 * Compile SafeScript source to JavaScript.
 *
 * @param {string} source - SafeScript source code
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.sourceMap] - Include source positions (future)
 * @returns {{ code: string, ast: Object, hash: string|null }}
 */
function compile(source) {
  // 1. Parse → AST
  var ast = parser.parse(source);

  // 2. Validate
  var result = validator.validate(ast);
  if (!result.ok) {
    var err = new SyntaxError('SafeScript validation failed: ' +
      result.errors.map(function(e) { return e.message; }).join('; '));
    err.errors = result.errors;
    throw err;
  }

  // 3. Transform (rewrite bracket access → __at/__set)
  var transformed = transformer.transform(ast);

  // 4. Emit JS
  var code = emitter.emit(transformed);

  // 5. Hash the normalized AST (strips positions/whitespace)
  var hash = hashAST(transformed);

  return {
    code: code,
    ast: transformed,
    hash: hash
  };
}

/**
 * Hash the AST for caching/deduplication.
 * Strips position info so whitespace/comment changes
 * don't produce a different hash.
 */
function hashAST(ast) {
  if (!crypto) return null; // no crypto in browser (could polyfill)
  var normalized = JSON.stringify(ast, function(key, value) {
    // Strip location info
    if (key === 'loc' || key === 'line' || key === 'col') return undefined;
    return value;
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

exports.compile = compile;
exports.hashAST = hashAST;
