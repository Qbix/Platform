<?php

/**
 * Base exception for Q/Embed sanitizer rejections. Specific subclasses
 * identify what failed; the sanitizer throws one on the first problem it
 * finds and does not attempt partial recovery.
 *
 * @module Q
 * @class Q_Embed_Exception
 * @extends Q_Exception
 */
class Q_Embed_Exception extends Q_Exception
{
}

/**
 * Thrown when a tag not on the whitelist appears in the embed source.
 *
 * @class Q_Embed_Exception_DisallowedTag
 * @extends Q_Embed_Exception
 * @param {string} $tag Lowercased tag name.
 */
class Q_Embed_Exception_DisallowedTag extends Q_Embed_Exception
{
}

/**
 * Thrown when an attribute not on the whitelist appears, or when a URL
 * attribute carries a disallowed scheme.
 *
 * @class Q_Embed_Exception_DisallowedAttribute
 * @extends Q_Embed_Exception
 * @param {string} $attribute Attribute name.
 * @param {string} $tag Element tag the attribute was on.
 * @param {string} [$value] Attribute value, included for URL-scheme failures.
 */
class Q_Embed_Exception_DisallowedAttribute extends Q_Embed_Exception
{
}

/**
 * Thrown when a {$...} or @{...} binding contains an expression that fails
 * the restricted-grammar parser, or when a Q/if comparison attribute or
 * Q/each collection attribute carries an invalid expression.
 *
 * @class Q_Embed_Exception_BadExpression
 * @extends Q_Embed_Exception
 * @param {string} $context Where the expression came from (e.g. "test",
 *   "person-age", "collection attribute").
 * @param {string} $source The expression source.
 * @param {string} $problem What specifically failed.
 */
class Q_Embed_Exception_BadExpression extends Q_Embed_Exception
{
}

/**
 * Thrown when a tool name on a <div class="Q_tool"> or on a tool custom
 * element isn't on the embed whitelist.
 *
 * @class Q_Embed_Exception_DisallowedTool
 * @extends Q_Embed_Exception
 * @param {string} $tool The tool name.
 */
class Q_Embed_Exception_DisallowedTool extends Q_Embed_Exception
{
}

/**
 * Thrown when the embed source exceeds the configured size limit or when
 * parsing exceeds the configured time budget.
 *
 * @class Q_Embed_Exception_TooLarge
 * @extends Q_Embed_Exception
 * @param {int} $bytes The input size in bytes.
 * @param {int} $limit The configured limit.
 */
class Q_Embed_Exception_TooLarge extends Q_Embed_Exception
{
}

Q_Exception::add(
    'Q_Embed_Exception_DisallowedTag',
    'embed rejected: tag <$tag> is not allowed'
);
Q_Exception::add(
    'Q_Embed_Exception_DisallowedAttribute',
    'embed rejected: attribute "$attribute" on <$tag> is not allowed'
);
Q_Exception::add(
    'Q_Embed_Exception_BadExpression',
    'embed rejected: expression in $context failed to parse ($problem): $source'
);
Q_Exception::add(
    'Q_Embed_Exception_DisallowedTool',
    'embed rejected: tool "$tool" is not on the whitelist'
);
Q_Exception::add(
    'Q_Embed_Exception_TooLarge',
    'embed rejected: $bytes bytes exceeds limit of $limit bytes'
);

/**
 * Thrown by Q_embedAction_post when the posted action name is not in
 * Q/Embed/actions. The sanitizer rejects unknown names at save time,
 * so reaching this at dispatch time means the action has been retired
 * from config since the embed was saved, or a client bypassed the
 * sanitizer.
 *
 * @class Q_Embed_Exception_UnknownAction
 * @extends Q_Embed_Exception
 * @param {string} $name Posted action name.
 */
class Q_Embed_Exception_UnknownAction extends Q_Embed_Exception
{
}
Q_Exception::add(
    'Q_Embed_Exception_UnknownAction',
    'embed action "$name" is not registered'
);

/**
 * Thrown by Q_embedAction_post when an action declared
 * requiredSelection: true was posted with no selections.
 *
 * @class Q_Embed_Exception_EmptySelection
 * @extends Q_Embed_Exception
 * @param {string} $name Posted action name.
 */
class Q_Embed_Exception_EmptySelection extends Q_Embed_Exception
{
}
Q_Exception::add(
    'Q_Embed_Exception_EmptySelection',
    'embed action "$name" requires at least one selection'
);
