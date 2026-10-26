/**
 * SafeScript parser — tokenizer + recursive descent → AST.
 *
 * The grammar is a subset of JavaScript/ES2020. Constructs not in the
 * grammar (new, delete, class, this, import, etc.) are parse errors.
 * The parser produces an AST loosely following the ESTree spec.
 */
'use strict';

var defs = require('./defs');

// ── Token types ──────────────────────────────────────────────────────
var TT = {
  Ident: 'Ident',
  Number: 'Number',
  String: 'String',
  Regex: 'Regex',
  Template: 'Template',
  Keyword: 'Keyword',
  Punct: 'Punct',
  EOF: 'EOF',
};

// ── String unescape (no eval) ───────────────────────────────────────

var SIMPLE_ESCAPES = {
  'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t',
  'v': '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\'
};

/**
 * Unescape a quoted string token (including its surrounding quotes).
 * Handles standard JS escapes: \n \t \r \b \f \v \0 \' \" \\
 * Unicode: \uXXXX, \u{XXXXX}
 * Hex: \xHH
 * Line continuations: backslash + newline → empty
 * Unknown escapes: kept as-is (e.g. \w → w)
 */
function unescapeString(raw) {
  // Strip surrounding quotes
  var quote = raw[0];
  var inner = raw.slice(1, -1);
  var out = '';
  var i = 0;
  while (i < inner.length) {
    if (inner[i] !== '\\') {
      out += inner[i++];
      continue;
    }
    // Backslash escape
    i++; // skip backslash
    if (i >= inner.length) { out += '\\'; break; }
    var ch = inner[i];

    // Simple single-char escapes
    if (ch in SIMPLE_ESCAPES) {
      out += SIMPLE_ESCAPES[ch];
      i++;
      continue;
    }

    // \xHH
    if (ch === 'x') {
      var hex = inner.slice(i + 1, i + 3);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 3;
      continue;
    }

    // \uXXXX or \u{XXXXX}
    if (ch === 'u') {
      if (inner[i + 1] === '{') {
        var close = inner.indexOf('}', i + 2);
        var cp = parseInt(inner.slice(i + 2, close), 16);
        out += String.fromCodePoint(cp);
        i = close + 1;
      } else {
        var u4 = inner.slice(i + 1, i + 5);
        out += String.fromCharCode(parseInt(u4, 16));
        i += 5;
      }
      continue;
    }

    // Line continuation: \ followed by newline → skip
    if (ch === '\n') { i++; continue; }
    if (ch === '\r') {
      i++;
      if (i < inner.length && inner[i] === '\n') i++;
      continue;
    }

    // Unknown escape → just the character (e.g. \w → w)
    out += ch;
    i++;
  }
  return out;
}

// ── Tokenizer ────────────────────────────────────────────────────────

function Tokenizer(source) {
  this.source = source;
  this.pos = 0;
  this.line = 1;
  this.lineStart = 0;
  this.tokens = [];
  this.index = 0;
  this._tokenize();
}

Tokenizer.prototype._col = function() {
  return this.pos - this.lineStart + 1;
};

Tokenizer.prototype._error = function(msg, line, col) {
  var e = new SyntaxError('SafeScript: ' + msg + ' at line ' + line + ':' + col);
  e.line = line;
  e.col = col;
  throw e;
};

Tokenizer.prototype._push = function(type, value, line, col) {
  this.tokens.push({ type: type, value: value, line: line, col: col });
};

Tokenizer.prototype._tokenize = function() {
  var src = this.source, len = src.length;

  while (this.pos < len) {
    var start = this.pos;
    var line = this.line, col = this._col();
    var ch = src[this.pos];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' ||
        ch === '\v' || ch === '\f') {
      while (this.pos < len) {
        var c = src[this.pos];
        if (c === '\n') { this.line++; this.lineStart = this.pos + 1; }
        else if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\v' && c !== '\f') break;
        this.pos++;
      }
      continue;
    }

    // Single-line comment
    if (ch === '/' && this.pos + 1 < len && src[this.pos + 1] === '/') {
      while (this.pos < len && src[this.pos] !== '\n') this.pos++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && this.pos + 1 < len && src[this.pos + 1] === '*') {
      this.pos += 2;
      while (this.pos < len) {
        if (src[this.pos] === '\n') { this.line++; this.lineStart = this.pos + 1; }
        if (src[this.pos] === '*' && this.pos + 1 < len && src[this.pos + 1] === '/') {
          this.pos += 2; break;
        }
        this.pos++;
      }
      continue;
    }

    // String
    if (ch === '"' || ch === "'") {
      this._readString(ch, line, col);
      continue;
    }

    // Template literal — parse error
    if (ch === '`') {
      this._error('Template literals are not allowed in SafeScript (use string concatenation)', line, col);
    }

    // Number
    if ((ch >= '0' && ch <= '9') ||
        (ch === '.' && this.pos + 1 < len && src[this.pos + 1] >= '0' && src[this.pos + 1] <= '9')) {
      this._readNumber(line, col);
      continue;
    }

    // Identifier or keyword
    if (this._isIdentStart(ch)) {
      this._readIdent(line, col);
      continue;
    }

    // Regex (after non-expression token)
    if (ch === '/' && !this._lastIsExprEnd()) {
      this._readRegex(line, col);
      continue;
    }

    // Punctuation (multi-char first)
    if (this._readPunct(line, col)) continue;

    this._error('Unexpected character: ' + ch, line, col);
  }

  this._push(TT.EOF, '', this.line, this._col());
};

