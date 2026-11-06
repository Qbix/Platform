<?php

/**
 * Validates and sanitizes HTML authored by third parties for rendering on
 * the Qbix origin as an embed. The sanitizer is strict: on the first
 * disallowed tag, attribute, URL scheme, tool, or expression it throws
 * one of the Q_Embed_Exception subclasses. No partial recovery, no
 * silent stripping of structural pieces.
 *
 * Entry point:
 *
 *   $cleaned = Q_Embed_Sanitizer::sanitize($html);
 *   // or, with overrides:
 *   $cleaned = Q_Embed_Sanitizer::sanitize($html, array(
 *       'maxBytes' => 65536,
 *       'allowedTemplates' => '^Embed/',
 *   ));
 *
 * Config is read from Q/Embed.json; see that file for whitelists.
 *
 * Attribute passes:
 *   - 'on*' attributes are rejected whatever element they're on.
 *   - 'style' is rejected entirely (day one; no inline CSS).
 *   - URL-bearing attributes are checked against allowedUrlSchemes.
 *   - On tool custom elements and Q_tool microformat, only the tool's
 *     declared option attributes are allowed; unknown attributes reject.
 *   - On Q/if, the comparison-attribute names must map (via hyphen-to-dot)
 *     to a known path in the vocabulary, and the comparison value must
 *     parse through Q_Embed_Expression.
 *   - On Q/each, the one collection attribute's value must parse, and its
 *     name becomes the row variable.
 *   - 'test', 'key', '${...}', '@{...}' are all validated with
 *     Q_Embed_Expression::validate() or validateBindings().
 *
 * The sanitizer uses DOMDocument with LIBXML_NONET set, which prevents
 * any entity-based network fetches during parsing. Where
 * masterminds/html5 is available it would be a better fit for modern
 * HTML5 semantics; swap it in later if needed.
 *
 * @module Q
 * @class Q_Embed_Sanitizer
 */
class Q_Embed_Sanitizer
{
    /**
     * Document properties that must not be shadowed by id or name
     * attributes on embed elements (DOM clobbering defense).
     */
    private static $documentProps = array(
        'cookie' => 1, 'domain' => 1, 'forms' => 1, 'images' => 1,
        'links' => 1, 'scripts' => 1, 'body' => 1, 'head' => 1,
        'documentelement' => 1, 'defaultview' => 1, 'location' => 1,
        'title' => 1, 'url' => 1, 'referrer' => 1, 'anchors' => 1,
        'characterset' => 1, 'charset' => 1, 'contenttype' => 1,
        'doctype' => 1, 'embeds' => 1, 'plugins' => 1,
        'stylesheets' => 1, 'implementation' => 1,
        'getelementbyid' => 1, 'getelementsbyclassname' => 1,
        'getelementsbyname' => 1, 'getelementsbytagname' => 1,
        'queryselector' => 1, 'queryselectorall' => 1,
        'write' => 1, 'writeln' => 1, 'open' => 1, 'close' => 1,
        'createelement' => 1, 'createtextnode' => 1,
        'createdocumentfragment' => 1, 'createevent' => 1,
        'all' => 1, 'children' => 1, 'firstelementchild' => 1,
        'lastelementchild' => 1,
    );

    /**
     * @method sanitize
     * @static
     * @param {string} $html The embed source.
     * @param {array} [$options=array()] Overrides merged over Q/Embed config.
     * @return {string} The sanitized HTML (DOMDocument-canonicalized).
     * @throws Q_Embed_Exception on any violation.
     */
    static function sanitize($html, array $options = array())
    {
        $config = self::config($options);

        if (!is_string($html)) {
            throw new Q_Embed_Exception_TooLarge(array('bytes' => 0, 'limit' => $config['maxBytes']));
        }
        $bytes = strlen($html);
        if ($bytes > $config['maxBytes']) {
            throw new Q_Embed_Exception_TooLarge(array('bytes' => $bytes, 'limit' => $config['maxBytes']));
        }

        $sanitizer = new self($config);
        return $sanitizer->run($html);
    }

    private $config;
    private $tagSet;
    private $rejectSet;
    private $globalSet;
    private $perTagSet;
    private $urlSet;
    private $schemeSet;
    private $toolMap;
    private $toolTagMap;
    private $targetSet;
    private $vocabRoots;
    private $scopeStack = array();
    private $actionSet;
    private $qeachIds = array();          // ids of <q-each selectable|multiselectable> seen in the embed
    private $pendingActionTargets = array(); // (element, target-id) pairs to check after walk

