/* JS Visualizer — code editor with syntax highlighting, line numbers and active-line band. */
window.JV = window.JV || {};

JV.Editor = (function () {
  'use strict';

  var LINE_HEIGHT = 22;
  var PAD_TOP = 14;

  var KEYWORDS = ('break case catch class const continue debugger default delete do else export extends finally for function if import in ' +
    'instanceof let new of return static super switch this throw try typeof var void while with yield async await').split(' ');
  var KEYWORD_SET = {};
  KEYWORDS.forEach(function (k) { KEYWORD_SET[k] = true; });
  var CONSTANTS = { 'true': 1, 'false': 1, 'null': 1, 'undefined': 1, 'NaN': 1, 'Infinity': 1 };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* -------- tokenizer -------- */
  function tokenize(code) {
    var out = [];
    var i = 0;
    var n = code.length;
    var lastSignificant = '';
    var isIdent = /[A-Za-z0-9_$]/;

    function push(cls, text) {
      if (!text) return;
      out.push(cls ? '<span class="tk-' + cls + '">' + escapeHtml(text) + '</span>' : escapeHtml(text));
    }

    while (i < n) {
      var c = code[i];
      var c2 = code[i + 1];

      if (c === '/' && c2 === '/') {
        var j = code.indexOf('\n', i);
        if (j === -1) j = n;
        push('com', code.slice(i, j));
        i = j;
        continue;
      }
      if (c === '/' && c2 === '*') {
        var j2 = code.indexOf('*/', i + 2);
        j2 = j2 === -1 ? n : j2 + 2;
        push('com', code.slice(i, j2));
        i = j2;
        continue;
      }
      if (c === '`') {
        var j3 = i + 1;
        var depth = 0;
        while (j3 < n) {
          if (code[j3] === '\\') { j3 += 2; continue; }
          if (code[j3] === '`' && depth === 0) { j3++; break; }
          if (code[j3] === '$' && code[j3 + 1] === '{') depth++;
          else if (code[j3] === '}' && depth > 0) depth--;
          j3++;
        }
        push('str', code.slice(i, j3));
        i = j3;
        lastSignificant = ')';
        continue;
      }
      if (c === '"' || c === "'") {
        var j4 = i + 1;
        while (j4 < n) {
          if (code[j4] === '\\') { j4 += 2; continue; }
          if (code[j4] === c) { j4++; break; }
          if (code[j4] === '\n') break;
          j4++;
        }
        push('str', code.slice(i, j4));
        i = j4;
        lastSignificant = ')';
        continue;
      }
      // regex literal heuristic
      if (c === '/' && (lastSignificant === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(lastSignificant) !== -1)) {
        var j5 = i + 1;
        var closed = false;
        var inClass = false;
        while (j5 < n) {
          var rc = code[j5];
          if (rc === '\\') { j5 += 2; continue; }
          if (rc === '\n') break;
          if (rc === '[') inClass = true;
          else if (rc === ']') inClass = false;
          else if (rc === '/' && !inClass) { j5++; closed = true; break; }
          j5++;
        }
        if (closed) {
          while (j5 < n && isIdent.test(code[j5])) j5++;
          push('str', code.slice(i, j5));
          i = j5;
          lastSignificant = ')';
          continue;
        }
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(c2 || ''))) {
        var m = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)/.exec(code.slice(i));
        var numText = m ? m[0] : c;
        push('num', numText);
        i += numText.length;
        lastSignificant = '0';
        continue;
      }
      if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) {
        var j6 = i;
        while (j6 < n && (isIdent.test(code[j6]) || code.charCodeAt(j6) > 127)) j6++;
        var word = code.slice(i, j6);
        var k = j6;
        while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
        if (KEYWORD_SET[word]) push('kw', word);
        else if (CONSTANTS[word]) push('const', word);
        else if (word === 'this') push('this', word);
        else if (lastSignificant === '.') push('prop', word);
        else if (code[k] === '(') push('fn', word);
        else push('', word);
        i = j6;
        lastSignificant = 'a';
        continue;
      }
      if ('()[]{}'.indexOf(c) !== -1) { push('punc', c); lastSignificant = c; i++; continue; }
      if (c === '\n') { push('', c); lastSignificant = ''; i++; continue; }
      if (c === ' ' || c === '\t') { push('', c); i++; continue; }
      push('', c);
      if (c !== '.') lastSignificant = c;
      i++;
    }
    return out.join('') + '\n';
  }

  /* -------- editor -------- */
  function Editor(opts) {
    this.textarea = opts.textarea;
    this.gutterInner = opts.gutterInner;
    this.highlight = opts.highlight;
    this.highlightInner = opts.highlightInner;
    this.lineBand = opts.lineBand;
    this.onChange = opts.onChange || function () {};
    this.onCursor = opts.onCursor || function () {};
    this.onSubmit = opts.onSubmit || function () {};

    this.activeLine = null;
    this.errorLine = null;
    this.lineEls = [];
    this._raf = 0;
    this._silent = false;
    this._boundScroll = this._syncScroll.bind(this);

    var self = this;
    this.textarea.addEventListener('scroll', this._boundScroll, { passive: true });
    this.textarea.addEventListener('input', function () {
      self.refresh();
      if (!self._silent) self.onChange();
      self._reportCursor();
    });
    this.textarea.addEventListener('keydown', function (e) { self._onKeyDown(e); });
    this.textarea.addEventListener('click', function () { self._reportCursor(); });
    this.textarea.addEventListener('keyup', function () { self._reportCursor(); });

    window.addEventListener('resize', function () { self.refresh(); });

    this.setValue('');
  }

  Editor.prototype._syncScroll = function () {
    var st = this.textarea.scrollTop;
    var sl = this.textarea.scrollLeft;
    this.highlightInner.style.transform = 'translate(' + (-sl) + 'px,' + (-st) + 'px)';
    this.gutterInner.style.transform = 'translateY(' + (-st) + 'px)';
  };

  Editor.prototype.refresh = function () {
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      self._renderHighlight();
      self._renderGutter();
      self._syncScroll();
    });
  };

  Editor.prototype._renderHighlight = function () {
    this.highlight.innerHTML = tokenize(this.textarea.value);
    this._placeBand();
  };

  Editor.prototype._renderGutter = function () {
    var lines = this.textarea.value.split('\n').length;
    if (lines !== this.lineEls.length) {
      var html = '';
      for (var i = 1; i <= lines; i++) html += '<div class="ln">' + i + '</div>';
      this.gutterInner.innerHTML = html;
      this.lineEls = Array.prototype.slice.call(this.gutterInner.children);
    }
    this._paintLines();
  };

  Editor.prototype._paintLines = function () {
    for (var i = 0; i < this.lineEls.length; i++) {
      var el = this.lineEls[i];
      var num = i + 1;
      var cls = 'ln';
      if (num === this.errorLine) cls += ' error';
      else if (num === this.activeLine) cls += ' active';
      if (el.className !== cls) el.className = cls;
    }
  };

  Editor.prototype._placeBand = function () {
    var line = this.errorLine || this.activeLine;
    if (!line) {
      this.lineBand.className = 'line-band';
      return;
    }
    this.lineBand.style.top = (PAD_TOP + (line - 1) * LINE_HEIGHT) + 'px';
    this.lineBand.className = 'line-band show' + (this.errorLine ? ' error' : '');
  };

  Editor.prototype.setActiveLine = function (line) {
    if (line === this.activeLine) return;
    this.activeLine = line;
    this._placeBand();
    this._paintLines();
    if (line) this.ensureLineVisible(line);
  };

  Editor.prototype.setErrorLine = function (line) {
    this.errorLine = line || null;
    this._placeBand();
    this._paintLines();
    if (line) this.ensureLineVisible(line);
  };

  Editor.prototype.ensureLineVisible = function (line) {
    var ta = this.textarea;
    var y = (line - 1) * LINE_HEIGHT;
    var viewH = ta.clientHeight - PAD_TOP * 2;
    var top = ta.scrollTop;
    if (y < top + LINE_HEIGHT || y + LINE_HEIGHT > top + viewH) {
      ta.scrollTop = Math.max(0, y - viewH / 2 + LINE_HEIGHT / 2);
      this._syncScroll();
    }
  };

  Editor.prototype.getLineAtCursor = function () {
    var pos = this.textarea.selectionStart;
    var value = this.textarea.value;
    var line = 1;
    var col = 1;
    for (var i = 0; i < pos; i++) {
      if (value.charCodeAt(i) === 10) { line++; col = 1; } else col++;
    }
    return { line: line, col: col, pos: pos };
  };

  Editor.prototype._reportCursor = function () {
    var p = this.getLineAtCursor();
    this.onCursor(p.line, p.col);
  };

  Editor.prototype._insertText = function (text, optStart, optEnd) {
    var ta = this.textarea;
    if (optStart !== undefined) {
      ta.setSelectionRange(optStart, optEnd === undefined ? optStart : optEnd);
    }
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var v = ta.value;
      ta.value = v.slice(0, start) + text + v.slice(end);
      ta.selectionStart = ta.selectionEnd = start + text.length;
      this.refresh();
      this.onChange();
    }
    this._reportCursor();
  };

  Editor.prototype._onKeyDown = function (e) {
    var ta = this.textarea;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.onSubmit();
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.shiftKey) {
        this._insertText('  ');
      } else {
        this._outdent();
      }
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      var value = ta.value;
      var pos = ta.selectionStart;
      var lineStart = value.lastIndexOf('\n', pos - 1) + 1;
      var lineText = value.slice(lineStart, pos);
      var indent = (/^[ \t]*/.exec(lineText) || [''])[0];
      var trimmed = lineText.replace(/[ \t]+$/, '');
      var extra = '';
      if (/[{([:]$/.test(trimmed) || /=>$/.test(trimmed)) extra = '  ';
      e.preventDefault();
      this._insertText('\n' + indent + extra);
      return;
    }
    // soft backspace over leading indentation: let default; keep simple.
  };

  Editor.prototype._outdent = function () {
    var ta = this.textarea;
    var value = ta.value;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lastLineEnd = value.indexOf('\n', end);
    if (lastLineEnd === -1) lastLineEnd = value.length;
    var block = value.slice(firstLineStart, lastLineEnd);
    var outdented = block.split('\n').map(function (l) {
      if (l.slice(0, 2) === '  ') return l.slice(2);
      if (l[0] === ' ' || l[0] === '\t') return l.slice(1);
      return l;
    }).join('\n');
    if (outdented !== block) {
      this._insertText(outdented, firstLineStart, lastLineEnd);
    }
  };

  Editor.prototype.setValue = function (text) {
    this._silent = true;
    this.textarea.value = text;
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this.activeLine = null;
    this.errorLine = null;
    this.refresh();
    this._silent = false;
    this._reportCursor();
  };

  Editor.prototype.getValue = function () {
    return this.textarea.value;
  };

  Editor.prototype.focus = function () {
    this.textarea.focus();
  };

  return Editor;
})();
