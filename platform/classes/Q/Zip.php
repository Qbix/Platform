<?php

class Q_Zip
{
	protected $zip;
	protected $org_files = [];
	protected $new_file_path;
	protected $extr_file;
	protected $extr_dirc;

	/**
	 * Starts a zip session to create or update a zip file.
	 * @method zip_start
	 * @param {string} $file_path Path to the zip file
	 * @return {bool}
	 */
	public function zip_start($file_path) {
		if (!class_exists('ZipArchive')) {
			throw new Exception("ZipArchive not available.");
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
		$this->zip = new ZipArchive();
		if (!$this->zip->open($this->new_file_path, ZipArchive::CREATE)) {
			throw new Exception("Q_Zip: Failed to open/create archive.");
		}
		$names = $this->commonPath($this->org_files, true);
		foreach ($this->org_files as $i => $path) {
			$this->zip->addFile($path, $names[$i]);
		}
		$this->zip->close();
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
		$zip = new ZipArchive();
		if (!$zip->open($this->extr_file)) {
			throw new Exception("Q_Zip: Cannot open archive.");
		}
		if (!$zip->extractTo($target_dir)) {
			throw new Exception("Q_Zip: Extraction failed.");
		}
		$zip->close();
		return true;
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