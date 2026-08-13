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

/** Build `items` onto plate `p`, grilling whatever needs grilling. */
function buildPlate(p, items) {
  items.forEach(function (id) {
    if (Core.byId(id).grill) {
      fetchCookedPatty(S.grill.indexOf(null));
    } else {
      work(crateOf(id));
    }
    work(MB.plateRect(p));
  });
}

/* ----------------------------------------------------------------- tests */
test('boots and renders without throwing', function () {
  assert.ok(MB, 'game did not expose its API - init likely threw');
  pump(0.3);
  assert.ok(L.W > 0 && L.floor, 'layout never ran');
  assert.strictEqual(S.plates.length, 2, 'should open with two plates');
});

test('the whole line sits on one row, ordered buns then toppings then sauces', function () {
  startShift(14);
  assert.ok(S.menu.length >= 6, 'need a busy line for this test');

  var rank = { base: 0, topping: 1, sauce: 2 };
  var prev = -1;
  for (var i = 0; i < S.menu.length; i++) {
    var g = rank[Core.byId(S.menu[i]).group];
    assert.ok(g >= prev, 'the line is jumbled at crate ' + i + ': ' + S.menu[i]);
    prev = g;
  }

  // one row: same y, strictly increasing x, nothing overlapping or off-canvas
  var first = MB.crateRect(0);
  for (i = 0; i < S.menu.length; i++) {
    var r = MB.crateRect(i);
    assert.strictEqual(r.y, first.y, 'crate ' + i + ' is on a second row');
    assert.strictEqual(r.h, first.h, 'crate ' + i + ' is a different height');
    assert.ok(r.w > 20, 'crate ' + i + ' shrank to ' + r.w.toFixed(1) + 'px');
    assert.ok(r.x >= 0 && r.x + r.w <= VIEW_W + 0.01, 'crate ' + i + ' is off-canvas');
    if (i > 0) {
      var p = MB.crateRect(i - 1);
      assert.ok(p.x + p.w <= r.x + 0.01, 'crates ' + (i - 1) + ' and ' + i + ' overlap');
    }
  }
});

test('taking from a box kicks off an animation without changing the outcome', function () {
  startShift(6);
  assert.deepStrictEqual(S.flyers, [], 'nothing should be in the air yet');

  work(crateOf('patty'));
  assert.strictEqual(held().id, 'patty', 'the pickup itself must be instant');
  assert.ok(S.flyers.length === 1, 'no item was thrown out of the box');
  assert.strictEqual(S.flyers[0].id, 'patty');
  assert.ok(S.cratePop[S.menu.indexOf('patty')] > 0, 'the box did not react');

  // it lands, and cleans itself up
  pump(0.6);
  assert.deepStrictEqual(S.flyers, [], 'the flyer never landed');
  assert.strictEqual(held().id, 'patty', 'and the cook is still holding it');

  // a new shift clears anything mid-flight
  work(crateOf('patty'));
  startShift(6);
  assert.deepStrictEqual(S.flyers, []);
  assert.deepStrictEqual(S.cratePop, []);
});

test('the kitchen fits inside the canvas', function () {
  startShift(8);
  var i, r;
  for (i = 0; i < S.menu.length; i++) {
    r = MB.crateRect(i);
    assert.ok(r.x >= 0 && r.x + r.w <= VIEW_W + 0.01, 'crate ' + i + ' is off-canvas');
    assert.ok(r.y >= 0 && r.y + r.h <= VIEW_H + 0.01, 'crate ' + i + ' overflows vertically');
  }
  for (i = 0; i < S.grill.length; i++) {
    r = MB.slotRect(i);
    assert.ok(r.y + r.h <= L.hatchY + 0.01, 'grill slot ' + i + ' runs into the hatch');
    assert.ok(r.y >= L.cratesBottom - 0.01, 'grill slot ' + i + ' runs into the crates');
  }
  for (i = 0; i < S.plates.length; i++) {
    r = MB.plateRect(i);
    assert.ok(r.x + r.w <= VIEW_W + 0.01, 'plate ' + i + ' is off-canvas');
  }
  var h = MB.hatchRect(), b = MB.binRect();
  assert.ok(h.y + h.h <= VIEW_H + 0.01, 'the hatch overflows the canvas');
  // the bin changes ends with the room, so only that they do not overlap
  assert.ok(b.x + b.w <= h.x + 0.01 || h.x + h.w <= b.x + 0.01, 'the bin overlaps the hatch');
  assert.ok(b.x >= -0.01 && b.x + b.w <= VIEW_W + 0.01, 'the bin is off-canvas');
});

test('the floor is a real walkable area between the stations', function () {
  startShift(8);
  var f = L.floor;
  assert.ok(f.x1 - f.x0 > 60, 'the floor is only ' + (f.x1 - f.x0).toFixed(0) + 'px wide');
  assert.ok(f.y1 - f.y0 > 40, 'the floor is only ' + (f.y1 - f.y0).toFixed(0) + 'px tall');
  assert.ok(f.x0 > L.grillX + L.colW, 'the floor overlaps the grill column');
  assert.ok(f.x1 < L.plateX, 'the floor overlaps the plate column');
});

test('every station has a stand point the chef can actually stand on', function () {
  startShift(10);
  var f = L.floor;
  var targets = [{ kind: 'hatch' }, { kind: 'bin' }];
  for (var i = 0; i < S.menu.length; i++) targets.push({ kind: 'crate', i: i });
  for (i = 0; i < S.grill.length; i++) targets.push({ kind: 'grill', i: i });
  for (i = 0; i < S.plates.length; i++) targets.push({ kind: 'plate', i: i });
  targets.forEach(function (t) {
    var p = MB.standPoint(t);
    assert.ok(p.x >= f.x0 - 0.01 && p.x <= f.x1 + 0.01,
      t.kind + ' ' + t.i + ' stand point is off the floor horizontally');
    assert.ok(p.y >= f.y0 - 0.01 && p.y <= f.y1 + 0.01,
      t.kind + ' ' + t.i + ' stand point is off the floor vertically');
  });
});

test('tapping a station resolves to that station', function () {
  startShift(10);
  for (var i = 0; i < S.menu.length; i++) {
    assert.deepStrictEqual(MB.stationAt(MB.crateRect(i).x + 4, MB.crateRect(i).y + 4),
      { kind: 'crate', i: i });
  }
  var g = MB.slotRect(0);
  assert.deepStrictEqual(MB.stationAt(g.x + 2, g.y + 2), { kind: 'grill', i: 0 });
  var p = MB.plateRect(1);
  assert.deepStrictEqual(MB.stationAt(p.x + 2, p.y + 2), { kind: 'plate', i: 1 });
  assert.strictEqual(MB.stationAt(MB.hatchRect().x + 5, MB.hatchRect().y + 5).kind, 'hatch');
  assert.strictEqual(MB.stationAt(MB.binRect().x + 5, MB.binRect().y + 5).kind, 'bin');
  assert.strictEqual(MB.stationAt(L.W / 2, (L.floor.y0 + L.floor.y1) / 2).kind, 'floor');
});

test('the chef walks to what you tap and does not teleport', function () {
  startShift(1);
  var start = { x: S.chef.x, y: S.chef.y };
  var target = crateOf('patty');
  tapRect(target);
  pump(0.05);
  var moved = Math.hypot(S.chef.x - start.x, S.chef.y - start.y);
  assert.ok(moved > 0, 'the chef did not set off');
  assert.ok(moved < 40, 'the chef covered ' + moved.toFixed(0) + 'px in one frame - that is a teleport');
  assert.ok(S.chef.target, 'the chef should still be en route');
  for (var i = 0; i < 400 && S.chef.target; i++) pump(0.05);
  assert.strictEqual(S.chef.target, null, 'the chef never arrived');
  assert.ok(held(), 'arriving at a crate should fill the chef\'s hands');
});

/*
 * Regression: walking speed was a flat px/s while the kitchen itself is nearly
 * twice as wide on a tablet as on a small phone. The same trip cost 1.15s on a
 * phone and 2.29s on a desktop - and since walking time IS the difficulty, the
 * game was about twice as hard depending on what you opened it on.
 */
test('a trip across the kitchen costs the same on any screen size', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var sizes = [[360, 300], [412, 360], [412, 430], [560, 520]];
  var times = [];

  sizes.forEach(function (wh) {
    stage.clientWidth = wh[0];
    stage.clientHeight = wh[1];
    S.levels = {};
    MB.startDay(8);
    pump(0.1);

    var a = MB.standPoint({ kind: 'crate', i: 0 });
    var b = MB.standPoint({ kind: 'hatch' });
    var dist = Math.hypot(a.x - b.x, a.y - b.y);
    var speed = S.fx.speed * (L.walkScale || 1);
    assert.ok(speed > 0, wh.join('x') + ': no walking speed');
    times.push(dist / speed);
  });

  var lo = Math.min.apply(null, times), hi = Math.max.apply(null, times);
  assert.ok(hi / lo < 1.25,
    'the same walk takes ' + lo.toFixed(2) + 's on one screen and ' + hi.toFixed(2) +
    's on another: ' + times.map(function (t) { return t.toFixed(2); }).join(', '));

  stage.clientWidth = w0;
  stage.clientHeight = h0;
  pump(0.1);
});

/*
 * Regression: a cook's x/y are absolute pixels, and the room moves underneath
 * them whenever the viewport changes - which a phone does for a few hundred ms
 * every time the address bar slides away, i.e. right after you tap PLAY. The
 * cook used to stay nailed to its old screen position and skate across the
 * kitchen, and its walk target still pointed at where the counter used to be.
 */
test('the cooks keep their place in the room when the viewport changes', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 412; stage.clientHeight = 430;
  startShift(8);
  pump(0.1);

  tapRect(crateOf('patty'));
  pump(0.2);
  var c = S.chef;
  var relX = (c.x - L.floor.x0) / (L.floor.x1 - L.floor.x0);
  var relY = (c.y - L.floor.y0) / (L.floor.y1 - L.floor.y0);
  assert.ok(c.target, 'the cook should still be walking');

  stage.clientHeight = 518;          // the address bar gets out of the way
  pump(0.4);                         // long enough for the settle to let it through

  var nx = (S.chef.x - L.floor.x0) / (L.floor.x1 - L.floor.x0);
  var ny = (S.chef.y - L.floor.y0) / (L.floor.y1 - L.floor.y0);
  // it kept walking, so it will have moved on - but not jumped across the room
  assert.ok(Math.abs(nx - relX) < 0.25 && Math.abs(ny - relY) < 0.35,
    'the cook slid from ' + relX.toFixed(2) + ',' + relY.toFixed(2) +
    ' to ' + nx.toFixed(2) + ',' + ny.toFixed(2) + ' of the floor');

  // and it is aiming at where the crate is now, not where it used to be
  var want = MB.standPoint(S.chef.target);
  assert.ok(Math.hypot(S.chef.tx - want.x, S.chef.ty - want.y) < 1,
    'the walk target is stale: heading for ' + S.chef.tx.toFixed(0) + ',' +
    S.chef.ty.toFixed(0) + ' but the station is at ' + want.x.toFixed(0) + ',' + want.y.toFixed(0));

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.4);
});

