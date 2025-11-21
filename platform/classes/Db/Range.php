<?php

/**
 * @module Db
 */

class Db_Range
{
	/**
	 * This class lets you use make range queries, in a structured way.
	 * @class Db_Range
	 * @constructor
	 * @param {mixed} $min Minimal value of the range. Pass null to skip the min.
	 * @param {boolean} $includeMin Whether the range extends to include the minimum value
	 * @param {boolean} $includeMax Whether the range extends to include the maximum value
	 * @param {mixed} $max Maximal value of the range. Pass null to skip the max.
	 *  If boolean true is passed here, then $max is set to $min with the last character
	 *  incremented to the next character value (used for string prefixes).
	 */
	function __construct ($min, $includeMin, $includeMax = false, $max = null)
	{
		$this->min = $min;
		$this->includeMin = $includeMin;
		$this->includeMax = $includeMax;
		if ($max === true) {
			if (!is_string($min)) {
				throw new Exception("Db_Range: min is the wrong type, expected a string");
			}
			$last_char = strlen($min) ? substr($min, -1) : ' ';
			$max = substr($min, 0, -1).chr(ord($last_char)+1);
		}
		$this->max = $max;
	}
	
	function __toString ()
	{
		$str = $this->renderAsString();
		$results = $str ? array($str) : array();
		foreach ($this->additionalRanges as $range) {
			$results[] = $range->renderAsString();
		}
		return implode(" OR ", $results);
	}

	private function renderAsString()
	{
		$min = $this->min;
		$max = $this->max;
		$includeMin = $this->includeMin;
		$includeMax = $this->includeMax;
		$firstPart = isset($min) ? ($includeMin ? "$min <=" : "$min <") : '';
		$secondPart = isset($max) ? ($includeMax ? "<= $max" : "< $max") : '';
		return ($firstPart or $secondPart) ? "$firstPart ... $secondPart" : '';
	}

	/**
	 * Get a Db_Range for matching only strings that begin with a capital letter
	 * @method capitalized
	 * @static
	 * @param {string} [$lang='en'] Two-letter language code
	 * @return {Db_Range}
	 */
	static function capitalized($lang = 'en')
	{
		if ($lang != 'en') {
			throw new Q_Exception_NotImplemented(array(
				'functionality' => 'Db_Range::capitalized for non-English languages'
			));
		}
		$start = 'A';
		$end = 'Z';
		return new Db_Range($start, true, false, mb_chr(mb_ord($end)+1));
	}

	/**
	 * Get new Db_Range
	 * @method unicode
	 * @static
	 * @param {string} [$lang='en'] Two-letter language code
	 * @return {Db_Range}
	 */
	static function unicode($lang = 'en')
	{
		$ranges = ($lang === 'en')
			? [[ord('A'), ord('Z')], [ord('a'), ord('z')]]
			: Q_Text::languageRanges($lang);
		if (!$ranges) {
			throw new Q_Exception_MissingName(array(
				'name' => "$language in languageRanges"
			));
		}
		$result = new Db_Range(null, false, false, null);
		foreach ($ranges as $range) {
			$start = reset($range);
			$end = end($range);
			$result->additionalRanges[] = new Db_Range(mb_chr($start), true, false, mb_chr($end+1));
		}
		return $result;
	}

	/**
	 * Generate a Db_Range for values starting with $min through $max (inclusive).
	 * Works for numbers and strings of any length, treating them as prefixes
	 * of other strings, or decimal expansions.
	 *
	 * @param string|int|float $min
	 * @param string|int|float $max
	 * @return Db_Range
	 */
	public static function startingWith($min, $max)
	{
		if (is_numeric($min) && is_numeric($max)) {
			// numeric half-open: floor(min) <= value < ceil(max)+1
			$minVal = floor($min);
			$maxVal = ceil($max);
			return new Db_Range($minVal, true, false, $maxVal);
		}

		if (is_string($min) && is_string($max)) {
			// Compute the "next string" after $max
			$len = strlen($max);
			$lastChar = ord($max[$len - 1]);
			$nextChar = chr($lastChar + 1);
			$maxNext = substr($max, 0, $len - 1) . $nextChar;

			return new Db_Range($min, true, false, $maxNext);
		}

		throw new InvalidArgumentException(
			"startingWith(): min and max must both be numbers or both be strings"
		);
	}

	/**
	 * Minimal value of the range
	 * @property $min
	 * @type mixed
	 */
	/**
	 * Maximal value of the range
	 * @property $max
	 * @type mixed
	 */
	/**
	 * Whether maximum value should be included to the range
	 * @property $includeMax
	 * @type boolean
	 */
	/**
	 * Whether minimum value should be included to the range
	 * @property $includeMin
	 * @type boolean
	 */
	/**
	 * Any ranges to unite with this range, using OR clauses
	 * @property $additionalRanges
	 * @type array
	 */
	public $min, $max, $includeMin, $includeMax, $additionalRanges = array();
}