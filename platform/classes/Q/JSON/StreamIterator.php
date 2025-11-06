<?php

class Q_JSON_StreamIterator implements Iterator
{
	private $handle;
	private $filename;
	private $options;

	private $buffer = '';
	private $stack  = array();   // stack of array(char, absolutePos)
	private $path   = array();   // semantic path: keys/indices
	private $current;
	private $key = 0;

	private $globalOffset = 0;   // absolute offset of buffer[0] in file
	private $valueStart   = null; // absolute start offset of current primitive

	public function __construct($filename, $options = array())
	{
		$this->filename = $filename;
		$this->options  = $options;

		// Default path is array(true) (yield everything at root)
		if (!isset($this->options['path'])) {
			$this->options['path'] = array(true);
		}

		$this->openHandle();
	}

	private function openHandle()
	{
		$this->handle = fopen($this->filename, 'r');
		if (!$this->handle) {
			throw new RuntimeException("Unable to open file: " . $this->filename);
		}
		$this->buffer        = '';
		$this->stack         = array();
		$this->path          = array();
		$this->current       = null;
		$this->key           = 0;
		$this->globalOffset  = 0;
		$this->valueStart    = null;
		$this->pos           = 0;
	}

	#[\ReturnTypeWillChange]
	public function rewind()
	{
		if ($this->handle) fclose($this->handle);
		$this->openHandle();
		$this->next();
	}

	#[\ReturnTypeWillChange] public function current() { return $this->current; }
	#[\ReturnTypeWillChange] public function key()     { return $this->key; }
	#[\ReturnTypeWillChange] public function valid()   { return $this->current !== null; }

	#[\ReturnTypeWillChange]
	public function next()
	{
		$this->current = null;

		while (true) {
			$len = strlen($this->buffer);

			// need more data?
			if ($this->pos >= $len) {
				if (feof($this->handle) && $len === 0) {
					return; // nothing left
				}
				$chunk = fgets($this->handle, 8192);
				if ($chunk === false) return; // EOF
				$this->buffer .= $chunk;
				$len = strlen($this->buffer);
				continue;
			}

			while ($this->pos < $len) {
				$next = strcspn($this->buffer, "\"{}[],:", $this->pos);
				if ($next > 0 && $this->valueStart === null) {
					$this->valueStart = $this->globalOffset + $this->pos;
				}
				$this->pos += $next;
				if ($this->pos >= $len) break;

				$ch = $this->buffer[$this->pos];
				$this->pos++;

				// ---- string toggle ----
				if ($ch === '"') {
					$bs = 0;
					for ($j = $this->pos - 2; $j >= 0 && $this->buffer[$j] === '\\'; $j--) $bs++;
					if ($bs % 2 === 0) {
						if (!empty($this->stack) && end($this->stack)[0] === '"') {
							array_pop($this->stack);
						} else {
							$this->stack[] = array('"', $this->globalOffset + $this->pos - 1);
						}
					}
					continue;
				}

				// ---- not inside string ----
				if (empty($this->stack) || end($this->stack)[0] !== '"') {
					if ($ch === '{') {
						$this->stack[]   = array('{', $this->globalOffset + $this->pos - 1);
						$this->valueStart = null;
					} else if ($ch === '[') {
						$this->stack[]   = array('[', $this->globalOffset + $this->pos - 1);
						$this->path[]    = 0;
						$this->valueStart = null;
					} else if ($ch === '}' || $ch === ']') {
						// emit last primitive if any
						if ($this->valueStart !== null) {
							$fragAbsStart = $this->valueStart;
							$fragAbsEnd   = $this->globalOffset + $this->pos - 1;
							$start        = $fragAbsStart - $this->globalOffset;
							$lenFrag      = $fragAbsEnd - $fragAbsStart;

							if ($lenFrag > 0) {
								$fragment = substr($this->buffer, $start, $lenFrag);
								if ($this->emitPrimitive($fragment)) {
									if (count($this->path) < count($this->options['path'])) {
										$this->buffer = substr($this->buffer, $this->pos);
										$this->globalOffset += $this->pos;
										$len = strlen($this->buffer);
										$this->pos = 0;
									}
									$this->valueStart = null;
									return;
								}
							}
							$this->valueStart = null;
						}

						$tpc = count($this->path);
						$topc = count($this->options['path']);
						$open = array_pop($this->stack);
						array_pop($this->path);

						if ($open && ($open[0] === '{' || $open[0] === '[')) {
							$start    = $open[1] - $this->globalOffset;
							$fragment = substr($this->buffer, $start, $this->pos - $start);

							if ($this->emit($fragment)) {
								return;
							}

							if ($tpc < $topc) {
								$this->buffer = substr($this->buffer, $this->pos);
								$this->globalOffset += $this->pos;
								$len = strlen($this->buffer);
								$this->pos = 0;
								continue;
							}
						}
					} else if ($ch === ',') {
						if (!empty($this->stack)) {
							$container = end($this->stack)[0];
						}

						$shouldReturn = false;
						if ($this->valueStart !== null) {
							$fragAbsStart = $this->valueStart;
							$fragAbsEnd   = $this->globalOffset + $this->pos - 1;
							$start        = $fragAbsStart - $this->globalOffset;
							$lenFrag      = $fragAbsEnd - $fragAbsStart;

							if ($lenFrag > 0) {
								$fragment = substr($this->buffer, $start, $lenFrag);
								if ($this->emitPrimitive($fragment)) {
									$shouldReturn = true;
								}
							}
						}
						$this->valueStart = null;
						if (!empty($this->stack)) {
							$container = end($this->stack)[0];
							if ($container === '[') {
								$last = array_pop($this->path);
								$this->path[] = $last + 1;
							} else if ($container === '{') {
								if (!empty($this->path)) array_pop($this->path);
							}
						}
						if ($shouldReturn) {
							return;
						}
					} else if ($ch === ':') {
						if (!empty($this->stack) && end($this->stack)[0] === '{') {
							$before   = substr($this->buffer, 0, $this->pos-1);
							$quoteEnd = strrpos($before, '"');
							if ($quoteEnd !== false) {
								$quoteStart = strrpos(substr($before, 0, $quoteEnd), '"');
								if ($quoteStart !== false) {
									$key = substr($before, $quoteStart+1, $quoteEnd-$quoteStart-1);
									$this->path[] = $key;
								}
							}
						}
						$this->valueStart = null;
					}
				}
			}
		}
	}

