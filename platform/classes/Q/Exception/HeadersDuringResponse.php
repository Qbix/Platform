<?php

/**
 * @module Q
 */
class Q_Exception_HeadersDuringResponse extends Q_Exception
{
	/**
	 * @class Q_Exception_HeadersDuringResponse
	 * @constructor
	 * @extends Q_Exception
	 */
};

Q_Exception::add('Q_Exception_HeadersDuringResponse', 'Headers cannot be sent while response already started.', 400);
