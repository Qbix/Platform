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
	 * @method cleanup
     * @static
     * @param {string} $markdown
	 */
	static function cleanup($markdown)
	{
		// MarkdownV2 reserved characters that aren't used for links etc.
		$specials = array(
            "~", "`", ">", "#",
            "+", "-", "=", "|",
            "{", "}", ".", "!"
        );
		$pattern = array();
		$replace = array();
		foreach ($specials as $c) {
			// Match the character NOT already escaped
			$pattern[] = '/(?<!\\\\)' . preg_quote($c, '/') . '/';
			$replace[] = '\\\\' . $c;
		}
		return preg_replace($pattern, $replace, $markdown);
	}
}