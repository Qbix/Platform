<?php

class Q_RemoteController
{
	public static function execute()
	{
		header('Content-Type: application/json');

		try {
			$input = file_get_contents('php://input');
			$expectedHmac = hash_hmac('sha256', $input, Q_Config::expect('Q', 'remote', 'secret'));
			$actualHmac = $_SERVER['HTTP_X_Q_HMAC'] ?? '';

			if (!hash_equals($expectedHmac, $actualHmac)) {
				throw new Exception("HMAC verification failed");
			}

			$payload = json_decode($input, true);
			if (!isset($payload['function'], $payload['params'])) {
				throw new Exception("Invalid payload");
			}

			$function = $payload['function'];
			$params = $payload['params'];
			$context = $payload['context'] ?? [];

			// Restore globals if any
			foreach ($context['globals'] ?? [] as $k => $v) {
				$GLOBALS[$k] = $v;
			}

			// Only allow event-style function names
			if (!preg_match('/^Q_[A-Za-z0-9_]+$/', $function)) {
				throw new Exception("Unauthorized function: $function");
			}

			$result = null;
			Q::event($function, $params, false, false, $result);

			echo json_encode(array(
				'success' => true,
				'data' => $result
            ));
		} catch (Throwable $e) {
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
