<?php

/**
 * @module Q
 */
class Q_Tree
{	
	/**
	 * Used to hold arbitrary-dimensional lists of parameters in Q
	 * @class Q_Tree
	 * @constructor
	 * @param {&array} [$linked_array=null]
	 */
	function __construct(&$linked_array = null)
	{
		if (isset($linked_array)) {
			$this->parameters = &$linked_array;
		}
	}
	
	/**
	 * Constructs a Q_Tree, and loads filename into it, returning the Q_Tree object.
	 * @method createAndLoad
	 * @static
	 * @param {string} $filename The filename of the file to load.
	 * @param {boolean} $ignoreCache=false
	 *  Defaults to false. If true, then this function ignores
	 *  the cached value, if any, and attempts to search
	 *  for the file. It will cache the new value.
	 * @param {boolean} [$dontThrow=false] Set to true to skip throwing an exception on invalid input
	 * @return {Q_Tree} Returns the Q_Tree if everything succeeded
	 * @throws {Q_Exception_InvalidInput} if tree was not loaded, unless $dontThrow is true
	 */
	static function createAndLoad(
	 $filename,
	 $ignoreCache = false,
	 &$linkedArray = null,
	 $dontThrow = false)
	{
		$tree = new Q_Tree($linkedArray);
		$result = $tree->load($filename, $ignoreCache);
		if (!$result and !$dontThrow) {
			throw new Q_Exception_InvalidInput(array('source' => $filename));
		}
		return $tree;
	}
	
	/**
	 * Gets the array of all parameters
	 * @method getAll
	 * @return {array}
	 */
	function getAll()
	{
		return $this->parameters;
	}
	
	/**
	 * Gets the value of a field, possibly deep inside the array
	 * @method get
	 * @param {string} $key1 The name of the first key in the configuration path
	 * @param {string} $key2 Optional. The name of the second key in the configuration path.
	 *  You can actually pass as many keys as you need,
	 *  delving deeper and deeper into the configuration structure.
	 *  If more than one argument is passed, but the last argument are interpreted as keys.
	 * @param {mixed} $default
	 *  If only one argument is passed, the default is null
	 *  Otherwise, the last argument is the default value to return
	 *  in case the requested field was not found.
	 * @return {mixed}
	 * @throws {Q_Exception_NotArray}
	 */
	function get(
	 $key1,
	 $default = null)
	{
		$args = func_get_args();
		$args_count = func_num_args();
		$result = & $this->parameters;
		if ($args_count <= 1) {
			return isset($result[$key1]) ? $result[$key1] : null;
		}
		$default = $args[$args_count - 1];
		$key_array = array();
		for ($i = 0; $i < $args_count - 1; ++$i) {
			$key = $args[$i];
			if (! is_array($result)) {
				return $default; // silently ignore the rest of the path
				// $keys = '["' . implode('"]["', $key_array) . '"]';
				// throw new Q_Exception_NotArray(@compact('keys', 'key'));
			}
			if (!isset($key) || !(is_string($key) || is_integer($key)) || !array_key_exists($key, $result)) {
				return $default;
			}
			if ($i == $args_count - 2) {
				// return the final value
				return $result[$key];
			}
			$result = & $result[$key];
			$key_array[] = $key;
		}
	}
	
	/**
	 * Sets the value of a field, possibly deep inside the array
	 * @method set
	 * @param {string} $key1 The name of the first key in the configuration path
	 * @param {string} $key2 Optional. The name of the second key in the configuration path.
	 *  You can actually pass as many keys as you need,
	 *  delving deeper and deeper into the configuration structure.
	 *  All but the second-to-last parameter are interpreted as keys.
	 * @param {mixed} [$value=null] The value to set the field to.
	 *  The last parameter should not be omitted unless the first parameter is an array.
	 */
	function set(
	 $key1,
	 $value = null)
	{
		$args = func_get_args();
		$args_count = func_num_args();
		if ($args_count <= 1) {
			if (is_array($key1)) {
				foreach ($key1 as $k => $v) {
					$this->parameters[$k] = $v;
				}
			}
			return null;
		}
		$value = $args[$args_count - 1];
		$result = & $this->parameters;

		for ($i = 0; $i < $args_count - 1; ++$i) {
			if (! is_array($result)) {
				$result = array(); // overwrite with an array 
			}
			$key = $args[$i];
			if ($i === $args_count - 2) {
				break; // time to set the final value
			}
			if (isset($key)) {
				$result = & $result[$key];
			} else {
				$result = & $result[];
			}
			if (!is_array($result)) {
				// There will be more arguments, so
				// overwrite $result with an array
				$result = array();
			}
		}

		// set the final value
		if (isset($key)) {
			$key = $args[$args_count - 2];
			$result[$key] = $value;
		} else {
			$result[] = $value;
		}
		return $value;
	}
	
