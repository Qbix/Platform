<?php

function Q_filters_terser($params)
{
	$results = $filters = array();
	$printProgress = Q::ifset($params, 'printProgress', false);

	foreach ($params['parts'] as $src => $part) {
		if ($printProgress) {
			echo "\tQ_filters_terser: $src" . PHP_EOL;
		}

		if (Q::endsWith($src, '.min.js')) {
			$results[$src] = $part . PHP_EOL;
			continue;
		}

		if (!Q::ifset($params, 'installedLocally', true)) {
			throw new Q_Exception("Terser requires local installation.");
		}

		$in = APP_FILES_DIR . '_combine_temporary_in.js';
		$out = APP_FILES_DIR . '_combine_temporary_out.js';
		file_put_contents($in, $part);
		$js = Q_SCRIPTS_DIR . DS . 'terser.js';
		exec("node $js $in $out", $output, $exitCode);

		if ($exitCode !== 0 || !file_exists($out)) {
			throw new Q_Exception("Terser failed on $src: " . implode("\n", $output));
		}

		$results[$src] = file_get_contents($out);
		unlink($in);
		unlink($out);
		$filters[$src] = 'Q/filters/terser';
	}

	$output = implode("\n\n", $results);
	$params['info']['output'] = $output;
	$params['info']['results'] = $results;
	$params['info']['filters'] = $filters;

	return $output;
}