Tokenizer.prototype._isIdentStart = function(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
         ch === '_' || ch === '$';
};

Tokenizer.prototype._isIdentPart = function(ch) {
  return this._isIdentStart(ch) || (ch >= '0' && ch <= '9');
};

Tokenizer.prototype._readString = function(quote, line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  this.pos++; // opening quote
  while (this.pos < len && src[this.pos] !== quote) {
    if (src[this.pos] === '\\') {
      this.pos++;
      if (this.pos < len && src[this.pos] === '\n') { this.line++; this.lineStart = this.pos + 1; }
    }
    this.pos++;
  }
  if (this.pos >= len) this._error('Unterminated string literal', line, col);
  this.pos++; // closing quote
  this._push(TT.String, src.slice(start, this.pos), line, col);
};

Tokenizer.prototype._readNumber = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  var ch = src[this.pos];

  if (ch === '0' && this.pos + 1 < len) {
    var next = src[this.pos + 1];
    if (next === 'x' || next === 'X') {
      this.pos += 2;
      while (this.pos < len && /[0-9a-fA-F_]/.test(src[this.pos])) this.pos++;
    } else if (next === 'b' || next === 'B') {
      this.pos += 2;
      while (this.pos < len && (src[this.pos] === '0' || src[this.pos] === '1' || src[this.pos] === '_')) this.pos++;
    } else if (next === 'o' || next === 'O') {
      this.pos += 2;
      while (this.pos < len && src[this.pos] >= '0' && src[this.pos] <= '7') this.pos++;
    } else {
      this._readDecimal();
    }
  } else {
    this._readDecimal();
  }

  if (this.pos < len && src[this.pos] === 'n') this.pos++; // BigInt
  this._push(TT.Number, src.slice(start, this.pos), line, col);
};

Tokenizer.prototype._readDecimal = function() {
  var src = this.source, len = src.length;
  while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  if (this.pos < len && src[this.pos] === '.') {
    this.pos++;
    while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  }
  if (this.pos < len && (src[this.pos] === 'e' || src[this.pos] === 'E')) {
    this.pos++;
    if (this.pos < len && (src[this.pos] === '+' || src[this.pos] === '-')) this.pos++;
    while (this.pos < len && ((src[this.pos] >= '0' && src[this.pos] <= '9') || src[this.pos] === '_')) this.pos++;
  }
};

Tokenizer.prototype._readIdent = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  while (this.pos < len && this._isIdentPart(src[this.pos])) this.pos++;
  var word = src.slice(start, this.pos);

  // Check blocked identifiers
  if (defs.BLOCKED[word]) {
    this._error('Blocked identifier: ' + word, line, col);
  }
  // Check blocked keywords
  if (defs.BLOCKED_KW[word]) {
    this._error('Blocked keyword: ' + word, line, col);
  }

  if (defs.ALLOWED_KW[word]) {
    this._push(TT.Keyword, word, line, col);
  } else {
    this._push(TT.Ident, word, line, col);
  }
};

Tokenizer.prototype._readRegex = function(line, col) {
  var src = this.source, len = src.length;
  var start = this.pos;
  this.pos++; // opening /
  while (this.pos < len && src[this.pos] !== '/') {
    if (src[this.pos] === '\\') this.pos++;
    if (this.pos < len && src[this.pos] === '[') {
      this.pos++;
      while (this.pos < len && src[this.pos] !== ']') {
        if (src[this.pos] === '\\') this.pos++;
        this.pos++;
      }
    }
    this.pos++;
  }
  if (this.pos >= len) this._error('Unterminated regex', line, col);
  this.pos++; // closing /
  while (this.pos < len && /[gimsuy]/.test(src[this.pos])) this.pos++;
  this._push(TT.Regex, src.slice(start, this.pos), line, col);
};

var PUNCT3 = { '===': 1, '!==': 1, '>>>': 1, '**=': 1, '<<=': 1, '>>=': 1,
               '&&=': 1, '||=': 1, '??=': 1, '...': 1 };
var PUNCT2 = { '==': 1, '!=': 1, '>=': 1, '<=': 1, '&&': 1, '||': 1, '??': 1,
               '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '**': 1,
               '++': 1, '--': 1, '=>': 1, '?.': 1, '<<': 1, '>>': 1,
               '&=': 1, '|=': 1, '^=': 1 };
