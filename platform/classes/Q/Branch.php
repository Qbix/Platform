<?php

/**
 * @module Q
 */

/**
 * Copy-on-write directory branching via symlinks.
 *
 * When a branch is forked for the first time, each real file is moved to a
 * sibling "store" directory ({branchDir}~store/) and replaced with a symlink.
 * The new fork receives its own symlinks pointing at the same store files.
 * Thereafter any write to either branch — source or fork — hits is_link(),
 * copies the store content to a fresh real file, and writes to that, leaving
 * the other branch's symlink pointing at the original store file untouched.
 *
 * Forks-of-forks never chain symlinks: _forkDir() calls readlink() on any
 * existing symlink so the new fork always points directly at the real file in
 * whichever store holds it.
 *
 * Branch names are forward-slash-separated logical paths that map to
 * directories under a configurable root:
 *
 *   branch "Streams/ali/ce/Chat/main"
 *   dir    {root}/Streams/ali/ce/Chat/main/
 *   store  {root}/Streams/ali/ce/Chat/main~store/
 *
 * Branch names ending in ~store are reserved — do not use them as branch names.
 *
 * Works on Linux, macOS, and Windows (symlinks via Q_Utils::symlink / mklink).
 * Does not require hardlinks, ZFS, or a blob store.
 *
 * Streams usage — the root is APP_FILES_DIR/Q/uploads, so branch->dir() maps
 * exactly to the existing stream uploads path. No migration needed.
 *
 * @class Q_Branch
 */
class Q_Branch
{
	/** @var string Logical branch name (forward-slash separated) */
	protected $name;

	/** @var string Absolute path to the branch store root */
	protected $root;

	/** @var array Flyweight cache [root . NUL . name => Q_Branch] */
	protected static $instances = array();

	// =========================================================================
	// Construction
	// =========================================================================

	/**
	 * @method __construct
	 * @param {string} $name    Logical branch name (e.g. "Streams/ali/ce/Chat/main")
	 * @param {array}  [$options]
	 * @param {string} [$options.directory]  Path relative to APP_FILES_DIR for the
	 *   branch store root. Defaults to Q/branches/directory config, then Q/branches.
	 */
	function __construct($name, $options = array())
	{
		$this->name = trim(str_replace('\\', '/', $name), '/');
		if (isset($options['root'])) {
			// Internal use (e.g. fork()) — already-computed absolute path
			$this->root = $options['root'];
		} else {
			$this->root = APP_FILES_DIR . DS . Q::ifset(
				$options, 'directory',
				Q_Config::get('Q', 'branches', 'directory', 'Q' . DS . 'branches')
			);
		}
	}

	/**
	 * Flyweight factory — returns a cached instance for the same name + root.
	 * @method of
	 * @static
	 * @param {string} $name
	 * @param {array}  [$options]
	 * @return {Q_Branch}
	 */
	static function of($name, $options = array())
	{
		$root = APP_FILES_DIR . DS . Q::ifset(
			$options, 'directory',
			Q_Config::get('Q', 'branches', 'directory', 'Q' . DS . 'branches')
		);
		$key = $root . "\0" . $name;
		if (!isset(self::$instances[$key])) {
			self::$instances[$key] = new self($name, $options);
		}
		return self::$instances[$key];
	}

	// =========================================================================
	// Identity
	// =========================================================================

	/**
	 * The logical name of this branch.
	 * @method name
	 * @return {string}
	 */
	function name()
	{
		return $this->name;
	}

	/**
	 * Absolute filesystem path to this branch's directory.
	 * @method dir
	 * @return {string}
	 */
	function dir()
	{
		$safe = str_replace(array('..', "\0"), '', $this->name);
		return $this->root . DS . str_replace('/', DS, $safe);
	}

	/**
	 * Absolute path to this branch's immutable file store.
	 * Real files live here after the branch is first forked; the branch
	 * directory holds symlinks pointing into this store.
	 * Sibling of dir() with a ~store suffix on the last component.
	 * @method storeDir
	 * @return {string}
	 */
	function storeDir()
	{
		return $this->dir() . '~store';
	}

