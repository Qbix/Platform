(function (Q, $) {

var Users = Q.Users;
var Streams = Q.Streams;

/**
 * @module Streams-tools
 */

/**
 * Renders a gallery of related images, backed by Q/gallery.
 * If user has relations write-level, allows editing gallery parameters.
 * @class Streams/image/gallery
 * @constructor
 * @param {Object} [options]
 */
Q.Tool.define("Streams/image/gallery", function (options) {
	var tool = this;
	var state = tool.state;

	if (!state.publisherId || !state.streamName) {
		throw new Q.Error("Streams/image/gallery: missing publisherId or streamName");
	}

	// Gallery container with prefixed id so children() works
	var $gallery = Q.element("div", {
		"class": "Streams_image_gallery_container",
		"id": "Q_gallery"
	});
	tool.element.appendChild($gallery);
	state.$gallery = $gallery;

	// Fetch params from stream attributes
	Streams.get(state.publisherId, state.streamName).then(function (stream) {
		var params = stream.getAttribute("Streams/image/gallery") || {};
		var merged = Q.extend({}, state.galleryOptions, params);

		// Activate Q/gallery in our container
		Q.Tool.setUpElement(
			$gallery,
			"Q/gallery",
			merged,
			tool.prefix + "Q_gallery"
		);

		tool.gallery = Q.Tool.from($gallery, "Q/gallery");

		// If editable, allow editing
		if (stream.testWriteLevel("relations") && state.editable) {
			tool._makeEditable(stream);
		}
	});
}, {
	publisherId: null,
	streamName: null,
	editable: true,
	galleryOptions: {
		autoplay: true,
		loop: true,
		transition: { duration: 1000, ease: "smooth", type: "crossfade" },
		interval:   { duration: 3000, ease: "smooth", type: "" }
	}
}, {
	refresh: function () {
		if (this.gallery && this.gallery.refresh) {
			this.gallery.refresh();
		}
	},

	_makeEditable: function (stream) {
		var tool = this;

		// Example: add a button for editing gallery params
		var btn = Q.element("button", {
			"class": "Q_gallery_edit_button"
		}, [tool.text.gallery.EditGalleryButton]);
		tool.element.appendChild(btn);

		btn.addEventListener("click", function () {
			var params = stream.getAttribute("Streams/image/gallery") || {};
			var merged = Q.extend({}, tool.state.galleryOptions, params);

			var content = Q.element("div", {"class": "Q_gallery_editor"}, [
				Q.element("label", {}, [
					tool.text.gallery.IntervalLabel,
					Q.element("input", {
						type: "number",
						name: "interval",
						value: merged.interval.duration
					})
				]),
				Q.element("label", {}, [
					tool.text.gallery.AutoplayLabel,
					Q.element("input", {
						type: "checkbox",
						name: "autoplay",
						checked: merged.autoplay ? "checked" : null
					})
				])
			]);

			Q.Dialogs.push({
				title: tool.text.gallery.DialogTitle,
				content: content,
				apply: true,
				onClose: function () {
					var intervalInput = content.querySelector("input[name=interval]");
					var autoplayInput = content.querySelector("input[name=autoplay]");
					var interval = parseInt(intervalInput.value, 10);

					if (isNaN(interval) || interval <= 0) {
						alert(tool.text.errors.AmountInvalid);
						return;
					}

					var newParams = Q.extend({}, merged, {
						interval: { duration: interval },
						autoplay: autoplayInput.checked
					});

					stream.setAttribute("Streams/image/gallery", newParams);
					stream.save({changed: {attributes: true}}, function (err) {
						if (err) {
							console.warn("Failed to save gallery params:", err);
						} else {
							tool.state.galleryOptions = newParams;
							tool.refresh();
						}
					});
				}
			});
		});
	}
});

})(Q, Q.jQuery);