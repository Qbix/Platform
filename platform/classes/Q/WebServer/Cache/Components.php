<?php
/**
 * @module Q
 */

/**
 * Merkle-tree based component cache with dependency tracking.
 *
 * Better than ESI/SSI because:
 *   - Sub-page granularity (Qbix slot level, not just include blocks)
 *   - Dependency-driven invalidation (Stream changes → specific components)
 *   - Merkle tree aggregation (parent hashes computed from children)
 *   - All in PHP memory — no edge server, no parsing HTML comments
 *   - Composable with Q_Response::fillSlot()
 *
 * Architecture:
 *   Parent process holds the Merkle trees + dependency graph in memory.
 *   Forked children register dependencies and send invalidations back
 *   via the Pool wire protocol. Cache hits assemble pages from cached
 *   components without forking a worker.
 *
 * A page is a tree of components:
 *
 *   Page /community/123         ← Merkle root (hash of children)
 *   ├── title                   ← leaf (depends on community/name stream)
 *   ├── dashboard               ← subtree
 *   │   ├── avatar              ← leaf (depends on Users/avatar stream)
 *   │   └── notifications       ← leaf (depends on Streams/notifications)
 *   └── content                 ← subtree
 *       ├── feed                ← leaf (depends on community/feed stream)
 *       ├── members             ← leaf (depends on community/participants)
 *       └── sidebar             ← leaf (depends on community/about stream)
 *
 * When community/feed gets a new message:
 *   1. Child sends invalidation: {"invalidate": ["community/feed/123"]}
 *   2. Parent looks up dependency: community/feed/123 → page:/community/123#content.feed
 *   3. Invalidate leaf → recompute parent hashes up the tree
 *   4. Mark page as partially stale (only content.feed needs re-render)
 *   5. Next request: re-render feed only, assemble from cached siblings
 *
 * Config:
 *   "Q": { "web": { "cache": { "components": {
 *     "enabled": true,
 *     "maxPages": 10000,
 *     "maxComponents": 50000
 *   }}}}
 *
 * @class Q_WebServer_Cache_Components
 */
class Q_WebServer_Cache_Components
{
	/**
	 * Page trees: pageKey => MerkleNode
	 * A MerkleNode is:
	 *   ['hash' => string, 'html' => string|null, 'children' => [name => MerkleNode]]
	 * Leaf nodes have html set and no children.
	 * Interior nodes have html=null and children.
	 * The root also stores the assembled page in 'assembled'.
	 * @property $pages
	 */
	protected static $pages = array();

	/**
	 * Dependency index: streamKey => [ [pageKey, componentPath], ... ]
	 * Maps a stream identifier to every component that depends on it.
	 * @property $deps
	 */
	protected static $deps = array();

	/**
	 * Reverse index: "pageKey#componentPath" => [streamKey, ...]
	 * For cleanup when a page is evicted.
	 * @property $reverseDeps
	 */
	protected static $reverseDeps = array();

	/**
	 * Component HTML cache: "pageKey#componentPath" => html string
	 * Separate from the tree for fast lookup during assembly.
	 * @property $components
	 */
	protected static $components = array();

	/**
	 * Stats
	 */
	protected static $pageHits = 0;
	protected static $partialHits = 0;
	protected static $fullMisses = 0;
	protected static $invalidations = 0;

	// ── Configuration ───────────────────────────────────

	protected static $enabled = false;
	protected static $maxPages = 10000;
	protected static $maxComponents = 50000;

	/**
	 * Initialize from config.
	 * Called once in the parent process at startup.
	 */
	static function init()
	{
		$config = Q_Config::get('Q', 'web', 'cache', 'components', array());
		self::$enabled = (bool) Q::ifset($config, 'enabled', false);
		self::$maxPages = (int) Q::ifset($config, 'maxPages', 10000);
		self::$maxComponents = (int) Q::ifset($config, 'maxComponents', 50000);
	}