	/**
	 * Whether this branch's directory exists on disk.
	 * @method exists
	 * @return {boolean}
	 */
	function exists()
	{
		return is_dir($this->dir());
	}

	// =========================================================================
	// Initialisation
	// =========================================================================

	/**
	 * Initialise this branch from an existing directory on disk.
	 * No-op if the branch directory already exists.
	 * Returns false if $srcDir does not exist.
	 *
	 * @method initFromDir
	 * @param {string} $srcDir   Absolute path to import from
	 * @param {array}  [$options]
	 * @param {bool}   [$options.move=false]  Move instead of copy (srcDir
	 *   will no longer exist after this call).
	 * @return {bool}
	 */
	function initFromDir($srcDir, $options = array())
	{
		$dir = $this->dir();
		if (is_dir($dir)) {
			return true;
		}
		if (!is_dir($srcDir)) {
			return false;
		}
		Q_Utils::canWriteToPath(dirname($dir), true, true);
		if (Q::ifset($options, 'move', false)) {
			return rename($srcDir, $dir);
		}
		return Q_Utils::cp($srcDir, $dir);
	}

	// =========================================================================
	// Branching
	// =========================================================================

	/**
	 * Fork this branch into a new branch.
	 *
	 * For each real file in this branch's directory:
	 *   - It is moved to this branch's storeDir (making it immutable).
	 *   - A symlink is placed at the original source path pointing to the store.
	 *   - A symlink is placed in the new fork directory pointing to the store.
	 *
	 * For files that are already symlinks (from a previous fork), readlink()
	 * resolves the target so the new fork always points directly at the real
	 * store file — symlinks never chain.
	 *
	 * After this call both the source branch and the new fork are fully
	 * copy-on-write: any write to either branch via write() or place() creates
	 * a fresh real file and leaves the other branch's symlink intact.
	 *
	 * If this branch has no directory, an empty fork instance is returned
	 * without touching the filesystem.
	 *
	 * @method fork
	 * @param {string} $newName  Logical name for the new branch
	 * @param {array}  [$options]
	 * @return {Q_Branch}  The newly created fork
	 */
	function fork($newName, $options = array())
	{
		$child  = new self($newName, array('root' => $this->root));
		$srcDir = $this->dir();

		if (is_dir($srcDir)) {
			$dstDir = $child->dir();
			Q_Utils::canWriteToPath($dstDir, true, true);
			self::_forkDir($srcDir, $dstDir, $this->storeDir());
		}

		return $child;
	}

	// =========================================================================
	// File I/O
	// =========================================================================

	/**
	 * Read a file from this branch.
	 * Symlinks are followed transparently by the OS.
	 * Returns false if the path does not exist in this branch.
	 *
	 * @method read
	 * @param {string} $path  Logical path relative to branch root (e.g. "icon.png")
	 * @return {string|false}
	 */
	function read($path)
	{
		$full = $this->_full($path);
		if (!file_exists($full)) {
			return false;
		}
		return file_get_contents($full);
	}

	/**
	 * Copy-on-write write.
	 *
	 * If the target path is a symlink (pointing at a store file), breaks the
	 * link by copying store content to a new real file at that path, then
	 * writes $content. The store file — and any other branch's symlink to it —
	 * is left completely untouched.
	 *
	 * Creates any missing parent directories automatically.
	 *
	 * @method write
	 * @param {string} $path
	 * @param {string} $content
	 * @return {bool}
	 */
	function write($path, $content)
	{
		$full = $this->_full($path);
		$dir  = dirname($full);
		if (!is_dir($dir)) {
			Q_Utils::canWriteToPath($dir, true, true);
		}
		self::_cowWrite($full, $content);
		return true;
	}

