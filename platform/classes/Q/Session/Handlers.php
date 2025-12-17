<?php

class Q_Session_Handlers extends SessionHandler
implements SessionUpdateTimestampHandlerInterface
{
    public function open($save_path, $session_name)
    {
        return Q_Session::openHandler($save_path, $session_name);
    }

    public function close()
    {
        return Q_Session::closeHandler();
    }

    public function read($session_id)
    {
        return Q_Session::readHandler($session_id);
    }

    public function write($session_id, $session_data)
    {
        return Q_Session::writeHandler($session_id, $session_data);
    }

    public function destroy($session_id)
    {
        return Q_Session::destroyHandler($session_id);
    }

    public function gc($max_lifetime)
    {
        return Q_Session::gcHandler($max_lifetime);
    }

    public function validateId($id)
    {
        return Q_Session::isValidId($id);
    }
}
