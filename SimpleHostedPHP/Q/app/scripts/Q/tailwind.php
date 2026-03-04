#!/usr/bin/env php
<?php

include dirname(__FILE__).'/../Q.inc.php';

$script = Q_DIR . '/scripts/tailwind.php';
$realpath = realpath($script);

if (!file_exists($realpath)) {
	die('[ERROR] Could not locate '.$script.PHP_EOL);
}

include($realpath);