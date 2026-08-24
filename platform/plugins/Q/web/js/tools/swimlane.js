(function (Q, $, window, undefined) {

/**
 * @module Q-tools
 */

/**
 * Renders a multi-user journey as parallel timelines.
 *
 * The visual grammar is borrowed from Lamport space-time diagrams, because
 * that is what this actually is: each actor gets a continuous process spine
 * running the height of the timeline, events attach to their spine, and
 * arrows between spines are messages. Ordinals render in tabular mono
 * because they are clock values, not decoration.
 *
 * The layout is not fixed columns. It computes segments — contiguous runs of
 * moments where the same set of actors is present — and within a segment
 * those actors share the full width. So there is no horizontal scrolling
 * anywhere: the timeline is purely vertical, and the cast rearranges as it
 * goes.
 *
 * @class Q swimlane
 * @constructor
 * @param {Object} [options]
 *  @param {Array} [options.moments] moments in the canonical journey shape
 *  @param {Array} [options.actors] actor descriptors with userId, name, color
 *  @param {Array} [options.arrows] explicit arrows; derived when omitted
 *  @param {String} [options.publisherId] load from a stream instead
 *  @param {String} [options.streamName]
 *  @param {Number} [options.maxSideBySide=3] columns per segment on desktop
 *  @param {Number} [options.maxSideBySideMobile=1]
 *  @param {Number} [options.maxNodeWidth=480] cap so a single-actor moment
 *   doesn't stretch to an unreadable width on a wide screen
 *  @param {Number} [options.nodeGap=28] vertical gap between moments
 *  @param {Number} [options.columnGap=18] horizontal space between columns
 *  @param {Number} [options.avatarSize=34]
 *  @param {String} [options.avatarPosition='top']
 *  @param {Boolean} [options.avatarSticky=true]
 *  @param {Array} [options.filterUsers=null] userIds to show; null means all
 *  @param {Boolean} [options.showBarriers=true]
 *  @param {Boolean} [options.showCauses=true] show the arrival mark
 *  @param {Boolean} [options.arrowLabels=false]
 *  @param {Boolean} [options.zoomOnTap=true]
 *  @param {Boolean} [options.virtualize=true]
 *  @param {Number} [options.segmentTransitionMs=380]
 *  @param {Q.Event} [options.onNodeTap]
 *  @param {Q.Event} [options.onFilter]
 *  @param {Q.Event} [options.onRefresh]
 */
Q.Tool.define('Q/swimlane', function (options) {
	var tool = this;
	var state = tool.state;
	var $te = $(tool.element);

	$te.addClass('Q_swimlane');
	tool.element.setAttribute('role', 'group');

	tool.segments = [];
	tool.expandables = {};
	tool.nodeCache = {};
	tool.visible = {};
	tool.chosen = {};

	if (state.publisherId && state.streamName && Q.Streams) {
		tool.loading(true);
		Q.Streams.retainWith(tool).get(state.publisherId, state.streamName,
		function (err) {
			if (err) {
				return tool.failed('Could not load this journey.');
			}
			tool.stream = this;
			Q.req('Scenarios/timeline', ['journey'], function (err, data) {
				var journey = Q.getObject(['slots', 'journey'], data);
				if (!journey) {
					return tool.failed('This journey has no moments yet.');
				}
				state.actors = journey.actors;
				state.moments = journey.moments;
				tool.refresh();
			}, { fields: { streamName: state.streamName } });
		});
	} else {
		tool.refresh();
	}

	// Only width matters. Height changes are self-inflicted — an expandable
	// opening, a branch panel appearing, a node finishing its mockup — and
	// rebuilding on those destroys the very thing that caused them.
	tool.onResize = Q.throttle(function () {
		var width = tool.element.clientWidth;
		if (width === tool.width) {
			// Geometry still moved; redraw the layers without a rebuild.
			tool.drawSpines();
			return;
		}
		tool.measure();
		tool.refresh();
	}, 120, tool);

	tool.onBeforePrint = function () { tool.mountAll(); };
	if (window.matchMedia) {
		var mql = window.matchMedia('print');
		if (mql.addEventListener) {
			mql.addEventListener('change', function (e) {
				if (e.matches) { tool.mountAll(); }
			});
		}
	}
	$(window).on('beforeprint.Q_swimlane', tool.onBeforePrint);

	if (window.ResizeObserver) {
		tool.resizeObserver = new ResizeObserver(tool.onResize);
		tool.resizeObserver.observe(tool.element);
	} else {
		$(window).on('resize.Q_swimlane', tool.onResize);
	}
},

{
	moments: [],
	actors: [],
	publisherId: null,
	streamName: null,

	maxSideBySide: 3,
	maxSideBySideMobile: 1,
	maxNodeWidth: 460,
	nodeGap: 28,
	columnGap: 18,
	nodePadding: 14,

	avatarSize: 34,
	avatarPosition: 'top',
	avatarSticky: true,

	filterUsers: null,
	showBarriers: true,
	showCauses: true,

	narration: true,
	autoPlay: false,
	narrationDuration: 3500,
	narrationSpeed: 1,

	/**
	 * Shown under the timeline and baked into every export. These are
	 * mockups used in a sales conversation, so the caveat has to travel with
	 * the artifact — a shared SVG that has lost its context is exactly the
	 * case this guards against.
	 */
	disclaimer: 'Mockups only. Final scope and behaviour are set by contract.',
	disclaimerAlways: true,
	arrowLabels: false,
	zoomOnTap: true,
	virtualize: true,
	virtualizeMargin: '150%',
	segmentTransitionMs: 380,
	parallax: false,
	parallaxIntensity: 0.03,

	palette: [
		'#5b6ee1', '#1fa97a', '#c98a12', '#d0453f',
		'#2496a8', '#8a5cc4', '#b05a2e', '#3f7ab5'
	],

	onNodeTap: new Q.Event(),
	onFilter: new Q.Event(),
	onMomentChange: new Q.Event(),
	onBranch: new Q.Event(),
	onPlay: new Q.Event(),
	onPause: new Q.Event(),
	onRefresh: new Q.Event()
},

{
	/**
	 * Rebuild everything. Cheap enough to call on resize because node SVGs
	 * are cached by width.
	 * @method refresh
	 */
	refresh: function () {
		var tool = this;
		var state = tool.state;

		if (!state.moments || !state.moments.length) {
			return tool.failed('This journey has no moments yet.');
		}

		tool.measure();
		tool.assignColors();
		tool.segments = tool.computeSegments();

		Q.Tool.clear(tool.element);
		tool.element.innerHTML = '';

		var frag = document.createDocumentFragment();

		tool.$strip = $(tool.renderAvatarStrip());
		frag.appendChild(tool.$strip[0]);

		var body = document.createElement('div');
		body.className = 'Q_swimlane_body';

		// Spines sit behind the nodes. There is no arrow layer: in an ordered
		// timeline, position already says what an arrow would have said, so
		// arrows only add ink. What is genuinely not implied by position is
		// *who* caused a given frame to change — and that is a mark on the
		// affected node, not a line between two.
		tool.spineLayer = svgLayer('Q_swimlane_spines');
		tool.flow = document.createElement('div');
		tool.flow.className = 'Q_swimlane_flow';

		body.appendChild(tool.spineLayer);
		body.appendChild(tool.flow);
		frag.appendChild(body);

		if (state.narration) {
			frag.appendChild(tool.renderNarrationBar());
		}
		if (state.disclaimer && state.disclaimerAlways) {
			var note = document.createElement('p');
			note.className = 'Q_swimlane_disclaimer';
			note.textContent = state.disclaimer;
			frag.appendChild(note);
		}

		tool.element.appendChild(frag);
		tool.$body = $(body);

		tool.segments.forEach(function (segment, i) {
			tool.flow.appendChild(tool.renderSegment(segment, i));
		});

		tool.bind();

		// Geometry has to wait for layout; two frames is enough for the
		// browser to have measured everything including the SVG nodes.
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				tool.drawSpines();
				if (state.virtualize) { tool.observe(); }
				tool.startParallax();
				$te(tool).addClass('Q_swimlane_ready');
				Q.handle(state.onRefresh, tool);
				if (state.autoPlay && !tool.played) {
					tool.played = true;
					tool.play();
				}
			});
		});

		function $te(t) { return $(t.element); }
	},

	/**
	 * @method measure
	 */
	measure: function () {
		var tool = this;
		var state = tool.state;
		var width = tool.element.clientWidth || 375;

		tool.width = width;
		tool.max = (width < 560)
			? state.maxSideBySideMobile
			: Math.min(state.maxSideBySide, Math.floor(width / 240)) || 1;
		tool.max = Math.max(1, tool.max);
	},

	/**
	 * Lane colours persist per actor across every segment, so Alice is the
	 * same colour wherever she appears.
	 * @method assignColors
	 */
	assignColors: function () {
		var tool = this;
		var palette = tool.state.palette;
		tool.colors = {};
		(tool.state.actors || []).forEach(function (actor, i) {
			tool.colors[actor.userId] = actor.color || palette[i % palette.length];
		});
		// Any actor appearing in moments but missing from the roster.
		var i = (tool.state.actors || []).length;
		tool.state.moments.forEach(function (moment) {
			(moment.frames || []).forEach(function (frame) {
				if (frame.userId && !tool.colors[frame.userId]) {
					tool.colors[frame.userId] = palette[(i++) % palette.length];
				}
			});
		});
	},

	/**
	 * @method activeIds
	 * @param {Object} moment
	 * @return {Array} userIds present at this moment, after filtering
	 */
	activeIds: function (moment) {
		var filter = this.state.filterUsers;
		var ids = [];
		(moment.frames || []).forEach(function (frame) {
			if (!frame.userId) { return; }
			if (filter && filter.indexOf(frame.userId) < 0) { return; }
			if (ids.indexOf(frame.userId) < 0) { ids.push(frame.userId); }
		});
		return ids;
	},

	/**
	 * Contiguous runs of moments sharing the same cast.
	 * @method computeSegments
	 * @return {Array}
	 */
	computeSegments: function () {
		var tool = this;
		var segments = [];
		var current = null;

		tool.state.moments.forEach(function (moment) {
			if (tool.hidden(moment)) { return; }
			var ids = tool.activeIds(moment);
			if (!ids.length) {
				// Every frame filtered out — collapse rather than leave a hole.
				if (current) { current.skipped = (current.skipped || 0) + 1; }
				return;
			}
			var key = ids.slice().sort().join('|');
			if (!current || current.key !== key) {
				current = { key: key, userIds: ids, moments: [], skipped: 0 };
				segments.push(current);
			}
			current.moments.push(moment);
		});

		return segments;
	},


	/**
	 * Order actors by how much this moment is about them, so the columns go
	 * to the frames worth looking at when the cast exceeds maxSideBySide.
	 * @method rank
	 */
	rank: function (moment, ids) {
		var tool = this;
		var primaryId = tool.primaryId(moment, ids);
		return ids.slice().sort(function (a, b) {
			return tool.significance(moment, b, primaryId)
				- tool.significance(moment, a, primaryId);
		});
	},

	/**
	 * @method significance
	 */
	significance: function (moment, userId, primaryId) {
		var frame = this.frameFor(moment, userId);
		if (userId === primaryId) { return 100; }
		var score = frame.significance;
		if (score !== undefined && score !== null) { return score; }
		if (frame.idle) { return 10; }
		if (frame.denied) { return 40; }   // a denied lane is worth showing
		if (frame.svg || frame.tool) { return 60; }
		return 20;
	},

	/**
	 * @method columnWidth
	 */
	columnWidth: function (count) {
		var state = this.state;
		var n = Math.min(count, this.max);
		var usable = this.width - state.nodePadding * 2 - state.columnGap * (n - 1);
		var w = Math.floor(usable / n);
		return Math.max(96, Math.min(w, n === 1 ? state.maxNodeWidth : w));
	},

	// ---- rendering ------------------------------------------------------

	/**
	 * @method renderAvatarStrip
	 */
	renderAvatarStrip: function () {
		var tool = this;
		var state = tool.state;
		var filter = state.filterUsers;

		var strip = document.createElement('div');
		strip.className = 'Q_swimlane_strip'
			+ (state.avatarSticky ? ' Q_swimlane_sticky' : '')
			+ ' Q_swimlane_strip_' + state.avatarPosition;
		strip.setAttribute('role', 'toolbar');
		strip.setAttribute('aria-label', 'People in this journey');

		var inner = document.createElement('div');
		inner.className = 'Q_swimlane_strip_inner';

		(state.actors || []).forEach(function (actor) {
			var on = !filter || filter.indexOf(actor.userId) >= 0;
			var b = document.createElement('button');
			b.className = 'Q_swimlane_avatar' + (on ? '' : ' Q_swimlane_off');
			b.type = 'button';
			b.setAttribute('data-userid', actor.userId);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
			b.setAttribute('title', actor.name
				+ (actor.role ? ' — ' + actor.role : ''));
			b.style.setProperty('--lane', tool.colors[actor.userId]);

			var initials = (actor.name || actor.userId).replace(/^demo-/, '')
				.split(/[\s-]+/).map(function (p) { return p[0]; })
				.join('').slice(0, 2).toUpperCase();

			b.innerHTML = '<span class="Q_swimlane_ring">'
				+ (actor.avatar
					? '<img src="' + actor.avatar + '" alt="">'
					: '<span class="Q_swimlane_initials">' + initials + '</span>')
				+ '</span><span class="Q_swimlane_who">'
				+ Q.htmlEntities(actor.name || actor.userId) + '</span>';
			inner.appendChild(b);
		});

		if (filter && filter.length) {
			var reset = document.createElement('button');
			reset.type = 'button';
			reset.className = 'Q_swimlane_reset';
			reset.textContent = 'Show everyone';
			inner.appendChild(reset);
		}

		strip.appendChild(inner);
		return strip;
	},

	/**
	 * @method renderSegment
	 */
	renderSegment: function (segment, index) {
		var tool = this;
		var state = tool.state;

		var el = document.createElement('section');
		el.className = 'Q_swimlane_segment';
		el.setAttribute('data-segment', index);
		el.style.setProperty('--transition', state.segmentTransitionMs + 'ms');

		if (segment.skipped) {
			var gap = document.createElement('div');
			gap.className = 'Q_swimlane_gap';
			gap.textContent = segment.skipped + ' hidden';
			el.appendChild(gap);
		}

		var single = tool.max === 1 || segment.userIds.length === 1;

		segment.moments.forEach(function (moment) {
			if (state.showBarriers && moment.barrier) {
				el.appendChild(tool.renderBarrier(moment));
			}
			el.appendChild(single
				? tool.renderStacked(moment, segment)
				: tool.renderRow(moment, segment));
		});

		return el;
	},

	/**
	 * @method renderBarrier
	 */
	renderBarrier: function (moment) {
		var el = document.createElement('div');
		el.className = 'Q_swimlane_barrier';
		el.setAttribute('role', 'separator');
		var label = moment.barrierLabel || 'sync';
		el.innerHTML = '<span class="Q_swimlane_barrier_label">'
			+ Q.htmlEntities(label) + '</span>';
		return el;
	},

	/**
	 * Side-by-side: one column per active actor.
	 * @method renderRow
	 */
	renderRow: function (moment, segment) {
		var tool = this;
		var ids = tool.activeIds(moment);
		var ranked = tool.rank(moment, ids);
		var shown = ranked.slice(0, tool.max);
		var overflow = ranked.slice(tool.max);
		var width = tool.columnWidth(shown.length);

		var row = document.createElement('div');
		row.className = 'Q_swimlane_row';
		row.setAttribute('data-moment', moment.ordinal);
		row.style.setProperty('--gutter', tool.state.columnGap + 'px');

		shown.forEach(function (userId, i) {
			var frame = tool.frameFor(moment, userId);
			var node = tool.renderNode(moment, frame, width, false);
			// Reading order. Without this a three-column moment resolves
			// raggedly, in whatever order the observer happened to fire.
			node.style.setProperty('--i', i);
			row.appendChild(node);
		});

		if (!overflow.length) {
			return row;
		}

		var wrap = document.createElement('div');
		wrap.className = 'Q_swimlane_stack';
		wrap.setAttribute('data-moment', moment.ordinal);
		wrap.appendChild(row);
		wrap.appendChild(tool.renderOthers(moment, overflow,
			Math.min(tool.state.maxNodeWidth, tool.width - tool.state.nodePadding * 2)));
		return wrap;
	},

	/**
	 * Single column: the actor who moved renders full width, everyone else
	 * becomes a collapsed expandable beneath. This is the phone default, not
	 * a degraded mode — most people will see the journey this way.
	 * @method renderStacked
	 */
	renderStacked: function (moment, segment) {
		var tool = this;
		var ids = tool.activeIds(moment);
		var primaryId = tool.primaryId(moment, ids);
		var width = tool.columnWidth(1);

		var wrap = document.createElement('div');
		wrap.className = 'Q_swimlane_stack';
		wrap.setAttribute('data-moment', moment.ordinal);

		var primary = tool.frameFor(moment, primaryId);
		wrap.appendChild(tool.renderNode(moment, primary, width, true));

		var others = ids.filter(function (id) { return id !== primaryId; });
		if (!others.length) { return wrap; }

		var group = tool.renderOthers(moment, others, width);
		wrap.appendChild(group);
		return wrap;
	},


	/**
	 * The accordion of non-primary frames. Used in two places, which is the
	 * point: single-column mode puts every other actor here, and a row whose
	 * cast exceeds maxSideBySide puts the overflow here. Same component, so
	 * the two cases behave identically.
	 * @method renderOthers
	 * @param {Object} moment
	 * @param {Array} userIds actors to place in the accordion
	 * @param {Number} width
	 * @return {Element}
	 */
	renderOthers: function (moment, userIds, width) {
		var tool = this;
		var group = document.createElement('div');
		group.className = 'Q_swimlane_others';

		userIds.forEach(function (userId) {
			var frame = tool.frameFor(moment, userId);
			var name = tool.nameOf(userId);
			var id = moment.ordinal + '-' + Q.normalize(userId, '_');

			var host = document.createElement('div');
			host.className = 'Q_swimlane_expandable';
			host.style.setProperty('--lane', tool.colors[userId]);

			var title = '<span class="Q_swimlane_exp_dot"></span>'
				+ '<span class="Q_swimlane_exp_name">' + Q.htmlEntities(name) + '</span>'
				+ '<span class="Q_swimlane_exp_label">'
				+ Q.htmlEntities(tool.labelOf(frame)) + '</span>';

			var content = document.createElement('div');
			content.className = 'Q_swimlane_exp_content';
			content.appendChild(tool.renderNode(moment, frame, width - 24, false));

			var element = Q.Tool.setUpElement('div', 'Q/expandable', {
				title: title,
				content: content,
				autoCollapseSiblings: true,
				scrollContainer: true,
				spaceAbove: tool.stripHeight() + 10,
				onExpand: new Q.Event(function () {
					// Opening changes the height of everything below, so every
					// spine point past it is now wrong.
					tool.drawSpines();
				}, tool),
				onCollapse: new Q.Event(function () {
					tool.drawSpines();
				}, tool)
			}, id, tool.prefix);

			host.appendChild(element);
			group.appendChild(host);
			Q.activate(element);
			tool.expandables[id] = element;
		});

		return group;
	},


	/**
	 * What caused this frame to be different, if anything did.
	 *
	 * Position already tells you a moment follows the one above it, so an
	 * arrow saying so is redundant ink. What position does *not* tell you is
	 * whose action landed here and what kind of message it was — so that goes
	 * on the affected node as a small arrival mark, not as a line.
	 *
	 * Derived from the moment's primary actor unless the frame says
	 * otherwise:
	 *
	 *     frame.cause = { userId: 'demo-bob', type: 'Safebox/action/approved',
	 *                     label: 'approved' }
	 *
	 * @method causeFor
	 * @param {Object} moment
	 * @param {Object} frame
	 * @param {String} primaryId
	 * @return {Object|null} { userId, type, label }
	 */
	causeFor: function (moment, frame, primaryId) {
		if (!this.state.showCauses) { return null; }
		var explicit = frame.cause;
		if (explicit === false) { return null; }

		var userId = (explicit && explicit.userId) || primaryId;
		// The actor who moved is the cause, not a recipient of one.
		if (!userId || userId === frame.userId) { return null; }
		if (!explicit && frame.idle) { return null; }

		var type = (explicit && explicit.type) || moment.messageType || null;
		var label = (explicit && explicit.label)
			|| (type ? type.split('/').pop() : null);

		return { userId: userId, type: type, label: label };
	},

	/**
	 * The arrival mark: the causer's avatar, plus the message type when
	 * there is room for it. Narrow columns keep the avatar and drop the text,
	 * because at 109px the text would be three truncated characters.
	 * @method renderCause
	 * @return {Element|null}
	 */
	renderCause: function (cause, width) {
		if (!cause) { return null; }
		var tool = this;

		var chip = document.createElement('span');
		chip.className = 'Q_swimlane_cause'
			+ (width < 190 ? ' Q_swimlane_cause_tight' : '');
		chip.style.setProperty('--lane', tool.colors[cause.userId] || '#888');
		chip.setAttribute('title', tool.nameOf(cause.userId)
			+ (cause.type ? ' — ' + cause.type : ''));

		var actor = null;
		(tool.state.actors || []).forEach(function (a) {
			if (a.userId === cause.userId) { actor = a; }
		});

		var initial = (tool.nameOf(cause.userId) || '?')
			.replace(/^demo-/, '').charAt(0).toUpperCase();

		chip.innerHTML = '<span class="Q_swimlane_cause_who">'
			+ (actor && actor.avatar
				? '<img src="' + actor.avatar + '" alt="">'
				: Q.htmlEntities(initial))
			+ '</span>'
			+ (cause.label
				? '<span class="Q_swimlane_cause_type">'
					+ Q.htmlEntities(cause.label) + '</span>'
				: '');
		return chip;
	},

	/**
	 * @method renderNode
	 */
	renderNode: function (moment, frame, width, isPrimary) {
		var tool = this;
		var userId = frame.userId;
		var color = tool.colors[userId];

		var node = document.createElement('div');
		node.className = 'Q_swimlane_node'
			+ (isPrimary ? ' Q_swimlane_primary' : '')
			+ (frame.denied ? ' Q_swimlane_denied' : '')
			+ (frame.idle ? ' Q_swimlane_idle' : '');
		node.style.setProperty('--lane', color);
		node.style.width = width + 'px';
		node.setAttribute('data-moment', moment.ordinal);
		node.setAttribute('data-userid', userId);
		node.setAttribute('role', 'img');
		node.setAttribute('aria-label', tool.nameOf(userId) + ': ' + tool.labelOf(frame));
		node.setAttribute('tabindex', '0');

		var head = document.createElement('div');
		head.className = 'Q_swimlane_node_head';
		head.innerHTML = '<span class="Q_swimlane_ordinal">'
			+ String(moment.ordinal).padStart(2, '0') + '</span>'
			+ '<span class="Q_swimlane_node_who">'
			+ Q.htmlEntities(tool.nameOf(userId)) + '</span>';
		node.appendChild(head);

		var cause = tool.causeFor(moment,
			frame, tool.primaryId(moment, tool.activeIds(moment)));
		var mark = tool.renderCause(cause, width);
		if (mark) {
			node.classList.add('Q_swimlane_caused');
			head.appendChild(mark);
		}

		var screen = document.createElement('div');
		screen.className = 'Q_swimlane_screen';
		node.appendChild(screen);

		var caption = document.createElement('div');
		caption.className = 'Q_swimlane_caption';
		caption.textContent = tool.labelOf(frame);
		node.appendChild(caption);

		// Everything needed to rebuild this screen after it has been
		// unmounted. Cheaper to carry than to look up by ordinal + userId.
		node.__frame = frame;
		node.__width = width;
		node.__signature = JSON.stringify(frame);

		tool.fill(screen, frame, width);
		return node;
	},

	/**
	 * Put a mockup into a node. Pre-rendered captures win; otherwise the
	 * mockup registry renders live.
	 * @method fill
	 */
	fill: function (screen, frame, width) {
		var tool = this;

		if (frame.denied) {
			screen.innerHTML = '<div class="Q_swimlane_locked">'
				+ '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
				+ '<path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor"'
				+ ' stroke-width="1.6" stroke-linecap="round"/>'
				+ '<rect x="4.5" y="10" width="15" height="10" rx="2" fill="none"'
				+ ' stroke="currentColor" stroke-width="1.6"/></svg>'
				+ '<span>No access</span></div>';
			return;
		}
		if (frame.svg && typeof frame.svg === 'string' && frame.svg.indexOf('<svg') === 0) {
			screen.innerHTML = frame.svg;
			return;
		}
		if (frame.svg) { // a URL to a captured file
			screen.innerHTML = '<img src="' + frame.svg + '" alt="" loading="lazy">';
			return;
		}
		if (!frame.tool || !Q.Tool.mockup) {
			screen.innerHTML = '<div class="Q_swimlane_empty">'
				+ Q.htmlEntities(frame.label || 'no change') + '</div>';
			return;
		}

		Q.Tool.mockup.render(frame.tool, frame.state, width - 2, function (err, result) {
			if (err || !result) { return; }
			screen.innerHTML = result.svg;
		});
	},

	// ---- geometry -------------------------------------------------------

	/**
	 * The signature element: a continuous process line per actor, running the
	 * height of the timeline. It brightens where the actor is present and
	 * fades almost to nothing across their gaps, so scanning the left edge
	 * shows the cast weaving in and out.
	 * @method drawSpines
	 */
	drawSpines: function () {
		var tool = this;
		if (!tool.spineLayer) { return; }

		var box = tool.$body[0].getBoundingClientRect();
		var parts = [];
		var byUser = {};

		$('.Q_swimlane_node', tool.element).each(function () {
			var a = tool.anchorFor(this, box);
			if (!a) { return; }
			var userId = this.getAttribute('data-userid');
			if (!byUser[userId]) { byUser[userId] = []; }
			byUser[userId].push({ x: a.cx, top: a.top, bottom: a.bottom });
		});

		for (var userId in byUser) {
			var points = byUser[userId];
			var color = tool.colors[userId];
			for (var i = 0; i + 1 < points.length; ++i) {
				var p = points[i], n = points[i + 1];
				var span = n.top - p.bottom;
				if (span < 2) { continue; }
				var sameColumn = Math.abs(n.x - p.x) < 2;
				// Straight where the actor holds position, curved where the
				// cast changed and their column moved. The curve is the
				// visible trace of a segment transition.
				var travel = Math.abs(n.x - p.x);
				var d;

				if (sameColumn) {
					d = 'M' + r2(p.x) + ' ' + r2(p.bottom) + 'V' + r2(n.top);
				} else if (travel > span * 2) {
					// The actor moved most of the way across the layout in
					// almost no vertical distance. Any curve joining those two
					// points is a horizontal streak across the timeline, which
					// reads as an arrow rather than as continuity. Two short
					// tails say the same thing quietly; the lane colour and
					// the event ticks carry the rest.
					var tail = Math.min(14, span * .35);
					parts.push('<path d="M' + r2(p.x) + ' ' + r2(p.bottom)
						+ 'v' + r2(tail) + '" stroke="' + color
						+ '" stroke-width="2.25" opacity=".2" fill="none"'
						+ ' stroke-linecap="round"/>');
					parts.push('<path d="M' + r2(n.x) + ' ' + r2(n.top)
						+ 'v-' + r2(tail) + '" stroke="' + color
						+ '" stroke-width="2.25" opacity=".2" fill="none"'
						+ ' stroke-linecap="round"/>');
					continue;
				} else {
					var k = Math.min(44, span * .5);
					var a = n.top - k, bpt = n.top - k * .5;
					d = 'M' + r2(p.x) + ' ' + r2(p.bottom) + 'V' + r2(a)
						+ 'C' + r2(p.x) + ' ' + r2(bpt) + ','
						+ r2(n.x) + ' ' + r2(bpt) + ','
						+ r2(n.x) + ' ' + r2(n.top);
				}
				// Long gaps mean the actor was absent — fade almost out, so
				// scanning the edge shows the cast weaving in and out.
				var absent = span > 150;
				parts.push('<path d="' + d + '" stroke="' + color
					+ '" stroke-width="' + (absent ? 1.75 : 2.25) + '"'
					+ ' opacity="' + (absent ? .085 : .34) + '" fill="none"'
					+ ' stroke-linecap="round"'
					+ (absent
						? ' stroke-dasharray="0.1 9"'
						: ' pathLength="1" data-draw')
					+ '/>');
			}
			// A tick at each event, the way a space-time diagram marks one.
			points.forEach(function (p) {
				parts.push('<circle cx="' + r2(p.x) + '" cy="' + r2(p.top - 5)
					+ '" r="3" fill="var(--sw-bg)"/>');
				parts.push('<circle data-tick cx="' + r2(p.x) + '" cy="' + r2(p.top - 5)
					+ '" r="2.6" fill="' + color + '" opacity=".6"/>');
			});
		}

		size(tool.spineLayer, box);
		tool.spineLayer.innerHTML = parts.join('');
	},

	// ---- interaction ----------------------------------------------------

	/**
	 * @method bind
	 */
	bind: function () {
		var tool = this;
		var $te = $(tool.element);
		$te.off('.Q_swimlane');

		$te.on(Q.Pointer.fastclick + '.Q_swimlane', '.Q_swimlane_avatar', function () {
			tool.toggleUser(this.getAttribute('data-userid'));
		});

		$te.on(Q.Pointer.fastclick + '.Q_swimlane', '.Q_swimlane_reset', function () {
			tool.filter(null);
		});

		$te.on(Q.Pointer.fastclick + '.Q_swimlane', '.Q_swimlane_play', function () {
			tool.playing ? tool.pause() : tool.play();
		});

		$te.on(Q.Pointer.fastclick + '.Q_swimlane', '.Q_swimlane_dot', function () {
			tool.seek(parseInt(this.getAttribute('data-moment'), 10));
		});

		if (tool.state.zoomOnTap) {
			$te.on(Q.Pointer.fastclick + '.Q_swimlane', '.Q_swimlane_node', function () {
				tool.zoom(this);
			});
		}

		$te.on('keydown.Q_swimlane', '.Q_swimlane_node', function (e) {
			var handled = true;
			switch (e.key) {
				case 'Enter': case ' ': tool.zoom(this); break;
				case 'ArrowDown': tool.step(this, 1); break;
				case 'ArrowUp': tool.step(this, -1); break;
				case 'ArrowRight': tool.sibling(this, 1); break;
				case 'ArrowLeft': tool.sibling(this, -1); break;
				case 'Escape': tool.pause(); break;
				default: handled = false;
			}
			if (handled) { e.preventDefault(); }
		});
	},

	/**
	 * @method toggleUser
	 */
	toggleUser: function (userId) {
		var state = this.state;
		var all = (state.actors || []).map(function (a) { return a.userId; });
		var current = state.filterUsers ? state.filterUsers.slice() : all.slice();
		var i = current.indexOf(userId);

		if (i >= 0) {
			current.splice(i, 1);
		} else {
			current.push(userId);
		}
		if (!current.length || current.length === all.length) {
			current = null;
		}
		this.filter(current);
	},

	/**
	 * Filtering re-computes segments, so hiding someone can merge two
	 * segments that only differed by their presence — and the survivors
	 * expand to fill the width.
	 * @method filter
	 */
	filter: function (userIds) {
		var tool = this;
		var previous = tool.state.filterUsers;
		var all = (tool.state.actors || []).map(function (a) { return a.userId; });
		var was = previous || all;
		var now = userIds || all;

		var before = tool.positions();
		var going = was.filter(function (id) { return now.indexOf(id) < 0; });

		var ghosts = tool.ghost(before, going);

		tool.state.filterUsers = userIds;
		tool.refresh();
		tool.releaseGhosts(ghosts);

		requestAnimationFrame(function () {
			tool.flip(before);
			Q.handle(tool.state.onFilter, tool, [userIds]);
		});
	},

	/**
	 * @method zoom
	 */
	zoom: function (node) {
		var tool = this;
		var ordinal = parseInt(node.getAttribute('data-moment'), 10);
		var userId = node.getAttribute('data-userid');
		var moment = tool.momentOf(ordinal);
		var frame = moment && tool.frameFor(moment, userId);
		if (!frame) { return; }

		if (false === Q.handle(tool.state.onNodeTap, tool, [frame, moment, node])) {
			return;
		}

		var overlay = document.createElement('div');
		overlay.className = 'Q_swimlane_lightbox';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.style.setProperty('--lane', tool.colors[userId]);

		var inner = document.createElement('div');
		inner.className = 'Q_swimlane_lightbox_inner';
		inner.innerHTML = '<header><span class="Q_swimlane_ordinal">'
			+ String(ordinal).padStart(2, '0') + '</span>'
			+ '<strong>' + Q.htmlEntities(tool.nameOf(userId)) + '</strong>'
			+ '<span>' + Q.htmlEntities(tool.labelOf(frame)) + '</span>'
			+ '<button type="button" class="Q_swimlane_close" aria-label="Close">'
			+ '&times;</button></header>';

		var stage = document.createElement('div');
		stage.className = 'Q_swimlane_stage';
		inner.appendChild(stage);
		overlay.appendChild(inner);
		document.body.appendChild(overlay);

		var width = Math.min(560, window.innerWidth - 40);

		if (frame.tool && Q.Tool.constructors && Q.Tool.constructors[frame.tool]) {
			// A live, interactive tool at this frame's state.
			var el = Q.Tool.setUpElement('div', frame.tool, frame.state || {},
				null, tool.prefix);
			stage.appendChild(el);
			Q.activate(el);
		} else {
			tool.fill(stage, frame, width);
		}

		requestAnimationFrame(function () {
			overlay.classList.add('Q_swimlane_open');
		});

		function close() {
			overlay.classList.remove('Q_swimlane_open');
			setTimeout(function () {
				Q.Tool.clear(stage);
				overlay.remove();
				node.focus();
			}, 200);
			$(document).off('keydown.Q_swimlane_lightbox');
		}
		$(overlay).on(Q.Pointer.fastclick, function (e) {
			if (e.target === overlay || $(e.target).closest('.Q_swimlane_close').length) {
				close();
			}
		});
		$(document).on('keydown.Q_swimlane_lightbox', function (e) {
			if (e.key === 'Escape') { close(); }
		});
	},

	/**
	 * Only render what's near the viewport. Thirty moments across three
	 * actors is several thousand SVG elements, and nothing animates smoothly
	 * with that much in the tree.
	 * @method observe
	 */
	observe: function () {
		var tool = this;
		if (tool.observer) { tool.observer.disconnect(); }
		if (!window.IntersectionObserver) { return; }

		tool.observer = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					tool.mount(entry.target);
				} else {
					tool.unmount(entry.target);
				}
			});
		}, { root: null, rootMargin: tool.state.virtualizeMargin, threshold: 0 });

		$('.Q_swimlane_node', tool.element).each(function () {
			tool.observer.observe(this);
		});
	},

	/**
	 * Bring a node's screen back. Idempotent, and free when the node was
	 * never dropped.
	 * @method mount
	 */
	mount: function (node) {
		var tool = this;
		// The reveal class is sticky once set: re-entering the window should
		// not replay the rise animation.
		node.classList.add('Q_swimlane_near');

		if (!node.__unmounted) { return; }
		node.__unmounted = false;

		var screen = node.querySelector('.Q_swimlane_screen');
		if (!screen) { return; }
		screen.style.minHeight = '';
		tool.fill(screen, node.__frame, node.__width);
	},

	/**
	 * Drop a node's screen contents while holding its exact height.
	 *
	 * The wrapper stays in the DOM on purpose. Removing it would move every
	 * arrow anchor and spine point below it, and would change the document
	 * height under the user's scroll — so the timeline would crawl while you
	 * scrolled it. What is actually expensive is the SVG inside: a mockup is
	 * on the order of eighty elements, and thirty moments across three actors
	 * is several thousand. Those are what go.
	 *
	 * @method unmount
	 */
	unmount: function (node) {
		var tool = this;
		if (!tool.state.virtualize || node.__unmounted) { return; }
		if (tool.locked(node)) { return; }

		var screen = node.querySelector('.Q_swimlane_screen');
		if (!screen || !screen.firstChild) { return; }

		var height = screen.offsetHeight;
		if (!height) { return; }

		screen.style.minHeight = height + 'px';
		screen.innerHTML = '';
		node.__unmounted = true;
	},

	/**
	 * Nodes that must never be dropped: the moment being narrated, anything
	 * inside an open expandable, and anything currently focused.
	 * @method locked
	 */
	locked: function (node) {
		if (node.classList.contains('Q_swimlane_current')) { return true; }
		if (node === document.activeElement) { return true; }
		if (node.contains && node.contains(document.activeElement)) { return true; }
		var container = node.closest && node.closest('.Q_expandable_container');
		return !!(container && container.classList.contains('Q_expanded'));
	},

	/**
	 * Bring everything back. Export, print and any full-document read need
	 * the whole timeline in the DOM at once.
	 * @method mountAll
	 */
	mountAll: function () {
		var tool = this;
		$('.Q_swimlane_node', tool.element).each(function () {
			tool.mount(this);
		});
	},


	/**
	 * A PDF of the journey.
	 *
	 * Deliberately not jsPDF. jsPDF cannot place SVG without svg2pdf, and the
	 * usual fallback — rasterize to canvas, embed a PNG — throws away the one
	 * property that makes these mockups worth exporting: they are vector, so
	 * they stay sharp when a prospect zooms in on a printed page. The
	 * browser's own print pipeline keeps them vector, handles fonts, and is
	 * already installed everywhere.
	 *
	 * So this composes a clean print document and hands it to the browser.
	 * Page breaks land at segment boundaries, never mid-node, and the
	 * disclaimer repeats in the running footer — the same reasoning as
	 * exportSvg: the artifact travels without its context.
	 *
	 * @method exportPdf
	 * @param {Object} [options]
	 * @param {String} [options.orientation='landscape']
	 * @param {String} [options.pageSize='A4']
	 * @param {String} [options.title]
	 * @param {Boolean} [options.print=true] call print() once loaded
	 * @return {Window|null} the print window, or null if it was blocked
	 */
	exportPdf: function (options) {
		var tool = this;
		var o = Q.extend({
			orientation: 'landscape',
			pageSize: 'A4',
			print: true
		}, options);

		tool.mountAll();
		var title = o.title || tool.state.title || 'Journey';
		var svg = tool.exportSvg({ width: o.orientation === 'landscape' ? 1400 : 980 });

		var win = window.open('', '_blank');
		if (!win) {
			console.warn('Q/swimlane: exportPdf was blocked by the popup blocker');
			return null;
		}

		win.document.open();
		win.document.write(
			'<!DOCTYPE html><html><head><meta charset="utf-8">'
			+ '<title>' + esc(title) + '</title><style>'
			+ '@page { size: ' + o.pageSize + ' ' + o.orientation
			+ '; margin: 12mm; }'
			+ 'html,body { margin:0; padding:0; background:#fff;'
			+ ' font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
			+ ' color:#14161a; }'
			+ 'svg { width:100%; height:auto; display:block; }'
			+ '.foot { position:fixed; bottom:0; left:0; right:0;'
			+ ' padding:4mm 0; font-size:8pt; color:#8b929c;'
			+ ' border-top:1px solid #e7e9ed; background:#fff; }'
			+ '@media print { .foot { position:fixed; } }'
			+ '</style></head><body>'
			+ svg
			+ (tool.state.disclaimer
				? '<div class="foot">' + esc(tool.state.disclaimer) + '</div>'
				: '')
			+ '</body></html>');
		win.document.close();

		if (o.print) {
			// Give the SVG a frame to lay out before the print dialog freezes
			// the document.
			win.onload = function () { setTimeout(function () { win.print(); }, 120); };
			setTimeout(function () {
				try { win.print(); } catch (e) {}
			}, 700);
		}
		return win;
	},

	// ---- parallax -------------------------------------------------------

	/**
	 * Three depth layers at slightly different scroll rates: barriers and
	 * segment rules lag, nodes track exactly, arrows lead. The arrows then
	 * read as strung slightly above the screens, which is the point.
	 *
	 * Kept to a few percent. This is the least valuable thing in the tool and
	 * the most able to ruin a demo, so it is off unless asked for and dead
	 * under prefers-reduced-motion.
	 * @method startParallax
	 */
	startParallax: function () {
		var tool = this;
		if (!tool.state.parallax || prefersReducedMotion()) { return; }
		$(tool.element).addClass('Q_swimlane_parallax');

		var intensity = tool.state.parallaxIntensity;
		var ticking = false;

		tool.onParallax = function () {
			if (ticking) { return; }
			ticking = true;
			requestAnimationFrame(function () {
				ticking = false;
				if (!tool.$body || !tool.$body[0]) { return; }
				var top = tool.$body[0].getBoundingClientRect().top;
				// Only translate — never touch layout properties, or the
				// whole thing reflows on every scroll event.
				if (tool.spineLayer) {
					tool.spineLayer.style.transform =
						'translate3d(0,' + (top * intensity) + 'px,0)';
				}
			});
		};

		$(window).on('scroll.Q_swimlane_parallax', tool.onParallax);
		tool.onParallax();
	},

	/**
	 * @method stopParallax
	 */
	stopParallax: function () {
		var tool = this;
		$(tool.element).removeClass('Q_swimlane_parallax');
		$(window).off('.Q_swimlane_parallax');
		if (tool.spineLayer) { tool.spineLayer.style.transform = ''; }
	},


	// ---- motion ---------------------------------------------------------

	/**
	 * Positions of every node right now, keyed by moment and actor.
	 * @method positions
	 */
	positions: function () {
		var map = {};
		var box = this.element.getBoundingClientRect();
		$('.Q_swimlane_node', this.element).each(function () {
			var r = this.getBoundingClientRect();
			map[this.getAttribute('data-moment') + '\t'
				+ this.getAttribute('data-userid')] = {
				x: r.left - box.left, y: r.top - box.top,
				w: r.width, h: r.height, node: this
			};
		});
		return map;
	},

	/**
	 * Move nodes from where they were to where they now are.
	 *
	 * A crossfade tells the viewer that something changed. It does not tell
	 * them *what* — a person who is in both the before and the after simply
	 * blinks and reappears somewhere else, and the eye has to re-find them.
	 * Measuring before, rebuilding, then transforming each survivor back to
	 * its old position and releasing it means the columns visibly rearrange
	 * and the eye can follow one actor across the change.
	 *
	 * Only transform is animated, so this composites and never reflows.
	 *
	 * @method flip
	 * @param {Object} before result of positions()
	 */
	flip: function (before) {
		var tool = this;
		if (prefersReducedMotion()) { return; }

		var after = tool.positions();
		var moved = [];

		for (var key in after) {
			var to = after[key];
			var from = before[key];
			if (!from) {
				// New to this view — it arrives with the normal reveal.
				continue;
			}
			var dx = from.x - to.x;
			var dy = from.y - to.y;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { continue; }

			to.node.classList.add('Q_swimlane_flip_start');
			to.node.style.transform = 'translate3d(' + Math.round(dx) + 'px,'
				+ Math.round(dy) + 'px,0)';
			// Already revealed elsewhere; skip the entrance for these.
			to.node.classList.add('Q_swimlane_near');
			moved.push(to.node);
		}

		if (!moved.length) { return; }

		// One forced read, then release everything in the same frame — so
		// every column starts moving together rather than in a cascade.
		tool.element.offsetHeight;

		requestAnimationFrame(function () {
			moved.forEach(function (node) {
				node.classList.remove('Q_swimlane_flip_start');
				node.classList.add('Q_swimlane_flip');
				node.style.transform = '';
			});
			setTimeout(function () {
				moved.forEach(function (node) {
					node.classList.remove('Q_swimlane_flip');
					node.style.willChange = '';
				});
				tool.drawSpines();
			}, 460);
		});
	},

	/**
	 * Leave a fading copy of every node that is about to disappear, so a
	 * column that is being filtered out reads as leaving rather than as
	 * having never been there.
	 * @method ghost
	 * @param {Object} before result of positions()
	 * @param {Array} goingIds userIds about to be removed
	 */
	ghost: function (before, goingIds) {
		var tool = this;
		if (prefersReducedMotion() || !goingIds || !goingIds.length) { return null; }

		var layer = document.createElement('div');
		layer.className = 'Q_swimlane_ghosts';
		layer.setAttribute('aria-hidden', 'true');

		var any = false;
		for (var key in before) {
			var userId = key.split('\t')[1];
			if (goingIds.indexOf(userId) < 0) { continue; }
			var p = before[key];
			var clone = p.node.cloneNode(true);
			clone.className += ' Q_swimlane_ghost';
			clone.style.left = p.x + 'px';
			clone.style.top = p.y + 'px';
			clone.style.width = p.w + 'px';
			layer.appendChild(clone);
			any = true;
		}
		// Returned rather than appended: refresh() is about to clear the
		// element, so the layer has to go in on the other side of it.
		return any ? layer : null;
	},

	/**
	 * @method releaseGhosts
	 */
	releaseGhosts: function (layer) {
		var tool = this;
		if (!layer) { return; }
		tool.element.appendChild(layer);
		requestAnimationFrame(function () {
			$(layer).find('.Q_swimlane_ghost').each(function () {
				this.classList.add('Q_swimlane_ghost_out');
			});
		});
		setTimeout(function () { layer.remove(); }, 340);
	},

	// ---- live updates ---------------------------------------------------

	/**
	 * Replace the journey without throwing away the reader's place.
	 *
	 * This exists for the case where an AI is editing mockups in the middle
	 * of a conversation. A full refresh() there is hostile: scroll jumps to
	 * the top, every expandable slams shut, and the thing the person was
	 * looking at moves. So the common edit — same moments, same cast,
	 * different frame state — updates nodes in place and never touches
	 * layout at all.
	 *
	 * A structural change (moments added, removed, reordered, or the cast of
	 * a moment changed) does need a rebuild, but scroll position, open
	 * expandables, filter and branch choices are all restored afterwards.
	 *
	 * @method setJourney
	 * @param {Object} journey { actors, moments }
	 * @param {Object} [options]
	 * @param {Boolean} [options.force=false] rebuild even if nothing structural moved
	 * @return {String} 'patched' | 'rebuilt'
	 */
	setJourney: function (journey, options) {
		var tool = this;
		var force = options && options.force;
		var before = tool.signature();

		if (journey.actors) { tool.state.actors = journey.actors; }
		tool.state.moments = journey.moments || tool.state.moments;

		tool.assignColors();

		if (!force && tool.signature() === before) {
			tool.patch();
			return 'patched';
		}

		var place = tool.capture();
		var before = tool.positions();
		tool.refresh();
		requestAnimationFrame(function () {
			tool.restore(place);
			tool.flip(before);
		});
		return 'rebuilt';
	},

	/**
	 * What the layout depends on: which moments exist, in what order, with
	 * which cast. Frame state is deliberately excluded — that is the part
	 * that can change without moving anything.
	 * @method signature
	 */
	signature: function () {
		var tool = this;
		return tool.visibleMoments().map(function (m) {
			return m.ordinal + ':' + tool.activeIds(m).join(',')
				+ (m.barrier ? '!' : '');
		}).join('|') + '#' + tool.max;
	},

	/**
	 * Update every node whose frame actually changed, and nothing else.
	 * @method patch
	 * @return {Number} how many nodes were re-rendered
	 */
	patch: function () {
		var tool = this;
		var changed = 0;

		$('.Q_swimlane_node', tool.element).each(function () {
			var node = this;
			var ordinal = parseInt(node.getAttribute('data-moment'), 10);
			var userId = node.getAttribute('data-userid');
			var moment = tool.momentOf(ordinal);
			if (!moment) { return; }

			var frame = tool.frameFor(moment, userId);
			var next = JSON.stringify(frame);
			if (next === node.__signature) { return; }

			node.__signature = next;
			node.__frame = frame;
			++changed;

			node.className = 'Q_swimlane_node'
				+ (node.classList.contains('Q_swimlane_primary') ? ' Q_swimlane_primary' : '')
				+ (frame.denied ? ' Q_swimlane_denied' : '')
				+ (frame.idle ? ' Q_swimlane_idle' : '')
				+ (node.classList.contains('Q_swimlane_near') ? ' Q_swimlane_near' : '')
				+ (node.classList.contains('Q_swimlane_current') ? ' Q_swimlane_current' : '');

			var label = tool.labelOf(frame);
			var caption = node.querySelector('.Q_swimlane_caption');
			if (caption) { caption.textContent = label; }
			node.setAttribute('aria-label', tool.nameOf(userId) + ': ' + label);

			var screen = node.querySelector('.Q_swimlane_screen');
			if (screen && !node.__unmounted) {
				tool.fill(screen, frame, node.__width);
			}
		});

		// A mockup can change height, which moves everything below it.
		if (changed) {
			requestAnimationFrame(function () { tool.drawSpines(); });
		}
		return changed;
	},

	/**
	 * @method capture
	 * @return {Object} the reader's place, for restore()
	 */
	capture: function () {
		var tool = this;
		var scroller = tool.scrollingParent();
		var open = [];
		for (var id in tool.expandables) {
			var container = tool.expandables[id]
				.querySelector('.Q_expandable_container');
			if (container && container.classList.contains('Q_expanded')) {
				open.push(id);
			}
		}

		// Anchor to a node rather than to a pixel offset: a rebuild can
		// change heights above the viewport, and an absolute scrollTop would
		// then land somewhere else entirely.
		var anchor = null;
		var box = tool.element.getBoundingClientRect();
		$('.Q_swimlane_node', tool.element).each(function () {
			if (anchor) { return; }
			var r = this.getBoundingClientRect();
			if (r.bottom > 0) {
				anchor = {
					ordinal: this.getAttribute('data-moment'),
					userId: this.getAttribute('data-userid'),
					offset: r.top
				};
			}
		});

		return {
			open: open,
			anchor: anchor,
			cursor: tool.cursor,
			playing: tool.playing,
			scroller: scroller
		};
	},

	/**
	 * @method restore
	 */
	restore: function (place) {
		var tool = this;
		if (!place) { return; }

		place.open.forEach(function (id) {
			var host = tool.expandables[id];
			var t = host && Q.Tool.from
				? Q.Tool.from(host, 'Q/expandable') : null;
			if (t && t.expand) {
				t.expand({ autoCollapseSiblings: false });
			}
		});

		if (place.anchor) {
			var node = tool.element.querySelector(
				'.Q_swimlane_node[data-moment="' + place.anchor.ordinal + '"]'
				+ '[data-userid="' + place.anchor.userId + '"]');
			if (node) {
				var delta = node.getBoundingClientRect().top - place.anchor.offset;
				var scroller = place.scroller;
				if (scroller === window) {
					window.scrollBy(0, delta);
				} else if (scroller) {
					scroller.scrollTop += delta;
				}
			}
		}

		tool.cursor = place.cursor;
		if (place.playing) { tool.play(); }
	},

	/**
	 * @method scrollingParent
	 */
	scrollingParent: function () {
		var el = this.element.parentNode;
		while (el && el !== document.body) {
			var overflow = getComputedStyle(el).overflowY;
			if ((overflow === 'auto' || overflow === 'scroll')
			&& el.scrollHeight > el.clientHeight) {
				return el;
			}
			el = el.parentNode;
		}
		return window;
	},

	// ---- narration ------------------------------------------------------

	/**
	 * @method visibleMoments
	 * @return {Array} moments that survive the current filter and branch
	 *   choices, in order
	 */
	visibleMoments: function () {
		var tool = this;
		return tool.state.moments.filter(function (m) {
			return tool.activeIds(m).length > 0 && !tool.hidden(m);
		});
	},

	/**
	 * A moment on a branch the viewer did not take. It stays in the data —
	 * seeking back to the fork re-presents the choice.
	 *
	 * Before anyone chooses, the first arm shows: a timeline that looks
	 * truncated on arrival reads as broken. The fork interrupts playback,
	 * not the static view.
	 * @method hidden
	 */
	hidden: function (moment) {
		var owner = moment.branchOf;
		if (!owner) { return false; }
		var chosen = this.chosen || {};
		var pick = (chosen[owner.ordinal] === undefined) ? 0 : chosen[owner.ordinal];
		return pick !== owner.index;
	},

	/**
	 * @method renderNarrationBar
	 */
	renderNarrationBar: function () {
		var tool = this;
		var bar = document.createElement('div');
		bar.className = 'Q_swimlane_narration';
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', 'Playback');

		var play = document.createElement('button');
		play.type = 'button';
		play.className = 'Q_swimlane_play';
		play.setAttribute('aria-label', 'Play');
		play.innerHTML = playGlyph(false);

		var track = document.createElement('div');
		track.className = 'Q_swimlane_scrubber';

		tool.visibleMoments().forEach(function (moment) {
			var ids = tool.activeIds(moment);
			var dot = document.createElement('button');
			dot.type = 'button';
			dot.className = 'Q_swimlane_dot';
			dot.setAttribute('data-moment', moment.ordinal);
			dot.setAttribute('aria-label', 'Moment ' + moment.ordinal);
			// A dot's colour is the cast of that moment: solid for one actor,
			// a split for several. The scrubber is a census, so the shape of
			// the cast is legible before you scroll anywhere.
			if (ids.length === 1) {
				dot.style.background = tool.colors[ids[0]];
			} else {
				var step = 100 / ids.length;
				dot.style.background = 'linear-gradient(90deg,' + ids.map(
					function (id, i) {
						return tool.colors[id] + ' ' + (i * step) + '% '
							+ ((i + 1) * step) + '%';
					}).join(',') + ')';
			}
			if (moment.branches && moment.branches.length) {
				dot.classList.add('Q_swimlane_fork');
			}
			track.appendChild(dot);
		});

		var text = document.createElement('div');
		text.className = 'Q_swimlane_narration_text';

		bar.appendChild(play);
		bar.appendChild(track);
		bar.appendChild(text);

		tool.$bar = $(bar);
		return bar;
	},

	/**
	 * Start or resume playback from the current moment.
	 * @method play
	 */
	play: function () {
		var tool = this;
		if (tool.playing) { return; }
		tool.playing = true;
		$(tool.element).addClass('Q_swimlane_playing');
		tool.setPlayGlyph(true);
		Q.handle(tool.state.onPlay, tool);
		tool.advance(tool.cursor === undefined ? 0 : tool.cursor);
	},

	/**
	 * @method pause
	 */
	pause: function () {
		var tool = this;
		tool.playing = false;
		clearTimeout(tool.timer);
		if (Q.Visual && Q.Visual.stopHints) { Q.Visual.stopHints(); }
		$(tool.element).removeClass('Q_swimlane_playing');
		tool.setPlayGlyph(false);
		Q.handle(tool.state.onPause, tool);
	},

	/**
	 * @method setPlayGlyph
	 */
	setPlayGlyph: function (playing) {
		if (!this.$bar) { return; }
		var b = this.$bar.find('.Q_swimlane_play')[0];
		if (!b) { return; }
		b.innerHTML = playGlyph(playing);
		b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
	},

	/**
	 * Jump to a moment. Seeking backwards collapses every expandable and
	 * restarts from there — there is no state to unwind, because each moment
	 * renders from its own frame data rather than from accumulated deltas.
	 * @method seek
	 * @param {Number} ordinal
	 */
	seek: function (ordinal) {
		var tool = this;
		var list = tool.visibleMoments();
		var index = 0;
		list.forEach(function (m, i) { if (m.ordinal === ordinal) { index = i; } });

		clearTimeout(tool.timer);
		if (Q.Visual && Q.Visual.stopHints) { Q.Visual.stopHints(); }
		tool.collapseAll();

		if (tool.playing) {
			tool.advance(index);
		} else {
			tool.cursor = index;
			tool.focusMoment(list[index]);
		}
	},

	/**
	 * One step of the playback loop: scroll, highlight, narrate, wait.
	 * @method advance
	 * @param {Number} index into visibleMoments()
	 */
	advance: function (index) {
		var tool = this;
		var list = tool.visibleMoments();

		if (index >= list.length) {
			tool.pause();
			tool.cursor = 0;
			return;
		}

		tool.cursor = index;
		var moment = list[index];
		tool.focusMoment(moment);
		Q.handle(tool.state.onMomentChange, tool, [moment]);

		// A fork stops playback and hands the choice to the viewer.
		if (moment.branches && moment.branches.length
		&& (!tool.chosen || tool.chosen[moment.ordinal] === undefined)) {
			return tool.offerBranches(moment);
		}

		// Frames narrate in turn: the actor who moved, then each other
		// perspective.
		var ids = tool.activeIds(moment);
		var primaryId = tool.primaryId(moment, ids);
		var queue = [primaryId].concat(ids.filter(function (id) {
			return id !== primaryId;
		}));

		var step = 0;
		(function next() {
			if (!tool.playing) { return; }
			if (step >= queue.length) {
				return tool.advance(index + 1);
			}
			var userId = queue[step++];
			var frame = tool.frameFor(moment, userId);
			if (!frame.narration) { return next(); }
			tool.narrate(moment, userId, frame, frame.narration, next);
		})();
	},

	/**
	 * @method narrate
	 */
	narrate: function (moment, userId, frame, narration, done) {
		var tool = this;
		var duration = (narration.duration || tool.state.narrationDuration)
			/ (tool.state.narrationSpeed || 1);

		if (tool.$bar) {
			tool.$bar.find('.Q_swimlane_narration_text')[0].textContent =
				narration.text || '';
		}

		var id = moment.ordinal + '-' + Q.normalize(userId, '_');
		var host = tool.expandables[id];
		var opened = false;

		function begin() {
			var node = tool.element.querySelector(
				'[data-moment="' + moment.ordinal + '"]'
				+ '[data-userid="' + userId + '"]');
			if (node) { tool.mount(node); }
			if (node && narration.hint && Q.Visual && Q.Visual.hint) {
				var target = node.querySelector(narration.hint);
				if (target) {
					Q.Visual.hint(target, {
						tooltip: { text: narration.text, className: 'Q_pulsate' },
						speak: narration.audio ? null : { text: narration.text },
						audio: narration.audio ? { src: narration.audio } : null,
						show: { delay: 150, duration: 350 },
						hide: { after: duration }
					});
				}
			}
			tool.timer = setTimeout(function () {
				if (opened && host) {
					var t = Q.Tool.from ? Q.Tool.from(host, 'Q/expandable') : null;
					if (t && t.collapse) { t.collapse(); }
				}
				done();
			}, duration);
		}

		if (host) {
			var t = Q.Tool.from ? Q.Tool.from(host, 'Q/expandable') : null;
			if (t && t.expand) {
				opened = true;
				t.expand();
				// The expandable's own animation counts toward the pacing, so
				// the frame's clock starts after it has finished opening.
				return setTimeout(begin, 320);
			}
		}
		begin();
	},

	/**
	 * @method offerBranches
	 */
	offerBranches: function (moment) {
		var tool = this;
		tool.pause();
		$(tool.element).addClass('Q_swimlane_forking');

		var panel = document.createElement('div');
		panel.className = 'Q_swimlane_branches';
		panel.setAttribute('role', 'group');
		panel.setAttribute('aria-label', 'Choose what happens next');

		moment.branches.forEach(function (branch, i) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'Q_swimlane_branch';
			b.setAttribute('data-branch', i);
			b.textContent = branch.label || ('Option ' + (i + 1));
			panel.appendChild(b);
		});

		var anchor = tool.element.querySelector(
			'[data-moment="' + moment.ordinal + '"]');
		if (!anchor) { return; }
		anchor.parentNode.insertBefore(panel, anchor.nextSibling);

		$(panel).on(Q.Pointer.fastclick, '.Q_swimlane_branch', function () {
			var index = parseInt(this.getAttribute('data-branch'), 10);
			tool.chooseBranch(moment, index);
			panel.remove();
		});
	},

	/**
	 * Take a branch. The unchosen arm stays in the data.
	 * @method chooseBranch
	 */
	chooseBranch: function (moment, index) {
		var tool = this;
		tool.chosen = tool.chosen || {};
		tool.chosen[moment.ordinal] = index;
		$(tool.element).removeClass('Q_swimlane_forking');
		Q.handle(tool.state.onBranch, tool, [moment, index]);
		tool.refresh();
		requestAnimationFrame(function () { tool.play(); });
	},

	/**
	 * @method focusMoment
	 */
	focusMoment: function (moment) {
		var tool = this;
		if (!moment) { return; }

		$('.Q_swimlane_current', tool.element).removeClass('Q_swimlane_current');
		$('[data-moment="' + moment.ordinal + '"]', tool.element)
			.addClass('Q_swimlane_current');

		if (tool.$bar) {
			tool.$bar.find('.Q_swimlane_dot').each(function () {
				var at = parseInt(this.getAttribute('data-moment'), 10) === moment.ordinal;
				this.classList.toggle('Q_swimlane_at', at);
			});
		}

		var node = tool.element.querySelector(
			'.Q_swimlane_node[data-moment="' + moment.ordinal + '"]');
		// It may currently be unmounted; scrolling to a placeholder would
		// centre an empty box.
		if (node) { tool.mount(node); }
		if (node && node.scrollIntoView) {
			node.scrollIntoView({
				behavior: prefersReducedMotion() ? 'auto' : 'smooth',
				block: 'center'
			});
		}
	},

	/**
	 * @method collapseAll
	 */
	collapseAll: function () {
		var tool = this;
		for (var id in tool.expandables) {
			var t = Q.Tool.from
				? Q.Tool.from(tool.expandables[id], 'Q/expandable') : null;
			if (t && t.collapse) { t.collapse(); }
		}
	},

	// ---- export ---------------------------------------------------------

	/**
	 * A self-contained SVG of the whole journey.
	 *
	 * The disclaimer is composed into the document rather than sitting beside
	 * it, because an exported file is exactly the artifact that turns up in a
	 * conversation months later without its context.
	 *
	 * @method exportSvg
	 * @param {Object} [options]
	 * @param {Number} [options.width=1000]
	 * @param {Number} [options.columns] actors per row
	 * @return {String}
	 */
	exportSvg: function (options) {
		var tool = this;
		tool.mountAll();   // nothing may be virtualized away mid-read

		var o = Q.extend({ width: 1000, gap: 24, pad: 32 }, options);
		var moments = tool.visibleMoments();
		var actors = (tool.state.actors || []).map(function (a) { return a.userId; });
		var columns = o.columns || Math.max(1, Math.min(actors.length, 4));
		var cellW = Math.floor((o.width - o.pad * 2 - o.gap * (columns - 1)) / columns);

		var parts = [];
		var y = o.pad + 40;

		parts.push('<text x="' + o.pad + '" y="' + o.pad + '" font-size="17"'
			+ ' font-weight="600" fill="#14161a">'
			+ esc(tool.state.title || 'Journey') + '</text>');

		moments.forEach(function (moment) {
			var ids = tool.activeIds(moment);
			if (moment.barrier) {
				parts.push('<line x1="' + o.pad + '" y1="' + y + '" x2="'
					+ (o.width - o.pad) + '" y2="' + y
					+ '" stroke="#d3d7dd" stroke-dasharray="5 5"/>');
				parts.push('<text x="' + (o.width - o.pad) + '" y="' + (y - 5)
					+ '" text-anchor="end" font-size="9" fill="#8b929c">'
					+ esc(moment.barrierLabel || 'sync') + '</text>');
				y += 18;
			}

			var rowH = 0;
			ids.forEach(function (userId, i) {
				var frame = tool.frameFor(moment, userId);
				var col = i % columns;
				var x = o.pad + col * (cellW + o.gap);
				var top = y + Math.floor(i / columns) * (cellW * 0.8 + 44);

				parts.push('<text x="' + x + '" y="' + (top + 9) + '" font-size="9"'
					+ ' font-family="monospace" fill="' + tool.colors[userId] + '">'
					+ String(moment.ordinal).padStart(2, '0') + '  '
					+ esc(tool.nameOf(userId)) + '</text>');

				var svg = tool.nodeSvgFor(moment.ordinal, userId);
				if (svg) {
					parts.push('<g transform="translate(' + x + ',' + (top + 16) + ')">'
						+ scaleSvg(svg, cellW) + '</g>');
				} else {
					parts.push('<rect x="' + x + '" y="' + (top + 16) + '" width="'
						+ cellW + '" height="' + Math.round(cellW * 0.6)
						+ '" rx="6" fill="#f2f3f5" stroke="#e7e9ed"/>');
				}
				var h = Math.round(cellW * 0.6) + 40;
				parts.push('<text x="' + x + '" y="' + (top + 16 + h - 8)
					+ '" font-size="10" fill="#4a5058">'
					+ esc(tool.labelOf(frame)) + '</text>');
				rowH = Math.max(rowH, Math.floor(i / columns) * (cellW * 0.8 + 44) + h);
			});
			y += rowH + 20;
		});

		if (tool.state.disclaimer) {
			y += 8;
			parts.push('<line x1="' + o.pad + '" y1="' + y + '" x2="'
				+ (o.width - o.pad) + '" y2="' + y + '" stroke="#e7e9ed"/>');
			parts.push('<text x="' + o.pad + '" y="' + (y + 18) + '" font-size="10"'
				+ ' fill="#8b929c">' + esc(tool.state.disclaimer) + '</text>');
			y += 30;
		}

		return '<svg xmlns="http://www.w3.org/2000/svg" width="' + o.width
			+ '" height="' + (y + o.pad) + '" viewBox="0 0 ' + o.width + ' '
			+ (y + o.pad) + '"><rect width="100%" height="100%" fill="#fbfbfc"/>'
			+ parts.join('') + '</svg>';
	},

	/**
	 * @method nodeSvgFor
	 */
	nodeSvgFor: function (ordinal, userId) {
		var node = this.element.querySelector(
			'.Q_swimlane_node[data-moment="' + ordinal + '"]'
			+ '[data-userid="' + userId + '"] .Q_swimlane_screen > svg');
		return node ? node.outerHTML : null;
	},

	/**
	 * Trigger a download of the exported SVG.
	 * @method download
	 */
	download: function (filename, options) {
		var blob = new Blob([this.exportSvg(options)], { type: 'image/svg+xml' });
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = filename || 'journey.svg';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
	},

	// ---- helpers --------------------------------------------------------


	/**
	 * Where an arrow or spine should attach for a given node. Returns null
	 * when the node isn't rendered at all.
	 * @method anchorFor
	 */
	anchorFor: function (node, box) {
		var container = node.closest && node.closest('.Q_expandable_container');
		var target = node;
		if (container && !container.classList.contains('Q_expanded')) {
			// Collapsed: point at the title bar, not the hidden content.
			var host = container.parentNode;
			var title = host && host.querySelector('.Q_expandable_title');
			if (!title) { return null; }
			target = title;
		}
		var r = target.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) { return null; }
		return {
			cx: r.left - box.left + r.width / 2,
			top: r.top - box.top,
			bottom: r.bottom - box.top,
			left: r.left - box.left,
			right: r.right - box.left,
			collapsed: target !== node
		};
	},

	frameFor: function (moment, userId) {
		var found = null;
		(moment.frames || []).forEach(function (frame) {
			if (frame.userId === userId) { found = frame; }
		});
		return found || { userId: userId, idle: true, label: 'waiting' };
	},

	primaryId: function (moment, ids) {
		var explicit = null;
		(moment.frames || []).forEach(function (frame) {
			if (frame.primary && ids.indexOf(frame.userId) >= 0) {
				explicit = frame.userId;
			}
		});
		return explicit || ids[0];
	},

	momentOf: function (ordinal) {
		var found = null;
		this.state.moments.forEach(function (m) {
			if (m.ordinal === ordinal) { found = m; }
		});
		return found;
	},

	nameOf: function (userId) {
		var name = userId;
		(this.state.actors || []).forEach(function (a) {
			if (a.userId === userId && a.name) { name = a.name; }
		});
		return name;
	},

	labelOf: function (frame) {
		if (frame.denied) { return 'no access'; }
		if (frame.idle) { return frame.label || 'waiting'; }
		return frame.label || '';
	},

	stripHeight: function () {
		return this.$strip ? this.$strip[0].offsetHeight : 0;
	},

	step: function (node, delta) {
		var nodes = $('.Q_swimlane_node', this.element).toArray();
		var i = nodes.indexOf(node);
		var next = nodes[i + delta];
		if (next) { next.focus(); }
	},

	sibling: function (node, delta) {
		var siblings = $(node).parent().find('.Q_swimlane_node').toArray();
		var i = siblings.indexOf(node);
		var next = siblings[i + delta];
		if (next) { next.focus(); }
	},

	loading: function (on) {
		$(this.element).toggleClass('Q_swimlane_loading', !!on);
	},

	failed: function (message) {
		this.loading(false);
		this.element.innerHTML = '<div class="Q_swimlane_blank">'
			+ Q.htmlEntities(message) + '</div>';
	},

	Q: {
		beforeRemove: function () {
			var tool = this;
			$(tool.element).off('.Q_swimlane');
			$(window).off('resize.Q_swimlane');
			$(window).off('beforeprint.Q_swimlane');
			tool.stopParallax();
			$(document).off('.Q_swimlane_lightbox');
			clearTimeout(tool.timer);
			if (tool.resizeObserver) { tool.resizeObserver.disconnect(); }
			if (tool.observer) { tool.observer.disconnect(); }
		}
	}
});