	/**
	 * Traverse the tree depth-first and call the callback
	 * @method depthFirst
	 * @param {callable} $callback Will receive ($path, $value, $array, $context)
	 * @param {mixed} [$context=null] To propagate some context to the callback
	 */
	function depthFirst($callback, $context = null)
	{
		$this->_depthFirst(array(), $this->parameters, $callback, $context);
	}
	
	private function _depthFirst($subpath, $arr, $callback, $context)
	{
		foreach ($arr as $k => $a) {
			$path = array_merge($subpath, array($k));
			if (false === call_user_func($callback, $path, $a, $arr, $context)) {
				continue;
			}
			if (Q::isAssociative($a)) {
				$this->_depthFirst($path, $a, $callback, $context);
			}
		}
	}
	
	/**
	 * Traverse the tree breadth-first and call the callback
	 * @method breadthFirst
	 * @param {callable} $callback Will receive ($path, $value, $array, $context)
	 * @param {mixed} [$context=null] To propagate some context to the callback
	 */
	function breadthFirst($callback, $context = null)
	{
		call_user_func($callback, array(), $this->parameters, $this->parameters, $context);
		$this->_breadthFirst(array(), $this->parameters, $callback, $context);
	}
	
	private function _breadthFirst($subpath, $arr, $callback, $context)
	{
		foreach ($arr as $k => $a) {
			$path = array_merge($subpath, array($k));
			if (false === call_user_func($callback, $path, $a, $arr, $context)) {
				break;
			}
		}
		foreach ($arr as $k => $a) {
			if (Q::isAssociative($a)) {
				$path = array_merge($subpath, array($k));
				$this->_breadthFirst($path, $a, $callback, $context);
			}
		}
	}
	
	/**
	 * Calculates a diff between this tree and another tree.
	 * Supports keyed diffs if you explicitly pass $keyField.
	 *
	 * @method diff
	 * @param {Q_Tree} $tree
	 * @param {bool} [$skipUndefinedValues=false] Skip if the value is undefined in target
	 * @param {string|null} $keyField If provided, diff arrays of objects by this field
	 * @return {Q_Tree}
	 */
	function diff($tree, $skipUndefinedValues = true, $keyField = null)
	{
		$context = new StdClass();
		$context->from = $this;
		$context->to = $tree;
		$context->diff = new Q_Tree();
		$context->skipUndefinedValues = $skipUndefinedValues;
		$context->keyField = $keyField;
		$this->depthFirst(array($this, '_diffTo'), $context);
		$tree->depthFirst(array($tree, '_diffFrom'), $context);
		return $context->diff;
	}

	/**
	 * Helper for diff(): Walk "from" tree and compare values to "to" tree
	 */
	private function _diffTo($path, $value, $array, $context)
	{
		if (empty($path)) return false;

		$args = $path;
		$args[] = null;
		$valueTo = call_user_func_array(array($context->to, 'get'), $args);

		if ((!Q::isAssociative($value) || !Q::isAssociative($valueTo)) && $valueTo !== $value) {
			// handle keyed arrays if keyField is specified
			if (is_array($value) && !Q::isAssociative($value) && is_array($valueTo) && !Q::isAssociative($valueTo) && $context->keyField) {
				$diff = self::diffByKey($value, $valueTo, $context->keyField);
				if (!empty($diff)) {
					call_user_func_array(array($context->diff, 'set'), array_merge($path, array($diff)));
				}
				return false;
			} else {
				$valueTo = array('replace' => $valueTo);
			}
			$args2 = $path;
			$args2[] = $valueTo;

			// restore skipUndefinedValues check
			if ($context->skipUndefinedValues) {
				$key = end($path);
				$parentPath = array_slice($path, 0, -1);
				$parent = $parentPath ? call_user_func_array(array($context->to, 'get'), array_merge($parentPath, array(null))) : $context->to->parameters;
				if (!is_array($parent) || !array_key_exists($key, $parent)) {
					return false;
				}
			}
			call_user_func_array(array($context->diff, 'set'), $args2);
		}
	}