	/**
	 * Check if component caching is enabled.
	 * @return {boolean}
	 */
	static function enabled()
	{
		return self::$enabled;
	}

	// ── Page lookup (parent process) ────────────────────

	/**
	 * Try to serve a full page from component cache.
	 *
	 * If all components are cached and the Merkle root is valid,
	 * assemble the page from cached components without forking.
	 *
	 * @method getPage
	 * @static
	 * @param {string} $pageKey Cache key for this page (usually path+query)
	 * @return {string|null} Assembled HTML or null if any component is stale
	 */
	static function getPage($pageKey)
	{
		if (!self::$enabled) return null;
		if (!isset(self::$pages[$pageKey])) return null;

		$page = self::$pages[$pageKey];

		// Check if any node is marked stale
		if (self::hasStaleNode($page)) {
			self::$partialHits++;
			return null; // caller should re-render stale components only
		}

		// All components valid — return assembled page
		if (isset($page['assembled'])) {
			self::$pageHits++;
			return $page['assembled'];
		}

		// Assemble from components
		$html = self::assembleFromTree($pageKey, $page);
		if ($html !== null) {
			self::$pages[$pageKey]['assembled'] = $html;
			self::$pageHits++;
		}
		return $html;
	}

	/**
	 * Get the list of stale component paths for a page.
	 * The caller can re-render only these slots.
	 *
	 * @method getStaleComponents
	 * @static
	 * @param {string} $pageKey
	 * @return {array} Array of component paths that need re-rendering, e.g. ['content.feed', 'dashboard.notifications']
	 */
	static function getStaleComponents($pageKey)
	{
		if (!isset(self::$pages[$pageKey])) return array();
		$stale = array();
		self::collectStale(self::$pages[$pageKey], '', $stale);
		return $stale;
	}

	/**
	 * Get cached HTML for a specific component.
	 *
	 * @method getComponent
	 * @static
	 * @param {string} $pageKey
	 * @param {string} $componentPath Dot-separated path, e.g. 'content.feed'
	 * @return {string|null}
	 */
	static function getComponent($pageKey, $componentPath)
	{
		$key = $pageKey . '#' . $componentPath;
		return self::$components[$key] ?? null;
	}

	// ── Registration (called from forked children) ──────

	/**
	 * Register a rendered component and its dependencies.
	 *
	 * Called by Q_Response slot rendering or explicitly by app code.
	 * In a forked child, this data is sent back to the parent via
	 * the wire protocol (see processChildMessage).
	 *
	 * @method registerComponent
	 * @static
	 * @param {string} $pageKey Page cache key
	 * @param {string} $componentPath Dot-separated path in the tree
	 * @param {string} $html Rendered HTML for this component
	 * @param {array} $dependsOn Array of stream keys this component reads from
	 * @param {string|null} $hash Optional content hash. If null, computed from $html.
	 */
	static function registerComponent($pageKey, $componentPath, $html, $dependsOn = array(), $hash = null)
	{
		if (!self::$enabled) return;

		if ($hash === null) {
			$hash = md5($html);
		}

		// Store component HTML
		$compKey = $pageKey . '#' . $componentPath;
		self::$components[$compKey] = $html;

		// Build/update the tree node
		$node = &self::getNodeRef($pageKey, $componentPath);
		$node['hash'] = $hash;
		$node['stale'] = false;

		// Register dependencies
		foreach ($dependsOn as $streamKey) {
			// Forward index: stream → components
			if (!isset(self::$deps[$streamKey])) {
				self::$deps[$streamKey] = array();
			}
			$depEntry = array($pageKey, $componentPath);
			// Avoid duplicates
			$found = false;
			foreach (self::$deps[$streamKey] as $existing) {
				if ($existing[0] === $pageKey && $existing[1] === $componentPath) {
					$found = true;
					break;
				}
			}
			if (!$found) {
				self::$deps[$streamKey][] = $depEntry;
			}

			// Reverse index: component → streams
			if (!isset(self::$reverseDeps[$compKey])) {
				self::$reverseDeps[$compKey] = array();
			}
			if (!in_array($streamKey, self::$reverseDeps[$compKey])) {
				self::$reverseDeps[$compKey][] = $streamKey;
			}
		}

		// Recompute parent hashes up the tree
		self::recomputeHashes($pageKey);

		// Eviction if over limits
		self::evictIfNeeded();
	}