	/**
	 * Place an already-existing file into this branch with CoW semantics.
	 *
	 * Intended for move_uploaded_file() results and other staged files.
	 * Unlinks any existing symlink at the destination before rename() so that
	 * rename() always creates a new real file rather than writing through the
	 * symlink into the store (Windows does not atomically replace symlinks).
	 *
	 * @method place
	 * @param {string} $srcFile  Absolute path to the staged source file
	 * @param {string} $path     Logical destination path within this branch
	 * @return {bool}
	 */
	function place($srcFile, $path)
	{
		$full = $this->_full($path);
		$dir  = dirname($full);
		if (!is_dir($dir)) {
			Q_Utils::canWriteToPath($dir, true, true);
		}
		if (is_link($full)) {
			unlink($full);
		}
		return rename($srcFile, $full);
	}

	/**
	 * Delete a path from this branch.
	 *
	 * If the path is a symlink (pointing at a store file), only the symlink is
	 * removed — the store file and other branches' symlinks are untouched.
	 * If the path is a real file, it is removed.
	 *
	 * @method delete
	 * @param {string} $path
	 * @return {bool}
	 */
	function delete($path)
	{
		$full = $this->_full($path);
		if (is_link($full) || file_exists($full)) {
			return unlink($full);
		}
		return false;
	}

	// =========================================================================
	// Inspection
	// =========================================================================