/*
 * Regression: the resize event was debounced, but a per-frame safety net in the
 * loop called resize() the instant the canvas box moved - handing back every
 * millisecond the debounce existed to absorb. A phone's address bar animation
 * meant a canvas reallocation plus a full relayout on every frame of it.
 */
test('a viewport that is still moving does not relayout on every frame', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 412; stage.clientHeight = 430;
  startShift(1);
  pump(0.2);

  var allocs = 0;
  var realW = stage.width, realH = stage.height;
  Object.defineProperty(stage, 'width', {
    configurable: true,
    get: function () { return realW; },
    set: function (v) { if (v !== realW) allocs++; realW = v; }
  });
  Object.defineProperty(stage, 'height', {
    configurable: true,
    get: function () { return realH; },
    set: function (v) { if (v !== realH) allocs++; realH = v; }
  });

  try {
    // 18 frames of a viewport sliding open, the way an address bar does
    for (var i = 0; i < 18; i++) {
      stage.clientHeight = 430 + Math.round(88 * (i / 17));
      pump(0.017);
    }
    assert.ok(allocs <= 4,
      'the canvas was reallocated ' + allocs + ' times during one address bar animation');
    pump(0.4);
    assert.strictEqual(L.H, 518, 'the layout never caught up with the settled size');
  } finally {
    delete stage.width; delete stage.height;
    stage.width = realW; stage.height = realH;
    stage.clientWidth = w0; stage.clientHeight = h0;
    pump(0.4);
  }
});

/*
 * The wall and the checkerboard floor never move, but repainting them cost
 * about 110 tile fills plus the wall grid on every frame - the single largest
 * fixed cost in the loop. It is baked once per layout now.
 */
test('the room is painted once per layout, not once per frame', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 412; stage.clientHeight = 430;
  startShift(1);
  pump(0.2);

  // the order board makes a small canvas per ticket, so only count room-sized ones
  function bakes() {
    return madeCanvases.filter(function (c) { return c.width >= stage.clientWidth; }).length;
  }

  madeCanvases = [];
  pump(1.0);                          // ~50 frames, nothing moving the room
  assert.strictEqual(bakes(), 0, 'the room was re-baked ' + bakes() + ' times while idle');

  stage.clientHeight = 518;
  pump(0.5);
  assert.ok(bakes() >= 1, 'the room was not re-baked after a resize');
  assert.ok(bakes() <= 3, 'the resize re-baked the room ' + bakes() + ' times');

  madeCanvases = [];
  pump(1.0);
  assert.strictEqual(bakes(), 0, 'the room kept re-baking after the resize settled');

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.4);
});

/*
 * The room runs top to bottom - crates, stations, hatch - so a short viewport
 * squeezes the stations rather than the floor. A phone held sideways left the
 * grill slots and plates about 15px tall: still drawn correctly, but far too
 * small to hit on purpose, and the shift kept running while you fumbled.
 */
test('a screen too short to hit the stations asks for a turn instead', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 544; stage.clientHeight = 430;
  S.levels = { shoes: 3, plate: 2, grill: 3, burner: 2, sign: 3 };
  MB.startDay(20);
  pump(0.3);

  assert.ok(L.slotH >= 22 && L.plateH >= 22,
    'setup: the stations should be hittable at this height, got ' + L.slotH.toFixed(0));
  assert.strictEqual(S.cramped, false, 'a tall screen should not be asking for a turn');
  assert.strictEqual(document.body.classList.contains('cramped'), false,
    'the body should not carry the class on a tall screen');

  // the same kitchen with the phone on its side
  stage.clientWidth = 544; stage.clientHeight = 220;
  pump(0.6);
  assert.ok(L.slotH < 22, 'setup: this height should squeeze the stations, got ' + L.slotH.toFixed(0));
  assert.strictEqual(S.cramped, true, 'the turn-your-phone sheet should be up');
  assert.ok(document.body.classList.contains('cramped'), 'the body should carry the class the sheet keys off');

  // and the shift must not tick away while the player cannot reach anything
  var patience = S.tickets.length ? S.tickets[0].patience : null;
  var spawned = S.spawned;
  pump(3);
  assert.strictEqual(S.spawned, spawned, 'customers kept arriving while the kitchen was unusable');
  if (patience !== null) {
    assert.strictEqual(S.tickets[0].patience, patience, 'the patience clock kept running');
  }

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.6);
  assert.strictEqual(S.cramped, false, 'turning back should hand the kitchen over again');
  S.levels = {};
});

/*
 * Every shift moves the furniture, so every shift is a room the layout code has
 * never been asked about before. Walk a long run of them and check each one is
 * a kitchen you could actually work in.
 */
test('every night is a different kitchen, and all of them are workable', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var seen = {}, sides = {}, palettes = {};

  [[360, 300], [412, 470], [820, 640]].forEach(function (wh) {
    stage.clientWidth = wh[0]; stage.clientHeight = wh[1];
    for (var day = 1; day <= 40; day++) {
      S.levels = { shoes: 3, plate: 2, grill: 3, burner: 2, sign: 3 };
      MB.startDay(day);
      pump(0.1);
      var where = wh.join('x') + ' day ' + day;

      var room = L.room;
      seen[room.grill + '|' + room.line + '|' + room.bin] = true;
      sides[room.grill] = true;
      palettes[room.palette] = true;

      // the two walls never overlap and the floor between them is real
      var g = MB.slotRect(0), p = MB.plateRect(0);
      assert.ok(g.x + g.w <= p.x + 0.01 || p.x + p.w <= g.x + 0.01,
        where + ': the grill and the plates are on top of each other');
      assert.ok(L.floor.x1 - L.floor.x0 > 40, where + ': no floor left to walk on');
      assert.ok(L.floor.y1 - L.floor.y0 > 40, where + ': the floor is too short');

      // every station is inside the room and reachable from the floor
      var targets = [{ kind: 'hatch' }, { kind: 'bin' }];
      for (var i = 0; i < S.menu.length; i++) targets.push({ kind: 'crate', i: i });
      for (i = 0; i < S.grill.length; i++) targets.push({ kind: 'grill', i: i });
      for (i = 0; i < S.plates.length; i++) targets.push({ kind: 'plate', i: i });
      /*
       * Not just "somewhere on the floor" - next to the station it belongs to.
       * The stand points used to name the floor edges outright, grill at the
       * left and plates at the right, which held until the room started moving
       * them: tapping the grill then walked the cook to the plates and did the
       * grill's business from there.
       */
      function rectOf(t) {
        if (t.kind === 'crate') return MB.crateRect(t.i);
        if (t.kind === 'grill') return MB.slotRect(t.i);
        if (t.kind === 'plate') return MB.plateRect(t.i);
        if (t.kind === 'hatch') return MB.hatchRect();
        return MB.binRect();
      }
      function gap(s, r) {
        var dx = Math.max(r.x - s.x, 0, s.x - (r.x + r.w));
        var dy = Math.max(r.y - s.y, 0, s.y - (r.y + r.h));
        return Math.hypot(dx, dy);
      }
      targets.forEach(function (t) {
        var s = MB.standPoint(t);
        assert.ok(isFinite(s.x) && isFinite(s.y), where + ': ' + t.kind + ' has no stand point');
        assert.ok(s.x >= L.floor.x0 - 1 && s.x <= L.floor.x1 + 1 &&
          s.y >= L.floor.y0 - 1 && s.y <= L.floor.y1 + 1,
          where + ': the stand point for ' + t.kind + ' is off the floor');

        // The bin and the hatch sit on the bottom wall, and on a narrow screen
        // the bin tucks under a column - the floor does not reach it head on,
        // so the cook works it from the corner. Within arm's length is the bar.
        var own = gap(s, rectOf(t));
        assert.ok(own < 60,
          where + ': standing ' + own.toFixed(0) + 'px from the ' + t.kind + ' it is meant to work');

        /*
         * The grill and the plates face each other across the floor and swap
         * walls from night to night, so this is the pair that goes wrong: get
         * it backwards and tapping the grill walks the cook to the plates and
         * does the grill's business from there. The hatch and the bin share
         * the bottom wall and are always near each other, so they are not a
         * meaningful comparison.
         */
        if (t.kind === 'grill' || t.kind === 'plate') {
          var facing = t.kind === 'grill' ? MB.plateRect(0) : MB.slotRect(0);
          assert.ok(gap(s, facing) > own,
            where + ': the stand point for ' + t.kind + ' ' + t.i +
            ' is nearer the ' + (t.kind === 'grill' ? 'plates' : 'grill') +
            ' - tapping one would work the other');
        }
      });

      // and tapping a station still finds it
      var rc = MB.crateRect(0);
      var hit = MB.stationAt(rc.x + rc.w / 2, rc.y + rc.h / 2);
      assert.ok(hit && hit.kind === 'crate' && hit.i === 0,
        where + ': tapping the first crate found ' + JSON.stringify(hit));
    }
  });

  assert.ok(Object.keys(seen).length >= 6,
    'only ' + Object.keys(seen).length + ' distinct floor plans across 40 days');
  assert.strictEqual(Object.keys(sides).length, 2, 'the grill never changes wall');
  assert.ok(Object.keys(palettes).length >= 4,
    'only ' + Object.keys(palettes).length + ' colour schemes across 40 days');

  stage.clientWidth = w0; stage.clientHeight = h0;
  S.levels = {};
  pump(0.4);
});

test('the same day is always the same kitchen', function () {
  // a retry has to be a fair rematch, and in co-op both machines work the
  // room out for themselves from nothing but the day number
  for (var day = 1; day <= 30; day++) {
    var a = Core.dayRoom(day), b = Core.dayRoom(day);
    assert.deepStrictEqual(a, b, 'day ' + day + ' generated two different rooms');
  }
  assert.ok(Core.dayRoom(1).plain, 'day 1 should be the plain tutorial room');
});

