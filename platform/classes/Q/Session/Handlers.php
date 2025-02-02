<?php

class Q_Session_Handlers extends SessionHandler
{
    public function open(string $save_path, string $session_name): bool
    {
        return Q_Session::openHandler($save_path, $session_name);
    }

    public function close(): bool
    {
        return Q_Session::closeHandler();
    }

    public function read(string $session_id): string
    {
        return Q_Session::readHandler($session_id);
    }

    public function write(string $session_id, string $session_data): bool
    {
        return Q_Session::writeHandler($session_id, $session_data);
    }

    public function destroy(string $session_id): bool
    {
        return Q_Session::destroyHandler($session_id);
    }

    public function gc(int $max_lifetime): int
    {
        return Q_Session::gcHandler($max_lifetime);
    }
}
