/*
 * End-to-end smoke test. Stubs just enough DOM/canvas to boot game.js in Node,
 * then plays real shifts: taps stations, walks the chef across the floor, grills
 * patties, plates them and runs them to the hatch.
 *
 *   node test/smoke.test.js
 */
'use strict';

var assert = require('assert');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------- DOM stubs */
var VIEW_W = 412, VIEW_H = 400;   // the kitchen canvas
var STAGE_TOP = 190;              // where it sits on the page
var NOOP = function () {};

function makeClassList() {
  var set = {};
  return {
    add: function (c) { set[c] = true; },
    remove: function (c) { delete set[c]; },
    contains: function (c) { return !!set[c]; },
    toggle: function (c, on) {
      if (on === undefined) on = !set[c];
      if (on) set[c] = true; else delete set[c];
      return on;
    }
  };
}

function makeCtx() {
  var ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineCap: '',
    font: '', textAlign: '', textBaseline: '', letterSpacing: '', filter: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    createLinearGradient: function () { return { addColorStop: NOOP }; },
    measureText: function (s) { return { width: (s || '').length * 6 }; }
  };
  ['setTransform', 'clearRect', 'save', 'restore', 'translate', 'scale', 'rotate',
    'beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'ellipse', 'closePath', 'rect',
    'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'strokeRect',
    'fillText', 'strokeText', 'setLineDash', 'clip', 'drawImage'
  ].forEach(function (m) { ctx[m] = NOOP; });
  ctx.createRadialGradient = function () { return { addColorStop: NOOP }; };
  return ctx;
}

function makeEl(tag) {
  var handlers = {};
  var el = {
    tagName: (tag || 'div').toUpperCase(),
    className: '', textContent: '', innerHTML: '',
    hidden: false, disabled: false, offsetWidth: 100,
    style: {}, children: [],
    classList: makeClassList(),
    setAttribute: function (k, v) { this['_' + k] = v; },
    getAttribute: function (k) { return this['_' + k]; },
    appendChild: function (c) { this.children.push(c); return c; },
    insertBefore: function (c, ref) {
      var i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    addEventListener: function (t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    _fire: function (t, e) { (handlers[t] || []).forEach(function (fn) { fn(e || {}); }); }
  };
  if (el.tagName === 'CANVAS') {
    el.width = 0; el.height = 0;
    el.getContext = function () { return makeCtx(); };
  }
  return el;
}

var stage = makeEl('canvas');
stage.clientWidth = VIEW_W;
stage.clientHeight = VIEW_H;
stage.getBoundingClientRect = function () {
  return {
    left: 0, top: STAGE_TOP, width: VIEW_W, height: VIEW_H,
    right: VIEW_W, bottom: STAGE_TOP + VIEW_H
  };
};

var elements = { stage: stage };
['hudArt', 'hudRead', 'boardArt', 'boardRead', 'pauseBtn',
  'pause', 'pauseSoundBtn',
  'resumeBtn', 'restartBtn', 'quitBtn',
  'start', 'playBtn', 'continueBtn', 'continueDay',
  'dayEnd', 'dayEndBtn',
  'titleArt', 'coopBtn', 'netState', 'boardBtn', 'accountBtn',
  'howBtn', 'howBtn2', 'how', 'howClose',
  'leaderboard', 'lbList', 'lbNote', 'lbClose',
  'account', 'nameInput', 'nameSave', 'makeCodeBtn', 'codeOut',
  'claimInput', 'claimBtn', 'accountNote', 'accountClose',
  'coop', 'hostBtn', 'roomOut', 'joinInput', 'joinBtn', 'coopNote', 'coopClose',
  'shop', 'nextDayBtn', 'over', 'overTitle', 'overReason', 'overDay',
  'overBest', 'retryBtn', 'retryDay', 'wipeBtn',
  'store', 'storeTabs', 'storeList', 'storeNote', 'storeRestore', 'storeClose',
  'shopStoreBtn', 'shopArt', 'shopRead', 'shopBuys', 'dayEndArt', 'dayEndRead',
  'pauseArt', 'pauseRead', 'pauseMusicBtn', 'signArt', 'rotate', 'rotateArt'
].forEach(function (id) { elements[id] = makeEl('div'); });

// Mirror index.html: the flow sheets carry the `hidden` attribute.
['dayEnd', 'shop', 'over', 'pause', 'continueBtn',
  'leaderboard', 'account', 'coop', 'codeOut', 'roomOut', 'how', 'store'].forEach(function (id) {
  elements[id].hidden = true;
});

var docHandlers = {};
var rafQueue = [];
var storeData = {};
// Every canvas the game makes. The room bakes itself into a full-size one; the
// order board makes a small thumbnail per ticket, which is why the cache test
// filters by size rather than just counting.
var madeCanvases = [];

global.self = global;
global.window = global;
// The board reserves its height by writing --order-rows on the root element,
// so the stub has to have one for that promise to be testable at all.
var rootProps = {};
global.document = {
  readyState: 'complete',
  hidden: false,
  body: makeEl('body'),
  documentElement: {
    style: {
      setProperty: function (k, v) { rootProps[k] = String(v); },
      getPropertyValue: function (k) { return rootProps[k] || ''; }
    }
  },
  getElementById: function (id) { return elements[id] || null; },
  createElement: function (tag) {
    var e = makeEl(tag);
    if (e.tagName === 'CANVAS') madeCanvases.push(e);
    return e;
  },
  addEventListener: function (t, fn) { (docHandlers[t] = docHandlers[t] || []).push(fn); }
};
global.devicePixelRatio = 2;
global.visualViewport = undefined;
if (!global.navigator) global.navigator = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(storeData, k) ? storeData[k] : null; },
  setItem: function (k, v) { storeData[k] = String(v); },
  removeItem: function (k) { delete storeData[k]; }
};
global.addEventListener = NOOP;
global.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };

