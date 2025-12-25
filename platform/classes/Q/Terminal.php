<?php

/**
 * Simple ANSI-based Terminal screen and mouse abstraction.
 *
 * Works on Linux / macOS terminals.
 * Internally maintains a 2D buffer of characters + optional colors.
 *
 * @class Q_Terminal
 */
class Q_Terminal
{
	private static $width;
	private static $height;

	private static $buffer = array();        // [y][x] = [char, fg, bg]
	private static $mouseEnabled = false;

	private static $started = false;


	/**
	 * Construct a terminal instance and detect its size.
	 * Falls back to 80×24 if size cannot be detected.
	 *
	 * @constructor
	 * @method Q_Terminal
	 */
	static function start()
	{
		if (self::$started) return;
		self::$started = true;

		self::updateSize();

		for ($y = 0; $y < self::$height; $y++) {
			self::$buffer[$y] = [];
			for ($x = 0; $x < self::$width; $x++) {
				self::$buffer[$y][$x] = [' ', null, null];
			}
		}
	}


	/**
	 * Create a clickable link for supported terminals.
	 * @method link
	 * @static
	 * @param {string} text The link text
	 * @param {string} url The link URL
	 * @return {string} The formatted link
	 */
	static function link($text, $url)
	{
		return "\033]8;;".$url."\033\\".$text."\033]8;;\033\\";
	}

	/**
	 * Wrap text in ANSI color codes.
	 * @method colored
	 * @static
	 * @param {string} text The text to color
	 * @param {string|null} foreground_color The foreground color name
	 * @param {string|null} background_color The background color name
	 * @return {string} The colored text
	 */
	static function colored($text, $foreground_color = null, $background_color = null)
	{
		if (!$foreground_color and !$background_color) {
			return $text;
		}
		static $foreground_colors = array(
			'black' => '0;30',
			'dark_gray' => '1;30',
			'blue' => '0;34',
			'light_blue' => '1;34',
			'green' => '0;32',
			'light_green' => '1;32',
			'cyan' => '0;36',
			'light_cyan' => '1;36',
			'red' => '0;31',
			'light_red' => '1;31',
			'purple' => '0;35',
			'light_purple' => '1;35',
			'brown' => '0;33',
			'yellow' => '1;33',
			'light_gray' => '0;37',
			'white' => '1;37'
		);
		static $background_colors = array(
			'black' => '40',
			'red' => '41',
			'green' => '42',
			'yellow' => '43',
			'blue' => '44',
			'magenta' => '45',
			'cyan' => '46',
			'light_gray' => '47',
			'gray' => '100'
		);
		$colored_string = "";
		if (isset($foreground_colors[$foreground_color])) {
			$colored_string .= "\033[" . $foreground_colors[$foreground_color] . "m";
		}
		if (isset($background_colors[$background_color])) {
			$colored_string .= "\033[" . $background_colors[$background_color] . "m";
		}
		return $colored_string .  $text . "\033[0m";
	}

	/**
	 * Set the terminal cursor style.
	 * @method cursor
	 * @static
	 * @param {string} type The cursor type: "block", "bar", "underline"
	 * @return {void}
	 */
	static function cursor($type)
	{
		switch ($type) {
			case 'block':
				echo "\033[2 q";
				break;
			case 'underline':
				echo "\033[4 q";
				break;
			case 'bar':
				echo "\033[6 q";
				break;
			default:
				echo "\033[2 q";
				break;
		}
	}

	/**
	 * Hide the terminal cursor.
	 * @method hideCursor
	 * @static
	 * @return {void}
	 */
	static function hideCursor()
	{
		echo "\033[?25l";
	}

	/**
	 * Show the terminal cursor.
	 * @method showCursor
	 * @static
	 * @return {void}
	 */
	static function showCursor()
	{
		echo "\033[?25h";
	}

