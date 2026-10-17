'use strict';
/* Validate the Step-mode event-loop engine against the real vendored
   interpreter: microtask queue, Promise prelude, timer tagging, task-frame
   visibility, and Babel es2016/es2017 (regenerator) output. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Babel = require('@babel/standalone');

const ROOT = path.join(__dirname, '..');
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/acorn.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/interpreter.js'), 'utf8'), ctx);
vm.runInContext('window.JV = {};', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/interp-env.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/regenerator-source.js'), 'utf8'), ctx);

const Interpreter = ctx.Interpreter;
const Env = ctx.JV.InterpEnv;
const REGEN_SRC = ctx.JV_REGENERATOR_SOURCE;

let logs = [];
let frameSpy = { seen: {}, counts: {} };

function hostDescribe(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v !== 'object') return String(v);
  if (v.class === 'Array') {
    const len = v.properties.length;
    const parts = [];
    for (let i = 0; i < len; i++) parts.push(hostDescribe(v.properties[i]));
    return '[' + parts.join(', ') + ']';
  }
  if (v.class === 'Function') return 'fn ' + ((v.node && v.node.id && v.node.id.name) || '?');
  if (v.class === 'Error') {
    return 'Error: ' + (v.properties.message || '');
  }
  return 'obj';
}

function makeInit(useRegen) {
  return function (interp, globalObject) {
    const consoleObj = interp.createObjectProto(interp.OBJECT_PROTO);
    const mk = (level) => interp.createNativeFunction(function () {
      const args = Array.prototype.slice.call(arguments);
      logs.push(args.map((a) => hostDescribe(a)).join(' '));
    });
    ['log', 'info', 'warn', 'error', 'debug'].forEach((l) => interp.setProperty(consoleObj, l, mk(l)));
    interp.setProperty(globalObject, 'console', consoleObj);
    Env.install(interp, globalObject);
    interp.polyfills_.push(Env.PRELUDE);
    if (useRegen) interp.polyfills_.push(REGEN_SRC);
  };
}

function build(code, useRegen) {
  return new Interpreter(code, makeInit(useRegen));
}

/* Mini-stepper: steps raw, fires future timers via the virtual clock,
   records frames seen while running (mirrors the real advance() contract). */
function drive(interp, maxIter) {
  maxIter = maxIter || 500000;
  let fired = 0;
  for (let i = 0; i < maxIter; i++) {
    let more;
    try { more = interp.step(); } catch (e) { return { error: e.message }; }
    if (!more) return { done: true, fired };
    const status = interp.getStatus();
    if (status === Interpreter.Status.ASYNC) return { async: true };
    if (status === Interpreter.Status.TASK) {
      if (interp.tasks.length) { interp.tasks[0].time = 0; fired++; continue; }
      return { waiting: true, fired };
    }
    // frame spy: check for named user callbacks present in the stack
    const stack = interp.stateStack;
    for (let s = 0; s < stack.length; s++) {
      const f = stack[s].func_;
      if (f && f.node && f.node.id && f.node.id.name) {
        const name = f.node.id.name;
        frameSpy.counts[name] = (frameSpy.counts[name] || 0) + 1;
      }
    }
  }
  return { overflow: true };
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log('  PASS', label, '\u2192', a); }
  else { failures++; console.log('  FAIL', label, '\n     expected', e, '\n     actual  ', a); }
}

function runCase(label, code, expected, useRegen) {
  logs = [];
  frameSpy = { counts: {} };
  const t0 = Date.now();
  const interp = build(code, useRegen);
  const buildMs = Date.now() - t0;
  const r = drive(interp);
  console.log('\n[' + label + '] build=' + buildMs + 'ms result=' + JSON.stringify(r).slice(0, 120));
  check(label, logs, expected);
  if (r.error || r.overflow) failures++;
  return { r, interp };
}