	/**
	 * Store the fully assembled page HTML.
	 * Called after all components have been rendered and the layout
	 * is assembled. This is the "Merkle root" entry.
	 *
	 * @method registerPage
	 * @static
	 * @param {string} $pageKey
	 * @param {string} $assembledHtml The final page HTML
	 */
	static function registerPage($pageKey, $assembledHtml)
	{
		if (!self::$enabled) return;
		if (!isset(self::$pages[$pageKey])) {
			self::$pages[$pageKey] = array('hash' => null, 'children' => array());
		}
		self::$pages[$pageKey]['assembled'] = $assembledHtml;
		self::recomputeHashes($pageKey);
	}

	// ── Invalidation (parent process) ───────────────────

	/**
	 * Invalidate all components that depend on a given stream.
	 *
	 * Called in the parent process when a child reports a stream change,
	 * or when a WebSocket message indicates an update.
	 *
	 * @method invalidateStream
	 * @static
	 * @param {string} $streamKey e.g. 'Streams/avatar/123' or 'community/feed/456'
	 */
	static function invalidateStream($streamKey)
	{
		if (!isset(self::$deps[$streamKey])) return;

		self::$invalidations++;

		foreach (self::$deps[$streamKey] as $dep) {
			list($pageKey, $componentPath) = $dep;

			// Mark component as stale in the tree
			$node = &self::getNodeRef($pageKey, $componentPath);
			$node['stale'] = true;

			// Remove cached component HTML
			$compKey = $pageKey . '#' . $componentPath;
			unset(self::$components[$compKey]);

			// Clear assembled page (root is stale)
			if (isset(self::$pages[$pageKey]['assembled'])) {
				unset(self::$pages[$pageKey]['assembled']);
			}

			// Mark all ancestors as stale too
			self::markAncestorsStale($pageKey, $componentPath);
		}
	}

	/**
	 * Invalidate multiple streams at once.
	 *
	 * @method invalidateStreams
	 * @static
	 * @param {array} $streamKeys
	 */
	static function invalidateStreams($streamKeys)
	{
		foreach ($streamKeys as $key) {
			self::invalidateStream($key);
		}
	}

	/**
	 * Evict an entire page from the component cache.
	 *
	 * @method evictPage
	 * @static
	 * @param {string} $pageKey
	 */
	static function evictPage($pageKey)
	{
		if (!isset(self::$pages[$pageKey])) return;

		// Remove all dependency entries for this page
		$prefix = $pageKey . '#';
		foreach (self::$reverseDeps as $compKey => $streams) {
			if (strpos($compKey, $prefix) !== 0) continue;
			$parts = explode('#', $compKey, 2);
			$componentPath = $parts[1] ?? '';
			foreach ($streams as $streamKey) {
				if (isset(self::$deps[$streamKey])) {
					self::$deps[$streamKey] = array_filter(
						self::$deps[$streamKey],
						function ($d) use ($pageKey) { return $d[0] !== $pageKey; }
					);
					if (empty(self::$deps[$streamKey])) {
						unset(self::$deps[$streamKey]);
					}
				}
			}
			unset(self::$reverseDeps[$compKey], self::$components[$compKey]);
		}

		unset(self::$pages[$pageKey]);
	}

	// ── Wire protocol: child → parent messages ──────────

