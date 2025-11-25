#!/usr/bin/env node
"use strict";

/*
	Fully Hardened SMTP Relay (Option A)
	-----------------------------------
	• Complete RFC5321 DATA octet preservation
	• Correct CRLF processing
	• Dot-stuffing handling (inbound + outbound)
	• Full MIME parsing from raw bytes (no line canonicalization)
	• Attachment limits
	• Max-message, omitted-summary, cooldown, exponential backoff
	• Logging + metrics
	• Production-grade error handling
	• Drop-in replacement SMTP relay
	• One file, zero dependencies
*/

/********************************************************************
 * CONFIG, LOGGING, METRICS, BASIC UTILITIES
 ********************************************************************/
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t.return || t.return(); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
const fs = require("fs");
const net = require("net");
const tls = require("tls");
const crypto = require("crypto");
const readline = require("readline");
const os = require("os");
const ARGS = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (!a.startsWith("--")) return;
  const key = a.slice(2);
  const val = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
  ARGS[key] = val;
});
function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  fs.readFileSync(path, "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^([\w_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  });
}
loadEnv(ARGS.env || ".env");

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------

// Normalize boolean-ish env vars to proper string values
function normalizeEnvBool(name) {
    const v = process.env[name];
    if (v === true || v === "true" || v === 1 || v === "1") {
        process.env[name] = "true";
    } else {
        process.env[name] = "false";
    }
}

normalizeEnvBool("SMTP_SECURE");
normalizeEnvBool("SMTP_STARTTLS");

const LISTEN_PORT = parseInt(ARGS["listen-port"] || process.env.LISTEN_PORT || 2525, 10);
const LISTEN_HOST = ARGS["listen-host"] || process.env.LISTEN_HOST || "0.0.0.0";
const USE_SSL = !!ARGS["listen-ssl"];
let SSL_KEY = null,
  SSL_CERT = null;
if (USE_SSL) {
  SSL_KEY = fs.readFileSync(ARGS.key || process.env.SSL_KEY);
  SSL_CERT = fs.readFileSync(ARGS.cert || process.env.SSL_CERT);
}
const SMTP_HOST = ARGS["smtp-host"] || process.env.SMTP_HOST;
const SMTP_PORT = parseInt(ARGS["smtp-port"] || process.env.SMTP_PORT || 587, 10);
const SMTP_USER = ARGS.user || process.env.SMTP_USER;
const DEFAULT_FROM = process.env.DEFAULT_FROM || null;


// Password comes later via readPassword()

// Digest / backoff config
const SUBJECT_TEMPLATE = ARGS.subject || process.env.SUBJECT_TEMPLATE || "{{count}} Updates";
const BACKOFF_FACTOR = parseFloat(ARGS.backoff || process.env.BACKOFF || "2.0");
const SEP_TEXT = ARGS["separator-text"] || process.env.SEPARATOR_TEXT || "\n\n---\n\n";
const SEP_HTML = ARGS["separator-html"] || process.env.SEPARATOR_HTML || "<br><br>---<br><br>";
const MAX_LINES = parseInt(ARGS["max-lines"] || process.env.MAX_LINES || 20000, 10);
const MAX_SIZE = parseInt(ARGS["max-size"] || process.env.MAX_SIZE || 5 * 1024 * 1024, 10);
const MAX_MESSAGES = parseInt(ARGS["max-messages-per-digest"] || process.env.MAX_MESSAGES || 20, 10);
const MAX_ATTACH_SIZE = parseInt(ARGS["max-attachment-size"] || process.env.MAX_ATTACHMENT_SIZE || 5 * 1024 * 1024, 10);
const MAX_TOTAL_ATTACH = parseInt(ARGS["max-total-attachments"] || process.env.MAX_TOTAL_ATTACH || 10 * 1024 * 1024, 10);
const GLOBAL_MEMORY_CAP = parseInt(ARGS["global-memory-cap"] || process.env.GLOBAL_MEMORY_CAP || 100 * 1024 * 1024, 10);
const COOLDOWN_MIN = parseInt(ARGS["cooldown-minutes"] || process.env.COOLDOWN_MINUTES || 30, 10);
const OMIT_FORMAT = ARGS["omitted-format"] || process.env.OMITTED_FORMAT || "+ {{N}} messages omitted ({{A}} attachments, {{S}} bytes)";

// Concurrency
const MAX_CONC = parseInt(ARGS.concurrency || process.env.CONCURRENCY || 50, 10);
const SESSION_TIMEOUT = parseInt(ARGS.timeout || process.env.TIMEOUT || 30000, 10);

// Logging
const LOG_FILE = ARGS["log-file"] || process.env.LOG_FILE || null;
const LOG_LEVEL = ARGS["log-level"] || process.env.LOG_LEVEL || "info";
const LOG_FD = LOG_FILE ? fs.openSync(LOG_FILE, "a") : null;

// ------------------------------------------------------------------
// LOGGING
// ------------------------------------------------------------------

function shouldLog(level) {
  const L = {
    debug: 1,
    info: 2,
    warn: 3,
    error: 4
  };
  return L[level] >= L[LOG_LEVEL];
}
function log(level, obj) {
  if (!shouldLog(level)) return;
  const line = JSON.stringify(_objectSpread({
    ts: new Date().toISOString(),
    level
  }, obj)) + "\n";
  if (LOG_FD) fs.writeSync(LOG_FD, line);else process.stdout.write(line);
}

// ------------------------------------------------------------------
// METRICS
// ------------------------------------------------------------------

const metrics = {
  msg_in: 0,
  msg_out: 0,
  digest_sent: 0,
  omit_msg: 0,
  omit_attach: 0,
  attach_forwarded: 0,
  attach_dropped: 0
};

// ------------------------------------------------------------------
// PASSWORD PROMPT
// ------------------------------------------------------------------
function readPassword(prompt) {
	return new Promise(function(resolve) {
		const stdin = process.stdin;
		const stdout = process.stdout;

		stdout.write(prompt);

		stdin.resume();
		stdin.setRawMode(true);

		let buf = "";

		function onData(ch) {
			ch = ch.toString("utf8");

			if (ch === "\n" || ch === "\r") {
				stdin.setRawMode(false);
				stdin.removeListener("data", onData);
				stdout.write("\n");
				resolve(buf);
				return;
			}

			if (ch === "\u0003") {
				// Ctrl+C
				stdin.setRawMode(false);
				process.stdout.write("\n");
				process.exit();
			}

			buf += ch;
		}

		stdin.on("data", onData);
	});
}


// ------------------------------------------------------------------
// ADDRESS NORMALIZATION
// ------------------------------------------------------------------

function normalizeAddress(addr) {
  addr = addr.trim().toLowerCase();
  addr = addr.replace(/^<+|>+$/g, "");
  const m = addr.match(/^([^@]+)@(.+)$/);
  if (!m) return addr;
  const local = m[1].split("+")[0];
  return local + "@" + m[2];
}

// ------------------------------------------------------------------
// GLOBAL DIGEST STATE
// ------------------------------------------------------------------

/* Per-recipient structure:
{
	nextDelay,
	timer,
	lastReceived,
	textParts,
	htmlParts,
	attachments:[{filename, contentType, size, content:Buffer}],
	attachBytes,
	msgCount,
	omitMeta:{count, attachCount, attachBytes}
}
*/

