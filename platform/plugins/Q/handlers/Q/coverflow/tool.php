<?php

/**
 * @module Q-tools
 */

/**
 * Implements an Apple-style "cover flow" effect based on this demo:
 * https://scroll-driven-animations.style/demos/cover-flow/css/
 * @class Q coverflow
 * @constructor
 * @param {array}   [$options] Override various options for this tool
 *  @param {array}  [$options.elements=null] Indicate the elements, if not already part of the container.
 *    The "title", "tag" and "content" keys have special meaning here.
 *  @param {Array} [$options.titles=null] Indicate the titles corresponding to the elements.
 *  @param {boolean} [options.dontSnapScroll] Set to true to stop snapping the scroll to each item
 *  @param {integer}  [options.index] You can specify an index of the item to bring to the front first
 *  @param {float} [options.scrollOnMouseMove=0] Scroll factor between 0 and 1 when mousemove happens if (not touchscreen)
 * @return {Q.Tool}
 */
function Q_coverflow_tool($options)
{
	$content = '';
	if (isset($options['elements'])) {
		$inside = '';
		foreach ($options['elements'] as $i => $element) {
			$tag = 'ul';
			if (isset($element['tag'])) {
				$tag = $element['tag'];
				unset($element['tag']);
			}
			if (isset($element['content'])) {
				$content = $element['content'];
				unset($element['content']);
			}
			$title = Q::ifset($element, 'title', Q::ifset($options, 'titles', $i, null));
			$inside .= Q_Html::tag('li', compact('title'), Q_Html::tag($tag, $element, $content));
		}
		$content = "<ul class='Q_coverflow_covers'>$inside</ul>";
		unset($options['elements']);
	}
	Q_Response::addScript('{{Q}}/js/tools/coverflow.js', 'Q');
	Q_Response::addStylesheet('{{Q}}/css/tools/coverflow.css', 'Q');
	Q_Response::setToolOptions($options);
	return $content;
}