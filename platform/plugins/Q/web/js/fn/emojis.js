/* Q/emojis: Two-pane emoji browser with tabs, search, recents, and keyboard-savvy skin popout.
   Data from Q.Text(textName):
   {
     "groups": [ { "name": "Animals", "emojis": { "🪿": "Duck", ... } }, ... ],
     "skins":  { "👍": "👍🏻👍🏼👍🏽👍🏾👍🏿", ... }
   }
*/
Q.Tool.define("Q/emojis", function (options) {
	"use strict";
	var tool = this;
	var o = tool.options;
	var st = tool.state;

	/* ----- State ----- */
	st.data = { groups: [], skins: {} };
	st.activeIndex = 0;         // which group is active
	st.query = "";
	st.recents = { max: (o.recents && o.recents.max) || 12, list: [] };
	st.pop = { el: null, openFor: null, focusedIdx: 0 }; // popout focus index

	/* Load recents */
	try {
		var saved = localStorage["Q/emojis"];
		if (saved) {
			var parsed = JSON.parse(saved);
			if (parsed && parsed.recents && parsed.recents.length) {
				st.recents.list = parsed.recents.slice(0, st.recents.max);
			}
		}
	} catch (e) {}

	/* ----- DOM ----- */
	var root = tool.element;
	if (root.className.indexOf("Q_emojis_root") === -1) {
		root.className += (root.className ? " " : "") + "Q_emojis_root";
	}
	root.innerHTML =
		'<div class="Q_emojis_wrap">' +
			'<div class="Q_emojis_tabs" role="tablist" aria-orientation="vertical"></div>' +
			'<div class="Q_emojis_main">' +
				(o.showSearch ? '<div class="Q_emojis_head"><input type="search" class="Q_emojis_search" placeholder="Search emojis..." aria-label="Search emojis" /></div>' : '') +
				(o.showRecents ? '<div class="Q_emojis_section Q_emojis_recents" style="display:none"><div class="Q_emojis_title">Recent</div><div class="Q_emojis_grid" role="grid" aria-label="Recent emojis"></div></div>' : '') +
				'<div class="Q_emojis_section Q_emojis_current"><div class="Q_emojis_title" aria-live="polite"></div><div class="Q_emojis_grid" role="grid" aria-label="Emojis"></div></div>' +
			'</div>' +
		'</div>';

	var dom = {
		tabs: root.querySelector(".Q_emojis_tabs"),
		main: root.querySelector(".Q_emojis_main"),
		search: root.querySelector(".Q_emojis_search"),
		recentsSection: root.querySelector(".Q_emojis_recents"),
		recentsGrid: root.querySelector(".Q_emojis_recents .Q_emojis_grid"),
		currentTitle: root.querySelector(".Q_emojis_current .Q_emojis_title"),
		currentGrid: root.querySelector(".Q_emojis_current .Q_emojis_grid")
	};

	/* ----- Utils ----- */
	function saveRecents() {
		try {
			localStorage["Q/emojis"] = JSON.stringify({ recents: st.recents.list, version: 3 });
		} catch (e) {}
	}
	function addRecent(ch) {
		var L = st.recents.list.slice(0);
		var k = L.indexOf(ch);
		if (k !== -1) L.splice(k, 1);
		L.unshift(ch);
		if (L.length > st.recents.max) L = L.slice(0, st.recents.max);
		st.recents.list = L;
		saveRecents();
		renderRecents();
	}
	function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
	function escapeHtml(s) {
		return String(s).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; });
	}
	function hasSkins(base) { return !!st.data.skins[base]; }

	/* Skin tone constants: base + 5 modifiers (light->dark) */
	var TONES = ["\uD83C\uDFFB", "\uD83C\uDFFC", "\uD83C\uDFFD", "\uD83C\uDFFE", "\uD83C\uDFFF"];
	function buildSkinVariants(base) {
		var arr = [base];
		for (var i = 0; i < TONES.length; i++) arr.push(base + TONES[i]);
		return arr;
	}

	/* Compute columns of current grid for keyboard step */
	function gridCols(gridEl) {
		var btns = gridEl.querySelectorAll(".Q_emojis_btn");
		if (!btns.length) return 1;
		var first = btns[0].getBoundingClientRect();
		var second = null;
		for (var i = 1; i < btns.length; i++) {
			var r = btns[i].getBoundingClientRect();
			if (Math.abs(r.top - first.top) < 2) { second = r; break; }
		}
		var cell = second ? (second.left - first.left) : (first.width + 8);
		if (cell <= 1) return 8; // fallback
		var gw = gridEl.getBoundingClientRect().width;
		return Math.max(1, Math.floor(gw / cell));
	}

	/* Focus helpers for roving tabindex in grids */
	function setGridFocus(gridEl, idx) {
		var btns = gridEl.querySelectorAll(".Q_emojis_btn");
		if (!btns.length) return;
		if (idx < 0) idx = 0;
		if (idx >= btns.length) idx = btns.length - 1;
		for (var i = 0; i < btns.length; i++) btns[i].setAttribute("tabindex", i === idx ? "0" : "-1");
		btns[idx].focus();
	}
	function focusFirst(gridEl) { setGridFocus(gridEl, 0); }

	/* ----- Rendering ----- */
	function renderTabs() {
		var html = [];
		for (var i = 0; i < st.data.groups.length; i++) {
			var g = st.data.groups[i];
			html.push(
				'<button class="Q_emojis_tab' + (i === st.activeIndex ? ' Q_emojis_tab_active' : '') +
				'" role="tab" aria-selected="' + (i === st.activeIndex ? 'true' : 'false') + '" data-idx="' + i + '"' +
				' tabindex="' + (i === st.activeIndex ? '0' : '-1') + '"' +
				' title="' + escapeAttr(g.name) + '">' + escapeHtml(g.name) + '</button>'
			);
		}
		dom.tabs.innerHTML = html.join("");
	}

	function currentGroup() { return st.data.groups[st.activeIndex] || null; }

	function filterKeys(obj, q) {
		if (!q) return Object.keys(obj);
		var out = [], ql = String(q).toLowerCase();
		for (var k in obj) if (obj.hasOwnProperty(k)) {
			var label = obj[k] || "";
			if (String(label).toLowerCase().indexOf(ql) !== -1) out.push(k);
		}
		return out;
	}

	function renderRecents() {
		if (!dom.recentsSection) return;
		var L = st.recents.list;
		if (!L.length) {
			dom.recentsSection.style.display = "none";
			dom.recentsGrid.innerHTML = "";
			return;
		}
		dom.recentsSection.style.display = "";
		var html = [];
		for (var i = 0; i < L.length; i++) {
			var ch = L[i];
			html.push('<button class="Q_emojis_btn" role="button" tabindex="' + (i === 0 ? '0' : '-1') + '" data-e="' + ch + '">' + ch + '</button>');
		}
		dom.recentsGrid.innerHTML = html.join("");
	}

	function renderCurrent() {
		var g = currentGroup();
		if (!g) {
			dom.currentTitle.innerHTML = "";
			dom.currentGrid.innerHTML = "";
			return;
		}
		dom.currentTitle.innerHTML = escapeHtml(g.name);
		var keys = filterKeys(g.emojis || {}, st.query);
		if (o.maxPerGroup && keys.length > o.maxPerGroup) keys = keys.slice(0, o.maxPerGroup);

		var html = [];
		for (var i = 0; i < keys.length; i++) {
			var ch = keys[i];
			var title = g.emojis[ch] || "";
			var hs = hasSkins(ch);
			html.push(
				'<button class="Q_emojis_btn' + (hs ? ' Q_emojis_btn_skins' : '') + '" role="button" tabindex="' + (i === 0 ? '0' : '-1') + '"' +
				' data-e="' + ch + '"' + (title ? ' title="' + escapeAttr(title) + '"' : '') + '>' + ch + '</button>'
			);
		}
		dom.currentGrid.innerHTML = html.join("");
	}

	/* ----- Popout ----- */
	function ensurePop() {
		if (st.pop.el) return st.pop.el;
		var pop = document.createElement("div");
		pop.className = "Q_emojis_pop";
		pop.innerHTML =
			'<div class="Q_emojis_pop_inner" role="dialog" aria-label="Choose skin tone">' +
				'<button class="Q_emojis_pop_x" type="button" aria-label="Close">×</button>' +
				'<div class="Q_emojis_pop_grid" role="grid" aria-label="Skin tones"></div>' +
			'</div>';
		dom.main.appendChild(pop);
		st.pop.el = pop;

		/* Keyboard in pop */
		pop.addEventListener("keydown", function (ev) {
			if (st.pop.el.style.display !== "block") return;
			var key = ev.key;
			var btns = pop.querySelectorAll(".Q_emojis_pop_btn");
			if (!btns.length) return;

			var cols = 6; // pop grid is fixed to 6 columns via CSS
			var idx = st.pop.focusedIdx || 0;

			if (key === "ArrowRight") { idx = Math.min(btns.length - 1, idx + 1); ev.preventDefault(); }
			else if (key === "ArrowLeft") { idx = Math.max(0, idx - 1); ev.preventDefault(); }
			else if (key === "ArrowDown") { idx = Math.min(btns.length - 1, idx + cols); ev.preventDefault(); }
			else if (key === "ArrowUp") { idx = Math.max(0, idx - cols); ev.preventDefault(); }
			else if (key === "Home") { idx = 0; ev.preventDefault(); }
			else if (key === "End") { idx = btns.length - 1; ev.preventDefault(); }
			else if (key === "Escape") { hidePop(); ev.preventDefault(); return; }
			else if (key === "Enter" || key === " ") {
				var chosen = btns[idx].getAttribute("data-e");
				hidePop();
				addRecent(chosen);
				tool.state.onChoose.handle(chosen);
				ev.preventDefault();
				return;
			} else { return; }

			st.pop.focusedIdx = idx;
			for (var i = 0; i < btns.length; i++) btns[i].setAttribute("tabindex", i === idx ? "0" : "-1");
			btns[idx].focus();
		}, false);

		return pop;
	}

	function hidePop() {
		if (!st.pop.el) return;
		st.pop.el.style.display = "none";
		st.pop.openFor = null;
	}

	function showPop(triggerBtn, baseEmoji) {
		var pop = ensurePop();

		/* Build variants (base first, then tones) */
		var variants = buildSkinVariants(baseEmoji);
		var html = [];
		for (var i = 0; i < variants.length; i++) {
			var ch = variants[i];
			html.push('<button class="Q_emojis_pop_btn" role="button" tabindex="' + (i === 0 ? '0' : '-1') + '" data-e="' + ch + '">' + ch + '</button>');
		}
		pop.querySelector(".Q_emojis_pop_grid").innerHTML = html.join("");
		st.pop.focusedIdx = 0;

		/* Visible for measurement */
		pop.style.display = "block";
		pop.style.left = "0px";
		pop.style.top = "0px";

		/* Clamp inside main */
		var mainRect = dom.main.getBoundingClientRect();
		var btnRect = triggerBtn.getBoundingClientRect();
		var popRect = pop.getBoundingClientRect();

		var centerX = btnRect.left + btnRect.width / 2;
		var desiredLeft = centerX - popRect.width / 2;
		var aboveTop = btnRect.top - popRect.height - 8;
		var belowTop = btnRect.bottom + 8;

		var left = Math.max(mainRect.left + 8, Math.min(desiredLeft, mainRect.right - popRect.width - 8));
		var top = aboveTop;
		if (top < mainRect.top + 8) top = Math.min(belowTop, mainRect.bottom - popRect.height - 8);

		var mainRect2 = dom.main.getBoundingClientRect();
		var finalLeft = left - mainRect2.left + dom.main.scrollLeft;
		var finalTop = top - mainRect2.top + dom.main.scrollTop;
		if (finalLeft < 0) finalLeft = 0;
		if (finalTop < 0) finalTop = 0;

		pop.style.left = finalLeft + "px";
		pop.style.top = finalTop + "px";

		/* Focus first pop button for keyboard flow */
		var firstBtn = pop.querySelector(".Q_emojis_pop_btn");
		if (firstBtn) firstBtn.focus();

		st.pop.openFor = baseEmoji;
	}

	/* ----- Events: mouse + keyboard ----- */

	/* Tabs: click */
	dom.tabs.addEventListener("click", function (ev) {
		var t = ev.target && ev.target.closest ? ev.target.closest(".Q_emojis_tab") : null;
		if (!t) return;
		var idx = parseInt(t.getAttribute("data-idx"), 10) || 0;
		if (idx === st.activeIndex) return;
		st.activeIndex = idx;
		renderTabs(); renderCurrent(); hidePop();
		// Move focus to first emoji in new grid for accessibility
		setTimeout(function () { focusFirst(dom.currentGrid); }, 0);
	}, false);

	/* Tabs: keyboard (↑/↓/Home/End, Enter/Space) */
	dom.tabs.addEventListener("keydown", function (ev) {
		var tabs = dom.tabs.querySelectorAll(".Q_emojis_tab");
		if (!tabs.length) return;
		var active = st.activeIndex;
		var key = ev.key;

		if (key === "ArrowDown") { active = Math.min(tabs.length - 1, active + 1); ev.preventDefault(); }
		else if (key === "ArrowUp") { active = Math.max(0, active - 1); ev.preventDefault(); }
		else if (key === "Home") { active = 0; ev.preventDefault(); }
		else if (key === "End") { active = tabs.length - 1; ev.preventDefault(); }
		else if (key === "Enter" || key === " ") {
			// Activate currently focused tab (already equals st.activeIndex due to roving tabindex)
			ev.preventDefault();
			setTimeout(function () { focusFirst(dom.currentGrid); }, 0);
			return;
		} else { return; }

		st.activeIndex = active;
		renderTabs(); renderCurrent(); hidePop();
		// Focus selected tab (roving tabindex)
		var nt = dom.tabs.querySelector('.Q_emojis_tab[data-idx="' + active + '"]');
		if (nt) nt.focus();
	}, false);

	/* Grid clicks / selection */
	dom.main.addEventListener("click", function (ev) {
		var target = ev.target;

		/* Close pop */
		if (target && target.classList && target.classList.contains("Q_emojis_pop_x")) { hidePop(); return; }

		/* Choose in pop */
		if (target && target.classList && target.classList.contains("Q_emojis_pop_btn")) {
			var chp = target.getAttribute("data-e");
			hidePop(); addRecent(chp); tool.state.onChoose.handle(chp);
			return;
		}

		/* Grid button */
		var btn = target && target.closest ? target.closest(".Q_emojis_btn") : null;
		if (!btn) return;
		var ch = btn.getAttribute("data-e");
		if (hasSkins(ch)) { showPop(btn, ch); return; }
		addRecent(ch); tool.state.onChoose.handle(ch);
	}, false);

	/* Clicking outside pop closes it */
	document.addEventListener("click", function (ev) {
		if (!st.pop.el || st.pop.el.style.display !== "block") return;
		if (ev.target.closest && (ev.target.closest(".Q_emojis_pop") || ev.target.closest(".Q_emojis_btn.Q_emojis_btn_skins"))) return;
		hidePop();
	}, false);

	/* Hide pop on scroll */
	dom.main.addEventListener("scroll", function () { hidePop(); }, false);

	/* Grid keyboard navigation */
	function handleGridKey(ev, gridEl) {
		var btns = gridEl.querySelectorAll(".Q_emojis_btn");
		if (!btns.length) return;
		var key = ev.key;
		var current = document.activeElement;
		var idx = Array.prototype.indexOf.call(btns, current);
		if (idx < 0) idx = 0;

		var cols = gridCols(gridEl);
		var next = idx;

		if (key === "ArrowRight") { next = Math.min(btns.length - 1, idx + 1); ev.preventDefault(); }
		else if (key === "ArrowLeft") { next = Math.max(0, idx - 1); ev.preventDefault(); }
		else if (key === "ArrowDown") { next = Math.min(btns.length - 1, idx + cols); ev.preventDefault(); }
		else if (key === "ArrowUp") { next = Math.max(0, idx - cols); ev.preventDefault(); }
		else if (key === "Home") { next = 0; ev.preventDefault(); }
		else if (key === "End") { next = btns.length - 1; ev.preventDefault(); }
		else if (key === "PageDown") { next = Math.min(btns.length - 1, idx + cols * 3); ev.preventDefault(); }
		else if (key === "PageUp") { next = Math.max(0, idx - cols * 3); ev.preventDefault(); }
		else if (key === "Escape") { hidePop(); ev.preventDefault(); return; }
		else if (key === "Enter" || key === " ") {
			var ch = current.getAttribute("data-e");
			if (hasSkins(ch)) { showPop(current, ch); }
			else { addRecent(ch); tool.state.onChoose.handle(ch); }
			ev.preventDefault();
			return;
		} else { return; }

		setGridFocus(gridEl, next);
	}

	/* Keydown bindings for grids */
	dom.currentGrid.addEventListener("keydown", function (ev) { handleGridKey(ev, dom.currentGrid); }, false);
	if (dom.recentsGrid) {
		dom.recentsGrid.addEventListener("keydown", function (ev) { handleGridKey(ev, dom.recentsGrid); }, false);
	}

	/* Search input (debounced) */
	if (dom.search) {
		dom.search.addEventListener("input", Q.debounce(function () {
			st.query = dom.search.value || "";
			renderCurrent(); hidePop();
			// shift focus back to first match for quick keyboard flow
			setTimeout(function () { focusFirst(dom.currentGrid); }, 0);
		}, false), false);
	}

	/* Resize: recompute layout-dependent nav and clamp any open pop */
	window.addEventListener("resize", Q.debounce(function () {
		if (st.pop.el && st.pop.el.style.display === "block" && st.pop.openFor) {
			// Reposition around the currently focused base (find it)
			var btn = dom.currentGrid.querySelector('.Q_emojis_btn[data-e="' + st.pop.openFor + '"]');
			if (btn) showPop(btn, st.pop.openFor);
		}
	}, true), false);

	/* ----- Load data and initial render ----- */
	Q.Text.get(o.textName || "Q/emojis", function (err, text) {
		if (err) { st.data = { groups: [], skins: {} }; }
		else {
			try {
				var data = (typeof text === "string") ? JSON.parse(text) : text;
				st.data.groups = data.groups || data.categories || [];
				st.data.skins = data.skins || {};
			} catch (e) { st.data = { groups: [], skins: {} }; }
		}
		renderTabs(); renderRecents(); renderCurrent();
		// Initial focus: first tab, then first emoji for fast keyboard use
		var firstTab = dom.tabs.querySelector('.Q_emojis_tab[data-idx="0"]');
		if (firstTab) firstTab.focus();
		setTimeout(function () { focusFirst(dom.currentGrid); }, 0);
	});

	tool.refresh();

}, {
	/* Options (no defaults/here) */
	textName: "Q/emojis",
	showSearch: true,
	showRecents: true,
	recents: { max: 12 },
	maxPerGroup: 0,
	onChoose: new Q.Event()
}, {
	refresh: function () {
		/* Rendering is event-driven */
	}
});