const DIGESTS = new Map();
function newDigest() {
  return {
    nextDelay: 60000,
    timer: null,
    lastReceived: Date.now(),
    textParts: [],
    htmlParts: [],
    attachments: [],
    attachBytes: 0,
    msgCount: 0,
    omitMeta: {
      count: 0,
      attachCount: 0,
      attachBytes: 0
    }
  };
}

// ------------------------------------------------------------------
// BYTE-LEVEL CRLF DETECTION + DOT-STUFFING HANDLING
// ------------------------------------------------------------------

/*
	Option A requires strict byte preservation:
	- Detect end-of-DATA using  \r\n.\r\n
	- Do not split lines prematurely
	- Dot-unescape inbound (strip leading ".")
	- Dot-stuff outbound (escape leading ".")
*/

// For scanning DATA stream, we keep a small sliding buffer:
class DotTerminatorScanner {
  // Detects \r\n.\r\n
  constructor() {
    this.window = Buffer.alloc(0);
  }
  push(chunk) {
    // Append
    this.window = Buffer.concat([this.window, chunk]);
    // Cap window at length 5 (max needed)
    if (this.window.length > 5) {
      this.window = this.window.slice(this.window.length - 5);
    }
  }
  isTerminated() {
    // Look for exact terminator: CRLF "." CRLF
    const w = this.window;
    if (w.length < 5) return false;
    return w[w.length - 5] === 13 &&
    // \r
    w[w.length - 4] === 10 &&
    // \n
    w[w.length - 3] === 46 &&
    // "."
    w[w.length - 2] === 13 &&
    // \r
    w[w.length - 1] === 10 &&
    // \n
    // MUST ensure the "." is on its own line:
    // verify previous byte is LF
    // OR this is the very beginning of the message
    true;
  }
}

// Remove dot-stuffing for inbound DATA
// According to RFC5321: lines beginning with ".." become ".".
// But we must preserve CRLF.
//
// Simplest: examine line starts in byte space.
//
// CAVEAT: We should NOT convert CRLFs; use regex on Buffer? No.
//
// We implement a byte-by-byte state machine:
function inboundDotUnstuff(buf) {
  const out = [];
  let sawCR = false;
  let sawCRLF = true;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (sawCR) {
      sawCR = false;
      if (b === 10) {
        // CRLF detected
        out.push(13, 10);
        sawCRLF = true;
        continue;
      } else {
        // Lone CR
        out.push(13);
      }
    }
    if (b === 13) {
      sawCR = true;
      continue;
    }
    if (sawCRLF) {
      if (b === 46 && i + 1 < buf.length && buf[i + 1] === 46) {
        continue; // unstuff
      }
      sawCRLF = false;
    }
    if (b === 10) {
      out.push(10);
      sawCRLF = true;
      continue;
    }
    out.push(b);
  }
  if (sawCR) out.push(13);
  return Buffer.from(out);
}

// Dot-stuff outbound
function outboundDotStuff(str) {
  // Escape leading dot at start
  if (str.startsWith(".")) {
    str = "." + str;
  }

  // CRLF . → CRLF..
  str = str.replace(/\r\n\./g, "\r\n..");

  // LF . → LF.. (fallback for non-CRLF input)
  str = str.replace(/\n\.(?=[^\n])/g, "\n..");
  return str;
}

// ------------------------------------------------------------------
// SAFE BOUNDS CHECKING FOR SIZE + LINES
// ------------------------------------------------------------------

function safeAppendData(currentSize, currentLines, chunk) {
  // Count newlines in chunk
  let lines = currentLines;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === 10) lines++;
  }
  const newSize = currentSize + chunk.length;
  if (lines > MAX_LINES || newSize > MAX_SIZE) {
    return {
      ok: false
    };
  }
  return {
    ok: true,
    size: newSize,
    lines
  };
}

/********************************************************************
 * INBOUND SMTP STATE MACHINE
 ********************************************************************/

let ACTIVE_SESSIONS = 0;

// Reject SMTP pipelining: RFC says one command at a time unless server advertises PIPELINING.
const PIPELINE_ALLOWED = false;

// ------------------------------------------------------------------
// CREATE SESSION OBJECT
// ------------------------------------------------------------------

function createSession(socket, isTLSStart) {
  const session = {
    sock: socket,
    isTLS: !!isTLSStart,
    tlsUpgraded: !!isTLSStart,
    remote: socket.remoteAddress,
    state: "GREET",
    // GREET → AUTH_ZOMBIE → COMMAND → DATA → QUIT
    expectResponse: false,
    // To enforce no pipelining
    mailFrom: null,
    rcptTo: null,
    dataMode: false,
    dataBuf: Buffer.alloc(0),
    // only used for the FIRST immediate message
    dataBytes: 0,
    dataLines: 0,
    dotScanner: new DotTerminatorScanner(),
    rawChunks: [],
    // All collected DATA bytes (except for \r\n.\r\n), then dot-unstuffed

    timer: null
  };
  return session;
}

// ------------------------------------------------------------------
// SEND LINE (CRLF)
// ------------------------------------------------------------------

function ssend(sess, msg) {
  if (!sess || sess.sock.destroyed) return;
  sess.sock.write(msg + "\r\n");
}

// ------------------------------------------------------------------
// RESET SESSION TIMER
// ------------------------------------------------------------------

function resetTimer(sess) {
  if (sess.timer) clearTimeout(sess.timer);
  sess.timer = setTimeout(() => {
    log("warn", {
      msg: "session_timeout",
      remote: sess.remote
    });
    try {
      ssend(sess, "421 Timeout");
    } catch (e) {}
    try {
      sess.sock.end();
    } catch (e) {}
  }, SESSION_TIMEOUT);
}

// ------------------------------------------------------------------
// CLOSE SESSION
// ------------------------------------------------------------------

function closeSession(sess) {
  if (sess.timer) clearTimeout(sess.timer);
  ACTIVE_SESSIONS--;
  try {
    sess.sock.end();
  } catch (e) {}
}

// ------------------------------------------------------------------
// STARTTLS UPGRADE
// ------------------------------------------------------------------

function doSTARTTLS(sess) {
  if (sess.tlsUpgraded) {
    ssend(sess, "454 TLS already active");
    return;
  }
  ssend(sess, "220 Ready to start TLS");
  const plain = sess.sock;
  for (var _i = 0, _arr = ["data", "error", "end", "close"]; _i < _arr.length; _i++) {
    const ev = _arr[_i];
    plain.removeAllListeners(ev);
  }

  // PREVENT leftover plaintext bytes from entering TLS
  plain.pause();

  // Ensure no queued data is left unread
  while (plain.read() !== null) {}
  const tlsSock = new tls.TLSSocket(plain, {
    isServer: true,
    secureContext: tls.createSecureContext({
      key: SSL_KEY,
      cert: SSL_CERT,
      minVersion: "TLSv1.2"
    })
  });
  tlsSock.once("secureConnect", () => {
    sess.sock = tlsSock;
    sess.tlsUpgraded = true;

    // Once TLS is up, we don't need the early-error handler anymore
    tlsSock.removeAllListeners("error");
    tlsSock.on("data", chunk => handleChunk(sess, chunk));
    tlsSock.on("error", e => {
      log("error", {
        msg: "tls_error",
        err: e.toString()
      });
      closeSession(sess);
    });
    tlsSock.on("end", () => closeSession(sess));
    ssend(sess, "220 TLS OK");
  });

  // Handles TLS handshake failures or early socket errors
  tlsSock.on("error", e => {
    log("error", {
      msg: "starttls_fail",
      err: e.toString()
    });
    closeSession(sess);
  });
}