var clock = 0;
/** Advance the game loop by `seconds` in 25ms frames (the chef walks smoothly). */
function pump(seconds) {
  var steps = Math.max(1, Math.round((seconds || 0.025) / 0.025));
  for (var i = 0; i < steps; i++) {
    clock += 25;
    var due = rafQueue;
    rafQueue = [];
    due.forEach(function (fn) { fn(clock); });
  }
}

/* ------------------------------------------------------------------ boot */
console.log('\nMr. Burger - runtime smoke\n');

/*
 * game.js captures window.Net once, at load, so this has to be in place before
 * the require - and it is the only way to see what the host actually puts on
 * the wire. Everything is a no-op except send, which just records.
 */
var sentPackets = [];
global.Net = {
  online: false, room: null, id: null, name: null,
  send: function (m) { sentPackets.push(m); },
  leave: function () {},
  connect: function () {},
  init: function () { return Promise.resolve(this); },
  push: function () {},
  pull: function () { return Promise.resolve(null); },
  leaderboard: function () { return Promise.resolve(null); },
  makeCode: function () { return Promise.resolve(null); },
  claim: function () { return Promise.resolve({ error: 'offline' }); },
  setName: function () { return Promise.resolve(false); },
  newRoomCode: function () { return 'TESTRM'; }
};

var Core = require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/core.js');
global.Core = Core;
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/art.js');
// index.html loads this straight after art.js, and the kitchen draws from it.
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/art-fries-drinks.js');
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/art-prep.js');
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/art-title.js');
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/audio.js');
// The real billing seam, sandbox adapter and all - so the store screen is
// exercised against what actually ships rather than a stub of it.
global.Billing = require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/billing.js');
require('C:/Users/ojh99/OneDrive/바탕 화면/AI Agent/mr-burger/www/js/game.js');

var MB = global.MrBurger;
var S = MB.state, L = MB.layout;

// Drive the game's interpolation clock off the same fake clock pump() advances,
// so the co-op timing tests are deterministic instead of racing real time.
MB._setClock(function () { return clock; });