test('the walk animation keeps pace with the ground covered', function () {
  S.levels = {};
  startShift(8);
  pump(0.1);
  var c = MB.chefAt(0);

  // stand still: no stepping
  c.tx = c.x; c.ty = c.y;
  c.phase = 0;
  pump(0.2);
  assert.strictEqual(c.phase, 0, 'the legs move while standing still');

  // walking a fixed distance must advance the same number of strides whatever
  // the screen size, or the gait reads differently device to device
  function stridesOver(w, h) {
    stage.clientWidth = w; stage.clientHeight = h;
    MB.startDay(8);
    pump(0.1);
    var ch = MB.chefAt(0);
    ch.x = L.floor.x0; ch.y = L.floor.y0;
    ch.tx = L.floor.x1; ch.ty = L.floor.y0;
    ch.phase = 0;
    var laps = 0, prev = 0;
    for (var i = 0; i < 300 && Math.abs(ch.tx - ch.x) > 2; i++) {
      pump(0.02);
      if (ch.phase < prev) laps++;
      prev = ch.phase;
    }
    return laps + ch.phase;
  }

  var small = stridesOver(360, 300);
  var big = stridesOver(560, 520);
  assert.ok(small > 0.5 && big > 0.5, 'the cook never took a step');
  assert.ok(Math.abs(small - big) / Math.max(small, big) < 0.12,
    'crossing the floor takes ' + small.toFixed(1) + ' strides on a phone and ' +
    big.toFixed(1) + ' on a desktop');

  /*
   * And the cadence itself has to match. Tying stride length to the cook's
   * height instead of the room gave 2.07 steps/s on a phone and 2.86 on a
   * desktop, because the character stops growing at the k cap while the room
   * and the walking speed do not - which is what made the walk look frantic
   * on one device and not the other.
   */
  function cadenceAt(w, h) {
    stage.clientWidth = w; stage.clientHeight = h;
    MB.startDay(8);
    pump(0.1);
    return (S.fx.speed * (L.walkScale || 1)) / L.stride;
  }
  var cadences = [cadenceAt(360, 300), cadenceAt(412, 360), cadenceAt(412, 430), cadenceAt(560, 520)];
  var cLo = Math.min.apply(null, cadences), cHi = Math.max.apply(null, cadences);
  assert.ok(cHi / cLo < 1.05,
    'step cadence differs by screen: ' + cadences.map(function (c) { return c.toFixed(2); }).join(', '));
  assert.ok(cLo > 1.2 && cHi < 2.4, 'cadence is off the scale: ' + cLo.toFixed(2));

  stage.clientWidth = VIEW_W; stage.clientHeight = VIEW_H;
  pump(0.1);
});

test('Running Shoes actually make the walk shorter', function () {
  function timeToCross(levels) {
    S.levels = levels;
    startShift(1);
    S.chef.x = L.floor.x0; S.chef.y = L.floor.y0;
    MB.sendChef({ kind: 'hatch' });
    var t = 0;
    while (S.chef.target && t < 30) { pump(0.05); t += 0.05; }
    return t;
  }
  var slow = timeToCross({});
  var fast = timeToCross({ shoes: 3 });
  assert.ok(fast < slow * 0.8, 'shoes only cut the walk from ' + slow.toFixed(2) + 's to ' + fast.toFixed(2) + 's');
  S.levels = {};
});

/* ------------------------------------------------------- empty hands take */
test('a crate fills empty hands and refuses full ones', function () {
  startShift(6);
  work(crateOf('patty'));
  assert.strictEqual(held().id, 'patty');
  var other = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  work(crateOf(other));
  assert.strictEqual(held().id, 'patty', 'the chef should not have swapped hands');
});

test('a raw patty is refused by the plate and accepted by the grill', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.plateRect(0));
  assert.deepStrictEqual(plateIds(0), [], 'a raw patty must not reach a plate');
  assert.ok(held(), 'the chef should still be holding it');

  work(MB.slotRect(0));
  assert.ok(S.grill[0] && S.grill[0].id === 'patty', 'the patty never hit the grill');
  assert.strictEqual(held(), null, 'hands should be empty again');
});

test('a busy burner refuses a second patty', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = 2;
  work(crateOf('patty'));
  work(MB.slotRect(0));
  assert.strictEqual(S.grill[0].t > 1, true, 'the cooking patty got replaced');
  assert.ok(held(), 'the chef should still be carrying the spare');
});

/*
 * The patty blends raw -> seared -> charred by chaining two colour mixes.
 * mixHex used to return `rgb(...)` while parsing `#rrggbb`, so the second mix
 * produced NaN and a burnt patty painted nothing at all.
 */
test('colour blending survives being chained', function () {
  var Art = global.Art;
  var once = Art.mixHex('#e2887e', '#7c4527', 0.5);
  assert.ok(/^#[0-9a-f]{6}$/.test(once), 'mixHex must return hex to be re-feedable, got ' + once);
  var twice = Art.mixHex(once, '#33241c', 0.5);
  assert.ok(/^#[0-9a-f]{6}$/.test(twice), 'a chained blend broke: ' + twice);
  assert.strictEqual(Art.mixHex('#000000', '#ffffff', 0), '#000000');
  assert.strictEqual(Art.mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.strictEqual(Art.mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('beef out of the crate is carried raw, and sears on the grill', function () {
  startShift(6);
  work(crateOf('patty'));
  assert.strictEqual(held().id, 'patty');
  assert.strictEqual(held().done, 0, 'a patty from the crate must look like raw meat');
  assert.strictEqual(held().cook, undefined, 'and must not count as cooked');

  work(MB.slotRect(0));
  S.grill[0].t = Core.COOK_TIME;
  work(MB.slotRect(0));
  assert.strictEqual(held().done, 1, 'off the grill it should look seared');
  assert.strictEqual(held().char, 0);
});

test('doneness follows the patty onto the plate', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = 0.6;                       // pulled well before it is ready
  work(MB.slotRect(0));
  var carried = held().done;
  assert.ok(carried > 0 && carried < 0.6, 'should read mostly raw, got ' + carried);

  work(MB.plateRect(0));
  var onPlate = S.plates[0].stack[S.plates[0].stack.length - 1];
  assert.strictEqual(onPlate.id, 'patty');
  assert.strictEqual(onPlate.done, carried, 'the plate should show what was cooked');
});

/*
 * Regression: putting a patty back on a burner used to reset its timer to 0,
 * so a perfectly seared patty turned raw the moment it touched the grill again.
 */
test('a patty put back on the grill carries on cooking, it does not reset', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = 3.0;
  work(MB.slotRect(0));                       // lift it off, part-cooked
  var lifted = held().done;
  assert.ok(lifted > 0.5 && lifted < 1, 'setup: should be part-cooked, got ' + lifted);
  assert.strictEqual(held().grillT, 3.0, 'the time on the grill has to ride along');

  // and back down on another burner. It keeps ticking from the frame it lands,
  // so allow for that rather than demanding an exact 3.0.
  work(MB.slotRect(1));
  assert.ok(S.grill[1].t >= 3.0 && S.grill[1].t < 3.4,
    'the burner restarted from ' + S.grill[1].t.toFixed(2) + ' instead of 3.0');
  assert.strictEqual(S.grill[0], null);

  // a moment more and it is properly seared, not raw
  S.grill[1].t = Core.COOK_TIME;
  work(MB.slotRect(1));
  assert.strictEqual(held().done, 1, 'it should have finished cooking, not started over');
  assert.strictEqual(held().cook, 1);
});

test('a fresh patty from the crate still starts raw on the grill', function () {
  startShift(6);
  work(crateOf('patty'));
  assert.strictEqual(held().grillT, undefined, 'crate beef has no grill history');
  work(MB.slotRect(0));
  assert.ok(S.grill[0].t < 0.3, 'it must start from zero, got ' + S.grill[0].t.toFixed(2));
});

test('a patty left on the grill chars instead of turning raw again', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = Core.COOK_TIME + Core.BURN_TIME * 2;
  work(MB.slotRect(0));
  assert.strictEqual(held().done, 1, 'a burnt patty is still fully cooked-looking');
  assert.ok(held().char > 0.5, 'and should be charred, got ' + held().char);
});

test('collecting from the grill in the green window gives a perfect sear', function () {
  startShift(6);
  fetchCookedPatty(0);
  assert.strictEqual(held().id, 'patty');
  assert.strictEqual(held().cook, 1, 'collected dead centre should be perfect');
  assert.strictEqual(S.grill[0], null, 'the burner should be free again');
});

test('collecting too early or too late costs cook quality', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = 0.3;
  work(MB.slotRect(0));
  var raw = held().cook;
  work(MB.binRect());

  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.grill[0].t = Core.COOK_TIME + 8;
  work(MB.slotRect(0));
  var burnt = held().cook;

  assert.ok(raw > 0 && raw < 1, 'raw should score below perfect, got ' + raw);
  assert.ok(burnt > 0 && burnt < 1, 'burnt should score below perfect, got ' + burnt);
});

test('an empty burner gives nothing back', function () {
  startShift(6);
  work(MB.slotRect(0));
  assert.strictEqual(held(), null, 'took something off an empty burner');
});

/* ------------------------------------------------------------- the plates */
test('fillings land on the plate the chef was sent to', function () {
  startShift(6);
  var topping = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  work(crateOf(topping));
  work(MB.plateRect(1));
  assert.deepStrictEqual(plateIds(1), [topping]);
  assert.deepStrictEqual(plateIds(0), [], 'the other plate should be untouched');
  assert.strictEqual(held(), null);
});

test('two plates fill independently', function () {
  startShift(8);
  var a = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  var b = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[1] || a;
  work(crateOf(a));
  work(MB.plateRect(0));
  work(crateOf(b));
  work(MB.plateRect(1));
  assert.deepStrictEqual(plateIds(0), [a]);
  assert.deepStrictEqual(plateIds(1), [b]);
});

test('a loaded plate can be picked up, put down, and picked up again', function () {
  startShift(6);
  var topping = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  work(crateOf(topping));
  work(MB.plateRect(0));

  work(MB.plateRect(0));
  assert.strictEqual(held().kind, 'plate', 'the chef should be carrying the plate');
  assert.deepStrictEqual(plateIds(0), [], 'the station should be clear');

  work(MB.plateRect(1));
  assert.strictEqual(held(), null);
  assert.deepStrictEqual(plateIds(1), [topping], 'the plate should have been set down');
});

test('a carried plate cannot be dumped on an occupied station', function () {
  startShift(8);
  var a = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  work(crateOf(a));
  work(MB.plateRect(0));
  work(crateOf(a));
  work(MB.plateRect(1));

  work(MB.plateRect(0));                 // pick plate 0 up
  work(MB.plateRect(1));                 // plate 1 is busy
  assert.strictEqual(held().kind, 'plate', 'the chef should still be holding it');
  assert.deepStrictEqual(plateIds(1), [a], 'plate 1 must not be overwritten');
});

test('the bin empties the chef\'s hands', function () {
  startShift(6);
  work(crateOf('patty'));
  work(MB.binRect());
  assert.strictEqual(held(), null, 'the bin should have taken it');
});

/* ------------------------------------------------------------ the hatch */
test('the hatch will not take anything but a plate', function () {
  startShift(6);
  work(MB.hatchRect());
  assert.strictEqual(S.served, 0);
  work(crateOf('patty'));
  work(MB.hatchRect());
  assert.ok(held(), 'a loose ingredient must not be served');
  assert.strictEqual(S.served, 0);
});

test('a correct plate delivered to the hatch pays out', function () {
  startShift(1);
  pump(2);
  assert.ok(S.tickets.length, 'no ticket to serve');
  var t = S.tickets[0];
  buildPlate(0, t.items);
  work(MB.plateRect(0));
  work(MB.hatchRect());

  assert.ok(S.sales > 0, 'no food sales recorded');
  assert.ok(S.tips > 0, 'a fast perfect burger should earn a tip');
  assert.strictEqual(S.perfect, 1);
  assert.strictEqual(S.served, 1);
  assert.strictEqual(S.hearts, Core.START_HEARTS, 'a perfect burger must not cost a heart');
  assert.strictEqual(held(), null, 'the plate should be gone');
  assert.strictEqual(MB.ticketOf(t.uid), null, 'the ticket should be off the board');
});

test('the hatch routes a plate to the ticket it matches, not the first one', function () {
  startShift(10);
  pump(0.05);
  S.tickets = [];
  S.spawned = 0;
  MB.spawnTicket();
  MB.spawnTicket();
  assert.ok(S.tickets.length === 2, 'need two tickets');
  var extras = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; });
  var a = S.tickets[0], b = S.tickets[1];
  b.items = ['bun', 'patty'];                       // make the second unmistakable
  a.items = ['bun', 'patty'].concat(extras.slice(0, 2));

  buildPlate(0, ['bun', 'patty']);
  work(MB.plateRect(0));
  work(MB.hatchRect());
  assert.strictEqual(MB.ticketOf(b.uid), null, 'the plain burger should have gone to ticket B');
  assert.ok(MB.ticketOf(a.uid), 'ticket A should still be waiting');
});

