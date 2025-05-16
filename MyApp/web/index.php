<?php

/**
 * Front controller for Q remove/microservices requests
 */

include(dirname(__FILE__).DIRECTORY_SEPARATOR.'Q.inc.php');

//
// Handle the web request
//
Q_WebController::execute();