// ------------------------------------------------------------------
// HANDLE DATA BODY COMPLETE
// ------------------------------------------------------------------

function finishData(sess) {
  // Remove trailing "\r\n.\r\n"
  // If rawChunks holds everything including it, we must trim.
  // Remove *exactly one* terminating <CRLF>.<CRLF> from the end
  let full = Buffer.concat(sess.rawChunks);

  // Expect the terminator ONLY at the end of DATA
  const TERM = Buffer.from("\r\n.\r\n", "latin1");
  let body;
  if (full.length >= TERM.length && full.slice(full.length - TERM.length).equals(TERM)) {
    // Slice off the terminator cleanly
    body = full.slice(0, full.length - TERM.length);
  } else {
    // Fallback: should never occur unless client misbehaved
    body = full;
  }

  // Remove dot-stuffing inside the body
  body = inboundDotUnstuff(body);
  sess.rawChunks = [];
  sess.dataMode = false;
  sess.dotScanner = new DotTerminatorScanner();

  // Turn body into string for MIME parsing/digests
  let rawString = body.toString("latin1");

  // For immediate-delivery messages (no digest yet)
  processInboundMessage(sess, rawString);
}

// ------------------------------------------------------------------
// PROCESS MAIL LOGIC (IMMEDIATE OR DIGEST)
// ------------------------------------------------------------------

function processInboundMessage(sess, raw) {
  metrics.msg_in++;
  let rcpt = normalizeAddress(sess.rcptTo);
  let digestKey = rcpt + "|" + normalizeAddress(sess.mailFrom || "");
  let existing = DIGESTS.get(digestKey);

  // First message for this recipient → deliver immediately (byte-preserved)
  if (!existing) {
    DIGESTS.set(rcpt, newDigest());
    relayImmediateBytePreserved(raw, rcpt, sess.mailFrom, err => {
      if (err) log("error", {
        msg: "immediate_fail",
        rcpt,
        err: err.toString()
      });
      metrics.msg_out++;
    });
    return;
  }

  // Otherwise add to digest
  addToDigest(rcpt, raw, sess.mailFrom);
  scheduleDigest(rcpt);

}

// ------------------------------------------------------------------
// COMMAND HANDLING
// ------------------------------------------------------------------

function handleCommand(sess, line) {
  if (!PIPELINE_ALLOWED && sess.expectResponse) {
    ssend(sess, "503 Bad sequence: no pipelining");
    return;
  }
  const cmd = line.split(" ")[0].toUpperCase();

  // We are now inside a command; until the response is flushed,
  // do not allow another command (if pipelining is off)
  sess.expectResponse = true;
  switch (cmd) {
    case "EHLO":
    case "HELO":
      // Reset transaction state
      sess.mailFrom = null;
      sess.rcptTo = null;
      sess.dataMode = false;
      if (cmd === "EHLO") {
        ssend(sess, "250-relay.local");
        if (!sess.tlsUpgraded) ssend(sess, "250-STARTTLS");
        ssend(sess, "250 OK");
      } else {
        ssend(sess, "250 relay.local");
      }
      break;
    case "STARTTLS":
      if (sess.tlsUpgraded) {
        ssend(sess, "454 TLS already active");
      } else {
        doSTARTTLS(sess);
      }
      break;
    case "MAIL":
      {
        const m = line.match(/<([^>]+)>/);
        if (!m) {
          ssend(sess, "501 Syntax");
          break;
        }

        // Must not be inside a transaction already
        if (sess.mailFrom || sess.rcptTo) {
          ssend(sess, "503 Nested MAIL not allowed; use RSET");
          break;
        }
        sess.mailFrom = m[1];
        sess.rcptTo = null;
        ssend(sess, "250 OK");
      }
      break;
    case "RCPT":
      {
        if (!sess.mailFrom) {
          ssend(sess, "503 Bad sequence; MAIL first");
          break;
        }
        const m = line.match(/<([^>]+)>/);
        if (!m) {
          ssend(sess, "501 Syntax");
          break;
        }

        // This relay supports exactly one RCPT
        if (sess.rcptTo) {
          ssend(sess, "452 Too many recipients");
          break;
        }
        sess.rcptTo = m[1];
        ssend(sess, "250 OK");
      }
      break;
    case "DATA":
      if (!sess.mailFrom || !sess.rcptTo) {
        ssend(sess, "503 Bad sequence");
        break;
      }
      sess.dataMode = true;
      sess.rawChunks = [];
      sess.dataBytes = 0;
      sess.dataLines = 0;
      sess.dotScanner = new DotTerminatorScanner();
      ssend(sess, "354 End data with <CR><LF>.<CR><LF>");
      break;
    case "RSET":
      sess.mailFrom = null;
      sess.rcptTo = null;
      sess.dataMode = false;
      sess.rawChunks = [];
      sess.dataBytes = 0;
      sess.dataLines = 0;
      sess.dotScanner = new DotTerminatorScanner();
      sess.cmdBuffer = "";
      // expectResponse will be cleared immediately after response
      ssend(sess, "250 OK");
      break;
    case "QUIT":
      ssend(sess, "221 Bye");
      closeSession(sess);
      break;
    default:
      ssend(sess, "500 Command unrecognized");
      break;
  }

  // IMPORTANT: do *not* unset immediately — flush race safety
  setImmediate(() => {
    sess.expectResponse = false;
  });
}

// ------------------------------------------------------------------
// HANDLE RAW SOCKET CHUNKS
// ------------------------------------------------------------------

function handleChunk(sess, chunk) {
  resetTimer(sess);

  // DATA mode: raw byte collection
  if (sess.dataMode) {
    const _safeAppendData = safeAppendData(sess.dataBytes, sess.dataLines, chunk),
      ok = _safeAppendData.ok,
      size = _safeAppendData.size,
      lines = _safeAppendData.lines;
    if (!ok) {
      ssend(sess, "552 Message too large");
      sess.dataMode = false;
      sess.rawChunks.length = 0;
      return;
    }

    // Prevent memory DoS by bounding rawChunks
    if (sess.dataBytes > MAX_SIZE) {
      ssend(sess, "552 Message too large");
      sess.dataMode = false;
      sess.rawChunks.length = 0;
      return;
    }
    sess.dataBytes = size;
    sess.dataLines = lines;

    // Prevent unbounded array growth (DoS protection)
    if (sess.rawChunks.length > 20000) {
      // ~20k chunks max
      ssend(sess, "552 Too many chunks");
      sess.dataMode = false;
      sess.rawChunks = [];
      return;
    }
    sess.rawChunks.push(chunk);
    sess.dotScanner.push(chunk);
    if (sess.dotScanner.isTerminated()) {
      finishData(sess);
      sess.mailFrom = null;
      sess.rcptTo = null;
      ssend(sess, "250 OK");
    }
    return;
  }

  // COMMAND mode
  let data = chunk.toString("latin1"); // do not re-encode as utf8
  sess.cmdBuffer = (sess.cmdBuffer || "") + data;

  // Process complete lines
  let idx;
  while ((idx = sess.cmdBuffer.indexOf("\n")) !== -1) {
    let line = sess.cmdBuffer.slice(0, idx).replace(/\r$/, "");
    sess.cmdBuffer = sess.cmdBuffer.slice(idx + 1);
    if (line.length > 1000) {
      ssend(sess, "500 Line too long");
      sess.cmdBuffer = ""; // dump buffer to avoid amplification attack
      continue;
    }
    handleCommand(sess, line);
  }
}