	/**
	 * Update terminal width and height from system stty.
	 *
	 * @method updateSize
	 * @return void
	 */
	static function updateSize()
	{
		$out = [];
		$cols = 80;
		$rows = 24;

		if (!Q_Utils::isWindows()) {
			@exec('stty size 2>/dev/null', $out);
			if ($out && preg_match('/(\d+)\s+(\d+)/', $out[0], $m)) {
				$rows = (int)$m[1];
				$cols = (int)$m[2];
			}
		}

		self::$width = $cols;
		self::$height = $rows;
	}

	/**
	 * Get terminal width in characters.
	 *
	 * @method getWidth
	 * @return {number}
	 */
	static function getWidth()
	{
		return self::$width;
	}

	/**
	 * Get terminal height in characters.
	 *
	 * @method getHeight
	 * @return {number}
	 */
	static function getHeight()
	{
		return self::$height;
	}

	/**
	 * Write a single character into the internal screen buffer.
	 *
	 * @method write
	 * @static
	 * @param {number} x The X coordinate (0-based)
	 * @param {number} y The Y coordinate (0-based)
	 * @param {string} char The character to write
	 * @param {string} [fg] Optional foreground color name or ANSI code
	 * @param {string} [bg] Optional background color name or ANSI code
	 * @return {boolean} Whether the write occurred
	 */
	static function write($x, $y, $char, $fg = null, $bg = null)
	{
		if ($x < 0 || $y < 0 || $x >= self::$width || $y >= self::$height) {
			return false;
		}
		if (strlen($char) > 1) {
			$char = mb_substr($char, 0, 1);
		}
		self::$buffer[$y][$x] = [$char, $fg, $bg];
		return true;
	}

	/**
	 * Read a character entry from the internal buffer.
	 *
	 * @method read
	 * @static
	 * @param {number} x The X coordinate (0-based)
	 * @param {number} y The Y coordinate (0-based)
	 * @return {array|null} `[char, fg, bg]` or null if out of bounds
	 */
	static function read($x, $y)
	{
		if ($x < 0 || $y < 0 || $x >= self::$width || $y >= self::$height) {
			return null;
		}
		return self::$buffer[$y][$x];
	}

	/**
	 * Clear both the internal buffer and the visible terminal.
	 *
	 * @method clear
	 * @static
	 * @return void
	 */
	static function clear()
	{
		for ($y = 0; $y < self::$height; $y++) {
			for ($x = 0; $x < self::$width; $x++) {
				self::$buffer[$y][$x] = [' ', null, null];
			}
		}
		echo "\033[2J\033[H";
	}

	/**
	 * Flush the internal buffer to the terminal display.
	 *
	 * @method flush
	 * @static
	 * @return void
	 */
	static function flush()
	{
		echo "\033[H";
		for ($y = 0; $y < self::$height; $y++) {
			for ($x = 0; $x < self::$width; $x++) {
				list($ch, $fg, $bg) = self::$buffer[$y][$x];
				if ($fg || $bg) {
					echo Q_Utils::colored($ch, $fg, $bg);
				} else {
					echo $ch;
				}
			}
			if ($y < self::$height - 1) {
				echo "\n";
			}
		}
	}

	/**
	 * Overwrite the current terminal line with new text.
	 *
	 * @method overwriteLine
	 * @static
	 * @param {string} text The text to display on the current line
	 * @return void
	 */
	static function overwriteLine($text)
	{
		echo "\r\033[K".$text;
	}

	/**
	 * Move the hardware cursor to a specific position (1-based).
	 *
	 * @method moveCursor
	 * @static
	 * @param {number} x The column number (1-based)
	 * @param {number} y The row number (1-based)
	 * @return void
	 */
	static function moveCursor($x, $y)
	{
		$x = max(1, min(self::$width,  $x));
		$y = max(1, min(self::$height, $y));
		echo "\033[".$y.";".$x."H";
	}