test('a burger served without its bun is not the burger that was ordered', function () {
  startShift(10);
  pump(0.05);
  S.tickets = [];
  MB.spawnTicket();
  S.tickets[0].items = ['bun', 'patty'];

  buildPlate(0, ['patty']);                          // no bun
  assert.deepStrictEqual(Core.displayStack(S.plates[0].stack).map(function (x) {
    return typeof x === 'string' ? x : x.id;
  }), ['patty'], 'a bunless plate should render as a naked pile');

  work(MB.plateRect(0));
  work(MB.hatchRect());
  assert.ok(S.perfect === 0, 'a missing bun cannot be a perfect burger');
});

test('serving a burger nobody ordered costs a heart', function () {
  startShift(10);
  pump(0.05);
  S.tickets = [];
  MB.spawnTicket();
  var extras = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; });
  S.tickets[0].items = ['bun', 'patty'].concat(extras.slice(0, 2));
  var before = S.sales + S.tips;

  var junk = extras.filter(function (id) { return S.tickets[0].items.indexOf(id) < 0; })[0];
  buildPlate(0, [junk || extras[extras.length - 1]]);
  work(MB.plateRect(0));
  work(MB.hatchRect());

  assert.strictEqual(S.sales + S.tips, before, 'a rejected burger must not pay');
  assert.strictEqual(S.hearts, Core.START_HEARTS - 1);
  assert.strictEqual(S.served, 0);
});

/* ------------------------------------------------------------- the clock */
test('the shift clock counts down and shows the time left', function () {
  startShift(5);
  pump(0.1);
  var full = Core.dayLength(5);
  assert.strictEqual(S.dayLength, full, 'the shift did not take its length from the day');
  assert.ok(S.timeLeft > full - 2, 'the clock did not start full: ' + S.timeLeft.toFixed(1));
  // The clock is drawn on the HUD canvas now, so the readable surface is
  // #hudRead - the line a screen reader gets, and the only place the game
  // still says the time in text.
  assert.ok(elements.hudRead.textContent.indexOf(Core.clockText(S.timeLeft)) >= 0,
    'the display does not match the clock: ' + elements.hudRead.textContent);

  pump(10);
  assert.ok(S.timeLeft < full - 9 && S.timeLeft > full - 12,
    'ten seconds of play took ' + (full - S.timeLeft).toFixed(1) + 's off the clock');
  assert.ok(elements.hudRead.textContent.indexOf(Core.clockText(S.timeLeft)) >= 0,
    'the display fell behind the clock: ' + elements.hudRead.textContent);
});

test('a paused shift is not a shift on the clock', function () {
  startShift(5);
  pump(2);
  MB.setPaused(true);
  var held = S.timeLeft;
  pump(6);
  assert.strictEqual(S.timeLeft, held, 'the clock ran while the game was paused');
  MB.setPaused(false);
  pump(2);
  assert.ok(S.timeLeft < held - 1, 'the clock did not start again after unpausing');
});

/*
 * Last orders rather than a hard stop: nobody new comes in once the clock is
 * out, but a plate already in your hands is still worth serving.
 */
test('closing time stops new customers and then ends the shift', function () {
  startShift(6);
  pump(1);
  assert.ok(S.cfg.customers > 2, 'setup: expected a day with several customers');

  S.timeLeft = 0.02;
  pump(0.5);
  var spawnedAtClose = S.spawned;
  assert.ok(spawnedAtClose < S.cfg.customers,
    'setup: the day should still have had customers to come');

  // the board empties on its own - nobody else arrives
  var guard = 0;
  while (S.screen === 'service' && guard++ < 400) {
    if (S.tickets.length) S.tickets[0].patience = 0.02;
    pump(0.5);
  }
  assert.strictEqual(S.spawned, spawnedAtClose, 'customers kept arriving after closing time');
  assert.notStrictEqual(S.screen, 'service', 'the shift never ended after closing time');
  assert.strictEqual(S.closedBy, 'clock', 'the receipt will not know the buzzer ended it');
});

test('a shift finished early does not blame the clock', function () {
  startShift(1);
  pump(0.5);
  var guard = 0;
  while (S.screen === 'service' && guard++ < 400) {
    if (S.tickets.length) S.tickets[0].patience = 0.02;
    pump(0.5);
  }
  assert.notStrictEqual(S.screen, 'service', 'setup: the day should have ended');
  assert.ok(S.timeLeft > 0, 'setup: this should finish well inside the clock');
  assert.strictEqual(S.closedBy, null, 'the shift ended on customers, not on time');
});

test('a guest reads the clock off the host rather than running its own', function () {
  S.role = 'host';
  startShift(7);
  pump(4);
  var hostLeft = S.timeLeft;
  var snap = MB.snapshot();
  assert.ok(Math.abs(snap.left - hostLeft) < 0.2, 'the snapshot does not carry the clock');

  S.role = 'guest'; S.me = 1;
  S.timeLeft = 999; S.dayLength = 999;
  MB.applySnapshot(snap);
  assert.ok(Math.abs(S.timeLeft - hostLeft) < 0.2,
    'the guest is on its own clock: ' + S.timeLeft.toFixed(1) + ' vs the host ' + hostLeft.toFixed(1));
  assert.strictEqual(S.dayLength, Core.dayLength(7));

  // and it does not tick between packets - two clocks drifting is worse than one stepping
  var atPacket = S.timeLeft;
  pump(3);
  assert.strictEqual(S.timeLeft, atPacket, 'the guest ran the clock itself');

  S.role = 'solo'; S.me = 0;
});

/* --------------------------------------------------------------- the day */
test('an impatient ticket walks out and takes a heart with it', function () {
  startShift(1);
  pump(2);
  var t = S.tickets[0];
  t.patience = 0.02;
  pump(0.3);
  assert.strictEqual(S.walked, 1);
  assert.strictEqual(S.hearts, Core.START_HEARTS - 1);
  assert.strictEqual(MB.ticketOf(t.uid), null);
});

/*
 * Regression, found by a random-play soak: the "everyone has been served, shut
 * up shop" check lived only in the code that hands a plate over the counter. If
 * the last customer of the day walked out instead, nothing checked - and since
 * day 1 has fewer customers than you have hearts, the day could not even end on
 * hearts. The player was left in an empty kitchen with no orders, nothing left
 * to spawn, and no way out but the pause menu.
 */
test('the day ends even if the last customer walks out instead of being served', function () {
  startShift(1);
  pump(2);

  // let every customer of the day turn up and leave
  var guard = 0;
  while (S.screen === 'service' && guard++ < 80) {
    if (S.tickets.length) S.tickets[0].patience = 0.02;
    pump(0.5);
  }

  assert.ok(S.hearts > 0, 'day 1 should not be losable on hearts - that is the point of the case');
  assert.strictEqual(S.walked, Core.dayConfig(1).customers, 'every customer should have walked');
  assert.notStrictEqual(S.screen, 'service',
    'the shift never ended: ' + S.spawned + '/' + Core.dayConfig(1).customers +
    ' customers in, ' + S.tickets.length + ' left on the board, ' + S.hearts + ' hearts');
});

test('day 1 cannot be lost on hearts - there are fewer customers than lives', function () {
  assert.ok(Core.dayConfig(1).customers < Core.START_HEARTS,
    'day 1 should be impossible to fail out of; it is the tutorial');
  assert.ok(Core.dayConfig(6).customers > Core.START_HEARTS,
    'by day 6 there should be enough customers to actually lose');
});

test('running out of hearts shuts the day down', function () {
  startShift(6);
  pump(2);
  for (var i = 0; i < Core.START_HEARTS + 4 && S.screen === 'service'; i++) {
    if (!S.tickets.length) pump(20);
    if (!S.tickets.length) break;
    S.tickets[0].patience = 0.02;
    pump(0.3);
  }
  assert.ok(S.hearts <= 0, 'hearts should be spent, got ' + S.hearts);
  assert.strictEqual(S.screen, 'dayEnd');
  assert.strictEqual(elements.over.hidden, false, 'the shut-down sheet should be up');
  assert.strictEqual(elements.dayEnd.hidden, true, 'a failed day is not a receipt');
});

test('taps are ignored once the day is over', function () {
  var before = { x: S.chef.x, y: S.chef.y };
  tapRect(MB.hatchRect());
  pump(0.2);
  assert.strictEqual(S.chef.x, before.x, 'the chef moved after closing');
  assert.strictEqual(S.chef.y, before.y);
});

test('a full clean shift on day 1 clears rent and banks the profit', function () {
  startShift(1);
  S.money = 0;
  var guard = 0;
  while (S.screen === 'service' && guard++ < 200) {
    if (!S.tickets.length) { pump(0.5); continue; }
    var t = S.tickets[0];
    buildPlate(0, t.items);
    work(MB.plateRect(0));
    work(MB.hatchRect());
  }
  var total = S.sales + S.tips;
  assert.strictEqual(S.screen, 'dayEnd', 'the day never closed');
  assert.strictEqual(S.walked, 0, 'a clean shift should not lose anyone');
  assert.ok(total >= S.rent, 'a clean day-1 shift earned ' + Core.money(total) +
    ' against ' + Core.money(S.rent) + ' rent - day 1 is unwinnable');
  assert.strictEqual(S.money, total - S.rent, 'the till should hold exactly the profit');
  assert.strictEqual(elements.dayEnd.hidden, false, 'the receipt should be up');
});

