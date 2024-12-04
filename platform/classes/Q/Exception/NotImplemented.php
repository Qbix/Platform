<?php

/**
 * @module Q
 */
class Q_Exception_NotImplemented extends Q_Exception
{
	/**
	 * @class Q_Exception_NotImplemented
	 * @constructor
	 * @extends Q_Exception
	 * @param {string} $functionality
	 */
};

Q_Exception::add('Q_Exception_NotImplemented', 'Not implemented: {{functionality}}', 400);
