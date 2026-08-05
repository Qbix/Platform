#!/usr/bin/env node
"use strict";

/*
 * SMTP relay / gateway
 * ====================
 *
 * Listens on localhost, relays to an upstream SMTP server (e.g. SES),
 * logs every message, and enforces rate limits.
 *
 * WHAT CHANGED FROM THE PREVIOUS VERSION
 * --------------------------------------
 * 1. flushDigest() reset the digest under the wrong key (`rcpt` instead of
 *    `rcpt|mailFrom`), so accumulated parts were never cleared and every
 *    flush re-sent everything plus whatever had arrived since. Unbounded
 *    amplification. Fixed: one key helper, used everywhere.
 * 2. The outbound client hung all its work off sock.once("secureConnect"),
 *    which never fires on a plain socket -- so the STARTTLS path (port 587)
 *    was dead code. Rewritten as a small client class that handles plain,
 *    implicit-TLS, and STARTTLS.
 * 3. AUTH parsing called an undefined bare toUpperCase(), throwing on a bare
 *    "AUTH"; the mechanism was never case-folded either.
 * 4. LISTEN_HOST defaulted to 0.0.0.0 with auth optional -- an open relay if
 *    the port was reachable. Now defaults to 127.0.0.1 and refuses to bind a
 *    non-loopback address without auth configured.
 * 5. RCPT rejected a second recipient with 452. Now accepts up to
 *    MAX_RECIPIENTS.
 * 6. Digesting is now OFF by default (DIGEST=true to enable). Digesting
 *    delays and batches mail, which is right for notification fan-out and
 *    wrong for password resets and login codes.
 * 7. Added: token-bucket rate limit, hourly circuit breaker, per-message
 *    logging (from / to / subject / message-id / bytes / outcome), bounded
 *    retry, session-count guard, quoted-printable header no longer claimed
 *    for content that isn't encoded.
 *
 * CONFIG (env or .env; CLI --flags override)
 * ------------------------------------------
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 *   SMTP_SECURE=true         implicit TLS (port 465)
 *   SMTP_STARTTLS=true       upgrade after EHLO (port 587)
 *   LISTEN_HOST=127.0.0.1    LISTEN_PORT=2525
 *   LISTEN_USER / LISTEN_PASS   require AUTH from local clients (optional)
 *   DEFAULT_FROM             envelope sender when a client omits one
 *   SES_CONFIG_SET           adds X-SES-CONFIGURATION-SET
 *   MAX_PER_MINUTE=60        token bucket toward upstream
 *   MAX_PER_HOUR=1000        circuit breaker; trips and stops relaying
 *   DIGEST=false             batch repeat mail per recipient
 *   LOG_FILE                 JSON lines; stdout if unset
 */

const fs = require("fs");
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const readline = require("readline");

/* ------------------------------------------------------------------ *
 * Args and env
 * ------------------------------------------------------------------ */

const ARGS = {};
process.argv.slice(2).forEach((a, i, arr) => {
	if (!a.startsWith("--")) return;
	const key = a.slice(2);
	const next = arr[i + 1];
	ARGS[key] = next && !next.startsWith("--") ? next : true;
});

function loadEnv(path) {
	if (!fs.existsSync(path)) return;
	for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
		const m = line.match(/^([\w_]+)=(.*)$/);
		if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
	}
}
loadEnv(ARGS.env || ".env");

function str(name, flag, dflt) {
	const v = ARGS[flag] !== undefined ? ARGS[flag] : process.env[name];
	return v === undefined || v === "" ? dflt : String(v);
}
function strAllowEmpty(name, flag, dflt) {
	const v = (flag && ARGS[flag] !== undefined) ? ARGS[flag] : process.env[name];
	return v === undefined ? dflt : String(v);
}
function num(name, flag, dflt) {
	const v = str(name, flag, null);
	if (v === null) return dflt;
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : dflt;
}
function bool(name, flag, dflt) {
	const v = ARGS[flag] !== undefined ? ARGS[flag] : process.env[name];
	if (v === undefined || v === "") return dflt;
	return v === true || /^(1|true|yes|on)$/i.test(String(v));
}

const CFG = {
	listenHost: str("LISTEN_HOST", "listen-host", "127.0.0.1"),
	listenPort: num("LISTEN_PORT", "listen-port", 2525),
	listenTlsPort: num("LISTEN_PORT_TLS", "listen-tls-port", 0), // 0 = disabled
	listenUser: str("LISTEN_USER", "listen-user", null),
	listenPass: str("LISTEN_PASS", "listen-pass", null),

	sslKeyPath: str("SSL_KEY", "key", null),
	sslCertPath: str("SSL_CERT", "cert", null),

	smtpHost: str("SMTP_HOST", "smtp-host", null),
	smtpPort: num("SMTP_PORT", "smtp-port", 587),
	smtpUser: str("SMTP_USER", "user", null),
	smtpPass: str("SMTP_PASSWORD", null, null),
	smtpSecure: bool("SMTP_SECURE", "smtp-secure", false),
	smtpStartTls: bool("SMTP_STARTTLS", "smtp-starttls", false),
	smtpIgnoreCert: bool("SMTP_IGNORE_CERT_ERRORS", null, false),

	defaultFrom: str("DEFAULT_FROM", "default-from", null),
	sesConfigSet: str("SES_CONFIG_SET", "ses-config-set", null),

	maxPerMinute: num("MAX_PER_MINUTE", "max-per-minute", 60),
	maxPerHour: num("MAX_PER_HOUR", "max-per-hour", 1000),

	maxSize: num("MAX_SIZE", "max-size", 25 * 1024 * 1024),
	maxLines: num("MAX_LINES", "max-lines", 200000),
	maxRecipients: num("MAX_RECIPIENTS", "max-recipients", 50),
	maxConcurrent: num("CONCURRENCY", "concurrency", 50),
	sessionTimeout: num("TIMEOUT", "timeout", 300000),
	smtpTimeout: num("SMTP_TIMEOUT", "smtp-timeout", 30000),

	retries: num("RETRIES", "retries", 2),
	retryDelay: num("RETRY_DELAY", "retry-delay", 5000),

	digest: bool("DIGEST", "digest", false),
	digestFirstDelay: num("DELAY_FIRST", "first-delay", 60000),
	digestBackoff: num("BACKOFF", "backoff", 2.0),
	digestMaxDelay: num("DELAY_MAX", "max-delay", 3600000),
	digestMaxMessages: num("MAX_MESSAGES", "max-messages-per-digest", 20),
	digestCooldownMin: num("COOLDOWN_MINUTES", "cooldown-minutes", 30),
	digestSubject: str("SUBJECT_TEMPLATE", "subject", "{{count}} Updates"),
	digestBypassHeader: str("DIGEST_BYPASS_HEADER", null, "x-no-digest"),
	digestAscending: bool("DIGEST_TIME_ASCENDING", "digest-ascending", true),

	// Templates, not plain strings. See renderSeparator().
	sepText: strAllowEmpty("SEPARATOR_TEXT", "separator-text",
		"\n\n----- {{subject}} \u00b7 {{datetime}} -----\n\n"),
	sepHtml: strAllowEmpty("SEPARATOR_HTML", "separator-html",
		'<div style="margin:24px 0 8px;padding:6px 0;border-top:1px solid #ddd;' +
		'font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#666">' +
		'<strong style="color:#333">{{subject}}</strong><br>{{datetime}}</div>'),
	sepFirst: bool("SEPARATOR_FIRST", "separator-first", true),
	locale: str("LOCALE", "locale", "en-US"),
	timezone: str("TZ_DISPLAY", "timezone", null),
	maxAttachSize: num("MAX_ATTACHMENT_SIZE", "max-attachment-size", 5 * 1024 * 1024),
	maxTotalAttach: num("MAX_TOTAL_ATTACH", "max-total-attachments", 10 * 1024 * 1024),
	globalMemoryCap: num("GLOBAL_MEMORY_CAP", "global-memory-cap", 100 * 1024 * 1024),
	omitFormat: str("OMITTED_FORMAT", "omitted-format",
		"+ {{N}} messages omitted ({{A}} attachments, {{S}} bytes)"),

	logFile: str("LOG_FILE", "log-file", null),
	logLevel: str("LOG_LEVEL", "log-level", "info")
};

