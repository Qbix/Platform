<?php

if (Q_Request::expectsJSON) {
    echo Q::json_encode($errors);
} else {
    Q::var_dump($errors);
}
