<?php

/**
 * @module Db
 */

/**
 * Represents a vector (embedding) value in a query.
 *
 * Shaped like Db_Range: a dumb value type that the adapters know how to
 * render. It deliberately knows nothing about how the embedding was produced.
 * Generating embeddings is the AI plugin's job; storing and searching them
 * is Db's.
 *
 * @class Db_Vector
 * @constructor
 * @param {array|string} $values The vector components, or a "[1,2,3]" string
 * @param {string} [$metric='cosine'] One of 'cosine', 'euclidean', 'dot'
 * @param {array} [$options=array()]
 * @param {boolean} [$options.normalize=false] Scale to unit length now.
 *   Worth doing at write time when searching with cosine, so cosine and dot
 *   product agree and the metric can change later without re-embedding.
 * @param {string} [$options.model] Identifier of the model that produced this
 *   vector, e.g. "nomic-embed-text". Informational here, but callers should
 *   persist it beside the vector: comparing embeddings from two different
 *   models produces plausible-looking nonsense with no error at all.
 */
class Db_Vector
{
	/**
	 * @property $values
	 * @type array
	 */
	public $values;

	/**
	 * @property $metric
	 * @type string
	 */
	public $metric;

	/**
	 * @property $model
	 * @type string|null
	 */
	public $model;

	/**
	 * Distance metrics understood by at least one adapter.
	 */
	public static $metrics = array('cosine', 'euclidean', 'dot');

	function __construct($values, $metric = 'cosine', $options = array())
	{
		if (is_string($values)) {
			// pgvector returns bracketed text; MariaDB VECTOR columns come back
			// as packed little-endian float32. Accept both, so a value read
			// straight out of any engine can be handed to the constructor.
			$trimmed = ltrim($values);
			if (strlen($trimmed) and $trimmed[0] === '[') {
				$decoded = json_decode($trimmed, true);
				if (!is_array($decoded)) {
					throw new Exception("Db_Vector: could not parse '$values' as a vector");
				}
				$values = $decoded;
			} else if (strlen($values) and strlen($values) % 4 === 0) {
				$values = array_values(unpack('g*', $values));
			} else {
				throw new Exception(
					"Db_Vector: could not parse a vector from a "
					. strlen($values) . "-byte string"
				);
			}
		}
		if (!is_array($values) or !count($values)) {
			throw new Exception("Db_Vector: values must be a non-empty array of numbers");
		}
		$floats = array();
		foreach ($values as $i => $v) {
			if (!is_numeric($v) or !is_finite((float)$v)) {
				throw new Exception("Db_Vector: component $i is not a finite number");
			}
			$floats[] = (float)$v;
		}

		$metric = strtolower($metric);
		if (!in_array($metric, self::$metrics)) {
			throw new Exception(
				"Db_Vector: unsupported metric '$metric', expected one of "
				. implode(', ', self::$metrics)
			);
		}

		$this->metric = $metric;
		$this->model = isset($options['model']) ? $options['model'] : null;
		$this->values = !empty($options['normalize'])
			? self::normalize($floats)
			: $floats;
	}

	/**
	 * Number of components in the vector.
	 * @method dimensions
	 * @return {integer}
	 */
	function dimensions()
	{
		return count($this->values);
	}

	/**
	 * Renders as a bracketed list: "[0.1,0.2,0.3]".
	 * This is the text form MariaDB's VEC_FromText() and pgvector's ::vector
	 * cast both accept, so the adapters build on it.
	 * @method toText
	 * @return {string}
	 */
	function toText()
	{
		$parts = array();
		$precision = ini_get('serialize_precision');
		ini_set('serialize_precision', -1); // shortest round-trip form
		foreach ($this->values as $v) {
			// json_encode gives the shortest representation that round-trips,
			// and renders 0.0 as "0" rather than an empty string -- trimming
			// zeros by hand turned a zero component into "" and produced "[,]"
			$parts[] = json_encode((float)$v);
		}
		ini_set('serialize_precision', $precision);
		return '[' . implode(',', $parts) . ']';
	}

	/**
	 * Renders as packed little-endian float32 bytes, which is what
	 * sqlite-vec and MariaDB's binary vector form both expect.
	 * @method toBinary
	 * @return {string}
	 */
	function toBinary()
	{
		$out = '';
		foreach ($this->values as $v) {
			$out .= pack('g', $v); // 'g' = float32, little-endian
		}
		return $out;
	}

	function __toString()
	{
		return $this->toText();
	}

	/**
	 * Reconstructs a vector from packed little-endian float32 bytes.
	 * @method fromBinary
	 * @static
	 * @param {string} $binary
	 * @param {string} [$metric='cosine']
	 * @return {Db_Vector}
	 */
	static function fromBinary($binary, $metric = 'cosine')
	{
		if (strlen($binary) % 4 !== 0) {
			throw new Exception(
				"Db_Vector::fromBinary: length " . strlen($binary)
				. " is not a multiple of 4"
			);
		}
		$floats = array_values(unpack('g*', $binary));
		return new Db_Vector($floats, $metric);
	}

	/**
	 * Scales an array of numbers to unit length.
	 * A zero vector is returned unchanged rather than producing NANs.
	 * @method normalize
	 * @static
	 * @param {array} $floats
	 * @return {array}
	 */
	static function normalize($floats)
	{
		$sum = 0;
		foreach ($floats as $v) {
			$sum += $v * $v;
		}
		$norm = sqrt($sum);
		if (!$norm) {
			return $floats;
		}
		$out = array();
		foreach ($floats as $v) {
			$out[] = $v / $norm;
		}
		return $out;
	}
}
