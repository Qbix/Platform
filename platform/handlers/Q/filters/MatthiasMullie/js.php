<?php

function Q_filters_MatthiasMullie_js($params)
{
	$results = array();
	$filters = array();
	$printProgress = Q::ifset($params, 'printProgress', false);

	foreach ($params['parts'] as $src => $part) {
		if ($printProgress) {
			echo "\tQ_filters_MatthiasMullie_js: $src" . PHP_EOL;
		}

		$minified = null;

		try {
			$minify = new MatthiasMullie\Minify\JS($part);
			$minified = $minify->minify();
		} catch (Exception $e) {
			// Fall back to unminified content
			$minified = $part;

			if ($printProgress) {
				echo "\t\t[warning] JS minify failed for $src: " . $e->getMessage() . PHP_EOL;
			}
		}

		$results[$src] = $minified;
		$filters[$src] = 'Q/filters/MatthiasMullie/js';
	}

	$output = implode("\n\n", $results);

	$params['info']['output'] = $output;
	$params['info']['results'] = $results;
	$params['info']['filters'] = $filters;

	return $output;
}