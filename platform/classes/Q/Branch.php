<?php

/**
 * @module Q
 */

/**
 * Copy-on-write directory branching — symlink backend (default) or ZFS backend.
 *
 * ## Backend selection
 *
 * Set Q/branches/backend in config to control which backend is used:
 *
 *   absent or "auto"    Try ZFS; fall back to symlinks silently if unavailable.
 *   "zfs"               Require ZFS; throw Q_Exception if it is not available.
 *   "symlink"           Always use symlink CoW, even on a ZFS host.
 *
 * ZFS is considered available when (a) the `zfs` binary is on PATH and
 * (b) the branches root directory sits on a ZFS mountpoint.  Both
 * conditions must hold; passing one and failing the other triggers the
 * fallback (or an exception in "zfs" mode).
 *
 * ## Symlink backend (default / fallback)
 *
 * When a branch is forked for the first time, each real file is moved to a
 * sibling "store" directory ({branchDir}~store/) and replaced with a symlink.
 * The new fork receives its own symlinks pointing at the same store files.
 * Thereafter any write to either branch — source or fork — breaks the symlink,
 * copies the store content to a fresh real file, and writes to that, leaving
 * the other branch's symlink pointing at the original store file untouched.
 *
 * Forks-of-forks never chain symlinks: _forkDir() calls readlink() on any
 * existing symlink so the new fork always points directly at the real file in
 * whichever store holds it.
 *
 * ## ZFS backend
 *
 * When ZFS is available and selected, each branch maps to a ZFS dataset
 * under a configured parent dataset (Q/branches/zfsParent, default derived
 * from the branches root).  Branching is done with zfs-snapshot + zfs-clone,
 * which is instantaneous and space-efficient.  Reads and writes go directly
 * to the mounted dataset — no symlink management is needed at the PHP level.
 * ownPaths() uses `zfs diff` against the origin snapshot for an O(changes)
 * answer rather than a full directory scan.  gc() destroys datasets that have
 * no live branch record.
 *
 * ## Branch names
 *
 * Branch names are forward-slash-separated logical paths that map to
 * directories (symlink backend) or dataset path components (ZFS backend):
 *
 *   branch "Streams/ali/ce/Chat/main"
 *
 *   symlink: dir   {root}/Streams/ali/ce/Chat/main/
 *            store {root}/Streams/ali/ce/Chat/main~store/
 *
 *   ZFS:     dataset  {zfsParent}/Streams/ali/ce/Chat/main
 *            snapshot {zfsParent}/Streams/ali/ce/Chat/main@fork
 *            mount    {root}/Streams/ali/ce/Chat/main/
 *
 * Branch names ending in ~store are reserved for the symlink backend.
 *
 * Works on Linux, macOS, and Windows (symlinks via Q_Utils::symlink / mklink).
 * ZFS backend requires Linux or FreeBSD with OpenZFS and the zfs CLI.
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

	/**
	 * Resolved backend for this process: 'zfs' or 'symlink'.
	 * Null means not yet detected.
	 * @var string|null
	 */
	protected static $resolvedBackend = null;

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
	 * Absolute path to this branch's immutable file store (symlink backend only).
	 * Real files live here after the branch is first forked; the branch
	 * directory holds symlinks pointing into this store.
	 * Sibling of dir() with a ~store suffix on the last component.
	 * Returns null when using the ZFS backend (ZFS manages storage internally).
	 * @method storeDir
	 * @return {string|null}
	 */
	function storeDir()
	{
		if (self::_backend($this->root) === 'zfs') {
			return null;
		}
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

		if (self::_backend($this->root) === 'zfs') {
			// Create the dataset, then populate it from $srcDir
			$dataset = self::_zfsDataset($this->root, $this->name);
			if (!self::_zfsDatasetExists($dataset)) {
				$mountpoint = $dir;
				$cmd = 'zfs create -p -o mountpoint=' . escapeshellarg($mountpoint)
					. ' ' . escapeshellarg($dataset) . ' 2>&1';
				exec($cmd, $out, $rc);
				if ($rc !== 0) {
					return false;
				}
			}
		}

		Q_Utils::canWriteToPath(dirname($dir), true, true);
		if (Q::ifset($options, 'move', false)) {
			// For ZFS backend the dataset is already mounted at $dir;
			// copy files in then remove srcDir
			if (self::_backend($this->root) === 'zfs') {
				$ok = Q_Utils::cp($srcDir, $dir);
				if ($ok) {
					Q_Utils::rmdir($srcDir);
				}
				return $ok;
			}
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
	 * Symlink backend: each real file is moved to this branch's storeDir,
	 * replaced with a symlink, and the new fork receives symlinks to the same
	 * store files.  Forks-of-forks never chain symlinks.
	 *
	 * ZFS backend: takes a snapshot of this branch's dataset and clones it
	 * to a new dataset mounted at the fork's dir().  Instantaneous and
	 * space-efficient.
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

		if (!is_dir($srcDir)) {
			return $child;
		}

		if (self::_backend($this->root) === 'zfs') {
			$srcDataset  = self::_zfsDataset($this->root, $this->name);
			$dstDataset  = self::_zfsDataset($this->root, $newName);
			$snapName    = $srcDataset . '@fork-' . time();
			$mountpoint  = $child->dir();

			// Snapshot the source
			exec('zfs snapshot ' . escapeshellarg($snapName) . ' 2>&1', $out, $rc);
			if ($rc !== 0) {
				throw new Q_Exception(
					"Q_Branch: zfs snapshot failed for $srcDataset: " . implode("\n", $out)
				);
			}

			// Clone to destination dataset
			$cmd = 'zfs clone -o mountpoint=' . escapeshellarg($mountpoint)
				. ' ' . escapeshellarg($snapName)
				. ' ' . escapeshellarg($dstDataset) . ' 2>&1';
			exec($cmd, $out, $rc);
			if ($rc !== 0) {
				// Clean up the snapshot we just created
				exec('zfs destroy ' . escapeshellarg($snapName) . ' 2>&1');
				throw new Q_Exception(
					"Q_Branch: zfs clone failed for $dstDataset: " . implode("\n", $out)
				);
			}

			return $child;
		}

		// Symlink backend
		$dstDir = $child->dir();
		Q_Utils::canWriteToPath($dstDir, true, true);
		self::_forkDir($srcDir, $dstDir, $this->storeDir());

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
	 * Symlink backend: if the target path is a symlink (pointing at a store
	 * file), breaks the link by copying store content to a new real file at
	 * that path, then writes $content.
	 *
	 * ZFS backend: writes directly to the file.  ZFS handles block-level CoW
	 * transparently; no symlink management is needed at the PHP level.
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
		if (self::_backend($this->root) === 'zfs') {
			file_put_contents($full, $content);
		} else {
			self::_cowWrite($full, $content);
		}
		return true;
	}

	/**
	 * Place an already-existing file into this branch with CoW semantics.
	 *
	 * Intended for move_uploaded_file() results and other staged files.
	 *
	 * Symlink backend: unlinks any existing symlink at the destination before
	 * rename() so that rename() always creates a new real file rather than
	 * writing through the symlink into the store.
	 *
	 * ZFS backend: rename() directly; ZFS CoW handles the rest.
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
		if (self::_backend($this->root) !== 'zfs' && is_link($full)) {
			unlink($full);
		}
		return rename($srcFile, $full);
	}

	/**
	 * Delete a path from this branch.
	 *
	 * Symlink backend: if the path is a symlink, only the symlink is removed —
	 * the store file and other branches' symlinks are untouched.
	 *
	 * ZFS backend: unlink() as usual; ZFS CoW ensures other branches' clones
	 * are unaffected.
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
	 * All logical file paths visible in this branch, including inherited content.
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
	 * Paths that are owned by this branch — not inherited from a parent.
	 *
	 * Symlink backend: real files (not symlinks) in the branch directory.
	 * An empty array means this branch has not written anything since its
	 * last fork; all content is still inherited from the store.
	 *
	 * ZFS backend: uses `zfs diff` against the origin snapshot, which is an
	 * O(changes) operation rather than a full directory scan.
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

		if (self::_backend($this->root) === 'zfs') {
			return $this->_zfsOwnPaths($dir);
		}

		// Symlink backend: real (non-symlink) files only
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
	 * ZFS backend: the branch directory is already a plain directory (no
	 * symlinks), so checkout() is just a recursive copy unless symlinks=true
	 * is passed (in which case it behaves identically to the default).
	 *
	 * @method checkout
	 * @param {string} $destDir
	 * @param {array}  [$options]
	 * @param {bool}   [$options.symlinks=false]  Symlink backend only: copy
	 *   symlinks instead of resolving.  Faster, but result still depends on
	 *   this branch's store files.
	 * @return {bool}
	 */
	function checkout($destDir, $options = array())
	{
		$srcDir = $this->dir();
		if (!is_dir($srcDir)) {
			return false;
		}
		Q_Utils::canWriteToPath($destDir, true, true);
		if (self::_backend($this->root) !== 'zfs'
			&& Q::ifset($options, 'symlinks', false)
		) {
			self::_forkDir($srcDir, $destDir, $this->storeDir());
			return true;
		}
		return Q_Utils::cp($srcDir, $destDir);
	}

	/**
	 * Remove this branch's directory (and its ZFS dataset if using ZFS backend).
	 *
	 * Symlink backend: symlinks are removed; the store files they pointed to
	 * are untouched.  The store itself is NOT removed — use gc() once no live
	 * branches reference it.
	 *
	 * ZFS backend: destroys the dataset and its origin snapshot (if that
	 * snapshot is no longer referenced by any other clone).
	 *
	 * @method destroy
	 * @return {bool}
	 */
	function destroy()
	{
		unset(self::$instances[$this->root . "\0" . $this->name]);

		if (self::_backend($this->root) === 'zfs') {
			$dataset = self::_zfsDataset($this->root, $this->name);
			if (self::_zfsDatasetExists($dataset)) {
				// -R destroys dependents (snapshots, clones); -f forces unmount
				exec('zfs destroy -Rf ' . escapeshellarg($dataset) . ' 2>&1', $out, $rc);
				return $rc === 0;
			}
			return true;
		}

		$dir = $this->dir();
		return is_dir($dir) ? Q_Utils::rmdir($dir) : true;
	}

	// =========================================================================
	// Garbage collection
	// =========================================================================

	/**
	 * Garbage-collect unreferenced branch and store directories under $root.
	 *
	 * Symlink backend — two passes:
	 *   1. Collect every live symlink target in the entire root tree.
	 *   2. CHILD_FIRST traversal:
	 *        ~store dirs  — removed if none of their files appear in live targets.
	 *        branch dirs  — removed if they contain no real files and no live symlinks.
	 *
	 * ZFS backend — lists all datasets under the parent dataset and destroys
	 * any whose mountpoint is not the dir() of a known live branch.  Pass
	 * $liveBranches to declare which branch names are live; datasets not in
	 * that set are destroyed.  Without $liveBranches the method is a no-op
	 * to avoid accidental data loss.
	 *
	 * @method gc
	 * @static
	 * @param {string} [$root]   Defaults to Q/branches/directory config
	 * @param {array}  [$options]
	 * @param {bool}   [$options.dryRun=false]      Report without removing
	 * @param {array}  [$options.liveBranches=null]  ZFS backend: list of live
	 *   logical branch names.  Required for ZFS gc to do anything.
	 * @return {array}  ['removed' => [...absolute paths or dataset names...]]
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

		if (self::_backend($root) === 'zfs') {
			$liveBranches = Q::ifset($options, 'liveBranches', null);
			if ($liveBranches === null) {
				// Safety guard — never destroy datasets without a live-set reference
				return compact('removed');
			}
			$parentDataset = self::_zfsParentDataset($root);
			exec(
				'zfs list -H -o name -r ' . escapeshellarg($parentDataset) . ' 2>&1',
				$lines,
				$rc
			);
			if ($rc !== 0) {
				return compact('removed');
			}
			// Build set of live dataset names
			$liveDatasets = array();
			foreach ($liveBranches as $branchName) {
				$liveDatasets[self::_zfsDataset($root, $branchName)] = true;
			}
			// The parent dataset itself is never removed
			$liveDatasets[$parentDataset] = true;

			foreach ($lines as $dataset) {
				$dataset = trim($dataset);
				if (!$dataset || isset($liveDatasets[$dataset])) {
					continue;
				}
				// Skip snapshots — they are cleaned up when the dataset is destroyed
				if (strpos($dataset, '@') !== false) {
					continue;
				}
				$removed[] = $dataset;
				if (!$dryRun) {
					exec('zfs destroy -Rf ' . escapeshellarg($dataset) . ' 2>&1');
				}
			}
			return compact('removed');
		}

		// Symlink backend — original two-pass logic

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
	 * Detect and cache the effective backend for the given root directory.
	 *
	 * Returns 'zfs' or 'symlink'.
	 *
	 * @param {string} $root
	 * @return {string}
	 */
	protected static function _backend($root)
	{
		if (self::$resolvedBackend !== null) {
			return self::$resolvedBackend;
		}

		$configured = Q_Config::get('Q', 'branches', 'backend', null);

		if ($configured === 'symlink') {
			self::$resolvedBackend = 'symlink';
			return 'symlink';
		}

		$require = ($configured === 'zfs');

		// Check 1: zfs binary on PATH
		exec('which zfs 2>/dev/null', $out, $rc);
		$hasBinary = ($rc === 0 && !empty($out));

		if (!$hasBinary) {
			if ($require) {
				throw new Q_Exception(
					'Q_Branch: backend "zfs" required by config but `zfs` binary not found on PATH'
				);
			}
			self::$resolvedBackend = 'symlink';
			return 'symlink';
		}

		// Check 2: the branches root is on a ZFS mountpoint
		$onZfs = self::_isOnZfs($root);

		if (!$onZfs) {
			if ($require) {
				throw new Q_Exception(
					'Q_Branch: backend "zfs" required by config but branches root '
					. $root . ' is not on a ZFS filesystem'
				);
			}
			self::$resolvedBackend = 'symlink';
			return 'symlink';
		}

		self::$resolvedBackend = 'zfs';
		return 'zfs';
	}

	/**
	 * Determine whether a directory path sits on a ZFS filesystem.
	 * Parses /proc/mounts (Linux) or `mount` output (FreeBSD/macOS).
	 *
	 * @param {string} $path
	 * @return {bool}
	 */
	protected static function _isOnZfs($path)
	{
		// Canonicalise as far as possible (may not exist yet)
		$check = $path;
		while ($check && !is_dir($check)) {
			$check = dirname($check);
		}
		$realPath = $check ? realpath($check) : null;
		if (!$realPath) {
			return false;
		}

		// Linux: /proc/mounts is reliable and fast
		if (is_readable('/proc/mounts')) {
			$mounts = file('/proc/mounts', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
			// Build longest-prefix match
			$best = null;
			$bestLen = 0;
			foreach ($mounts as $line) {
				$parts = preg_split('/\s+/', $line);
				// format: device mountpoint fstype options dump pass
				if (count($parts) < 3) continue;
				$mountpoint = $parts[1];
				$fstype     = $parts[2];
				$mp = rtrim($mountpoint, '/');
				if ($mp === '') $mp = '/';
				if (strpos($realPath, $mp === '/' ? '/' : $mp . '/') === 0
					|| $realPath === $mp
				) {
					if (strlen($mp) > $bestLen) {
						$bestLen = strlen($mp);
						$best    = $fstype;
					}
				}
			}
			return ($best === 'zfs');
		}

		// FreeBSD / macOS fallback: `df -T` or `mount`
		exec('df -T ' . escapeshellarg($realPath) . ' 2>/dev/null', $out, $rc);
		if ($rc === 0 && count($out) >= 2) {
			// df -T output: Filesystem Type ...
			$cols = preg_split('/\s+/', trim($out[count($out) - 1]));
			// On Linux df -T: Filesystem Type 1K-blocks ...
			// On FreeBSD: ... the type is in a different column; check all
			foreach ($cols as $col) {
				if (strtolower($col) === 'zfs') return true;
			}
		}

		// Last resort: parse `mount` output
		exec('mount 2>/dev/null', $out, $rc);
		if ($rc === 0) {
			foreach ($out as $line) {
				// "tank/data on /data (zfs, ...)"  or  "tank/data on /data type zfs ..."
				if (preg_match('/\bon\s+(\S+)\s+(?:type\s+(\S+)|\((\w+)[,)])/i', $line, $m)) {
					$mp   = rtrim($m[1], '/');
					$type = strtolower($m[2] ?? $m[3] ?? '');
					if ($type === 'zfs'
						&& (strpos($realPath, $mp . '/') === 0 || $realPath === $mp)
					) {
						return true;
					}
				}
			}
		}

		return false;
	}

	/**
	 * Derive the ZFS dataset name for a logical branch under $root.
	 *
	 * Uses Q/branches/zfsParent config if set; otherwise auto-detects the
	 * dataset that $root is mounted on and appends the branch path beneath it.
	 *
	 * @param {string} $root
	 * @param {string} $name  Logical branch name
	 * @return {string}  Full ZFS dataset path (e.g. "tank/branches/Streams/ali/ce/Chat/main")
	 */
	protected static function _zfsDataset($root, $name)
	{
		$parent = self::_zfsParentDataset($root);
		$safe   = trim(str_replace(array('..', "\0", '\\'), array('', '', '/'), $name), '/');
		return $parent . '/' . $safe;
	}

	/**
	 * Return (and cache) the ZFS parent dataset for a given root.
	 *
	 * @param {string} $root
	 * @return {string}
	 */
	protected static function _zfsParentDataset($root)
	{
		static $cache = array();
		if (isset($cache[$root])) {
			return $cache[$root];
		}

		$configured = Q_Config::get('Q', 'branches', 'zfsParent', null);
		if ($configured) {
			$cache[$root] = rtrim($configured, '/');
			return $cache[$root];
		}

		// Auto-detect: ask ZFS which dataset is mounted at (or nearest to) $root
		exec(
			'zfs list -H -o name,mountpoint 2>/dev/null',
			$lines,
			$rc
		);
		$best    = null;
		$bestLen = 0;
		$realRoot = realpath($root) ?: $root;
		foreach ($lines as $line) {
			$parts = explode("\t", $line, 2);
			if (count($parts) < 2) continue;
			list($dataset, $mountpoint) = $parts;
			$mp = rtrim($mountpoint, '/');
			if ($mp === '') continue;
			if (strpos($realRoot, $mp . '/') === 0 || $realRoot === $mp) {
				if (strlen($mp) > $bestLen) {
					$bestLen = strlen($mp);
					// Append whatever sub-path root has beyond the mountpoint
					$sub = ltrim(substr($realRoot, strlen($mp)), '/');
					$best = $sub ? $dataset . '/' . $sub : $dataset;
				}
			}
		}

		if (!$best) {
			$best = 'zfs/branches'; // last-resort fallback
		}

		$cache[$root] = $best;
		return $best;
	}

	/**
	 * Check whether a ZFS dataset exists.
	 *
	 * @param {string} $dataset
	 * @return {bool}
	 */
	protected static function _zfsDatasetExists($dataset)
	{
		exec('zfs list -H ' . escapeshellarg($dataset) . ' 2>/dev/null', $out, $rc);
		return $rc === 0;
	}

	/**
	 * Return own paths for a ZFS-backed branch using `zfs diff`.
	 *
	 * Finds the most recent @fork-* snapshot of this dataset and diffs
	 * against it.  Falls back to a full directory scan if no snapshot exists.
	 *
	 * @param {string} $dir  Absolute path to the branch directory
	 * @return {array}
	 */
	protected function _zfsOwnPaths($dir)
	{
		$dataset = self::_zfsDataset($this->root, $this->name);

		// Find the most recent @fork-* snapshot
		exec(
			'zfs list -H -t snapshot -o name -s creation '
			. escapeshellarg($dataset) . ' 2>/dev/null',
			$snaps,
			$rc
		);
		$originSnap = null;
		foreach (array_reverse($snaps) as $snap) {
			$snap = trim($snap);
			if (strpos($snap, '@fork-') !== false) {
				$originSnap = $snap;
				break;
			}
		}

		if (!$originSnap) {
			// No fork snapshot — everything is "owned" (treat like a root branch)
			return $this->paths();
		}

		exec(
			'zfs diff -FH ' . escapeshellarg($originSnap)
			. ' ' . escapeshellarg($dataset) . ' 2>/dev/null',
			$diffLines,
			$rc
		);
		if ($rc !== 0) {
			// zfs diff unavailable or failed — fall back to full scan
			return $this->paths();
		}

		$baseLen = strlen(rtrim($dir, DS)) + 1;
		$results = array();
		foreach ($diffLines as $line) {
			// zfs diff -FH output: <change-type>\t<file-type>\t<path>
			// change-type: + (added) M (modified) - (removed) R (renamed)
			$parts = explode("\t", $line);
			if (count($parts) < 3) continue;
			$changeType = $parts[0]; // +, M, -, R
			$path       = $parts[2];
			if ($changeType === '-') continue; // removed in this branch — not "owned"
			if (strpos($path, $dir) !== 0) continue;
			$rel = str_replace(DS, '/', substr($path, $baseLen));
			if ($rel && !in_array($rel, $results, true)) {
				$results[] = $rel;
			}
		}
		return $results;
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