(function (Q, $) {

/**
 * @module Q-tools
 */
	
/**
 * Place this tool inside a <form> tag to create nice AJAX forms
 * @class Q form
 * @constructor
 * @param {Object} [options] This is an object of parameters for this function
 *   @param {Q.Event} [options.onSubmit] This event triggers On form submit
 *   @param {Q.Event} [options.onResponse] This event triggers after getting some response from from url request
 *   @param {Q.Event} [options.onSuccess] This event triggers if response returned with 200 success code , and if there are no HTTP errors in response headers
 *   @param {Boolean} [options.ignoreRedirect] Pass true to not follow redirects returned from the server, and only call onResponse / onSuccess
 *   @param {String} [options.slotsToRequest='form'] Slot names for Q.request
 *   @param {Object} [options.contentElements] An Object of {slotName: Element} pairs to replace their content.
 *     Otherwise, by default, after a response with no errors, we replace the content in the tool's container element,
 *     from the first slot found in slotsToRequest.
 *   @param {Function} [options.loader] Override the default loader, which is Q.request
 *      @param {String} [options.loader.url] Url for request
 *      @param {String} [options.loader.method] Form Method / Request Method
 *      @param {String} [options.loader.params] Url Encoded /Serialised form data as URL parameters
 *      @param {String} [options.loader.slots] Slot Names
 *      @param {Function} [options.loader.callback] Callback function after request
 *      @param {Function} [options.loader.options] Options for the request
 * 	 @param {Boolean} [options.ignorePage] set to true to skip processing any script data, scripts, stylesheets, metas, etc. 
 *      from the response passed as the second parameter to the loader callback
 *
*/
Q.Tool.define('Q/form', function(options) {

	Q.addStylesheet('{{Q}}/css/tools/form.css');
	this.refresh(options);

},

{
	onSubmit: new Q.Event(),
	onResponse: new Q.Event(),
	onSuccess: new Q.Event(),
	slotsToRequest: 'form',
	contentElements: {},
	ignorePage: false,
	ignoreRedirect: true,
	ignoreDialogs: true,
	loader: function (url, method, form, slots, callback, options) {
		var func = this.state.ignorePage ? Q.request : Q.loadUrl.request;
		if (method.toUpperCase() === 'GET') {
			func(url, slots, callback, options);
		} else {
			func(url, slots, callback, Q.extend(options, {
				method: method,
				formdata: new FormData(form),
				ignorePage: false,
				ignoreRedirect: this.state.ignoreRedirect
			}));
		}
	},
	defaultSuccessHTML: ""
},

{
	Q: {
		beforeRemove: {"Q/form": function () {
			var form = $(this.element).closest('form');
			if (form.data('Q/form tool') === this) {
				form.removeData('Q/form tool');
				form.off('submit.Q_form');
			}
		}},
	
		onRetain: {"Q/form": function (options) {
			this.refresh(options);
		}}
	},
	
	/**
	 * @method refresh
	 */
	refresh: function () {
		// constructor & private declarations
		var tool = this;
		var state = this.state;
		var $te = $(tool.element);
		var $form = $te.closest('form');
		if (!$form.length) return;
		if ($form.data('Q/form tool')) return;
		$form.on('submit.Q_form', function(event) {
			function onResponse(err, response, redirected) {
				$form.removeClass('Q_working').removeAttr('disabled');
				document.activeElement = tool.activeElement;
				if (false === Q.handle(state.onResponse, tool, arguments)) {
					return false; // onResponse took care of it with some other behavior
				}
				// default behavior
				var msg = Q.firstErrorMessage(err);
				if (msg) {
					return alert(msg);
				}
				$('div.Q_form_undermessagebubble', $te).empty();
				$('tr.Q_error', $te).removeClass('Q_error');
				if ('errors' in response) {
					tool.applyErrors(response.errors);
					$('tr.Q_error').eq(0).prev().find(':input:visible').eq(0).focus();
					if (response.scriptLines && response.scriptLines.form) {
						eval(response.scriptLines.form);
					}
					return;
				}
				var redirectUrl = Q.getObject('redirect.url', response);
				if (redirectUrl) {
					// The server answered the submit by telling the client to go
					// somewhere else, so this is a NAVIGATION, not an in-place form
					// result -- hand it to Q.handle and let the destination be loaded
					// with the slots a page publishes.
					//
					// It used to re-request the redirect target with this tool's own
					// `slotsToRequest`, on the assumption that wherever a form
					// redirects to also serves the form's slots. That holds for a
					// same-page result and for nothing else: Users/activate redirects
					// to the app's home with `slotsToRequest: 'form,user'`, and an app
					// home publishes neither, so every activation answered
					// Q_Exception_MissingSlot (424) -- for BOTH slots, which is why
					// dropping just 'form' would not have fixed it. Q_Response's slot
					// loop only swallows a missing slot when the response is itself a
					// redirect, and the destination is not.
					//
					// The consequence was not only console noise: `_handleResult` then
					// ran against an errors payload, so the page kept whatever
					// client-side state it had. After activation that means a STALE
					// Q.Users.loggedInUser until the next full document load, which
					// anything reading it in between -- an onLogin handler, a dashboard
					// rendering from it -- reads as pre-activation state. A real
					// navigation loads the destination and its session extras.
					Q.handle(redirectUrl);
					return false;
				} else {
					_handleResult(data);
				}
				function _handleResult(data) {
					data = data || {};
					if (!data.slots) {
						data.slots = {form: state.defaultSuccessHTML};
					}
					var slots = Object.keys(data.slots);
					var pipe = new Q.Pipe(slots, function () {
						Q.handle(state.onSuccess, tool, [data]);
					});
					for (var slot in data.slots) {
						var e;
						switch (typeof state.contentElements[slot]) {
						case 'HTMLElement':
						case 'jQuery':
							e = $(state.contentElements[slot]); break;
						case 'string':
							e = $(state.contentElements[slot], $form); break;
						default:
							e = $(tool.element);
						}
						if (data.slots[slot] != null) {
							var replaced = Q.replace(e[0], data.slots[slot]);
							if (replaced) {
								Q.activate(replaced, pipe.fill(slot));
							}
						}
						if (data.scriptLines && data.scriptLines[slot]) {
							eval(data.scriptLines[slot]);
						}
					}
				}
				return false; // prevent Q.request from calling Q.handle() on redirects
			}
			event.preventDefault();
			tool.activeElement = document.activeElement;
			$form.addClass('Q_working').attr('disabled', 'disabled');
			var result = {};
			var action = $form.attr('action');
			if (!action) {
				action = window.location.href.split('?')[0];
			}
			Q.handle(state.onSubmit, tool, [$form[0], result]);
			if (result.cancel) {
				return false;
			}
			var input = $('input[name="Q.method"]', $form);
			var method = (input.val() || $form.attr('method') || 'post').toUpperCase();
			if (state.ignoreCache
			&& typeof state.loader.forget === "function") {
				state.ignoreCache = false;
				state.loader.forget(action, method, $form.serialize(), state.slotsToRequest);
			}
			state.loader.call(tool, action, method, $form[0], state.slotsToRequest, onResponse, state.loader.options);
		});
		$('input', $form).add('select', $form).on('input', function () {
			if ($form.state('Q/validator')) {
				$form.plugin('Q/validator', 'reset', $(this));
			}
		});
		$form.data('Q/form tool', tool);
	},
	
	/**
	 * @method applyErrors
	 * @param {Object} errors
	 */
	applyErrors: function(errors) {
		var err = null;
		for (var i=0; i<errors.length; ++i) {
			if (!('fields' in errors[i])
			|| Q.typeOf(errors[i].fields) !== 'array'
			|| !errors[i].fields.length) {
				err = errors[i];
				continue;
			}
			for (var j=0; j<errors[i].fields.length; ++j) {
				var k = errors[i].fields[j];
				var td = $("td[data-fieldname='"+k+"']", this.element);
				if (!td.length) {
					err = errors[i];
				}
				var tr = td.closest('tr').next();
				tr.addClass('Q_error');
				$('div.Q_form_undermessagebubble', tr)
					.html(errors[i].message);
			}
		}
		if (err) {
			alert(err.message);
		}
	}
}

);

})(Q, Q.jQuery);