	private function _diffFrom($path, $value, $array, $context)
	{
		if (empty($path)) return false;
		$args = $path;
		$args[] = null;
		$valueFrom = call_user_func_array(array($context->from, 'get'), $args);
		if (!isset($valueFrom)) {
			$args2 = $path;
			$args2[] = $value;
			call_user_func_array(array($context->diff, 'set'), $args2);
			return false;
		}
	}

	/**
	 * Computes a keyed diff between two arrays of associative objects
	 * @method diffByKey
	 * @static
	 * @param {array} $old The old array
	 * @param {array} $new The new array
	 * @param {string} $keyField The field to diff by
	 * @return {array} Structure with add/remove/updates
	 */
	protected static function diffByKey($old, $new, $keyField)
	{
		$oldIndex = array();
		foreach ($old as $o) if (isset($o[$keyField])) $oldIndex[$o[$keyField]] = $o;
		$newIndex = array();
		foreach ($new as $n) if (isset($n[$keyField])) $newIndex[$n[$keyField]] = $n;

		$add = array(); $remove = array(); $updates = array($keyField);

		foreach ($newIndex as $k => $n) {
			if (!isset($oldIndex[$k])) {
				$add[] = $n;
			} else {
				$diff = self::objectDiff($oldIndex[$k], $n);
				if (!empty($diff)) {
					$diff[$keyField] = $k;
					$updates[] = $diff;
				}
			}
		}
		foreach ($oldIndex as $k => $o) {
			if (!isset($newIndex[$k])) {
				$remove[] = array($keyField => $k);
			}
		}

		$result = array();
		if (!empty($add)) $result['add'] = $add;
		if (!empty($remove)) $result['remove'] = $remove;
		if (count($updates) > 1) $result['updates'] = $updates;
		return $result;
	}

	protected static function objectDiff($old, $new)
	{
		$diff = array();
		foreach ($new as $k => $v) {
			if (!array_key_exists($k, $old) || $old[$k] !== $v) {
				$diff[$k] = $v;
			}
		}
		return $diff;
	}

	protected static function detectKeyField($arr1, $arr2)
	{
		// crude detection: find common string key across both
		$keys = array();
		foreach (array_merge($arr1, $arr2) as $obj) {
			if (is_array($obj)) {
				foreach ($obj as $k => $v) {
					if (is_string($k) && $k !== '' && isset($obj[$k])) {
						$keys[$k] = isset($keys[$k]) ? $keys[$k]+1 : 1;
					}
				}
			}
		}
		arsort($keys);
		return key($keys);
	}
	
	/**
	 * Clears the value of a field, possibly deep inside the array
	 * @method clear
	 * @param {string} $key1 The name of the first key in the configuration path
	 * @param {string} $key2 Optional. The name of the second key in the configuration path.
	 *  You can actually pass as many keys as you need,
	 *  delving deeper and deeper into the configuration structure.
	 *  All but the second-to-last parameter are interpreted as keys.
	 */
	function clear(
	 $key1)
	{
		if (!isset($key1)) {
			$this->parameters = self::$cache = array();
			return;
		}
		$args = func_get_args();
		$args_count = func_num_args();
		$result = & $this->parameters;
		for ($i = 0; $i < $args_count - 1; ++$i) {
			$key = $args[$i];
			if (! is_array($result) 
			 or !array_key_exists($key, $result)) {
				return false;
			}
			$result = & $result[$key];
		}
		// clear the final value
		$key = $args[$args_count - 1];
		if (isset($key)) {
			unset($result[$key]);
		} else {
			array_pop($result);
		}
	}
	