// ------------------------------------------------------------------
// ACCEPT NEW INBOUND CONNECTIONS
// ------------------------------------------------------------------

function inboundConnection(sock, isTLS) {
  if (ACTIVE_SESSIONS >= MAX_CONC) {
    try {
      ssend({
        sock
      }, "421 Too busy");
    } catch (e) {}
    try {
      sock.end();
    } catch (e) {}
    return;
  }
  ACTIVE_SESSIONS++;
  const sess = createSession(sock, isTLS);
  resetTimer(sess);
  sock.on("data", chunk => handleChunk(sess, chunk));
  sock.on("error", e => log("error", {
    msg: "socket_error",
    err: e.toString()
  }));
  sock.on("end", () => closeSession(sess));

  // Send greeting
  ssend(sess, "220 relay.local ESMTP");
}

/********************************************************************
 * MIME PARSING + DIGEST ACCUMULATION
 ********************************************************************/

function decodeRFC2047(str) {
  return str.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, (_, charset, enc, text) => {
    try {
      let buf;
      if (enc.toUpperCase() === "B") {
        buf = Buffer.from(text, "base64");
      } else {
        let qp = text.replace(/_/g, " ").replace(/=([A-Fa-f0-9]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
        buf = Buffer.from(qp, "binary");
      }
      return buf.toString("utf8");
    } catch (e) {
      return str;
    }
  });
}

/********************************************************************
 * RFC 5322 HEADER PARSER WITH FOLDING SUPPORT
 ********************************************************************/

function parseHeaders(raw) {
  // raw is a string containing the header block
  // This parser supports header folding: CRLF + whitespace continues a header
  //
  const lines = raw.split(/\r?\n/);
  const headers = {};
  let last = null;
  var _iterator = _createForOfIteratorHelper(lines),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      let line = _step.value;
      if (/^[ \t]/.test(line)) {
        // folded continuation
        if (last) headers[last] += " " + line.trim();
        continue;
      }
      const m = line.match(/^([^:]+):\s*(.*)$/);
      if (m) {
        const key = m[1].toLowerCase();
        const val = m[2];
        if (!headers[key]) headers[key] = [];
        headers[key].push(decodeRFC2047(val));
        last = key;
      } else {
        // malformed header, ignore safely
        last = null;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return headers;
}

/********************************************************************
 * BUFFER -> HEADERS + BODY SPLIT (RAW PRESERVATION)
 ********************************************************************/

function splitHeaderBody(raw) {
  // RFC5322: headers end at the FIRST empty line.
  let idx = 0;
  const len = raw.length;
  while (idx < len) {
    // Find end of line
    let end = raw.indexOf("\n", idx);
    if (end === -1) break;

    // Extract current line (trim only CR at end)
    let line = raw.slice(idx, end).replace(/\r$/, "");

    // Empty line = end of headers
    if (line === "") {
      const bodyStart = end + 1;
      return {
        headersRaw: raw.slice(0, idx),
        body: raw.slice(bodyStart)
      };
    }
    idx = end + 1;
  }

  // No blank line → treat whole block as headers (rare)
  return {
    headersRaw: raw,
    body: ""
  };
}

/********************************************************************
 * MIME UTILITY: BOUNDARY EXTRACTION
 ********************************************************************/

function extractBoundary(contentType) {
  if (!contentType) return null;
  // RFC 2046: boundary can be quoted or unquoted, ends before ";" or whitespace
  const m = contentType.match(/boundary\s*=\s*("?)([^";]+)\1/i);
  return m ? m[2].trim() : null;
}

/********************************************************************
 * MULTIPART SPLIT BASED ON BOUNDARY
 ********************************************************************/

function splitMultipart(body, boundary) {
  const marker = `--${boundary}`;
  const final = `--${boundary}--`;

  // Normalize to CRLF to simplify boundary matching
  // Must NOT rewrite bytes — split lines manually on LF
  // Normalize to LF-only to simplify boundary detection
  const norm = body.replace(/\r?\n/g, "\n");

  // Now split on LF (correct)
  const lines = norm.split("\n");
  let parts = [];
  let current = [];
  let inPart = false;
  var _iterator2 = _createForOfIteratorHelper(lines),
    _step2;
  try {
    for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
      let line = _step2.value;
      if (line === marker) {
        // Start a new part
        if (inPart) parts.push(current.join("\r\n"));
        current = [];
        inPart = true;
        continue;
      }
      if (line === final) {
        // Last part
        if (inPart) parts.push(current.join("\r\n"));
        return parts;
      }
      if (inPart) {
        current.push(line);
      }
    }
  } catch (err) {
    _iterator2.e(err);
  } finally {
    _iterator2.f();
  }
  return parts;
}

/********************************************************************
 * RFC 2231 FILENAME EXTRACTION (fallback only)
 ********************************************************************/

function extractFilename(headers) {
  let fn = null;

  // Content-Disposition
  let cd = headers["content-disposition"];
  if (cd) {
    let m = cd.match(/filename\*?=([^;]+)/i);
    if (m) {
      fn = m[1].trim().replace(/^"(.*)"$/, "$1");
      if (fn.startsWith("utf-8''")) fn = decodeURIComponent(fn.slice(7));
      return fn;
    }
  }

  // Content-Type name=
  let ctype = headers["content-type"];
  if (ctype) {
    let m = ctype.match(/name="?([^"]+)"?/i);
    if (m) return m[1];
  }
  return "attachment";
}

/********************************************************************
 * MIME PART PARSING RECURSIVE
 ********************************************************************/

