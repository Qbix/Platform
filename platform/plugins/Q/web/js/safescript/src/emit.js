/**
 * SafeScript emitter — AST → JavaScript source.
 *
 * Only produces constructs the emitter explicitly knows about.
 * The grammar IS the allowlist: if a node type isn't handled here,
 * it silently produces nothing (fail-safe).
 */
'use strict';

function emit(node) {
  if (!node) return '';

  switch (node.type) {
    case 'Program':
      return node.body.map(emit).join('\n');

    case 'ExpressionStatement':
      return emit(node.expression) + ';';

    case 'BlockStatement':
      return '{\n' + node.body.map(emit).join('\n') + '\n}';

    case 'EmptyStatement':
      return ';';

    case 'VariableDeclaration':
      return node.kind + ' ' + node.declarations.map(function(d) {
        if (d.init) return emitPattern(d.id) + ' = ' + emit(d.init);
        return emitPattern(d.id);
      }).join(', ') + ';';

    case 'FunctionDeclaration':
      return 'async function ' +
        (node.id ? emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emitFuncBodyWithCheck(node.body);

    case 'FunctionExpression':
      return 'async function' +
        (node.id ? ' ' + emit(node.id) : '') +
        '(' + node.params.map(emitParam).join(', ') + ') ' +
        emitFuncBodyWithCheck(node.body);

    case 'ArrowFunctionExpression':
      var paramsStr;
      if (node.params.length === 1 && node.params[0].type === 'Identifier') {
        paramsStr = emit(node.params[0]);
      } else {
        paramsStr = '(' + node.params.map(emitParam).join(', ') + ')';
      }
      // Arrow with concise body → wrap in block with __check()
      if (node.body.type !== 'BlockStatement') {
        return 'async ' + paramsStr + ' => {\n__check();\nreturn ' + emit(node.body) + ';\n}';
      }
      return 'async ' + paramsStr + ' => ' + emitBodyWithCheck(node.body);

    case 'ReturnStatement':
      return node.argument ? 'return ' + emit(node.argument) + ';' : 'return;';

    case 'ThrowStatement':
      return 'throw ' + emit(node.argument) + ';';

    case 'BreakStatement':
      return node.label ? 'break ' + emit(node.label) + ';' : 'break;';

    case 'ContinueStatement':
      return node.label ? 'continue ' + emit(node.label) + ';' : 'continue;';

    case 'LabeledStatement':
      return emit(node.label) + ': ' + emit(node.body);

    case 'IfStatement':
      var s = 'if (' + emit(node.test) + ') ' + emit(node.consequent);
      if (node.alternate) {
        s += ' else ' + emit(node.alternate);
      }
      return s;

    case 'ForStatement':
      return 'for (' +
        (node.init ? (node.init.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.init) : emit(node.init)) : '') + '; ' +
        (node.test ? emit(node.test) : '') + '; ' +
        (node.update ? emit(node.update) : '') + ') ' +
        emitLoopBody(node.body);

    case 'ForInStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' in ' + emit(node.right) + ') ' + emitLoopBody(node.body);

    case 'ForOfStatement':
      return 'for (' +
        (node.left.type === 'VariableDeclaration' ?
          emitVarDeclNoSemi(node.left) : emit(node.left)) +
        ' of ' + emit(node.right) + ') ' + emitLoopBody(node.body);

    case 'WhileStatement':
      return 'while (' + emit(node.test) + ') ' + emitLoopBody(node.body);

    case 'DoWhileStatement':
      return 'do ' + emitLoopBody(node.body) + ' while (' + emit(node.test) + ');';

    case 'TryStatement':
      var s = 'try ' + emit(node.block);
      if (node.handler) {
        s += ' catch' + (node.handler.param ? ' (' + emitPattern(node.handler.param) + ')' : '') +
          ' ' + emit(node.handler.body);
      }
      if (node.finalizer) {
        s += ' finally ' + emit(node.finalizer);
      }
      return s;

    case 'SwitchStatement':
      return 'switch (' + emit(node.discriminant) + ') {\n' +
        node.cases.map(function(c) {
          var label = c.test ? 'case ' + emit(c.test) + ':\n' : 'default:\n';
          return label + c.consequent.map(emit).join('\n');
        }).join('\n') + '\n}';

    // ── Expressions ──────────────────────────────────────────────

    case 'Identifier':
      return node.name;

    case 'ThisExpression':
      return '__safeThis';

    case 'Literal':
      return node.raw;

    case 'BinaryExpression':
    case 'LogicalExpression':
      var leftStr = emit(node.left);
      // Wrap unary in parens before ** to avoid JS ambiguity error
      if (node.operator === '**' && node.left.type === 'UnaryExpression') {
        leftStr = '(' + leftStr + ')';
      }
      return '(' + leftStr + ' ' + node.operator + ' ' + emit(node.right) + ')';

    case 'AssignmentExpression':
      return emit(node.left) + ' ' + node.operator + ' ' + emit(node.right);

    case 'UnaryExpression':
      if (node.operator === 'typeof' || node.operator === 'void') {
        return node.operator + ' ' + emit(node.argument);
      }
      if (node.prefix) {
        var argStr = emit(node.argument);
        // Wrap in parens to avoid --x or ++x when nesting same unary operators
        if (node.argument.type === 'UnaryExpression' &&
            (node.operator === '-' && node.argument.operator === '-' ||
             node.operator === '+' && node.argument.operator === '+')) {
          argStr = '(' + argStr + ')';
        }
        return node.operator + argStr;
      }
      return emit(node.argument) + node.operator;

    case 'UpdateExpression':
      return node.prefix ? node.operator + emit(node.argument) :
        emit(node.argument) + node.operator;

    case 'ConditionalExpression':
      return '(' + emit(node.test) + ' ? ' + emit(node.consequent) +
        ' : ' + emit(node.alternate) + ')';

    case 'SequenceExpression':
      return '(' + node.expressions.map(emit).join(', ') + ')';

    case 'CallExpression':
      // Method call on non-computed member: obj.method(args) → __call(obj, "method", args)
      if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
        var objStr = emit(node.callee.object);
        var methodName = node.callee.property.name || node.callee.property.value;
        var callFn = node.callee.optional ? '__call_opt' : '__call';
        var callArgs = [objStr, '"' + methodName + '"'];
        node.arguments.forEach(function(a) {
          if (a.type === 'SpreadElement') callArgs.push('...' + emit(a.argument));
          else callArgs.push(emit(a));
        });
        return '(await ' + callFn + '(' + callArgs.join(', ') + '))';
      }
      var calleeStr = emit(node.callee);
      // Wrap arrow/function expression callees in parens for IIFE
      if (node.callee.type === 'ArrowFunctionExpression' ||
          node.callee.type === 'FunctionExpression') {
        calleeStr = '(' + calleeStr + ')';
      }
      return '(await ' + calleeStr + '(' + node.arguments.map(function(a) {
        if (a.type === 'SpreadElement') return '...' + emit(a.argument);
        return emit(a);
      }).join(', ') + '))';

    case 'MemberExpression':
      if (node.computed) {
        return emit(node.object) + '[' + emit(node.property) + ']';
      }
      var op = node.optional ? '?.' : '.';
      return emit(node.object) + op + emit(node.property);

    case 'ArrayExpression':
      return '[' + node.elements.map(function(el) {
        if (!el) return '';
        if (el.type === 'SpreadElement') return '...' + emit(el.argument);
        return emit(el);
      }).join(', ') + ']';

    case 'ObjectExpression':
      if (node.properties.length === 0) return '{}';
      return '{\n' + node.properties.map(function(prop) {
        if (prop.type === 'SpreadElement') return '...' + emit(prop.argument);
        if (prop.shorthand) return emit(prop.key);
        if (prop.method) {
          var fn = prop.value;
          return 'async ' + (prop.computed ? '[' + emit(prop.key) + ']' : emit(prop.key)) +
            '(' + fn.params.map(emitParam).join(', ') + ') ' + emitFuncBodyWithCheck(fn.body);
        }
        var keyStr = prop.computed ? '[' + emit(prop.key) + ']' : emit(prop.key);
        return keyStr + ': ' + emit(prop.value);
      }).join(',\n') + '\n}';

    case 'SpreadElement':
      return '...' + emit(node.argument);

    default:
      // Unknown node → produce nothing (fail-safe)
      return '';
  }
}