var PUNCT1 = { '+': 1, '-': 1, '*': 1, '/': 1, '%': 1, '=': 1,
               '<': 1, '>': 1, '!': 1, '&': 1, '|': 1, '^': 1, '~': 1,
               '?': 1, ':': 1, ';': 1, ',': 1, '.': 1,
               '(': 1, ')': 1, '{': 1, '}': 1, '[': 1, ']': 1 };

Tokenizer.prototype._readPunct = function(line, col) {
  var src = this.source;
  if (this.pos + 2 < src.length && PUNCT3[src.slice(this.pos, this.pos + 3)]) {
    this._push(TT.Punct, src.slice(this.pos, this.pos + 3), line, col);
    this.pos += 3; return true;
  }
  if (this.pos + 1 < src.length && PUNCT2[src.slice(this.pos, this.pos + 2)]) {
    this._push(TT.Punct, src.slice(this.pos, this.pos + 2), line, col);
    this.pos += 2; return true;
  }
  if (PUNCT1[src[this.pos]]) {
    this._push(TT.Punct, src[this.pos], line, col);
    this.pos += 1; return true;
  }
  return false;
};

Tokenizer.prototype._lastIsExprEnd = function() {
  if (!this.tokens.length) return false;
  var last = this.tokens[this.tokens.length - 1];
  if (last.type === TT.Ident || last.type === TT.Number ||
      last.type === TT.String || last.type === TT.Regex) return true;
  if (last.type === TT.Keyword && (last.value === 'true' || last.value === 'false' ||
      last.value === 'null' || last.value === 'undefined' || last.value === 'this')) return true;
  if (last.type === TT.Punct && (last.value === ')' || last.value === ']')) return true;
  return false;
};

// ── Parser ───────────────────────────────────────────────────────────

function Parser(source) {
  var tokenizer = new Tokenizer(source);
  this.tokens = tokenizer.tokens;
  this.pos = 0;
}

// ── Token helpers ────────────────────────────────────────────────────

Parser.prototype._cur = function() { return this.tokens[this.pos]; };

Parser.prototype._peek = function(offset) {
  return this.tokens[this.pos + (offset || 0)];
};

Parser.prototype._at = function(type, value) {
  var t = this._cur();
  if (t.type !== type) return false;
  if (value !== undefined && t.value !== value) return false;
  return true;
};

Parser.prototype._eat = function(type, value) {
  var t = this._cur();
  if (t.type !== type || (value !== undefined && t.value !== value)) {
    var expected = value ? type + ' "' + value + '"' : type;
    this._error('Expected ' + expected + ', got ' + t.type + ' "' + t.value + '"');
  }
  this.pos++;
  return t;
};

Parser.prototype._maybe = function(type, value) {
  if (this._at(type, value)) { return this.tokens[this.pos++]; }
  return null;
};

Parser.prototype._error = function(msg) {
  var t = this._cur();
  var e = new SyntaxError('SafeScript: ' + msg + ' at line ' + t.line + ':' + t.col);
  e.line = t.line;
  e.col = t.col;
  throw e;
};

Parser.prototype._loc = function() {
  var t = this._cur();
  return { line: t.line, col: t.col };
};

// ── Program ──────────────────────────────────────────────────────────

Parser.prototype.parseProgram = function() {
  var body = [];
  while (!this._at(TT.EOF)) {
    body.push(this._parseStatement());
  }
  return { type: 'Program', body: body };
};

// ── Statements ───────────────────────────────────────────────────────

Parser.prototype._parseStatement = function() {
  var t = this._cur();

  if (t.type === TT.Keyword) {
    switch (t.value) {
      case 'var': case 'let': case 'const': return this._parseVarDecl();
      case 'if': return this._parseIf();
      case 'for': return this._parseFor();
      case 'while': return this._parseWhile();
      case 'do': return this._parseDoWhile();
      case 'return': return this._parseReturn();
      case 'throw': return this._parseThrow();
      case 'try': return this._parseTry();
      case 'switch': return this._parseSwitch();
      case 'break': return this._parseBreak();
      case 'continue': return this._parseContinue();
      case 'function': return this._parseFunctionDecl();
      case 'async':
        if (this._peek(1) && this._peek(1).type === TT.Keyword &&
            this._peek(1).value === 'function') {
          return this._parseFunctionDecl();
        }
        break;
    }
  }

  if (t.type === TT.Punct && t.value === '{') return this._parseBlock();
  if (t.type === TT.Punct && t.value === ';') { this.pos++; return { type: 'EmptyStatement' }; }

  // Label or expression statement
  var expr = this._parseExpression();
  // Check for label: if expr is Identifier followed by ':'
  if (expr.type === 'Identifier' && this._maybe(TT.Punct, ':')) {
    var labelBody = this._parseStatement();
    return { type: 'LabeledStatement', label: expr, body: labelBody };
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ExpressionStatement', expression: expr };
};

Parser.prototype._parseBlock = function() {
  this._eat(TT.Punct, '{');
  var body = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    body.push(this._parseStatement());
  }
  this._eat(TT.Punct, '}');
  return { type: 'BlockStatement', body: body };
};

