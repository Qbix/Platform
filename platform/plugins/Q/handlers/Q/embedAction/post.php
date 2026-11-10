<?php

/**
 * @module Q
 */

/**
 * Dispatcher for declarative actions coming from a sanitized embed.
 * The embed source can carry data-action="<name>" on buttons, links,
 * or <q-submit> tags. The sanitizer has already verified at save time
 * that <name> appears in Q/Embed/actions and that any data-action-target
 * points at a real selectable or multiselectable q-each inside the same
 * embed, so this handler only has to look the action up and run its
 * registered Qbix event. Posted body is JSON.
 *
 * Posted JSON shape (produced by Q.Embed.fireAction):
 *   {
 *     name:       "submit" | "invite" | ...,
 *     selections: { "<qeach-id>": ["key", ...] },
 *     scope:      { ...whatever Q_scope ancestors carried }
 *   }
 *
 * The registered handler receives those same fields as an $params array
 * and returns one of three return shapes:
 *   { redirect:    "<url>" }
 *   { postMessage: true, payload: {...} }   — parent frame delivery
 *   { inline:      true, payload: {...} }   — merge into the embed scope
 *
 * @class HTTP Q embedAction
 * @method post
 */
function Q_embedAction_post()
{
    // The POST body is JSON (Q.request sets Content-Type: application/json
    // for this endpoint). Fall back to $_REQUEST so plain form posts also
    // work during manual testing.
    $raw = file_get_contents('php://input');
    $body = null;
    if ($raw !== '' && $raw !== false) {
        $body = json_decode($raw, true);
    }
    if (!is_array($body)) {
        $body = $_REQUEST;
    }

    $name = isset($body['name']) ? (string)$body['name'] : '';
    if ($name === '') {
        throw new Q_Exception_RequiredField(array('field' => 'name'), 'name');
    }

    // Look up the action. The sanitizer rejected unknown names at save
    // time, but the config may have changed since; re-check here so a
    // stale embed can't invoke an action that has been retired.
    $spec = Q_Config::get('Q', 'Embed', 'actions', $name, null);
    if (!is_array($spec) || empty($spec['handler'])) {
        throw new Q_Embed_Exception_UnknownAction(array('name' => $name));
    }

    $selections = isset($body['selections']) && is_array($body['selections'])
        ? $body['selections'] : array();
    $scope = isset($body['scope']) && is_array($body['scope'])
        ? $body['scope'] : array();

    // If the action requires a non-empty selection and none was sent,
    // reject before invoking the handler.
    if (!empty($spec['requiredSelection'])) {
        $flat = array();
        foreach ($selections as $keys) {
            if (is_array($keys)) {
                foreach ($keys as $k) { $flat[] = $k; }
            }
        }
        if (empty($flat)) {
            throw new Q_Embed_Exception_EmptySelection(array('name' => $name));
        }
    }

    $params = array(
        'name' => $name,
        'selections' => $selections,
        'scope' => $scope,
        'spec' => $spec
    );

    // Hand off to the registered Qbix event.
    $result = Q::event($spec['handler'], $params);
    if (!is_array($result)) {
        $result = array();
    }

    // If the handler didn't name a return shape, fall back to the
    // declared one. Normalize the output so the client can switch on it.
    $shape = isset($spec['returnShape']) ? $spec['returnShape'] : 'inline';
    $out = array();
    switch ($shape) {
        case 'redirect':
            $out['redirect'] = isset($result['redirect']) ? $result['redirect'] : '/';
            break;
        case 'postMessage':
            $out['postMessage'] = true;
            $out['payload'] = isset($result['payload']) ? $result['payload'] : $result;
            break;
        case 'inline':
        default:
            $out['inline'] = true;
            $out['payload'] = isset($result['payload']) ? $result['payload'] : $result;
            break;
    }

    Q_Response::setSlot('result', $out);
    return $out;
}
