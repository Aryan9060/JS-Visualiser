/* JS Visualizer — application wiring: modes, controls, examples, status. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    modeSwitch: $('modeSwitch'),
    examplesSelect: $('examplesSelect'),
    primaryBtn: $('primaryBtn'),
    primaryIco: $('primaryIco'),
    primaryLabel: $('primaryLabel'),

    codeEditor: $('codeEditor'),
    gutterInner: $('gutterInner'),
    highlight: $('highlight'),
    highlightInner: $('highlightInner'),
    lineBand: $('lineBand'),
    statusPos: $('statusPos'),
    statusMsg: $('statusMsg'),
    statusRight: $('statusRight'),

    vizTitle: $('vizTitle'),
    modeNote: $('modeNote'),
    viewPreview: $('viewPreview'),
    viewState: $('viewState'),
    previewFrame: $('previewFrame'),
    btnRefresh: $('btnRefresh'),
    btnClearPreview: $('btnClearPreview'),

    btnReset: $('btnReset'),
    btnBack: $('btnBack'),
    btnStep: $('btnStep'),
    btnPlay: $('btnPlay'),
    speedSelect: $('speedSelect'),
    stepCounter: $('stepCounter'),
    stackList: $('stackList'),
    varsList: $('varsList'),
    varsScopeName: $('varsScopeName'),
    loopPhase: $('loopPhase'),
    loopPhaseText: $('loopPhaseText'),
    loopMicroList: $('loopMicroList'),
    loopMacroList: $('loopMacroList'),
    loopMicroCount: $('loopMicroCount'),
    loopMacroCount: $('loopMacroCount'),

    consoleList: $('consoleList'),
    msgCount: $('msgCount'),
    btnClearConsole: $('btnClearConsole'),
    toastStack: $('toastStack')
  };

  var mode = 'run';
  var currentExampleId = null;
  var editorDirty = false;
  var suppressDirty = false;

  /* ---------------- helpers ---------------- */

  function setStatus(text, kind) {
    els.statusMsg.textContent = text;
    els.statusMsg.className = kind || '';
  }

  function toast(text, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    els.toastStack.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 3200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3600);
  }

  /* ---------------- editor ---------------- */

  var editor = new JV.Editor({
    textarea: els.codeEditor,
    gutterInner: els.gutterInner,
    highlight: els.highlight,
    highlightInner: els.highlightInner,
    lineBand: els.lineBand,
    onChange: function () {
      if (!suppressDirty) editorDirty = true;
    },
    onCursor: function (line, col) {
      els.statusPos.textContent = 'Ln ' + line + ', Col ' + col;
    },
    onSubmit: function () { primaryAction(); }
  });

  /* ---------------- console ---------------- */

  JV.Console.init(els.consoleList, els.msgCount, {
    onLineClick: function (line) {
      editor.setErrorLine(line);
    }
  });

  els.btnClearConsole.addEventListener('click', function () {
    JV.Console.clear();
    stepper.log = [];
    setStatus('console cleared', '');
  });

  /* ---------------- run mode ---------------- */

  JV.Runner.init({
    frame: els.previewFrame,
    onMessage: function (d) {
      // Late messages from the sandbox (or an ongoing animation) must not
      // leak into the console once the user has switched to step mode.
      if (mode !== 'run') return;
      JV.Console.addMessage(d);
      if (d.level === 'system') {
        setStatus('live \u2014 script finished', 'ok');
        runBtnIdle();
      } else if (d.level === 'uncaught') {
        setStatus('error \u2014 see console', 'error');
        if (d.line) editor.setErrorLine(d.line);
        runBtnIdle();
      }
    }
  });

  function runBtnBusy() {
    els.primaryBtn.classList.add('running');
    els.primaryIco.textContent = '\u21BB';
  }
  function runBtnIdle() {
    els.primaryBtn.classList.remove('running');
    els.primaryIco.textContent = mode === 'run' ? '\u25B6' : '\u21BA';
  }

  function runCode() {
    JV.Console.clear();
    editor.setErrorLine(null);
    runBtnBusy();
    setStatus('running\u2026', 'pending');
    JV.Runner.run(editor.getValue());
  }

  els.btnRefresh.addEventListener('click', runCode);

  els.btnClearPreview.addEventListener('click', function () {
    JV.Runner.clear();
    setStatus('preview cleared', '');
  });

  /* ---------------- step mode ---------------- */

  var stepper = new JV.Stepper({
    editor: editor,
    consoleUI: JV.Console,
    els: els,
    setStatus: setStatus,
    toast: toast
  });

  els.btnStep.addEventListener('click', function () { stepper.stepForward(); });
  els.btnBack.addEventListener('click', function () { stepper.back(); });
  els.btnPlay.addEventListener('click', function () { stepper.play(); });
  els.btnReset.addEventListener('click', function () { stepper.reset(); });

  /* ---------------- mode switching ---------------- */

  function setMode(m, opts) {
    opts = opts || {};
    mode = m;

    var buttons = els.modeSwitch.querySelectorAll('button');
    Array.prototype.forEach.call(buttons, function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === m);
    });

    if (m === 'run') {
      els.viewPreview.classList.remove('hidden');
      els.viewState.classList.add('hidden');
      els.vizTitle.textContent = 'Live preview';
      els.modeNote.textContent = 'executes in a sandbox \u2014 DOM, canvas and console output render live';
      els.primaryLabel.textContent = 'Run';
      els.primaryIco.textContent = '\u25B6';
      els.primaryBtn.title = 'Run code (Ctrl+Enter)';
      els.statusRight.textContent = 'run mode';
      editor.setActiveLine(null);
      // entering run mode: tell the sandbox to re-measure (canvas apps that
      // sized themselves while the preview pane was hidden by step mode)
      JV.Runner.nudge();
    } else {
      els.viewPreview.classList.add('hidden');
      els.viewState.classList.remove('hidden');
      els.vizTitle.textContent = 'Execution state';
      els.modeNote.textContent = 'steps through ES5\u2013ES7 \u2014 call stack, event loop, variables and console update each step';
      els.primaryLabel.textContent = 'Reset';
      els.primaryIco.textContent = '\u21BA';
      els.primaryBtn.title = 'Reload the code and restart stepping (Ctrl+Enter)';
      els.statusRight.textContent = 'step mode';
      maybeLoadStepSibling();
      stepper.load(editor.getValue());
    }
  }

  function maybeLoadStepSibling() {
    if (editorDirty) return;
    var ex = JV.findExample(currentExampleId);
    if (ex && ex.modes === 'run' && ex.sibling) {
      loadExample(ex.sibling, { keepMode: true, silent: true, noAutoRun: true });
      toast('Loaded a step-friendly example \u2014 the previous one needs browser APIs');
    }
  }

  els.modeSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    setMode(btn.getAttribute('data-mode'));
  });

  /* ---------------- examples ---------------- */

  (function populateExamples() {
    for (var i = 0; i < JV.Examples.length; i++) {
      var ex = JV.Examples[i];
      var opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = ex.name;
      els.examplesSelect.appendChild(opt);
    }
  })();

  els.examplesSelect.addEventListener('change', function () {
    loadExample(els.examplesSelect.value);
  });

  function loadExample(id, opts) {
    opts = opts || {};
    var ex = JV.findExample(id);
    if (!ex) return;
    currentExampleId = id;
    els.examplesSelect.value = id;

    suppressDirty = true;
    editor.setValue(ex.code);
    suppressDirty = false;
    editorDirty = false;

    if (!opts.keepMode) setMode(ex.defaultMode);
    if (!opts.noAutoRun && ex.autoRun && mode === 'run') runCode();
    if (!opts.silent) toast('Loaded: ' + ex.name);
  }

  /* ---------------- primary action ---------------- */

  function primaryAction() {
    if (mode === 'run') runCode();
    else stepper.reset();
  }

  els.primaryBtn.addEventListener('click', primaryAction);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      primaryAction();
    }
  });

  /* ---------------- boot ---------------- */

  // Deferred past the initial page parse: srcdoc navigations during parse can
  // be dropped in some engines, silently losing the boot auto-run.
  setTimeout(function () {
    loadExample(JV.DEFAULT_EXAMPLE_ID, { silent: true });
    setMode('run');
    setStatus('press Run to execute \u2014 Ctrl+Enter works too', '');
  }, 0);

  // handle for the devtools console / automated testing
  JV.app = {
    editor: editor,
    stepper: stepper,
    runCode: runCode,
    setMode: setMode,
    loadExample: loadExample,
    getMode: function () { return mode; }
  };
})();
