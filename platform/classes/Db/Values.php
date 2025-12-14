<?php

class Db_Values
{
	public static $IS_NULL;
	public static $NOT_NULL;
	public static $NOW;
	public static $DEFAULT;
	public static $KEEP;

	public static function init()
	{
		if (self::$IS_NULL !== null) {
			return;
		}

		self::$IS_NULL  = (object) array('type' => 'IS_NULL');
		self::$NOT_NULL = (object) array('type' => 'NOT_NULL');
		self::$NOW      = (object) array('type' => 'NOW');
		self::$DEFAULT  = (object) array('type' => 'DEFAULT');
		self::$KEEP     = (object) array('type' => 'KEEP');
	}

	public static function isNull()
	{
		self::init();
		return self::$IS_NULL;
	}

	public static function notNull()
	{
		self::init();
		return self::$NOT_NULL;
	}

	public static function now()
	{
		self::init();
		return self::$NOW;
	}

	public static function defaultValue()
	{
		self::init();
		return self::$DEFAULT;
	}

	public static function keep()
	{
		self::init();
		return self::$KEEP;
	}
}

Db_Values::init();