/* -------------------------------------------------------------- pausing */
test('pausing freezes the clock and the chef', function () {
  startShift(6);
  pump(3);
  assert.ok(S.tickets.length, 'need a ticket on the clock');
  MB.setPaused(true);
  assert.strictEqual(elements.pause.hidden, false, 'the pause sheet should be up');

  var patience = S.tickets[0].patience;
  var pos = { x: S.chef.x, y: S.chef.y };
  tapRect(crateOf('patty'));
  pump(3);

  assert.strictEqual(S.tickets[0].patience, patience, 'the ticket clock kept running');
  assert.strictEqual(S.chef.x, pos.x, 'the chef moved while paused');
  assert.strictEqual(S.chef.y, pos.y);
  assert.strictEqual(S.chef.target, null, 'taps must not queue up behind the pause sheet');
});

test('resuming starts the clock again', function () {
  var patience = S.tickets[0].patience;
  MB.setPaused(false);
  assert.strictEqual(elements.pause.hidden, true);
  pump(1);
  assert.ok(S.tickets[0].patience < patience, 'the clock never restarted');
  work(crateOf('patty'));
  assert.ok(held(), 'the chef should be working again');
});

test('restarting the day wipes the shift and closes the pause sheet', function () {
  startShift(6);
  pump(3);
  work(crateOf('patty'));
  work(MB.slotRect(0));
  S.sales = 5000;
  S.hearts = 2;
  MB.setPaused(true);

  MB.startDay(S.day);
  pump(0.05);
  assert.strictEqual(S.userPaused, false, 'restart should unpause');
  assert.strictEqual(elements.pause.hidden, true);
  assert.strictEqual(S.sales, 0, 'takings should reset');
  assert.strictEqual(S.hearts, Core.START_HEARTS, 'hearts should reset');
  assert.strictEqual(S.chef.holding, null, 'the chef should be empty-handed');
  assert.ok(S.grill.every(function (g) { return g === null; }), 'the grill should be clear');
});

test('quitting drops back to the title screen', function () {
  startShift(4);
  pump(3);
  MB.setPaused(true);
  MB.quitToTitle();
  assert.strictEqual(S.screen, 'title');
  assert.strictEqual(elements.pause.hidden, true);
  assert.strictEqual(elements.start.hidden, false, 'the title sheet should be up');
  assert.deepStrictEqual(S.tickets, [], 'the board should be cleared');
  tapRect(MB.hatchRect());
  pump(0.5);
  assert.strictEqual(S.chef.target, null, 'taps must not reach a quit kitchen');
});

test('pausing is refused outside a shift', function () {
  S.screen = 'shop';
  S.userPaused = false;
  MB.setPaused(true);
  assert.strictEqual(S.userPaused, false, 'there is nothing to pause in the shop');
  S.screen = 'title';
});

test('progress is saved and reloaded', function () {
  assert.ok(storeData['mb_save_v2'], 'nothing was written to storage');
  var saved = JSON.parse(storeData['mb_save_v2']);
  assert.strictEqual(saved.day, 1);
  assert.strictEqual(saved.money, S.money);
});

test('upgrades cost money, raise the level, and stop at max', function () {
  S.money = 300000;
  S.levels = {};
  var cost = Core.upgradeCost('plate', 0);
  MB.buyUpgrade('plate');
  assert.strictEqual(S.levels.plate, 1);
  assert.strictEqual(S.money, 300000 - cost);
  var max = Core.UPGRADES.filter(function (u) { return u.id === 'plate'; })[0].max;
  for (var i = 0; i < max + 3; i++) MB.buyUpgrade('plate');
  assert.strictEqual(S.levels.plate, max, 'bought past the max level');
});

test('an upgrade that cannot be afforded is refused', function () {
  S.money = 0;
  S.levels = {};
  MB.buyUpgrade('grill');
  assert.ok(!S.levels.grill, 'bought an upgrade with an empty till');
});

test('the kitchen grows on its own as the days get heavier', function () {
  S.levels = {};
  startShift(1);
  assert.strictEqual(S.plates.length, 2, 'day 1 opens with two plates');
  assert.strictEqual(S.grill.length, 2, 'day 1 opens with two burners');

  startShift(20);
  assert.ok(S.plates.length > 2, 'a player who never shops should still get more plates');
  assert.ok(S.grill.length > 2, 'a player who never shops should still get more burners');
});

test('the busiest possible kitchen still fits and stays walkable', function () {
  S.levels = { plate: 2, burner: 2, shoes: 3, grill: 3 };
  startShift(20);
  var n = Core.STATION_CAP;
  assert.strictEqual(S.plates.length, n, 'late day + maxed upgrades should hit the cap');
  assert.strictEqual(S.grill.length, n);

  for (var i = 0; i < n; i++) {
    var g = MB.slotRect(i), p = MB.plateRect(i);
    assert.ok(g.y >= L.cratesBottom - 0.01, 'grill slot ' + i + ' runs into the shelves');
    assert.ok(g.y + g.h <= L.hatchY + 0.01, 'grill slot ' + i + ' overflows the hatch');
    assert.ok(p.y + p.h <= L.hatchY + 0.01, 'plate ' + i + ' overflows the hatch');
    assert.ok(p.x + p.w <= VIEW_W + 0.01, 'plate ' + i + ' is off-canvas');
  }
  assert.ok(L.floor.x1 - L.floor.x0 > 50, 'the floor got squeezed out');
  assert.ok(L.slotH > 18 && L.plateH > 18,
    'stations shrank to ' + L.slotH.toFixed(0) + '/' + L.plateH.toFixed(0) + 'px - too small to read');

  // and every one of them is still reachable and tappable
  for (i = 0; i < n; i++) {
    assert.strictEqual(MB.stationAt(MB.slotRect(i).x + 2, MB.slotRect(i).y + 2).i, i);
    assert.strictEqual(MB.stationAt(MB.plateRect(i).x + 2, MB.plateRect(i).y + 2).i, i);
  }
  S.levels = {};
});

test('survives a long, messy run across many days without throwing', function () {
  S.levels = { shoes: 2, plate: 1 };
  S.money = 0;
  startShift(1);
  var served = 0, days = 0;

  for (var step = 0; step < 3000 && days < 8; step++) {
    if (S.screen !== 'service') {
      days++;
      startShift(Math.min(8, S.day + 1));
      continue;
    }
    if (!S.tickets.length) { pump(0.5); continue; }

    var t = S.tickets[Math.floor(Math.random() * S.tickets.length)];
    var p = Math.floor(Math.random() * S.plates.length);
    if (S.plates[p].stack.length) { work(MB.plateRect(p)); work(MB.binRect()); }

    // Play badly on purpose: skip fillings, mistime the grill, bin things.
    t.items.forEach(function (id) {
      if (Math.random() < 0.15) return;
      if (Core.byId(id).grill) {
        var slot = S.grill.indexOf(null);
        if (slot < 0) return;
        work(crateOf('patty'));
        work(MB.slotRect(slot));
        S.grill[slot].t = Math.random() * 14;
        work(MB.slotRect(slot));
      } else {
        work(crateOf(id));
      }
      work(MB.plateRect(p));
    });
    if (Math.random() < 0.08) { work(MB.plateRect(p)); work(MB.binRect()); continue; }
    work(MB.plateRect(p));
    work(MB.hatchRect());
    served++;
  }

  assert.ok(served > 25, 'expected a long run, only served ' + served + ' plates');
  assert.ok(S.sparks.length <= 400, 'the spark pool grew unbounded');
  assert.ok(S.floats.length <= 200, 'the float pool grew unbounded');
  pump(2);
});

/* ---------------------------------------------------------------- co-op */
test('single player runs one cook, co-op runs two', function () {
  S.role = 'solo';
  startShift(4);
  assert.strictEqual(S.chefs.length, 1, 'solo should have one cook');
  assert.strictEqual(S.me, 0);

  S.role = 'host';
  startShift(4);
  assert.strictEqual(S.chefs.length, 2, 'a host kitchen has two cooks');
  S.role = 'solo';
});

test('a guest tap drives the second cook, never the host\'s', function () {
  S.role = 'host';
  S.me = 0;
  startShift(6);
  pump(0.1);
  var mine = MB.chefAt(0), theirs = MB.chefAt(1);
  var minePos = { x: mine.x, y: mine.y };

  MB.onCoopMessage({ type: 'tap', target: { kind: 'crate', i: S.menu.indexOf('patty') } });
  assert.ok(theirs.target, 'the guest cook was not sent anywhere');
  assert.strictEqual(mine.target, null, 'the host cook must not move');

  for (var i = 0; i < 400 && theirs.target; i++) pump(0.05);
  assert.ok(theirs.holding && theirs.holding.id === 'patty', 'the guest cook should be holding it');
  assert.strictEqual(mine.holding, null, 'the host cook should still be empty-handed');
  assert.ok(Math.abs(mine.x - minePos.x) < 0.01, 'the host cook drifted');
  S.role = 'solo';
});

test('the two cooks carry different things at the same time', function () {
  S.role = 'host';
  startShift(8);
  pump(0.1);
  var topping = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];

  // host cook fetches a bun
  MB.sendChef({ kind: 'crate', i: S.menu.indexOf('bun') }, 0);
  MB.onCoopMessage({ type: 'tap', target: { kind: 'crate', i: S.menu.indexOf(topping) } });
  for (var i = 0; i < 400 && (MB.chefAt(0).target || MB.chefAt(1).target); i++) pump(0.05);

  assert.strictEqual(MB.chefAt(0).holding.id, 'bun');
  assert.strictEqual(MB.chefAt(1).holding.id, topping);
  S.role = 'solo';
});

