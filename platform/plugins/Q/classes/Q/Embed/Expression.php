<?php

/**
 * PHP port of the restricted-grammar expression parser from
 * platform/plugins/Q/web/js/methods/Q/Template/bind.js. Used by the Q/Embed
 * sanitizer to validate every ${...}, @{...}, test, Q/each collection
 * attribute, Q/if comparison attribute value, and key attribute at save
 * time. This class is a validator -- it parses and discards the AST.
 * Interpretation happens on the client at render time.
 *
 * Grammar supported (identical to the client):
 *   expr      := or
 *   or        := and ('||' and)*
 *   and       := equality ('&&' equality)*
 *   equality  := compare (('===' | '!==' | '==' | '!=') compare)*
 *   compare   := additive (('<' | '>' | '<=' | '>=') additive)*
 *   additive  := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary     := ('!' | '-') unary | primary
 *   primary   := literal | path | '(' expr ')'
 *   literal   := number | string | 'true' | 'false' | 'null'
 *   path      := identifier ('.' identifier)*
 *
 * Function calls, [] indexing, new, typeof, this, assignment, template
 * literals, and property access to constructor / __proto__ / prototype
 * are rejected at parse time.
 *
 * @module Q
 * @class Q_Embed_Expression
 */
class Q_Embed_Expression
{
    private $context;
    private $source;
    private $compiled;
    private $tokens;
    private $i = 0;

    static $banned = array(
        'constructor' => true, '__proto__' => true, 'prototype' => true,
        '__defineGetter__' => true, '__defineSetter__' => true,
        '__lookupGetter__' => true, '__lookupSetter__' => true,
    );

    /**
     * Parse an expression; return the AST on success, throw on failure.
     *
     * @method validate
     * @static
     * @param {string} $source The expression source.
     * @param {string} [$context='expression'] Label for error messages.
     * @return {array} AST (opaque to callers; use for debugging only).
     * @throws Q_Embed_Exception_BadExpression on any parse failure.
     */
    static function validate($source, $context = 'expression')
    {
        $parser = new self($source, $context);
        return $parser->parse();
    }

    /**
     * Scan $text for every ${...}, @{...}, ${{...}}, @{{...}} marker and
     * validate the enclosed expression. Markers may appear in text nodes
     * or attribute values; call per-source.
     *
     * @method validateBindings
     * @static
     * @param {string} $text Any text that may contain binding markers.
     * @param {string} [$context='binding'] Label passed to error messages.
     * @throws Q_Embed_Exception_BadExpression on any parse failure.
     */
    static function validateBindings($text, $context = 'binding')
    {
        foreach (self::extractBindings($text) as $expr) {
            self::validate($expr, $context);
        }
    }

    /**
     * Return every expression source embedded in $text as ${...}, @{...},
     * ${{...}} or @{{...}}. Caller validates each (optionally with scope
     * awareness beyond grammar).
     *
     * @method extractBindings
     * @static
     * @param {string} $text
     * @return {array} Array of expression source strings.
     */
    static function extractBindings($text)
    {
        $out = array();
        if (preg_match_all(
            '/(@\{\{([^{}]*)\}\}|\$\{\{([^{}]*)\}\}|@\{([^{}]*)\}|\$\{([^{}]*)\})/',
            $text,
            $matches,
            PREG_SET_ORDER
        )) {
            foreach ($matches as $m) {
                for ($k = 2; $k <= 5; $k++) {
                    if (isset($m[$k]) && $m[$k] !== '') {
                        $out[] = $m[$k];
                        break;
                    }
                }
            }
        }
        return $out;
    }

    /**
     * Walk an AST and collect every path (array of segments). Used by the
     * sanitizer to check that each root segment is in the embed vocabulary.
     *
     * @method pathsOf
     * @static
     * @param {array} $ast
     * @return {array} Array of path arrays.
     */
    static function pathsOf($ast)
    {
        $out = array();
        self::collectPaths($ast, $out);
        return $out;
    }

    private static function collectPaths($ast, array &$out)
    {
        if (!is_array($ast) || !isset($ast['op'])) return;
        if ($ast['op'] === 'path') {
            $out[] = $ast['path'];
            return;
        }
        foreach (array('left', 'right', 'operand') as $k) {
            if (isset($ast[$k])) self::collectPaths($ast[$k], $out);
        }
    }

    private function __construct($source, $context)
    {
        $this->source = $source;
        $this->context = $context;
    }

