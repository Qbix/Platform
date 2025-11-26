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
	private $width;
	private $height;

	private $buffer = [];        // [y][x] = [char, fg, bg]
	private $mouseEnabled = false;

	/**
	 * Construct a terminal instance and detect its size.
	 * Falls back to 80×24 if size cannot be detected.
	 *
	 * @constructor
	 * @method Q_Terminal
	 */
	public function __construct()
	{
		$this->updateSize();

		for ($y = 0; $y < $this->height; $y++) {
			$this->buffer[$y] = [];
			for ($x = 0; $x < $this->width; $x++) {
				$this->buffer[$y][$x] = [' ', null, null];
			}
		}
	}

	/**
	 * Update terminal width and height from system stty.
	 *
	 * @method updateSize
	 * @return void
	 */
	public function updateSize()
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

		$this->width = $cols;
		$this->height = $rows;
	}

	/**
	 * Get terminal width in characters.
	 *
	 * @method getWidth
	 * @return {number}
	 */
	public function getWidth()
	{
		return $this->width;
	}

	/**
	 * Get terminal height in characters.
	 *
	 * @method getHeight
	 * @return {number}
	 */
	public function getHeight()
	{
		return $this->height;
	}

	/**
	 * Write a single character into the internal screen buffer.
	 *
	 * @method write
	 * @param {number} x The X coordinate (0-based)
	 * @param {number} y The Y coordinate (0-based)
	 * @param {string} char The character to write
	 * @param {string} [fg] Optional foreground color name or ANSI code
	 * @param {string} [bg] Optional background color name or ANSI code
	 * @return {boolean} Whether the write occurred
	 */
	public function write($x, $y, $char, $fg = null, $bg = null)
	{
		if ($x < 0 || $y < 0 || $x >= $this->width || $y >= $this->height) {
			return false;
		}
		if (strlen($char) > 1) {
			$char = mb_substr($char, 0, 1);
		}
		$this->buffer[$y][$x] = [$char, $fg, $bg];
		return true;
	}

	/**
	 * Read a character entry from the internal buffer.
	 *
	 * @method read
	 * @param {number} x The X coordinate (0-based)
	 * @param {number} y The Y coordinate (0-based)
	 * @return {array|null} `[char, fg, bg]` or null if out of bounds
	 */
	public function read($x, $y)
	{
		if ($x < 0 || $y < 0 || $x >= $this->width || $y >= $this->height) {
			return null;
		}
		return $this->buffer[$y][$x];
	}

	/**
	 * Clear both the internal buffer and the visible terminal.
	 *
	 * @method clear
	 * @return void
	 */
	public function clear()
	{
		for ($y = 0; $y < $this->height; $y++) {
			for ($x = 0; $x < $this->width; $x++) {
				$this->buffer[$y][$x] = [' ', null, null];
			}
		}
		echo "\033[2J\033[H";
	}

	/**
	 * Flush the internal buffer to the terminal display.
	 *
	 * @method flush
	 * @return void
	 */
	public function flush()
	{
		echo "\033[H";
		for ($y = 0; $y < $this->height; $y++) {
			for ($x = 0; $x < $this->width; $x++) {
				list($ch, $fg, $bg) = $this->buffer[$y][$x];
				if ($fg || $bg) {
					echo Q_Utils::colored($ch, $fg, $bg);
				} else {
					echo $ch;
				}
			}
			if ($y < $this->height - 1) {
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
	public static function overwriteLine($text)
	{
		echo "\r\033[K".$text;
	}

	/**
	 * Move the hardware cursor to a specific position (1-based).
	 *
	 * @method moveCursor
	 * @param {number} x The column number (1-based)
	 * @param {number} y The row number (1-based)
	 * @return void
	 */
	public function moveCursor($x, $y)
	{
		$x = max(1, min($this->width,  $x));
		$y = max(1, min($this->height, $y));
		echo "\033[".$y.";".$x."H";
	}

	/**
	 * Enable mouse event tracking using Xterm SGR sequences.
	 *
	 * @method enableMouse
	 * @return void
	 */
	public function enableMouse()
	{
		if ($this->mouseEnabled) return;
		echo "\033[?1000h";
		echo "\033[?1002h";
		echo "\033[?1006h";
		$this->mouseEnabled = true;
	}

	/**
	 * Disable mouse event tracking.
	 *
	 * @method disableMouse
	 * @return void
	 */
	public function disableMouse()
	{
		if (!$this->mouseEnabled) return;
		echo "\033[?1000l";
		echo "\033[?1002l";
		echo "\033[?1006l";
		$this->mouseEnabled = false;
	}

	/**
	 * Enable or disable raw terminal input mode (no buffering, no echo).
	 * 
	 * @method rawMode
	 * @param {boolean} [enable=true] Whether to enable or disable raw mode
	 * @return void
	 */
	public function rawMode($enable = true)
	{
		if (Q_Utils::isWindows()) return;

		if ($enable) {
			system('stty -echo -icanon min 1 time 0');
		} else {
			system('stty sane');
		}
	}

	/**
	 * 
	 * Read raw terminal input (key sequences, mouse events).
	 * Non-blocking. Returns empty string if none.
	 *
	 * @method readInput
	 * @return {string}
	 */
	public function readInput()
	{
		stream_set_blocking(STDIN, false);
		$input = fread(STDIN, 1024);
		return $input !== false ? $input : '';
	}
}