	/**
	 * Enable mouse event tracking using Xterm SGR sequences.
	 *
	 * @method enableMouse
	 * @static
	 * @return void
	 */
	static function enableMouse()
	{
		if (self::$mouseEnabled) return;
		echo "\033[?1000h";
		echo "\033[?1002h";
		echo "\033[?1006h";
		self::$mouseEnabled = true;
	}

	/**
	 * Disable mouse event tracking.
	 *
	 * @method disableMouse
	 * @return void
	 */
	static function disableMouse()
	{
		if (!self::$mouseEnabled) return;
		echo "\033[?1000l";
		echo "\033[?1002l";
		echo "\033[?1006l";
		self::$mouseEnabled = false;
	}

	/**
	 * Enable or disable raw terminal input mode (no buffering, no echo).
	 * 
	 * @method rawMode
	 * @static
	 * @param {boolean} [enable=true] Whether to enable or disable raw mode
	 * @return void
	 */
	static function rawMode($enable = true)
	{
		if (Q_Utils::isWindows()) return;

		if ($enable) {
			system('stty -echo -icanon min 1 time 0');
		} else {
			system('stty sane');
		}
	}

	/**
	 * Read high-level input events (mouse + keyboard).
	 * @method readEvents
	 * @static
	 * @return {array}
	 */
	static function readEvents()
	{
		$input = self::readInput();
		if ($input === '') {
			return array();
		}

		$events = self::parseMouseEvents($input);

		// Keyboard fallback (single characters)
		$clean = preg_replace('/\x1b\[<[^mM]+[mM]/', '', $input);
		for ($i = 0; $i < strlen($clean); $i++) {
			$ch = $clean[$i];
			if ($ch >= ' ' && $ch <= '~') {
				$events[] = array(
					'type' => 'key',
					'key'  => $ch
				);
			}
		}

		return $events;
	}


	/**
	 * Read raw terminal input (key sequences, mouse events).
	 * Non-blocking. Returns empty string if none.
	 *
	 * @method readInput
	 * @static
	 * @return {string}
	 */
	static function readInput()
	{
		stream_set_blocking(STDIN, false);
		$input = fread(STDIN, 1024);
		return $input !== false ? $input : '';
	}

	/**
	 * Parse mouse events from raw terminal input.
	 * Supports Xterm SGR (1006) mode.
	 *
	 * @method parseMouseEvents
	 * @static
	 * @param {string} $input
	 * @return {array}
	 */
	static function parseMouseEvents($input)
	{
		$events = array();

		if (!preg_match_all('/\x1b\[<(\d+);(\d+);(\d+)([mM])/', $input, $matches, PREG_SET_ORDER)) {
			return $events;
		}

		foreach ($matches as $m) {
			$code = (int)$m[1];
			$x    = (int)$m[2] - 1;
			$y    = (int)$m[3] - 1;
			$type = $m[4];

			$isMotion = ($code & 32) === 32;
			$buttonId = ($code & 3);

			$button = 'none';

			// Only assign button meaningfully
			if (!$isMotion) {
				if ($buttonId === 0) $button = 'left';
				if ($buttonId === 1) $button = 'middle';
				if ($buttonId === 2) $button = 'right';
			}

			if ($type === 'm') {
				$events[] = array(
					'type'   => 'mouseup',
					'button' => $button,
					'x'      => $x,
					'y'      => $y
				);
				continue;
			}

			if ($isMotion) {
				$events[] = array(
					'type'   => 'mousemove',
					'button' => $button, // may be 'none'
					'x'      => $x,
					'y'      => $y
				);
				continue;
			}

			$events[] = array(
				'type'   => 'mousedown',
				'button' => $button,
				'x'      => $x,
				'y'      => $y
			);
		}

		return $events;
	}

	static function shutdown()
	{
		if (!self::$started) {
			return;
		}
		self::disableMouse();
		self::rawMode(false);
		echo "\033[0m";     // reset colors
		echo "\033[?25h";   // show cursor
	}
}

Q_Terminal::start();
register_shutdown_function(array('Q_Terminal', 'shutdown'));