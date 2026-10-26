/**
 * SafeScript .safe file header parser.
 *
 * Parses the leading /** ... * / block for:
 *   @safescript <version>
 *   @env <env1>, <env2>, ...
 *   @needs <name>: <Type>
 *   @uses <name>: <Type>
 *   @type TypeName { method1, method2 }
 */
'use strict';

/**
 * Extract the first /** ... * / block from source.
 * Returns the inner text (without the comment delimiters), or null.
 */
function extractHeader(source) {
  var s = source.trimStart();
  if (s.indexOf('/**') !== 0) return null;
  var end = s.indexOf('*/');
  if (end < 0) return null;
  return s.slice(3, end);
}

/**
 * Parse a header block into structured data.
 *
 * Returns {
 *   version: string|null,
 *   env: string[]|null,         // null if no @env declared
 *   needs: [{name, type}],
 *   uses: [{name, type}]
 * }
 */
function parseHeader(source) {
  var result = {
    version: null,
    env: null,
    needs: [],
    uses: [],
    types: []
  };

  var text = extractHeader(source);
  if (!text) return result;

  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    // Strip leading whitespace and * prefix
    var line = lines[i].replace(/^\s*\*?\s?/, '').trim();
    if (!line) continue;

    // @safescript <version>
    var m = line.match(/^@safescript\s+(.+)$/);
    if (m) {
      result.version = m[1].trim();
      continue;
    }

    // @env <env1>, <env2>, ...
    m = line.match(/^@env\s+(.+)$/);
    if (m) {
      result.env = m[1].split(',').map(function(e) { return e.trim(); }).filter(Boolean);
      continue;
    }

    // @needs <name>: <Type>
    m = line.match(/^@needs\s+(\w+)\s*:\s*(.+)$/);
    if (m) {
      result.needs.push({ name: m[1], type: m[2].trim() });
      continue;
    }

    // @needs <name> (no type)
    m = line.match(/^@needs\s+(\w+)\s*$/);
    if (m) {
      result.needs.push({ name: m[1], type: null });
      continue;
    }

    // @uses <name>: <Type>
    m = line.match(/^@uses\s+(\w+)\s*:\s*(.+)$/);
    if (m) {
      result.uses.push({ name: m[1], type: m[2].trim() });
      continue;
    }

    // @uses <name> (no type)
    m = line.match(/^@uses\s+(\w+)\s*$/);
    if (m) {
      result.uses.push({ name: m[1], type: null });
      continue;
    }

    // @type TypeName { method1, method2 }
    m = line.match(/^@type\s+(\w+)\s*\{\s*([^}]*)\}/);
    if (m) {
      var methods = m[2].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      result.types.push({ name: m[1], methods: methods });
      continue;
    }
  }

  return result;
}

/**
 * Validate that a scope object satisfies the header's @needs.
 * Returns { ok: boolean, missing: string[] }
 */
function checkScope(header, scope) {
  var missing = [];
  if (!header || !header.needs) return { ok: true, missing: missing };

  var keys = scope ? Object.keys(scope) : [];
  var available = Object.create(null);
  for (var i = 0; i < keys.length; i++) {
    available[keys[i]] = 1;
  }

  for (var j = 0; j < header.needs.length; j++) {
    var name = header.needs[j].name;
    if (!available[name]) {
      missing.push(name);
    }
  }

  return { ok: missing.length === 0, missing: missing };
}

exports.parseHeader = parseHeader;
exports.checkScope = checkScope;