    private function parse()
    {
        $this->compiled = self::compile(trim($this->source), $this->context, $this->source);
        $this->tokens = self::tokenize($this->compiled, $this->context, $this->source);
        $this->i = 0;
        $ast = $this->parseOr();
        if ($this->i !== count($this->tokens)) {
            $leftover = $this->tokens[$this->i];
            self::fail("unexpected '{$leftover['text']}'");
        }
        return $ast;
    }

    private function fail($problem)
    {
        throw new Q_Embed_Exception_BadExpression(array(
            'context' => $this->context,
            'source' => $this->source,
            'problem' => $problem,
        ));
    }

    /**
     * PHP port of the client's compile(): rewrites `person-name` as
     * `person.name` outside strings, and rejects subtraction without
     * surrounding whitespace.
     */
    static function compile($input, $context = 'expression', $raw = '')
    {
        $output = '';
        $L = strlen($input);
        $i = 0;
        while ($i < $L) {
            $c = $input[$i];
            if ($c === '"' || $c === "'") {
                $quote = $c;
                $output .= $c;
                $i++;
                $closed = false;
                while ($i < $L) {
                    $c = $input[$i++];
                    $output .= $c;
                    if ($c === '\\' && $i < $L) {
                        $output .= $input[$i++];
                    } else if ($c === $quote) {
                        $closed = true;
                        break;
                    }
                }
                if (!$closed) {
                    throw new Q_Embed_Exception_BadExpression(array(
                        'context' => $context,
                        'source' => $raw ?: $input,
                        'problem' => 'unclosed string',
                    ));
                }
                continue;
            }
            if (preg_match('/[A-Za-z_$]/', $c)) {
                $start = $i++;
                while ($i < $L && preg_match('/[\w$]/', $input[$i])) {
                    $i++;
                }
                $word = substr($input, $start, $i - $start);
                while (isset($input[$i]) && $input[$i] === '-'
                    && isset($input[$i + 1])
                    && preg_match('/[A-Za-z_$]/', $input[$i + 1])) {
                    $i++;
                    $partStart = $i++;
                    while ($i < $L && preg_match('/[\w$]/', $input[$i])) {
                        $i++;
                    }
                    $word .= '.' . substr($input, $partStart, $i - $partStart);
                }
                $output .= $word;
                continue;
            }
            if ($c === '-') {
                $prev = $i > 0 ? $input[$i - 1] : '';
                $next = $i + 1 < $L ? $input[$i + 1] : '';
                $flankedBySpace = preg_match('/\s/', $prev) && preg_match('/\s/', $next);
                $unaryBeforeDigit = preg_match('/[0-9]/', $next)
                    && ($i === 0 || preg_match('/[=(,+*\/!?:]/', $prev));
                if (!$flankedBySpace && !$unaryBeforeDigit) {
                    throw new Q_Embed_Exception_BadExpression(array(
                        'context' => $context,
                        'source' => $raw ?: $input,
                        'problem' => 'subtraction needs spaces',
                    ));
                }
            }
            $output .= $c;
            $i++;
        }
        return $output;
    }