test('a snapshot round-trips the whole kitchen', function () {
  S.role = 'host';
  startShift(8);
  pump(3);
  // put the kitchen in a distinctive state
  S.grill[0] = { id: 'patty', t: 2.5 };
  S.plates[0].stack = [{ id: 'bun', cook: 1 }, { id: 'patty', cook: 0.8, done: 0.9, char: 0 }];
  MB.chefAt(0).holding = { kind: 'ing', id: 'cheese', done: 1, char: 0 };
  MB.chefAt(1).holding = { kind: 'plate', stack: [{ id: 'bun', cook: 1 }] };
  S.hearts = 3; S.sales = 1234; S.tips = 567;
  var before = {
    tickets: S.tickets.map(function (t) { return t.uid; }),
    items: S.tickets.map(function (t) { return t.items.slice(); }),
    plate0: S.plates[0].stack.length,
    grillT: S.grill[0].t
  };

  var snap = MB.snapshot();
  assert.strictEqual(snap.type, 'state');
  assert.ok(snap.chefs.every(function (c) { return c.x >= -0.5 && c.x <= 1.5; }),
    'cook positions must travel normalised, not in pixels');

  // now become a guest and eat our own snapshot
  S.role = 'guest';
  S.me = 1;
  S.tickets = [];
  S.plates = [];
  S.grill = [];
  MB.applySnapshot(snap);

  assert.strictEqual(S.hearts, 3);
  assert.strictEqual(S.sales, 1234);
  assert.strictEqual(S.tips, 567);
  assert.deepStrictEqual(S.tickets.map(function (t) { return t.uid; }), before.tickets);
  assert.deepStrictEqual(S.tickets.map(function (t) { return t.items; }), before.items);
  assert.ok(S.tickets.every(function (t) { return t.arch && t.arch.name; }), 'archetypes must survive');
  assert.strictEqual(S.plates[0].stack.length, before.plate0);
  assert.strictEqual(S.grill[0].t, before.grillT);
  assert.strictEqual(MB.chefAt(0).holding.id, 'cheese');
  assert.strictEqual(MB.chefAt(1).holding.kind, 'plate');
  S.role = 'solo'; S.me = 0;
});

test('cook positions survive two devices with different screen sizes', function () {
  S.role = 'host';
  startShift(6);
  pump(0.1);
  MB.chefAt(0).x = L.floor.x0;                    // hard left of the floor
  MB.chefAt(1).x = L.floor.x1;                    // hard right
  MB.chefAt(0).y = MB.chefAt(1).y = L.floor.y0;
  var snap = MB.snapshot();

  // pretend the other device is much narrower
  var wideW = stage.clientWidth;
  stage.clientWidth = 320;
  pump(0.1);                                       // triggers a resize + layout
  S.role = 'guest';
  S.chefs.forEach(function (c) { c.buf = null; c.x = 0; c.y = 0; });
  MB.applySnapshot(snap);
  pump(0.05);

  assert.ok(Math.abs(MB.chefAt(0).x - L.floor.x0) < 2, 'left cook did not map to the left edge');
  assert.ok(Math.abs(MB.chefAt(1).x - L.floor.x1) < 2, 'right cook did not map to the right edge');

  stage.clientWidth = wideW;
  pump(0.1);
  S.role = 'solo'; S.me = 0;
});

test('a guest simulates nothing - the host owns the clock', function () {
  S.role = 'host';
  startShift(6);
  pump(3);
  assert.ok(S.tickets.length, 'need a ticket');
  S.grill[0] = { id: 'patty', t: 1.0 };

  S.role = 'guest';
  var patience = S.tickets[0].patience;
  var grillT = S.grill[0].t;
  var spawned = S.spawned;
  pump(4);

  assert.strictEqual(S.tickets[0].patience, patience, 'the guest ran the patience clock');
  assert.strictEqual(S.grill[0].t, grillT, 'the guest cooked the patty itself');
  assert.strictEqual(S.spawned, spawned, 'the guest spawned its own customers');
  S.role = 'solo';
});

/*
 * Regression: the guest used to cover the gap to the newest snapshot in 90ms
 * and then sit still until the next packet ~83ms later. Move, stop, move, stop.
 */
test('a guest cook moves at an even pace between position packets', function () {
  S.role = 'host';
  startShift(6);
  pump(0.1);
  var floorSpan = L.floor.x1 - L.floor.x0;

  S.role = 'guest'; S.me = 0;
  var g = MB.chefAt(1);
  g.buf = null; g.x = 0; g.y = 0;
  S.snapInterval = 50; S.lastSnapAt = 0;

  // a steady stream of packets, the far cook walking left to right. They have
  // to keep coming while we sample - the guest renders a fixed delay behind, so
  // stopping the stream is starvation, which is a different test.
  function pos(f) {
    MB.onCoopMessage({ type: 'pos', c: [{ x: 0.5, y: 0.5, f: 1 }, { x: f, y: 0.5, f: 1 }] });
  }
  // strictly every 50ms, priming included - an uneven stream is a different
  // test (jitter), and mixing the two would not show whether the pacing works
  var f = 0.05;
  pos(f); f += 0.10; pump(0.05);      // t = 0
  pos(f); f += 0.10; pump(0.05);      // t = 50
  pos(f); f += 0.10;                  // t = 100

  var xs = [];
  for (var i = 0; i < 8; i++) {
    pump(0.025);
    if (i % 2 === 1) { pos(f); f += 0.10; }   // t = 150, 200, 250, 300
    xs.push(MB.chefAt(1).x);
  }

  var steps = [];
  for (i = 1; i < xs.length; i++) steps.push(xs[i] - xs[i - 1]);
  assert.ok(steps.every(function (s) { return s > 0.1; }),
    'the cook stalled: ' + steps.map(function (s) { return s.toFixed(1); }).join(', '));

  // the point of buffered interpolation: constant velocity, not lurching
  var mx = Math.max.apply(null, steps), mn = Math.min.apply(null, steps);
  assert.ok(mx / mn < 2.5,
    'the pace lurched between ' + mn.toFixed(1) + ' and ' + mx.toFixed(1) + 'px per frame');
  assert.ok(mx < floorSpan * 0.5, 'the cook jumped');
  S.role = 'solo'; S.me = 0;
});

/*
 * The host sends on an exact beat; the network does not deliver on one. Samples
 * used to be stamped with the moment they arrived, which wrote the jitter
 * straight into the timeline and replayed it as a speed change - the last of
 * the roughness in co-op. The host says when it sent each packet now, and the
 * guest works out the offset between the two clocks.
 */
test('a jittery network does not make the other cook speed up and slow down', function () {
  S.role = 'host';
  startShift(6);
  pump(0.1);
  var floorSpan = L.floor.x1 - L.floor.x0;

  S.role = 'guest'; S.me = 0;
  var g = MB.chefAt(1);
  g.buf = null; g.x = 0; g.y = 0;
  S.snapInterval = 50; S.lastSnapAt = 0; S.clockOff = null;

  // The host walks the cook at a dead constant rate, one packet per 100ms of
  // its own clock - which reads 9,000,000ms behind ours, so the offset has to
  // be worked out rather than assumed.
  var hostT = 9000000, f = 0.05;
  function send() {
    MB.onCoopMessage({
      type: 'pos', t: hostT,
      c: [{ x: 0.5, y: 0.5, f: 1 }, { x: f, y: 0.5, f: 1 }]
    });
    hostT += 100; f += 0.06;
  }

  // prime: enough packets for the buffer and the clock estimate to be running,
  // because joining a room is a separate question from steady play
  for (var pi = 0; pi < 4; pi++) { send(); pump(0.10); }
  send();

  // ...but they arrive alternately early and late. Stamped on arrival, that
  // replays one segment at 2x and the next at two thirds speed.
  var gaps = [0.05, 0.15, 0.05, 0.15, 0.05, 0.15];
  var xs = [];
  for (var gi = 0; gi < gaps.length; gi++) {
    var frames = Math.round(gaps[gi] / 0.025);
    for (var k = 0; k < frames; k++) { pump(0.025); xs.push(MB.chefAt(1).x); }
    send();
  }

  var steps = [];
  for (var i = 1; i < xs.length; i++) steps.push(xs[i] - xs[i - 1]);
  assert.ok(steps.every(function (s) { return s > 0.1; }),
    'the cook stalled: ' + steps.map(function (s) { return s.toFixed(1); }).join(', '));
  var mx = Math.max.apply(null, steps), mn = Math.min.apply(null, steps);
  assert.ok(mx / mn < 1.5,
    'jitter came through as a speed change: ' + mn.toFixed(1) + ' to ' + mx.toFixed(1) +
    'px per frame (' + steps.map(function (s) { return s.toFixed(1); }).join(', ') + ')');
  assert.ok(mx < floorSpan * 0.5, 'the cook jumped');
  S.role = 'solo'; S.me = 0; S.clockOff = null;
});

test('a guest holds position rather than guessing when packets stop', function () {
  S.role = 'guest'; S.me = 0;
  startShift(6);
  var g = MB.chefAt(1) || MB.chefAt(0);
  S.chefs = [MB.chefAt(0), MB.chefAt(0)];
  S.chefs[1] = { x: 0, y: 0, tx: 0, ty: 0, target: null, holding: null, phase: 0, face: 1, blink: 0, blinkIn: 2, hop: 0, px: 0, py: 0, lerp: 1 };
  S.snapInterval = 50; S.lastSnapAt = 0;

  MB.onCoopMessage({ type: 'pos', c: [{ x: 0.5, y: 0.5, f: 1 }, { x: 0.2, y: 0.5, f: 1 }] });
  pump(0.05);
  MB.onCoopMessage({ type: 'pos', c: [{ x: 0.5, y: 0.5, f: 1 }, { x: 0.5, y: 0.5, f: 1 }] });
  pump(0.4);                       // silence: the host went away

  var settled = MB.chefAt(1).x;
  pump(0.5);
  assert.ok(Math.abs(MB.chefAt(1).x - settled) < 1,
    'the cook drifted off on its own when the packets stopped');
  S.role = 'solo'; S.me = 0;
});

/*
 * Regression: snapshots stamped the banner with the ever-incrementing snapshot
 * counter, so every packet looked like a brand new banner and the guest
 * restarted the pop-in animation 15 times a second. That was the DAY screen
 * flashing on and off on the phone.
 */
test('a banner does not re-trigger on every snapshot', function () {
  S.role = 'host';
  startShift(4);                      // startDay raises a "DAY 4" banner
  pump(0.05);
  assert.ok(S.banner, 'setup: expected a banner');

  var snaps = [MB.snapshot(), MB.snapshot(), MB.snapshot()];
  var ids = snaps.map(function (s) { return s.banner && s.banner.n; });
  assert.strictEqual(new Set(ids).size, 1,
    'the same banner went out with three different ids: ' + ids.join(', '));

  S.role = 'guest'; S.me = 1; S.lastBannerId = -1;
  MB.applySnapshot(snaps[0]);
  var firstT = S.banner.t;
  pump(0.2);
  var agedT = S.banner.t;
  assert.ok(agedT > firstT, 'setup: the banner should be ageing');

  MB.applySnapshot(snaps[1]);
  MB.applySnapshot(snaps[2]);
  assert.ok(S.banner.t >= agedT,
    'the banner restarted its animation on a repeat snapshot');
  S.role = 'solo'; S.me = 0;
});

