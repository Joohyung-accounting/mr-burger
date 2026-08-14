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

var Core = require('../www/js/core.js');
global.Core = Core;
require('../www/js/art.js');
// index.html loads this straight after art.js, and the kitchen draws from it.
require('../www/js/art-fries-drinks.js');
require('../www/js/art-prep.js');
require('../www/js/art-title.js');
require('../www/js/audio.js');
// The real billing seam, sandbox adapter and all - so the store screen is
// exercised against what actually ships rather than a stub of it.
global.Billing = require('../www/js/billing.js');
require('../www/js/game.js');

var MB = global.MrBurger;
var S = MB.state, L = MB.layout;

// Drive the game's interpolation clock off the same fake clock pump() advances,
// so the co-op timing tests are deterministic instead of racing real time.
MB._setClock(function () { return clock; });

/* --------------------------------------------------------- tap helpers */
function tapCanvas(x, y) {
  stage._fire('pointerdown', {
    clientX: x, clientY: y + STAGE_TOP, pointerId: 1, preventDefault: NOOP
  });
}
function tapRect(r) { tapCanvas(r.x + r.w / 2, r.y + r.h / 2); }

/** Tap a station and let the chef walk there and work it (bounded wait). */
function work(rect) {
  tapRect(rect);
  for (var i = 0; i < 400 && S.chef.target; i++) pump(0.05);
  assert.strictEqual(S.chef.target, null, 'the chef never reached the station');
}

function crateOf(id) {
  var i = S.menu.indexOf(id);
  assert.ok(i >= 0, id + ' is not on the line today');
  return MB.crateRect(i);
}

function startShift(day) { MB.startDay(day || 1); pump(0.05); }
function held() { return S.chef.holding; }
function plateIds(i) { return S.plates[i].stack.map(function (b) { return b.id; }); }

/** Cook a patty to perfection and leave it in the chef's hands. */
function fetchCookedPatty(slot) {
  work(crateOf('patty'));
  work(MB.slotRect(slot));
  S.grill[slot].t = Core.COOK_TIME;
  work(MB.slotRect(slot));
}

/**
 * Take one portion of `id` off the board, loading and chopping a fresh
 * vegetable first if the board has none left. This is what a player does.
 */
function fetchChopped(id) {
  if (!S.board.portions || S.board.id !== id) {
    assert.ok(!S.board.id || !S.board.portions,
      'the board still has ' + S.board.id + ' on it');
    work(crateOf(id));
    work(MB.boardRect());              // whole vegetable down, knife starts
    for (var i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
    assert.ok(S.board.portions, id + ' never finished chopping');
  }
  work(MB.boardRect());                // and take a portion off it
  assert.ok(held() && held().prepped, id + ' came off the board unchopped');
}

/** Build `items` onto plate `p`, grilling and chopping whatever needs it. */
function buildPlate(p, items) {
  items.forEach(function (id) {
    var ing = Core.byId(id);
    if (ing.grill) {
      fetchCookedPatty(S.grill.indexOf(null));
    } else if (ing.chop) {
      fetchChopped(id);
    } else {
      work(crateOf(id));
    }
    work(MB.plateRect(p));
  });
}

/* ----------------------------------------------------------------- tests */

/* ---------------- skeptic checks on the board take path ---------------- */
function vegOf() {
  return S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
}
function loadAndChop(id, ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'crate', i: S.menu.indexOf(id) }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
  MB.sendChef({ kind: 'board' }, ci);
  for (i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
  for (i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
}
function tapBoard(ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'board' }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
}
function bin(ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'bin' }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
}