Parser.prototype._parseVarDecl = function() {
  var kind = this._eat(TT.Keyword).value; // var, let, const
  var decls = [];
  do {
    var loc = this._loc();
    var target = this._parseBindingTarget();
    var init = null;
    if (this._maybe(TT.Punct, '=')) {
      init = this._parseAssignment();
    }
    decls.push({ type: 'VariableDeclarator', id: target, init: init, loc: loc });
  } while (this._maybe(TT.Punct, ','));
  this._maybe(TT.Punct, ';');
  return { type: 'VariableDeclaration', kind: kind, declarations: decls };
};

Parser.prototype._parseBindingTarget = function() {
  // Supports: identifier, array destructuring, object destructuring
  if (this._at(TT.Punct, '[')) return this._parseArrayPattern();
  if (this._at(TT.Punct, '{')) return this._parseObjectPattern();
  return this._parseIdentifier();
};

Parser.prototype._parseArrayPattern = function() {
  this._eat(TT.Punct, '[');
  var elements = [];
  while (!this._at(TT.Punct, ']') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, ',')) {
      elements.push(null); // elision
      this.pos++;
      continue;
    }
    // Check for rest element
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      elements.push({ type: 'RestElement', argument: this._parseBindingTarget() });
      break;
    }
    var el = this._parseBindingTarget();
    if (this._maybe(TT.Punct, '=')) {
      el = { type: 'AssignmentPattern', left: el, right: this._parseAssignment() };
    }
    elements.push(el);
    if (!this._at(TT.Punct, ']')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ']');
  return { type: 'ArrayPattern', elements: elements };
};

Parser.prototype._parseObjectPattern = function() {
  this._eat(TT.Punct, '{');
  var properties = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      properties.push({ type: 'RestElement', argument: this._parseIdentifier() });
      break;
    }
    var key, computed = false;
    if (this._at(TT.String) || this._at(TT.Number)) {
      key = this._parsePrimary();
    } else {
      key = this._parseIdentifier();
    }
    var value;
    if (this._maybe(TT.Punct, ':')) {
      value = this._parseBindingTarget();
    } else {
      value = key; // shorthand
    }
    if (this._maybe(TT.Punct, '=')) {
      value = { type: 'AssignmentPattern', left: value, right: this._parseAssignment() };
    }
    properties.push({ type: 'Property', key: key, value: value, shorthand: key === value, computed: false });
    if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, '}');
  return { type: 'ObjectPattern', properties: properties };
};

Parser.prototype._parseIdentifier = function() {
  var t = this._eat(TT.Ident);
  return { type: 'Identifier', name: t.value, loc: { line: t.line, col: t.col } };
};

Parser.prototype._parseIf = function() {
  this._eat(TT.Keyword, 'if');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  var consequent = this._parseStatement();
  var alternate = null;
  if (this._maybe(TT.Keyword, 'else')) {
    alternate = this._parseStatement();
  }
  return { type: 'IfStatement', test: test, consequent: consequent, alternate: alternate };
};

Parser.prototype._parseFor = function() {
  this._eat(TT.Keyword, 'for');
  this._eat(TT.Punct, '(');

  // for-in / for-of detection
  // Try to parse init, then check for 'in' or 'of'
  if (this._at(TT.Keyword, 'var') || this._at(TT.Keyword, 'let') || this._at(TT.Keyword, 'const')) {
    var kind = this._eat(TT.Keyword).value;
    var target = this._parseBindingTarget();
    if (this._at(TT.Keyword, 'in')) {
      this.pos++;
      var right = this._parseExpression();
      this._eat(TT.Punct, ')');
      var body = this._parseStatement();
      return { type: 'ForInStatement',
        left: { type: 'VariableDeclaration', kind: kind,
                declarations: [{ type: 'VariableDeclarator', id: target, init: null }] },
        right: right, body: body };
    }
    if (this._at(TT.Keyword, 'of')) {
      this.pos++;
      var right = this._parseExpression();
      this._eat(TT.Punct, ')');
      var body = this._parseStatement();
      return { type: 'ForOfStatement',
        left: { type: 'VariableDeclaration', kind: kind,
                declarations: [{ type: 'VariableDeclarator', id: target, init: null }] },
        right: right, body: body };
    }
    // Regular for — continue parsing init as var declaration
    var init = { type: 'VariableDeclaration', kind: kind,
                 declarations: [{ type: 'VariableDeclarator', id: target, init: null }] };
    if (this._maybe(TT.Punct, '=')) {
      init.declarations[0].init = this._parseAssignment();
    }
    while (this._maybe(TT.Punct, ',')) {
      var t2 = this._parseBindingTarget();
      var i2 = null;
      if (this._maybe(TT.Punct, '=')) i2 = this._parseAssignment();
      init.declarations.push({ type: 'VariableDeclarator', id: t2, init: i2 });
    }
    this._eat(TT.Punct, ';');
    var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
    this._eat(TT.Punct, ';');
    var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
    this._eat(TT.Punct, ')');
    var body = this._parseStatement();
    return { type: 'ForStatement', init: init, test: test, update: update, body: body };
  }

  // No var/let/const — could be for-in/of with existing variable, or regular for
  if (this._at(TT.Punct, ';')) {
    // for (;...;...)
    this.pos++;
    var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
    this._eat(TT.Punct, ';');
    var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForStatement', init: null, test: test, update: update, body: this._parseStatement() };
  }

  var initExpr = this._parseExpression();
  if (this._at(TT.Keyword, 'in')) {
    this.pos++;
    var right = this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForInStatement', left: initExpr, right: right, body: this._parseStatement() };
  }
  if (this._at(TT.Keyword, 'of')) {
    this.pos++;
    var right = this._parseExpression();
    this._eat(TT.Punct, ')');
    return { type: 'ForOfStatement', left: initExpr, right: right, body: this._parseStatement() };
  }
  this._eat(TT.Punct, ';');
  var test = this._at(TT.Punct, ';') ? null : this._parseExpression();
  this._eat(TT.Punct, ';');
  var update = this._at(TT.Punct, ')') ? null : this._parseExpression();
  this._eat(TT.Punct, ')');
  return { type: 'ForStatement', init: initExpr, test: test, update: update, body: this._parseStatement() };
};