/* ------------------------------------------------------------------ *
 * Logging
 * ------------------------------------------------------------------ */

const LEVELS = { debug: 1, info: 2, warn: 3, error: 4 };
let LOG_FD = null;

function openLog() {
	if (CFG.logFile && LOG_FD === null) LOG_FD = fs.openSync(CFG.logFile, "a");
}

function log(level, obj) {
	if (LEVELS[level] < LEVELS[CFG.logLevel]) return;
	const line = JSON.stringify(Object.assign({
		ts: new Date().toISOString(),
		level
	}, obj)) + "\n";
	if (LOG_FD !== null) {
		try { fs.writeSync(LOG_FD, line); } catch (e) { process.stdout.write(line); }
	} else {
		process.stdout.write(line);
	}
}

const metrics = {
	msg_in: 0, msg_out: 0, msg_failed: 0, digest_sent: 0,
	omit_msg: 0, attach_forwarded: 0, attach_dropped: 0,
	rate_limited: 0, breaker_trips: 0
};

/* ------------------------------------------------------------------ *
 * Rate limiting and circuit breaker
 *
 * The point of both: on 2026-08-03 an unexplained 34,000 messages left in a
 * few hours. A token bucket makes that physically slow; the hourly breaker
 * makes it stop. Recovery is manual and deliberate.
 * ------------------------------------------------------------------ */

const limiter = {
	tokens: CFG.maxPerMinute,
	last: Date.now(),
	hourWindow: [],
	tripped: false,

	refill() {
		const now = Date.now();
		const gained = ((now - this.last) / 60000) * CFG.maxPerMinute;
		if (gained > 0) {
			this.tokens = Math.min(CFG.maxPerMinute, this.tokens + gained);
			this.last = now;
		}
	},

	// Returns ms to wait, or -1 if the breaker has tripped.
	acquire() {
		if (this.tripped) return -1;

		const now = Date.now();
		this.hourWindow = this.hourWindow.filter(t => now - t < 3600000);
		if (this.hourWindow.length >= CFG.maxPerHour) {
			this.tripped = true;
			metrics.breaker_trips++;
			log("error", {
				msg: "circuit_breaker_tripped",
				sent_last_hour: this.hourWindow.length,
				limit: CFG.maxPerHour,
				note: "relaying halted; restart or send SIGHUP to reset"
			});
			return -1;
		}

		this.refill();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			this.hourWindow.push(now);
			return 0;
		}
		metrics.rate_limited++;
		return Math.ceil(((1 - this.tokens) / CFG.maxPerMinute) * 60000);
	},

	reset() {
		this.tripped = false;
		this.hourWindow = [];
		this.tokens = CFG.maxPerMinute;
		log("warn", { msg: "circuit_breaker_reset" });
	}
};

process.on("SIGHUP", () => limiter.reset());

function waitForSlot() {
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const wait = limiter.acquire();
			if (wait < 0) return reject(new Error("circuit breaker tripped"));
			if (wait === 0) return resolve();
			setTimeout(attempt, Math.min(wait, 5000));
		};
		attempt();
	});
}

/* ------------------------------------------------------------------ *
 * Byte-level helpers: DATA terminator, dot-stuffing
 * ------------------------------------------------------------------ */

// Detects the CRLF "." CRLF terminator, including the edge case where the
// message body is empty and the client sends ".\r\n" as the very first bytes.
class DotTerminatorScanner {
	constructor() {
		this.tail = Buffer.alloc(0);
		this.total = 0;
	}
	push(chunk) {
		this.tail = Buffer.concat([this.tail, chunk]);
		this.total += chunk.length;
		if (this.tail.length > 5) this.tail = this.tail.slice(this.tail.length - 5);
	}
	isTerminated() {
		const w = this.tail;
		if (this.total === 3 && w.length === 3) {
			return w[0] === 46 && w[1] === 13 && w[2] === 10; // ".\r\n"
		}
		if (w.length < 5) return false;
		return w[0] === 13 && w[1] === 10 && w[2] === 46 && w[3] === 13 && w[4] === 10;
	}
}

// RFC 5321: a line beginning with "." had one dot prepended by the sender.
// Strip exactly one leading dot per line. Byte-preserving otherwise.
function inboundDotUnstuff(buf) {
	const out = Buffer.allocUnsafe(buf.length);
	let o = 0;
	let atLineStart = true;
	for (let i = 0; i < buf.length; i++) {
		const b = buf[i];
		if (atLineStart && b === 46) {
			atLineStart = false;
			continue; // drop the stuffed dot
		}
		out[o++] = b;
		atLineStart = (b === 10);
	}
	return out.slice(0, o);
}

function outboundDotStuff(s) {
	if (s.startsWith(".")) s = "." + s;
	return s.replace(/\r\n\./g, "\r\n..");
}

/* ------------------------------------------------------------------ *
 * Header parsing (used for logging and for MIME work)
 * ------------------------------------------------------------------ */

function decodeRFC2047(s) {
	return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
		try {
			let buf;
			if (enc.toUpperCase() === "B") {
				buf = Buffer.from(text, "base64");
			} else {
				const qp = text.replace(/_/g, " ")
					.replace(/=([A-Fa-f0-9]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
				buf = Buffer.from(qp, "binary");
			}
			return buf.toString("utf8");
		} catch (e) {
			return whole;
		}
	});
}

function splitHeaderBody(raw) {
	let idx = 0;
	while (idx < raw.length) {
		const end = raw.indexOf("\n", idx);
		if (end === -1) break;
		const line = raw.slice(idx, end).replace(/\r$/, "");
		if (line === "") return { headersRaw: raw.slice(0, idx), body: raw.slice(end + 1) };
		idx = end + 1;
	}
	return { headersRaw: raw, body: "" };
}

