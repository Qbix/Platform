<?php

/**
 * @module Q
 */
class Q_Exception_Expired extends Q_Exception
{
	/**
	 * @class Q_Exception_Q_Exception_Expired
	 * @constructor
	 * @extends Q_Exception
	 */
};

Q_Exception::add(
	'Q_Exception_Expired', 
	'Expired, operation took too long'
);
