/* JS Visualizer — console panel + shared value/tree renderer. */
window.JV = window.JV || {};

JV.Console = (function () {
  'use strict';

  var LEVEL_ICONS = {
    log: '\u203A',
    info: 'i',
    warn: '\u26A0',
    error: '\u2715',
    alert: '!',
    uncaught: '\u2715',
    system: '\u2022'
  };

  var LEVEL_CLASS = {
    log: 'msg-log',
    info: 'msg-info',
    warn: 'msg-warn',
    error: 'msg-error',
    alert: 'msg-alert',
    uncaught: 'msg-error',
    system: 'msg-system'
  };

  /* ---------------- value tree rendering ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function primSpan(cls, text) {
    return '<span class="vk-' + cls + '">' + esc(text) + '</span>';
  }

  function renderTree(tree, opts) {
    opts = opts || {};
    var depth = opts.depth || 0;
    if (!tree) return '';

    switch (tree.k) {
      case 'str':
        return primSpan('str', '"' + tree.v + '"');
      case 'num':
        return primSpan('num', String(tree.v));
      case 'bool':
        return primSpan('bool', String(tree.v));
      case 'null':
        return primSpan('null', 'null');
      case 'undef':
        return primSpan('undef', 'undefined');
      case 'empty':
        return primSpan('empty', 'empty');
      case 'sym':
        return primSpan('sym', tree.v);
      case 'fn':
        return primSpan('fn', tree.v);
      case 'err':
        return primSpan('err', tree.v);
      case 'node':
        return primSpan('node', tree.v);
      case 'circ':
        return primSpan('circ', tree.v);
      case 'global':
        return primSpan('global', 'globalThis');
      case 'deep':
        return primSpan('obj-note', '\u2026 ' + tree.v);
    }

    // collections: arr / obj / map / set
    var isArr = tree.k === 'arr';
    var label;
    if (isArr) {
      label = '<span class="type-name">Array</span><span class="obj-brace">(' + tree.n + ')</span>';
    } else if (tree.k === 'map') {
      label = '<span class="type-name">Map</span><span class="obj-brace">(' + tree.n + ')</span>';
    } else if (tree.k === 'set') {
      label = '<span class="type-name">Set</span><span class="obj-brace">(' + tree.n + ')</span>';
    } else {
      label = (tree.ctor ? '<span class="type-name">' + esc(tree.ctor) + '</span> ' : '') + '<span class="obj-brace">{' + (tree.items ? tree.items.length : 0) + '}</span>';
    }

    var open = (depth === 0 && tree.items && tree.items.length) ? ' open' : '';
    var html = '<details class="val-tree"' + open + '>' +
      '<summary><span class="caret">\u25B8</span>' + label + '</summary>' +
      '<div class="val-entries">';
    if (tree.items && tree.items.length) {
      for (var i = 0; i < tree.items.length; i++) {
        var key = tree.items[i][0];
        var child = tree.items[i][1];
        var keyIsIndex = isArr || tree.k === 'set';
        html += '<div class="val-entry">' +
          '<span class="' + (keyIsIndex ? 'val-key' : (/^[A-Za-z_$][\w$]*$/.test(key) ? 'val-key' : 'val-key-str')) + '">' + esc(keyIsIndex ? key : (String(key).match(/^[A-Za-z_$][\w$]*$/) ? key : JSON.stringify(key))) + '</span>' +
          '<span class="val-colon">:</span>' +
          '<span class="var-val">' + renderTree(child, { depth: depth + 1 }) + '</span>' +
          '</div>';
      }
    } else {
      html += '<div class="val-entry"><span class="val-more">' + (isArr ? 'empty array' : 'no properties') + '</span></div>';
    }
    if (tree.more) {
      html += '<div class="val-entry"><span class="val-more">\u2026 +' + tree.more + ' more</span></div>';
    }
    html += '</div></details>';
    return html;
  }

  /* ---------------- console panel ---------------- */

  function Console() {
    this.listEl = null;
    this.countEl = null;
    this.onLineClick = null;
    this.messages = [];
  }

  Console.prototype.init = function (listEl, countEl, opts) {
    this.listEl = listEl;
    this.countEl = countEl;
    this.onLineClick = (opts && opts.onLineClick) || null;
    var self = this;
    this.listEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.msg-line-chip');
      if (chip && self.onLineClick) self.onLineClick(parseInt(chip.getAttribute('data-line'), 10));
    });
    this._renderEmpty();
  };

  Console.prototype._renderEmpty = function () {
    this.listEl.innerHTML = '<div class="console-empty"><div class="big">{ }</div><div>console output appears here</div></div>';
  };

  Console.prototype._updateCount = function () {
    if (!this.countEl) return;
    this.countEl.textContent = this.messages.length ? this.messages.length + ' message' + (this.messages.length > 1 ? 's' : '') : '';
  };

  Console.prototype.clear = function () {
    this.messages = [];
    this._renderEmpty();
    this._updateCount();
  };

  Console.prototype.setMessages = function (msgs) {
    this.messages = msgs.slice();
    if (!msgs.length) {
      this._renderEmpty();
      this._updateCount();
      return;
    }
    var html = '';
    for (var i = 0; i < msgs.length; i++) html += this._msgHtml(msgs[i]);
    this.listEl.innerHTML = html;
    this._updateCount();
    this.listEl.scrollTop = this.listEl.scrollHeight;
  };

  Console.prototype.addMessage = function (msg) {
    var emptyEl = this.listEl.querySelector('.console-empty');
    if (emptyEl) this.listEl.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.innerHTML = this._msgHtml(msg);
    var atBottom = this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 60;
    this.listEl.appendChild(wrap.firstChild);
    this.messages.push(msg);
    this._updateCount();
    if (atBottom) this.listEl.scrollTop = this.listEl.scrollHeight;
    return msg;
  };

  Console.prototype._msgHtml = function (msg) {
    var level = msg.level || 'log';
    var ico = LEVEL_ICONS[level] || LEVEL_ICONS.log;
    var cls = LEVEL_CLASS[level] || LEVEL_CLASS.log;
    var body = '';
    var trees = msg.trees || [];
    for (var i = 0; i < trees.length; i++) {
      if (i) body += ' ';
      body += renderTree(trees[i], { depth: 0 });
    }
    if (msg.text !== undefined && !trees.length) body = esc(msg.text);
    if (msg.line) {
      body += '<span class="msg-line-chip" data-line="' + msg.line + '" title="Show this line in the editor">line ' + msg.line + '</span>';
    }
    var tag = msg.tag ? '<span class="msg-tag">' + esc(msg.tag) + '</span>' : '';
    return '<div class="msg ' + cls + '"><span class="msg-ico">' + ico + '</span><div class="msg-body">' + body + '</div>' + tag + '</div>';
  };

  var instance = new Console();
  instance.renderTree = renderTree;
  return instance;
})();
