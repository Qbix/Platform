  Q.globalMemoryWalk = function (filterFn, options) {
    options = options || {};
    var seen = new WeakSet();
    var found = new Set();
    var pathMap = new WeakMap();

    var maxDepth = options.maxDepth || 5;
    var includeStack = options.includeStack || false;
    var logEvery = options.logEvery || 100;
    var startingKeys = Q.globalNamesAdded
      ? Q.globalNamesAdded()
      : Object.keys(window);

    let totalChecked = 0;
    let matchesFound = 0;

    function walk(obj, path = 'window', depth = 0) {
      if (!obj || typeof obj !== 'object') return;
      if (seen.has(obj)) return;
      seen.add(obj);

      totalChecked++;
      if (totalChecked % logEvery === 0) {
        console.log(`Checked ${totalChecked} objects, found ${matchesFound}`);
      }

      if (filterFn(obj)) {
        found.add(obj);
        matchesFound++;
        if (includeStack) {
          pathMap.set(obj, path);
        }
      }

      if (depth >= maxDepth) return;

      var skipKeys = obj instanceof HTMLElement
        ? new Set([
            'parentNode', 'parentElement', 'nextSibling', 'previousSibling',
            'firstChild', 'lastChild', 'children', 'childNodes',
            'ownerDocument', 'style', 'classList', 'dataset',
            'attributes', 'innerHTML', 'outerHTML',
            'nextElementSibling', 'previousElementSibling'
          ])
        : null;

      for (var key in obj) {
        if (skipKeys && skipKeys.has(key)) continue;
        try {
          walk(obj[key], path + '.' + key, depth + 1);
        } catch (e) {}
      }
    }

    let i = 0;
    function nextBatch() {
      var batchSize = 10;
      var end = Math.min(i + batchSize, startingKeys.length);

      for (; i < end; i++) {
        try {
          walk(window[startingKeys[i]], 'window.' + startingKeys[i], 0);
        } catch (e) {}
      }

      if (i < startingKeys.length) {
        setTimeout(nextBatch, 0); // Schedule next batch
      } else {
        console.log(`Done. Found ${matchesFound} retained objects.`);
        if (includeStack) {
          console.log([...found].map(obj => ({
            object: obj,
            path: pathMap.get(obj)
          })));
        } else {
          console.log([...found]);
        }
      }
    }

    nextBatch();
  };
