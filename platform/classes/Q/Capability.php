<?php

/**
 * Represents a capability signed by our server.
 *
 * A capability can be constructed either from its components
 * (permissions, data, timestamps) or from a serialized string
 * previously returned by __toString().
 *
 * @module Q
 * @class Q_Capability
 * @constructor
 * @param {array|string} $permissions Either an array of permission strings,
 *   or a serialized capability string.
 * @param {array} [$data=array()] Optional associative data array if not using string form
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
		if (is_string($permissions)) {
			// Parse from string form
			// Example: "perm1+perm2,1700000000,1700100000;{...};<sig>"
			$parts = explode(';', $permissions);
			if (count($parts) < 3) {
				throw new Q_Exception_FailedValidation(array(
					'message' => 'Invalid capability string format'
				));
			}

			list($core, $dataPart, $sig) = $parts;

			$core = str_replace('\;', ';', $core);
			$dataPart = str_replace('\;', ';', $dataPart);
			list($permStr, $start, $end) = explode(',', $core);
			$this->permissions = explode('+', $permStr);
			$this->startTime = $start ?: null;
			$this->endTime = $end ?: null;
			$this->data = Q_Utils::unserialize($dataPart);
			$this->sig = $sig;
		} else {
			// Construct from parameters
			$this->permissions = self::_permissions($permissions);
			$this->data = $data;
			$this->startTime = $startTime;
			$this->endTime = $endTime;
		}
	}

	function addPermission($permission)
	{
		$permissions = self::_permissions($permission);
		$this->permissions = array_unique(array_merge($this->permissions, $permissions));
		sort($this->permissions);
		return $this;
	}

	function removePermission($permission)
	{
		$permissions = self::_permissions($permission);
		$this->permissions = array_diff($this->permissions, $permissions);
		sort($this->permissions);
		return $this;
	}

	function validate($permissions)
	{
		return Q_Valid::capability($this, $permissions);
	}

	function setData($key, $value)
	{
		$this->data[$key] = $value;
	}

	function exportArray()
	{
		return Q_Utils::sign($this->_toArray());
	}

	function signature()
	{
		return Q_Utils::signature($this->_toArray());
	}

	function __toString()
	{
		$p = implode('+', $this->permissions);
		$startTime = $this->startTime ?: '';
		$endTime = $this->endTime ?: '';
		$core = "$p,$startTime,$endTime";
		$data = Q_Utils::serialize($this->data);
		$arr = $this->exportArray();
		$sf = Q_Config::get('Q', 'internal', 'sigField', 'sig');
		$sig = $arr["Q.$sf"];
		$core = str_replace(';', '\;', $core);
		$data = str_replace(';', '\;', $data);
		return "$core;$data;$sig";
	}

	private function _toArray()
	{
		$arr = array('permissions' => $this->permissions);
		if (isset($this->startTime)) $arr['startTime'] = $this->startTime;
		if (isset($this->endTime)) $arr['endTime'] = $this->endTime;
		return array_merge($arr, $this->data);
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