	/**
	 * Process a message from a forked child.
	 *
	 * The Pool's onWorkerData calls this when it sees a message
	 * with type 'cache'. Children send these after rendering.
	 *
	 * Message format:
	 *   { "type": "cache", "action": "register|invalidate",
	 *     "pageKey": "...", "componentPath": "...",
	 *     "html": "...", "hash": "...",
	 *     "dependsOn": ["stream/key/1", ...],
	 *     "streams": ["stream/key/1", ...] }
	 *
	 * @method processChildMessage
	 * @static
	 * @param {array} $msg Decoded JSON message from child
	 */
	static function processChildMessage($msg)
	{
		$action = $msg['action'] ?? '';

		if ($action === 'register') {
			self::registerComponent(
				$msg['pageKey'],
				$msg['componentPath'],
				$msg['html'] ?? '',
				$msg['dependsOn'] ?? array(),
				$msg['hash'] ?? null
			);
		} elseif ($action === 'invalidate') {
			self::invalidateStreams($msg['streams'] ?? array());
		} elseif ($action === 'registerPage') {
			self::registerPage(
				$msg['pageKey'],
				$msg['html'] ?? ''
			);
		} elseif ($action === 'evict') {
			self::evictPage($msg['pageKey'] ?? '');
		}
	}

	/**
	 * Build a message to send from a forked child to the parent.
	 * Helper for use in Q_Response integration.
	 *
	 * @method buildRegisterMessage
	 * @static
	 * @param {string} $pageKey
	 * @param {string} $componentPath
	 * @param {string} $html
	 * @param {array} $dependsOn
	 * @return {array} Message array ready for json_encode
	 */
	static function buildRegisterMessage($pageKey, $componentPath, $html, $dependsOn = array())
	{
		return array(
			'type' => 'cache',
			'action' => 'register',
			'pageKey' => $pageKey,
			'componentPath' => $componentPath,
			'html' => $html,
			'hash' => md5($html),
			'dependsOn' => $dependsOn,
		);
	}

	/**
	 * Build an invalidation message for a child to send to parent.
	 *
	 * @method buildInvalidateMessage
	 * @static
	 * @param {array} $streamKeys
	 * @return {array}
	 */
	static function buildInvalidateMessage($streamKeys)
	{
		return array(
			'type' => 'cache',
			'action' => 'invalidate',
			'streams' => $streamKeys,
		);
	}

	// ── Merkle tree operations ───────────────────────────

	/**
	 * Get or create a reference to a node in the tree.
	 * Creates intermediate nodes as needed.
	 *
	 * @param {string} $pageKey
	 * @param {string} $componentPath Dot-separated, e.g. 'content.feed'
	 * @return {array} Reference to the node
	 */
	protected static function &getNodeRef($pageKey, $componentPath)
	{
		if (!isset(self::$pages[$pageKey])) {
			self::$pages[$pageKey] = array(
				'hash' => null, 'stale' => false, 'children' => array()
			);
		}

		$parts = explode('.', $componentPath);
		$node = &self::$pages[$pageKey];

		foreach ($parts as $part) {
			if (!isset($node['children'])) {
				$node['children'] = array();
			}
			if (!isset($node['children'][$part])) {
				$node['children'][$part] = array(
					'hash' => null, 'stale' => true, 'children' => array()
				);
			}
			$node = &$node['children'][$part];
		}

		return $node;
	}

	/**
	 * Recompute hashes from leaves up to the root.
	 * Each interior node's hash = md5(child1_hash . child2_hash . ...)
	 *
	 * @param {string} $pageKey
	 */
	protected static function recomputeHashes($pageKey)
	{
		if (!isset(self::$pages[$pageKey])) return;
		self::computeNodeHash(self::$pages[$pageKey]);
	}

	/**
	 * Recursively compute a node's hash from its children.
	 * Returns the hash string.
	 */
	protected static function computeNodeHash(&$node)
	{
		if (empty($node['children'])) {
			// Leaf node — hash already set by registerComponent
			return $node['hash'] ?? '';
		}

		// Interior node — hash from children
		$childHashes = '';
		foreach ($node['children'] as $name => &$child) {
			$childHashes .= $name . ':' . self::computeNodeHash($child);
		}
		$node['hash'] = md5($childHashes);
		return $node['hash'];
	}