    private function __construct(array $config)
    {
        $this->config = $config;
        $this->tagSet = array_flip($config['allowedTags']);
        $this->rejectSet = array_flip($config['rejectedTags']);
        $this->globalSet = array_flip($config['globalAttributes']);
        $this->perTagSet = array();
        foreach ($config['perTagAttributes'] as $tag => $attrs) {
            $this->perTagSet[$tag] = array_flip($attrs);
        }
        $this->urlSet = $config['urlAttributes'];
        $this->schemeSet = array_flip($config['allowedUrlSchemes']);
        $this->toolMap = $config['tools'];
        $this->toolTagMap = array();
        foreach ($this->toolMap as $tool => $spec) {
            $this->toolTagMap[self::toolToTag($tool)] = $tool;
        }
        $this->targetSet = array_flip($config['allowedTargets']);
        $this->vocabRoots = isset($config['vocabulary']) ? $config['vocabulary'] : array();
        $this->actionSet = isset($config['actions']) ? $config['actions'] : array();
    }

    /**
     * Parse $html with DOMDocument under LIBXML_NONET, walk the tree with
     * checkElement at each node, resolve any deferred data-action-target
     * references now that every selectable q-each id has been registered,
     * and serialize back. The input is wrapped in a sentinel root div so
     * libxml's loadHTML doesn't inject a <html><body> we'd have to strip,
     * and the serializer emits only the root's children.
     */
    private function run($html)
    {
        $doc = new DOMDocument('1.0', 'UTF-8');
        $prev = libxml_use_internal_errors(true);
        $wrapped = '<?xml encoding="UTF-8"?><div id="__q_embed_root">' . $html . '</div>';
        $flags = LIBXML_NONET | LIBXML_NOENT;
        if (defined('LIBXML_HTML_NOIMPLIED')) $flags |= LIBXML_HTML_NOIMPLIED;
        if (defined('LIBXML_HTML_NODEFDTD')) $flags |= LIBXML_HTML_NODEFDTD;
        $loaded = @$doc->loadHTML($wrapped, $flags);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$loaded) {
            throw new Q_Embed_Exception(array('internal' => 'parse_failed'));
        }

        $root = $doc->getElementById('__q_embed_root');
        if (!$root) {
            // Older PHP versions set id but don't index it; walk manually.
            $root = $this->findRoot($doc);
        }
        if (!$root) {
            throw new Q_Embed_Exception(array('internal' => 'no_root'));
        }

        $this->walk($root);