    /**
     * Tokenize a compiled expression into typed tokens. Whitespace is
     * skipped; strings consume their closing quote; numbers accept decimal
     * and exponent forms; identifiers allow `_` and `$` and continue
     * through word characters; punctuation covers `.` and parens; the rest
     * is operator characters (ordered so three-char ops like `===` win
     * before two-char ones like `==` and single-char ones like `=` -- note
     * that `=` alone is NOT accepted, only inside `==` / `===`).
     *
     * Any character the tokenizer doesn't recognize throws
     * Q_Embed_Exception_BadExpression rather than being silently skipped.
     *
     * @method tokenize
     * @static
     * @param {string} $source The compiled expression source.
     * @param {string} $context Label for errors.
     * @param {string} [$raw] Original pre-compile source, used in errors.
     * @return {array} List of token arrays.
     */
    static function tokenize($source, $context, $raw = '')
    {
        $tokens = array();
        $i = 0;
        $L = strlen($source);
        while ($i < $L) {
            $c = $source[$i];
            if (ctype_space($c)) { $i++; continue; }

            if ($c === '"' || $c === "'") {
                $quote = $c;
                $str = '';
                $i++;
                while ($i < $L && $source[$i] !== $quote) {
                    if ($source[$i] === '\\' && $i + 1 < $L) {
                        $next = $source[$i + 1];
                        $esc = $next === 'n' ? "\n"
                            : ($next === 't' ? "\t"
                            : ($next === 'r' ? "\r"
                            : ($next === '\\' ? '\\'
                            : ($next === $quote ? $quote : $next))));
                        $str .= $esc;
                        $i += 2;
                    } else {
                        $str .= $source[$i++];
                    }
                }
                if ($i >= $L) {
                    throw new Q_Embed_Exception_BadExpression(array(
                        'context' => $context,
                        'source' => $raw ?: $source,
                        'problem' => 'unclosed string',
                    ));
                }
                $i++;
                $tokens[] = array('type' => 'string', 'value' => $str, 'text' => '"' . $str . '"');
                continue;
            }

            if ($c >= '0' && $c <= '9') {
                $start = $i;
                while ($i < $L && $source[$i] >= '0' && $source[$i] <= '9') $i++;
                if (isset($source[$i]) && $source[$i] === '.'
                    && isset($source[$i + 1])
                    && $source[$i + 1] >= '0' && $source[$i + 1] <= '9') {
                    $i++;
                    while ($i < $L && $source[$i] >= '0' && $source[$i] <= '9') $i++;
                }
                if (isset($source[$i]) && ($source[$i] === 'e' || $source[$i] === 'E')) {
                    $i++;
                    if (isset($source[$i]) && ($source[$i] === '+' || $source[$i] === '-')) $i++;
                    while ($i < $L && $source[$i] >= '0' && $source[$i] <= '9') $i++;
                }
                $text = substr($source, $start, $i - $start);
                $tokens[] = array('type' => 'number', 'value' => floatval($text), 'text' => $text);
                continue;
            }

            if (preg_match('/[A-Za-z_$]/', $c)) {
                $is = $i;
                while ($i < $L && preg_match('/[\w$]/', $source[$i])) $i++;
                $tokens[] = array('type' => 'ident', 'text' => substr($source, $is, $i - $is));
                continue;
            }

            $two = isset($source[$i + 1]) ? $source[$i] . $source[$i + 1] : '';
            $three = isset($source[$i + 2]) ? $two . $source[$i + 2] : '';

            if ($three === '===' || $three === '!==') {
                $tokens[] = array('type' => 'op', 'text' => $three); $i += 3; continue;
            }
            if (in_array($two, array('==', '!=', '<=', '>=', '&&', '||'), true)) {
                $tokens[] = array('type' => 'op', 'text' => $two); $i += 2; continue;
            }
            if (strpos('<>!+-*/%', $c) !== false) {
                $tokens[] = array('type' => 'op', 'text' => $c); $i++; continue;
            }
            if ($c === '.' || $c === '(' || $c === ')') {
                $tokens[] = array('type' => 'punct', 'text' => $c); $i++; continue;
            }

            throw new Q_Embed_Exception_BadExpression(array(
                'context' => $context,
                'source' => $raw ?: $source,
                'problem' => "unexpected character '{$c}'",
            ));
        }
        return $tokens;
    }

    /** Consume the current token if it is the operator $text and return true. */
    private function matchOp($text)
    {
        if (isset($this->tokens[$this->i])
            && $this->tokens[$this->i]['type'] === 'op'
            && $this->tokens[$this->i]['text'] === $text) {
            $this->i++;
            return true;
        }
        return false;
    }