Parser.prototype._parseWhile = function() {
  this._eat(TT.Keyword, 'while');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  return { type: 'WhileStatement', test: test, body: this._parseStatement() };
};

Parser.prototype._parseDoWhile = function() {
  this._eat(TT.Keyword, 'do');
  var body = this._parseStatement();
  this._eat(TT.Keyword, 'while');
  this._eat(TT.Punct, '(');
  var test = this._parseExpression();
  this._eat(TT.Punct, ')');
  this._maybe(TT.Punct, ';');
  return { type: 'DoWhileStatement', test: test, body: body };
};

Parser.prototype._parseReturn = function() {
  this._eat(TT.Keyword, 'return');
  var argument = null;
  if (!this._at(TT.Punct, ';') && !this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    argument = this._parseExpression();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ReturnStatement', argument: argument };
};

Parser.prototype._parseThrow = function() {
  this._eat(TT.Keyword, 'throw');
  var argument = this._parseExpression();
  this._maybe(TT.Punct, ';');
  return { type: 'ThrowStatement', argument: argument };
};

Parser.prototype._parseTry = function() {
  this._eat(TT.Keyword, 'try');
  var block = this._parseBlock();
  var handler = null;
  if (this._maybe(TT.Keyword, 'catch')) {
    var param = null;
    if (this._maybe(TT.Punct, '(')) {
      param = this._parseBindingTarget();
      this._eat(TT.Punct, ')');
    }
    handler = { type: 'CatchClause', param: param, body: this._parseBlock() };
  }
  var finalizer = null;
  if (this._maybe(TT.Keyword, 'finally')) {
    finalizer = this._parseBlock();
  }
  return { type: 'TryStatement', block: block, handler: handler, finalizer: finalizer };
};

Parser.prototype._parseSwitch = function() {
  this._eat(TT.Keyword, 'switch');
  this._eat(TT.Punct, '(');
  var disc = this._parseExpression();
  this._eat(TT.Punct, ')');
  this._eat(TT.Punct, '{');
  var cases = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    var test = null;
    if (this._maybe(TT.Keyword, 'case')) {
      test = this._parseExpression();
    } else {
      this._eat(TT.Keyword, 'default');
    }
    this._eat(TT.Punct, ':');
    var consequent = [];
    while (!this._at(TT.Keyword, 'case') && !this._at(TT.Keyword, 'default') &&
           !this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
      consequent.push(this._parseStatement());
    }
    cases.push({ type: 'SwitchCase', test: test, consequent: consequent });
  }
  this._eat(TT.Punct, '}');
  return { type: 'SwitchStatement', discriminant: disc, cases: cases };
};

Parser.prototype._parseBreak = function() {
  this._eat(TT.Keyword, 'break');
  var label = null;
  if (this._at(TT.Ident)) {
    label = this._parseIdentifier();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'BreakStatement', label: label };
};

Parser.prototype._parseContinue = function() {
  this._eat(TT.Keyword, 'continue');
  var label = null;
  if (this._at(TT.Ident)) {
    label = this._parseIdentifier();
  }
  this._maybe(TT.Punct, ';');
  return { type: 'ContinueStatement', label: label };
};

Parser.prototype._parseFunctionDecl = function() {
  var isAsync = false;
  if (this._maybe(TT.Keyword, 'async')) isAsync = true;
  this._eat(TT.Keyword, 'function');
  var id = null;
  if (this._at(TT.Ident)) id = this._parseIdentifier();
  var params = this._parseParams();
  var body = this._parseBlock();
  return { type: 'FunctionDeclaration', id: id, params: params, body: body, async: isAsync };
};