	/**
	 * Check if any node in the tree is stale.
	 */
	protected static function hasStaleNode($node)
	{
		if (!empty($node['stale'])) return true;
		if (!empty($node['children'])) {
			foreach ($node['children'] as $child) {
				if (self::hasStaleNode($child)) return true;
			}
		}
		return false;
	}

	/**
	 * Collect all stale leaf paths.
	 */
	protected static function collectStale($node, $prefix, &$stale)
	{
		if (!empty($node['stale']) && empty($node['children'])) {
			$stale[] = ltrim($prefix, '.');
			return;
		}
		if (!empty($node['children'])) {
			foreach ($node['children'] as $name => $child) {
				$path = $prefix ? "$prefix.$name" : $name;
				self::collectStale($child, $path, $stale);
			}
		}
	}

	/**
	 * Mark all ancestor nodes as stale (clear assembled page).
	 */
	protected static function markAncestorsStale($pageKey, $componentPath)
	{
		$parts = explode('.', $componentPath);
		// Walk from root to parent of the changed node
		$node = &self::$pages[$pageKey];
		for ($i = 0; $i < count($parts) - 1; $i++) {
			$node['hash'] = null; // force recompute
			if (isset($node['children'][$parts[$i]])) {
				$node = &$node['children'][$parts[$i]];
			} else {
				break;
			}
		}
	}

	/**
	 * Assemble page HTML from cached components.
	 * Uses a simple marker replacement: each component's position
	 * in the layout is marked by <!--Q:component:path--> in the
	 * layout template.
	 */
	protected static function assembleFromTree($pageKey, $page)
	{
		// If we have an assembled page and nothing is stale, return it
		if (isset($page['assembled']) && !self::hasStaleNode($page)) {
			return $page['assembled'];
		}
		// Otherwise, the caller needs to re-render
		return null;
	}

	// ── Eviction ────────────────────────────────────────

	/**
	 * Evict oldest pages if over the limit.
	 * Simple FIFO — could be upgraded to LRU with access timestamps.
	 */
	protected static function evictIfNeeded()
	{
		while (count(self::$pages) > self::$maxPages) {
			// Evict first (oldest) page
			$key = array_key_first(self::$pages);
			if ($key === null) break;
			self::evictPage($key);
		}

		while (count(self::$components) > self::$maxComponents) {
			$key = array_key_first(self::$components);
			if ($key === null) break;
			unset(self::$components[$key]);
		}
	}

	// ── Stats ───────────────────────────────────────────

	/**
	 * Return stats for the dashboard.
	 */
	static function stats()
	{
		return array(
			'pages' => count(self::$pages),
			'components' => count(self::$components),
			'streams' => count(self::$deps),
			'pageHits' => self::$pageHits,
			'partialHits' => self::$partialHits,
			'fullMisses' => self::$fullMisses,
			'invalidations' => self::$invalidations,
		);
	}

	/**
	 * Dump the tree structure for a page (for debugging/dashboard).
	 *
	 * @method dumpTree
	 * @static
	 * @param {string} $pageKey
	 * @return {array|null} Simplified tree for JSON output
	 */
	static function dumpTree($pageKey)
	{
		if (!isset(self::$pages[$pageKey])) return null;
		return self::simplifyNode(self::$pages[$pageKey], '');
	}

	protected static function simplifyNode($node, $path)
	{
		$result = array(
			'hash' => substr($node['hash'] ?? '', 0, 8) ?: null,
			'stale' => !empty($node['stale']),
		);
		if (empty($node['children'])) {
			$result['leaf'] = true;
		} else {
			$result['children'] = array();
			foreach ($node['children'] as $name => $child) {
				$result['children'][$name] = self::simplifyNode(
					$child, $path ? "$path.$name" : $name
				);
			}
		}
		return $result;
	}
}