        // Resolve deferred data-action-target checks now that every <q-each>
        // id has been registered.
        foreach ($this->pendingActionTargets as $pair) {
            list($tag, $targetId) = $pair;
            if (!isset($this->qeachIds[$targetId])) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => 'data-action-target=' . $targetId
                        . ' (no <q-each selectable id="' . $targetId . '">)',
                    'tag' => $tag
                ));
            }
        }

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }
        return $out;
    }

    private function findRoot(DOMDocument $doc)
    {
        $xpath = new DOMXPath($doc);
        $nodes = $xpath->query("//*[@id='__q_embed_root']");
        return $nodes->length ? $nodes->item(0) : null;
    }

    /** Depth-first validation. Comment and processing-instruction nodes are stripped silently. */
    private function walk(DOMNode $node)
    {
        $toRemove = array();
        foreach ($node->childNodes as $child) {
            if ($child->nodeType === XML_COMMENT_NODE || $child->nodeType === XML_PI_NODE) {
                $toRemove[] = $child;
                continue;
            }
            if ($child->nodeType === XML_TEXT_NODE) {
                $this->validateBindings($child->nodeValue, 'text content');
                continue;
            }
            if ($child->nodeType !== XML_ELEMENT_NODE) {
                continue;
            }
            // q-each introduces its alias into the row scope before children
            // are walked; pop it after so sibling scope isn't polluted.
            $alias = null;
            if (strtolower($child->localName) === 'q-each') {
                $alias = $this->resolveQEachAlias($child);
            }
            $this->checkElement($child);
            if ($alias !== null) {
                $this->scopeStack[] = array($alias, 'index', 'key');
            }
            $this->walk($child);
            if ($alias !== null) {
                array_pop($this->scopeStack);
            }
        }
        foreach ($toRemove as $n) {
            $node->removeChild($n);
        }
    }

    /**
     * Find the one attribute on a <q-each> that names the collection and
     * the row alias. Reserved names (id/class/style/slot, key, template,
     * q-live) and data-* are skipped; the first remaining identifier-
     * shaped attribute wins. `items` is renamed to `item` for readability.
     * Must be called before walk descends into the q-each so the alias is
     * on the scope stack while children are validated.
     */
    private function resolveQEachAlias(DOMElement $el)
    {
        $reserved = array('id' => 1, 'class' => 1, 'style' => 1, 'slot' => 1,
            'key' => 1, 'template' => 1, 'q-live' => 1);
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if (isset($reserved[$name])) continue;
            if (strpos($name, 'data-') === 0) continue;
            if (!preg_match('/^[a-z][\w]*$/', $name)) continue;
            return $name === 'items' ? 'item' : $name;
        }
        return null;
    }

    /**
     * Collect the identifier roots that are in scope at this point in the
     * walk: the configured vocabulary plus every q-each alias (and its
     * `index` / `key` siblings) currently on the scope stack. Values are
     * placeholder arrays because the sanitizer only checks the ROOT of
     * each path -- individual leaf access is validated at render time.
     */
    private function currentRoots()
    {
        $roots = $this->vocabRoots;
        foreach ($this->scopeStack as $level) {
            foreach ($level as $alias) {
                $roots[$alias] = array('*');
            }
        }
        return $roots;
    }

    /**
     * Validate an expression's grammar AND check that every path root is
     * in the embed vocabulary (plus any row aliases currently in scope).
     */
    private function validateExpr($source, $context)
    {
        $ast = Q_Embed_Expression::validate($source, $context);
        $roots = $this->currentRoots();
        if (empty($roots)) return;
        foreach (Q_Embed_Expression::pathsOf($ast) as $path) {
            $first = $path[0];
            if (!isset($roots[$first])) {
                throw new Q_Embed_Exception_BadExpression(array(
                    'context' => $context,
                    'source' => $source,
                    'problem' => "unknown root '{$first}'"
                ));
            }
        }
    }

    /**
     * Pull every ${...}, @{...}, ${{...}}, @{{...}} out of $text and
     * run validateExpr on each. Used for text nodes and for plain-
     * attribute values that aren't themselves comparisons or expressions.
     */
    private function validateBindings($text, $context)
    {
        foreach (Q_Embed_Expression::extractBindings($text) as $expr) {
            $this->validateExpr($expr, $context);
        }
    }

    /**
     * Dispatch a single element to the right validator: rejectedTags
     * cause an immediate throw; a registered tool custom-element is
     * handed to checkToolElement; q-if/q-else-if to checkQIf; q-each to
     * checkQEach; a plain tag with class="Q_tool" to
     * checkQtoolMicroformat; everything else to checkPlainAttrs.
     * Returns nothing; throws on any violation.
     */
    private function checkElement(DOMElement $el)
    {
        $tag = strtolower($el->localName);

        if (isset($this->rejectSet[$tag])) {
            throw new Q_Embed_Exception_DisallowedTag(array('tag' => $tag));
        }

        // Tool custom-element tag? Validate as a tool element.
        if (isset($this->toolTagMap[$tag])) {
            $this->checkToolElement($el, $this->toolTagMap[$tag]);
            return;
        }

        if (!isset($this->tagSet[$tag])) {
            throw new Q_Embed_Exception_DisallowedTag(array('tag' => $tag));
        }

        // Q_tool microformat on a plain tag.
        $classes = $el->getAttribute('class');
        if ($classes && preg_match('/(?:^|\s)Q_tool(?:\s|$)/', $classes)) {
            $this->checkQtoolMicroformat($el);
            return;
        }

        if ($tag === 'q-if' || $tag === 'q-else-if') {
            $this->checkQIf($el);
            return;
        }
        if ($tag === 'q-else') {
            $this->checkPlainAttrs($el, $tag);
            return;
        }
        if ($tag === 'q-each') {
            $this->checkQEach($el);
            return;
        }

        $this->checkPlainAttrs($el, $tag);
    }

    /**
     * Validate every attribute on an ordinary (non-tool) element.
     * Reject in order:
     *   - any `on*` event handler;
     *   - `style`, `is`, and XML-namespace attributes;
     *   - names not in globalAttributes or perTagAttributes (data-* and
     *     aria-* get through);
     *   - URL-bearing attributes whose value violates checkUrl;
     *   - id/name values that would shadow a document property
     *     (DOM-clobbering defense);
     *   - data-action values not in the action registry;
     *   - target= values not in allowedTargets.
     * data-action-target is recorded as a pending reference and resolved
     * after the walk (the target q-each may appear later in document).
     * If target=_blank was set without an explicit rel, the configured
     * requiredRelOnTargetBlank is written in.
     * Any other attribute's value is scanned for ${...}/@{...} bindings
     * which are validated as expressions.
     */
    private function checkPlainAttrs(DOMElement $el, $tag)
    {
        $allowedPerTag = isset($this->perTagSet[$tag]) ? $this->perTagSet[$tag] : array();
        $sawTargetBlank = false;
        $sawRel = false;
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if (strpos($name, 'on') === 0) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name, 'tag' => $tag
                ));
            }
            if ($name === 'style' || $name === 'is') {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name, 'tag' => $tag
                ));
            }
            if (strpos($name, 'xmlns') === 0
                || strpos($name, 'xml:') === 0
                || strpos($name, 'xlink:') === 0) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name, 'tag' => $tag
                ));
            }

            if (!isset($this->globalSet[$name])
                && !isset($allowedPerTag[$name])
                && strpos($name, 'data-') !== 0
                && strpos($name, 'aria-') !== 0) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name, 'tag' => $tag
                ));
            }

            if (isset($this->urlSet[$name])) {
                $this->checkUrl($attr->value, $name, $tag);
            }
            // DOM clobbering: reject id/name values that would shadow a
            // document property.
            if (($name === 'id' || $name === 'name')
                && isset(self::$documentProps[strtolower($attr->value)])) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name . '=' . $attr->value, 'tag' => $tag
                ));
            }
            // Declarative actions: validate data-action and data-action-target.
            if ($name === 'data-action') {
                if (!isset($this->actionSet[$attr->value])) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => 'data-action=' . $attr->value, 'tag' => $tag
                    ));
                }
                continue;
            }
            if ($name === 'data-action-target') {
                // Defer the id-exists check to the end of walk, since the
                // target q-each may appear later in the document.
                $this->pendingActionTargets[] = array($tag, $attr->value);
                continue;
            }
            $this->validateBindings($attr->value, $name);

            if ($name === 'target') {
                if (!isset($this->targetSet[$attr->value])) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => 'target=' . $attr->value, 'tag' => $tag
                    ));
                }
                if ($attr->value === '_blank') $sawTargetBlank = true;
            }
            if ($name === 'rel') $sawRel = true;
        }
        if ($sawTargetBlank && !$sawRel && !empty($this->config['requiredRelOnTargetBlank'])) {
            $el->setAttribute('rel', $this->config['requiredRelOnTargetBlank']);
        }
    }

    /**
     * Enforce the URL policy on a value: reject empty, reject
     * protocol-relative (`//host/path`) because its scheme would be
     * inherited from whichever origin the embed is served under, reject
     * any absolute scheme not in allowedUrlSchemes, and accept relative
     * paths or a bare binding marker that will expand at render time.
     * The scheme check is case-insensitive.
     */
    private function checkUrl($value, $attrName, $tag)
    {
        $value = trim($value);
        if ($value === '') {
            throw new Q_Embed_Exception_DisallowedAttribute(array(
                'attribute' => $attrName, 'tag' => $tag, 'value' => '(empty)'
            ));
        }
        // Bindings may expand to a safe URL at render time; a bare marker is OK.
        if ($value !== '' && ($value[0] === '@' || $value[0] === '$')) {
            if (preg_match('/^[@$]\{\{?[^{}]*\}\}?$/', $value)) {
                return;
            }
        }
        // Relative paths (don't start with scheme or '//') are allowed.
        if (strpos($value, '//') === 0) {
            throw new Q_Embed_Exception_DisallowedAttribute(array(
                'attribute' => $attrName, 'tag' => $tag, 'value' => 'protocol-relative'
            ));
        }
        if (!preg_match('/^([a-zA-Z][a-zA-Z0-9+.\-]*):/', $value, $m)) {
            return; // relative URL
        }
        $scheme = strtolower($m[1]);
        if (!isset($this->schemeSet[$scheme])) {
            throw new Q_Embed_Exception_DisallowedAttribute(array(
                'attribute' => $attrName, 'tag' => $tag, 'value' => $scheme . ':'
            ));
        }
    }

    /**
     * Validate a <q-if> or <q-else-if> element. `test=` is unwrapped
     * (strips a @{...}/${...} marker if any) and parsed as a full
     * expression. `template=` runs through checkTemplateName. Reserved
     * attributes (id/class/slot/q-live) are passed; `style` is rejected
     * here as elsewhere. data-* is allowed without validation. Any other
     * attribute name is treated as a comparison attribute, dispatched to
     * checkComparisonAttribute -- so <q-if post-commentCount="> 0"> parses
     * `post.commentCount` as the lhs path and `> 0` as the comparison.
     */
    private function checkQIf(DOMElement $el)
    {
        $tag = strtolower($el->localName);
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if ($name === 'test') {
                $expr = $this->unwrap($attr->value);
                $this->validateExpr($expr, 'test');
                continue;
            }
            if ($name === 'template') {
                $this->checkTemplateName($attr->value);
                continue;
            }
            if ($name === 'q-live' || $name === 'id' || $name === 'class' || $name === 'style' || $name === 'slot') {
                if ($name === 'style') {
                    throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => 'style', 'tag' => $tag));
                }
                continue;
            }
            if (strpos($name, 'data-') === 0) {
                continue;
            }
            if (strpos($name, 'on') === 0) {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }

            // Comparison attribute: name -> dotted path, value -> op + expr.
            $this->checkComparisonAttribute($name, $attr->value, $tag);
        }
    }

    /**
     * Validate a Q/if comparison attribute, where the attribute NAME is a
     * hyphen-to-dot path (`person-age` -> `person.age`) and the attribute
     * VALUE is an optional comparison operator followed by a right-hand
     * expression (e.g. value="> 0" or value=">= @{threshold}"). Both
     * halves are parsed; the root of the path must be in the embed
     * vocabulary. Missing lhs root or empty rhs reject as
     * Q_Embed_Exception_BadExpression.
     */
    private function checkComparisonAttribute($name, $value, $tag)
    {
        $path = str_replace('-', '.', $name);
        $root = strpos($path, '.') === false ? $path : substr($path, 0, strpos($path, '.'));
        if (!empty($this->vocabRoots) && !isset($this->vocabRoots[$root])) {
            throw new Q_Embed_Exception_BadExpression(array(
                'context' => 'comparison attribute',
                'source' => $name,
                'problem' => "root '{$root}' is not in the embed vocabulary"
            ));
        }
        $this->validateExpr($path, 'comparison attribute (left)');

        $value = trim($value);
        if ($value === '') {
            throw new Q_Embed_Exception_BadExpression(array(
                'context' => 'comparison attribute',
                'source' => $name,
                'problem' => 'empty value'
            ));
        }
        $value = $this->unwrap($value);
        $match = null;
        if (preg_match('/^(===|!==|==|!=|>=|<=|>|<)\s*(.*)$/s', $value, $match)) {
            $rhs = trim($match[2]);
        } else {
            $rhs = $value;
        }
        if ($rhs === '') {
            throw new Q_Embed_Exception_BadExpression(array(
                'context' => 'comparison attribute (right)',
                'source' => $name,
                'problem' => 'empty right-hand side'
            ));
        }
        $this->validateExpr($rhs, 'comparison attribute (right)');
    }

    /**
     * Validate a <q-each>. Reserved names (id/class/style/slot/q-live)
     * pass through with the usual style and DOM-clobbering checks; data-*
     * passes; `template=`, `key=`, `selectable`, `multiselectable` are
     * each handled by name; everything else is treated as the one
     * collection-naming attribute (`attendee="event.attendees"`). More
     * than one collection attribute, or no collection at all, is an
     * internal rejection. When selectable/multiselectable is present and
     * an id is set on the element, the id is registered in qeachIds so a
     * later data-action-target can be resolved to it.
     */
    private function checkQEach(DOMElement $el)
    {
        $tag = 'q-each';
        $collectionAttr = null;
        $alias = null;
        $isSelectable = false;
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if (in_array($name, array('id', 'class', 'style', 'slot', 'q-live'), true)) {
                if ($name === 'style') {
                    throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => 'style', 'tag' => $tag));
                }
                if ($name === 'id'
                    && isset(self::$documentProps[strtolower($attr->value)])) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => 'id=' . $attr->value, 'tag' => $tag
                    ));
                }
                continue;
            }
            if (strpos($name, 'data-') === 0) continue;
            if (strpos($name, 'on') === 0) {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if ($name === 'template') {
                $this->checkTemplateName($attr->value);
                continue;
            }
            if ($name === 'key') {
                $expr = $this->unwrap($attr->value);
                $this->validateExpr($expr, 'key');
                continue;
            }
            if ($name === 'selectable' || $name === 'multiselectable') {
                // Boolean presence attribute; value ignored.
                $isSelectable = true;
                continue;
            }
            if (!preg_match('/^[a-z][\w]*$/', $name)) {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if ($collectionAttr !== null) {
                throw new Q_Embed_Exception(array('internal' => 'q-each: more than one collection attribute'));
            }
            $alias = $name === 'items' ? 'item' : $name;
            $expr = $this->unwrap($attr->value);
            $this->validateExpr($expr, 'collection');
            $collectionAttr = $name;
        }
        if ($collectionAttr === null) {
            throw new Q_Embed_Exception(array('internal' => 'q-each: no collection attribute'));
        }
        if ($isSelectable && $el->getAttribute('id')) {
            $this->qeachIds[$el->getAttribute('id')] = true;
        }
    }

    /**
     * Validate a tool custom element (e.g. <streams-preview>). Attributes
     * must be either id/class/slot (with DOM-clobbering check on id), a
     * lazyload signal, or in the tool's configured optionAttributes list.
     * on* / style / is are rejected. URL-bearing attributes run through
     * checkUrl; every value scans for binding markers. Unknown options
     * reject rather than passing silently -- so a tool only ever sees the
     * state it declared.
     */
    private function checkToolElement(DOMElement $el, $toolName)
    {
        $tag = strtolower($el->localName);
        $spec = $this->toolMap[$toolName];
        $allowed = isset($spec['optionAttributes']) ? array_flip($spec['optionAttributes']) : array();
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if ($name === 'id' || $name === 'class' || $name === 'slot') {
                if (($name === 'id') && isset(self::$documentProps[strtolower($attr->value)])) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => $name . '=' . $attr->value, 'tag' => $tag
                    ));
                }
                continue;
            }
            if (strpos($name, 'data-q-lazyload') === 0) continue; // allowed signal
            if (strpos($name, 'on') === 0 || $name === 'style' || $name === 'is') {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if (!isset($allowed[$name])) {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if (isset($this->urlSet[$name])) {
                $this->checkUrl($attr->value, $name, $tag);
            }
            $this->validateBindings($attr->value, $name);
        }
    }

    /**
     * Validate a <div class="Q_tool" data-q-tool="Name Name2"> microformat
     * host element. The names in data-q-tool must all be in the allowed
     * tools list; the union of their option attributes (plus a small
     * fixed set: id/class/slot, data-q-tool / data-q-tool-options /
     * data-q-lazyload, and aria-*) is the allowed attribute set on the
     * host. data-q-tool-options must be valid JSON whose keys are the
     * camel-cased names of those option attributes -- the JSON walker
     * rejects any foreign key and recurses into nested objects.
     */
    private function checkQtoolMicroformat(DOMElement $el)
    {
        $tag = strtolower($el->localName);
        $tools = $el->getAttribute('data-q-tool');
        if (!$tools) {
            throw new Q_Embed_Exception_DisallowedAttribute(array(
                'attribute' => 'class=Q_tool without data-q-tool', 'tag' => $tag
            ));
        }
        $names = preg_split('/\s+/', trim($tools));
        $merged = array();
        foreach ($names as $n) {
            if ($n === '') continue;
            if (!isset($this->toolMap[$n])) {
                throw new Q_Embed_Exception_DisallowedTool(array('tool' => $n));
            }
            foreach ($this->toolMap[$n]['optionAttributes'] as $opt) {
                $merged[$opt] = true;
            }
        }
        // Allowed attribute keys on the host: class, id, slot, data-q-tool,
        // data-q-tool-options, data-q-lazyload, plus any option attribute
        // from the union of the listed tools.
        $allowed = $merged + array(
            'id' => true, 'class' => true, 'slot' => true,
            'data-q-tool' => true, 'data-q-tool-options' => true,
            'data-q-lazyload' => true,
        );
        foreach ($this->attributesOf($el) as $attr) {
            $name = strtolower($attr->name);
            if (strpos($name, 'on') === 0 || $name === 'style' || $name === 'is') {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if (strpos($name, 'aria-') === 0) continue;
            if (!isset($allowed[$name])) {
                throw new Q_Embed_Exception_DisallowedAttribute(array('attribute' => $name, 'tag' => $tag));
            }
            if (($name === 'id' || $name === 'name')
                && isset(self::$documentProps[strtolower($attr->value)])) {
                throw new Q_Embed_Exception_DisallowedAttribute(array(
                    'attribute' => $name . '=' . $attr->value, 'tag' => $tag
                ));
            }
            if ($name === 'data-q-tool-options') {
                $decoded = json_decode($attr->value, true);
                if (!is_array($decoded)) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => 'data-q-tool-options (not valid JSON object)', 'tag' => $tag
                    ));
                }
                $this->checkToolOptionsJson($decoded, $names);
                continue;
            }
            if (isset($this->urlSet[$name])) {
                $this->checkUrl($attr->value, $name, $tag);
            }
            $this->validateBindings($attr->value, $name);
        }
    }

    private function checkToolOptionsJson($decoded, array $toolNames)
    {
        $allowedKeys = array();
        foreach ($toolNames as $n) {
            foreach ($this->toolMap[$n]['optionAttributes'] as $opt) {
                $allowedKeys[self::attrToOptionKey($opt)] = true;
            }
        }
        $this->walkJsonAgainstKeys($decoded, $allowedKeys);
    }

    private function walkJsonAgainstKeys($node, array $allowedKeys)
    {
        if (is_array($node)) {
            foreach ($node as $k => $v) {
                if (is_string($k) && !isset($allowedKeys[$k])) {
                    throw new Q_Embed_Exception_DisallowedAttribute(array(
                        'attribute' => "tool option '{$k}'", 'tag' => 'Q_tool'
                    ));
                }
                if (is_array($v)) $this->walkJsonAgainstKeys($v, $allowedKeys);
            }
        }
    }

    /**
     * Check a template="Name" against Q/Embed/allowedTemplates, which may
     * be a regex string (`^Embed/` is the shipped default), an exact-match
     * array, or null/empty to admit everything. Mismatches throw as
     * Q_Embed_Exception_BadExpression so the author's diagnostic points
     * at the bad name rather than a vague tag-level reject.
     */
    private function checkTemplateName($name)
    {
        $allowed = $this->config['allowedTemplates'];
        if (!$allowed) return;
        if (is_string($allowed)) {
            // Use '#' as the delimiter so a bare '/' in the pattern
            // (the common case: "^Embed/") doesn't need escaping.
            if (!preg_match('#' . $allowed . '#', $name)) {
                throw new Q_Embed_Exception_BadExpression(array(
                    'context' => 'template',
                    'source' => $name,
                    'problem' => 'template name not allowed'
                ));
            }
        } elseif (is_array($allowed) && !in_array($name, $allowed, true)) {
            throw new Q_Embed_Exception_BadExpression(array(
                'context' => 'template',
                'source' => $name,
                'problem' => 'template name not allowed'
            ));
        }
    }

    /** <q-if test="@{expr}"> and bare "@{expr}" both resolve to just the expression. */
    private function unwrap($value)
    {
        $value = trim($value);
        if (preg_match('/^[$@]\{([^{}]*)\}$/', $value, $m)) {
            return $m[1];
        }
        return $value;
    }

    /** DOMNamedNodeMap doesn't play well with foreach when attributes are being replaced; snapshot it. */
    private function attributesOf(DOMElement $el)
    {
        $out = array();
        foreach ($el->attributes as $a) $out[] = $a;
        return $out;
    }

    /** Streams/preview -> streams-preview; Users/avatar -> users-avatar. */
    static function toolToTag($tool)
    {
        return strtolower(str_replace('/', '-', $tool));
    }

    /** publisher-id -> publisherId */
    static function attrToOptionKey($attr)
    {
        return preg_replace_callback('/-([a-z])/', function ($m) {
            return strtoupper($m[1]);
        }, $attr);
    }

    static function config(array $overrides = array())
    {
        $defaults = Q_Config::get('Q', 'Embed', array());
        return array_merge($defaults, $overrides);
    }
}