test('a new banner from the host still gets through', function () {
  S.role = 'host';
  startShift(4);
  pump(0.05);
  var a = MB.snapshot();
  S.role = 'guest'; S.me = 1; S.lastBannerId = -1;
  MB.applySnapshot(a);
  pump(0.3);

  S.role = 'host';
  MB.state.banner = null;
  MB.startDay(5);                     // raises a different banner
  pump(0.05);
  var b = MB.snapshot();
  assert.notStrictEqual(b.banner.n, a.banner.n, 'setup: needs a different banner');

  S.role = 'guest'; S.me = 1;
  MB.applySnapshot(b);
  assert.ok(S.banner.t < 0.05, 'a genuinely new banner should play from the start');
  S.role = 'solo'; S.me = 0;
});

/* ------------------------------------------------------- dropped phones */
/*
 * Regression: the packets were sent from inside update(), below its "not in a
 * shift, nothing to do" return - so the host went silent the moment it stopped
 * playing. Clearing a day put the receipt and then the shop on the host's
 * screen, and for that whole time the guest sat holding the last frame of a
 * shift that had already ended, tickets frozen on the board, with no word of
 * what had happened. From their side the host had moved on without them.
 */
test('the host keeps talking to the guest between shifts', function () {
  var sent = sentPackets;
  sent.length = 0;
  try {
    S.role = 'host'; S.peer = true;
    startShift(1);
    pump(0.5);
    assert.ok(sent.some(function (m) { return m.type === 'state'; }), 'setup: nothing sent during a shift');

    // the shift ends and the host is left looking at the receipt
    S.sales = 99999;
    MB.endDay();
    pump(0.2);
    assert.notStrictEqual(S.screen, 'service', 'setup: the day should be over');

    sent.length = 0;
    pump(1.0);
    var states = sent.filter(function (m) { return m.type === 'state'; });
    assert.ok(states.length >= 4,
      'the host sent ' + states.length + ' updates in a second while on the receipt');
    assert.strictEqual(states[0].screen, S.screen,
      'the update should carry the screen the host is actually on');
  } finally {
    sentPackets.length = 0;
    S.role = 'solo'; S.peer = false;
  }
});

test('the host keeps talking to the guest while paused', function () {
  var sent = sentPackets;
  sent.length = 0;
  try {
    S.role = 'host'; S.peer = true;
    startShift(3);
    pump(0.5);

    MB.setPaused(true);
    sent.length = 0;
    pump(1.0);
    var states = sent.filter(function (m) { return m.type === 'state'; });
    assert.ok(states.length >= 4,
      'the host sent ' + states.length + ' updates in a second while paused');
    assert.strictEqual(states[0].paused, true, 'the update should say the host is paused');

    MB.setPaused(false);
    pump(0.3);
    sent.length = 0;
    pump(0.5);
    var back = sent.filter(function (m) { return m.type === 'state'; });
    assert.ok(back.length && back[0].paused === false, 'unpausing should be sent on too');
  } finally {
    sentPackets.length = 0;
    S.role = 'solo'; S.peer = false;
    MB.setPaused(false);
  }
});

test('a guest is told why the kitchen has stopped, not left guessing', function () {
  S.role = 'host';
  startShift(1);
  pump(0.3);
  S.sales = 99999;
  MB.endDay();
  pump(0.2);
  var overSnap = MB.snapshot();
  MB.setPaused(false);

  startShift(1);
  pump(0.3);
  S.userPaused = true;
  var pausedSnap = MB.snapshot();
  S.userPaused = false;

  S.role = 'guest'; S.me = 1;
  MB.applySnapshot(overSnap);
  assert.notStrictEqual(S.screen, 'service', 'the guest should know the day is over');

  MB.applySnapshot(pausedSnap);
  assert.strictEqual(S.hostPaused, true, 'the guest should know the host paused');

  // and it clears again when the host carries on
  S.role = 'host';
  startShift(1);
  pump(0.3);
  var live = MB.snapshot();
  S.role = 'guest';
  MB.applySnapshot(live);
  assert.strictEqual(S.hostPaused, false, 'the guest is still showing a stale pause');
  assert.strictEqual(S.screen, 'service');

  S.role = 'solo'; S.me = 0;
});

test('a guest dropping does not tear the room down', function () {
  S.role = 'host';
  S.roomCode = 'ABCDE';
  S.coopStarted = true;
  S.peer = true;
  startShift(6);
  pump(2);
  var day = S.day, sales = S.sales;

  // the DO tells the host its friend went away
  MB.state.peer = false;
  var c = MB.chefAt(1);
  c.target = { kind: 'hatch' };

  // host stays hosting, keeps the kitchen, parks the missing cook
  assert.strictEqual(S.role, 'host', 'the host should still be hosting');
  assert.strictEqual(S.chefs.length, 2, 'the missing cook keeps their place');
  assert.strictEqual(S.day, day);
  assert.strictEqual(S.sales, sales, 'the shift must not reset');
  S.role = 'solo'; S.roomCode = null; S.coopStarted = false;
});

test('a guest tap is ignored when there is no second cook to drive', function () {
  S.role = 'host';
  startShift(6);
  S.chefs.length = 1;                 // mid-teardown state
  pump(0.05);
  var mine = MB.chefAt(0);
  mine.target = null;

  MB.onCoopMessage({ type: 'tap', target: { kind: 'hatch' } });
  assert.strictEqual(mine.target, null,
    'a stray guest tap drove the host\'s own cook');
  S.role = 'solo';
});

test('ending co-op clears the room so a rejoin starts fresh', function () {
  S.role = 'guest';
  S.me = 1;
  S.roomCode = 'ABCDE';
  S.reconnectTries = 4;
  S.coopStarted = true;
  MB.endCoop('test');
  assert.strictEqual(S.role, 'solo');
  assert.strictEqual(S.roomCode, null, 'a stale room code would reconnect us into nothing');
  assert.strictEqual(S.reconnectTries, 0);
  assert.strictEqual(S.coopStarted, false, 'otherwise the next room never starts its day');
  assert.strictEqual(S.chefs.length, 1);
  assert.strictEqual(S.me, 0);
});

test('leaving co-op drops back to one cook', function () {
  S.role = 'host';
  startShift(6);
  assert.strictEqual(S.chefs.length, 2);
  MB.leaveCoop('test');
  assert.strictEqual(S.role, 'solo');
  assert.strictEqual(S.chefs.length, 1);
  assert.strictEqual(S.me, 0);
  assert.strictEqual(S.peer, false);
});

/* ---------------------------------------------------------------- music */
/*
 * Runs last: installing a fake AudioContext leaves Sfx wired to stubs, and
 * nothing after this should care.
 */
test('the backing track schedules a groove and keeps time', function () {
  var notes = [], hits = 0;
  var now = 0;

  function node() {
    return {
      type: '', buffer: null,
      gain: { value: 0, setValueAtTime: NOOP, exponentialRampToValueAtTime: NOOP },
      frequency: {
        value: 0,
        setValueAtTime: function (f, t) { notes.push({ f: f, t: t }); },
        exponentialRampToValueAtTime: NOOP
      },
      Q: { value: 0 },
      connect: function (n) { return n; },
      start: NOOP, stop: NOOP
    };
  }

  global.AudioContext = function () {
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
    this.resume = NOOP;
    this.createGain = node;
    this.createOscillator = node;
    this.createBiquadFilter = node;
    this.createBufferSource = function () { hits++; return node(); };
    this.createBuffer = function (ch, len) {
      return { getChannelData: function () { return new Float32Array(len); } };
    };
    Object.defineProperty(this, 'currentTime', { get: function () { return now; } });
  };

  var Bgm = global.Bgm;
  Bgm.start();
  try {
    assert.ok(Bgm.playing, 'the track never started');
    assert.ok(Bgm.timer, 'no scheduler timer was installed');
    // Drive the lookahead by hand from here so the test is deterministic.
    clearInterval(Bgm.timer);
    Bgm.timer = null;

    Bgm.setIntensity(0.8);        // every layer live: bass, drums, comp, lead
    notes.length = 0; hits = 0;
    for (var i = 0; i < 40; i++) { now += 0.1; Bgm._tick(); }   // 4 seconds

    // ~6.7 beats at 100bpm: a bass note per beat, kicks, comps and a lead line
    assert.ok(notes.length >= 12, 'only ' + notes.length + ' pitched notes over 4 seconds');
    assert.ok(hits >= 8, 'only ' + hits + ' drum hits over 4 seconds');
    notes.forEach(function (n) {
      assert.ok(n.f > 20 && n.f < 5000, 'note out of audible range: ' + n.f);
    });
    var times = notes.map(function (n) { return n.t; });
    assert.ok(Math.min.apply(null, times) >= 0, 'a note was scheduled in the past');
    assert.ok(Math.max.apply(null, times) <= now + 0.3, 'the scheduler ran away ahead of the clock');

    // it loops rather than marching off the end of the chart
    var before = Bgm.step;
    for (i = 0; i < 400; i++) { now += 0.1; Bgm._tick(); }
    assert.ok(Bgm.step >= 0 && Bgm.step < 64, 'the step counter escaped the loop: ' + Bgm.step);
    assert.notStrictEqual(Bgm.step, before, 'the loop stalled');

    Bgm.setIntensity(2);
    assert.strictEqual(Bgm.intensity, 1, 'intensity must clamp');
    Bgm.setIntensity(-3);
    assert.strictEqual(Bgm.intensity, 0);
    for (i = 0; i < 20; i++) { now += 0.1; Bgm._tick(); }   // quiet shift, no throw

    Bgm.stop();
    assert.strictEqual(Bgm.playing, false);
    var quiet = notes.length;
    for (i = 0; i < 20; i++) { now += 0.1; Bgm._tick(); }
    assert.strictEqual(notes.length, quiet, 'a stopped track kept scheduling');
  } finally {
    // Never leave a live interval behind - it hangs the whole test process.
    Bgm.stop();
  }
});

/*
 * The board commits its height before the first ticket of the day exists, and
 * everything downstream depends on that being enough: if a slip ever needs a
 * line the reservation did not buy, the board grows under the first ticket,
 * the kitchen loses that height in one frame, and the layout watchdog reads
 * the jump as a rotation and relays the whole room.
 *
 * That used to be a CSS min-height calc and is now a canvas height, but it is
 * the same promise, and nothing was testing it either way.
 */
test('the board reserves enough lines for anything the day can order', function () {
  for (var day = 1; day <= 25; day++) {
    MB.reserveBoard(day);
    var reserved = parseInt(rootProps['--order-rows'], 10);
    assert.ok(reserved >= 1, 'day ' + day + ' reserved nothing');

    // Every order this day can deal, not a sample: makeOrder draws its extras
    // from a shuffled pool, so a few hundred seeds cover the shapes it makes.
    var worst = 0, worstOrder = null;
    for (var i = 0; i < 400; i++) {
      var seed = i * 2654435761 % 4294967296;
      var rng = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      var arch = Core.pickCustomer(day, rng);
      var order = Core.makeOrder(day, rng, arch);
      var rows = MB.orderRows(order.items).length;
      if (rows > worst) { worst = rows; worstOrder = order.items.join('+'); }
    }
    assert.ok(worst <= reserved,
      'day ' + day + ' reserved ' + reserved + ' lines but an order needs ' +
      worst + ': ' + worstOrder);
  }
});