/* ---------------- 1. basic macro/micro ordering ---------------- */
runCase('ordering micro before timer',
  "console.log('A');\n" +
  "Promise.resolve().then(function () { console.log('B'); });\n" +
  "setTimeout(function () { console.log('C'); }, 0);\n" +
  "console.log('D');\n",
  ['A', 'D', 'B', 'C']);

/* ---------------- 2. executor runs synchronously ---------------- */
runCase('executor sync',
  "console.log('1');\n" +
  "new Promise(function (res) { console.log('2'); res(); }).then(function () { console.log('4'); });\n" +
  "console.log('3');\n",
  ['1', '2', '3', '4']);

/* ---------------- 3. chained microtasks drain before timer ---------------- */
runCase('chained microtasks',
  "Promise.resolve().then(function () { console.log('m1'); return Promise.resolve(); }).then(function () { console.log('m2'); });\n" +
  "setTimeout(function () { console.log('T'); }, 0);\n",
  ['m1', 'm2', 'T']);

/* ---------------- 4. repeated timers with delay ---------------- */
runCase('timer chain',
  "var n = 0;\n" +
  "function tick() {\n" +
  "  n++;\n" +
  "  console.log('tick', n);\n" +
  "  if (n < 3) { setTimeout(tick, 100); } else { console.log('done'); }\n" +
  "}\n" +
  "setTimeout(tick, 100);\n",
  ['tick 1', 'tick 2', 'tick 3', 'done']);

/* ---------------- 5. setInterval + clearInterval ---------------- */
runCase('interval clears itself',
  "var i = 0;\n" +
  "var id = setInterval(function () { i++; console.log('iv', i); if (i === 2) { clearInterval(id); } }, 50);\n",
  ['iv 1', 'iv 2']);

/* ---------------- 6. queueMicrotask ---------------- */
runCase('queueMicrotask',
  "queueMicrotask(function () { console.log('qm'); });\n" +
  "setTimeout(function () { console.log('T'); }, 0);\n" +
  "console.log('sync');\n",
  ['sync', 'qm', 'T']);

/* ---------------- 7. task callback frame visibility ---------------- */
(function () {
  logs = [];
  frameSpy = { counts: {} };
  const interp = build(
    "function myCb() { var x = 41; return x + 1; }\n" +
    "setTimeout(myCb, 10);\n", false);
  drive(interp);
  console.log('\n[task frame visibility] callback frames seen:', JSON.stringify(frameSpy.counts));
  if ((frameSpy.counts['myCb'] || 0) > 0) console.log('  PASS myCb frame visible while task ran');
  else { failures++; console.log('  FAIL myCb frame never visible'); }
})();

/* ---------------- 8. task tagging for the queue UI ---------------- */
(function () {
  const interp = build("setTimeout(function () {}, 123); setInterval(function () {}, 250);", false);
  // program must run first so tasks exist
  drive2(interp);
  function drive2(interp) {
    for (let i = 0; i < 50; i++) {
      const more = interp.step();
      if (!more) break;
      if (interp.getStatus() === Interpreter.Status.TASK || interp.getStatus() === Interpreter.Status.STEP) {
        const st = interp.stateStack[interp.stateStack.length - 1];
        if (!st || (st.node.type === 'Program' && st.done)) break;
      }
    }
  }
  // drive2 stops right when program done (before tasks fire) — read tags then
  const q = interp.tasks.map((t) => Env.taskLabel(interp, t) + ' [due in ' + Math.round(t.time - Date.now()) + 'ms]');
  console.log('\n[task tagging] queue:', JSON.stringify(q));
  const ok = q.length === 2 && q[0].indexOf('setTimeout \u00B7 123ms') === 0 && q[1].indexOf('setInterval \u00B7 250ms') === 0;
  if (ok) console.log('  PASS tags + delays');
  else { failures++; console.log('  FAIL tags incorrect'); }
})();

