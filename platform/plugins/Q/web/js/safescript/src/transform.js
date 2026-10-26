/**
 * SafeScript AST transformer.
 *
 * Rewrites:
 *   obj[key]       → __at(obj, key)
 *   obj[key] = val → __set(obj, key, val)
 *
 * The transform walks the AST and replaces computed MemberExpression
 * nodes with CallExpression nodes that call the runtime guards.
 *
 * Important: assignment/update checks happen BEFORE recursing into
 * children, so the left-hand MemberExpression is still intact.
 */
'use strict';

function transform(ast) {
  return walkNode(ast);
}

function walkNode(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(walkNode);

  // ── Check compound patterns BEFORE recursing ──

  // Assignment to computed member: obj[key] = val → __set(obj, key, val)
  if (node.type === 'AssignmentExpression' && node.operator === '=' &&
      node.left && node.left.type === 'MemberExpression' && node.left.computed) {
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        walkNode(node.left.object),
        walkNode(node.left.property),
        walkNode(node.right)
      ]
    };
  }

  // Compound assignment to computed member: obj[key] += val
  // → __set(obj, key, __at(obj, key) OP val)
  if (node.type === 'AssignmentExpression' && node.operator !== '=' &&
      node.left && node.left.type === 'MemberExpression' && node.left.computed) {
    var baseOp = node.operator.slice(0, -1); // '+=' → '+'
    var obj = walkNode(node.left.object);
    var prop = walkNode(node.left.property);
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        obj,
        prop,
        {
          type: 'BinaryExpression',
          operator: baseOp,
          left: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: '__at' },
            arguments: [obj, prop]
          },
          right: walkNode(node.right)
        }
      ]
    };
  }

  // Update on computed member: obj[key]++ → __set(obj, key, __at(obj, key) + 1)
  if (node.type === 'UpdateExpression' &&
      node.argument && node.argument.type === 'MemberExpression' && node.argument.computed) {
    var delta = node.operator === '++' ? 1 : -1;
    var obj = walkNode(node.argument.object);
    var prop = walkNode(node.argument.property);
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__set' },
      arguments: [
        obj,
        prop,
        {
          type: 'BinaryExpression',
          operator: '+',
          left: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: '__at' },
            arguments: [obj, prop]
          },
          right: { type: 'Literal', value: delta, raw: String(delta) }
        }
      ]
    };
  }

  // ── ThisExpression → __safeThis identifier ──
  if (node.type === 'ThisExpression') {
    return { type: 'Identifier', name: '__safeThis' };
  }

  // ── Now deep-clone + recurse for everything else ──

  var out = {};
  var keys = Object.keys(node);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = node[k];
    if (k === 'loc') { out[k] = v; continue; }
    if (Array.isArray(v)) {
      out[k] = v.map(function(item) {
        return (item && typeof item === 'object' && item.type) ? walkNode(item) : item;
      });
    } else if (v && typeof v === 'object' && v.type) {
      out[k] = walkNode(v);
    } else {
      out[k] = v;
    }
  }

  // Read from computed member: obj[key] → __at(obj, key)
  if (out.type === 'MemberExpression' && out.computed) {
    return {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: '__at' },
      arguments: [out.object, out.property]
    };
  }

  return out;
}

exports.transform = transform;
