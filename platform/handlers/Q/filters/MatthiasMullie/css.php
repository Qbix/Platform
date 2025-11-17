<?php

function Q_filters_MatthiasMullie_css($params)
{
	$processed = $params['processed'];
	$results = array();
	$filters = array();
	$printProgress = Q::ifset($params, 'printProgress', false);

	foreach ($processed as $src => $part) {
		if ($printProgress) {
			echo "\tQ_filters_MatthiasMullie_css: $src" . PHP_EOL;
		}

		$minified = null;

		try {
			$minify = new MatthiasMullie\Minify\CSS($part);
			$minified = $minify->minify();
		} catch (Exception $e) {
			// Fall back to unminified CSS
			$minified = $part;

			if ($printProgress) {
				echo "\t\t[warning] CSS minify failed for $src: " . $e->getMessage() . PHP_EOL;
			}
		}

		$results[$src] = $minified;
		$filters[$src] = 'Q/filters/MatthiasMullie/css';
	}

	$output = implode("\n\n", $results);

	$params['info']['output'] = $output;
	$params['info']['results'] = $results;
	$params['info']['filters'] = $filters;

	return $output;
}