<?php

/**
 * @property array options
 */
class Q_Translate
{

	public $adapter;

	function __construct($options)
	{
		$this->options = $options;
		$this->initAdapter();
		$this->locales = $this->getLocales();
	}

	function getSrc($lang, $locale, $throwIfMissing = false, &$objects = null)
	{
		$arr = array();
		if (!is_dir($this->options['in'])) {
			if ($throwIfMissing) {
				throw new Q_Exception("No such source directory: " . $this->options['in'] . "\n");
			}
		}
		$objects = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(
			$this->options['in'], 
			RecursiveDirectoryIterator::SKIP_DOTS
		), RecursiveIteratorIterator::SELF_FIRST);
		foreach ($objects as $filename => $object) {
			if (basename($filename) === $lang . ($locale ? '-' . $locale : '') . '.json') {
				$all = Q_Tree::createAndLoad($filename)->getAll();
				$res = array();
				$srcPath = ltrim(str_replace($this->options['in'], "", $filename), '/');
				$this->flatten($srcPath, $all, $res);
				$arr = array_merge($arr, $res);
			}
		}
		if (!sizeof($arr) and !$throwIfMissing) {
			if ($throwIfMissing) {
				throw new Q_Exception("No source files found for " . $lang . ($locale ? '-' . $locale : '') . "\n");
			}
		}
		return $arr;
	}

	function toRemove($flattened) {
		$paths = array();
		$rm = Q::ifset($this->options, 'remove', array());
		$rm = is_array($rm) ? $rm : array($rm);
		foreach ($rm as $v2) {
			$parts = Q_Utils::explodeEscaped('/', $v2);
			foreach ($flattened as $n => $d) {
				foreach ($parts as $i => $p) {
					if ($p !== $d['key'][$i]) {
						continue 2;
					}
				}
				$paths[$n] = $parts;
			}
		}
		return $paths;
	}

	function createDirectory($dir)
	{
		$dir = $this->joinPaths($this->options['out'], $dir);
		if (!is_dir($dir)) {
			mkdir($dir, 0755, true);
		}
		return $dir;
	}

	function joinPaths()
	{
		$paths = array();
		foreach (func_get_args() as $arg) {
			if ($arg !== '') {
				$paths[] = $arg;
			}
		}
		return preg_replace('#/+#', DS, join(DS, $paths));
	}

	static function filter($str)
	{
		$result = null;
		Q::event('Q/translate/filter', compact('str'), 'before', false, $result);
		if (isset($result)) {
			return $result;
		}
		if (!is_string($str)) {
			return false;
		}
		$lettersOnly = preg_replace('/[^\p{L}]+/u', '', $str);
		return (mb_strlen($lettersOnly, 'UTF-8') > 1);
	}


	static function arrayToBranch($arr)
	{
		$key = array_shift($arr);
		if (!$arr) {
			return $key;
		}
		return array($key => Q_Translate::arrayToBranch($arr));
	}

	public function getLocales()
	{
		$appLocalConfig = APP_LOCAL_DIR . DS . 'locales.json';
		$appConfig = APP_CONFIG_DIR . DS . 'locales.json';
		$platformConfig = Q_CONFIG_DIR . DS . 'Q' . DS . 'locales.json';
		$config = null;
		if (!empty($this->options['locales-file'])) {
			$tree = Q_Tree::createAndLoad($this->options['locales-file']);
		} else if (file_exists($appLocalConfig)) {
			$tree = Q_Tree::createAndLoad($appLocalConfig);
		} elseif (file_exists($appConfig)) {
			$tree = Q_Tree::createAndLoad($appConfig);
		} elseif (file_exists($platformConfig)) {
			$tree = Q_Tree::createAndLoad($platformConfig);
		}
		if (!$tree) {
			throw new Exception('Empty locales.json');
		}
		$arr = $tree->getAll();
		$locales = Q::ifset($this->options, 'locales', 
			Q::ifset($this->options, 'l', null)
		);
		if (!$locales) {
			return $arr;
		}
		$items = array();
		foreach (explode(' ', $locales) as $ll) {
			if ($ll = strtolower(trim($ll))) {
				$items[$ll] = true;
			}
		}
		$result = array();
		foreach ($arr as $lang => $locales) {
			$lang = strtolower($lang);
			foreach ($locales as $i => $l) {
				$l_lower = strtolower($l);
				if (isset($items[$lang])
				or isset($items["$lang-$l_lower"])) {
					$result[$lang][] = strtoupper($l);
				}
			}
		}
		return $result;
	}

	protected function flatten($filename, $arr, & $res = null, & $key = array())
	{
		foreach ($arr as $itemKey => $item) {
			$key[] = $itemKey;

			if (is_array($item)) {
				// Pass down whether this array is associative
				$this->flatten($filename, $item, $res, $key);
			} else {
				$pathinfo = pathinfo($filename);
				$dirname  = $pathinfo['dirname'];
				$k = $dirname . "\t" . implode("\t", $key);

				$res[$k] = array(
					"filename" => $filename,
					"dirname"  => $dirname,
					"key"      => $key,
					"value"    => $item,
					"original" => $item,
					"parentIsAssoc" => Q::isAssociative($arr)
				);
			}

			array_pop($key);
		}
	}

	protected function initAdapter()
	{

		switch ($this->options['format'])
		{
			case 'google':
				$this->adapter = new Q_Translate_Google($this);
				break;
			case 'human':
				$this->adapter = new Q_Translate_Human($this);
				break;
			default:
				throw new Q_Exception("Unknown format value\n");
		}
	}

	function saveAll() {
		$parts = preg_split("/(_|-)/", $this->options['source']);
		$fromLang = $parts[0];
		$locale = count($parts) > 1 ? $parts[1] : null;
		$in = $this->getSrc($fromLang, $locale, true);
		$useLocale = Q_Config::get('Q', 'text', 'useLocale', false);
		foreach ($this->locales as $toLang => $localeNames) {
			$b1 = "\033[1m";
			$b2 = "\033[0m";
			echo $b1."Processing $fromLang->$toLang" . $b2;
			if ($useLocale) {
				echo '  (' . implode(' ', $localeNames) . ')';
			}
			echo PHP_EOL;
			if ($toLang !== $fromLang) {
				$out = $this->getSrc($toLang, $locale, false);
				$toRemove = $this->toRemove($out);
				$res = $this->adapter->translate($fromLang, $toLang, $in, $out, $toRemove, 100);
				foreach ($toRemove as $n => $parts) {
					unset($res[$n]);
				}
			} else if ($this->options['out']) {
				$res = $in;
				$toRemove = $this->toRemove($in);
				foreach ($toRemove as $n => $parts) {
					unset($res[$n]);
				}
			}
			if (isset($res) and is_array($res)) {
				$this->saveJson($toLang, $res, $jsonFiles);
			}
			if (!$useLocale) {
				continue;
			}
			if (!empty($this->options['in'])
			&& !empty($this->options['out'])
			&& ($fromLang == $toLang)
			&& ($this->options['in'] === $this->options['out'])) {
				foreach ($localeNames as $localeName) {
					$this->saveLocale($toLang, $localeName, $res, $jsonFiles, $toRemove);
				}
				continue;
			}
			if (isset($this->options['locales'])) {
				foreach ($localeNames as $localeName) {
					$this->saveLocale($toLang, $localeName, $res, $jsonFiles, $toRemove);
				}
			}
		}
	}
	
	private function saveLocale($lang, $locale, $res, $jsonFiles, $toRemove)
	{
		foreach ($jsonFiles as $dirname => $content) {
			$directory = $this->createDirectory($dirname);
			$langFile = $directory . DS . "$lang.json";
			$localeFile = $directory . DS . "$lang-$locale.json";
			if (file_exists($localeFile)) {
				$arr = $content;
				$tree = new Q_Tree();
				$tree->load($localeFile);
				$tree->merge($arr, false, true);
				foreach ($toRemove as $n => $parts) {
					call_user_func_array(array($tree, 'clear'), $parts);
				}
				$tree->save($localeFile, array(), null, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
			} else {
				copy($langFile, $localeFile);
			}
		}
	}

	private function saveJson($lang, $data, &$jsonFiles)
	{
		$jsonFiles = array();
		$assocHints = array();

		// Collect flattened data and assoc hints
		foreach ($data as $d) {
			$dirname = $d['dirname'];
			$arr =& $jsonFiles[$dirname];
			if (!$arr || !sizeof($arr)) {
				$arr = array();
			}

			// Track the parent path for this leaf
			if (isset($d['parentIsAssoc'])) {
				$parentPath = implode("\t", array_slice($d['key'], 0, -1));
				$assocHints[$dirname][$parentPath] = $d['parentIsAssoc'];
			}

			// Merge into tree
			array_push($d['key'], $d['value']);
			$tree = new Q_Tree($arr);
			$tree->merge(Q_Translate::arrayToBranch($d['key']), false, true);
		}

		$filenames = array();
		foreach ($jsonFiles as $dirname => $content) {
			// Apply assoc hints recursively before saving
			if (!empty($assocHints[$dirname])) {
				$this->applyAssocHints($content, array(), $assocHints[$dirname]);
			}

			$dir = $this->createDirectory($dirname);
			$filename = $this->joinPaths($dir, $lang . '.json');
			$filenames[] = $filename;

			$fp = fopen($filename, 'w');
			fwrite($fp, Q::json_encode($content, JSON_PRETTY_PRINT | Q_JSON::JSON_PRETTY_TABS));
			fclose($fp);
		}
		return $filenames;
	}

	/**
	 * Recursively walk content and normalize arrays using assoc hints.
	 *
	 * @param mixed $node   Current subtree (modified in place)
	 * @param array $path   Current key path
	 * @param array $hints  Map of "path string" → isAssoc
	 */
	private function applyAssocHints(&$node, $path, $hints)
	{
		$pathStr = implode("\t", $path);

		if (isset($hints[$pathStr]) && $hints[$pathStr] === false && is_array($node)) {
			// Ensure numeric ordering
			ksort($node, SORT_NUMERIC);

			// Recurse into children first
			foreach ($node as $k => &$child) {
				$this->applyAssocHints($child, array_merge($path, array($k)), $hints);
			}

			// Finally, reindex sequentially
			$node = array_values($node);
			return;
		}

		if (is_array($node)) {
			foreach ($node as $k => &$child) {
				$this->applyAssocHints($child, array_merge($path, array($k)), $hints);
			}
		}
	}

	public $options;
	public $locales;

}

