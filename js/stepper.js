/* JS Visualizer — Step mode: line-by-line execution with call stack + variables.
   Built on Neil Fraser's JS-Interpreter (ES5). Modern syntax is auto-transpiled
   with Babel (loaded on demand) and marked as approximate. */
window.JV = window.JV || {};

JV.Stepper = (function () {
  'use strict';

  var BABEL_URL = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js';
  var MAX_RAW_PER_STEP = 60000;
  var MAX_MS_PER_STEP = 450;
  var BABEL_OPTS = {
    presets: [['es2015', { loose: true }], ['es2016', { loose: true }], ['es2017', { loose: true }]],
    retainLines: true,
    sourceType: 'script'
  };

  // @babel/standalone inlines a large, input-independent runtime preamble
  // (regenerator etc.) at the top of its output.  Transforming a tiny async
  // probe and taking the common prefix with the real output locates where
  // the user-derived code starts, so stepping can skip the machinery.
  var _probePreamble = null;
  function probePreamble() {
    if (_probePreamble !== null) return _probePreamble;
    try {
      _probePreamble = window.Babel.transform('async function __jvizProbe__() {}', BABEL_OPTS).code;
    } catch (e) {
      _probePreamble = '';
    }
    return _probePreamble;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function Stepper(opts) {
    this.opts = opts; // { editor, consoleUI, els: {...}, setStatus, toast }
    this.els = opts.els;
    this.code = '';
    this._runCode = '';
    this.lineStarts = [0];
    this.interp = null;
    this.stepCount = 0;
    this.finished = false;
    this.errored = null;
    this.waiting = false;
    this.waitingShown = false;
    this.playing = false;
    this.playTimer = null;
    this.log = [];
    this.prevSnapshots = null;
    this.pinnedScope = null;
    this.lastNode = null;
    this.lastDepth = 1;
    this.lastPauseKey = null;
    this.summaryAtPause = null;
    this.logLenAtPause = 0;
    this._replaying = false;
    this._pendingMsgs = [];
    this._needRegen = false;
    this._skipTo = 0;
    this._babelLoading = false;
    this._babelFailed = false;
    this._babelQueue = [];
    this.builtinKeys = null;
    this.transpiled = false;
    this._render();
  }

  /* ================= interpreter setup ================= */

  Stepper.prototype._getBuiltins = function () {
    if (!this.builtinKeys) {
      var keys = {};
      try {
        var probe = new Interpreter('', function () {});
        var props = probe.globalScope.object.properties;
        for (var k in props) keys[k] = true;
      } catch (e) { /* ignore */ }
      keys['console'] = true;
      keys['alert'] = true;
      this.builtinKeys = keys;
    }
    return this.builtinKeys;
  };

  Stepper.prototype._initFunc = function () {
    var self = this;
    return function (interp, globalObject) {
      var consoleObj = interp.createObjectProto(interp.OBJECT_PROTO);
      var makeLog = function (level) {
        return interp.createNativeFunction(function () {
          self._onInterpConsole(interp, level, Array.prototype.slice.call(arguments));
        });
      };
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
        interp.setProperty(consoleObj, level, makeLog(level));
      });
      interp.setProperty(consoleObj, 'table', makeLog('log'));
      interp.setProperty(globalObject, 'console', consoleObj);
      interp.setProperty(globalObject, 'alert', interp.createNativeFunction(function (v) {
        self._onInterpConsole(interp, 'alert', [v]);
      }));
      // Event loop: microtask queue + Promise/queueMicrotask + ES2015+ fills.
      JV.InterpEnv.install(interp, globalObject);
      interp.polyfills_.push(JV.InterpEnv.PRELUDE);
      if (self._needRegen && window.JV_REGENERATOR_SOURCE) {
        interp.polyfills_.push(window.JV_REGENERATOR_SOURCE);
      }
    };
  };

  Stepper.prototype._onInterpConsole = function (interp, level, pseudoArgs) {
    var trees = [];
    for (var i = 0; i < pseudoArgs.length; i++) {
      trees.push(this.pseudoToTree(interp, pseudoArgs[i], 3, []));
    }
    var msg = { level: level, trees: trees, tag: null, step: null };
    this.log.push(msg);
    this._pendingMsgs.push(msg);
  };

  /* Tag buffered messages with the step at which they become visible. */
  Stepper.prototype._flushPendingMsgs = function () {
    if (!this._pendingMsgs.length) return;
    for (var i = 0; i < this._pendingMsgs.length; i++) {
      var msg = this._pendingMsgs[i];
      msg.step = this.stepCount;
      msg.tag = 'step ' + this.stepCount;
      if (!this._replaying) this.opts.consoleUI.addMessage(msg);
    }
    this._pendingMsgs = [];
  };

  Stepper.prototype._buildInterpreter = function (runCode) {
    try {
      return { interp: new Interpreter(runCode, this._initFunc()) };
    } catch (e) {
      if (e instanceof SyntaxError) {
        var line = e.loc && e.loc.line ? e.loc.line : null;
        return { syntaxError: e, error: 'Syntax error: ' + e.message, line: line };
      }
      return { error: 'Error while loading code: ' + (e && e.message ? e.message : String(e)), line: null };
    }
  };

  Stepper.prototype._ensureBabel = function (cb) {
    if (window.Babel && window.Babel.transform) return cb(null);
    if (this._babelFailed) return cb(new Error('Babel could not be loaded'));
    var self = this;
    this._babelQueue.push(cb);
    if (this._babelLoading) return;
    this._babelLoading = true;
    var s = document.createElement('script');
    s.src = BABEL_URL;
    s.onload = function () { self._flushBabel(null); };
    s.onerror = function () { self._babelFailed = true; self._flushBabel(new Error('Babel could not be loaded (offline?)')); };
    document.head.appendChild(s);
  };

  Stepper.prototype._flushBabel = function (err) {
    var queue = this._babelQueue;
    this._babelQueue = [];
    for (var i = 0; i < queue.length; i++) queue[i](err);
  };

  /* ================= loading ================= */

  Stepper.prototype.load = function (code) {
    this.stopPlay();
    this.code = code;
    this.log = [];
    this.prevSnapshots = null;
    this.pinnedScope = null;
    // Reset all run state so a failed build never shows leftovers from the
    // previous session (errored/stepCount survive when _commitLoad never runs).
    this.interp = null;
    this.stepCount = 0;
    this.finished = false;
    this.errored = null;
    this.waiting = false;
    this.waitingShown = false;
    this.lastNode = null;
    this.lastDepth = 1;
    this.lastPauseKey = null;
    this.summaryAtPause = null;
    this.logLenAtPause = 0;
    this._pendingMsgs = [];
    this._needRegen = false;
    this._skipTo = 0;
    this.opts.editor.setErrorLine(null);
    this._computeLines(code);

    var built = this._buildInterpreter(code);
    if (!built.error) {
      this.transpiled = false;
      this._commitLoad(built.interp, code);
      return;
    }
    if (built.syntaxError) {
      this._tryTranspile(code, built);
      return;
    }
    this.interp = null;
    this.opts.consoleUI.setMessages([]);
    this.opts.consoleUI.addMessage({ level: 'error', text: built.error });
    this.opts.setStatus('could not load code', 'error');
    this._render();
  };

  Stepper.prototype._tryTranspile = function (code, built) {
    var self = this;
    this.interp = null;
    this.opts.consoleUI.setMessages([]);
    this.opts.setStatus('modern syntax detected \u2014 loading transpiler\u2026', 'pending');
    this._render();
    this._ensureBabel(function (err) {
      if (err) {
        self._failWithSyntax(built, 'Step mode interprets ES5. Modern syntax can be transpiled automatically, but that requires a one-time Babel download (internet). You can also rewrite the code with var / function instead of let / const / arrow.');
        return;
      }
      var out = null;
      var transpileErr = null;
      try {
        out = window.Babel.transform(code, BABEL_OPTS).code;
      } catch (e2) {
        transpileErr = e2;
      }
      if (transpileErr || !out) {
        self._failWithSyntax(built, 'This code could not be transpiled: ' + (transpileErr ? transpileErr.message : 'unknown error'));
        return;
      }
      var probe = probePreamble();
      var skipTo = 0;
      while (skipTo < out.length && skipTo < probe.length &&
             out.charAt(skipTo) === probe.charAt(skipTo)) {
        skipTo++;
      }
      self._skipTo = skipTo;
      // async/await and generators need regenerator-runtime, injected as an
      // invisible prelude at interpreter construction.
      self._needRegen = out.indexOf('regeneratorRuntime') !== -1;
      var built2 = self._buildInterpreter(out);
      if (built2.error) {
        self._needRegen = false;
        self._failWithSyntax(built, 'Transpiled code still cannot run: ' + built2.error);
        return;
      }
      self.transpiled = true;
      self._computeLines(out);
      self._commitLoad(built2.interp, out);
      self.opts.consoleUI.addMessage({
        level: 'system',
        text: 'modern syntax was transpiled to ES5 \u2014 highlight positions are approximate'
      });
      self.opts.toast('Transpiled to ES5 for stepping');
    });
  };

  Stepper.prototype._failWithSyntax = function (built, extra) {
    this.interp = null;
    this.opts.consoleUI.setMessages([]);
    var text = built.error + (extra ? ' \u2014 ' + extra : '');
    this.opts.consoleUI.addMessage({ level: 'error', text: text, line: built.line });
    if (built.line) this.opts.editor.setErrorLine(built.line);
    this.opts.setStatus('syntax error', 'error');
    this._render();
  };

  Stepper.prototype._commitLoad = function (interp, runCode) {
    this.interp = interp;
    this._runCode = runCode;
    this.stepCount = 0;
    this.finished = false;
    this.errored = null;
    this.waiting = false;
    this.waitingShown = false;
    this.lastDepth = this._framesDepth();
    this.lastNode = this._topNode();
    this.lastPauseKey = null;
    this.summaryAtPause = null;
    this.logLenAtPause = 0;
    this._pendingMsgs = [];
    this.opts.editor.setErrorLine(null);
    this.opts.consoleUI.setMessages([]);
    this._render();
    this.opts.setStatus('ready \u2014 press Step to begin', 'ok');
  };

  Stepper.prototype._computeLines = function (code) {
    this.lineStarts = [0];
    for (var i = 0; i < code.length; i++) {
      if (code.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  };

  Stepper.prototype.lineFor = function (offset) {
    var lo = 0;
    var hi = this.lineStarts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  /* ================= advancing ================= */

  Stepper.prototype._topNode = function () {
    var stack = this.interp.getStateStack();
    for (var i = stack.length - 1; i >= 0; i--) {
      var n = stack[i].node;
      if (n && typeof n.start === 'number' && typeof n.end === 'number') return n;
    }
    return stack.length ? stack[stack.length - 1].node : null;
  };

  Stepper.prototype._framesDepth = function () {
    var stack = this.interp.getStateStack();
    var depth = 1;
    var seen = [];
    seen.push(stack.length ? stack[0].scope : null);
    for (var i = 0; i < stack.length; i++) {
      var st = stack[i];
      if (st.func_ && st.func_.node && typeof st.func_.node.start === 'number') {
        for (var j = i + 1; j < stack.length; j++) {
          if (stack[j].scope && stack[j].scope !== st.scope) {
            if (seen.indexOf(stack[j].scope) === -1) {
              seen.push(stack[j].scope);
              depth++;
            }
            break;
          }
        }
      }
    }
    return depth;
  };

  Stepper.prototype._scopeSummary = function (scope) {
    var props = scope.object.properties;
    var keys = Object.keys(props);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      out.push(keys[i] + '=' + this._summarize(props[keys[i]], 2));
    }
    return out.join('|');
  };

  Stepper.prototype._summarize = function (v, depth) {
    if (v === null) return 'null';
    if (typeof v !== 'object') return typeof v === 'string' ? '"' + v + '"' : String(v);
    if (depth < 0) return '#';
    var cls = v.class || 'Object';
    if (cls === 'Function') return 'fn';
    if (cls === 'Array') {
      var len = typeof v.properties['length'] === 'number' ? v.properties['length'] : 0;
      var parts = [];
      for (var i = 0; i < Math.min(len, 8); i++) {
        parts.push(Object.prototype.hasOwnProperty.call(v.properties, i) ? this._summarize(v.properties[i], depth - 1) : '');
      }
      return '[' + parts.join(',') + ']' + (len > 8 ? '...' : '');
    }
    var keys = Object.keys(v.properties);
    if (!keys.length) return cls + '{}';
    var out = [];
    for (var k = 0; k < Math.min(keys.length, 8); k++) {
      out.push(keys[k] + ':' + this._summarize(v.properties[keys[k]], depth - 1));
    }
    return cls + '{' + out.join(',') + (keys.length > 8 ? ',...' : '') + '}';
  };

  /* returns 'stepped' | 'done' | 'waiting' | 'error' */
  Stepper.prototype.advance = function () {
    if (this.errored) return 'error';
    if (this.finished) return 'done';
    if (!this.interp) return 'done';
    var guard = 0;
    var t0 = Date.now();
    for (;;) {
      var more;
      try {
        more = this.interp.step();
      } catch (e) {
        this.errored = e;
        this.waiting = false;
        this.finished = false;
        this._flushPendingMsgs();
        return 'error';
      }
      if (!more) {
        this.finished = true;
        this.playing = false;
        this._flushPendingMsgs();
        return 'done';
      }
      this.lastNode = this._topNode();
      var status = this.interp.getStatus();
      if (status === Interpreter.Status.ASYNC || status === Interpreter.Status.TASK) {
        this.waiting = true;
        this._flushPendingMsgs();
        return 'waiting';
      }
      this.waiting = false;

      var depth = this._framesDepth();
      var node = this.lastNode;
      var depthChanged = depth !== this.lastDepth;
      var blockLike = node && (node.type === 'Program' || node.type === 'BlockStatement');
      var stmtLike = node && (/Statement$/.test(node.type) || /Declaration$/.test(node.type));
      // When the stack is empty and work is queued, stop anyway: this is the
      // event-loop handoff (drain microtasks / take next task) — it deserves
      // its own visible step before the next callback starts.
      var stackTop = this.interp.stateStack[this.interp.stateStack.length - 1];
      var loopCheckpoint = !!(stackTop && stackTop.node.type === 'Program' &&
        stackTop.done && this.interp.tasks.length > 0);
      var pause = loopCheckpoint || depthChanged || (stmtLike && !blockLike);
      // Transpiled code carries a large input-independent runtime preamble
      // (regenerator etc.) at the top; never pause inside it — the user's
      // lines would be buried under hundreds of machinery steps.
      // Program is exempt: its node spans the whole script.
      if (pause && node && node.type !== 'Program' &&
          typeof node.start === 'number' && node.start < this._skipTo) {
        pause = false;
      }

      if (pause) {
        // skip when nothing visible changed since the previous pause on this exact node;
        // the event-loop phase is part of the key so that a handoff checkpoint
        // (callback -> pending task) is never collapsed into the previous pause.
        var evPhase = this.getLoop();
        evPhase = evPhase ? evPhase.phase : '';
        var key = node.type + '@' + node.start + '#' + depth + '$' + evPhase;
        if (key === this.lastPauseKey && this.log.length === this.logLenAtPause) {
          var topSummary = this._scopeSummary(this._currentScope());
          if (topSummary === this.summaryAtPause) pause = false;
        }
      }

      if (pause || guard > MAX_RAW_PER_STEP || Date.now() - t0 > MAX_MS_PER_STEP) {
        this.lastDepth = depth;
        this.stepCount++;
        this.lastPauseKey = node ? node.type + '@' + node.start + '#' + depth + '$' + (typeof evPhase === 'string' ? evPhase : '') : null;
        this.logLenAtPause = this.log.length;
        this.summaryAtPause = this._currentScope() ? this._scopeSummary(this._currentScope()) : null;
        this._flushPendingMsgs();
        return 'stepped';
      }
      guard++;
    }
  };

  Stepper.prototype._currentScope = function () {
    try { return this.interp.getScope(); } catch (e) { return null; }
  };

  /* ================= frames ================= */

  Stepper.prototype.buildFrames = function () {
    var interp = this.interp;
    if (!interp) return [];
    var stack = interp.getStateStack();
    var frames = [];
    var seen = [];
    var mainScope = stack.length ? stack[0].scope : interp.globalScope;
    frames.push({ name: 'main', scope: mainScope, params: [], kind: 'main' });
    seen.push(mainScope);

    var self = this;
    for (var i = 0; i < stack.length; i++) {
      var st = stack[i];
      // Frames come from real user/transpiled functions; the Promise prelude
      // and other locationless glue never appears in the stack panel.
      if (st.func_ && st.func_.node && typeof st.func_.node.start === 'number') {
        var fnScope = null;
        for (var j = i + 1; j < stack.length; j++) {
          if (stack[j].scope && stack[j].scope !== st.scope) { fnScope = stack[j].scope; break; }
        }
        if (fnScope && seen.indexOf(fnScope) === -1) {
          seen.push(fnScope);
          frames.push(self._makeFrame(interp, st, fnScope));
        }
      }
    }

    // off-stack scopes reachable from the current scope chain = closures
    var current = this._currentScope();
    var missing = [];
    var s = current;
    while (s && s !== mainScope) {
      if (seen.indexOf(s) === -1) { seen.push(s); missing.push(s); }
      s = s.parentScope;
    }
    if (missing.length) {
      var closureFrames = [];
      for (var m = missing.length - 1; m >= 0; m--) {
        closureFrames.push({ name: 'closure scope', scope: missing[m], params: [], kind: 'closure' });
      }
      var args = [1, 0].concat(closureFrames);
      Array.prototype.splice.apply(frames, args);
    }
    return frames;
  };

  Stepper.prototype._makeFrame = function (interp, state, fnScope) {
    var func = state.func_;
    var name = '';
    try { name = interp.getProperty(func, 'name') || ''; } catch (e) { name = ''; }
    if (!name && func && func.node && func.node.id) name = func.node.id.name;
    var params = [];
    if (func && func.node && func.node.params) {
      for (var i = 0; i < func.node.params.length; i++) {
        if (func.node.params[i].name) params.push(func.node.params[i].name);
      }
    }
    return { name: name || 'anonymous', scope: fnScope, params: params, kind: 'fn' };
  };

  /* ================= value -> tree ================= */

  Stepper.prototype.pseudoToTree = function (interp, v, depth, seen) {
    if (v === null) return { k: 'null' };
    if (typeof v !== 'object') {
      if (typeof v === 'undefined') return { k: 'undef' };
      if (typeof v === 'string') return { k: 'str', v: v.length > 300 ? v.slice(0, 300) + '\u2026' : v };
      if (typeof v === 'number') return { k: 'num', v: String(v) };
      if (typeof v === 'boolean') return { k: 'bool', v: v };
      return { k: 'str', v: String(v) };
    }
    if (interp.globalObject && v === interp.globalObject) return { k: 'global' };

    var cls = v.class || 'Object';

    if (cls === 'Function') {
      var name = '';
      try { name = interp.getProperty(v, 'name') || ''; } catch (e) { name = ''; }
      if (!name && v.node && v.node.id) name = v.node.id.name;
      var params = '';
      if (v.node && v.node.params) {
        var ps = [];
        for (var p = 0; p < v.node.params.length; p++) {
          if (v.node.params[p].name) ps.push(v.node.params[p].name);
        }
        params = ps.join(', ');
      }
      return { k: 'fn', v: '\u0192 ' + (name || 'anonymous') + '(' + params + ')' };
    }

    if (seen.indexOf(v) !== -1) return { k: 'circ', v: '[Circular]' };

    if (cls === 'Array') {
      var len = typeof v.properties['length'] === 'number' ? v.properties['length'] : 0;
      if (depth < 0) return { k: 'deep', v: 'Array(' + len + ')' };
      seen.push(v);
      var arrNode = { k: 'arr', n: len, items: [] };
      var lim = Math.min(len, 100);
      for (var i = 0; i < lim; i++) {
        if (Object.prototype.hasOwnProperty.call(v.properties, i)) {
          arrNode.items.push([String(i), this.pseudoToTree(interp, v.properties[i], depth - 1, seen)]);
        } else {
          arrNode.items.push([String(i), { k: 'empty' }]);
        }
      }
      if (len > lim) arrNode.more = len - lim;
      seen.pop();
      return arrNode;
    }

    if (cls === 'RegExp') {
      var rs = v.data && v.data.source !== undefined ? '/' + v.data.source + '/' + (v.data.flags || '') :
        (v.data instanceof RegExp ? String(v.data) : 'RegExp');
      return { k: 'obj', ctor: 'RegExp', items: [['pattern', { k: 'str', v: rs }]] };
    }
    if (cls === 'Date') {
      var ds = v.data instanceof Date ? (isNaN(v.data.getTime()) ? 'Invalid Date' : v.data.toISOString()) : 'Date';
      return { k: 'obj', ctor: 'Date', items: [['iso', { k: 'str', v: ds }]] };
    }

    if (depth < 0) return { k: 'deep', v: cls + ' {\u2026}' };

    var ctorName = null;
    if (cls !== 'Object') ctorName = cls;
    seen.push(v);
    var objNode = { k: 'obj', ctor: ctorName, items: [] };
    var keys = Object.keys(v.properties);
    var lim2 = Math.min(keys.length, 60);
    for (var k = 0; k < lim2; k++) {
      objNode.items.push([keys[k], this.pseudoToTree(interp, v.properties[keys[k]], depth - 1, seen)]);
    }
    if (keys.length > lim2) objNode.more = keys.length - lim2;
    seen.pop();
    return objNode;
  };

  /* ================= rendering ================= */

  Stepper.prototype._render = function () {
    var frames = this.buildFrames();
    this._renderStack(frames);
    this._renderVars(frames);
    this._renderLoop();
    this._updateControls();
    if (this.interp && this.lastNode && !this.errored) {
      this.opts.editor.setActiveLine(this.lineFor(this.lastNode.start));
    }
  };

  Stepper.prototype._renderStack = function (frames) {
    var el = this.els.stackList;
    if (!this.interp) {
      el.innerHTML = '<div class="empty-note">Nothing loaded.<br>Press Reset to load the editor code.</div>';
      this.els.varsScopeName.textContent = '';
      this._selectedFrame = null;
      return;
    }
    var selectedIdx = frames.length - 1;
    if (this.pinnedScope) {
      var found = -1;
      for (var f = 0; f < frames.length; f++) {
        if (frames[f].scope === this.pinnedScope) { found = f; break; }
      }
      if (found === -1) this.pinnedScope = null;
      else selectedIdx = found;
    }
    this._selectedFrame = frames[selectedIdx] || null;

    var html = '';
    for (var i = frames.length - 1; i >= 0; i--) {
      var fr = frames[i];
      var isTop = i === frames.length - 1;
      var cls = 'frame';
      if (fr.kind === 'closure') cls += ' closure';
      if (isTop) cls += ' current';
      if (i === selectedIdx) cls += ' selected';
      var argsText = this._frameArgsText(fr);
      var ico = fr.kind === 'main' ? '\u25A0' : (fr.kind === 'closure' ? '\u25CC' : '\u0192');
      html += '<div class="' + cls + '" data-idx="' + i + '">' +
        '<span class="frame-ico">' + ico + '</span>' +
        '<span class="frame-name">' + (fr.kind === 'main' ? 'main' : esc(fr.name)) + '</span>' +
        '<span class="frame-args">' + esc(argsText) + '</span>' +
        (isTop && !this.finished && !this.errored ? '<span class="frame-current-tag">next</span>' : '') +
        '</div>';
    }
    el.innerHTML = html;

    var self = this;
    var nodes = el.querySelectorAll('.frame');
    Array.prototype.forEach.call(nodes, function (node) {
      node.addEventListener('click', function () {
        var idx = parseInt(node.getAttribute('data-idx'), 10);
        var scope = self._frameScopeAt(idx);
        if (self.pinnedScope === scope) self.pinnedScope = null; // unpin
        else self.pinnedScope = scope;
        self._render();
      });
    });
  };

  Stepper.prototype._frameScopeAt = function (idx) {
    var frames = this.buildFrames();
    return frames[idx] ? frames[idx].scope : null;
  };

  Stepper.prototype._frameArgsText = function (fr) {
    if (fr.kind === 'closure') return '(captured variables)';
    if (!fr.scope || !fr.params.length) return '';
    var parts = [];
    for (var i = 0; i < fr.params.length && i < 4; i++) {
      var name = fr.params[i];
      var val = fr.scope.object.properties[name];
      parts.push(name + ' = ' + this._summarize(val, 1));
    }
    return '(' + parts.join(', ') + ')';
  };

  Stepper.prototype._renderVars = function (frames) {
    var el = this.els.varsList;
    var fr = this._selectedFrame;
    if (!fr || !this.interp) {
      el.innerHTML = '<div class="empty-note">Variables of the selected frame appear here.</div>';
      this.els.varsScopeName.textContent = '';
      return;
    }
    var isTop = frames.length > 0 && frames[frames.length - 1].scope === fr.scope;
    this.els.varsScopeName.textContent = (fr.kind === 'main' ? 'main / global' : fr.name) + (isTop ? ' \u00B7 current' : ' \u00B7 paused view');

    var builtins = this._getBuiltins();
    var hidden = JV.InterpEnv.HIDDEN_GLOBALS;
    var props = fr.scope.object.properties;
    var interp = this.interp;
    var keys = Object.keys(props).filter(function (k) {
      if (fr.kind === 'main' && (builtins[k] || hidden[k] || k.indexOf('__jviz') === 0)) return false;
      if (k === 'arguments') return false;
      if (k === 'this') {
        var v = props[k];
        if (v === undefined) return false;
        if (interp.globalObject && v === interp.globalObject) return false;
        if (v && v.class === 'Object' && v.proto === null) return false; // boxed global object
        return true;
      }
      return true;
    });

    var newSnap = {};
    for (var s = 0; s < keys.length; s++) {
      newSnap[keys[s]] = this._summarize(props[keys[s]], 2);
    }
    var prevSnap = this._prevForScope(fr.scope);

    if (!keys.length) {
      el.innerHTML = '<div class="empty-note">No variables in this scope yet.</div>';
      this._storeSnapshot(fr.scope, newSnap);
      return;
    }

    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      var value = props[name];
      var changed = !!(prevSnap && prevSnap[name] !== undefined && prevSnap[name] !== newSnap[name]);
      var tree = this.pseudoToTree(interp, value, 4, []);
      html += '<div class="var-row' + (changed ? ' changed' : '') + '">' +
        '<span class="var-name">' + esc(name) + '</span>' +
        '<span class="var-eq">=</span>' +
        '<span class="var-val">' + JV.Console.renderTree(tree, { depth: 0 }) + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
    this._storeSnapshot(fr.scope, newSnap);
  };

  Stepper.prototype._prevForScope = function (scope) {
    if (!this.prevSnapshots) return null;
    for (var i = 0; i < this.prevSnapshots.length; i++) {
      if (this.prevSnapshots[i].scope === scope) return this.prevSnapshots[i].snap;
    }
    return null;
  };

  Stepper.prototype._storeSnapshot = function (scope, snap) {
    if (!this.prevSnapshots) this.prevSnapshots = [];
    for (var i = 0; i < this.prevSnapshots.length; i++) {
      if (this.prevSnapshots[i].scope === scope) {
        this.prevSnapshots[i].snap = snap;
        return;
      }
    }
    this.prevSnapshots.push({ scope: scope, snap: snap });
    if (this.prevSnapshots.length > 30) this.prevSnapshots.shift();
  };

  /* ================= event loop ================= */

  Stepper.prototype.getLoop = function () {
    var interp = this.interp;
    if (!interp) return null;
    var now = Date.now();
    var micro = [];
    var macro = [];
    for (var i = 0; i < interp.tasks.length; i++) {
      var t = interp.tasks[i];
      var item = { label: JV.InterpEnv.taskLabel(interp, t), due: t.time <= now };
      if (t.__jvizKind === 'micro') micro.push(item);
      else macro.push(item);
    }
    var stack = interp.stateStack;
    var top = stack[stack.length - 1];
    var programDone = !!(stack[0] && stack[0].done);
    var running = !!(top && (top.node.type !== 'Program' || !top.done));
    var phase;
    if (this.errored) phase = 'error';
    else if (this.finished) phase = 'done';
    else if (interp.paused_) phase = 'async';
    else if (running) phase = programDone ? 'callback' : 'script';
    else if (micro.length) phase = 'micro';
    else if (macro.length) phase = macro[0].due ? 'task' : 'timer';
    else phase = 'idle';
    return { phase: phase, micro: micro, macro: macro };
  };

  var LOOP_PHASES = {
    script: { text: 'main script running', cls: 'run' },
    callback: { text: 'running task callback', cls: 'run' },
    micro: { text: 'draining microtasks', cls: 'micro' },
    task: { text: 'task ready', cls: 'task' },
    timer: { text: 'waiting on timers', cls: 'timer' },
    async: { text: 'paused (async)', cls: 'timer' },
    idle: { text: 'idle', cls: 'idle' },
    done: { text: 'loop finished', cls: 'done' },
    error: { text: 'stopped on error', cls: 'error' }
  };

  Stepper.prototype._renderLoop = function () {
    var els = this.els;
    if (!els.loopPhaseText) return;
    var info = this.getLoop();
    var phase = info ? LOOP_PHASES[info.phase] : LOOP_PHASES.idle;
    els.loopPhaseText.textContent = phase.text;
    els.loopPhase.className = 'loop-phase ' + phase.cls;
    var chip = function (item, cls) {
      return '<span class="loop-chip ' + cls + '">' + esc(item.label) + '</span>';
    };
    var microHtml = '';
    var macroHtml = '';
    if (info) {
      for (var i = 0; i < info.micro.length; i++) microHtml += chip(info.micro[i], 'micro');
      for (var j = 0; j < info.macro.length; j++) {
        macroHtml += chip(info.macro[j], info.macro[j].due ? 'due' : 'wait');
      }
    }
    els.loopMicroList.innerHTML = microHtml || '<span class="loop-none">empty</span>';
    els.loopMacroList.innerHTML = macroHtml || '<span class="loop-none">empty</span>';
    els.loopMicroCount.textContent = info ? String(info.micro.length) : '0';
    els.loopMacroCount.textContent = info ? String(info.macro.length) : '0';
  };

  Stepper.prototype._updateControls = function () {
    var has = !!this.interp;
    this.els.btnStep.disabled = !has || this.finished || !!this.errored || this.playing;
    this.els.btnBack.disabled = !has || this.stepCount === 0 || this.playing;
    this.els.btnPlay.disabled = !has || this.finished || !!this.errored;
    this.els.btnPlay.textContent = this.playing ? 'Pause' : 'Play';
    var counter = this.els.stepCounter;
    var text = 'step ' + this.stepCount;
    var cls = 'step-counter';
    if (this.finished) { text = 'done \u00B7 ' + this.stepCount + ' steps'; cls += ' done'; }
    else if (this.errored) { text += ' \u00B7 error'; cls += ' error'; }
    else if (this.waiting) { text += ' \u00B7 timers pending'; cls += ' waiting'; }
    counter.textContent = text;
    counter.className = cls;
  };

  /* ================= controls ================= */

  Stepper.prototype.stepForward = function () {
    if (this.playing || !this.interp) return;
    var r = this.advance();
    if (r === 'waiting') {
      if (this.waitingShown) {
        // The waiting checkpoint was rendered on the previous press:
        // advancing the virtual clock and firing the earliest timer is the
        // visible "event loop takes the next task" step.
        r = this.fireNextTask();
        this.waitingShown = false;
      } else {
        this.waitingShown = true;
      }
    } else {
      this.waitingShown = false;
    }
    this._afterAdvance(r);
  };

  /* Future-dated timers hold the loop open: the earliest one fires by
     setting its due time to the virtual "now". */
  Stepper.prototype.fireNextTask = function () {
    if (!this.interp || !this.interp.tasks.length) return this.advance();
    this.interp.tasks[0].time = 0;
    this.waiting = false;
    return this.advance();
  };

  Stepper.prototype._afterAdvance = function (r) {
    this._render();
    if (r === 'done') {
      this.opts.setStatus('finished \u2014 ' + this.stepCount + ' steps', 'ok');
      this.opts.toast('Finished after ' + this.stepCount + ' steps', 'ok');
    } else if (r === 'error') {
      this._showRuntimeError();
    } else if (r === 'waiting') {
      this.opts.setStatus('timers pending \u2014 press Step to fire the next one', 'pending');
    } else {
      this.opts.setStatus('step ' + this.stepCount, '');
    }
  };

  Stepper.prototype._showRuntimeError = function () {
    var e = this.errored;
    var line = this.lastNode ? this.lineFor(this.lastNode.start) : null;
    var text = 'Error: ' + (e && e.message ? e.message : String(e));
    var msg = { level: 'uncaught', text: text, line: line, tag: 'step ' + this.stepCount, step: this.stepCount };
    this.log.push(msg);
    this.opts.consoleUI.addMessage(msg);
    if (line) this.opts.editor.setErrorLine(line);
    this.opts.setStatus('stopped on error', 'error');
  };

  Stepper.prototype.back = function () {
    if (this.playing || !this.interp || this.stepCount === 0) return;
    this._replayTo(this.stepCount - 1);
  };

  Stepper.prototype._replayTo = function (target) {
    this._replaying = true;
    this.log = [];
    this.interp = new Interpreter(this._runCode, this._initFunc());
    this.stepCount = 0;
    this.finished = false;
    this.errored = null;
    this.waiting = false;
    this.waitingShown = false;
    this.lastDepth = this._framesDepth();
    this.lastNode = this._topNode();
    this.lastPauseKey = null;
    this.summaryAtPause = null;
    this.logLenAtPause = 0;
    this._pendingMsgs = [];
    for (var i = 0; i < target; i++) {
      var r = this.advance();
      // Replay is deterministic: pending timers fire in queue order instead
      // of waiting on the wall clock, so back() lands on the same states.
      if (r === 'waiting') r = this.fireNextTask();
      if (r === 'done' || r === 'error' || r === 'waiting') break;
    }
    this._replaying = false;
    this.prevSnapshots = null;
    this.opts.consoleUI.setMessages(this.log);
    this._render();
    this.opts.setStatus('step ' + this.stepCount, '');
  };

  Stepper.prototype.reset = function () {
    this.load(this.opts.editor.getValue());
    this.opts.toast('Reloaded the code');
  };

  Stepper.prototype.play = function () {
    if (this.playing) { this.stopPlay(); return; }
    if (!this.interp || this.finished || this.errored) return;
    this.playing = true;
    this.waitingShown = false;
    this._updateControls();
    var self = this;
    var tick = function () {
      if (!self.playing) return;
      var wasWaiting = self.waiting;
      // Fire pending timers as play advances, so the whole event-loop
      // choreography stays visible without real-time waits.
      var r = self.waiting ? self.fireNextTask() : self.advance();
      self._afterAdvance(r);
      if (r === 'done' || r === 'error') {
        self.stopPlay();
        self._updateControls();
        return;
      }
      var speed = parseInt(self.els.speedSelect.value, 10) || 350;
      var delay = wasWaiting ? 260 : (r === 'waiting' ? 420 : speed);
      self.playTimer = setTimeout(tick, delay);
    };
    this.playTimer = setTimeout(tick, 60);
  };

  Stepper.prototype.stopPlay = function () {
    this.playing = false;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this._updateControls();
  };

  return Stepper;
})();
