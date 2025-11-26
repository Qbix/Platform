<?php

/**
 * @module Q
 */
/**
 * This class lets you work with Markdown
 * @class Q_Html
 */
class Q_Markdown
{
	/**
	 * Escape markdown special characters in a string.
	 * @method markdown
	 * @static
	 * @param 
	 */
	function sanitize($markdown)
	{
		// MarkdownV2 reserved characters
		$specials = array(
			"_", "*", "[", "]", "(", ")", "~", "`", ">", "#",
			"+", "-", "=", "|", "{", "}", ".", "!"
        );
		$pattern = array();
		$replace = array();
		foreach ($specials as $c) {
			// Match the character NOT already escaped
			$pattern[] = '/(?<!\\\\)' . preg_quote($c, '/') . '/';
			$replace[] = '\\\\' . $c;
		}
		return preg_replace($pattern, $replace, $options['text']);
	}
}