    /** Consume the current token if it is any operator in $texts and return its text. */
    private function matchAnyOp(array $texts)
    {
        if (isset($this->tokens[$this->i])
            && $this->tokens[$this->i]['type'] === 'op'
            && in_array($this->tokens[$this->i]['text'], $texts, true)) {
            $text = $this->tokens[$this->i]['text'];
            $this->i++;
            return $text;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Recursive-descent parser. One method per grammar level, lowest
    // precedence first. Each method consumes its own left operand from
    // the previous level, then repeatedly folds in right operands while
    // its operator keeps matching. The resulting AST has the shape
    //   {op: <op>, left: <ast>, right: <ast>}  for binary ops,
    //   {op: 'u<op>', operand: <ast>}          for unary ops,
    //   {op: 'lit',  value: <literal>}         for literals,
    //   {op: 'path', path: [segments]}         for identifier chains.
    // Interpretation happens on the client; this class only validates.
    // ------------------------------------------------------------------

    /** `expr := and ('||' and)*` -- lowest precedence; builds left-folded ||. */
    private function parseOr()
    {
        $left = $this->parseAnd();
        while ($this->matchOp('||')) {
            $left = array('op' => '||', 'left' => $left, 'right' => $this->parseAnd());
        }
        return $left;
    }

    /** `and := equality ('&&' equality)*` */
    private function parseAnd()
    {
        $left = $this->parseEquality();
        while ($this->matchOp('&&')) {
            $left = array('op' => '&&', 'left' => $left, 'right' => $this->parseEquality());
        }
        return $left;
    }

    /** `equality := compare (('===' | '!==' | '==' | '!=') compare)*` */
    private function parseEquality()
    {
        $left = $this->parseCompare();
        while (($op = $this->matchAnyOp(array('===', '!==', '==', '!=')))) {
            $left = array('op' => $op, 'left' => $left, 'right' => $this->parseCompare());
        }
        return $left;
    }

    /** `compare := additive (('<' | '>' | '<=' | '>=') additive)*` */
    private function parseCompare()
    {
        $left = $this->parseAdditive();
        while (($op = $this->matchAnyOp(array('<=', '>=', '<', '>')))) {
            $left = array('op' => $op, 'left' => $left, 'right' => $this->parseAdditive());
        }
        return $left;
    }

    /** `additive := multiplicative (('+' | '-') multiplicative)*` */
    private function parseAdditive()
    {
        $left = $this->parseMultiplicative();
        while (($op = $this->matchAnyOp(array('+', '-')))) {
            $left = array('op' => $op, 'left' => $left, 'right' => $this->parseMultiplicative());
        }
        return $left;
    }

    /** `multiplicative := unary (('*' | '/' | '%') unary)*` */
    private function parseMultiplicative()
    {
        $left = $this->parseUnary();
        while (($op = $this->matchAnyOp(array('*', '/', '%')))) {
            $left = array('op' => $op, 'left' => $left, 'right' => $this->parseUnary());
        }
        return $left;
    }

    /** `unary := ('!' | '-') unary | primary` -- right-associative. */
    private function parseUnary()
    {
        if (($op = $this->matchAnyOp(array('!', '-')))) {
            return array('op' => 'u' . $op, 'operand' => $this->parseUnary());
        }
        return $this->parsePrimary();
    }

    /**
     * `primary := literal | path | '(' expr ')'`.
     * Identifier chains walk through `.` punctuation; every segment after
     * the first is checked against the banned-property set so a path like
     * `foo.constructor` or `foo.__proto__` is rejected at parse time.
     * `undefined` is admitted as an alias for `null` to keep the grammar
     * forgiving to authors coming from plain JS.
     */
    private function parsePrimary()
    {
        if (!isset($this->tokens[$this->i])) {
            $this->fail('unexpected end of expression');
        }
        $t = $this->tokens[$this->i];

        if ($t['type'] === 'number') {
            $this->i++;
            return array('op' => 'lit', 'value' => $t['value']);
        }
        if ($t['type'] === 'string') {
            $this->i++;
            return array('op' => 'lit', 'value' => $t['value']);
        }
        if ($t['type'] === 'ident') {
            if ($t['text'] === 'true') { $this->i++; return array('op' => 'lit', 'value' => true); }
            if ($t['text'] === 'false') { $this->i++; return array('op' => 'lit', 'value' => false); }
            if ($t['text'] === 'null') { $this->i++; return array('op' => 'lit', 'value' => null); }
            if ($t['text'] === 'undefined') { $this->i++; return array('op' => 'lit', 'value' => null); }

            $path = array($t['text']);
            $this->i++;
            while (isset($this->tokens[$this->i])
                && $this->tokens[$this->i]['type'] === 'punct'
                && $this->tokens[$this->i]['text'] === '.') {
                $this->i++;
                if (!isset($this->tokens[$this->i])
                    || $this->tokens[$this->i]['type'] !== 'ident') {
                    $this->fail('expected identifier after .');
                }
                $next = $this->tokens[$this->i]['text'];
                if (isset(self::$banned[$next])) {
                    $this->fail("property '{$next}' is not allowed");
                }
                $path[] = $next;
                $this->i++;
            }
            return array('op' => 'path', 'path' => $path);
        }
        if ($t['type'] === 'punct' && $t['text'] === '(') {
            $this->i++;
            $inner = $this->parseOr();
            if (!isset($this->tokens[$this->i])
                || $this->tokens[$this->i]['type'] !== 'punct'
                || $this->tokens[$this->i]['text'] !== ')') {
                $this->fail('expected )');
            }
            $this->i++;
            return $inner;
        }
        $this->fail("unexpected '{$t['text']}'");
    }
}
