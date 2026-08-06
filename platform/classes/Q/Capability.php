<?php

/**
 * Represents a capability signed by our server.
 *
 * A capability can be constructed from any of four forms:
 *
 *  1. its components: new Q_Capability(array('Users/intent'), $data, $start, $end)
 *  2. another Q_Capability (copy constructor)
 *  3. the compact string form returned by __toString(), e.g.
 *     "perm1+perm2,1700000000,1700100000;<serializedData>;<sig>"
 *  4. the flattened array form returned by exportArray(), or a JSON string of
 *     it, e.g. {"token":"abc","permissions":["i"],"startTime":..,"Q.sig":".."}
 *
 * Form 4 matters because it is what crosses the wire to Node: the client sends
 * JSON.stringify(capability) in socket.handshake.auth.capability, and
 * Q/classes/Q/Socket.js does JSON.parse() on it. Anything handing a capability
 * to a browser or to Node should use exportArray(), not (string) -- the compact
 * form exists for URLs and will not survive JSON.parse().
 *
 * Note that exportArray()/toArray() FLATTEN $data to the top level rather than
 * nesting it under a "data" key. A capability minted with
 * data => array('token' => 'abc') therefore arrives at Node as
 * capability.token, not capability.data.token.
 *
 * @module Q
 * @class Q_Capability
 * @constructor
 * @param {array|string|Q_Capability} $permissions Either an array of permission
 *   strings, a serialized capability string, a JSON string, an exported array,
 *   or another Q_Capability.
 * @param {array} [$data=array()] Optional associative data array, when passing
 *   a plain list of permissions as the first argument
 * @param {integer} [$startTime=null] Start timestamp
 * @param {integer} [$endTime=null] End timestamp
 */
class Q_Capability
{
	function __construct(
		$permissions,
		$data = array(),
		$startTime = null,
		$endTime = null
	) {
		if ($permissions instanceof Q_Capability) {
			Q::take(
				$permissions,
				array('permissions', 'data', 'startTime', 'endTime', 'sig'),
				$this
			);
			return;
		}

		if (is_string($permissions)) {
			$s = trim($permissions);
			if ($s === '') {
				throw new Q_Exception_FailedValidation(array(
					'message' => 'Empty capability string'
				));
			}
			if ($s[0] === '{') {
				// JSON object form, as received from a client or from Node
				$decoded = json_decode($s, true);
				if (!is_array($decoded)) {
					throw new Q_Exception_FailedValidation(array(
						'message' => 'Invalid capability JSON: '.json_last_error_msg()
					));
				}
				$this->_fromExportedArray($decoded);
				return;
			}
			$this->_fromCompactString($s);
			return;
		}

		if (is_array($permissions)
		and array_key_exists('permissions', $permissions)) {
			// Exported array form. A plain permissions list is a numerically
			// indexed list of strings and so never carries a 'permissions' key,
			// which is what keeps this unambiguous against the legacy signature.
			$this->_fromExportedArray($permissions);
			return;
		}

		// Construct from parameters
		$this->permissions = self::_permissions($permissions);
		$this->data = is_array($data) ? $data : array();
		$this->startTime = $startTime;
		$this->endTime = $endTime;
	}

	/**
	 * Parse "perms,start,end;data;sig", honouring the backslash escaping that
	 * __toString() applies to semicolons in the core and data segments.
	 * @method _fromCompactString
	 * @private
	 */
	private function _fromCompactString($string)
	{
		// A plain explode(';', ...) splits on escaped semicolons too, which
		// silently corrupts any capability whose data contains one.
		$parts = preg_split('/(?<!\\\\);/', $string);
		if (count($parts) < 3) {
			throw new Q_Exception_FailedValidation(array(
				'message' => 'Invalid capability string format'
			));
		}
		// The signature is always the last segment. Anything that split between
		// the core and it belongs to data -- defensive, since correct escaping
		// means this cannot happen.
		$sig = array_pop($parts);
		$core = array_shift($parts);
		$dataPart = implode(';', $parts);

		$core = str_replace('\\;', ';', $core);
		$dataPart = str_replace('\\;', ';', $dataPart);

		$coreParts = explode(',', $core);
		$permStr = Q::ifset($coreParts, 0, '');
		$start   = Q::ifset($coreParts, 1, '');
		$end     = Q::ifset($coreParts, 2, '');

		$this->permissions = ($permStr === '') ? array() : explode('+', $permStr);
		$this->startTime = ($start !== '') ? $start : null;
		$this->endTime = ($end !== '') ? $end : null;
		$this->data = ($dataPart === '') ? array() : Q_Utils::unserialize($dataPart);
		if (!is_array($this->data)) {
			$this->data = array();
		}
		$this->sig = $sig;
	}

