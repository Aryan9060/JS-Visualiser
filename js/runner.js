/* JS Visualizer — Run mode: execute code in a sandboxed iframe, capture console + errors. */
window.JV = window.JV || {};

JV.Runner = (function () {
  'use strict';

  var PLACEHOLDER_DOC = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;' +
    'background:#0d1117;color:#6e7681;font:14px system-ui,sans-serif;text-align:center;user-select:none}' +
    '.ph{display:flex;flex-direction:column;gap:10px;align-items:center}' +
    '.ph .arrow{font-size:26px;color:#1f6feb;opacity:.85}' +
    'kbd{font:600 12px ui-monospace,Consolas,monospace;background:#161b22;border:1px solid #30363d;' +
    'border-bottom-width:2px;border-radius:6px;padding:2px 8px;color:#c9d1d9}' +
    '</style></head><body><div class="ph"><div class="arrow">&#9654;</div>' +
    '<div>Press <kbd>Run</kbd> (or Ctrl+Enter) to execute your code</div>' +
    '<div style="font-size:12px;opacity:.7">DOM and canvas output is rendered right here</div>' +
    '</div></body></html>';

  var RUNTIME = function (off) {
    window.__jvizOff = off || 0;
    var post = function (level, trees, extra) {
      var msg = { __jviz: 1, level: level, trees: trees, ts: Date.now() };
      if (extra) for (var k in extra) msg[k] = extra[k];
      try { parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
    };
    var postText = function (level, text) {
      try { parent.postMessage({ __jviz: 1, level: level, text: text, ts: Date.now() }, '*'); } catch (e) { /* ignore */ }
    };

    function fmt(v, depth, seen) {
      var t = typeof v;
      if (v === null) return { k: 'null' };
      if (t === 'undefined') return { k: 'undef' };
      if (t === 'string') return { k: 'str', v: v.length > 400 ? v.slice(0, 400) + '\u2026' : v };
      if (t === 'number') return { k: 'num', v: String(v) };
      if (t === 'boolean') return { k: 'bool', v: v };
      if (t === 'bigint') return { k: 'num', v: v.toString() + 'n' };
      if (t === 'symbol') return { k: 'sym', v: v.toString() };
      if (t === 'function') return { k: 'fn', v: '\u0192 ' + (v.name || 'anonymous') };
      if (v instanceof Error) return { k: 'err', v: (v.name || 'Error') + ': ' + v.message };
      if (seen.indexOf(v) !== -1) return { k: 'circ', v: '[Circular]' };
      if (depth < 0) {
        return { k: 'deep', v: Array.isArray(v) ? 'Array(' + v.length + ')' : '{ \u2026 }' };
      }
      try {
        if (typeof Element !== 'undefined' && v instanceof Element) {
          var tag = '<' + v.tagName.toLowerCase();
          if (v.id) tag += '#' + v.id;
          else if (typeof v.className === 'string' && v.className.trim()) tag += '.' + v.className.trim().split(/\s+/).join('.');
          return { k: 'node', v: tag + '>' };
        }
        if (typeof Node !== 'undefined' && v instanceof Node) return { k: 'node', v: v.nodeName };
      } catch (e) { /* cross-realm */ }
      seen.push(v);
      var node, i, keys;
      if (Array.isArray(v)) {
        node = { k: 'arr', n: v.length, items: [] };
        var lim = Math.min(v.length, 100);
        for (i = 0; i < lim; i++) node.items.push([String(i), fmt(v[i], depth - 1, seen)]);
        if (v.length > lim) node.more = v.length - lim;
      } else if (typeof Map !== 'undefined' && v instanceof Map) {
        node = { k: 'map', n: v.size, items: [] };
        i = 0;
        v.forEach(function (val, key) { if (i++ < 100) node.items.push([String(key), fmt(val, depth - 1, seen)]); });
      } else if (typeof Set !== 'undefined' && v instanceof Set) {
        node = { k: 'set', n: v.size, items: [] };
        i = 0;
        v.forEach(function (val) { if (i < 100) node.items.push([String(i++), fmt(val, depth - 1, seen)]); });
      } else if (typeof Date !== 'undefined' && v instanceof Date) {
        node = { k: 'obj', ctor: 'Date', items: [['iso', { k: 'str', v: isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString() }]] };
      } else if (typeof RegExp !== 'undefined' && v instanceof RegExp) {
        node = { k: 'obj', ctor: 'RegExp', items: [['pattern', { k: 'str', v: String(v) }]] };
      } else if (typeof Promise !== 'undefined' && v instanceof Promise) {
        node = { k: 'obj', ctor: 'Promise', items: [] };
      } else {
        var ctor = null;
        try {
          if (v.constructor && v.constructor.name && v.constructor.name !== 'Object') ctor = v.constructor.name;
        } catch (e2) { /* ignore */ }
        node = { k: 'obj', ctor: ctor, items: [] };
        keys = Object.keys(v);
        var lim2 = Math.min(keys.length, 100);
        for (i = 0; i < lim2; i++) {
          var val2;
          try { val2 = v[keys[i]]; } catch (e3) { val2 = undefined; }
          node.items.push([keys[i], fmt(val2, depth - 1, seen)]);
        }
        if (keys.length > lim2) node.more = keys.length - lim2;
      }
      seen.pop();
      return node;
    }

    function fmtArgs(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) out.push(fmt(args[i], 3, []));
      return out;
    }

    var origConsole = {
      log: window.console.log, info: window.console.info, warn: window.console.warn,
      error: window.console.error, debug: window.console.debug
    };
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      window.console[level] = function () {
        post(level, fmtArgs(arguments));
        try { origConsole[level].apply(window.console, arguments); } catch (e) { /* ignore */ }
      };
    });
    window.console.table = function () { post('log', fmtArgs(arguments)); };
    var counters = {};
    window.console.count = function (label) {
      label = label === undefined ? 'default' : String(label);
      counters[label] = (counters[label] || 0) + 1;
      post('log', [{ k: 'str', v: label + ': ' + counters[label] }]);
    };
    var timers = {};
    window.console.time = function (label) { timers[label === undefined ? 'default' : String(label)] = Date.now(); };
    window.console.timeEnd = function (label) {
      label = label === undefined ? 'default' : String(label);
      var t0 = timers[label];
      post('log', [{ k: 'str', v: label + ': ' + (t0 === undefined ? 'timer not started' : (Date.now() - t0) + 'ms') }]);
    };

    window.alert = function () { post('alert', fmtArgs(arguments)); };

    window.onerror = function (message, src, lineno, colno, err) {
      window.__jvizErrored = true;
      var tree;
      if (err instanceof Error) tree = { k: 'err', v: (err.name || 'Error') + ': ' + err.message };
      else tree = { k: 'err', v: String(message) };
      var line = null;
      if (lineno) {
        line = lineno - window.__jvizOff;
        if (line < 1) line = null;
      }
      post('uncaught', [tree], { line: line });
      return false;
    };

    window.addEventListener('unhandledrejection', function (e) {
      window.__jvizErrored = true;
      var r = e.reason;
      var text = 'Unhandled promise rejection: ' + (r instanceof Error ? (r.name + ': ' + r.message) : String(r));
      post('uncaught', [{ k: 'err', v: text }]);
    });

    // The parent re-shows the preview pane after step mode; canvas/DOM code
    // that measures the viewport listens for resize, so replay one.
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.__jvizResize) {
        try { window.dispatchEvent(new Event('resize')); } catch (err) { /* ignore */ }
      }
    });

    // mark end of synchronous execution
    window.__jvizEnd = function () {
      if (!window.__jvizErrored) postText('system', 'script finished \u2014 preview is live');
    };
  };

  function Runner() {
    this.frame = null;
    this.onMessage = null;
    this.onStatus = null;
    this._gen = 0;
    this._watchdog = 0;
    this._gotPost = false;
    this._doc = null;
  }

  Runner.prototype.init = function (opts) {
    this.frame = opts.frame;
    this.onMessage = opts.onMessage || function () {};
    this.onStatus = opts.onStatus || function () {};
    var self = this;
    window.addEventListener('message', function (e) {
      if (e.source !== self.frame.contentWindow) return;
      var d = e.data;
      if (!d || d.__jviz !== 1) return;
      self._gotPost = true;
      self.onMessage(d);
    });
    // Assign the placeholder asynchronously: navigating a sandboxed iframe
    // while the page is still parsing can drop the navigation (and a boot-time
    // auto-run right after would then never execute).
    setTimeout(function () {
      if (!self.frame.srcdoc) self.frame.srcdoc = PLACEHOLDER_DOC;
    }, 0);
  };

  Runner.prototype.clear = function () {
    this._gen++;
    clearTimeout(this._watchdog);
    this._doc = null;
    this.frame.srcdoc = PLACEHOLDER_DOC;
  };

  Runner.prototype.run = function (code) {
    var safeCode = code.replace(/<\/(script)/gi, '<\\/$1');
    var runtimeSrc = ';(' + RUNTIME.toString() + ')(';
    var head = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>body{margin:0;padding:14px;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#ffffff;color:#111111}' +
      'canvas{display:block}</style>' +
      '<script>' + runtimeSrc;
    var bodyOpen = ');</script></head><body><script>\n';
    var offset = (head + '0' + bodyOpen).split('\n').length - 1;
    this._doc = head + offset + bodyOpen + safeCode + '\n</script><script>window.__jvizEnd();</script></body></html>';
    this._nav(this._doc);
  };

  // srcdoc navigation can be dropped (notably right after page load in some
  // engines). A run always posts at least "script finished" or "uncaught", so
  // silence after the grace window means the doc never executed — retry once.
  //
  // The navigation is also deferred past the next layout: when Run fires in
  // the same task that shows the preview pane (loading a canvas example from
  // step mode, or the boot auto-run), a same-tick srcdoc assignment can start
  // the sandbox document with a 0x0 viewport — canvas code then measures
  // window.innerWidth/Height as 0 and renders nothing until a later resize.
  Runner.prototype._nav = function (doc) {
    var self = this;
    var gen = ++this._gen;
    this._gotPost = false;
    var applied = false;
    var apply = function () {
      if (applied || self._gen !== gen) return;
      applied = true;
      void self.frame.offsetWidth; // flush pending layout so the iframe has its real size
      self.frame.srcdoc = doc;
      clearTimeout(self._watchdog);
      self._watchdog = setTimeout(function () {
        if (self._gen !== gen || self._gotPost) return;
        self._gen++;
        self.frame.srcdoc = doc;
      }, 2500);
    };
    requestAnimationFrame(apply);
    setTimeout(apply, 120); // engines that throttle rAF (hidden page, headless)
  };

  // Re-fire a resize inside the sandbox so canvas apps re-measure when the
  // preview pane is shown again after step mode.
  Runner.prototype.nudge = function () {
    var self = this;
    var send = function () {
      try {
        if (self.frame.contentWindow) {
          self.frame.contentWindow.postMessage({ __jvizResize: 1 }, '*');
        }
      } catch (e) { /* ignore */ }
    };
    requestAnimationFrame(send);
    setTimeout(send, 120);
  };

  return new Runner();
})();
