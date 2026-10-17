'use strict';
/* Verify vendor patch #2: with single-step granularity, every event-loop
   handoff is observable as a returned state with stack top = done Program
   and tasks still queued (instead of being consumed inside one step()). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/acorn.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/interpreter.js'), 'utf8'), ctx);
vm.runInContext('window.JV = {};', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/interp-env.js'), 'utf8'), ctx);

const Interpreter = ctx.Interpreter;
const Env = ctx.JV.InterpEnv;

const code = [
  'console.log("A");',
  'setTimeout(function () { console.log("E"); }, 0);',
  'Promise.resolve().then(function () { console.log("C"); });',
  'setTimeout(function () { console.log("D"); queueMicrotask(function () { console.log("F"); }); }, 0);',
  'console.log("B");'
].join('\n');

const logs = [];
const interp = new Interpreter(code, function (interp, globalObject) {
  const consoleObj = interp.createObjectProto(interp.OBJECT_PROTO);
  const mk = () => interp.createNativeFunction(function () {
    logs.push(Array.prototype.slice.call(arguments).map(String).join(' '));
  });
  ['log', 'info', 'warn', 'error', 'debug'].forEach((l) => interp.setProperty(consoleObj, l, mk()));
  interp.setProperty(globalObject, 'console', consoleObj);
  Env.install(interp, globalObject);
  interp.polyfills_.push(Env.PRELUDE);
});

let stepNo = 0;
const handoffs = [];
for (let i = 0; i < 200000; i++) {
  let more;
  more = interp.step();
  stepNo++;
  if (!more) break;
  const stack = interp.stateStack;
  const top = stack[stack.length - 1];
  if (top && top.node.type === 'Program' && top.done && interp.tasks.length > 0) {
    handoffs.push({
      step: stepNo,
      micro: interp.tasks.filter((t) => t.__jvizKind === 'micro').length,
      macro: interp.tasks.filter((t) => t.__jvizKind !== 'micro').length,
      log: logs.slice()
    });
    // emulate stepper: virtual clock fires the next due task
    if (interp.getStatus() === Interpreter.Status.TASK) interp.tasks[0].time = 0;
  }
}

console.log('console order:', JSON.stringify(logs));
console.log('handoff rest-states observed:', handoffs.length);
for (const h of handoffs) {
  console.log(`  step ${h.step}: micro=${h.micro} macro=${h.macro} log=${JSON.stringify(h.log)}`);
}
const expected = ['A', 'B', 'C', 'E', 'D', 'F'].join(' ');
const ok = logs.join(' ') === expected && handoffs.length >= 4;
console.log(ok ? 'PASS handoff checkpoints + order' : 'FAIL');
process.exit(ok ? 0 : 1);
