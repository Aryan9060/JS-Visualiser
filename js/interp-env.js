/* JS Visualizer — Step-mode interpreter environment.

   Installs, on every JS-Interpreter instance used by Step mode:
   - a true microtask queue: jobs are Interpreter.Tasks with a hugely negative
     due time, so once the call stack empties they always run before timers;
   - Promise + queueMicrotask, defined by PRELUDE — interpreter-side code that
     runs at construction with locations stripped, so it never shows up in the
     stepping UI (line highlight / frames / variables);
   - tagging of setTimeout/setInterval tasks so the event-loop panel can label
     them (the built-in natives would work, but they don't record the delay);
   - small ES2015+ fills (Array.from, Object.assign, Math.trunc, ...) so modern
     snippets run without a transpiler.

   Frozen file order note: PRELUDE runs inside the interpreter and may only use
   ES5 + whatever vendor/interpreter.js provides. */

window.JV = window.JV || {};

JV.InterpEnv = (function () {
  'use strict';

  var HIDDEN_GLOBALS = {
    'Promise': true,
    'queueMicrotask': true,
    'regeneratorRuntime': true
  };

  /* Interpreter-side prelude. Runs before the user program, invisible to the UI. */
  var PRELUDE_LINES = [
    'var Promise = (function (scheduleMicro) {',
    '  function Promise(executor) {',
    '    if (!(this instanceof Promise)) {',
    '      throw new TypeError("Promise constructor must be called with new");',
    '    }',
    '    if (typeof executor !== "function") {',
    '      throw new TypeError("Promise resolver " + executor + " is not a function");',
    '    }',
    '    this._state = 0;',
    '    this._value = undefined;',
    '    this._reactions = [];',
    '    var self = this;',
    '    var settled = false;',
    '    function doResolve(value) {',
    '      if (settled) return;',
    '      settled = true;',
    '      resolvePromise(self, value);',
    '    }',
    '    function doReject(reason) {',
    '      if (settled) return;',
    '      settled = true;',
    '      settle(self, 2, reason);',
    '    }',
    '    try {',
    '      executor(doResolve, doReject);',
    '    } catch (e) {',
    '      if (!settled) { settled = true; settle(self, 2, e); }',
    '    }',
    '  }',
    '',
    '  function settle(p, state, value) {',
    '    if (p._state !== 0) return;',
    '    p._state = state;',
    '    p._value = value;',
    '    var reactions = p._reactions;',
    '    p._reactions = [];',
    '    for (var i = 0; i < reactions.length; i++) {',
    '      scheduleMicro(reactionJob, p, reactions[i]);',
    '    }',
    '  }',
    '',
    '  function resolvePromise(p, value) {',
    '    if (value === p) {',
    '      settle(p, 2, new TypeError("Chaining cycle detected for promise"));',
    '      return;',
    '    }',
    '    if (value !== null && (typeof value === "object" || typeof value === "function")) {',
    '      var then;',
    '      try {',
    '        then = value.then;',
    '      } catch (e) {',
    '        settle(p, 2, e);',
    '        return;',
    '      }',
    '      if (typeof then === "function") {',
    '        var called = false;',
    '        try {',
    '          then.call(value,',
    '            function (v) { if (called) return; called = true; resolvePromise(p, v); },',
    '            function (r) { if (called) return; called = true; settle(p, 2, r); });',
    '        } catch (e) {',
    '          if (!called) { called = true; settle(p, 2, e); }',
    '        }',
    '        return;',
    '      }',
    '    }',
    '    settle(p, 1, value);',
    '  }',
    '',
    '  function reactionJob(p, reaction) {',
    '    var handler = p._state === 1 ? reaction.onFulfilled : reaction.onRejected;',
    '    if (typeof handler !== "function") {',
    '      if (p._state === 1) { reaction.resolve(p._value); }',
    '      else { reaction.reject(p._value); }',
    '      return;',
    '    }',
    '    try {',
    '      reaction.resolve(handler(p._value));',
    '    } catch (e) {',
    '      reaction.reject(e);',
    '    }',
    '  }',
    '',
    '  Promise.prototype.then = function (onFulfilled, onRejected) {',
    '    var child = new Promise(function () {});',
    '    var reaction = {',
    '      onFulfilled: onFulfilled,',
    '      onRejected: onRejected,',
    '      resolve: function (v) { resolvePromise(child, v); },',
    '      reject: function (e) { settle(child, 2, e); }',
    '    };',
    '    if (this._state === 0) {',
    '      this._reactions.push(reaction);',
    '    } else {',
    '      scheduleMicro(reactionJob, this, reaction);',
    '    }',
    '    return child;',
    '  };',
    '',
    '  Promise.prototype["catch"] = function (onRejected) {',
    '    return this.then(undefined, onRejected);',
    '  };',
    '',
    '  Promise.prototype["finally"] = function (onFinally) {',
    '    return this.then(',
    '      function (v) {',
    '        return Promise.resolve(onFinally()).then(function () { return v; });',
    '      },',
    '      function (e) {',
    '        return Promise.resolve(onFinally()).then(function () { throw e; });',
    '      });',
    '  };',
    '',
    '  Promise.resolve = function (value) {',
    '    if (value instanceof Promise) return value;',
    '    return new Promise(function (res) { res(value); });',
    '  };',
    '',
    '  Promise.reject = function (reason) {',
    '    return new Promise(function (res, rej) { rej(reason); });',
    '  };',
    '',
    '  Promise.all = function (list) {',
    '    return new Promise(function (resolve, reject) {',
    '      var items = [];',
    '      var remaining = 0;',
    '      var done = false;',
    '      function push(index, value) {',
    '        items[index] = value;',
    '        remaining--;',
    '        if (!remaining && !done) { done = true; resolve(items); }',
    '      }',
    '      for (var i = 0; i < list.length; i++) {',
    '        (function (index) {',
    '          remaining++;',
    '          Promise.resolve(list[index]).then(',
    '            function (v) { push(index, v); },',
    '            function (e) { if (!done) { done = true; reject(e); } });',
    '        })(i);',
    '      }',
    '      if (!remaining && !done) { done = true; resolve(items); }',
    '    });',
    '  };',
    '',
    '  Promise.race = function (list) {',
    '    return new Promise(function (resolve, reject) {',
    '      for (var i = 0; i < list.length; i++) {',
    '        Promise.resolve(list[i]).then(resolve, reject);',
    '      }',
    '    });',
    '  };',
    '',
    '  return Promise;',
    '})(__jvizMicro);',
    '',
    'var queueMicrotask = function queueMicrotask(callback) {',
    '  if (typeof callback !== "function") {',
    '    throw new TypeError("queueMicrotask expects a function");',
    '  }',
    '  __jvizMicro(callback);',
    '};',
    '',
    'Array.from = function from(source, mapFn, thisArg) {',
    '  var out = [];',
    '  var len = source.length >>> 0;',
    '  for (var i = 0; i < len; i++) {',
    '    out.push(mapFn ? mapFn.call(thisArg, source[i], i) : source[i]);',
    '  }',
    '  return out;',
    '};',
    '',
    'Array.prototype.find = function find(callback, thisArg) {',
    '  for (var i = 0; i < this.length; i++) {',
    '    if (callback.call(thisArg, this[i], i, this)) return this[i];',
    '  }',
    '  return undefined;',
    '};',
    '',
    'Array.prototype.findIndex = function findIndex(callback, thisArg) {',
    '  for (var i = 0; i < this.length; i++) {',
    '    if (callback.call(thisArg, this[i], i, this)) return i;',
    '  }',
    '  return -1;',
    '};',
    '',
    'Array.prototype.includes = function includes(searchElement, fromIndex) {',
    '  var len = this.length >>> 0;',
    '  var start = fromIndex === undefined ? 0 : Number(fromIndex) || 0;',
    '  if (start < 0) start = len + start;',
    '  if (start < 0) start = 0;',
    '  for (var i = start; i < len; i++) {',
    '    var v = this[i];',
    '    if (v === searchElement || (v !== v && searchElement !== searchElement)) return true;',
    '  }',
    '  return false;',
    '};',
    '',
    'Array.prototype.fill = function fill(value, start, end) {',
    '  var len = this.length >>> 0;',
    '  start = start === undefined ? 0 : (Number(start) || 0);',
    '  if (start < 0) start = len + start;',
    '  end = end === undefined ? len : (Number(end) || 0);',
    '  if (end < 0) end = len + end;',
    '  for (var i = start; i < end && i < len; i++) this[i] = value;',
    '  return this;',
    '};',
    '',
    'Array.prototype.at = function at(index) {',
    '  var len = this.length >>> 0;',
    '  var i = Number(index) || 0;',
    '  if (i < 0) i = len + i;',
    '  return this[i];',
    '};',
    '',
    'Array.prototype.flat = function flat(depth) {',
    '  depth = depth === undefined ? 1 : depth;',
    '  var out = [];',
    '  function flatten(arr, d) {',
    '    for (var i = 0; i < arr.length; i++) {',
    '      var v = arr[i];',
    '      if (Array.isArray(v) && d > 0) flatten(v, d - 1);',
    '      else out.push(v);',
    '    }',
    '  }',
    '  flatten(this, depth);',
    '  return out;',
    '};',
    '',
    'Array.prototype.flatMap = function flatMap(callback, thisArg) {',
    '  return this.map(callback, thisArg).flat();',
    '};',
    '',
    'String.prototype.includes = function includes(search, position) {',
    '  return String(this).indexOf(String(search), position) !== -1;',
    '};',
    '',
    'String.prototype.startsWith = function startsWith(search, position) {',
    '  position = position || 0;',
    '  return String(this).substr(position, String(search).length) === String(search);',
    '};',
    '',
    'String.prototype.endsWith = function endsWith(search, length) {',
    '  var s = String(this);',
    '  var str = String(search);',
    '  var end = length === undefined ? s.length : Math.min(Number(length) || 0, s.length);',
    '  return s.substr(end - str.length, str.length) === str;',
    '};',
    '',
    'String.prototype.repeat = function repeat(count) {',
    '  count = Number(count) || 0;',
    '  if (count < 0) throw new RangeError("Invalid count value");',
    '  var s = String(this), out = "";',
    '  for (var i = 0; i < count; i++) out += s;',
    '  return out;',
    '};',
    '',
    'String.prototype.padStart = function padStart(targetLength, padString) {',
    '  var s = String(this);',
    '  targetLength = Number(targetLength) || 0;',
    '  if (s.length >= targetLength) return s;',
    '  var pad = padString === undefined ? " " : String(padString);',
    '  if (!pad) return s;',
    '  var fill = "";',
    '  while (fill.length + s.length < targetLength) fill += pad;',
    '  return fill.substr(0, targetLength - s.length) + s;',
    '};',
    '',
    'String.prototype.padEnd = function padEnd(targetLength, padString) {',
    '  var s = String(this);',
    '  targetLength = Number(targetLength) || 0;',
    '  if (s.length >= targetLength) return s;',
    '  var pad = padString === undefined ? " " : String(padString);',
    '  if (!pad) return s;',
    '  var fill = "";',
    '  while (fill.length + s.length < targetLength) fill += pad;',
    '  return s + fill.substr(0, targetLength - s.length);',
    '};',
    '',
    'String.prototype.trimStart = function trimStart() {',
    '  return String(this).replace(/^\\s+/, "");',
    '};',
    '',
    'String.prototype.trimEnd = function trimEnd() {',
    '  return String(this).replace(/\\s+$/, "");',
    '};',
    '',
    'Object.assign = function assign(target) {',
    '  for (var i = 1; i < arguments.length; i++) {',
    '    var src = arguments[i];',
    '    if (src === null || src === undefined) continue;',
    '    var keys = Object.keys(Object(src));',
    '    for (var k = 0; k < keys.length; k++) target[keys[k]] = src[keys[k]];',
    '  }',
    '  return target;',
    '};',
    ''
  ];
  var PRELUDE = PRELUDE_LINES.join('\n');

  /* ---------------------------------------------------------------- */
  /* Host-side installation (native functions + task tagging).         */

  function install(interp, globalObject) {
    var I = window.Interpreter;

    function native(fn) {
      return interp.createNativeFunction(fn, false);
    }
    function def(target, name, fn) {
      interp.setProperty(target, name, native(fn), I.NONENUMERABLE_DESCRIPTOR);
    }
    function isFn(v) {
      return v instanceof I.Object && v.class === 'Function';
    }

    /* Microtask jobs ride the normal task queue with a huge negative delay:
       they sort before every timer and are always due, so they fire as soon
       as the call stack is empty — then the queue drains in FIFO order. */
    function scheduleMicro(fn, args) {
      var node = interp.newNode();
      node.type = 'CallExpression';
      var task = new I.Task(fn, args, interp.globalScope, node, -1);
      task.__jvizKind = 'micro';
      interp.scheduleTask_(task, -1e15);
      return task;
    }

    interp.setProperty(globalObject, '__jvizMicro',
        native(function (fn) {
          if (!isFn(fn)) {
            interp.throwException(interp.TYPE_ERROR, 'microtask callback is not a function');
          }
          scheduleMicro(fn, Array.prototype.slice.call(arguments, 1));
        }),
        I.NONENUMERABLE_DESCRIPTOR);

    /* Replace the timer globals so every task carries its kind + delay for
       the event-loop panel. Behaviour is otherwise identical to the built-ins. */
    function timerWrapper(isInterval) {
      return native(function (fn, delay) {
        var pid = interp.createTask_(isInterval, arguments);
        var ms = Math.max(Number(delay || 0), 0);
        for (var i = 0; i < interp.tasks.length; i++) {
          if (interp.tasks[i].pid === pid) {
            interp.tasks[i].__jvizKind = isInterval ? 'interval' : 'timeout';
            interp.tasks[i].__jvizDelay = ms;
            break;
          }
        }
        return pid;
      });
    }
    interp.setProperty(globalObject, 'setTimeout', timerWrapper(false), I.NONENUMERABLE_DESCRIPTOR);
    interp.setProperty(globalObject, 'setInterval', timerWrapper(true), I.NONENUMERABLE_DESCRIPTOR);

    /* Object/Array helpers that need host access to pseudo object internals. */
    def(interp.OBJECT, 'entries', function (obj) {
      if (obj === null || obj === undefined) {
        interp.throwException(interp.TYPE_ERROR, 'Cannot convert undefined or null to object');
      }
      var keys = Object.keys(obj instanceof I.Object ? obj.properties : obj);
      var out = interp.createArray();
      for (var i = 0; i < keys.length; i++) {
        var pair = interp.createArray();
        interp.setProperty(pair, 0, keys[i]);
        interp.setProperty(pair, 1, obj instanceof I.Object ? obj.properties[keys[i]] : obj[keys[i]]);
        interp.setProperty(out, i, pair);
      }
      return out;
    });
    def(interp.OBJECT, 'values', function (obj) {
      if (obj === null || obj === undefined) {
        interp.throwException(interp.TYPE_ERROR, 'Cannot convert undefined or null to object');
      }
      var keys = Object.keys(obj instanceof I.Object ? obj.properties : obj);
      var out = interp.createArray();
      for (var i = 0; i < keys.length; i++) {
        interp.setProperty(out, i, obj instanceof I.Object ? obj.properties[keys[i]] : obj[keys[i]]);
      }
      return out;
    });
    def(interp.ARRAY, 'of', function () {
      var out = interp.createArray();
      for (var i = 0; i < arguments.length; i++) interp.setProperty(out, i, arguments[i]);
      return out;
    });

    /* Pure-primitive fills: reuse the host implementations directly. */
    var NUMBER = interp.getProperty(globalObject, 'Number');
    var MATH = interp.getProperty(globalObject, 'Math');
    def(NUMBER, 'isInteger', Number.isInteger || function (v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; });
    def(NUMBER, 'isFinite', Number.isFinite || isFinite);
    def(NUMBER, 'isNaN', Number.isNaN || (function (v) { return typeof v === 'number' && isNaN(v); }));
    def(NUMBER, 'parseInt', parseInt);
    def(NUMBER, 'parseFloat', parseFloat);
    def(MATH, 'trunc', Math.trunc);
    def(MATH, 'sign', Math.sign);
    def(MATH, 'cbrt', Math.cbrt);
    def(MATH, 'log2', Math.log2);
    def(MATH, 'log10', Math.log10);
    def(MATH, 'hypot', Math.hypot);
    interp.setProperty(NUMBER, 'EPSILON', Math.pow(2, -52), I.NONENUMERABLE_DESCRIPTOR);
    interp.setProperty(NUMBER, 'MAX_SAFE_INTEGER', Math.pow(2, 53) - 1, I.NONENUMERABLE_DESCRIPTOR);
    interp.setProperty(NUMBER, 'MIN_SAFE_INTEGER', -(Math.pow(2, 53) - 1), I.NONENUMERABLE_DESCRIPTOR);
    interp.setProperty(globalObject, 'globalThis', globalObject, I.NONENUMERABLE_DESCRIPTOR);
  }

  /* Label for a queued task, used by the event-loop panel. */
  function taskLabel(interp, task) {
    if (task.__jvizKind === 'micro') {
      var name = null;
      var fn = task.functionRef;
      if (fn && fn.node && fn.node.id && fn.node.id.name) name = fn.node.id.name;
      if (name === 'reactionJob') return 'Promise reaction';
      if (name) return name + '()';
      return 'microtask';
    }
    if (task.__jvizKind === 'interval') {
      return 'setInterval \u00B7 ' + task.__jvizDelay + 'ms';
    }
    return 'setTimeout \u00B7 ' + (task.__jvizDelay !== undefined ? task.__jvizDelay + 'ms' : '');
  }

  return {
    PRELUDE: PRELUDE,
    HIDDEN_GLOBALS: HIDDEN_GLOBALS,
    install: install,
    taskLabel: taskLabel
  };
})();