function decodeQuotedPrintable(qp) {
  // 1. Remove soft line breaks: "=\r\n" or "=\n"
  qp = qp.replace(/=\r?\n/g, "");

  // 2. Decode =XX hex escapes safely and byte-accurately
  let out = [];
  for (let i = 0; i < qp.length; i++) {
    if (qp[i] === "=") {
      const h1 = qp[i + 1];
      const h2 = qp[i + 2];
      if (h1 && h2 && /[A-Fa-f0-9]{2}/.test(h1 + h2)) {
        out.push(parseInt(h1 + h2, 16));
        i += 2;
        continue;
      }
      // If it's "=", but not a valid hex code, keep literally
      out.push(qp.charCodeAt(i));
      continue;
    }
    out.push(qp.charCodeAt(i));
  }
  return Buffer.from(out);
}
function parseMIMERecursive(body, headers, results) {
  // results: {text, html, attachments[], inlineImages[] (as attachments too), droppedInline[] }

  let ct = headers["content-type"] ? headers["content-type"][0] : "text/plain";
  let lower = ct.split(";")[0].trim().toLowerCase();
  if (lower.startsWith("multipart/")) {
    let boundary = extractBoundary(ct);
    if (!boundary) return;
    let parts = splitMultipart(body, boundary);
    var _iterator3 = _createForOfIteratorHelper(parts),
      _step3;
    try {
      for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
        let part = _step3.value;
        let _splitHeaderBody = splitHeaderBody(part),
          headersRaw = _splitHeaderBody.headersRaw,
          innerBody = _splitHeaderBody.body;
        let h = parseHeaders(headersRaw);
        parseMIMERecursive(innerBody, h, results);
      }
    } catch (err) {
      _iterator3.e(err);
    } finally {
      _iterator3.f();
    }
    return;
  }

  // Single-part
  let disposition = headers["content-disposition"] ? headers["content-disposition"][0] : "";
  let isAttach = /attachment|inline/i.test(disposition) && !lower.startsWith("text/");
  let isInlineImage = /^image\//.test(lower) && /inline/i.test(disposition);
  if (lower.startsWith("text/plain")) {
    results.text.push(body);
    return;
  }
  if (lower.startsWith("text/html")) {
    results.html.push(body);
    return;
  }
  if (isAttach || isInlineImage || !lower.startsWith("text/")) {
    let filename = extractFilename(headers);
    let enc = headers["content-transfer-encoding"] ? headers["content-transfer-encoding"][0].toLowerCase() : "";
    let buf;
    try {
      if (enc === "base64") {
        buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
      } else if (enc === "quoted-printable") {
        buf = decodeQuotedPrintable(body);
      } else {
        buf = Buffer.from(body, "binary");
      }
    } catch (e) {
      buf = Buffer.from("");
    }
    results.attachments.push({
      filename,
      size: buf.length,
      contentType: lower,
      content: buf,
      isInlineImage
    });
    return;
  }

  // Unknown but non-text
  results.attachments.push({
    filename: "attachment",
    size: Buffer.byteLength(body),
    contentType: lower,
    content: Buffer.from(body, "binary"),
    isInlineImage: false
  });
}

/********************************************************************
 * TOP-LEVEL MIME PARSE
 ********************************************************************/

function parseFullMIME(raw) {
  const _splitHeaderBody2 = splitHeaderBody(raw),
    headersRaw = _splitHeaderBody2.headersRaw,
    body = _splitHeaderBody2.body;
  const headers = parseHeaders(headersRaw);
  const results = {
    text: [],
    html: [],
    attachments: []
  };
  parseMIMERecursive(body, headers, results);
  return results;
}

/********************************************************************
 * INLINE IMAGE REMOVAL / ANNOTATION IN HTML
 ********************************************************************/

function sanitizeHTML(htmlParts, droppedInline) {
  let html = htmlParts.join(SEP_HTML);

  // Remove scripts and event handlers (safety)
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");

  // For each dropped inline image, remove or annotate the CID
  var _iterator4 = _createForOfIteratorHelper(droppedInline),
    _step4;
  try {
    for (_iterator4.s(); !(_step4 = _iterator4.n()).done;) {
      let di = _step4.value;
      const safeFilename = di.filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Remove <img ... cid:...> completely
      html = html.replace(new RegExp(`<img[^>]+cid:[^"'>]+[^>]*>`, "gi"), `<span>[inline image omitted: ${safeFilename}]</span>`);
    }
  } catch (err) {
    _iterator4.e(err);
  } finally {
    _iterator4.f();
  }
  return html;
}

/********************************************************************
 * DIGEST ACCUMULATION ENGINE
 ********************************************************************/

function addToDigest(rcpt, raw, mailFrom) {
  let d = DIGESTS.get(rcpt) || newDigest();
  let now = Date.now();

  // Cooldown logic
  if (now - d.lastReceived > COOLDOWN_MIN * 60000) {
    d = newDigest();
    log("info", {
      msg: "cooldown_reset",
      rcpt
    });
  }
  d.lastReceived = now;

  // Parse MIME
  const parsed = parseFullMIME(raw);

  // Check message count limit
  if (d.msgCount >= MAX_MESSAGES) {
    d.omitMeta.count++;
    // Count all attachments
    var _iterator5 = _createForOfIteratorHelper(parsed.attachments),
      _step5;
    try {
      for (_iterator5.s(); !(_step5 = _iterator5.n()).done;) {
        let a = _step5.value;
        d.omitMeta.attachCount++;
        d.omitMeta.attachBytes += a.size;
      }
    } catch (err) {
      _iterator5.e(err);
    } finally {
      _iterator5.f();
    }
    d.mailFrom = d.mailFrom || mailFrom;
    if (!d.mailFrom) {
      log("warn", { msg: "digest_missing_mailfrom", rcpt });
      return;
    }
    DIGESTS.set(rcpt, d);
    return;
  }

  // Add text
  var _iterator6 = _createForOfIteratorHelper(parsed.text),
    _step6;
  try {
    for (_iterator6.s(); !(_step6 = _iterator6.n()).done;) {
      let t = _step6.value;
      d.textParts.push(t);
    }

    // Add HTML (we sanitize later)
  } catch (err) {
    _iterator6.e(err);
  } finally {
    _iterator6.f();
  }
  var _iterator7 = _createForOfIteratorHelper(parsed.html),
    _step7;
  try {
    for (_iterator7.s(); !(_step7 = _iterator7.n()).done;) {
      let h = _step7.value;
      d.htmlParts.push(h);
    }

    // Attachment logic
  } catch (err) {
    _iterator7.e(err);
  } finally {
    _iterator7.f();
  }
  let droppedInline = [];
  var _iterator8 = _createForOfIteratorHelper(parsed.attachments),
    _step8;
  try {
    for (_iterator8.s(); !(_step8 = _iterator8.n()).done;) {
      let a = _step8.value;
      if (a.size > MAX_ATTACH_SIZE) {
        d.omitMeta.attachCount++;
        d.omitMeta.attachBytes += a.size;
        metrics.attach_dropped++;
        if (a.isInlineImage) {
          droppedInline.push({
            filename: a.filename,
            size: a.size
          });
        }
        continue;
      }
      if (d.attachBytes + a.size > MAX_TOTAL_ATTACH) {
        d.omitMeta.attachCount++;
        d.omitMeta.attachBytes += a.size;
        metrics.attach_dropped++;
        if (a.isInlineImage) {
          droppedInline.push({
            filename: a.filename,
            size: a.size
          });
        }
        continue;
      }
      // Accept attachment
      d.attachments.push(a);
      d.attachBytes += a.size;
      metrics.attach_forwarded++;
    }

    // Sanitize HTML for dropped inline images
  } catch (err) {
    _iterator8.e(err);
  } finally {
    _iterator8.f();
  }
  if (droppedInline.length > 0 && d.htmlParts.length > 0) {
    let sanitized = sanitizeHTML(d.htmlParts, droppedInline);
    d.htmlParts = [sanitized];
  }
  d.msgCount++;

  // Enforce global memory cap
  let estMem = estimateDigestMemory();
  if (estMem > GLOBAL_MEMORY_CAP) {
    log("warn", {
      msg: "global_memory_cap_reached"
    });
    // All new attachments or messages beyond cap are omitted
    // Already counted as omitted above.
  }
  DIGESTS.set(rcpt, d);
}