	/**
	 * Loads data from JSON found in a file
	 * @method load
	 * @param {string} $filename The filename of the file to load.
	 * @param {boolean} $ignoreCache=false
	 *  Defaults to false. If true, then this function ignores
	 *  the cached value, if any, and attempts to search
	 *  for the file. It will cache the new value unless it is null.
	 * @return {Q_Tree|null} Returns $this if loaded, otherwise null.
	 * @throws {Q_Exception_InvalidInput}
	 */
	function load(
	 $filename,
	 $ignoreCache = false)
	{
		$filename2 = Q::realPath($filename, $ignoreCache);
		if (!$filename2) {
			return null;
		}
		
		$this->filename = $filename2;
		
		// if class cache is set - use it
		if (isset(self::$cache[$filename2])) {
			$this->merge(self::$cache[$filename2]);
			return $this;
		}

		// check Q_Cache and if set - use it
		// update class cache as it is not set
		$exclude = Q::startsWith($filename, APP_LOCAL_DIR); // SECURITY reasons
		if (!$exclude && !$ignoreCache) {
			$arr = Q_Cache::get("Q_Tree\t$filename2", null, $found);
			if ($found) {
				self::$cache[$filename2] = $arr;
				$this->merge($arr);
				return $this;
			}
		}

		/**
		 * @event Q/tree/load {before}
		 * @param {string} filename
		 * @return {array}
		 */
		$arr = Q::event('Q/tree/load', @compact('filename'), 'before');
		if (!isset($arr)) {
			try {
				// get file contents, remove comments and parse
				$config = Q_Config::get('Q', 'tree', array());
				if (strtolower(substr($filename, -4)) === '.php') {
					$json = include($filename2);
				} else {
					$json = Q::readFile($filename2, Q::take($config, array(
						'ignoreCache' => $ignoreCache,
						'dontCache' => true,
						'duration' => 3600
					)));
				}
				// strip comments
				$json = preg_replace('/\s*(?!<\")\/\*[^\*]+\*\/(?!\")\s*/', '', $json);
				// strip stray commas
				$json = preg_replace('/\,\s*\}/', '}', $json);
				$arr = Q::json_decode($json, true);
			} catch (Exception $e) {
				$arr = null;
				// stop caching badly formatted files
				Q_Cache::clear("Q::readFile\t$filename2");
			}
		}
		if (!isset($arr)) {
			throw new Q_Exception_InvalidInput(array('source' => $filename));
		}
		if (!is_array($arr)) {
			return null;
		}
		// $arr was loaded from $filename2 or by Q/tree/load before event
		$this->merge($arr);
		self::$cache[$filename2] = $arr;
		if (!$exclude) {
			Q_Cache::set("Q_Tree\t$filename2", $arr); // no need to check result - on failure Q_Cache is disabled
		}
		return $this;
	}
	
	/**
	 * Saves parameters to a file
	 * @method save
	 * @param {string} $filename Name of file to save to. If tree was loaded, you can leave this blank to update that file.
	 * @param {array} [$array_path=array()] Array of keys identifying the path of the subtree to save
	 * @param {array} [$prefix_path=array()] The JSON path to save the data under, defaults to array_path
	 * @param {integer} [$flags=0] Any additional flags for json_encode, such as JSON_PRETTY_PRINT
	 * @return {boolean} Returns true if saved, otherwise false;
	 **/
	function save (
		$filename = null, 
		$array_path = array(),
		$prefix_path = null,
		$flags = 0)
	{
		if (empty($filename) and !empty($this->filename)) {
			$filename = $this->filename;
		}
		if (!($filename2 = Q::realPath($filename))) {
			$filename2 = $filename;
		}

		if (empty($array_path)) {
			$array_path = array();
			$toSave = $this->parameters;
		} else {
			$array_path[] = null;
			$toSave = call_user_func_array(array($this, 'get'), $array_path);
		}

		if(is_null($prefix_path)) {
			$prefix_path = $array_path;
		}

		$prefix_path = array_reverse($prefix_path);

		foreach ($prefix_path as $ap) {
			if ($ap) {
				$toSave = array( $ap => $toSave);
			}
		}

		$mask = umask(Q_Config::get('Q', 'internal','umask' , 0000));
		$flags = JSON_UNESCAPED_SLASHES | $flags;
		$content = !empty($toSave) ? Q::json_encode($toSave, $flags) : '{}';
		if (strtolower(substr($filename, -4)) === '.php') {
			$content = "<?php return <<<EOT".PHP_EOL.$content.PHP_EOL."EOT;";
		}
		$success = file_put_contents(
			$filename2, 
			!empty($toSave) 
				? Q::json_encode($toSave, $flags)
				: '{}',
			LOCK_EX);
		clearstatcache(true, $filename2);

		umask($mask);

		if ($success) {
			self::$cache[$filename] = $toSave;
			Q_Cache::set("Q_Tree\t$filename", $toSave); // no need to check result - on failure Q_Cache is disabled
		}
		return $success;
	}
	