function playGlyph(playing) {
	return playing
		? '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
			+ '<rect x="3.5" y="2.5" width="3.5" height="11" rx="1" fill="currentColor"/>'
			+ '<rect x="9" y="2.5" width="3.5" height="11" rx="1" fill="currentColor"/></svg>'
		: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
			+ '<path d="M4 2.6 L13 8 L4 13.4 Z" fill="currentColor"/></svg>';
}

function prefersReducedMotion() {
	return window.matchMedia
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function esc(text) {
	return String(text == null ? '' : text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wrap an inline SVG so it lands at a known width inside the export. */
function scaleSvg(svg, width) {
	var m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
	if (!m) { return svg; }
	var k = width / parseFloat(m[1]);
	return '<g transform="scale(' + (Math.round(k * 1000) / 1000) + ')">'
		+ svg.replace(/ width="[^"]*"/, '').replace(/ height="[^"]*"/, '')
		+ '</g>';
}

function svgLayer(className) {
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', className);
	svg.setAttribute('aria-hidden', 'true');
	return svg;
}

function size(svg, box) {
	svg.setAttribute('width', Math.round(box.width));
	svg.setAttribute('height', Math.round(box.height));
	svg.setAttribute('viewBox', '0 0 ' + Math.round(box.width) + ' ' + Math.round(box.height));
}

/** Dashes need to scale with the stroke, or a fat line looks like a solid one. */
function dashFor(width) {
	return ' stroke-dasharray="' + r2(width * 1.6) + ' ' + r2(width * 1.5) + '"';
}

function r2(n) {
	return Math.round(n * 10) / 10;
}

})(Q, Q.jQuery, window);