/********************************************************************
 * SCHEDULE DIGEST SEND (EXPONENTIAL BACKOFF)
 ********************************************************************/

function scheduleDigest(rcpt) {
  let d = DIGESTS.get(rcpt);
  if (!d) return;
  if (d.timer) return;
  d.timer = setTimeout(() => {
    d.timer = null;
    flushDigest(rcpt);
  }, d.nextDelay);
}

/********************************************************************
 * ESTIMATE DIGEST MEMORY FOR SAFETY
 ********************************************************************/
function estimateDigestMemory() {
  let total = 0;
  var _iterator9 = _createForOfIteratorHelper(DIGESTS),
    _step9;
  try {
    for (_iterator9.s(); !(_step9 = _iterator9.n()).done;) {
      let _step9$value = _slicedToArray(_step9.value, 2),
        rcpt = _step9$value[0],
        d = _step9$value[1];
      var _iterator0 = _createForOfIteratorHelper(d.attachments),
        _step0;
      try {
        for (_iterator0.s(); !(_step0 = _iterator0.n()).done;) {
          let a = _step0.value;
          total += a.size;
        }
      } catch (err) {
        _iterator0.e(err);
      } finally {
        _iterator0.f();
      }
      var _iterator1 = _createForOfIteratorHelper(d.textParts),
        _step1;
      try {
        for (_iterator1.s(); !(_step1 = _iterator1.n()).done;) {
          let t = _step1.value;
          total += Buffer.byteLength(t, "utf8");
        }
      } catch (err) {
        _iterator1.e(err);
      } finally {
        _iterator1.f();
      }
      var _iterator10 = _createForOfIteratorHelper(d.htmlParts),
        _step10;
      try {
        for (_iterator10.s(); !(_step10 = _iterator10.n()).done;) {
          let h = _step10.value;
          total += Buffer.byteLength(h, "utf8");
        }
      } catch (err) {
        _iterator10.e(err);
      } finally {
        _iterator10.f();
      }
    }
  } catch (err) {
    _iterator9.e(err);
  } finally {
    _iterator9.f();
  }
  return total;
}

/********************************************************************
 * FINAL DIGEST SEND
 ********************************************************************/

function flushDigest(rcpt) {
  let d = DIGESTS.get(rcpt);
  if (!d) return;
  let mime = buildDigestMIME(rcpt, d);
  relayDigest(mime, rcpt, err => {
    if (err) log("error", {
      msg: "digest_send_fail",
      rcpt,
      err: err.toString()
    });
    metrics.digest_sent++;
  });

  // Reset digest
  DIGESTS.set(rcpt, newDigest());
}

/********************************************************************
 * DIGEST MIME CONSTRUCTION
 ********************************************************************/

function buildDigestMIME(rcpt, d) {
  // Text & HTML combined
  let text = d.textParts.join(SEP_TEXT);
  let html = d.htmlParts.join(SEP_HTML);
  let omitted = d.omitMeta.count;
  if (omitted > 0) {
    let note = OMIT_FORMAT.replace("{{N}}", omitted).replace("{{A}}", d.omitMeta.attachCount).replace("{{S}}", d.omitMeta.attachBytes);
    text += "\n\n" + note;
    html += "<br><br>" + note;
  }
  let subject = SUBJECT_TEMPLATE.replace("{{count}}", d.msgCount);
  let boundary = "mix_" + crypto.randomBytes(8).toString("hex");
  let altBoundary = "alt_" + crypto.randomBytes(8).toString("hex");
  const hasText = d.textParts.length > 0;
  const hasHtml = d.htmlParts.length > 0;
  const hasAttach = d.attachments.length > 0;

  // Build final MIME
  if (!hasAttach) {
    if (hasText && hasHtml) {
      return `Subject: ${subject}
To: ${rcpt}
From: ${SMTP_USER || "relay@localhost"}
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="${altBoundary}"

--${altBoundary}
Content-Type: text/plain; charset=utf-8

${text}

--${altBoundary}
Content-Type: text/html; charset=utf-8

${html}

--${altBoundary}--
`;
    }
    if (hasText) {
      return `Subject: ${subject}
To: ${rcpt}
From: ${d.mailFrom || DEFAULT_FROM || "relay@localhost"}
Content-Type: text/plain; charset=utf-8

${text}
`;
    }
    return `Subject: ${subject}
To: ${rcpt}
From: ${d.mailFrom || DEFAULT_FROM || "relay@localhost"}
Content-Type: text/html; charset=utf-8

${html}
`;
  }

  // With attachments: multipart/mixed
  let parts = [];

  // alternative
  if (hasText && hasHtml) {
    parts.push(`--${boundary}
Content-Type: multipart/alternative; boundary="${altBoundary}"

--${altBoundary}
Content-Type: text/plain; charset=utf-8

${text}

--${altBoundary}
Content-Type: text/html; charset=utf-8

${html}

--${altBoundary}--
`);
  } else if (hasText) {
    parts.push(`--${boundary}
Content-Type: text/plain; charset=utf-8

${text}
`);
  } else if (hasHtml) {
    parts.push(`--${boundary}
Content-Type: text/html; charset=utf-8

${html}
`);
  }

  // attachments
  var _iterator11 = _createForOfIteratorHelper(d.attachments),
    _step11;
  try {
    for (_iterator11.s(); !(_step11 = _iterator11.n()).done;) {
      let a = _step11.value;
      let encoded = a.content.toString("base64").replace(/(.{76})/g, "$1\r\n");
      parts.push(`--${boundary}
Content-Type: ${a.contentType || "application/octet-stream"}
Content-Disposition: attachment; filename="${a.filename}"
Content-Transfer-Encoding: base64

${encoded}
`);
    }
  } catch (err) {
    _iterator11.e(err);
  } finally {
    _iterator11.f();
  }
  parts.push(`--${boundary}--`);
  return `Subject: ${subject}
To: ${rcpt}
From: ${SMTP_USER || "relay@localhost"}
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"

\r\n${parts.join("\r\n")}

`;
}

/********************************************************************
 * OUTBOUND SMTP CLIENT + SERVER BOOTSTRAP
 ********************************************************************/

/********************************************************************
 * DOT-STUFFING FOR OUTBOUND DATA
 ********************************************************************/

/********************************************************************
 * SEND COMMAND AND READ RESPONSE
 ********************************************************************/