test('a co-op guest reserves the board for the host\'s day, not its own', function () {
  startShift(3);
  MB.reserveBoard(3);
  var mine = parseInt(rootProps['--order-rows'], 10);

  // the host is deep into a run; the guest has only ever played day three
  var snap = MB.snapshot();
  snap.day = 14;
  snap.concurrent = 5;
  MB.applySnapshot(snap);
  var theirs = parseInt(rootProps['--order-rows'], 10);

  assert.ok(theirs > mine,
    'the guest kept its own day-3 reservation (' + mine + ') for a day-14 board (' + theirs + ')');
});

/* ------------------------------------------------- the fry line & fountain */

/** Put a basket in, run it to the perfect window, and take it back out. */
function fryPerfect(well) {
  work(MB.fryWellRect(well));
  assert.ok(S.fryer[well], 'the basket never went in');
  S.fryer[well].t = Core.COOK_TIME;
  work(MB.fryWellRect(well));
}

test('the fry line opens on its own day, not before', function () {
  startShift(1);
  assert.strictEqual(S.fryer.length, 0, 'day 1 had a fryer');
  assert.strictEqual(MB.layout.fryH, 0, 'day 1 reserved height for a fryer');
  startShift(Core.SIDE_DAY);
  assert.strictEqual(S.fryer.length, 2, 'the fry station never opened');
  assert.ok(MB.layout.fryH > 0, 'the fry station has no height');
});

test('an empty-handed tap drops a basket; a second one lifts it out', function () {
  startShift(8);
  S.chef.holding = null;
  work(MB.fryWellRect(0));
  assert.ok(S.fryer[0], 'nothing went into the oil');
  assert.strictEqual(held(), null, 'the cook walked off holding something');

  S.fryer[0].t = Core.COOK_TIME;
  work(MB.fryWellRect(0));
  assert.strictEqual(S.fryer[0], null, 'the well is still full');
  assert.strictEqual(held().kind, 'fries', 'the cook is not holding fries');
  assert.ok(held().cook > 0.9, 'perfectly timed fries scored ' + held().cook);
});

test('the two wells run independently', function () {
  startShift(8);
  S.chef.holding = null;
  work(MB.fryWellRect(0));
  work(MB.fryWellRect(1));
  assert.ok(S.fryer[0] && S.fryer[1], 'the second basket did not go in');
  S.fryer[0].t = 5; S.fryer[1].t = 1;
  pump(0.5);
  assert.ok(S.fryer[0].t > S.fryer[1].t, 'the wells share a clock');
});

test('fries left in too long come out burnt', function () {
  startShift(8);
  S.chef.holding = null;
  work(MB.fryWellRect(0));
  S.fryer[0].t = Core.COOK_TIME * 3;
  work(MB.fryWellRect(0));
  assert.strictEqual(held().kind, 'fries');
  assert.ok(held().cook < 0.5, 'burnt fries scored ' + held().cook);
});

test('the fountain pours what the front of the board is waiting for', function () {
  startShift(8);
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[1] || S.drinkTaps[0];
  S.chef.holding = null;
  assert.strictEqual(MB.nextDrinkWanted(), S.tickets[0].drink);
  work(MB.tapRect());
  assert.strictEqual(held().kind, 'cup');
  assert.strictEqual(held().flavor, S.tickets[0].drink, 'the wrong flavour came out');
});

test('the fountain will not pour a second cup for the same order', function () {
  startShift(8);
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];
  S.chef.holding = null;
  var uid = S.tickets[0].uid;
  work(MB.tapRect());
  work(MB.plateRect(0));
  assert.strictEqual(S.plates[0].drink, S.drinkTaps[0], 'the cup never reached the tray');

  // work() runs the loop, and the loop lets new customers in - so silence
  // everyone except the order this test is actually about.
  S.tickets.forEach(function (t) { if (t.uid !== uid) t.drink = null; });
  assert.strictEqual(MB.nextDrinkWanted(), null,
    'the fountain offered a second cup for an order already covered');
});

test('fries and a cup ride on the tray, not inside the burger', function () {
  startShift(8);
  S.chef.holding = null;
  S.plates.forEach(function (p) { p.stack = []; p.side = null; p.drink = null; });
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];

  fryPerfect(0);
  work(MB.plateRect(0));
  work(MB.tapRect());
  work(MB.plateRect(0));

  assert.strictEqual(S.plates[0].side, 'fries');
  assert.strictEqual(S.plates[0].drink, S.drinkTaps[0]);
  assert.strictEqual(S.plates[0].stack.length, 0,
    'the tray put fries or a drink into the burger stack');

  // and they travel with the tray when it is picked up
  work(MB.plateRect(0));
  assert.strictEqual(held().kind, 'plate');
  assert.strictEqual(held().side, 'fries', 'the fries fell off the tray');
  assert.strictEqual(held().drink, S.drinkTaps[0], 'the drink fell off the tray');
});

test('a complete tray is paid for in full', function () {
  startShift(8);
  S.chef.holding = null;
  S.plates.forEach(function (p) { p.stack = []; p.side = null; p.drink = null; });
  S.tickets.length = 0;
  MB.spawnTicket();
  var t = S.tickets[0];
  t.items = ['bun', 'patty']; t.side = 'fries'; t.drink = S.drinkTaps[0];
  t.patience = t.max;

  fryPerfect(0);
  work(MB.plateRect(0));
  work(MB.tapRect());
  work(MB.plateRect(0));
  buildPlate(0, ['bun', 'patty']);

  var before = S.sales;
  work(MB.plateRect(0));
  work(MB.hatchRect());
  pump(0.1);

  var burger = Core.menuPrice(['bun', 'patty']);
  var full = burger + Core.SIDES.fries.price + Core.drinkById(S.drinkTaps[0]).price;
  assert.strictEqual(S.sales - before, full,
    'the till took ' + (S.sales - before) + ' for a tray worth ' + full);
  assert.strictEqual(S.perfect, 1, 'a complete correct tray was not perfect');
});

test('forgetting the drink costs the grade, not a heart', function () {
  startShift(8);
  S.chef.holding = null;
  S.plates.forEach(function (p) { p.stack = []; p.side = null; p.drink = null; });
  S.tickets.length = 0;
  MB.spawnTicket();
  var t = S.tickets[0];
  t.items = ['bun', 'patty']; t.side = null; t.drink = S.drinkTaps[0];
  t.patience = t.max;

  buildPlate(0, ['bun', 'patty']);
  var hearts = S.hearts, perfect = S.perfect;
  work(MB.plateRect(0));
  work(MB.hatchRect());
  pump(0.1);

  assert.strictEqual(S.hearts, hearts, 'a forgotten drink cost a heart');
  assert.strictEqual(S.perfect, perfect, 'a burger with no drink still scored perfect');
  assert.strictEqual(S.served, 1, 'the order was not counted as served');
});

test('a co-op guest gets the fry line and the fountain too', function () {
  startShift(8);
  S.chef.holding = null;
  work(MB.fryWellRect(0));
  S.plates[0].side = 'fries';
  S.plates[0].drink = S.drinkTaps[0];
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].side = 'fries';
  S.tickets[0].drink = S.drinkTaps[0];

  var snap = MB.snapshot();
  assert.ok(snap.fryer && snap.fryer[0], 'the snapshot dropped the fryer');
  assert.strictEqual(snap.plates[0].sd, 'fries', 'the snapshot dropped the tray');
  assert.strictEqual(snap.tickets[0].sd, 'fries', 'the snapshot dropped the ticket side');

  // wipe the guest's kitchen, then let the host's state land on it
  S.fryer = []; S.plates[0].side = null; S.plates[0].drink = null;
  S.tickets[0].side = null; S.tickets[0].drink = null;
  MB.applySnapshot(snap);
  assert.ok(S.fryer[0], 'the guest never saw the basket');
  assert.strictEqual(S.plates[0].side, 'fries', 'the guest never saw the fries');
  assert.strictEqual(S.plates[0].drink, S.drinkTaps[0], 'the guest never saw the drink');
  assert.strictEqual(S.tickets[0].side, 'fries', 'the guest saw a burger-only ticket');
  S.role = 'solo'; S.me = 0;
});

test('the slip has a line for the fries and a line for the cup', function () {
  var rows = MB.orderRows(['bun', 'patty', 'cheese'], 'fries', 'cola');
  var names = rows.map(function (r) { return r.n; });
  assert.ok(names.indexOf('FRIES') >= 0, 'no fries on the slip: ' + names.join(','));
  assert.ok(names.indexOf('COLA') >= 0, 'no drink on the slip: ' + names.join(','));
  rows.forEach(function (r) { assert.ok(r.c && r.n, 'a row is missing its swatch or label'); });

  // a bare burger with a side is not PLAIN
  var bare = MB.orderRows(['bun', 'patty'], 'fries', null).map(function (r) { return r.n; });
  assert.ok(bare.indexOf('PLAIN') < 0, 'a tray with fries on it was called PLAIN');
  assert.strictEqual(MB.orderRows(['bun', 'patty'], null, null)[0].n, 'PLAIN');
});

test('the board still reserves enough lines once the tray is on it', function () {
  for (var day = 1; day <= 25; day++) {
    MB.reserveBoard(day);
    var reserved = parseInt(rootProps['--order-rows'], 10);
    var worst = 0, worstOrder = null;
    for (var i = 0; i < 400; i++) {
      var seed = i * 2654435761 % 4294967296;
      var rng = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      var arch = Core.pickCustomer(day, rng);
      var o = Core.makeOrder(day, rng, arch);
      var rows = MB.orderRows(o.items, o.side, o.drink).length;
      if (rows > worst) { worst = rows; worstOrder = o.items.join('+') + '/' + o.side + '/' + o.drink; }
    }
    assert.ok(worst <= reserved,
      'day ' + day + ' reserved ' + reserved + ' lines but a tray needs ' + worst + ': ' + worstOrder);
  }
});

test('the kitchen still fits with two more machines in it', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 560], [412, 400], [320, 480]].forEach(function (size) {
    stage.clientWidth = size[0];
    stage.clientHeight = size[1];
    startShift(25);
    pump(0.4);
    assert.ok(!S.cramped, size.join('x') + ' went cramped with the fry line in');
    assert.ok(MB.layout.slotH >= 22 && MB.layout.plateH >= 22,
      size.join('x') + ' squeezed a station to ' + MB.layout.slotH + '/' + MB.layout.plateH);
    assert.ok(MB.layout.fryH > 20 && MB.layout.tapH > 20,
      size.join('x') + ' left no room for the machines');
  });
  stage.clientWidth = w0;
  stage.clientHeight = h0;
  pump(0.4);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');


