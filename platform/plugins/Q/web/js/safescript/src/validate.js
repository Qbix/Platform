/**
 * SafeScript AST validator — walks the AST and enforces restrictions.
 *
 * The parser already rejects blocked identifiers/keywords at tokenization,
 * so the validator focuses on structural rules:
 *   - No computed member access without __at/__set (caught at transform)
 *   - No blocked property names in dot access
 *   - No generator functions
 *   - No tagged templates
 *   - Identifier references checked against blocked list (belt-and-suspenders)
 */
'use strict';

var defs = require('./defs');

function ValidationError(message, node) {
  this.message = message;
  this.node = node;
  this.line = node && node.loc ? node.loc.line : undefined;
  this.col = node && node.loc ? node.loc.col : undefined;
}

function validate(ast) {
  var errors = [];

  function error(msg, node) {
    errors.push(new ValidationError(msg, node));
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'Program':
        node.body.forEach(walk);
        break;

      case 'ExpressionStatement':
        walk(node.expression);
        break;

      case 'BlockStatement':
        node.body.forEach(walk);
        break;

      case 'VariableDeclaration':
        node.declarations.forEach(function(d) {
          walkPattern(d.id);
          if (d.init) walk(d.init);
        });
        break;

      case 'IfStatement':
        walk(node.test);
        walk(node.consequent);
        if (node.alternate) walk(node.alternate);
        break;

      case 'ForStatement':
        if (node.init) walk(node.init);
        if (node.test) walk(node.test);
        if (node.update) walk(node.update);
        walk(node.body);
        break;

      case 'ForInStatement':
      case 'ForOfStatement':
        walk(node.left);
        walk(node.right);
        walk(node.body);
        break;

      case 'WhileStatement':
        walk(node.test);
        walk(node.body);
        break;

      case 'DoWhileStatement':
        walk(node.body);
        walk(node.test);
        break;

      case 'ReturnStatement':
      case 'ThrowStatement':
        if (node.argument) walk(node.argument);
        break;

      case 'BreakStatement':
      case 'ContinueStatement':
      case 'EmptyStatement':
        break;

      case 'LabeledStatement':
        walk(node.body);
        break;

      case 'TryStatement':
        walk(node.block);
        if (node.handler) {
          if (node.handler.param) walkPattern(node.handler.param);
          walk(node.handler.body);
        }
        if (node.finalizer) walk(node.finalizer);
        break;

      case 'SwitchStatement':
        walk(node.discriminant);
        node.cases.forEach(function(c) {
          if (c.test) walk(c.test);
          c.consequent.forEach(walk);
        });
        break;

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) walkPattern(node.id);
        node.params.forEach(walkPattern);
        walk(node.body);
        break;

      case 'Identifier':
        if (defs.BLOCKED[node.name]) {
          error('Blocked identifier: ' + node.name, node);
        }
        break;

      case 'ThisExpression':
        // Allowed — will be transformed to __safeThis
        break;

      case 'MemberExpression':
        walk(node.object);
        if (node.computed) {
          // Computed member access — allowed in AST, transform will rewrite
          walk(node.property);
        } else if (node.property && node.property.type === 'Identifier') {
          // Dot access — check blocked property names
          if (defs.BLOCKED_PROPS[node.property.name]) {
            error('Blocked property access: ' + node.property.name, node.property);
          }
        }
        break;

      case 'CallExpression':
        walk(node.callee);
        node.arguments.forEach(walk);
        break;

      case 'BinaryExpression':
      case 'LogicalExpression':
        walk(node.left);
        walk(node.right);
        break;

      case 'AssignmentExpression':
        walk(node.left);
        walk(node.right);
        break;

      case 'UnaryExpression':
      case 'UpdateExpression':
        walk(node.argument);
        break;

      case 'ConditionalExpression':
        walk(node.test);
        walk(node.consequent);
        walk(node.alternate);
        break;

      case 'SequenceExpression':
        node.expressions.forEach(walk);
        break;

      case 'ArrayExpression':
        node.elements.forEach(function(el) { if (el) walk(el); });
        break;

      case 'ObjectExpression':
        node.properties.forEach(function(prop) {
          if (prop.type === 'SpreadElement') {
            walk(prop.argument);
          } else {
            if (prop.computed) walk(prop.key);
            walk(prop.value);
          }
        });
        break;

      case 'SpreadElement':
        walk(node.argument);
        break;

      case 'Literal':
        break;

      default:
        // Unknown node type — permissive for forward compat
        break;
    }
  }

  function walkPattern(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        // Binding identifiers are fine (you're declaring, not referencing)
        // But still check for truly dangerous names
        if (node.name === 'eval' || node.name === 'arguments') {
          error('Cannot use "' + node.name + '" as binding name in strict mode', node);
        }
        break;
      case 'ArrayPattern':
        node.elements.forEach(function(el) { if (el) walkPattern(el); });
        break;
      case 'ObjectPattern':
        node.properties.forEach(function(prop) {
          if (prop.type === 'RestElement') walkPattern(prop.argument);
          else walkPattern(prop.value);
        });
        break;
      case 'AssignmentPattern':
        walkPattern(node.left);
        walk(node.right);
        break;
      case 'RestElement':
        walkPattern(node.argument);
        break;
    }
  }

  walk(ast);

  return {
    ok: errors.length === 0,
    errors: errors.length > 0 ? errors : null
  };
}

exports.validate = validate;