    private function emit($json)
    {
        $json = trim($json);
        if ($json === '') return false;

        $val = Q_JSON::decode($json, true);

		$matched   = $this->pathMatches($this->path);
		$filterLen = count($this->options['path']);

		if (!empty($this->options['callback']) && $matched >= $filterLen) {
			$key = end($this->path);
			call_user_func($this->options['callback'], $val, $key, $this->path);
		}

		// Iterator only yields on exact match
		if ($filterLen === $matched and $filterLen === count($this->path)) {
			$this->current = $val;
			$this->key     = end($this->path);
			return true;
		}

		return false;
    }

    private function emitPrimitive($frag)
    {
        $frag = trim($frag, ", \r\n\t");
        if ($frag === '' || $frag === '{' || $frag === '[') return false;

        try {
            $val = Q_JSON::decode($frag, true);
        } catch (Exception $e) {
            return false;
        }

		$matched   = $this->pathMatches($this->path);
		$filterLen = count($this->options['path']);

		if (!empty($this->options['callback']) && $matched >= $filterLen) {
			$key = end($this->path);
			call_user_func($this->options['callback'], $val, $key, $this->path);
		}

		// Iterator only yields on exact match
		if ($filterLen === $matched and $filterLen === count($this->path)) {
			$this->current = $val;
			$this->key     = end($this->path);
			return true;
		}

		return false;
    }

	private function pathMatches(array $path): int
	{
		$filter = $this->options['path'];
		$matched = 0;

		foreach ($filter as $i => $seg) {
			if (!array_key_exists($i, $path)) {
				break;
			}
			if ($seg === true || $seg === $path[$i]) {
				$matched++;
				continue;
			}
			break;
		}

		return $matched;
	}

	private function formatYield($key, $value, $path)
    {
        $assoc  = !empty($this->options['associative']);
        $filter = isset($this->options['path']);

        if ($assoc && $filter) return array('key'=>$key, 'value'=>$value, 'path'=>$path);
        if ($assoc)             return array('key'=>$key, 'value'=>$value);
        if ($filter)            return array('value'=>$value, 'path'=>$path);
        return $value;
    }

	public function __destruct()
	{
		if ($this->handle) fclose($this->handle);
	}
}