Parser.prototype._parseParams = function() {
  this._eat(TT.Punct, '(');
  var params = [];
  while (!this._at(TT.Punct, ')') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      params.push({ type: 'RestElement', argument: this._parseBindingTarget() });
      break;
    }
    var param = this._parseBindingTarget();
    if (this._maybe(TT.Punct, '=')) {
      param = { type: 'AssignmentPattern', left: param, right: this._parseAssignment() };
    }
    params.push(param);
    if (!this._at(TT.Punct, ')')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ')');
  return params;
};

// ── Expressions (precedence climbing) ────────────────────────────────

Parser.prototype._parseExpression = function() {
  var expr = this._parseAssignment();
  while (this._at(TT.Punct, ',')) {
    this.pos++;
    var right = this._parseAssignment();
    expr = { type: 'SequenceExpression', expressions: expr.type === 'SequenceExpression' ?
             expr.expressions.concat(right) : [expr, right] };
  }
  return expr;
};

Parser.prototype._parseAssignment = function() {
  var left = this._parseConditional();
  var t = this._cur();
  if (t.type === TT.Punct && this._isAssignOp(t.value)) {
    this.pos++;
    var right = this._parseAssignment();
    return { type: 'AssignmentExpression', operator: t.value, left: left, right: right };
  }
  return left;
};

Parser.prototype._isAssignOp = function(op) {
  return op === '=' || op === '+=' || op === '-=' || op === '*=' ||
         op === '/=' || op === '%=' || op === '**=' || op === '<<=' ||
         op === '>>=' || op === '>>>=' || op === '&=' || op === '|=' ||
         op === '^=' || op === '&&=' || op === '||=' || op === '??=';
};

Parser.prototype._parseConditional = function() {
  var expr = this._parseNullishCoalescing();
  if (this._maybe(TT.Punct, '?')) {
    var consequent = this._parseAssignment();
    this._eat(TT.Punct, ':');
    var alternate = this._parseAssignment();
    return { type: 'ConditionalExpression', test: expr, consequent: consequent, alternate: alternate };
  }
  return expr;
};

Parser.prototype._parseNullishCoalescing = function() {
  var left = this._parseLogicalOr();
  while (this._at(TT.Punct, '??')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '??', left: left, right: this._parseLogicalOr() };
  }
  return left;
};

Parser.prototype._parseLogicalOr = function() {
  var left = this._parseLogicalAnd();
  while (this._at(TT.Punct, '||')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '||', left: left, right: this._parseLogicalAnd() };
  }
  return left;
};

Parser.prototype._parseLogicalAnd = function() {
  var left = this._parseBitwiseOr();
  while (this._at(TT.Punct, '&&')) {
    this.pos++;
    left = { type: 'LogicalExpression', operator: '&&', left: left, right: this._parseBitwiseOr() };
  }
  return left;
};

Parser.prototype._parseBitwiseOr = function() {
  var left = this._parseBitwiseXor();
  while (this._at(TT.Punct, '|') && !this._at(TT.Punct, '||')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '|', left: left, right: this._parseBitwiseXor() };
  }
  return left;
};

Parser.prototype._parseBitwiseXor = function() {
  var left = this._parseBitwiseAnd();
  while (this._at(TT.Punct, '^')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '^', left: left, right: this._parseBitwiseAnd() };
  }
  return left;
};

Parser.prototype._parseBitwiseAnd = function() {
  var left = this._parseEquality();
  while (this._at(TT.Punct, '&') && !this._at(TT.Punct, '&&')) {
    this.pos++;
    left = { type: 'BinaryExpression', operator: '&', left: left, right: this._parseEquality() };
  }
  return left;
};

Parser.prototype._parseEquality = function() {
  var left = this._parseRelational();
  while (this._at(TT.Punct, '===') || this._at(TT.Punct, '!==') ||
         this._at(TT.Punct, '==') || this._at(TT.Punct, '!=')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseRelational() };
  }
  return left;
};

Parser.prototype._parseRelational = function() {
  var left = this._parseShift();
  while (this._at(TT.Punct, '<') || this._at(TT.Punct, '>') ||
         this._at(TT.Punct, '<=') || this._at(TT.Punct, '>=') ||
         this._at(TT.Keyword, 'instanceof') || this._at(TT.Keyword, 'in')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseShift() };
  }
  return left;
};

Parser.prototype._parseShift = function() {
  var left = this._parseAdditive();
  while (this._at(TT.Punct, '<<') || this._at(TT.Punct, '>>') || this._at(TT.Punct, '>>>')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseAdditive() };
  }
  return left;
};

Parser.prototype._parseAdditive = function() {
  var left = this._parseMultiplicative();
  while (this._at(TT.Punct, '+') || this._at(TT.Punct, '-')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseMultiplicative() };
  }
  return left;
};

Parser.prototype._parseMultiplicative = function() {
  var left = this._parseExponential();
  while (this._at(TT.Punct, '*') || this._at(TT.Punct, '/') || this._at(TT.Punct, '%')) {
    var op = this._cur().value;
    this.pos++;
    left = { type: 'BinaryExpression', operator: op, left: left, right: this._parseExponential() };
  }
  return left;
};

