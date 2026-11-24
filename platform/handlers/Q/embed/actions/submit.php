<?php

/**
 * @module Q
 */

/**
 * Generic submit action for the declarative embed layer. Does nothing
 * server-side -- just normalizes the payload and lets the parent page
 * handle the event via Q.Users.Embed.on(iframe, 'embed:action', cb).
 * This is the default handler wired to action "submit" in
 * Q/Embed/actions with returnShape: "postMessage".
 *
 * Qbix sites that need a server-side effect for submit should either
 * (a) register a plugin-specific action name in Q/Embed/actions that
 * points at their own handler, or (b) override this registration via
 * config to point at a handler that does the write.
 *
 * @class HTTP Q embed_actions_submit
 * @method handler
 * @param {array} $params
 *   @param {string} $params.name       Action name (always "submit" here).
 *   @param {array}  $params.selections {qeachId => [key, ...]}.
 *   @param {array}  $params.scope      Plain copy of the enclosing Q_scope.
 * @return {array} { payload: {name, selections, scope} }, which the
 *   dispatcher normalizes to { postMessage: true, payload: {...} }.
 */
function Q_embed_actions_submit($params)
{
    return array(
        'payload' => array(
            'name' => $params['name'],
            'selections' => isset($params['selections']) ? $params['selections'] : array(),
            'scope' => isset($params['scope']) ? $params['scope'] : array()
        )
    );
}
