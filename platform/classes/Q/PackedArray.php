<?php

/**
 * @module Q
 */
/**
 * Q PackedArray class. More space-efficient than native PHP arrays.
 * Uses binary strings to back the array interface.
 * Only supports appending and getting elements, for now.
 * @class Q_PackedArray
 */
class Q_PackedArray
{
    private $_backing = '';
     
    public function __construct()
    {
        assert(PHP_INT_SIZE === 8, 'Q_PackedArray requires 64-bit integer support');
    }
     
    public function append($item)
    {
        $this->_backing .= pack('P', $item);
    }
     
    public function count()
    {
        return $this->_binary_strlen($this->_backing) / PHP_INT_SIZE;
    }
     
    public function get($index)
    {
        if (!is_numeric($index)
        or $index >= $this->count()) { 
            return null; 
        }
         
        $packed = $this->_binary_substr($this->_backing, $index * PHP_INT_SIZE, PHP_INT_SIZE);
        $unpacked = unpack('P', $packed);
        if (is_array($unpacked)) {
            return array_shift($unpacked);
        }
        return null;
    }
     
    protected function _binary_strlen($str)
    {
        if (function_exists('mb_internal_encoding') && (ini_get('mbstring.func_overload') & 2)) {
            return mb_strlen($str, '8bit');
        }
        return strlen($str);
    }
     
    protected function _binary_substr($str, $start, $length = null)
    {
        if (function_exists('mb_internal_encoding') && (ini_get('mbstring.func_overload') & 2)) {
            return mb_substr($str, $start, $length, '8bit');
        }
        return substr($str, $start, $length);
    }
}