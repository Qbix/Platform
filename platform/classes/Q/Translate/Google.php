<?php

class Q_Translate_Google {

	function __construct(Q_Translate $parent)
	{
		$this->apiKey = Q_Config::get('Q', 'translate', 'google', 'key', '');
		$this->parent = $parent;
	}

	private function replaceTagsByNumbers($data, $startNumber = 999) {
		foreach ($data as $k => &$v) {
			if (!preg_match_all("/(?<=\{{)(?:.*?)(?!.\}})(?=}})/", $v['value'], $matches)) {
				continue;
			}
			$j = 0;
			foreach($matches[0] as $search) {
				$index = $j + $startNumber;
				$text = "<i translate='no'>$index</i>";
				$v['value'] = str_replace('{{'.$search.'}}', $text, $v['value']);
				$j++;
			}
			$v['tags'] = $matches[0];
		}
		return $data;
	}

	private function revertTags($data, $startNumber = 999) {
		foreach ($data as $k => &$d) {
			if (empty($d['tags'])) {
				continue;
			}
			$j = 0;
			foreach($d['tags'] as $tag) {
				$index = $j + $startNumber;
				$d['value'] = str_replace("<i translate='no'>$index</i>", '{{'.$tag.'}}', $d['value']);
				$j++;
			}
		};
		return $data;
	}

	function translate($fromLang, $toLang, $in, &$out = array(), $toRemove = array(), $chunkSize = 100)
	{
		$in = $this->replaceTagsByNumbers($in);
		$o = $this->parent->options;
		$rt = Q::ifset($o, 'retranslate', Q::ifset($o, 'r', array()));
		$rta = Q::ifset($o, 'retranslate-all', Q::ifset($o, 'a', null));
		$translateAll = isset($rta);
		$rt = is_array($rt) ? $rt : array($rt);

		$in2 = array();
		foreach ($in as $n => $v) {
			$key = $v['dirname'] . "\t" . implode("\t", $v['key']);
			$doIt = false;
			if (empty($out[$key]) || $translateAll) {
				$doIt = true;
			} else {
				foreach ($rt as $v2) {
					$parts = Q_Utils::explodeEscaped('/', $v2);
					foreach ($parts as $i => $p) {
						if ($v['key'][$i] !== $p) {
							continue 2;
						}
					}
					$doIt = true;
				}
			}
			if ($doIt) {
				$v['originalKey'] = $n;
				$in2[] = $v;
			}
		}

		if (!$toRemove && !$in2) {
			return array();
		}

		$res = $out;
		if (!$in2) {
			return $res;
		}

		$chunks = array_chunk($in2, $chunkSize);
		$count = 0;

		foreach ($chunks as $chunk) {
			$qArr = array();
			$map  = array();

			// collect only items that pass filter
			foreach ($chunk as $idx => $item) {
				$val = $item['value'];
				if (is_string($val) && Q_Translate::filter($val)) {
					$qArr[] = $val;
					$map[]  = $idx; // map API index → $chunk index
				} else {
					// skip translation, keep original
					$res[$item['originalKey']] = $item;
				}
			}

			if (!$qArr) {
				continue;
			}

			print "Requesting google translation api\n";
			$url = 'https://translation.googleapis.com/language/translate/v2?key=' . $this->apiKey;
			$postFields = array(
				"q"      => $qArr,
				"source" => $fromLang,
				"target" => $toLang,
				"format" => $this->parent->options['google-format']
			);

			$json = Q_Utils::post($url, $postFields, null, array(), array(
				'Expect: 100-Continue',
				'Content-Type: application/json'
			));
			$response = json_decode($json, true);

			if (!$response) {
				throw new Q_Exception("Bad translation response");
			}
			if (!empty($response['error']['message'])) {
				if (Q::startsWith($response['error']['message'], 'Bad language pair')) {
					echo "Skipping: " . $response['error']['message'] . PHP_EOL;
					return false;
				} else {
					$more = "Make sure you have Q/translate/google/key specified.";
					throw new Q_Exception($response['error']['message'] . PHP_EOL . $more);
				}
			}

			$count += count($qArr);
			echo "Translated " . $count . " queries of " . $toLang . "\n";

			$translations = $response['data']['translations'];

			// apply translations back using $map
			foreach ($map as $i => $chunkIdx) {
				$item = $chunk[$chunkIdx];
				$originalKey = $item['originalKey'];
				$res[$originalKey] = $item;
				$res[$originalKey]['value'] = $translations[$i]['translatedText'];
			}
		}

		return $this->revertTags($res);
	}

	public $apiKey;
	public $parent;

}