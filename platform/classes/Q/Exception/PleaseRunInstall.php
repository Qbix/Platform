<?php

/**
 * @module Q
 */
class Q_Exception_PleaseRunInstall extends Q_Exception
{
	/**
	 * @class Q_Exception_PleaseRunInstall
	 * @constructor
	 * @extends Q_Exception
	 * @param {string} $prefix
	 */
};

Q_Exception::add('Q_Exception_PleaseRunInstall', 'Please run {{prefix}}"."scripts/Q/install.php --all');
