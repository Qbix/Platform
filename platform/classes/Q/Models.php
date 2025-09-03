<?php

class Q_Models {
    /**
	 * Derive schema definition from a Db_Row subclass.
	 *
	 * @method schemaFromClassName
	 * @static
	 * @param {string} $className Class name, e.g. "Base_Streams_Avatar"
	 * @return {array} Array with "fieldNames" and "defaults"
	 */
	static function schemaFromClassName($className)
	{
		static $config = Q_Config::get('Q', 'models', 'schemas', array());
		if (!isset($config[$className]) or $config[$className] === false) {
			return null;
		}
		static $schemas = array();
		if (isset($schemas[$className])) {
			return $schemas[$className];
		}
		$fieldNames = call_user_func(array($className, 'fieldNames'));
		$defaults = array();
		$obj = new $className();
		foreach ($fieldNames as $fn) {
			$method = "beforeSet_$fn";
			if (method_exists($className, $method)) {
				try {
					// call method dynamically
					$result = $obj->$method(null);
					if (is_array($result) && count($result) >= 2) {
						$defaults[$fn] = $result[1];
					} else {
						$defaults[$fn] = null;
					}
				} catch (Exception $e) {
					$defaults[$fn] = null;
				}
			} else {
				$defaults[$fn] = null;
			}
		}
		$fieldNames = array_values($fieldNames);
		$computedNames = $config[$className];
		if (is_array($computedNames)) {
			$fieldNames = array_unique(array_merge($fieldNames, $computedNames));
		}
		return $schemas[$className] = array(
			'fieldNames' => $fieldNames,
			'defaults'   => $defaults
		);
	}

	/**
	 * Get the field key by which to look up a field in an array
	 *
	 * @method fieldKey
	 * @static
	 * @param {string} $className Class name, e.g. "Base_Streams_Avatar"
	 * @return {string|integer} The field key, or the original field name if no schema is defined
	 */
	static function fieldKey($className, $fieldName)
	{
		$schema = self::schemaFromClassName($className);
		if (!$schema) {
			return $fieldName;
		}
		return array_search($fieldName, $schema['fieldNames']);
	}
}