/* ---------------- 9. throw inside microtask ---------------- */
(function () {
  logs = [];
  const interp = build("queueMicrotask(function () { throw new Error('boom'); });", false);
  const r = drive(interp);
  console.log('\n[microtask error] result:', JSON.stringify(r));
  if (r.error && /boom/.test(r.error)) console.log('  PASS error surfaced');
  else { failures++; console.log('  FAIL error not surfaced'); }
})();

/* ---------------- 10. Promise.all / thenable ---------------- */
runCase('Promise.all + thenable',
  "Promise.all([Promise.resolve(1), Promise.resolve(2)]).then(function (v) { console.log('all', v[0] + v[1]); });\n" +
  "var t = { then: function (res) { res(42); } };\n" +
  "Promise.resolve(t).then(function (v) { console.log('thenable', v); });\n",
  ['thenable 42', 'all 3']);

/* ---------------- 11. ES2016 exponentiation via Babel ---------------- */
(function () {
  const out = Babel.transform("console.log(2 ** 10);\n", {
    presets: [['es2015', { loose: true }], ['es2016', { loose: true }], ['es2017', { loose: true }]],
    retainLines: true, sourceType: 'script'
  }).code;
  logs = [];
  const interp = build(out, false);
  const r = drive(interp);
  console.log('\n[babel es2016 **] result=' + JSON.stringify(r).slice(0, 80));
  check('exponentiation', logs, ['1024']);
})();

/* ---------------- 12. ES2017 async/await via regenerator ---------------- */
(function () {
  const src =
    "function delay(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }\n" +
    "async function main() {\n" +
    "  console.log('start');\n" +
    "  await delay(10);\n" +
    "  console.log('awaited');\n" +
    "  try { await Promise.reject(new Error('nope')); } catch (e) { console.log('caught', e.message); }\n" +
    "  return 5;\n" +
    "}\n" +
    "main().then(function (r) { console.log('ret', r); });\n" +
    "console.log('sync end');\n";
  const out = Babel.transform(src, {
    presets: [['es2015', { loose: true }], ['es2016', { loose: true }], ['es2017', { loose: true }]],
    retainLines: true, sourceType: 'script'
  }).code;
  if (out.indexOf('regeneratorRuntime') === -1) {
    failures++;
    console.log('\n[async/await] FAIL transform did not emit regeneratorRuntime');
    return;
  }
  logs = [];
  const t0 = Date.now();
  const interp = build(out, true);
  const buildMs = Date.now() - t0;
  const r = drive(interp);
  console.log('\n[async/await regenerator] build=' + buildMs + 'ms result=' + JSON.stringify(r).slice(0, 100));
  check('async/await order', logs, ['start', 'sync end', 'awaited', 'caught nope', 'ret 5']);
})();

/* ---------------- 13. every step-able example builds + runs ---------------- */
(function () {
  const exCtx = {}; exCtx.window = exCtx;
  vm.createContext(exCtx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/examples.js'), 'utf8'), exCtx);
  const examples = exCtx.JV.Examples;
  for (const ex of examples) {
    if (ex.modes !== 'both') continue;
    logs = [];
    let interp = null;
    try { interp = build(ex.code, false); } catch (e) {
      failures++; console.log('  FAIL example parses:', ex.id, e.message); continue;
    }
    const r = drive(interp);
    if (r.error || r.overflow) { failures++; console.log('  FAIL example runs:', ex.id, JSON.stringify(r)); }
    else console.log('  PASS example', ex.id, '→', JSON.stringify(logs).slice(0, 110));
  }
  const el = examples.find((e) => e.id === 'eventloop');
  logs = [];
  const i2 = build(el.code, false);
  const r2 = drive(i2);
  if (r2.error || r2.overflow) failures++;
  check('eventloop order', logs,
    ['A \u2014 main script starts', 'B \u2014 main script ends', 'C \u2014 promise microtask',
     'E \u2014 first setTimeout(0)', 'D \u2014 second setTimeout(0)', 'F \u2014 microtask queued by a timer']);
})();

console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL TESTS PASSED'));
process.exit(failures ? 1 : 0);