function parseHeaders(raw) {
	const headers = {};
	let last = null;
	for (const line of raw.split(/\r?\n/)) {
		if (/^[ \t]/.test(line)) {
			if (last && headers[last].length) {
				headers[last][headers[last].length - 1] += " " + line.trim();
			}
			continue;
		}
		const m = line.match(/^([^:]+):\s*(.*)$/);
		if (m) {
			const key = m[1].toLowerCase().trim();
			if (!headers[key]) headers[key] = [];
			headers[key].push(m[2]);
			last = key;
		} else {
			last = null;
		}
	}
	return headers;
}

function headerValue(headers, name) {
	const v = headers[name.toLowerCase()];
	return v && v.length ? decodeRFC2047(v[0]) : null;
}

/* ------------------------------------------------------------------ *
 * MIME parsing (digest mode only)
 * ------------------------------------------------------------------ */

function extractBoundary(contentType) {
	if (!contentType) return null;
	const m = contentType.match(/boundary\s*=\s*("?)([^";]+)\1/i);
	return m ? m[2].trim() : null;
}

function splitMultipart(body, boundary) {
	const marker = "--" + boundary;
	const final = "--" + boundary + "--";
	const lines = body.replace(/\r?\n/g, "\n").split("\n");
	const parts = [];
	let current = [];
	let inPart = false;
	for (const line of lines) {
		if (line === marker) {
			if (inPart) parts.push(current.join("\r\n"));
			current = [];
			inPart = true;
			continue;
		}
		if (line === final) {
			if (inPart) parts.push(current.join("\r\n"));
			return parts;
		}
		if (inPart) current.push(line);
	}
	if (inPart) parts.push(current.join("\r\n"));
	return parts;
}

function extractFilename(headers) {
	const cd = headers["content-disposition"] ? headers["content-disposition"][0] : null;
	if (cd) {
		const m = cd.match(/filename\*?=([^;]+)/i);
		if (m) {
			let fn = m[1].trim().replace(/^"(.*)"$/, "$1");
			if (/^utf-8''/i.test(fn)) {
				try { fn = decodeURIComponent(fn.slice(7)); } catch (e) { /* keep raw */ }
			}
			return fn;
		}
	}
	const ct = headers["content-type"] ? headers["content-type"][0] : null;
	if (ct) {
		const m = ct.match(/name="?([^";]+)"?/i);
		if (m) return m[1].trim();
	}
	return "attachment";
}

function decodeQuotedPrintable(qp) {
	qp = qp.replace(/=\r?\n/g, "");
	const out = [];
	for (let i = 0; i < qp.length; i++) {
		if (qp[i] === "=") {
			const h = qp.substr(i + 1, 2);
			if (/^[A-Fa-f0-9]{2}$/.test(h)) {
				out.push(parseInt(h, 16));
				i += 2;
				continue;
			}
		}
		out.push(qp.charCodeAt(i) & 0xff);
	}
	return Buffer.from(out);
}

function parseMIMERecursive(body, headers, results, depth) {
	if (depth > 20) return; // malformed / hostile nesting
	const ct = headers["content-type"] ? headers["content-type"][0] : "text/plain";
	const lower = ct.split(";")[0].trim().toLowerCase();

	if (lower.startsWith("multipart/")) {
		const boundary = extractBoundary(ct);
		if (!boundary) return;
		for (const part of splitMultipart(body, boundary)) {
			const split = splitHeaderBody(part);
			parseMIMERecursive(split.body, parseHeaders(split.headersRaw), results, depth + 1);
		}
		return;
	}

	const disposition = headers["content-disposition"] ? headers["content-disposition"][0] : "";
	const enc = headers["content-transfer-encoding"]
		? headers["content-transfer-encoding"][0].toLowerCase().trim() : "";

	if (lower.startsWith("text/plain") && !/attachment/i.test(disposition)) {
		results.text.push(enc === "quoted-printable"
			? decodeQuotedPrintable(body).toString("utf8")
			: enc === "base64"
				? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8")
				: body);
		return;
	}
	if (lower.startsWith("text/html") && !/attachment/i.test(disposition)) {
		results.html.push(enc === "quoted-printable"
			? decodeQuotedPrintable(body).toString("utf8")
			: enc === "base64"
				? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8")
				: body);
		return;
	}

	let buf;
	try {
		if (enc === "base64") buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
		else if (enc === "quoted-printable") buf = decodeQuotedPrintable(body);
		else buf = Buffer.from(body, "binary");
	} catch (e) {
		buf = Buffer.alloc(0);
	}
	results.attachments.push({
		filename: extractFilename(headers),
		size: buf.length,
		contentType: lower,
		content: buf,
		isInlineImage: /^image\//.test(lower) && /inline/i.test(disposition)
	});
}

function parseFullMIME(raw) {
	const split = splitHeaderBody(raw);
	const results = { text: [], html: [], attachments: [] };
	parseMIMERecursive(split.body, parseHeaders(split.headersRaw), results, 0);
	return results;
}