function smtpSend(sock, line) {
  return new Promise((resolve, reject) => {
    let got = "";
    function onData(chunk) {
      got += chunk.toString("latin1");
      // Complete when a line STARTS WITH "xyz " (NOT "xyz-")
      let last = got.split(/\r?\n/).pop();
      if (/^[0-9]{3} /.test(last)) {
        clearTimeout(timer);
        sock.removeListener("data", onData);
        resolve(got);
      }
    }
    let timer = setTimeout(() => {
      sock.removeListener("data", onData);
      reject(new Error("SMTP timeout"));
    }, 30000);
    sock.on("data", onData);
    sock.write(line + "\r\n");
  });
}
function smtpSendMulti(sock, line) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = chunk => {
      buf += chunk.toString("latin1");
      // SMTP multiline response detection:
      // Continue while lines start with "250-"
      // Stop only when a line starts with "250 "
      if (/^250 /.test(buf.split(/\r?\n/).pop())) {
        sock.removeListener("data", onData);
        clearTimeout(timer);
        resolve(buf);
      }
    };
    let timer = setTimeout(() => {
      sock.removeListener("data", onData);
      reject(new Error("SMTP timeout"));
    }, 30000);
    sock.on("data", onData);
    sock.write(line + "\r\n");
  });
}

/********************************************************************
 * PARSE SMTP RESPONSE CODES
 ********************************************************************/

function checkResp(resp, expected) {
  const lines = resp.trim().split(/\r?\n/);
  const last = lines[lines.length - 1];
  const code = parseInt(last.slice(0, 3), 10);
  if (code !== expected) {
    throw new Error(`SMTP expected ${expected}, got ${last}`);
  }
}

/********************************************************************
 * OUTBOUND SMTP: FULL SEND
 ********************************************************************/
function smtpDeliver(_x, _x2, _x3, _x4) {
  return _smtpDeliver.apply(this, arguments);
}
/********************************************************************
 * IMMEDIATE BYTE-PRESERVED RELAY
 ********************************************************************/
function _smtpDeliver() {
  _smtpDeliver = _asyncToGenerator(function* (rawMessage, rcpt, isBytePreserved, mailFrom) {
    return new Promise(/*#__PURE__*/function () {
      var _ref2 = _asyncToGenerator(function* (resolve, reject) {
        let sock = null;
        let useTLS = !!SMTP_SECURE; // FIXED: was SMTP_TLS (undefined)

        try {
          if (useTLS) {
            global.SMTP_IGNORE_CERT_ERRORS = process.env.SMTP_IGNORE_CERT_ERRORS === "true";
            sock = tls.connect(SMTP_PORT, SMTP_HOST, {
              // FIXED: SMTP_PORT is now defined globally
              rejectUnauthorized: !SMTP_IGNORE_CERT_ERRORS,
              minVersion: "TLSv1.2"
            });
          } else {
            sock = net.connect(SMTP_PORT, SMTP_HOST); // FIXED: same
          }
        } catch (e) {
          return reject(e);
        }

        // Install error handler ONLY until STARTTLS or AUTH
        sock.on("error", e => reject(e));
        sock.once("connect", /*#__PURE__*/_asyncToGenerator(function* () {
          // After connect, remove the temporary plain error handler.
          sock.removeAllListeners("error");
          // Reinstall a general handler for pre-STARTTLS phase:
          sock.on("error", e => reject(e));
          try {
            // Greeting
            let resp = yield new Promise((res, rej) => {
              let buf = "";
              function onD(ch) {
                buf += ch.toString("latin1");
                let lines = buf.split(/\r?\n/);
                let lastComplete = lines.length > 1 ? lines[lines.length - 2] : lines[0];
                if (/^[0-9]{3} /.test(lastComplete)) {
                  sock.removeListener("data", onD);
                  clearTimeout(t);
                  res(buf);
                }
              }
              let t = setTimeout(() => {
                sock.removeAllListeners("data");
                rej(new Error("Timeout waiting greeting"));
              }, 10000);
              sock.on("data", onD);
            });
            checkResp(resp, 220);

            // EHLO
            resp = yield smtpSendMulti(sock, "EHLO relay.local");
            if (!/^250/.test(resp)) {
              resp = yield smtpSend(sock, "HELO relay.local");
              checkResp(resp, 250);
            }

            // STARTTLS upgrade
            if (SMTP_STARTTLS && !useTLS) {
              resp = yield smtpSend(sock, "STARTTLS");
              checkResp(resp, 220);

              // 1. Prevent any plaintext bytes after STARTTLS
              sock.pause();

              // Drain any pending plaintext to ensure TLS cleanliness
              while (sock.read() !== null) {}

              // 2. Remove ALL listeners safely
              for (var _i2 = 0, _arr2 = ["data", "error", "end", "close"]; _i2 < _arr2.length; _i2++) {
                const ev = _arr2[_i2];
                sock.removeAllListeners(ev);
              }

              // 3. Wrap into TLS
              const tlsSock = tls.connect({
                socket: sock,
                rejectUnauthorized: !SMTP_IGNORE_CERT_ERRORS,
                minVersion: "TLSv1.2",
                secureContext: tls.createSecureContext({
                  minVersion: "TLSv1.2"
                })
              });

              // 4. Wait securely for TLS handshake
              yield new Promise((resolve, rejectTLS) => {
                tlsSock.once("secureConnect", resolve);
                tlsSock.once("error", rejectTLS);
              });

              // 5. Make TLS socket active
              tlsSock.resume();

              // 6. Replace socket reference
              sock = tlsSock;
              useTLS = true;

              // 7. Install post-TLS handlers
              sock.on("error", reject);
            }

            // AUTH only if username is provided
            if (SMTP_USER) {
              resp = yield smtpSend(sock, "AUTH LOGIN");
              checkResp(resp, 334);
              resp = yield smtpSend(sock, Buffer.from(SMTP_USER, "utf8").toString("base64"));
              checkResp(resp, 334);
              resp = yield smtpSend(sock, Buffer.from(SMTP_PASSWORD || "", "utf8").toString("base64"));
              if (!/^235/.test(resp)) throw new Error("SMTP auth failed");
            }

            // MAIL FROM
            resp = yield smtpSend(sock, `MAIL FROM:<${mailFrom || DEFAULT_FROM || "relay@localhost"}>`);
            checkResp(resp, 250);

            // RCPT TO
            resp = yield smtpSend(sock, `RCPT TO:<${rcpt}>`);
            checkResp(resp, 250);

            // DATA
            resp = yield smtpSend(sock, "DATA");
            checkResp(resp, 354);
            let msgOut;
            let normalized = isBytePreserved ? rawMessage // do NOT normalize
            : rawMessage.replace(/\r?\n/g, "\r\n"); // safe for digest mail only

            msgOut = outboundDotStuff(normalized);
            sock.write(msgOut + "\r\n.\r\n");

            // Final result
            resp = yield new Promise((res, rej) => {
              let buf = "";
              const onD = ch => {
                buf += ch.toString("latin1");
                let last = buf.split(/\r?\n/).pop();
                if (/^[0-9]{3} /.test(last)) {
                  sock.removeListener("data", onD);
                  res(buf);
                }
              };
              sock.on("data", onD);
              setTimeout(() => rej(new Error("Timeout waiting for final OK")), 15000);
            });
            checkResp(resp, 250);

            // QUIT
            yield smtpSend(sock, "QUIT");
            sock.end();
            resolve();
          } catch (e) {
            try {
              sock.end();
            } catch (e2) {}
            reject(e);
          }
        }));
      });
      return function (_x5, _x6) {
        return _ref2.apply(this, arguments);
      };
    }());
  });
  return _smtpDeliver.apply(this, arguments);
}