startShift(14);
var VEG = vegOf();
console.log('== A: conservation, take+bin x6 ==  veg=' + VEG);
loadAndChop(VEG);
var got = 0;
for (var k = 1; k <= 6; k++) {
  if (MB.chefAt(0).holding) bin(0);
  tapBoard(0);
  var h = MB.chefAt(0).holding;
  if (h) got++;
  console.log('  take ' + k + ': held=' + (h ? h.id + ' prepped=' + h.prepped : 'null') +
    ' | id=' + S.board.id + ' portions=' + S.board.portions + ' cut=' + S.board.cut.toFixed(2) +
    ' wet=' + S.board.wet);
}
console.log('  RESULT A: took ' + got + ' (expected 4)');

console.log('== C: 10 taps in ONE frame before arrival ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var before = S.board.portions;
for (var t = 0; t < 10; t++) MB.sendChef({ kind: 'board' }, 0);
for (var i = 0; i < 400 && MB.chefAt(0).target; i++) pump(0.05);
console.log('  RESULT C: portions ' + before + ' -> ' + S.board.portions +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));

console.log('== C2: arrive() called directly 10x on a standing cook ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
if (MB.chefAt(0).holding) bin(0);
var b2 = S.board.portions, taken2 = 0;
for (var q = 0; q < 10; q++) {
  MB.arrive({ kind: 'board' }, 0);
  if (MB.chefAt(0).holding) { taken2++; MB.chefAt(0).holding = null; }
}
console.log('  RESULT C2: 10 forced arrives took ' + taken2 + ' portions, portions=' +
  S.board.portions + ' id=' + S.board.id + ' wet=' + S.board.wet);

console.log('== D: tap the board every frame during the walk ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
if (MB.chefAt(0).holding) bin(0);
MB.sendChef({ kind: 'crate', i: S.menu.indexOf('bun') }, 0);
for (i = 0; i < 400 && MB.chefAt(0).target; i++) pump(0.05);
if (MB.chefAt(0).holding) bin(0);
var taps = 0;
MB.sendChef({ kind: 'board' }, 0);
for (i = 0; i < 200 && MB.chefAt(0).target; i++) { MB.sendChef({ kind: 'board' }, 0); taps++; pump(1 / 60); }
console.log('  RESULT D: ' + taps + ' taps -> portions=' + S.board.portions +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));

console.log('== F: day restart clears the board ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var old = S.board;
console.log('  before: id=' + S.board.id + ' portions=' + S.board.portions);
MB.startDay(14); pump(0.05);
console.log('  after:  id=' + S.board.id + ' portions=' + S.board.portions +
  ' same object? ' + (old === S.board));

console.log('== G: applySnapshot round trip ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var snap = MB.snapshot();
console.log('  snapshot board: ' + JSON.stringify(snap.board));
var keep = S.board;
MB.applySnapshot(snap);
console.log('  after apply: ' + JSON.stringify(S.board) + ' rebuilt=' + (keep !== S.board));

console.log('== N: 200 load/chop/drain cycles ==');
MB.startDay(14); pump(0.05);
var vegIn = 0, portionsOut = 0, bad = 0;
for (var n = 0; n < 200; n++) {
  if (MB.chefAt(0).holding) bin(0);
  loadAndChop(VEG);
  vegIn++;
  var c2 = 0;
  while (S.board.portions) {
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c2++; portionsOut++; }
    if (c2 > 20) { bad++; break; }
  }
  if (c2 !== 4) bad++;
}
console.log('  RESULT N: ' + vegIn + ' vegetables in, ' + portionsOut + ' portions out, anomalies=' + bad);

console.log('== W: wet saturation over many vegetables ==');
console.log('  wet=' + S.board.wet + ' juice=' + S.board.juice + ' id=' + S.board.id +
  ' portions=' + S.board.portions + ' cut=' + S.board.cut);

console.log('== N2: 200 cycles with the clock held open ==');
MB.startDay(14); pump(0.05);
var vegIn2 = 0, out2 = 0, bad2 = 0, log2 = [];
for (var n2 = 0; n2 < 200; n2++) {
  S.timeLeft = 9999;
  if (MB.chefAt(0).holding) bin(0);
  if (MB.chefAt(0).holding) { log2.push('cycle ' + n2 + ': bin failed, screen=' + S.screen); break; }
  loadAndChop(VEG);
  if (!S.board.portions) { log2.push('cycle ' + n2 + ': never chopped, board=' + JSON.stringify(S.board)); break; }
  vegIn2++;
  var c3 = 0;
  while (S.board.portions && c3 < 20) {
    S.timeLeft = 9999;
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c3++; out2++; }
    else { log2.push('cycle ' + n2 + ': empty take with portions=' + S.board.portions); break; }
  }
  if (c3 !== 4) { bad2++; log2.push('cycle ' + n2 + ': got ' + c3 + ' portions, board=' + JSON.stringify(S.board)); }
}
console.log('  RESULT N2: ' + vegIn2 + ' in, ' + out2 + ' out, anomalies=' + bad2 + ' screen=' + S.screen);
log2.slice(0, 6).forEach(function (l) { console.log('    ' + l); });
console.log('  board now: ' + JSON.stringify(S.board));

console.log('== N3: 300 cycles, day restarted whenever service ends ==');
var vegIn3 = 0, out3 = 0, bad3 = 0, log3 = [];
MB.startDay(14); pump(0.05);
for (var n3 = 0; n3 < 300; n3++) {
  if (S.screen !== 'service') { MB.startDay(14); pump(0.05); }
  S.timeLeft = 9999; S.hearts = 3;
  if (MB.chefAt(0).holding) bin(0);
  if (MB.chefAt(0).holding) { log3.push('n=' + n3 + ' bin failed'); MB.chefAt(0).holding = null; }
  loadAndChop(VEG);
  if (!S.board.portions) { log3.push('n=' + n3 + ' not chopped ' + JSON.stringify(S.board)); continue; }
  vegIn3++;
  var c4 = 0;
  while (S.board.portions && c4 < 20) {
    S.timeLeft = 9999; S.hearts = 3;
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c4++; out3++; } else break;
  }
  if (c4 !== 4) { bad3++; log3.push('n=' + n3 + ' got ' + c4 + ' board=' + JSON.stringify(S.board)); }
}
console.log('  RESULT N3: ' + vegIn3 + ' in, ' + out3 + ' out (expect ' + (vegIn3 * 4) + '), anomalies=' + bad3);
log3.slice(0, 5).forEach(function (l) { console.log('    ' + l); });

