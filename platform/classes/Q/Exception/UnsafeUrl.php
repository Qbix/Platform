<?php

/**
 * @module Q
 */
class Q_Exception_UnsafeUrl extends Q_Exception
{
	/**
	 * Raised by Q_Fetch when a URL the server was asked to fetch is not
	 * http(s), or its host resolves to a private, loopback, link-local,
	 * shared, reserved or multicast address (directly or through a redirect).
	 * @class Q_Exception_UnsafeUrl
	 * @constructor
	 * @extends Q_Exception
	 * @param {string} $url
	 */

	/**
	 * Why the URL was refused, for logs and tests. Not in the message or
	 * params, which reach the client.
	 * @property $reason
	 * @type string
	 */
	public $reason = null;
};

Q_Exception::add('Q_Exception_UnsafeUrl', 'Refusing to fetch {{url}}');