	/**
	 * Parse the flattened form produced by exportArray(): permissions,
	 * startTime, endTime and the signature field sit alongside the data keys.
	 * @method _fromExportedArray
	 * @private
	 */
	private function _fromExportedArray($arr)
	{
		$sf = Q_Config::get('Q', 'internal', 'sigField', 'sig');
		$sigKey = "Q.$sf";

		$permissions = Q::ifset($arr, 'permissions', array());
		if (is_string($permissions)) {
			$permissions = ($permissions === '') ? array() : explode('+', $permissions);
		}
		$this->permissions = self::_permissions($permissions);
		$this->startTime = Q::ifset($arr, 'startTime', null);
		$this->endTime = Q::ifset($arr, 'endTime', null);
		$this->sig = Q::ifset($arr, $sigKey, null);

		// Everything else is data. The signature field has to come out too, or
		// toArray() folds it back into the signed payload and every
		// verification fails.
		$data = $arr;
		unset($data['permissions'], $data['startTime'], $data['endTime'], $data[$sigKey]);
		$this->data = $data;
	}

	function addPermission($permission)
	{
		$permissions = self::_permissions($permission);
		$this->permissions = array_unique(array_merge($this->permissions, $permissions));
		sort($this->permissions);
		$this->sig = null; // a stored signature no longer describes this object
		return $this;
	}

	function removePermission($permission)
	{
		$permissions = self::_permissions($permission);
		$this->permissions = array_diff($this->permissions, $permissions);
		sort($this->permissions);
		$this->sig = null;
		return $this;
	}

	function validate($permissions)
	{
		return Q_Valid::capability($this, $permissions);
	}

	/**
	 * Whether the signature this capability arrived with matches its contents.
	 * Returns false when it arrived without one, or when it has been mutated
	 * since.
	 * @method verify
	 * @return {boolean}
	 */
	function verify()
	{
		return isset($this->sig)
			&& hash_equals((string)$this->sig, (string)$this->signature());
	}

	function setData($key, $value)
	{
		$this->data[$key] = $value;
		$this->sig = null;
		return $this;
	}

	function getData($key, $default = null)
	{
		return Q::ifset($this->data, $key, $default);
	}

	/**
	 * The form to send to browsers and to Node.
	 * @method exportArray
	 */
	function exportArray()
	{
		return Q_Utils::sign($this->toArray());
	}

	/**
	 * @method exportJSON
	 * @return {string}
	 */
	function exportJSON()
	{
		return Q::json_encode($this->exportArray());
	}

	function signature()
	{
		return Q_Utils::signature($this->toArray());
	}

	function __toString()
	{
		$p = implode('+', $this->permissions);
		$startTime = $this->startTime ?: '';
		$endTime = $this->endTime ?: '';
		$data = Q_Utils::serialize($this->data);
		$core = "$p,$startTime,$endTime";
		$arr = $this->exportArray();
		$sf = Q_Config::get('Q', 'internal', 'sigField', 'sig');
		$sig = $arr["Q.$sf"];
		$core = str_replace(';', '\\;', $core);
		$data = str_replace(';', '\\;', $data);
		return "$core;$data;$sig";
	}

	function toArray()
	{
		$arr = array('permissions' => $this->permissions);
		if (isset($this->startTime)) $arr['startTime'] = $this->startTime;
		if (isset($this->endTime)) $arr['endTime'] = $this->endTime;
		return array_merge($this->data, $arr);
	}

	private static function _permissions($permission)
	{
		$config = Q_Config::get('Q', 'capability', 'permissions', array());
		$permissions = is_array($permission) ? $permission : array($permission);
		foreach ($permissions as $i => $p) {
			$k = array_search($p, $config);
			if ($k !== false) $permissions[$i] = $k;
		}
		return $permissions;
	}

	public $permissions = array();
	public $startTime = null;
	public $endTime = null;
	public $data = array();
	public $sig = null;
}
