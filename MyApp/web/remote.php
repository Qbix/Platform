<?php

/**
 * Front controller for Q remote/microservices requests
 */

include(dirname(__FILE__).DIRECTORY_SEPARATOR.'Q.inc.php');

//
// Handle the web request
//
Q_RemoteController::execute();
