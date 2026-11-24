<?php

class Q_Zip
{
	protected $zip;
	protected $org_files = [];
	protected $new_file_path;
	protected $extr_file;
	protected $extr_dirc;

	/**
	 * Whether the ZipArchive PHP extension is available.
	 * When false, shell commands (zip/unzip) are used as fallback.
	 * @method hasExtension
	 * @static
	 * @return {bool}
	 */
	public static function hasExtension() {
		return class_exists('ZipArchive');
	}

	/**
	 * Find a shell binary by name, checking common paths then PATH.
	 * @method findBin
	 * @static
	 * @param {string} $name Binary name (e.g. 'zip', 'unzip')
	 * @return {string|null} Absolute path or null
	 */
	private static function findBin($name) {
		foreach (array('/usr/bin/', '/usr/local/bin/', '/bin/') as $dir) {
			if (file_exists($dir . $name)) return $dir . $name;
		}
		$which = trim(shell_exec('which ' . escapeshellarg($name) . ' 2>/dev/null') ?: '');
		return ($which && file_exists($which)) ? $which : null;
	}

	/**
	 * Starts a zip session to create or update a zip file.
	 * @method zip_start
	 * @param {string} $file_path Path to the zip file
	 * @return {bool}
	 */
	public function zip_start($file_path) {
		if (!self::hasExtension() && !self::findBin('zip')) {
			throw new Exception("Q_Zip: Neither ZipArchive extension nor zip command available.");
		}
		$this->new_file_path = $file_path;
		$this->org_files = [];
		return true;
	}

	/**
	 * Adds one or more files/directories to be zipped.
	 * @method zip_add
	 * @param {string|array} $in File path(s) or directory path(s)
	 * @return {bool}
	 */
	public function zip_add($in) {
		if (!$this->new_file_path) {
			throw new Exception("Q_Zip: Call zip_start first.");
		}
		if (is_array($in)) {
			foreach ($in as $item) {
				$this->zip_add($item);
			}
		} elseif (is_string($in) && file_exists($in)) {
			if (is_dir($in)) {
				$this->push_whole_dir($in);
			} else {
				$this->org_files[] = $in;
			}
		}
		return true;
	}

	/**
	 * Finalizes and creates the zip file.
	 * @method zip_end
	 * @return {bool}
	 */
	public function zip_end() {
		if (self::hasExtension()) {
			$this->zip = new ZipArchive();
			if (!$this->zip->open($this->new_file_path, ZipArchive::CREATE)) {
				throw new Exception("Q_Zip: Failed to open/create archive.");
			}
			$names = $this->commonPath($this->org_files, true);
			foreach ($this->org_files as $i => $path) {
				$this->zip->addFile($path, $names[$i]);
			}
			$this->zip->close();
		} else {
			$bin = self::findBin('zip');
			if (!$bin) {
				throw new Exception("Q_Zip: zip command not found.");
			}
			$names = $this->commonPath($this->org_files, true);
			// Build a file list in a temp file (avoids arg-length limits)
			$listFile = tempnam(sys_get_temp_dir(), 'qzip_') . '.txt';
			$lines = [];
			foreach ($this->org_files as $i => $path) {
				$lines[] = $names[$i];
			}
			file_put_contents($listFile, implode("\n", $lines));
			// Determine the common root to cd into
			$commonDirs = $this->commonPath($this->org_files, false);
			$commonRoot = isset($commonDirs[0]) ? $commonDirs[0] : dirname($this->org_files[0]);
			$outPath = realpath(dirname($this->new_file_path))
				. DIRECTORY_SEPARATOR . basename($this->new_file_path);
			$cmd = 'cd ' . escapeshellarg($commonRoot)
				. ' && ' . escapeshellarg($bin) . ' -r '
				. escapeshellarg($outPath)
				. ' -@ < ' . escapeshellarg($listFile) . ' 2>&1';
			$output = [];
			$exitCode = -1;
			exec($cmd, $output, $exitCode);
			@unlink($listFile);
			if ($exitCode !== 0) {
				throw new Exception("Q_Zip: zip command failed: " . implode("\n", array_slice($output, -3)));
			}
		}
		$this->org_files = [];
		return true;
	}

	/**
	 * One-liner to zip files.
	 * @method zip_files
	 * @param {string|array} $files Files or dirs to zip
	 * @param {string} $to Output zip path
	 * @return {bool}
	 */
	public function zip_files($files, $to) {
		$this->zip_start($to);
		$this->zip_add($files);
		return $this->zip_end();
	}

