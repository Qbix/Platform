#!/usr/bin/env php
<?php

$Q_Bootstrap_config_plugin_limit = 1;
include dirname(__FILE__) . '/../Q.inc.php';

$script_name = pathinfo($_SERVER["SCRIPT_NAME"]);
$script = Q_DIR . '/scripts/encryptdb.php';

$realpath = realpath($script);
if (!$realpath) {
	die('[ERROR] Could not locate ' . $script . PHP_EOL);
}

include($realpath);
