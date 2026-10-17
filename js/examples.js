/* JS Visualizer — curated example snippets.
   modes: 'run' = needs real browser APIs (DOM/canvas/async); 'both' = ES5 logic, step-able.
   sibling: suggested replacement when switching to Step mode from a run-only example. */
window.JV = window.JV || {};

JV.Examples = [
  {
    id: 'balls',
    name: 'Bouncing balls (canvas)',
    modes: 'run',
    defaultMode: 'run',
    autoRun: true,
    sibling: 'fibonacci',
    code:
'// Bouncing balls — a canvas animation.\n' +
'// Press Run and watch the preview pane.\n' +
'// (Switch to Step mode for a logic example.)\n' +
'\n' +
'document.body.style.margin = "0";\n' +
'document.body.style.padding = "0";\n' +
'var canvas = document.createElement("canvas");\n' +
'var ctx = canvas.getContext("2d");\n' +
'document.body.appendChild(canvas);\n' +
'\n' +
'function resize() {\n' +
'  canvas.width = window.innerWidth;\n' +
'  canvas.height = window.innerHeight;\n' +
'}\n' +
'window.addEventListener("resize", resize);\n' +
'resize();\n' +
'\n' +
'var colors = ["#58a6ff", "#bc8cff", "#3fb950", "#f85149", "#ffa657", "#39c5cf"];\n' +
'var balls = [];\n' +
'\n' +
'for (var i = 0; i < 20; i++) {\n' +
'  balls.push({\n' +
'    x: Math.random() * canvas.width,\n' +
'    y: Math.random() * canvas.height,\n' +
'    vx: (Math.random() - 0.5) * 6,\n' +
'    vy: (Math.random() - 0.5) * 6,\n' +
'    r: 6 + Math.random() * 14,\n' +
'    color: colors[i % colors.length]\n' +
'  });\n' +
'}\n' +
'\n' +
'console.log("bouncing", balls.length, "balls — resize the preview to watch them adapt");\n' +
'\n' +
'function frame() {\n' +
'  // translucent wipe creates the comet trails\n' +
'  ctx.fillStyle = "rgba(13, 17, 23, 0.22)";\n' +
'  ctx.fillRect(0, 0, canvas.width, canvas.height);\n' +
'\n' +
'  for (var i = 0; i < balls.length; i++) {\n' +
'    var b = balls[i];\n' +
'    b.x += b.vx;\n' +
'    b.y += b.vy;\n' +
'\n' +
'    if (b.x < b.r || b.x > canvas.width - b.r) {\n' +
'      b.vx *= -1;\n' +
'      b.x = Math.min(Math.max(b.x, b.r), canvas.width - b.r);\n' +
'    }\n' +
'    if (b.y < b.r || b.y > canvas.height - b.r) {\n' +
'      b.vy *= -1;\n' +
'      b.y = Math.min(Math.max(b.y, b.r), canvas.height - b.r);\n' +
'    }\n' +
'\n' +
'    ctx.beginPath();\n' +
'    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);\n' +
'    ctx.fillStyle = b.color;\n' +
'    ctx.fill();\n' +
'  }\n' +
'  requestAnimationFrame(frame);\n' +
'}\n' +
'\n' +
'frame();\n'
  },

  {
    id: 'fibonacci',
    name: 'Fibonacci — recursion',
    modes: 'both',
    defaultMode: 'run',
    autoRun: true,
    code:
'// Fibonacci — recursion you can actually see.\n' +
'// Tip: switch to Step mode and press Step to watch\n' +
'// the call stack grow and unwind, one call at a time.\n' +
'\n' +
'function fib(n) {\n' +
'  if (n <= 1) return n;\n' +
'  return fib(n - 1) + fib(n - 2);\n' +
'}\n' +
'\n' +
'var n = 6;\n' +
'var result = fib(n);\n' +
'\n' +
'console.log("fib(" + n + ") = " + result);\n'
  },

  {
    id: 'bubble',
    name: 'Bubble sort — watch it swap',
    modes: 'both',
    defaultMode: 'run',
    autoRun: true,
    code:
'// Bubble sort — the classic sorting algorithm.\n' +
'// Step mode is great for this one: press Step and watch\n' +
'// the array get sorted, swap by swap.\n' +
'\n' +
'var arr = [5, 2, 9, 1, 6, 3];\n' +
'console.log("start:    " + arr.join(", "));\n' +
'\n' +
'for (var i = 0; i < arr.length - 1; i++) {\n' +
'  for (var j = 0; j < arr.length - 1 - i; j++) {\n' +
'    if (arr[j] > arr[j + 1]) {\n' +
'      var tmp = arr[j];\n' +
'      arr[j] = arr[j + 1];\n' +
'      arr[j + 1] = tmp;\n' +
'      console.log("swap ->   " + arr.join(", "));\n' +
'    }\n' +
'  }\n' +
'}\n' +
'\n' +
'console.log("sorted:   " + arr.join(", "));\n'
  },

  {
    id: 'closures',
    name: 'Closures — a counter',
    modes: 'both',
    defaultMode: 'run',
    autoRun: true,
    code:
'// Closures — functions that remember.\n' +
'// Step through this one and click the dashed\n' +
'// "closure scope" frame to see the captured variable.\n' +
'\n' +
'function makeCounter(label) {\n' +
'  var count = 0;\n' +
'\n' +
'  function bump() {\n' +
'    count = count + 1;\n' +
'    return label + ": " + count;\n' +
'  }\n' +
'\n' +
'  return bump;\n' +
'}\n' +
'\n' +
'var apples = makeCounter("apples");\n' +
'var oranges = makeCounter("oranges");\n' +
'\n' +
'console.log(apples());\n' +
'console.log(apples());\n' +
'console.log(oranges());\n' +
'console.log(apples());\n' +
'console.log(oranges());\n'
  },

  {
    id: 'objects',
    name: 'Objects — an inventory',
    modes: 'both',
    defaultMode: 'run',
    autoRun: true,
    code:
'// Objects — properties and methods.\n' +
'// In Step mode, watch the object literal change\n' +
'// as the add() method mutates it.\n' +
'\n' +
'var inventory = {\n' +
'  apples: 3,\n' +
'  bananas: 5,\n' +
'  add: function (item, amount) {\n' +
'    if (this[item] === undefined) {\n' +
'      this[item] = 0;\n' +
'    }\n' +
'    this[item] = this[item] + amount;\n' +
'  }\n' +
'};\n' +
'\n' +
'inventory.add("apples", 2);\n' +
'inventory.add("kiwis", 4);\n' +
'\n' +
'console.log("apples:", inventory.apples);\n' +
'console.log("kiwis: ", inventory.kiwis);\n' +
'console.log(inventory);\n'
  },

  {
    id: 'dom',
    name: 'DOM — a greeting card',
    modes: 'run',
    defaultMode: 'run',
    autoRun: true,
    sibling: 'closures',
    code:
'// A tiny DOM app with styles and events.\n' +
'// The preview pane is a real web page —\n' +
'// everything you write here renders there.\n' +
'\n' +
'document.body.innerHTML = `\n' +
'  <div class="card">\n' +
'    <h1>Hello, world!</h1>\n' +
'    <p id="msg">Click the button for a random greeting.</p>\n' +
'    <button id="btn">Surprise me</button>\n' +
'  </div>\n' +
'`;\n' +
'\n' +
'var style = document.createElement("style");\n' +
'style.textContent = `\n' +
'  body {\n' +
'    display: grid;\n' +
'    place-items: center;\n' +
'    min-height: 100vh;\n' +
'    margin: 0;\n' +
'    background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);\n' +
'    font-family: system-ui, sans-serif;\n' +
'  }\n' +
'  .card {\n' +
'    background: rgba(255, 255, 255, 0.06);\n' +
'    border: 1px solid rgba(255, 255, 255, 0.15);\n' +
'    border-radius: 20px;\n' +
'    padding: 40px 48px;\n' +
'    text-align: center;\n' +
'    color: #fff;\n' +
'    backdrop-filter: blur(8px);\n' +
'    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);\n' +
'  }\n' +
'  .card h1 { margin: 0 0 10px; font-size: 28px; }\n' +
'  .card p { color: #9fd3ff; min-height: 22px; }\n' +
'  .card button {\n' +
'    margin-top: 14px;\n' +
'    padding: 10px 24px;\n' +
'    font-size: 15px;\n' +
'    color: #fff;\n' +
'    background: linear-gradient(180deg, #2ea043, #238636);\n' +
'    border: none;\n' +
'    border-radius: 10px;\n' +
'    cursor: pointer;\n' +
'  }\n' +
'  .card button:hover { filter: brightness(1.15); }\n' +
'`;\n' +
'document.head.appendChild(style);\n' +
'\n' +
'var greetings = [\n' +
'  "May your bugs be shallow and your stack traces short.",\n' +
'  "You are 100% more awesome than yesterday.",\n' +
'  "Have you tried turning it off and on again?",\n' +
'  "Today is a great day to refactor."\n' +
'];\n' +
'\n' +
'document.getElementById("btn").addEventListener("click", function () {\n' +
'  var i = Math.floor(Math.random() * greetings.length);\n' +
'  document.getElementById("msg").textContent = greetings[i];\n' +
'  console.log("greeting #" + i + " shown");\n' +
'});\n' +
'\n' +
'console.log("card ready — click the button in the preview!");\n'
  },

  {
    id: 'particles',
    name: 'Particle galaxy (canvas + rAF)',
    modes: 'run',
    defaultMode: 'run',
    autoRun: true,
    sibling: 'bubble',
    code:
'// A swirling particle galaxy.\n' +
'// All it takes is some math and requestAnimationFrame.\n' +
'\n' +
'document.body.style.margin = "0";\n' +
'document.body.style.padding = "0";\n' +
'var canvas = document.createElement("canvas");\n' +
'var ctx = canvas.getContext("2d");\n' +
'document.body.appendChild(canvas);\n' +
'\n' +
'function resize() {\n' +
'  canvas.width = window.innerWidth;\n' +
'  canvas.height = window.innerHeight;\n' +
'}\n' +
'window.addEventListener("resize", resize);\n' +
'resize();\n' +
'\n' +
'var cx = canvas.width / 2;\n' +
'var cy = canvas.height / 2;\n' +
'var particles = [];\n' +
'\n' +
'for (var i = 0; i < 900; i++) {\n' +
'  var angle = Math.random() * Math.PI * 2;\n' +
'  var radius = Math.pow(Math.random(), 0.6) * 320;\n' +
'  particles.push({\n' +
'    angle: angle,\n' +
'    radius: radius,\n' +
'    speed: (1.2 - radius / 320) * 0.035 + 0.004,\n' +
'    size: Math.random() * 1.8 + 0.4,\n' +
'    hue: (radius / 320) * 240 + 180\n' +
'  });\n' +
'}\n' +
'\n' +
'console.log("galaxy ready:", particles.length, "particles");\n' +
'\n' +
'function frame() {\n' +
'  cx = canvas.width / 2;\n' +
'  cy = canvas.height / 2;\n' +
'  ctx.fillStyle = "rgba(1, 4, 9, 0.25)";\n' +
'  ctx.fillRect(0, 0, canvas.width, canvas.height);\n' +
'  ctx.globalCompositeOperation = "lighter";\n' +
'\n' +
'  for (var i = 0; i < particles.length; i++) {\n' +
'    var p = particles[i];\n' +
'    p.angle += p.speed;\n' +
'\n' +
'    var x = cx + Math.cos(p.angle) * p.radius;\n' +
'    var y = cy + Math.sin(p.angle) * p.radius * 0.62;\n' +
'\n' +
'    ctx.beginPath();\n' +
'    ctx.arc(x, y, p.size, 0, Math.PI * 2);\n' +
'    ctx.fillStyle = "hsl(" + p.hue + ", 90%, 68%)";\n' +
'    ctx.fill();\n' +
'  }\n' +
'  requestAnimationFrame(frame);\n' +
'}\n' +
'\n' +
'frame();\n'
  },

  {
    id: 'async',
    name: 'Async — microtasks before timers',
    modes: 'both',
    defaultMode: 'run',
    autoRun: true,
    code:
'// The event loop explained by its output order.\n' +
'// Watch the console numbers — 3 comes before 4\n' +
'// even though its code appears later.\n' +
'//\n' +
'// In Step mode you can also watch the microtask\n' +
'// queue and task queue fill up and drain.\n' +
'\n' +
'console.log("1 — synchronous start");\n' +
'\n' +
'setTimeout(function () {\n' +
'  console.log("4 — setTimeout(0) macrotask");\n' +
'}, 0);\n' +
'\n' +
'Promise.resolve().then(function () {\n' +
'  console.log("3 — promise microtask");\n' +
'});\n' +
'\n' +
'console.log("2 — synchronous end");\n' +
'\n' +
'// microtasks (promises) always run before\n' +
'// macrotasks (timers), no matter the delay.\n'
  },

  {
    id: 'eventloop',
    name: 'Event loop — queues in action',
    modes: 'both',
    defaultMode: 'step',
    autoRun: false,
    code:
'// The event loop, in slow motion.\n' +
'// Press Step repeatedly (or Play) and watch:\n' +
'//   \u2022 sync code runs first        (A, B)\n' +
'//   \u2022 microtasks drain next        (C)\n' +
'//   \u2022 then timers, in arrival order (E, then D)\n' +
'//   \u2022 a timer can queue its own microtask (F)\n' +
'\n' +
'console.log("A \u2014 main script starts");\n' +
'\n' +
'setTimeout(function () {\n' +
'  console.log("E \u2014 first setTimeout(0)");\n' +
'}, 0);\n' +
'\n' +
'Promise.resolve().then(function () {\n' +
'  console.log("C \u2014 promise microtask");\n' +
'});\n' +
'\n' +
'setTimeout(function () {\n' +
'  console.log("D \u2014 second setTimeout(0)");\n' +
'  queueMicrotask(function () {\n' +
'    console.log("F \u2014 microtask queued by a timer");\n' +
'  });\n' +
'}, 0);\n' +
'\n' +
'console.log("B \u2014 main script ends");\n'
  }
];

JV.DEFAULT_EXAMPLE_ID = 'balls';

JV.findExample = function (id) {
  for (var i = 0; i < JV.Examples.length; i++) {
    if (JV.Examples[i].id === id) return JV.Examples[i];
  }
  return null;
};
