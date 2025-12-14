<?php

function MyApp_after_Q_configure()
{
	if (Q_Config::get('Db', 'logging', true)) {
		Q::log(PHP_EOL."-----");

		Q_Config::set(
			'Q', 'handlersAfterEvent', 'Db/query/execute',
			array(
				'Db_Utils::logShardQuery',
				'Db_Utils::logMissingIndexes'
			)
		);

		Q_Config::set(
			'Q', 'handlersAfterEvent', 'Db/query/exception',
			array('Db_Utils::logShardQuery')
		);
	}
}