function sanitizeHTML(html, droppedInline) {
	html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
	html = html.replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "");
	if (droppedInline.length) {
		html = html.replace(/<img[^>]+cid:[^"'>]+[^>]*>/gi, "<span>[inline image omitted]</span>");
	}
	return html;
}

/* ------------------------------------------------------------------ *
 * Separator rendering
 * ------------------------------------------------------------------ */

function escapeHtml(s) {
	return String(s == null ? "" : s)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// CFG.timezone is an IANA name such as "America/New_York"; unset means the
// host's own zone. Falls back to ISO if the runtime lacks full ICU data,
// which some minimal Node builds do.
function formatWhen(date) {
	const opts = CFG.timezone ? { timeZone: CFG.timezone } : {};
	try {
		return {
			date: date.toLocaleDateString(CFG.locale, Object.assign({
				year: "numeric", month: "short", day: "numeric"
			}, opts)),
			time: date.toLocaleTimeString(CFG.locale, Object.assign({
				hour: "numeric", minute: "2-digit"
			}, opts)),
			datetime: date.toLocaleString(CFG.locale, Object.assign({
				year: "numeric", month: "short", day: "numeric",
				hour: "numeric", minute: "2-digit"
			}, opts))
		};
	} catch (e) {
		const iso = date.toISOString();
		return {
			date: iso.slice(0, 10),
			time: iso.slice(11, 16),
			datetime: iso.replace("T", " ").slice(0, 16)
		};
	}
}

// `html` selects escaping: subjects arrive from the wire and can contain markup.
function renderSeparator(template, entry, index, html) {
	if (!template) return "";
	const w = formatWhen(entry.at);
	const esc = v => (html ? escapeHtml(v) : String(v == null ? "" : v));
	return template
		.replace(/\{\{subject\}\}/g, esc(entry.subject || "(no subject)"))
		.replace(/\{\{from\}\}/g, esc(entry.from || ""))
		.replace(/\{\{datetime\}\}/g, esc(w.datetime))
		.replace(/\{\{date\}\}/g, esc(w.date))
		.replace(/\{\{time\}\}/g, esc(w.time))
		.replace(/\{\{n\}\}/g, String(index + 1));
}

/* ------------------------------------------------------------------ *
 * Digest store
 *
 * Key is recipient + envelope sender. The previous version built this key in
 * three places and reset it in a fourth using only the recipient, which is
 * what caused digests to accumulate forever.
 * ------------------------------------------------------------------ */

const DIGESTS = new Map();

function normalizeAddress(addr) {
	if (!addr) return "";
	addr = String(addr).trim().toLowerCase().replace(/^<+|>+$/g, "");
	const m = addr.match(/^([^@]+)@(.+)$/);
	if (!m) return addr;
	return m[1].split("+")[0] + "@" + m[2];
}

function digestKey(rcpt, mailFrom) {
	return normalizeAddress(rcpt) + "|" + normalizeAddress(mailFrom);
}

function newDigest(mailFrom) {
	return {
		mailFrom: mailFrom || null,
		nextDelay: CFG.digestFirstDelay,
		timer: null,
		lastReceived: Date.now(),
		entries: [],          // { subject, from, at, text, html }
		attachments: [],
		attachBytes: 0,
		msgCount: 0,
		omitMeta: { count: 0, attachCount: 0, attachBytes: 0 }
	};
}

function estimateDigestMemory() {
	let total = 0;
	for (const d of DIGESTS.values()) {
		for (const a of d.attachments) total += a.size;
		for (const e of d.entries) {
			total += Buffer.byteLength(e.text || "", "utf8");
			total += Buffer.byteLength(e.html || "", "utf8");
		}
	}
	return total;
}

function addToDigest(rcpt, mailFrom, raw) {
	const key = digestKey(rcpt, mailFrom);
	let d = DIGESTS.get(key);
	const now = Date.now();

	if (!d) {
		d = newDigest(mailFrom);
	} else if (now - d.lastReceived > CFG.digestCooldownMin * 60000) {
		if (d.timer) clearTimeout(d.timer);
		d = newDigest(mailFrom);
		log("info", { msg: "cooldown_reset", rcpt });
	}
	d.lastReceived = now;
	if (!d.mailFrom) d.mailFrom = mailFrom;

	const split = splitHeaderBody(raw);
	const headers = parseHeaders(split.headersRaw);
	const subject = headerValue(headers, "subject");
	const from = headerValue(headers, "from") || mailFrom;

	// Prefer the message's own Date header. In a digest that batches over an
	// hour, when it was sent beats when the relay got round to it.
	let at = new Date();
	const dateHeader = headerValue(headers, "date");
	if (dateHeader) {
		const parsedDate = new Date(dateHeader);
		if (!isNaN(parsedDate.getTime())) at = parsedDate;
	}

	const parsed = parseFullMIME(raw);

	if (d.msgCount >= CFG.digestMaxMessages) {
		d.omitMeta.count++;
		metrics.omit_msg++;
		for (const a of parsed.attachments) {
			d.omitMeta.attachCount++;
			d.omitMeta.attachBytes += a.size;
		}
		DIGESTS.set(key, d);
		return;
	}

	if (estimateDigestMemory() > CFG.globalMemoryCap) {
		log("warn", { msg: "global_memory_cap_reached", action: "message_omitted" });
		d.omitMeta.count++;
		metrics.omit_msg++;
		DIGESTS.set(key, d);
		return;
	}

	const droppedInline = [];
	for (const a of parsed.attachments) {
		if (a.size > CFG.maxAttachSize || d.attachBytes + a.size > CFG.maxTotalAttach) {
			d.omitMeta.attachCount++;
			d.omitMeta.attachBytes += a.size;
			metrics.attach_dropped++;
			if (a.isInlineImage) droppedInline.push({ filename: a.filename });
			continue;
		}
		d.attachments.push(a);
		d.attachBytes += a.size;
		metrics.attach_forwarded++;
	}

	let html = parsed.html.join("");
	if (droppedInline.length && html) html = sanitizeHTML(html, droppedInline);

	d.entries.push({
		subject: subject,
		from: from,
		at: at,
		text: parsed.text.join("\n"),
		html: html
	});

	d.msgCount++;
	DIGESTS.set(key, d);
}

function scheduleDigest(rcpt, mailFrom) {
	const key = digestKey(rcpt, mailFrom);
	const d = DIGESTS.get(key);
	if (!d || d.timer) return;
	d.timer = setTimeout(() => {
		d.timer = null;
		flushDigest(rcpt, mailFrom);
	}, d.nextDelay);
}

function flushDigest(rcpt, mailFrom) {
	const key = digestKey(rcpt, mailFrom);
	const d = DIGESTS.get(key);
	if (!d || d.msgCount === 0) return;

	const mime = buildDigestMIME(rcpt, d);
	const nextDelay = Math.min(d.nextDelay * CFG.digestBackoff, CFG.digestMaxDelay);
	const from = d.mailFrom;

	// Reset under the SAME key before sending, so anything arriving during
	// delivery starts a fresh digest instead of being re-sent.
	const fresh = newDigest(from);
	fresh.nextDelay = nextDelay;
	fresh.lastReceived = Date.now();
	DIGESTS.set(key, fresh);

	deliver(mime, [rcpt], from, false, { mode: "digest", count: d.msgCount })
		.then(() => { metrics.digest_sent++; })
		.catch(err => log("error", { msg: "digest_send_fail", rcpt, err: String(err) }));
}

function buildDigestMIME(rcpt, d) {
	const entries = d.entries.slice();
	if (CFG.digestAscending) entries.sort((a, b) => a.at - b.at);

	const textChunks = [];
	const htmlChunks = [];

	entries.forEach((e, i) => {
		const showSep = (i > 0) || CFG.sepFirst;
		const sepT = showSep ? renderSeparator(CFG.sepText, e, i, false) : "";
		const sepH = showSep ? renderSeparator(CFG.sepHtml, e, i, true) : "";

		if (e.text) textChunks.push(sepT + e.text);
		if (e.html) htmlChunks.push(sepH + e.html);

		// A message with neither part still deserves a line in the digest.
		if (!e.text && !e.html) {
			if (sepT) textChunks.push(sepT);
			if (sepH) htmlChunks.push(sepH);
		}
	});

	let text = textChunks.join("");
	let html = htmlChunks.join("");

	if (d.omitMeta.count > 0) {
		const note = CFG.omitFormat
			.replace("{{N}}", d.omitMeta.count)
			.replace("{{A}}", d.omitMeta.attachCount)
			.replace("{{S}}", d.omitMeta.attachBytes);
		if (text) text += "\n\n" + note;
		if (html) html += "<br><br>" + escapeHtml(note);
		if (!text && !html) text = note;
	}

	const subject = CFG.digestSubject.replace("{{count}}", String(d.msgCount));
	const from = d.mailFrom || CFG.defaultFrom || "relay@localhost";
	const hasText = text.length > 0;
	const hasHtml = html.length > 0;
	const hasAttach = d.attachments.length > 0;
	const alt = "alt_" + crypto.randomBytes(8).toString("hex");
	const mix = "mix_" + crypto.randomBytes(8).toString("hex");

	const head = [
		"From: " + from,
		"To: " + rcpt,
		"Subject: " + subject,
		"MIME-Version: 1.0"
	];

	// Note: no Content-Transfer-Encoding: quoted-printable here. The previous
	// version declared QP on content it never QP-encoded, which produces
	// visible "=3D" style artifacts in some clients.
	const bodyAlt = () => [
		"--" + alt,
		"Content-Type: text/plain; charset=utf-8",
		"",
		text,
		"",
		"--" + alt,
		"Content-Type: text/html; charset=utf-8",
		"",
		html,
		"",
		"--" + alt + "--"
	].join("\r\n");

	if (!hasAttach) {
		if (hasText && hasHtml) {
			return head.concat([
				'Content-Type: multipart/alternative; boundary="' + alt + '"',
				"",
				bodyAlt(),
				""
			]).join("\r\n");
		}
		return head.concat([
			"Content-Type: text/" + (hasHtml ? "html" : "plain") + "; charset=utf-8",
			"",
			hasHtml ? html : text,
			""
		]).join("\r\n");
	}

	const parts = [];
	if (hasText && hasHtml) {
		parts.push([
			"--" + mix,
			'Content-Type: multipart/alternative; boundary="' + alt + '"',
			"",
			bodyAlt()
		].join("\r\n"));
	} else {
		parts.push([
			"--" + mix,
			"Content-Type: text/" + (hasHtml ? "html" : "plain") + "; charset=utf-8",
			"",
			hasHtml ? html : text
		].join("\r\n"));
	}

	for (const a of d.attachments) {
		const encoded = a.content.toString("base64").replace(/(.{76})/g, "$1\r\n");
		parts.push([
			"--" + mix,
			"Content-Type: " + (a.contentType || "application/octet-stream"),
			'Content-Disposition: attachment; filename="' + a.filename.replace(/"/g, "") + '"',
			"Content-Transfer-Encoding: base64",
			"",
			encoded
		].join("\r\n"));
	}
	parts.push("--" + mix + "--");

	return head.concat([
		'Content-Type: multipart/mixed; boundary="' + mix + '"',
		"",
		parts.join("\r\n"),
		""
	]).join("\r\n");
}

/* ------------------------------------------------------------------ *
 * Outbound SMTP client
 *
 * Rewritten. The previous implementation only ever ran inside a
 * "secureConnect" handler, so with SMTP_SECURE=false nothing executed and
 * the STARTTLS branch was unreachable.
 * ------------------------------------------------------------------ */

class SmtpConn {
	constructor(sock) {
		this.buf = "";
		this.waiters = [];
		this.closed = false;
		this.attach(sock);
	}

	attach(sock) {
		this.sock = sock;
		this.onData = chunk => {
			this.buf += chunk.toString("latin1");
			this.drain();
		};
		this.onError = err => this.fail(err);
		this.onClose = () => this.fail(new Error("connection closed by peer"));
		sock.on("data", this.onData);
		sock.on("error", this.onError);
		sock.on("close", this.onClose);
	}

	detach() {
		this.sock.removeListener("data", this.onData);
		this.sock.removeListener("error", this.onError);
		this.sock.removeListener("close", this.onClose);
		return this.sock;
	}

	fail(err) {
		this.closed = true;
		const waiters = this.waiters.splice(0);
		for (const w of waiters) {
			clearTimeout(w.timer);
			w.reject(err);
		}
	}

	// A reply is complete when a line starts with three digits and a space
	// (or is exactly three digits). Continuation lines use "250-".
	replyEnd() {
		let pos = 0;
		for (;;) {
			const nl = this.buf.indexOf("\n", pos);
			if (nl === -1) return -1;
			const line = this.buf.slice(pos, nl).replace(/\r$/, "");
			if (/^\d{3}(?: |$)/.test(line)) return nl + 1;
			pos = nl + 1;
		}
	}

	drain() {
		while (this.waiters.length) {
			const end = this.replyEnd();
			if (end === -1) return;
			const reply = this.buf.slice(0, end);
			this.buf = this.buf.slice(end);
			const w = this.waiters.shift();
			clearTimeout(w.timer);
			w.resolve(reply);
		}
	}

	read(timeout) {
		return new Promise((resolve, reject) => {
			if (this.closed) return reject(new Error("connection closed"));
			const w = { resolve, reject };
			w.timer = setTimeout(() => {
				const i = this.waiters.indexOf(w);
				if (i >= 0) this.waiters.splice(i, 1);
				reject(new Error("SMTP read timeout"));
			}, timeout || CFG.smtpTimeout);
			this.waiters.push(w);
			this.drain();
		});
	}

	write(data) { this.sock.write(data); }

	async cmd(line, timeout) {
		this.sock.write(line + "\r\n");
		return this.read(timeout);
	}

	end() {
		try { this.sock.end(); } catch (e) { /* already gone */ }
		try { this.sock.destroy(); } catch (e) { /* already gone */ }
	}
}

function code(reply) {
	const lines = reply.trim().split(/\r?\n/);
	return parseInt(lines[lines.length - 1].slice(0, 3), 10);
}

function expect(reply, want) {
	const c = code(reply);
	if (c !== want) {
		throw new Error("SMTP expected " + want + ", got: " + reply.trim().replace(/\s+/g, " "));
	}
	return c;
}

function connectSocket() {
	return new Promise((resolve, reject) => {
		let sock;
		const onErr = err => { cleanup(); reject(err); };
		const cleanup = () => {
			if (!sock) return;
			sock.removeListener("error", onErr);
		};
		if (CFG.smtpSecure) {
			sock = tls.connect({
				host: CFG.smtpHost,
				port: CFG.smtpPort,
				rejectUnauthorized: !CFG.smtpIgnoreCert,
				minVersion: "TLSv1.2"
			});
			sock.once("secureConnect", () => { cleanup(); resolve(sock); });
		} else {
			sock = net.connect(CFG.smtpPort, CFG.smtpHost);
			sock.once("connect", () => { cleanup(); resolve(sock); });
		}
		sock.once("error", onErr);
		sock.setTimeout(CFG.smtpTimeout, () => onErr(new Error("connect timeout")));
	});
}

async function smtpDeliver(rawMessage, recipients, mailFrom, bytePreserved) {
	const sock = await connectSocket();
	sock.setTimeout(0);
	let conn = new SmtpConn(sock);

	try {
		expect(await conn.read(), 220);

		let ehlo = await conn.cmd("EHLO relay.local");
		if (code(ehlo) !== 250) {
			expect(await conn.cmd("HELO relay.local"), 250);
		}

		if (CFG.smtpStartTls && !CFG.smtpSecure) {
			expect(await conn.cmd("STARTTLS"), 220);
			if (conn.buf.length) throw new Error("data pending before TLS handshake");

			const plain = conn.detach();
			plain.pause();
			const tlsSock = tls.connect({
				socket: plain,
				servername: CFG.smtpHost,
				rejectUnauthorized: !CFG.smtpIgnoreCert,
				minVersion: "TLSv1.2"
			});
			await new Promise((res, rej) => {
				tlsSock.once("secureConnect", res);
				tlsSock.once("error", rej);
			});
			conn = new SmtpConn(tlsSock);
			ehlo = await conn.cmd("EHLO relay.local"); // must re-EHLO after upgrade
			expect(ehlo, 250);
		}

		if (CFG.smtpUser) {
			expect(await conn.cmd("AUTH LOGIN"), 334);
			expect(await conn.cmd(Buffer.from(CFG.smtpUser, "utf8").toString("base64")), 334);
			const r = await conn.cmd(Buffer.from(CFG.smtpPass || "", "utf8").toString("base64"));
			if (code(r) !== 235) throw new Error("SMTP auth failed: " + r.trim());
		}

		const envFrom = mailFrom || CFG.defaultFrom || "relay@localhost";
		expect(await conn.cmd("MAIL FROM:<" + envFrom + ">"), 250);

		let accepted = 0;
		for (const rcpt of recipients) {
			const r = await conn.cmd("RCPT TO:<" + rcpt + ">");
			const c = code(r);
			if (c === 250 || c === 251) accepted++;
			else log("warn", { msg: "rcpt_rejected", rcpt, reply: r.trim() });
		}
		if (accepted === 0) throw new Error("all recipients rejected");

		expect(await conn.cmd("DATA"), 354);

		let msg = bytePreserved ? rawMessage : rawMessage.replace(/\r?\n/g, "\r\n");
		conn.write(Buffer.from(outboundDotStuff(msg) + "\r\n.\r\n", "latin1"));
		expect(await conn.read(), 250);

		try { await conn.cmd("QUIT", 5000); } catch (e) { /* QUIT is advisory */ }
		conn.end();
	} catch (err) {
		conn.end();
		throw err;
	}
}

function ensureOutboundHeaders(raw, envFrom) {
	const domain = (envFrom || "localhost").split("@")[1] || "localhost";
	const add = [];

	if (!/^Date:/mi.test(raw)) add.push("Date: " + new Date().toUTCString());
	if (!/^Message-ID:/mi.test(raw)) {
		const id = crypto.randomUUID
			? crypto.randomUUID()
			: crypto.randomBytes(16).toString("hex");
		add.push("Message-ID: <" + id + "@" + domain + ">");
	}
	if (!/^From:/mi.test(raw)) add.push("From: " + envFrom);
	if (CFG.sesConfigSet && !/^X-SES-CONFIGURATION-SET:/mi.test(raw)) {
		add.push("X-SES-CONFIGURATION-SET: " + CFG.sesConfigSet);
	}
	if (!add.length) return raw;
	return add.join("\r\n") + "\r\n" + raw;
}

/* ------------------------------------------------------------------ *
 * Delivery with logging, rate limiting, bounded retry
 * ------------------------------------------------------------------ */

async function deliver(raw, recipients, mailFrom, bytePreserved, meta) {
	const envFrom = mailFrom || CFG.defaultFrom || "relay@localhost";
	const message = ensureOutboundHeaders(raw, envFrom);

	// Per-message audit line: from / to / subject / message-id / bytes.
	// This is the record that did not exist on 2026-08-03.
	const headers = parseHeaders(splitHeaderBody(message).headersRaw);
	const audit = {
		msg: "mail",
		mode: (meta && meta.mode) || "immediate",
		from: envFrom,
		to: recipients,
		subject: headerValue(headers, "subject"),
		message_id: headerValue(headers, "message-id"),
		bytes: Buffer.byteLength(message, "latin1")
	};
	if (meta && meta.count) audit.digest_count = meta.count;

	let lastErr = null;
	for (let attempt = 0; attempt <= CFG.retries; attempt++) {
		try {
			await waitForSlot();
			await smtpDeliver(message, recipients, envFrom, bytePreserved);
			metrics.msg_out++;
			log("info", Object.assign({}, audit, { result: "sent", attempt }));
			return;
		} catch (err) {
			lastErr = err;
			if (/circuit breaker/.test(String(err))) break;
			const permanent = /SMTP expected 250, got: 5\d\d/.test(String(err))
				|| /auth failed/i.test(String(err));
			if (permanent || attempt === CFG.retries) break;
			await new Promise(r => setTimeout(r, CFG.retryDelay * Math.pow(2, attempt)));
		}
	}

	metrics.msg_failed++;
	log("error", Object.assign({}, audit, { result: "failed", err: String(lastErr) }));
	throw lastErr;
}

/* ------------------------------------------------------------------ *
 * Inbound message routing
 * ------------------------------------------------------------------ */

function processInboundMessage(sess, raw) {
	metrics.msg_in++;

	const headers = parseHeaders(splitHeaderBody(raw).headersRaw);
	const bypass = CFG.digestBypassHeader && headers[CFG.digestBypassHeader.toLowerCase()];

	// Pure relay unless digesting is explicitly enabled. Batching password
	// resets and login codes behind an exponential backoff is not something
	// to do by default.
	if (!CFG.digest || bypass) {
		deliver(raw, sess.rcptTo.slice(), sess.mailFrom, true, { mode: "immediate" })
			.catch(() => { /* already logged */ });
		return;
	}

	for (const rcpt of sess.rcptTo) {
		const key = digestKey(rcpt, sess.mailFrom);
		if (!DIGESTS.has(key)) {
			// First message to this pair goes straight out; later ones batch.
			DIGESTS.set(key, newDigest(sess.mailFrom));
			deliver(raw, [rcpt], sess.mailFrom, true, { mode: "immediate" })
				.catch(() => { /* already logged */ });
			continue;
		}
		addToDigest(rcpt, sess.mailFrom, raw);
		scheduleDigest(rcpt, sess.mailFrom);
	}
}

/* ------------------------------------------------------------------ *
 * Inbound SMTP server
 * ------------------------------------------------------------------ */

let ACTIVE_SESSIONS = 0;
const REQUIRE_AUTH = !!(CFG.listenUser && CFG.listenPass);

function ssend(sess, line) {
	if (!sess || !sess.sock || sess.sock.destroyed) return;
	sess.sock.write(line + "\r\n");
}

function resetTimer(sess) {
	if (sess.timer) clearTimeout(sess.timer);
	sess.timer = setTimeout(() => {
		log("warn", { msg: "session_timeout", remote: sess.remote });
		ssend(sess, "421 Timeout");
		closeSession(sess);
	}, CFG.sessionTimeout);
}

function closeSession(sess) {
	if (sess.closed) return; // guard: previously double-decremented the counter
	sess.closed = true;
	if (sess.timer) clearTimeout(sess.timer);
	ACTIVE_SESSIONS--;
	try { sess.sock.end(); } catch (e) { /* already gone */ }
}

function resetTransaction(sess) {
	sess.mailFrom = null;
	sess.rcptTo = [];
	sess.dataMode = false;
	sess.rawChunks = [];
	sess.dataBytes = 0;
	sess.dataLines = 0;
	sess.scanner = new DotTerminatorScanner();
}

function createSession(sock, isTLS) {
	const sess = {
		sock,
		closed: false,
		tlsUpgraded: !!isTLS,
		remote: sock.remoteAddress,
		authed: !REQUIRE_AUTH,
		expectAuthUser: false,
		expectAuthPass: false,
		cmdBuffer: "",
		timer: null
	};
	resetTransaction(sess);
	return sess;
}

function doSTARTTLS(sess, key, cert) {
	if (sess.tlsUpgraded) return ssend(sess, "454 TLS already active");
	ssend(sess, "220 Ready to start TLS");

	const plain = sess.sock;
	for (const ev of ["data", "error", "end", "close"]) plain.removeAllListeners(ev);
	plain.pause();
	while (plain.read() !== null) { /* discard any plaintext still buffered */ }

	const tlsSock = new tls.TLSSocket(plain, {
		isServer: true,
		secureContext: tls.createSecureContext({ key, cert, minVersion: "TLSv1.2" })
	});

	tlsSock.once("secureConnect", () => {
		sess.sock = tlsSock;
		sess.tlsUpgraded = true;
		sess.cmdBuffer = "";
		resetTransaction(sess);
		tlsSock.removeAllListeners("error");
		tlsSock.on("data", chunk => handleChunk(sess, chunk));
		tlsSock.on("error", e => {
			log("error", { msg: "tls_error", err: String(e) });
			closeSession(sess);
		});
		tlsSock.on("end", () => closeSession(sess));
	});
	tlsSock.on("error", e => {
		log("error", { msg: "starttls_fail", err: String(e) });
		closeSession(sess);
	});
}

function finishData(sess) {
	const full = Buffer.concat(sess.rawChunks);
	const TERM = Buffer.from("\r\n.\r\n", "latin1");
	const SHORT = Buffer.from(".\r\n", "latin1");

	let body;
	if (full.length >= TERM.length && full.slice(full.length - TERM.length).equals(TERM)) {
		body = full.slice(0, full.length - TERM.length);
	} else if (full.equals(SHORT)) {
		body = Buffer.alloc(0);
	} else {
		body = full;
	}

	body = inboundDotUnstuff(body);
	const raw = body.toString("latin1");

	resetTransaction(sess);
	ssend(sess, "250 OK");

	try {
		processInboundMessage({ mailFrom: sess.lastFrom, rcptTo: sess.lastRcpt }, raw);
	} catch (err) {
		log("error", { msg: "process_failed", err: String(err) });
	}
}

function handleCommand(sess, line) {
	if (sess.expectAuthUser) {
		sess.expectAuthUser = false;
		const user = Buffer.from(line.trim(), "base64").toString("utf8");
		if (user !== CFG.listenUser) {
			ssend(sess, "535 Authentication failed");
			return closeSession(sess);
		}
		sess.expectAuthPass = true;
		return ssend(sess, "334 UGFzc3dvcmQ6");
	}

	if (sess.expectAuthPass) {
		sess.expectAuthPass = false;
		const pass = Buffer.from(line.trim(), "base64").toString("utf8");
		if (pass !== CFG.listenPass) {
			ssend(sess, "535 Authentication failed");
			return closeSession(sess);
		}
		sess.authed = true;
		return ssend(sess, "235 Authentication successful");
	}

	const parts = line.trim().split(/\s+/);
	const cmd = (parts[0] || "").toUpperCase();

	switch (cmd) {
		case "EHLO":
			resetTransaction(sess);
			ssend(sess, "250-relay.local");
			if (!sess.tlsUpgraded && SSL.key && SSL.cert) ssend(sess, "250-STARTTLS");
			if (REQUIRE_AUTH) ssend(sess, "250-AUTH LOGIN PLAIN");
			ssend(sess, "250-8BITMIME");
			ssend(sess, "250 SIZE " + CFG.maxSize);
			return;

		case "HELO":
			resetTransaction(sess);
			return ssend(sess, "250 relay.local");

		case "STARTTLS":
			if (!SSL.key || !SSL.cert) return ssend(sess, "454 TLS not available");
			return doSTARTTLS(sess, SSL.key, SSL.cert);

		case "AUTH": {
			if (!REQUIRE_AUTH) return ssend(sess, "503 AUTH not required");
			// Previously: parts[1] ? parts[1] : toUpperCase()  -- undefined function.
			const method = (parts[1] || "").toUpperCase();
			if (method === "PLAIN") {
				if (parts[2]) {
					const dec = Buffer.from(parts[2], "base64").toString("utf8").split("\0");
					if (dec[1] === CFG.listenUser && dec[2] === CFG.listenPass) {
						sess.authed = true;
						return ssend(sess, "235 Authentication successful");
					}
					ssend(sess, "535 Authentication failed");
					return closeSession(sess);
				}
				return ssend(sess, "334 ");
			}
			if (method !== "LOGIN") return ssend(sess, "504 Unsupported authentication method");
			sess.expectAuthUser = true;
			return ssend(sess, "334 VXNlcm5hbWU6");
		}

		case "MAIL": {
			if (REQUIRE_AUTH && !sess.authed) return ssend(sess, "530 Authentication required");
			if (sess.mailFrom) return ssend(sess, "503 Nested MAIL not allowed; use RSET");
			const m = line.match(/FROM:\s*<([^>]*)>/i);
			if (!m) return ssend(sess, "501 Syntax: MAIL FROM:<address>");
			sess.mailFrom = m[1];
			sess.rcptTo = [];
			return ssend(sess, "250 OK");
		}

		case "RCPT": {
			if (REQUIRE_AUTH && !sess.authed) return ssend(sess, "530 Authentication required");
			if (!sess.mailFrom) return ssend(sess, "503 Bad sequence; MAIL first");
			const m = line.match(/TO:\s*<([^>]+)>/i);
			if (!m) return ssend(sess, "501 Syntax: RCPT TO:<address>");
			// Previously capped at one recipient with a 452.
			if (sess.rcptTo.length >= CFG.maxRecipients) return ssend(sess, "452 Too many recipients");
			sess.rcptTo.push(m[1]);
			return ssend(sess, "250 OK");
		}

		case "DATA":
			if (REQUIRE_AUTH && !sess.authed) return ssend(sess, "530 Authentication required");
			if (!sess.mailFrom || !sess.rcptTo.length) return ssend(sess, "503 Bad sequence");
			sess.lastFrom = sess.mailFrom;
			sess.lastRcpt = sess.rcptTo.slice();
			sess.dataMode = true;
			sess.rawChunks = [];
			sess.dataBytes = 0;
			sess.dataLines = 0;
			sess.scanner = new DotTerminatorScanner();
			return ssend(sess, "354 End data with <CR><LF>.<CR><LF>");

		case "RSET":
			resetTransaction(sess);
			return ssend(sess, "250 OK");

		case "NOOP":
			return ssend(sess, "250 OK");

		case "VRFY":
			return ssend(sess, "252 Cannot VRFY user");

		case "QUIT":
			ssend(sess, "221 Bye");
			return closeSession(sess);

		default:
			return ssend(sess, "500 Command unrecognized");
	}
}

function handleChunk(sess, chunk) {
	resetTimer(sess);

	if (sess.dataMode) {
		let lines = sess.dataLines;
		for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) lines++;
		const size = sess.dataBytes + chunk.length;

		if (size > CFG.maxSize || lines > CFG.maxLines) {
			ssend(sess, "552 Message too large");
			resetTransaction(sess);
			return;
		}

		sess.dataBytes = size;
		sess.dataLines = lines;
		sess.rawChunks.push(chunk);
		sess.scanner.push(chunk);

		if (sess.scanner.isTerminated()) finishData(sess);
		return;
	}

	sess.cmdBuffer += chunk.toString("latin1");
	let idx;
	while ((idx = sess.cmdBuffer.indexOf("\n")) !== -1) {
		const line = sess.cmdBuffer.slice(0, idx).replace(/\r$/, "");
		sess.cmdBuffer = sess.cmdBuffer.slice(idx + 1);
		if (line.length > 1000) {
			ssend(sess, "500 Line too long");
			sess.cmdBuffer = "";
			continue;
		}
		handleCommand(sess, line);
		if (sess.closed) return;
		if (sess.dataMode && sess.cmdBuffer.length) {
			// Client pipelined the body right after DATA.
			const rest = Buffer.from(sess.cmdBuffer, "latin1");
			sess.cmdBuffer = "";
			handleChunk(sess, rest);
			return;
		}
	}
}

function inboundConnection(sock, isTLS) {
	if (ACTIVE_SESSIONS >= CFG.maxConcurrent) {
		try { sock.write("421 Too busy\r\n"); sock.end(); } catch (e) { /* nothing to do */ }
		return;
	}
	ACTIVE_SESSIONS++;
	const sess = createSession(sock, isTLS);
	resetTimer(sess);
	sock.on("data", chunk => handleChunk(sess, chunk));
	sock.on("error", e => {
		log("warn", { msg: "socket_error", err: String(e) });
		closeSession(sess);
	});
	sock.on("end", () => closeSession(sess));
	ssend(sess, "220 relay.local ESMTP");
}

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

const SSL = { key: null, cert: null };

function loadTLSMaterial() {
	if (!CFG.sslKeyPath || !CFG.sslCertPath) return;
	try {
		SSL.key = fs.readFileSync(CFG.sslKeyPath);
		SSL.cert = fs.readFileSync(CFG.sslCertPath);
	} catch (e) {
		log("warn", { msg: "tls_material_unreadable", err: String(e) });
		SSL.key = SSL.cert = null;
	}
}

function startRelay() {
	// An unauthenticated relay bound to a public interface is an open relay.
	const loopback = /^(127\.|::1$|localhost$)/.test(CFG.listenHost);
	if (!loopback && !REQUIRE_AUTH) {
		log("error", {
			msg: "refusing_to_start",
			reason: "non-loopback LISTEN_HOST without LISTEN_USER/LISTEN_PASS would be an open relay",
			listenHost: CFG.listenHost
		});
		process.exit(1);
	}

	const plain = net.createServer(sock => inboundConnection(sock, false));
	plain.on("error", e => {
		log("error", { msg: "plain_server_error", err: String(e) });
		process.exit(1);
	});
	plain.listen(CFG.listenPort, CFG.listenHost, () => {
		log("info", {
			msg: "listening",
			host: CFG.listenHost,
			port: CFG.listenPort,
			auth: REQUIRE_AUTH,
			upstream: CFG.smtpHost + ":" + CFG.smtpPort,
			tls: CFG.smtpSecure ? "implicit" : (CFG.smtpStartTls ? "starttls" : "none"),
			digest: CFG.digest,
			max_per_minute: CFG.maxPerMinute,
			max_per_hour: CFG.maxPerHour
		});
	});

	if (CFG.listenTlsPort && SSL.key && SSL.cert) {
		const secure = tls.createServer(
			{ key: SSL.key, cert: SSL.cert, minVersion: "TLSv1.2" },
			sock => inboundConnection(sock, true)
		);
		secure.on("error", e => log("error", { msg: "tls_server_error", err: String(e) }));
		secure.listen(CFG.listenTlsPort, CFG.listenHost, () => {
			log("info", { msg: "listening_tls", host: CFG.listenHost, port: CFG.listenTlsPort });
		});
	}

	setInterval(() => log("info", Object.assign({ msg: "metrics" }, metrics)), 300000).unref();
}

/* ------------------------------------------------------------------ *
 * Interactive setup (only when upstream is unconfigured)
 * ------------------------------------------------------------------ */

function ask(question) {
	return new Promise(resolve => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
	});
}

function askHidden(prompt) {
	return new Promise(resolve => {
		process.stdout.write(prompt);
		const stdin = process.stdin;
		stdin.resume();
		if (stdin.setRawMode) stdin.setRawMode(true);
		let buf = "";
		const onData = ch => {
			const s = ch.toString("utf8");
			if (s === "\n" || s === "\r") {
				if (stdin.setRawMode) stdin.setRawMode(false);
				stdin.removeListener("data", onData);
				stdin.pause();
				process.stdout.write("\n");
				return resolve(buf);
			}
			if (s === "\u0003") {
				if (stdin.setRawMode) stdin.setRawMode(false);
				process.stdout.write("\n");
				process.exit(130);
			}
			if (s === "\u007f" || s === "\b") {
				buf = buf.slice(0, -1);
				return;
			}
			buf += s;
		};
		stdin.on("data", onData);
	});
}

async function interactiveSetup() {
	if (CFG.smtpHost && (CFG.smtpPass || !CFG.smtpUser)) return;

	console.log("\n=== SMTP relay setup ===\n");

	let host = await ask("Upstream SMTP host (e.g. email-smtp.us-east-1.amazonaws.com:587): ");
	let port;
	if (host.includes(":")) {
		const p = host.split(":");
		host = p[0];
		port = parseInt(p[1], 10);
	} else {
		const a = await ask("Port [587]: ");
		port = a ? parseInt(a, 10) : 587;
	}

	const secure = port === 465;
	const starttls = port !== 465;

	const user = await ask("SMTP username (blank for none): ");
	const pass = user ? await askHidden("SMTP password: ") : "";

	const wantCfg = await ask("SES configuration set for delivery logging (blank for none): ");
	const listenPort = await ask("Local listen port [2525]: ");

	const lines = [
		"SMTP_HOST=" + host,
		"SMTP_PORT=" + port,
		"SMTP_SECURE=" + (secure ? "true" : "false"),
		"SMTP_STARTTLS=" + (starttls ? "true" : "false"),
		"SMTP_USER=" + user,
		"SMTP_PASSWORD=" + pass,
		"LISTEN_HOST=127.0.0.1",
		"LISTEN_PORT=" + (listenPort || 2525)
	];
	if (wantCfg) lines.push("SES_CONFIG_SET=" + wantCfg);

	const save = await ask("Save to .env? (Y/n): ");
	if (!save || /^y(es)?$/i.test(save)) {
		fs.writeFileSync(".env", lines.join("\n") + "\n", { mode: 0o600 });
		console.log("\nSaved to .env (mode 600)\n");
	}

	CFG.smtpHost = host;
	CFG.smtpPort = port;
	CFG.smtpSecure = secure;
	CFG.smtpStartTls = starttls;
	CFG.smtpUser = user || null;
	CFG.smtpPass = pass || null;
	CFG.sesConfigSet = wantCfg || null;
	if (listenPort) CFG.listenPort = parseInt(listenPort, 10);
}

(async () => {
	try {
		await interactiveSetup();
		if (!CFG.smtpHost) {
			console.error("No upstream SMTP host configured. Set SMTP_HOST or run interactively.");
			process.exit(1);
		}
		openLog();
		loadTLSMaterial();
		startRelay();
	} catch (err) {
		console.error("Startup failed:", err);
		process.exit(1);
	}
})();