console.log('== E: co-op host, two cooks both drawing off one vegetable ==');
S.coop = true;
if (typeof MB.enterRoom === 'function') { try { MB.enterRoom(); } catch (e) { console.log('  enterRoom threw: ' + e.message); } }
MB.startDay(14); pump(0.05);
console.log('  chefs=' + S.chefs.length + ' role=' + S.role);
if (S.chefs.length > 1) {
  S.timeLeft = 9999;
  loadAndChop(VEG, 0);
  var tot = 0;
  for (var r = 0; r < 6; r++) {
    S.timeLeft = 9999;
    var ci = r % 2;
    if (MB.chefAt(ci).holding) bin(ci);
    tapBoard(ci);
    if (MB.chefAt(ci).holding) tot++;
    console.log('   cook' + ci + ' -> total=' + tot + ' id=' + S.board.id + ' portions=' + S.board.portions);
  }
  console.log('  RESULT E: two cooks took ' + tot + ' (expected 4)');
} else {
  console.log('  RESULT E: could not force two cooks in the harness');
}

console.log('== H: guest never mutates the board locally ==');
MB.startDay(14); pump(0.05);
S.role = 'guest';
var g0 = JSON.stringify(S.board);
MB.chefAt(0).target = { kind: 'board' };
MB.chefAt(0).tx = MB.chefAt(0).x; MB.chefAt(0).ty = MB.chefAt(0).y;
for (var z = 0; z < 60; z++) pump(1 / 60);
console.log('  guest board before=' + g0 + ' after=' + JSON.stringify(S.board) +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));
S.role = null;