/**
 * Emit a function body block with __check() at the top.
 * Used for ArrowFunctionExpression (no __safeThis preamble — inherits from enclosing scope).
 */
function emitBodyWithCheck(blockNode) {
  return '{\n__check();\n' + blockNode.body.map(emit).join('\n') + '\n}';
}

/**
 * Emit a regular function body with __safeThis capture preamble.
 * Used for FunctionDeclaration, FunctionExpression, object methods.
 * Captures __safeThis from __thisCell, then resets the cell.
 * Arrow functions do NOT get this — they inherit __safeThis lexically.
 */
function emitFuncBodyWithCheck(blockNode) {
  return '{\nvar __safeThis = __thisCell.value; __thisCell.value = undefined;\n__check();\n' +
    blockNode.body.map(emit).join('\n') + '\n}';
}

/**
 * Emit a loop body with __check() at the start of each iteration.
 * Handles both block and single-statement bodies.
 */
function emitLoopBody(bodyNode) {
  if (bodyNode.type === 'BlockStatement') {
    return '{\n__check();\n' + bodyNode.body.map(emit).join('\n') + '\n}';
  }
  return '{\n__check();\n' + emit(bodyNode) + '\n}';
}

function emitPattern(node) {
  if (!node) return '';
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'ArrayPattern':
      return '[' + node.elements.map(function(el) {
        if (!el) return '';
        return emitParam(el);
      }).join(', ') + ']';
    case 'ObjectPattern':
      return '{' + node.properties.map(function(prop) {
        if (prop.type === 'RestElement') return '...' + emitPattern(prop.argument);
        if (prop.shorthand) return emitPattern(prop.value);
        return emit(prop.key) + ': ' + emitPattern(prop.value);
      }).join(', ') + '}';
    case 'AssignmentPattern':
      return emitPattern(node.left) + ' = ' + emit(node.right);
    case 'RestElement':
      return '...' + emitPattern(node.argument);
    default:
      return emit(node);
  }
}

function emitParam(node) {
  return emitPattern(node);
}

function emitVarDeclNoSemi(node) {
  return node.kind + ' ' + node.declarations.map(function(d) {
    if (d.init) return emitPattern(d.id) + ' = ' + emit(d.init);
    return emitPattern(d.id);
  }).join(', ');
}

exports.emit = emit;