Parser.prototype._parseExponential = function() {
  var left = this._parseUnary();
  if (this._at(TT.Punct, '**')) {
    this.pos++;
    return { type: 'BinaryExpression', operator: '**', left: left, right: this._parseExponential() };
  }
  return left;
};

Parser.prototype._parseUnary = function() {
  var t = this._cur();
  // Prefix operators
  if (t.type === TT.Punct && (t.value === '-' || t.value === '+' ||
      t.value === '!' || t.value === '~')) {
    this.pos++;
    return { type: 'UnaryExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  if (t.type === TT.Keyword && (t.value === 'typeof' || t.value === 'void')) {
    this.pos++;
    return { type: 'UnaryExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  if (t.type === TT.Keyword && t.value === 'await') {
    this.pos++;
    return { type: 'AwaitExpression', argument: this._parseUnary() };
  }
  // Prefix ++/--
  if (t.type === TT.Punct && (t.value === '++' || t.value === '--')) {
    this.pos++;
    return { type: 'UpdateExpression', operator: t.value, prefix: true, argument: this._parseUnary() };
  }
  return this._parsePostfix();
};

Parser.prototype._parsePostfix = function() {
  var expr = this._parseCallMember();
  var t = this._cur();
  if (t.type === TT.Punct && (t.value === '++' || t.value === '--')) {
    this.pos++;
    return { type: 'UpdateExpression', operator: t.value, prefix: false, argument: expr };
  }
  return expr;
};

Parser.prototype._parseCallMember = function() {
  var expr = this._parsePrimary();

  while (true) {
    if (this._at(TT.Punct, '.') || this._at(TT.Punct, '?.')) {
      var optional = this._cur().value === '?.';
      this.pos++;
      var prop = this._eat(TT.Ident);
      expr = { type: 'MemberExpression', object: expr,
               property: { type: 'Identifier', name: prop.value },
               computed: false, optional: optional };
    } else if (this._at(TT.Punct, '[')) {
      // Bracket access → will be transformed to __at/__set
      this.pos++;
      var prop = this._parseExpression();
      this._eat(TT.Punct, ']');
      expr = { type: 'MemberExpression', object: expr, property: prop,
               computed: true, optional: false };
    } else if (this._at(TT.Punct, '(')) {
      expr = this._parseCallExpr(expr);
    } else {
      break;
    }
  }
  return expr;
};

Parser.prototype._parseCallExpr = function(callee) {
  this._eat(TT.Punct, '(');
  var args = [];
  while (!this._at(TT.Punct, ')') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      args.push({ type: 'SpreadElement', argument: this._parseAssignment() });
    } else {
      args.push(this._parseAssignment());
    }
    if (!this._at(TT.Punct, ')')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ')');
  return { type: 'CallExpression', callee: callee, arguments: args };
};

Parser.prototype._parsePrimary = function() {
  var t = this._cur();

  // Parenthesized expression or arrow function
  if (t.type === TT.Punct && t.value === '(') {
    return this._parseParenOrArrow();
  }

  // Array literal
  if (t.type === TT.Punct && t.value === '[') {
    return this._parseArrayLiteral();
  }

  // Object literal
  if (t.type === TT.Punct && t.value === '{') {
    return this._parseObjectLiteral();
  }

  // Function expression
  if (t.type === TT.Keyword && t.value === 'function') {
    return this._parseFunctionExpr(false);
  }
  if (t.type === TT.Keyword && t.value === 'async' &&
      this._peek(1) && this._peek(1).type === TT.Keyword && this._peek(1).value === 'function') {
    return this._parseFunctionExpr(true);
  }

  // this expression
  if (t.type === TT.Keyword && t.value === 'this') {
    this.pos++;
    return { type: 'ThisExpression', loc: { line: t.line, col: t.col } };
  }

  // Identifier (might be start of arrow: x => ...)
  if (t.type === TT.Ident) {
    var id = this._parseIdentifier();
    // Arrow function: ident => body
    if (this._at(TT.Punct, '=>')) {
      return this._parseArrowBody([id], false);
    }
    return id;
  }

  // Literals
  if (t.type === TT.Number) {
    this.pos++;
    return { type: 'Literal', value: Number(t.value), raw: t.value };
  }
  if (t.type === TT.String) {
    this.pos++;
    var val = unescapeString(t.value);
    return { type: 'Literal', value: val, raw: t.value };
  }
  if (t.type === TT.Regex) {
    this.pos++;
    return { type: 'Literal', raw: t.value, regex: true };
  }
  if (t.type === TT.Keyword) {
    if (t.value === 'true') { this.pos++; return { type: 'Literal', value: true, raw: 'true' }; }
    if (t.value === 'false') { this.pos++; return { type: 'Literal', value: false, raw: 'false' }; }
    if (t.value === 'null') { this.pos++; return { type: 'Literal', value: null, raw: 'null' }; }
    if (t.value === 'undefined') { this.pos++; return { type: 'Identifier', name: 'undefined' }; }
  }

  this._error('Unexpected token: ' + t.type + ' "' + t.value + '"');
};

Parser.prototype._parseParenOrArrow = function() {
  // Save position for backtracking
  var save = this.pos;
  this._eat(TT.Punct, '(');

  // Empty parens → must be arrow params
  if (this._at(TT.Punct, ')')) {
    this._eat(TT.Punct, ')');
    if (this._at(TT.Punct, '=>')) {
      return this._parseArrowBody([], false);
    }
    this._error('Unexpected ()');
  }

  // Try to parse as expression first
  // If we see '=>' after ')', it was arrow params
  var items = [];
  var isArrow = false;

  // Simple heuristic: parse comma-separated list
  // If after closing ) we see =>, treat as arrow params
  try {
    var firstExpr = this._parseAssignment();
    items.push(firstExpr);
    while (this._maybe(TT.Punct, ',')) {
      items.push(this._parseAssignment());
    }
    this._eat(TT.Punct, ')');

    if (this._at(TT.Punct, '=>')) {
      // Arrow function — convert expressions to params
      var params = items.map(function(item) {
        if (item.type === 'Identifier') return item;
        if (item.type === 'AssignmentExpression' && item.operator === '=' &&
            item.left.type === 'Identifier') {
          return { type: 'AssignmentPattern', left: item.left, right: item.right };
        }
        if (item.type === 'SpreadElement' || item.type === 'RestElement') {
          return { type: 'RestElement', argument: item.argument };
        }
        return item; // ObjectPattern, ArrayPattern already work
      });
      return this._parseArrowBody(params, false);
    }

    // Regular parenthesized expression
    if (items.length === 1) return items[0];
    return { type: 'SequenceExpression', expressions: items };
  } catch(e) {
    throw e; // propagate parse error
  }
};

Parser.prototype._parseArrowBody = function(params, isAsync) {
  this._eat(TT.Punct, '=>');
  var body;
  if (this._at(TT.Punct, '{')) {
    body = this._parseBlock();
  } else {
    body = this._parseAssignment();
  }
  return { type: 'ArrowFunctionExpression', params: params, body: body, async: isAsync };
};

Parser.prototype._parseArrayLiteral = function() {
  this._eat(TT.Punct, '[');
  var elements = [];
  while (!this._at(TT.Punct, ']') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, ',')) {
      elements.push(null); // elision
      this.pos++;
      continue;
    }
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      elements.push({ type: 'SpreadElement', argument: this._parseAssignment() });
    } else {
      elements.push(this._parseAssignment());
    }
    if (!this._at(TT.Punct, ']')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, ']');
  return { type: 'ArrayExpression', elements: elements };
};