	/**
	 * Opens a zip file for extraction.
	 * @method unzip_file
	 * @param {string} $file_path Path to the zip file
	 * @param {string|null} $target_dir Destination dir
	 * @return {bool}
	 */
	public function unzip_file($file_path, $target_dir = null) {
		if (!file_exists($file_path)) {
			throw new Exception("Q_Zip: File does not exist.");
		}
		$this->extr_file = $file_path;
		if ($target_dir !== null) {
			return $this->unzip_to($target_dir);
		}
		return true;
	}

	/**
	 * Extracts the zip to a directory.
	 * @method unzip_to
	 * @param {string} $target_dir Destination directory
	 * @return {bool}
	 */
	public function unzip_to($target_dir) {
		if (!$this->extr_file) {
			throw new Exception("Q_Zip: Call unzip_file first.");
		}
		if (!is_dir($target_dir) && !mkdir($target_dir, 0777, true)) {
			throw new Exception("Q_Zip: Failed to create target directory.");
		}
		if (self::hasExtension()) {
			$zip = new ZipArchive();
			if (!$zip->open($this->extr_file)) {
				throw new Exception("Q_Zip: Cannot open archive.");
			}
			if (!$zip->extractTo($target_dir)) {
				throw new Exception("Q_Zip: Extraction failed.");
			}
			$zip->close();
		} else {
			$bin = self::findBin('unzip');
			if (!$bin) {
				throw new Exception("Q_Zip: Neither ZipArchive extension nor unzip command available.");
			}
			$output = [];
			$exitCode = -1;
			exec(
				escapeshellarg($bin) . ' -o '
				. escapeshellarg($this->extr_file)
				. ' -d ' . escapeshellarg($target_dir) . ' 2>&1',
				$output, $exitCode
			);
			if ($exitCode !== 0) {
				throw new Exception("Q_Zip: unzip failed: " . implode("\n", array_slice($output, -3)));
			}
		}
		return true;
	}

	/**
	 * Lists the contents of a zip file without extracting.
	 * @method listContents
	 * @param {string} $file_path Path to the zip file
	 * @return {array} Array of entry names
	 */
	public function listContents($file_path) {
		if (!file_exists($file_path)) {
			throw new Exception("Q_Zip: File does not exist.");
		}
		$entries = [];
		if (self::hasExtension()) {
			$zip = new ZipArchive();
			if (!$zip->open($file_path)) {
				throw new Exception("Q_Zip: Cannot open archive.");
			}
			for ($i = 0; $i < $zip->numFiles; $i++) {
				$entries[] = $zip->getNameIndex($i);
			}
			$zip->close();
		} else {
			$bin = self::findBin('unzip');
			if (!$bin) {
				throw new Exception("Q_Zip: Neither ZipArchive extension nor unzip command available.");
			}
			$output = [];
			exec(escapeshellarg($bin) . ' -Z -1 ' . escapeshellarg($file_path) . ' 2>&1', $output);
			foreach ($output as $line) {
				$line = trim($line);
				if ($line !== '') $entries[] = $line;
			}
		}
		return $entries;
	}

	/**
	 * Recursively collects file paths from a directory.
	 * @method push_whole_dir
	 * @param {string} $dir Directory path
	 */
	private function push_whole_dir($dir) {
		$rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));
		foreach ($rii as $file) {
			if (!$file->isDir()) {
				$this->org_files[] = $file->getPathname();
			}
		}
	}

	/**
	 * Normalizes path components with platform separator.
	 * @method path
	 * @return {string}
	 */
	private function path() {
		return join(DIRECTORY_SEPARATOR, func_get_args());
	}

	/**
	 * Removes common path from file list (used for relative zip paths).
	 * @method commonPath
	 * @param {array} $files
	 * @param {bool} $remove Whether to return relative paths
	 * @return {array}
	 */
	private function commonPath($files, $remove = true) {
		foreach ($files as $index => $file) {
			$files[$index] = explode(DIRECTORY_SEPARATOR, $file);
		}
		$toDiff = $files;
		foreach ($toDiff as $i => $arr) {
			foreach ($arr as $j => $v) {
				$toDiff[$i][$j] = $v . "___" . $j;
			}
		}
		$diff = call_user_func_array('array_diff', $toDiff);
		reset($diff);
		$i = key($diff) - 1;
		if ($remove) {
			foreach ($files as $k => $arr) {
				$files[$k] = implode(DIRECTORY_SEPARATOR, array_slice($arr, $i));
			}
		} else {
			foreach ($files as $k => $arr) {
				$files[$k] = implode(DIRECTORY_SEPARATOR, array_slice($arr, 0, $i));
			}
		}
		return $files;
	}
}