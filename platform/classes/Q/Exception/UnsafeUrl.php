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
	 * @param {string} $reason
	 */
};

Q_Exception::add('Q_Exception_UnsafeUrl', 'Refusing to fetch {{url}}: {{reason}}');