Parser.prototype._parseObjectLiteral = function() {
  this._eat(TT.Punct, '{');
  var properties = [];
  while (!this._at(TT.Punct, '}') && !this._at(TT.EOF)) {
    if (this._at(TT.Punct, '...')) {
      this.pos++;
      properties.push({ type: 'SpreadElement', argument: this._parseAssignment() });
      if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
      continue;
    }
    var computed = false;
    var key;
    if (this._at(TT.Punct, '[')) {
      // Computed property key — allowed in object literals
      this._eat(TT.Punct, '[');
      key = this._parseAssignment();
      this._eat(TT.Punct, ']');
      computed = true;
    } else if (this._at(TT.String) || this._at(TT.Number)) {
      key = this._parsePrimary();
    } else if (this._at(TT.Ident)) {
      key = this._parseIdentifier();
    } else if (this._at(TT.Keyword)) {
      // Keywords can be property names
      var kw = this._cur();
      this.pos++;
      key = { type: 'Identifier', name: kw.value };
    } else {
      this._error('Expected property name');
    }

    var value, shorthand = false, method = false;
    if (this._at(TT.Punct, '(')) {
      // Method shorthand
      var params = this._parseParams();
      var body = this._parseBlock();
      value = { type: 'FunctionExpression', id: null, params: params, body: body, async: false };
      method = true;
    } else if (this._maybe(TT.Punct, ':')) {
      value = this._parseAssignment();
    } else {
      // Shorthand property
      value = key;
      shorthand = true;
    }

    properties.push({ type: 'Property', key: key, value: value,
                       computed: computed, shorthand: shorthand, method: method });
    if (!this._at(TT.Punct, '}')) this._eat(TT.Punct, ',');
  }
  this._eat(TT.Punct, '}');
  return { type: 'ObjectExpression', properties: properties };
};

Parser.prototype._parseFunctionExpr = function(isAsync) {
  if (isAsync) this._eat(TT.Keyword, 'async');
  this._eat(TT.Keyword, 'function');
  var id = null;
  if (this._at(TT.Ident)) id = this._parseIdentifier();
  var params = this._parseParams();
  var body = this._parseBlock();
  return { type: 'FunctionExpression', id: id, params: params, body: body, async: isAsync };
};

// ── Public API ───────────────────────────────────────────────────────

function parse(source) {
  var parser = new Parser(source);
  return parser.parseProgram();
}

exports.parse = parse;
exports.TT = TT;