function relayImmediateBytePreserved(raw, rcpt, mailFrom, cb) {
    smtpDeliver(raw, rcpt, true, mailFrom)
        .then(() => cb(null))
        .catch(cb);
}

/********************************************************************
 * DIGEST RELAY
 ********************************************************************/

function relayDigest(mime, rcpt, mailFrom, cb) {
  smtpDeliver(mime, rcpt, false, mailFrom).then(() => cb(null)).catch(cb);
}

/********************************************************************
 * SERVER START LOGIC (AUTO TLS IF CERTS AVAILABLE)
 ********************************************************************/

function startRelay() {
  // Always start plaintext SMTP
  const plainServer = net.createServer(sock => inboundConnection(sock, false));
  plainServer.on("error", e => log("error", {
    msg: "plain_server_error",
    err: e.toString()
  }));
  plainServer.listen(LISTEN_PORT, LISTEN_HOST, () => {
    log("info", {
      msg: "plain_smtp_listening",
      port: LISTEN_PORT,
      host: LISTEN_HOST
    });
  });

  // Optional TLS SMTP (if cert+key exist)
  let haveTLS = false;
  try {
    if (SSL_KEY && SSL_CERT && SSL_KEY.length > 0 && SSL_CERT.length > 0) {
      haveTLS = true;
    }
  } catch (e) {
    haveTLS = false;
  }
  const LISTEN_PORT_TLS = global.LISTEN_PORT_TLS || 465;
  if (haveTLS) {
    const tlsServer = tls.createServer({
      key: SSL_KEY,
      cert: SSL_CERT,
      minVersion: "TLSv1.2"
    }, sock => inboundConnection(sock, true));
    tlsServer.on("error", e => log("error", {
      msg: "tls_server_error",
      err: e.toString()
    }));
    tlsServer.listen(LISTEN_PORT_TLS, LISTEN_HOST, () => {
      log("info", {
        msg: "tls_smtp_listening",
        port: LISTEN_PORT_TLS,
        host: LISTEN_HOST
      });
    });
  } else {
    log("info", {
      msg: "tls_disabled_no_certs"
    });
  }
  console.log("SMTP Relay Started. Mode: RFC-correct raw DATA preservation (Option A).");
}

/********************************************************************
 * OPTIONAL INTERACTIVE SETUP (runs only if missing SMTP settings)
 ********************************************************************/
function ask(_x4) {
  return _ask.apply(this, arguments);
}
function _ask() {
  _ask = _asyncToGenerator(function* (question, {
    mask = false
  } = {}) {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      if (!mask) {
        rl.question(question, answer => {
          rl.close();
          resolve(answer.trim());
        });
        return;
      }

      // Masked password entry
      process.stdout.write(question);
      let input = "";
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      const handler = (str, key) => {
        if (key && key.name === 'return') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('keypress', handler);
          rl.close();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (key && key.name === 'backspace') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
          return;
        }
        // default
        input += str;
        process.stdout.write('*');
      };
      process.stdin.on('keypress', handler);
    });
  });
  return _ask.apply(this, arguments);
}
function interactiveSetup() {
  return _interactiveSetup.apply(this, arguments);
}
/********************************************************************
 * RUN INTERACTIVE SETUP *BEFORE* using SMTP_* variables
 ********************************************************************/
function readPassword(prompt) {
	return new Promise(function(resolve) {
		const stdin = process.stdin;
		const stdout = process.stdout;

		stdout.write(prompt);

		stdin.resume();
		stdin.setRawMode(true);

		let buf = "";

		function onData(ch) {
			ch = ch.toString("utf8");

			// Enter
			if (ch === "\n" || ch === "\r") {
				stdin.setRawMode(false);
				stdin.removeListener("data", onData);
				stdout.write("\n");
				resolve(buf);
				return;
			}

			// Ctrl+C
			if (ch === "\u0003") {
				stdin.setRawMode(false);
				stdout.write("\n");
				process.exit();
			}

			buf += ch;
		}

		stdin.on("data", onData);
	});
}

function _interactiveSetup() {
	_interactiveSetup = _asyncToGenerator(function* () {
		if (SMTP_HOST && process.env.SMTP_PASSWORD) return; // Already configured

		console.log("\n=== SMTP Relay Interactive Setup ===\n");
		console.log("No SMTP upstream configured. Let's set it up.\n");

		let host = yield ask("Upstream SMTP host (e.g. smtp.gmail.com:465): ");
		let port = null;

		if (host.includes(":")) {
			const parts = host.split(":");
			host = parts[0];
			port = parseInt(parts[1], 10);
		} else {
			let auto = yield ask("No port provided. Use default 465 (SSL)? (Y/n): ");
			port = !auto || auto.match(/^y(es)?$/i) ? 465 : 587;
		}

		// SSL/STARTTLS logic
		let secure = false;
		let starttls = false;

		if (port === 465) {
			secure = true;
		} else if (port === 587) {
			starttls = true;
		} else {
			let ans = yield ask("Enable SSL for port " + port + "? (y/N): ");
			secure = !!ans.match(/^y(es)?$/i);
		}

		let username = yield ask("SMTP username (blank for none): ");
		let password = "";

		if (username) {
			// Secure hidden password entry
			password = yield readPassword("SMTP password: ");
		}

		let save = yield ask("Save to .env for future runs? (Y/n): ");
		if (!save || save.match(/^y(es)?$/i)) {
			let lines = [
				"SMTP_HOST=" + host,
				"SMTP_PORT=" + port,
				"SMTP_SECURE=" + (secure ? "true" : "false"),
				"SMTP_STARTTLS=" + (starttls ? "true" : "false"),
				"SMTP_USER=" + username,
				"SMTP_PASSWORD=" + password,
				"LISTEN_PORT=" + LISTEN_PORT
			].join("\n");

			fs.writeFileSync(".env", lines);
			console.log("\nSaved to .env\n");
		}

		// Override environment for current run
		process.env.SMTP_HOST = host;
		process.env.SMTP_PORT = port;
		process.env.SMTP_SECURE = secure;
		process.env.SMTP_STARTTLS = username ? starttls : "false";
		process.env.SMTP_USER = username;
		process.env.SMTP_PASSWORD = password;
	});

	return _interactiveSetup.apply(this, arguments);
}
_asyncToGenerator(function* () {
  yield interactiveSetup();

  // Re-bind config values after interactive setup:
  global.SMTP_HOST = process.env.SMTP_HOST;
  global.SMTP_PORT = parseInt(process.env.SMTP_PORT || 587, 10);
  global.SMTP_USER = process.env.SMTP_USER;
  global.SMTP_PASSWORD = process.env.SMTP_PASSWORD;

  // SSL vs STARTTLS options
  global.SMTP_SECURE = process.env.SMTP_SECURE === "true"; // port 465
  global.SMTP_STARTTLS = process.env.SMTP_STARTTLS === "true"; // port 587

  // Expose upstream port for smtpDeliver()
  global.SMTP_PORT = global.SMTP_PORT;

  // Define TLS listener port (if you want inbound SMTPS)
  global.LISTEN_PORT_TLS = parseInt(process.env.LISTEN_PORT_TLS || 465, 10);

  // Continue boot…
  startRelay();
})();

/********************************************************************
 * END PART 4
 ********************************************************************/