	/**
	 * Merges trees over the top of existing trees
	 * @method merge
	 * @param {array|Q_Tree} $second The array or Q_Tree to merge on top of the existing one
	 * @param {boolean} [$noNumericArrays=false] Set to true to treat all arrays as associative
	 * @return {Q_Tree} Returns existing tree, modified by the merge
	 */
	function merge ($second, $under = false, $noNumericArrays = false)
	{
		if ($second instanceof Q_Tree) {
			$this->merge(
				$second->parameters, $under, $noNumericArrays
			);
		}
		if (is_array($second)) {
			if ($under === true) {
				$this->parameters = self::merge_internal(
					$second, $this->parameters, $noNumericArrays
				);
			} else {
				$this->parameters = self::merge_internal(
					$this->parameters, $second, $noNumericArrays
				);
			}
			return $this;
		}
		return $this;
	}
	
	/**
	 * Gets the value of a field in the tree. If it is null or not set,
	 * throws an exception. Otherwise, it is guaranteed to return a non-null value.
	 * @method expect
	 * @static
	 * @param {string} $key1 The name of the first key in the tree path
	 * @param {string} $key2 Optional. The name of the second key in the tree path.
	 *  You can actually pass as many keys as you need,
	 *  delving deeper and deeper into the expect structure.
	 *  All but the second-to-last parameter are interpreted as keys.
	 * @return {mixed} Only returns non-null values
	 * @throws {Q_Exception_MissingConfig} May throw an exception if the field is missing in the tree.
	 */
	function expect(
		$key1)
	{
		$args = func_get_args();
		$args2 = array_merge($args, array(null));
		$result = call_user_func_array(array($this, 'get'), $args2);
		if (!isset($result)) {
			require_once(Q_CLASSES_DIR.DS.'Q'.DS.'Exception'.DS.'MissingConfig.php');
			throw new Q_Exception_MissingConfig(array(
				'fieldpath' => '"' . implode('"/"', $args) . '"'
			));
		}
		return $result;
	}
	
	/**
	 * Pass two or more arrays to merge recursively in a tree.
	 * You can pass null instead of an array and it will be fine.
	 * @method mergeArrays
	 * @static
	 * @param {array} $first The first array
	 * @param {array} $second The second array
	 * @param {array} [$third] The second array
	 * @return {array} The array that resulted from the merge
	 */
	static function mergeArrays ($arr1, $arr2) {
		$args = func_get_args();
		$count = func_num_args();
		$arr = reset($args);
		$tree = new Q_Tree($arr);
		for ($i=1; $i<$count; ++$i) {
			$tree->merge($args[$i]);
		}
		return $tree->getAll();
	}
	
	/**
	 * We consider array1/array2 to be arrays. no scalars shall be passes
	 * @method merge_internal
	 * @static
	 * @protected
	 * @param {array} [$array1=array()]
	 * @param {array} [$array2=array()]
	 * @param {boolean} [$noNumericArrays=false] Set to true to treat all arrays as associative
	 * $return {array}
	 */
	protected static function merge_internal($array1 = array(), $array2 = array(), $noNumericArrays = false)
	{
		if (!Q::isAssociative($array1)) {
			// keyed array handling
			if (isset($array2['updates'])) {
				$keyField = $array2['updates'][0];
				$updates = array_slice($array2['updates'], 1);
				foreach ($updates as $upd) {
					foreach ($array1 as &$obj) {
						if (isset($obj[$keyField]) && $obj[$keyField] === $upd[$keyField]) {
							foreach ($upd as $k=>$v) $obj[$k] = $v;
						}
					}
				}
				if (isset($array2['add'])) $array1 = array_merge($array1, $array2['add']);
				if (isset($array2['remove'])) {
					$array1 = array_values(array_filter($array1, function($o) use($array2,$keyField){
						foreach ($array2['remove'] as $r) {
							if ($o[$keyField] === $r[$keyField]) return false;
						}
						return true;
					}));
				}
				return $array1;
			}
			if (isset($array2['replace'])) return $array2['replace'];
		}

		$result = $array1;
		foreach ($array2 as $key => $value) {
			if (!$noNumericArrays && !Q::isAssociative($array2)) {
				// merge in unique values for numeric arrays
				if (!in_array($value, $result)) $result[] = $value;
			} else if (array_key_exists($key, $result)) {
				if (is_array($value) && is_array($result[$key])) {
					$result[$key] = self::merge_internal($result[$key], $value, $noNumericArrays);
				} else {
					$result[$key] = $value;
				}
			} else {
				$result[$key] = $value;
			}
		}
		return $result;
	}
	
	public $filename = null;
	
	/**
	 * @property $parameters
	 * @type array
	 * @protected
	 */
	protected $parameters = array();
	/**
	 * @property $cache
	 * @static
	 * @type array
	 * @protected
	 */
	protected static $cache = array();
}