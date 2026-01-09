<?php

class Q_RemoteController
{
	public static function execute()
	{
		header('Content-Type: application/json');

		try {
			$input = file_get_contents('php://input');
			$expectedHmac = hash_hmac('sha256', $input, Q_Config::expect('Q', 'remote', 'secret'));
			$actualHmac = isset($_SERVER['HTTP_X_Q_HMAC']) ? $_SERVER['HTTP_X_Q_HMAC'] : '';

			if (!hash_equals($expectedHmac, $actualHmac)) {
				throw new Exception("HMAC verification failed");
			}

			$payload = json_decode($input, true);
			if (!isset($payload['function'], $payload['params'])) {
				throw new Exception("Invalid payload");
			}

			$eventName = $payload['function'];
			$params = $payload['params'];
			$timestamp = $payload['timestamp'];
			$context = isset($payload['context']) ? $payload['context'] : array();

			$now = time();
			$skew = Q_Config::get('Q', 'remote', 'maxSkew', 60); // seconds
			if ($timestamp <= 0 || abs($now - $timestamp) > $skew) {
				throw new Exception("Request timestamp is incorrect");
			}

			$remote = Q_Config::get('Q', 'handlersUsingRemote', $eventName, null);
			if (!is_array($remote)) {
				throw new Exception("Handler not enabled for remote execution: $eventName");
			}

			// Restore globals if any
			$cgs = isset($context['globals']) ? $context['globals'] : array();
			foreach ($cgs as $k => $v) {
				$GLOBALS[$k] = $v;
			}

			$result = null;
			Q::event($eventName, $params, false, false, $result);

			echo json_encode(array(
				'success' => true,
				'data' => $result
            ));
		} catch (Exception $e) {
			echo json_encode(array(
				'success' => false,
				'exception' => array(
					'type' => get_class($e),
					'params' => [$e->getMessage(), $e->getCode()],
					'file' => $e->getFile(),
					'line' => $e->getLine(),
					'backtrace' => array_slice($e->getTrace(), 0, 20)
                )
            ));
		}
	}
}