	/**
	 * All logical file paths visible in this branch, including inherited symlinks.
	 *
	 * @method paths
	 * @param {string} [$prefix]  Optional prefix filter (e.g. "thumbs/")
	 * @return {array}
	 */
	function paths($prefix = null)
	{
		$dir = $this->dir();
		if (!is_dir($dir)) {
			return array();
		}
		$results = array();
		$baseLen  = strlen($dir) + 1;
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
		);
		foreach ($iterator as $item) {
			$pathname = $item->getPathname();
			if ($item->isFile() || is_link($pathname)) {
				$rel = str_replace(DS, '/', substr($pathname, $baseLen));
				if ($prefix === null || strpos($rel, $prefix) === 0) {
					$results[] = $rel;
				}
			}
		}
		return $results;
	}

	/**
	 * Paths that are real files in this branch — not inherited symlinks.
	 * An empty array means this branch has not written anything since its
	 * last fork; all content is still inherited from the store.
	 *
	 * @method ownPaths
	 * @return {array}
	 */
	function ownPaths()
	{
		$dir = $this->dir();
		if (!is_dir($dir)) {
			return array();
		}
		$results = array();
		$baseLen  = strlen($dir) + 1;
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
		);
		foreach ($iterator as $item) {
			$pathname = $item->getPathname();
			if ($item->isFile() && !is_link($pathname)) {
				$results[] = str_replace(DS, '/', substr($pathname, $baseLen));
			}
		}
		return $results;
	}

	/**
	 * Diff this branch against another.
	 * Compares resolved file content by md5, not by timestamps or path.
	 *
	 * Returns paths from $other's perspective:
	 *   added   — in $other but not in $this
	 *   removed — in $this but not in $other
	 *   changed — in both but content differs
	 *
	 * @method diff
	 * @param {Q_Branch} $other
	 * @return {array}  ['added' => [...], 'removed' => [...], 'changed' => [...]]
	 */
	function diff(Q_Branch $other)
	{
		$ours   = $this->_pathHashes();
		$theirs = $other->_pathHashes();

		$added = $removed = $changed = array();

		foreach ($theirs as $path => $hash) {
			if (!isset($ours[$path])) {
				$added[] = $path;
			} elseif ($ours[$path] !== $hash) {
				$changed[] = $path;
			}
		}
		foreach ($ours as $path => $hash) {
			if (!isset($theirs[$path])) {
				$removed[] = $path;
			}
		}

		return compact('added', 'removed', 'changed');
	}

	// =========================================================================
	// Materialisation
	// =========================================================================

	/**
	 * Materialize this branch to a real directory, resolving all symlinks.
	 * Useful when a subprocess (ffmpeg, ImageMagick, etc.) needs concrete paths.
	 *
	 * @method checkout
	 * @param {string} $destDir
	 * @param {array}  [$options]
	 * @param {bool}   [$options.symlinks=false]  Copy symlinks instead of resolving.
	 *   Faster, but the result still depends on this branch's store files.
	 * @return {bool}
	 */
	function checkout($destDir, $options = array())
	{
		$srcDir = $this->dir();
		if (!is_dir($srcDir)) {
			return false;
		}
		Q_Utils::canWriteToPath($destDir, true, true);
		if (Q::ifset($options, 'symlinks', false)) {
			self::_forkDir($srcDir, $destDir, $this->storeDir());
			return true;
		}
		return Q_Utils::cp($srcDir, $destDir);
	}

	/**
	 * Remove this branch's directory.
	 * Symlinks are removed; the store files they pointed to are untouched.
	 * The store itself is NOT removed here — use gc() once no live branches
	 * reference it.
	 *
	 * @method destroy
	 * @return {bool}
	 */
	function destroy()
	{
		unset(self::$instances[$this->root . "\0" . $this->name]);
		$dir = $this->dir();
		return is_dir($dir) ? Q_Utils::rmdir($dir) : true;
	}

	// =========================================================================
	// Garbage collection
	// =========================================================================

	/**
	 * Garbage-collect unreferenced branch and store directories under $root.
	 *
	 * Two passes:
	 *   1. Collect every live symlink target in the entire root tree.
	 *   2. CHILD_FIRST traversal:
	 *        ~store dirs  — removed if none of their files appear in live targets.
	 *        branch dirs  — removed if they contain no real files and no live symlinks.
	 *
	 * @method gc
	 * @static
	 * @param {string} [$root]   Defaults to Q/branches/directory config
	 * @param {array}  [$options]
	 * @param {bool}   [$options.dryRun=false]  Report without removing
	 * @return {array}  ['removed' => [...absolute paths...]]
	 */
	static function gc($root = null, $options = array())
	{
		if (!$root) {
			$root = APP_FILES_DIR . DS . Q_Config::get(
				'Q', 'branches', 'directory', 'Q' . DS . 'branches'
			);
		}
		$dryRun  = Q::ifset($options, 'dryRun', false);
		$removed = array();

		if (!is_dir($root)) {
			return compact('removed');
		}

		// Pass 1 — build the set of real files that are still pointed to by
		// a live symlink somewhere in the tree
		$liveTargets = array();
		$all = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
		);
		foreach ($all as $item) {
			$pathname = $item->getPathname();
			if (is_link($pathname)) {
				$target = readlink($pathname);
				if (file_exists($target)) {
					$real = realpath($target);
					if ($real) {
						$liveTargets[$real] = true;
					}
				}
			}
		}

		// Pass 2 — CHILD_FIRST so leaf dirs are evaluated before parents
		$iter = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ($iter as $item) {
			if (!$item->isDir() || is_link($item->getPathname())) {
				continue;
			}
			$pathname = $item->getPathname();

			if (substr(basename($pathname), -6) === '~store') {
				// Store dir — keep if any of its real files are still referenced
				$hasLive   = false;
				$storeIter = new RecursiveIteratorIterator(
					new RecursiveDirectoryIterator(
						$pathname,
						FilesystemIterator::SKIP_DOTS
					)
				);
				foreach ($storeIter as $storeItem) {
					if ($storeItem->isFile()) {
						$rp = realpath($storeItem->getPathname());
						if ($rp && isset($liveTargets[$rp])) {
							$hasLive = true;
							break;
						}
					}
				}
				if (!$hasLive) {
					$removed[] = $pathname;
					if (!$dryRun) {
						Q_Utils::rmdir($pathname);
					}
				}
			} else {
				// Branch dir — keep if it has any real files or live symlinks
				if (self::_isEmptyOrDangling($pathname)) {
					$removed[] = $pathname;
					if (!$dryRun) {
						Q_Utils::rmdir($pathname);
					}
				}
			}
		}

		return compact('removed');
	}

	// =========================================================================
	// Protected helpers
	// =========================================================================

	/**
	 * Resolve a logical path to an absolute filesystem path within this branch.
	 */
	protected function _full($path)
	{
		$path = ltrim(str_replace('/', DS, $path), DS);
		return $this->dir() . DS . $path;
	}

	/**
	 * Recursively fork $srcDir into $dstDir, moving real files to $storeDir.
	 *
	 * For each entry:
	 *   Real directory  → recreate in $dstDir and $storeDir (no symlink).
	 *   Real file       → move to $storeDir, symlink source path → store,
	 *                     symlink $dstDir path → store.
	 *   Existing symlink → readlink() to get the already-stored real file,
	 *                      symlink $dstDir path → that real file directly
	 *                      (no re-move, no chaining).
	 */
	protected static function _forkDir($srcDir, $dstDir, $storeDir)
	{
		if (!@mkdir($dstDir, 0777, true) && !is_dir($dstDir)) {
			throw new Q_Exception("Q_Branch: could not create directory $dstDir");
		}
		@mkdir($storeDir, 0777, true);

		$srcLen   = strlen($srcDir);
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($srcDir, FilesystemIterator::SKIP_DOTS),
			RecursiveIteratorIterator::SELF_FIRST
		);

		foreach ($iterator as $item) {
			$pathname = $item->getPathname();
			$rel      = substr($pathname, $srcLen + 1);
			$dst      = $dstDir . DS . $rel;

			if ($item->isDir() && !is_link($pathname)) {
				// Real subdirectory — recreate structure in both dst and store
				@mkdir($dst,                  0777, true);
				@mkdir($storeDir . DS . $rel, 0777, true);
			} else {
				if (is_link($pathname)) {
					// Already in a store from a prior fork — link directly to
					// that real file so we never chain symlinks
					$target = readlink($pathname);
				} else {
					// First fork of this real file:
					// move it to the store, replace source path with a symlink
					$target = $storeDir . DS . $rel;
					rename($pathname, $target);
					Q_Utils::symlink($target, $pathname);
				}
				// Fork gets its own symlink to the same store file
				Q_Utils::symlink($target, $dst, true);
			}
		}
	}

	/**
	 * CoW write to an absolute path.
	 * Breaks a symlink by copying store content to a fresh real file first.
	 */
	protected static function _cowWrite($full, $content)
	{
		if (is_link($full)) {
			$target = readlink($full);
			unlink($full);
			if (file_exists($target)) {
				copy($target, $full);
			}
		}
		file_put_contents($full, $content);
	}

	/**
	 * Map of [relativePath => md5] for every file in this branch.
	 * Symlinks are resolved so the hash reflects real content.
	 */
	protected function _pathHashes()
	{
		$dir = $this->dir();
		if (!is_dir($dir)) {
			return array();
		}
		$map      = array();
		$baseLen  = strlen($dir) + 1;
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
		);
		foreach ($iterator as $item) {
			$pathname = $item->getPathname();
			if ($item->isFile() || is_link($pathname)) {
				$rel  = str_replace(DS, '/', substr($pathname, $baseLen));
				$real = $item->getRealPath();
				if ($real && file_exists($real)) {
					$map[$rel] = md5_file($real);
				}
			}
		}
		return $map;
	}

	/**
	 * True if $dir contains no real files and no live symlinks.
	 * Symlinks whose targets no longer exist are considered dead.
	 */
	protected static function _isEmptyOrDangling($dir)
	{
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
		);
		foreach ($iterator as $item) {
			$pathname = $item->getPathname();
			if (is_link($pathname)) {
				if (file_exists(readlink($pathname))) {
					return false;
				}
			} elseif ($item->isFile()) {
				return false;
			}
		}
		return true;
	}
}