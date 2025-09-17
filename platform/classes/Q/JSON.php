<?php

/**
 * Modern JSON utility built on Q::json_encode/json_decode.
 * Adds streaming for large arrays and objects in JSON files.
 */
class Q_JSON
{
	/**
	 * A wrapper for encode
	 * @method encode
	 * @static
	 * @throws Q_Exception_JsonEncode
	 */
	static function encode($value, $options = 0, $depth = 512)
	{
		$args = func_get_args();
		if ($options & Q::JSON_FORCE_OBJECT) {
			if (is_array($value) && array_keys($value) === range(0, count($value) - 1)) {
				$value = (object) $value;
			}
			$options &= ~Q::JSON_FORCE_OBJECT;
		}
		$value = self::utf8ize($value);
		$args[0] = self::toArrays($value, 0, $depth);
		$result = call_user_func_array('json_encode', $args);
		if ($result === false) {
			if (is_callable('json_last_error')) {
				throw new Q_Exception_JsonEncode(array(
					'message' => json_last_error_msg(),
					'value' => $value
                ), null, json_last_error());
			}
			throw new Q_Exception_JsonEncode(array(
				'message' => 'Invalid JSON',
				'value' => $value
            ), null, -1);
		}
		$result = preg_replace_callback(
			'/^(?: {4})+/m',
			['Q_JSON', 'json_replace'],
			$result
		);
		return str_replace("\\/", '/', $result);
	}

	/**
	 * A wrapper for json_decode with enhanced character handling
	 */
	static function decode($json, $assoc = false, $depth = 512, $options = 0)
	{
	if (empty($json)) {
			return $json;
		}

		if ($options & JSON_DECODE_CLEAN) {
			$json = self::utf8ize($json);
			$json = strtr($json, [
				"\n"  => "@@NEWLINE@@",
				"\r"  => "@@CARRIAGERETURN@@",
				"\0"  => "@@NULL@@",
				"\x1F"=> "@@CONTROL@@"
			]);
		}

		$result = json_decode($json, $assoc, $depth, $options & ~JSON_DECODE_CLEAN);

		if (is_callable('json_last_error')) {
			if ($code = json_last_error()) {
				throw new Q_Exception_JsonDecode(array(
					'message' => json_last_error_msg(),
					'json' => $json
                ), [], $code);
			}
		} elseif (!isset($result) && strtolower(trim($json)) !== 'null') {
			throw new Q_Exception_JsonDecode(array(
				'message' => 'Invalid JSON',
				'json' => $json
            ), null, -1);
		}

		if ($options & JSON_DECODE_CLEAN) {
			$result = self::decodeProblematicChars($result);
		}

		return $result;
	}

	private static function json_replace($m)
	{
		return str_repeat("\t", strlen($m[0]) / 4);
	}

	private static function toArrays($value, $depth = 0, $maxDepth = 100)
	{
		if ($depth > $maxDepth) {
			return '*DEPTH_LIMIT_REACHED*';
		}

		$result = Q::event('Q/json_encode_toArrays', compact('value'), 'before', false, $value);

		if (is_object($result) && method_exists($result, 'toArray')) {
			$result = $result->toArray();
		}

		if (is_array($result)) {
			foreach ($result as $k => &$v) {
				$v = self::toArrays($v, $depth + 1, $maxDepth);
			}
		}

		return $result;
	}

	static function utf8ize($mixed)
	{
		if (is_array($mixed)) {
			foreach ($mixed as $key => $value) {
				$mixed[$key] = self::utf8ize($value);
			}
		} elseif (is_string($mixed)) {
			return mb_convert_encoding($mixed, "UTF-8", "UTF-8");
		}
		return $mixed;
	}

	static function decodeProblematicChars($data)
	{
		if (is_string($data)) {
			return strtr($data, [
				"@@NEWLINE@@" => "\n",
				"@@CARRIAGERETURN@@" => "\r",
				"@@NULL@@" => "\0",
				"@@CONTROL@@" => "\x1F"
			]);
		} elseif (is_array($data)) {
			return array_map(array('Q_JSON', 'decodeProblematicChars'), $data);
		} elseif (is_object($data)) {
			foreach ($data as $key => $value) {
				$data->$key = self::decodeProblematicChars($value);
			}
		}
		return $data;
	}

    /**
     * Check if the last character in the buffer is not escaped
     * (i.e. preceded by an even number of backslashes)
     * @param {string} $buffer The current buffer string
     * @return {boolean} True if the last character is not escaped
     */
	public static function notEscaped($buffer)
	{
		// Count consecutive backslashes before the last character
		$slashes = 0;
		for ($i = strlen($buffer) - 1; $i >= 0 && $buffer[$i] === '\\'; $i--) {
			$slashes++;
		}
		return $slashes % 2 === 0;
	}

	/**
	 * Stream values from a JSON file.
	 * Supports associative key/value output, deep path filtering, and callbacks.
	 *
	 * Options:
	 * - associative {boolean} (default false)
	 * - path {array} Array of keys to match, use `true` as wildcard
	 * - callback {callable} If set, stream calls this instead of yielding
	 *
	 * @method stream
	 * @static
	 * @param {string} $filename Path to the JSON file
	 * @param {array} [$options] Options array
	 * @param {boolean} [$options.associative] If true, yields key/value pairs
	 * @param {array} [$options.path] Path array, with `true` as wildcard
	 * @param {callable} [$options.callback] Callback($key, $value, $path)
	 * @return {Iterator|void}
	 */
	public static function stream($filename, $options = array())
	{
		require_once(Q_CLASSES_DIR.DS.'Q'.DS.'JSON'.DS.'StreamIterator.php');
		
		// if callback is set, run immediately (no Iterator needed)
		if (isset($options['callback']) && is_callable($options['callback'])) {
			$it = new Q_JSON_StreamIterator($filename, $options);
			foreach ($it as $row) {
				// formatYield already structured $row, but callback wants raw args
				$key   = isset($row['key'])   ? $row['key']   : null;
				$value = isset($row['value']) ? $row['value'] : $row;
				$path  = isset($row['path'])  ? $row['path']  : array($key);
				call_user_func($options['callback'], $key, $value, $path);
			}
			return; // no Iterator returned
		}

		// otherwise return Iterator for foreach
		return new Q_JSON_StreamIterator($filename, $options);
	}
}
