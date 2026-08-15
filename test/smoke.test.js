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
require('../www/js/art-freezer-dispenser.js');
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

/*
 * Press one of the fountain's three spouts, stand there while the cup fills,
 * and take it. The machine no longer hands over a finished drink in one tap -
 * the lever you press is the flavour you get, and it costs the cook's time.
 */
function pourCup(col) {
  var r = MB.tapRect();
  var w3 = r.w * 0.283;
  var cx = r.x + r.w * (0.217 + 0.283 * (col || 0));
  work({ x: cx - w3 / 2, y: r.y, w: w3, h: r.h });
  for (var i = 0; i < 200 && S.pour && !held(); i++) {
    pump(0.05);
    if (S.pour && S.pour.t >= 1.5) MB.arrive({ kind: 'tap', i: col || 0 }, 0);
  }
  return held();
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

  /*
   * The shelf runs in one row, or two when a single row would squeeze the
   * boxes too narrow to read. Either way it is a grid: every box the same
   * size, laid out left to right and then down, nothing overlapping and
   * nothing off the canvas.
   */
  var first = MB.crateRect(0);
  var ys = {};
  for (i = 0; i < S.menu.length; i++) {
    var r = MB.crateRect(i);
    ys[r.y.toFixed(2)] = 1;
    assert.strictEqual(r.w, first.w, 'crate ' + i + ' is a different width');
    assert.strictEqual(r.h, first.h, 'crate ' + i + ' is a different height');
    assert.ok(r.w > 20, 'crate ' + i + ' shrank to ' + r.w.toFixed(1) + 'px');
    assert.ok(r.x >= 0 && r.x + r.w <= VIEW_W + 0.01, 'crate ' + i + ' is off-canvas');
    if (i > 0) {
      var p = MB.crateRect(i - 1);
      // reading order: further right, or the start of the next row down
      assert.ok(p.x + p.w <= r.x + 0.01 || r.y > p.y + 0.01,
        'crates ' + (i - 1) + ' and ' + i + ' are out of reading order');
    }
    for (var j = 0; j < i; j++) {
      var q = MB.crateRect(j);
      assert.ok(!(q.x < r.x + r.w - 0.01 && r.x < q.x + q.w - 0.01 &&
                  q.y < r.y + r.h - 0.01 && r.y < q.y + q.h - 0.01),
        'crates ' + j + ' and ' + i + ' overlap');
    }
  }
  assert.ok(Object.keys(ys).length <= 2,
    'the shelf ran to ' + Object.keys(ys).length + ' rows; two is the limit');
});

/*
 * The shelf is the thing that gets crowded as the menu grows: eight boxes
 * across a phone is 40px each, too narrow for the name and under the 62px
 * drawCrate needs before it will draw the grill flame or the chop blade - so
 * the two markers that teach the game vanish exactly when the game gets
 * complicated. It wraps to a second row instead, but only where the columns
 * below can still stand up.
 */
test('a crowded line gets a second row rather than eight thin boxes', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;

  [[375, 812], [412, 915], [360, 640]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    [14, 20, 25].forEach(function (d) {
      MB.startDay(d);
      pump(0.3);
      var where = sz.join('x') + ' day ' + d + ': ';
      assert.ok(S.menu.length >= 7, where + 'setup: expected a busy line');
      var w = MB.crateRect(0).w;
      assert.ok(w >= 62, where + 'crates are ' + w.toFixed(0) + 'px, too narrow for their markers');
      assert.strictEqual(S.cramped, false, where + 'the shelf squeezed the kitchen out of the room');
      assert.ok(MB.layout.slotH >= 22 && MB.layout.plateH >= 22,
        where + 'a station fell under a tappable size: ' +
        MB.layout.slotH.toFixed(0) + '/' + MB.layout.plateH.toFixed(0));
    });
  });

  // ...and a screen that cannot pay for the row keeps its single line
  stage.clientWidth = 412; stage.clientHeight = 430;
  MB.startDay(20);
  pump(0.3);
  var rows = {};
  for (var i = 0; i < S.menu.length; i++) rows[MB.crateRect(i).y.toFixed(2)] = 1;
  assert.strictEqual(Object.keys(rows).length, 1,
    'a short screen took a second row it did not have the height for');

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
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

  /*
   * The settle may have let the walk finish - how long a crossing takes is a
   * property of the room, not of this test - so make sure there is a live
   * target before asking where it points. Send it to whichever crate it is
   * furthest from.
   */
  if (!S.chef.target) {
    var far = 0, best = -1;
    for (var ci = 0; ci < S.menu.length; ci++) {
      var sp = MB.standPoint({ kind: 'crate', i: ci });
      var d = Math.hypot(sp.x - S.chef.x, sp.y - S.chef.y);
      if (d > best) { best = d; far = ci; }
    }
    tapRect(MB.crateRect(far));
    pump(0.05);
    assert.ok(S.chef.target, 'the cook refused a fresh walk after the relayout');
  }

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
  // Two thirds of the way to seared - derived, because a literal 3.0 seconds
  // only meant "part-cooked" while the window happened to open at 4.2s.
  var partway = Math.round((Core.COOK_TIME - Core.BASE_WINDOW / 2) * 0.66 * 100) / 100;
  S.grill[0].t = partway;
  work(MB.slotRect(0));                       // lift it off, part-cooked
  var lifted = held().done;
  assert.ok(lifted > 0.5 && lifted < 1, 'setup: should be part-cooked, got ' + lifted);
  assert.strictEqual(held().grillT, partway, 'the time on the grill has to ride along');

  // and back down on another burner. It keeps ticking from the frame it lands,
  // so allow for that rather than demanding an exact match.
  work(MB.slotRect(1));
  assert.ok(S.grill[1].t >= partway && S.grill[1].t < partway + 0.4,
    'the burner restarted from ' + S.grill[1].t.toFixed(2) + ' instead of ' + partway);
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
  buildPlate(1, [topping]);
  assert.deepStrictEqual(plateIds(1), [topping]);
  assert.deepStrictEqual(plateIds(0), [], 'the other plate should be untouched');
  assert.strictEqual(held(), null);
});

test('two plates fill independently', function () {
  startShift(8);
  var a = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  var b = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[1] || a;
  buildPlate(0, [a]);
  buildPlate(1, [b]);
  assert.deepStrictEqual(plateIds(0), [a]);
  assert.deepStrictEqual(plateIds(1), [b]);
});

test('a loaded plate can be picked up, put down, and picked up again', function () {
  startShift(6);
  var topping = S.menu.filter(function (id) { return id !== 'patty' && id !== 'bun'; })[0];
  buildPlate(0, [topping]);

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
  buildPlate(0, [a]);
  buildPlate(1, [a]);

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
  assert.strictEqual(S.waste, 0, 'a perfect burger threw food away');
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
  assert.ok(S.waste > 0, 'a rejected plate went in the bin for free');
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
test('an impatient ticket walks out and takes the sale with it', function () {
  startShift(1);
  pump(2);
  var t = S.tickets[0];
  var took = S.sales + S.tips;
  t.patience = 0.02;
  pump(0.3);
  assert.strictEqual(S.walked, 1);
  assert.strictEqual(MB.ticketOf(t.uid), null);
  assert.strictEqual(S.sales + S.tips, took, 'a walkout paid something');
  // nothing was cooked for them, so nothing goes in the bin - the cost of a
  // walkout is the money that never arrived, which the rent already measures
  assert.strictEqual(S.waste, 0, 'a walkout binned food that was never made');
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

  assert.strictEqual(S.waste, 0, 'nothing was cooked, so nothing should have been binned');
  assert.strictEqual(S.walked, Core.dayConfig(1).customers, 'every customer should have walked');
  assert.notStrictEqual(S.screen, 'service',
    'the shift never ended: ' + S.spawned + '/' + Core.dayConfig(1).customers +
    ' customers in, ' + S.tickets.length + ' left on the board');
});

/*
 * There is one failure condition now: the day has to cover its rent. The
 * hearts used to be a second one running alongside it - five mistakes shut the
 * shop whatever the till said - and a shift could end before the clock did.
 */
test('a shift runs to the clock however badly it goes', function () {
  startShift(6);
  pump(2);
  for (var i = 0; i < 12 && S.screen === 'service'; i++) {
    if (!S.tickets.length) pump(20);
    if (!S.tickets.length) break;
    S.tickets[0].patience = 0.02;
    pump(0.3);
  }
  assert.ok(S.walked >= 5, 'setup: this should have driven several customers out, got ' + S.walked);
  assert.strictEqual(S.waste, 0, 'walkouts put food in the bin that was never cooked');

  /*
   * If the shift did end it must be because the day ran out of customers or
   * clock - never because a counter of mistakes hit zero, which is what the
   * hearts used to do on the fifth walkout.
   */
  if (S.screen !== 'service') {
    assert.ok(S.spawned >= Core.dayConfig(6).customers || S.timeLeft <= 0,
      'the shop shut with ' + S.spawned + '/' + Core.dayConfig(6).customers +
      ' customers in and ' + S.timeLeft.toFixed(1) + 's left - that is a life counter');
  }
});

test('a day that does not cover its rent shuts the shop', function () {
  startShift(6);
  S.sales = 0; S.tips = 0; S.waste = 0;
  assert.ok(S.rent > 0, 'setup: there should be rent to miss');
  MB.endDay();
  assert.strictEqual(S.screen, 'dayEnd');
  assert.strictEqual(elements.over.hidden, false, 'the shut-down sheet should be up');
  assert.strictEqual(elements.dayEnd.hidden, true, 'a failed day is not a receipt');

  // ...and food in the bin is what pushes a near-miss under
  startShift(6);
  S.sales = S.rent; S.tips = 0; S.waste = 0;
  MB.endDay();
  assert.strictEqual(elements.dayEnd.hidden, false, 'exactly making rent should pass');

  startShift(6);
  S.sales = S.rent; S.tips = 0; S.waste = 1;
  MB.endDay();
  assert.strictEqual(elements.over.hidden, false,
    'a penny of waste against an exact till should fail the day');
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
  S.waste = 2;
  MB.setPaused(true);

  MB.startDay(S.day);
  pump(0.05);
  assert.strictEqual(S.userPaused, false, 'restart should unpause');
  assert.strictEqual(elements.pause.hidden, true);
  assert.strictEqual(S.sales, 0, 'takings should reset');
  assert.strictEqual(S.waste, 0, 'the bin should be emptied for a fresh shift');
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

/*
 * CONTINUE has to offer the shift you walked out of.
 *
 * The only save was at the end of a shift and it wrote down the day that had
 * just been COMPLETED, so quitting during day 8 came back offering day 7 - a
 * day already cleared and banked. Two writes fix it between them: the day you
 * are about to play, and on a clean finish the day after it.
 */
test('the save holds the shift you would come back to', function () {
  startShift(6);
  var saved = function () { return JSON.parse(storeData['mb_save_v2']); };

  assert.ok(storeData['mb_save_v2'], 'nothing was written to storage');
  assert.strictEqual(saved().day, 6,
    'starting day 6 wrote down day ' + saved().day + ' - a quit mid-shift would replay it');
  assert.strictEqual(saved().money, S.money);

  // walking out mid-shift changes nothing: the day is already written down
  MB.quitToTitle();
  assert.strictEqual(saved().day, 6, 'quitting rewound the save to day ' + saved().day);

  // clear a shift and the save moves on, so the shop screen is not a trap
  startShift(6);
  S.waste = 0;
  S.sales = S.rent + 1000;
  S.tips = 0;
  MB.endDay();
  assert.strictEqual(saved().day, 7,
    'a cleared day 6 left the save on ' + saved().day + ' - closing the app at the shop replays it');
  assert.strictEqual(S.day, 6, 'endDay moved the shift itself, not just the bookmark');

  // ...and a shift that was NOT cleared stays where it is
  startShift(9);
  S.sales = 0; S.tips = 0; S.waste = 0;
  MB.endDay();
  assert.strictEqual(saved().day, 9, 'a failed day 9 wrote down ' + saved().day);
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
      var ing = Core.byId(id);
      if (ing.grill) {
        var slot = S.grill.indexOf(null);
        if (slot < 0) return;
        work(crateOf('patty'));
        work(MB.slotRect(slot));
        // the put-on is refused if the cook's hands were already full
        if (!S.grill[slot]) return;
        S.grill[slot].t = Math.random() * 14;
        work(MB.slotRect(slot));
      } else if (ing.chop) {
        // through the board, and sometimes abandon it half-chopped
        if (!S.board.portions && !S.board.id) {
          work(crateOf(id));
          work(MB.boardRect());
        }
        if (S.board.id === id) {
          for (var i = 0; i < 200 && !S.board.portions; i++) pump(0.05);
        }
        if (S.board.portions && S.board.id === id) work(MB.boardRect());
      } else {
        work(crateOf(id));
      }
      work(MB.plateRect(p));
    });
    // whatever is still in the cook's hands and cannot be plated goes in the bin
    if (held() && held().kind === 'ing') work(MB.binRect());
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
  S.waste = 300; S.sales = 1234; S.tips = 567;
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

  assert.strictEqual(S.waste, 300);
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

  // the scheduler lives on the synth, which is the fallback the game drops to
  // when there is no recording to play
  var Bgm = global.BgmSynth;
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

/* ------------------------------------------------------- the cook's poses */

/*
 * Every bug in this block was SILENT: a pose computed every frame and thrown
 * away, a reaction played by the wrong cook, a mode no caller ever asked for.
 * Nothing threw and nothing looked broken enough to notice, which is exactly
 * why they need assertions rather than eyes.
 */
test('chefPose answers every mode the game asks it for', function () {
  ['idle', 'walk', 'carry', 'cook', 'cheer', 'sad'].forEach(function (m) {
    var p = Art.chefPose(m, 1.3);
    assert.ok(p && typeof p === 'object', m + ' returned nothing');
    Object.keys(p).forEach(function (k) {
      assert.ok(typeof p[k] === 'number', m + '.' + k + ' is not a number: ' + p[k]);
      assert.ok(isFinite(p[k]), m + '.' + k + ' is not finite');
    });
  });
  assert.strictEqual(Art.chefPose('cheer', 1.3).cheer, 1);
  assert.strictEqual(Art.chefPose('sad', 1.3).droop, 1);
  assert.ok(Art.chefPose('cook', 1.3).work > 0, 'the cook pose does not move the hands');
  assert.ok(Art.chefPose('walk', 1.3).walk !== undefined, 'the walk pose does not walk');
});

test('a reaction is played by the cook who earned it', function () {
  startShift(6);
  S.chef.holding = null;

  // a perfect plate from cook 0
  S.tickets.length = 0;
  MB.spawnTicket();
  var t = S.tickets[0];
  t.items = ['bun', 'patty']; t.side = null; t.drink = null; t.patience = t.max;
  buildPlate(0, ['bun', 'patty']);
  work(MB.plateRect(0));
  work(MB.hatchRect());
  pump(0.1);
  assert.ok(S.chefMood, 'a delivery raised no reaction at all');
  assert.strictEqual(S.chefMood.who, 0, 'cook 0 delivered and cook ' + S.chefMood.who + ' reacted');

  // and the second cook's delivery must not be worn by the first
  MB.arrive({ kind: 'crate', i: 0 }, 1);          // ci = 1 is the guest cook
  assert.strictEqual(S.chefMood.who, 0, 'a crate should not change who is reacting');
  S.levels = {};
});

test('the board sets the cook chopping', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;
  S.chefMood = null;

  work(crateOf(veg));
  work(MB.boardRect());
  assert.ok(S.chefMood, 'putting a vegetable on the board raised no pose');
  assert.strictEqual(S.chefMood.mode, 'cook', 'the cook stood still while the knife worked');
  assert.ok(S.chefMood.until > S.chefMood.at, 'the chopping pose has no duration');
});

test('carrying moves the hands together, it does not freeze them', function () {
  // drawChef used to assign the hands outright inside the carry block, after
  // every other pose had written them - so a carried plate deleted the walk
  // swing, the droop and the chop. Count the marks: a droop and a chop have to
  // change the picture even while something is being carried.
  function marks(opts) {
    var g = makeCtx(), pts = [];
    var real = g.moveTo, real2 = g.lineTo;
    g.moveTo = function (x, y) { pts.push(Math.round(y * 10)); return real && real.apply(g, arguments); };
    g.lineTo = function (x, y) { pts.push(Math.round(y * 10)); return real2 && real2.apply(g, arguments); };
    Art.drawChef(g, 100, 200, 100, opts);
    return pts.join(',');
  }
  var carry = function (gg, cx, baseY, w, h, measure) {
    if (measure) return w * 0.2;
    gg.moveTo(cx, baseY); gg.lineTo(cx + w * 0.2, baseY);
    return w * 0.2;
  };
  var flat = marks({ carry: carry });
  assert.notStrictEqual(marks({ carry: carry, droop: 1 }), flat,
    'a lost order left a cook carrying a plate perfectly level');
  assert.notStrictEqual(marks({ carry: carry, work: 1 }), flat,
    'the chop does not move the hands while carrying');
  assert.notStrictEqual(marks({ carry: carry, walk: 0.25 }), flat,
    'the waddle does not reach the hands while carrying');
});

/* --------------------------------------------------------- the prep board */

test('every vegetable the board can slice is flagged for chopping', function () {
  // Art.VEG_IDS is what art-prep can actually draw a cross-section for. A
  // `chop: true` on anything else would send the player to a board that cannot
  // show them what they are cutting.
  var art = (global.Art && global.Art.VEG_IDS) || [];
  assert.ok(art.length, 'art-prep never registered its vegetables');
  var flagged = Core.INGREDIENTS.filter(function (i) { return i.chop; })
    .map(function (i) { return i.id; }).sort();
  assert.deepStrictEqual(flagged, art.slice().sort(),
    'the pantry and the knife disagree about what gets chopped');
});

test('a whole vegetable is refused by the plate until it has been chopped', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  assert.ok(veg, 'day 6 stocks nothing that needs chopping');

  work(crateOf(veg));
  assert.strictEqual(held().id, veg);
  assert.ok(!held().prepped, 'it came out of the crate already chopped');

  work(MB.plateRect(0));
  assert.strictEqual(plateIds(0).length, 0, 'a whole vegetable landed on the plate');
  assert.ok(held(), 'the cook put it down anyway');
});

test('a vegetable chops into exactly what PREP_PORTIONS says, and no more', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;

  work(crateOf(veg));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg, 'it never went on the board');
  assert.strictEqual(held(), null, 'the cook walked off with it');
  assert.strictEqual(S.board.portions, 0, 'it was chopped before the knife moved');

  for (var i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
  var yielded = S.board.portions;
  assert.ok(yielded >= 1, 'the board never produced anything');

  // every portion comes off prepped, and the board is bare when they run out
  var got = 0;
  while (S.board.portions) {
    work(MB.boardRect());
    assert.ok(held() && held().prepped, 'portion ' + got + ' came off unchopped');
    got++;
    work(MB.plateRect(0));
  }
  assert.strictEqual(got, yielded,
    'the board handed out ' + got + ' portions but only announced ' + yielded);
  assert.strictEqual(S.board.id, null, 'the board was not cleared when it ran out');
  assert.strictEqual(plateIds(0).length, yielded);

  // and it is genuinely empty - no fifth portion hiding in it
  work(MB.boardRect());
  assert.strictEqual(held(), null, 'the bare board handed out one more');
});

test('the knife cannot be interrupted, but a finished board can be swept', function () {
  startShift(8);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; });
  if (veg.length < 2) { S.levels = {}; return; }   // nothing to prove today
  S.chef.holding = null;

  work(crateOf(veg[0]));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg[0], 'setup: the first vegetable should be on');

  // mid-chop the board is busy - otherwise a slow cut is free to reroll
  work(crateOf(veg[1]));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg[0], 'a second vegetable interrupted the knife');
  assert.ok(held(), 'the cook lost the vegetable he was carrying');

  for (var i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
  assert.ok(S.board.portions, 'setup: the board should have finished');

  /*
   * A finished portion is never thrown away to make room for another
   * vegetable. Loading over a ready board used to sweep it, which made sense
   * when a board held four portions and emptying it by hand cost three trips
   * to the bin - it holds ONE now, so a sweep destroys the whole chop, and it
   * did it silently under a player who had just watched the knife finish.
   */
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg[0], 'a ready portion was swept away to make room');
  assert.ok(S.board.portions > 0, 'the portion vanished');
  assert.ok(held() && held().id === veg[1], 'the cook lost what he was carrying');

  // take it first - one tap - and the board comes free
  work(MB.binRect());
  assert.strictEqual(held(), null, 'setup: the bin should have emptied his hands');
  work(MB.boardRect());
  assert.ok(held() && held().prepped, 'the chopped portion did not come off the board');
  assert.strictEqual(S.board.id, null, 'the board should be bare once its portion is taken');

  // ...and now the other vegetable goes on
  work(MB.binRect());
  work(crateOf(veg[1]));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg[1], 'a bare board refused the next vegetable');
});

/*
 * "At the board" has to mean he was SENT there, not that he happens to be
 * near it. The board sits at the top of the plate wall and the crate row runs
 * along the top of the room, so on a 375px phone two crates have a stand point
 * 2px from the board's - a cook fetching cheese was chopping the tomato behind
 * him, and the same held for the fountain.
 */
test('a cook at a crate is not secretly working the board', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 375; stage.clientHeight = 812;
  startShift(8);
  pump(0.3);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  assert.ok(veg, 'setup: day 8 should stock something to chop');

  S.chef.holding = null;
  work(crateOf(veg));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg, 'setup: the vegetable should be on the board');
  pump(0.4);
  assert.ok(S.board.cut > 0, 'setup: standing at the board should chop');

  // find the crate whose stand point is nearest the board's - the one that
  // used to be mistaken for it
  var bp = MB.standPoint({ kind: 'board' }), best = 0, bestD = Infinity;
  for (var i = 0; i < S.menu.length; i++) {
    var cp = MB.standPoint({ kind: 'crate', i: i });
    var d = Math.hypot(cp.x - bp.x, cp.y - bp.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  assert.ok(bestD < 90, 'setup: expected a crate close enough to be confused for the board');

  work(MB.crateRect(best));
  var cut = S.board.cut;
  pump(2.0);
  assert.strictEqual(S.board.cut, cut,
    'the board chopped itself while the cook was ' + bestD.toFixed(0) + 'px away at a crate');
  assert.strictEqual(S.board.working, false, 'and it should know nobody is on it');

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

test('the knife only runs while there is something to cut', function () {
  startShift(6);
  S.chef.holding = null;
  var before = S.board.cut;
  pump(2);
  assert.strictEqual(S.board.cut, before, 'an empty board chopped away at nothing');

  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  work(crateOf(veg));
  work(MB.boardRect());
  pump(1);
  assert.ok(S.board.cut > 0, 'the knife never started');
  for (var i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
  var atRest = S.board.cut;
  pump(2);
  assert.strictEqual(S.board.cut, atRest, 'it kept cutting a vegetable that was done');
});

test('a co-op guest sees the board the host is working', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;
  work(crateOf(veg));
  work(MB.boardRect());
  pump(1);

  var snap = MB.snapshot();
  assert.ok(snap.board, 'the snapshot dropped the board');
  assert.strictEqual(snap.board.id, veg);

  S.board = { id: null, cut: 0, portions: 0, wet: 0, juice: null };
  MB.applySnapshot(snap);
  assert.strictEqual(S.board.id, veg, 'the guest never saw what was on the board');
  assert.ok(S.board.cut > 0, 'the guest saw an uncut vegetable');
  S.role = 'solo'; S.me = 0;
});

test('a chopped portion survives the trip over the wire', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;
  fetchChopped(veg);
  assert.ok(held().prepped);

  var snap = MB.snapshot();
  MB.applySnapshot(snap);
  assert.ok(S.chefs[0].holding && S.chefs[0].holding.prepped,
    'the guest saw a whole vegetable in the cook\'s hands');
  S.role = 'solo'; S.me = 0;
});

/* ------------------------------------------------- the fry line & fountain */

/** Put a basket in, run it to the perfect window, and take it back out. */
/*
 * The fry line starts at the freezer now: a bag comes out of it and goes into
 * a well by hand, the same way a patty comes out of a crate before the grill.
 */
function loadWell(well) {
  S.chef.holding = null;
  work(MB.freezerRect());
  assert.ok(held() && held().kind === 'fryBag', 'the freezer gave out no bag');
  work(MB.fryWellRect(well));
  assert.ok(S.fryer[well], 'the bag never went into the oil');
  assert.strictEqual(held(), null, 'the bag stayed in his hands');
}

function fryPerfect(well) {
  loadWell(well);
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

test('a machine nobody can use yet takes up no room', function () {
  // An empty tap list is still an array, and an array is truthy - so the
  // fountain stood in the room from day one with CLOSED on it, holding column
  // space away from the plates for something no order could ask for.
  startShift(1);
  assert.strictEqual(S.drinkTaps.length, 0, 'day 1 had drinks on tap');
  assert.strictEqual(MB.layout.tapH, 0, 'day 1 gave the fountain column space');
  var platesEarly = MB.layout.plateH;

  startShift(Core.DRINK_DAY);
  assert.ok(S.drinkTaps.length >= 2, 'the fountain never opened');
  assert.ok(MB.layout.tapH > 0, 'the fountain has no height');
  assert.ok(MB.layout.plateH <= platesEarly + 0.01,
    'the plates grew when the fountain moved in');
});

test('a bag out of the freezer goes in the oil, and comes out as fries', function () {
  startShift(8);
  S.chef.holding = null;

  // the well will not start itself any more
  work(MB.fryWellRect(0));
  assert.strictEqual(S.fryer[0], null, 'the well lit itself with no bag in hand');

  loadWell(0);

  S.fryer[0].t = Core.COOK_TIME;
  work(MB.fryWellRect(0));
  assert.strictEqual(S.fryer[0], null, 'the well is still full');
  assert.strictEqual(held().kind, 'fries', 'the cook is not holding fries');
  assert.ok(held().cook > 0.9, 'perfectly timed fries scored ' + held().cook);
});

test('the two wells run independently', function () {
  startShift(8);
  loadWell(0);
  loadWell(1);
  assert.ok(S.fryer[0] && S.fryer[1], 'the second bag did not go in');
  S.fryer[0].t = 5; S.fryer[1].t = 1;
  pump(0.5);
  assert.ok(S.fryer[0].t > S.fryer[1].t, 'the wells share a clock');
});

test('fries left in too long come out burnt', function () {
  startShift(8);
  loadWell(0);
  S.fryer[0].t = Core.COOK_TIME * 3;
  work(MB.fryWellRect(0));
  assert.strictEqual(held().kind, 'fries');
  assert.ok(held().cook < 0.5, 'burnt fries scored ' + held().cook);
});

test('the spout the cook presses is the flavour that comes out', function () {
  startShift(12);
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];
  S.chef.holding = null;
  S.pour = null;

  // the machine centres on what the board wants, so column 0..2 maps to real
  // flavours - press each one and check the cup matches the lever
  var view = MB.dispenserView();
  assert.ok(view.ids.filter(Boolean).length >= 2, 'setup: day 12 should plumb three');
  for (var col = 0; col < 3; col++) {
    if (!view.ids[col]) continue;
    S.chef.holding = null;
    S.pour = null;
    var got = pourCup(col);
    assert.ok(got, 'column ' + col + ' never produced a cup');
    assert.strictEqual(got.kind, 'cup');
    assert.strictEqual(got.flavor, view.ids[col],
      'pressing column ' + col + ' poured ' + got.flavor + ', not ' + view.ids[col]);
  }
});

test('the fountain will not pour a second cup for the same order', function () {
  startShift(8);
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];
  S.chef.holding = null;
  var uid = S.tickets[0].uid;
  pourCup(0);
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
  pourCup(0);
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
  pourCup(0);
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
  var wasted = S.waste, perfect = S.perfect;
  work(MB.plateRect(0));
  work(MB.hatchRect());
  pump(0.1);

  assert.strictEqual(S.waste, wasted, 'a forgotten drink binned the burger');
  assert.strictEqual(S.perfect, perfect, 'a burger with no drink still scored perfect');
  assert.strictEqual(S.served, 1, 'the order was not counted as served');
});

test('a co-op guest gets the fry line and the fountain too', function () {
  startShift(8);
  loadWell(0);
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

/*
 * The slip shows the tray as a SET - the burger with the carton and the cup
 * standing beside it - so a combo reads as one order at a glance rather than
 * as a burger with two extra words under it.
 */
test('the slip draws the whole set, whatever the order asks for', function () {
  var g = makeCtx();
  var combos = [
    { side: null, drink: null },
    { side: null, drink: 'cola' },
    { side: 'fries', drink: null },
    { side: 'fries', drink: 'orange' }
  ];
  combos.forEach(function (c) {
    var t = { items: ['bun', 'patty', 'cheese'], side: c.side, drink: c.drink };
    // the real slip's food box, and a couple of sizes either side of it
    [[59, 21], [24, 9], [180, 64]].forEach(function (box) {
      assert.doesNotThrow(function () {
        MB.drawTraySet(g, t, 4, 4, box[0], box[1]);
      }, 'a ' + (c.side || '-') + '/' + (c.drink || '-') + ' tray threw at ' + box.join('x'));
    });
  });
});

test('the set draws more pieces as the order grows', function () {
  // The stub context records nothing, so count the draw calls instead: a
  // combo has to put strictly more ink down than a bare burger, or the set is
  // not actually being composed.
  function marks(t) {
    var n = 0;
    var g = makeCtx();
    ['fill', 'stroke', 'fillText'].forEach(function (m) {
      var real = g[m];
      g[m] = function () { n++; return real && real.apply(g, arguments); };
    });
    MB.drawTraySet(g, t, 0, 0, 59, 21);
    return n;
  }
  var base = { items: ['bun', 'patty'], side: null, drink: null };
  var withCup = { items: ['bun', 'patty'], side: null, drink: 'cola' };
  var withBoth = { items: ['bun', 'patty'], side: 'fries', drink: 'cola' };

  var a = marks(base), b = marks(withCup), c = marks(withBoth);
  assert.ok(b > a, 'adding a drink drew nothing extra (' + a + ' -> ' + b + ')');
  assert.ok(c > b, 'adding fries drew nothing extra (' + b + ' -> ' + c + ')');
});

test('an unknown side or drink draws nothing, and never throws', function () {
  function marks(t) {
    var n = 0;
    var g = makeCtx();
    ['fill', 'stroke', 'fillText'].forEach(function (m) {
      var real = g[m];
      g[m] = function () { n++; return real && real.apply(g, arguments); };
    });
    MB.drawTraySet(g, t, 0, 0, 59, 21);
    return n;
  }
  var bare = { items: ['bun', 'patty'], side: null, drink: null };
  var junk = { items: ['bun', 'patty'], side: 'x', drink: 'milkshake' };
  assert.doesNotThrow(function () { marks(junk); },
    'an id this build has never heard of threw inside the board paint');
  // the picture must agree with the words, and orderRows names neither of these
  assert.strictEqual(marks(junk), marks(bare),
    'an unnamed side or drink was still drawn on the slip');
});

/*
 * The slip names the fillings and nothing else.
 *
 * drawTraySet already draws the carton and the cup beside the burger, in
 * their own colours; the list underneath used to write FRIES and COLA again,
 * so two of the five lines on a busy slip were captioning a picture.
 */
test('the slip names the fillings, and leaves the tray to the picture', function () {
  var names = MB.orderRows(['bun', 'patty', 'cheese'], 'fries', 'cola')
    .map(function (r) { return r.n; });
  assert.deepStrictEqual(names, ['Cheese'],
    'the slip is still captioning the tray: ' + names.join(','));

  // a burger with nothing on it is PLAIN, tray or no tray
  assert.strictEqual(MB.orderRows(['bun', 'patty'], null, null)[0].n, 'PLAIN');
  assert.strictEqual(MB.orderRows(['bun', 'patty'], 'fries', 'cola')[0].n, 'PLAIN',
    'a plain burger stopped being plain because a drink came with it');

  // every row still carries the swatch the chip beside it is drawn in
  MB.orderRows(['bun', 'patty', 'cheese', 'lettuce'], 'fries', 'cola')
    .forEach(function (r) { assert.ok(r.c && r.n, 'a row is missing its swatch or label'); });
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

/*
 * The clock's class is not cosmetic: `no-clock` is what hands #stage its share
 * of the column, so the room is a different size on the title screen than it is
 * during a shift. Measure it in the wrong one and the player watches the
 * kitchen resize itself a moment after day one begins.
 */
test('day one is measured against the shift height, never the title screen height', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  stage.clientWidth = 412; stage.clientHeight = 700;

  // start from the title, the way a player does
  document.body.classList.add('no-clock');

  var reads = 0, staleReads = 0, real = stage.clientHeight;
  Object.defineProperty(stage, 'clientHeight', {
    configurable: true,
    get: function () {
      reads++;
      if (document.body.classList.contains('no-clock')) staleReads++;
      return real;
    }
  });
  try { MB.startDay(1); } finally {
    delete stage.clientHeight;
    stage.clientHeight = real;
  }

  assert.ok(reads > 0, 'setup: opening a day should measure the room at least once');
  assert.strictEqual(staleReads, 0,
    'the room was measured ' + staleReads + ' time(s) while the sheet still said ' +
    'title - that is the shrink the player sees a beat later');

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.4);
});

test('whoever changes the kitchen height re-measures it in the same beat', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  startShift(3);
  pump(0.4);

  // a height nothing has told the game about yet
  stage.clientWidth = 412; stage.clientHeight = 640;
  var stale = stage.height;

  // closing the shift flips `no-clock` back on, which is what moves the budget
  S.screen = 'dayEnd';
  MB.syncHud();
  assert.notStrictEqual(stage.height, stale,
    'the canvas kept its old size after the column was re-divided - the watchdog ' +
    'would only catch this 120ms later, in front of the player');

  // and a sync that changes nothing must not thrash the layout
  var settled = stage.height;
  MB.syncHud();
  assert.strictEqual(stage.height, settled, 'a no-op sync should not re-lay the room out');

  stage.clientWidth = w0; stage.clientHeight = h0;
  S.screen = 'service';
  pump(0.4);
});

/* ---------------------------------------------------------------- the board */

test('the blade is fastest where it lands and hangs at the top', function () {
  var f = MB.chopCurve;
  assert.strictEqual(f(0), 1, 'phase 0 is the edge in the wood');
  assert.strictEqual(f(0.05), 1, 'it should sit in the wood for a beat');
  assert.strictEqual(f(0.70), 0, 'and hang at the top of the arc');

  // speed at the moment of contact must beat speed anywhere else in the fall
  function v(p) { return Math.abs(f(p + 1e-5) - f(p - 1e-5)) / 2e-5; }
  var atContact = v(0.999), midFall = v(0.87);
  assert.ok(atContact > midFall * 2,
    'a chop accelerates into the board; got ' + atContact.toFixed(1) +
    ' at contact vs ' + midFall.toFixed(1) + ' mid-fall');

  // and it must not teleport at the apex, which the old sawtooth did
  assert.ok(v(0.65) < 3 && v(0.77) < 3,
    'the apex should be a turn, not a jump');

  // continuous across the wrap
  assert.ok(Math.abs(f(0.9999) - f(0)) < 0.01, 'the cycle should close on itself');
});

test('a board that is running out looks like it', function () {
  startShift(6);
  pump(0.2);
  var seen = [];
  var prep = Art.scene.prep;
  Art.scene.prep = function (c, x, y, w, h, o) { seen.push(o); };
  try {
    S.board = { id: 'lettuce', cut: 1, portions: 4, wet: 0, juice: '#93d33d' };
    MB.drawPrepBoard(); var four = seen.pop();
    S.board.portions = 1;
    MB.drawPrepBoard(); var one = seen.pop();
    assert.ok(four && one, 'setup: the board should have drawn twice');
    assert.ok(four.left > one.left,
      'the pile must shrink as portions are taken; got ' + four.left + ' vs ' + one.left);
  } finally { Art.scene.prep = prep; }
});

test('taking a portion says how many are left', function () {
  startShift(6);
  pump(0.2);
  S.board = { id: 'lettuce', cut: 1, portions: 3, wet: 0, juice: '#93d33d' };
  var me = MB.chefAt(0);
  me.holding = null;
  S.floats.length = 0;
  MB.arrive({ kind: 'board' }, 0);
  assert.strictEqual(S.board.portions, 2, 'one portion should have come off');
  assert.ok(S.floats.some(function (f) { return /2 LEFT/.test(f.text); }),
    'the count should be shown, got ' + JSON.stringify(S.floats.map(function (f) { return f.text; })));

  // and the last one reads as empty rather than "0 LEFT"
  S.board.portions = 1;
  MB.chefAt(0).holding = null;
  S.floats.length = 0;
  MB.arrive({ kind: 'board' }, 0);
  assert.ok(S.floats.some(function (f) { return /BOARD CLEAR/.test(f.text); }),
    'draining the board should say so');
});

test('the board waits for the vegetable to land before drawing it', function () {
  startShift(6);
  pump(0.2);
  var prepCalls = 0, bareCalls = 0;
  var prep = Art.scene.prep, board = Art.scene.board;
  Art.scene.prep = function () { prepCalls++; };
  Art.scene.board = function () { bareCalls++; return { x0: 0, w: 10, h: 10, baseY: 10 }; };
  try {
    S.board = { id: 'lettuce', cut: 0, portions: 0, wet: 0, juice: '#93d33d' };
    S.flyers.push({ to: { kind: 'board', i: 0 }, id: 'lettuce', t: 0 });
    MB.drawPrepBoard();
    assert.strictEqual(prepCalls, 0, 'the vegetable is still in the air - draw the bare slab');
    assert.ok(bareCalls > 0, 'the slab should still be there');
    S.flyers.length = 0;
    MB.drawPrepBoard();
    assert.strictEqual(prepCalls, 1, 'once it lands, the board draws what it holds');
  } finally { Art.scene.prep = prep; Art.scene.board = board; }
});

/*
 * The board is a wall fitting on the plate side, above the plate stack. It
 * spent a while as an island in open floor and was wrong in every way that
 * mattered - the cook walked through the tabletop, his own body covered the
 * vegetable he was chopping, and it ate the middle of the room.
 */
test('the board is a wall fitting, not an island in the walking lane', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 700], [412, 915], [820, 600], [360, 640]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    startShift(6);
    pump(0.4);
    var where = sz.join('x') + ': ';
    var b = MB.boardRect(), L = MB.layout;
    assert.ok(b.w > 0, where + 'setup: day 6 should have a board');

    // out of the floor entirely - nothing to walk through
    var overlapsFloor = b.x + b.w > L.floor.x0 + 1 && b.x < L.floor.x1 - 1;
    assert.ok(!overlapsFloor, where + 'the board is standing in the walking lane: ' +
      b.x.toFixed(0) + '..' + (b.x + b.w).toFixed(0) +
      ' against floor ' + L.floor.x0.toFixed(0) + '..' + L.floor.x1.toFixed(0));

    // below the crate shelf, above the plates, touching neither
    assert.ok(b.y > L.cratesBottom, where + 'the board climbed into the crate shelf');
    assert.ok(b.y + b.h <= L.plateTop + 0.5,
      where + 'the board runs into the plate stack: ends ' + (b.y + b.h).toFixed(0) +
      ' vs plates at ' + L.plateTop.toFixed(0));

    // still a real tap target, and the vegetable on it still has room to draw
    assert.ok(b.w >= 22 && b.h >= 22,
      where + 'the board shrank below a tappable size: ' + b.w.toFixed(0) + 'x' + b.h.toFixed(0));

    // the cook stands on the floor beside it, the way he does at the plates,
    // rather than in front of the one thing this station exists to show
    var p = MB.standPoint({ kind: 'board' });
    assert.ok(p.x >= L.floor.x0 - 1 && p.x <= L.floor.x1 + 1 &&
              p.y >= L.floor.y0 - 1 && p.y <= L.floor.y1 + 1,
      where + 'the stand point is off the floor');
    assert.ok(p.x >= b.x + b.w - 1 || p.x <= b.x + 1,
      where + 'the cook stands on top of the board');

    // and fetching an ingredient must not park his feet inside it
    for (var ci = 0; ci < S.menu.length; ci++) {
      var cp = MB.standPoint({ kind: 'crate', i: ci });
      assert.ok(!(cp.x > b.x && cp.x < b.x + b.w && cp.y > b.y && cp.y < b.y + b.h),
        where + 'crate ' + ci + ' stands the cook inside the board');
    }
  });

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.4);
});

test('a whole vegetable in the hands does not look like a chopped one', function () {
  startShift(6);
  pump(0.2);
  var whole = 0, layer = 0;
  var vw = Art.item.vegWhole, dl = Art.drawLayer;
  Art.item.vegWhole = function () { whole++; };
  Art.drawLayer = function () { layer++; };
  try {
    var me = MB.chefAt(0);
    me.holding = { kind: 'ing', id: 'lettuce', done: 0, char: 0 };
    MB.drawCarried(makeCtx(), 100, 100, 40, 12, me.holding, false);
    assert.strictEqual(whole, 1, 'straight out of the crate it is a whole head');
    assert.strictEqual(layer, 0, 'and not the burger layer it becomes');

    whole = 0; layer = 0;
    me.holding = { kind: 'ing', id: 'lettuce', done: 0, char: 0, prepped: true };
    MB.drawCarried(makeCtx(), 100, 100, 40, 12, me.holding, false);
    assert.strictEqual(layer, 1, 'once chopped it is the topping');
    assert.strictEqual(whole, 0, 'and no longer a whole head');
  } finally { Art.item.vegWhole = vw; Art.drawLayer = dl; }
});

test('everything a cook can carry survives the wire', function () {
  var cases = [
    { kind: 'ing', id: 'lettuce', cook: undefined, done: 0, char: 0, prepped: true },
    { kind: 'ing', id: 'patty', cook: 0.8, done: 0.5, char: 0.1, grillT: 3 },
    { kind: 'fries', cook: 0.9, done: 0.6, char: 0 },
    { kind: 'cup', flavor: 'cola' },
    { kind: 'plate', stack: [{ id: 'bun', cook: 1 }], side: 'fries', sideCook: 0.7, drink: 'cider' }
  ];
  cases.forEach(function (h) {
    var back = MB.unpackHold(MB.packHold(h));
    assert.strictEqual(back.kind, h.kind, h.kind + ' came back as ' + back.kind);
    Object.keys(h).forEach(function (k) {
      if (h[k] === undefined) return;
      assert.deepStrictEqual(back[k], h[k],
        h.kind + '.' + k + ' was lost: ' + JSON.stringify(back));
    });
  });
  assert.strictEqual(MB.packHold(null), null, 'empty hands stay empty');
});

test('a state packet that arrives late is ignored', function () {
  startShift(6);
  pump(0.3);
  var a = MB.snapshot();
  var b = MB.snapshot();
  assert.ok(b.seq > a.seq, 'setup: each packet should carry a fresh number');

  S.role = 'guest';
  MB.applySnapshot(b);
  var afterNew = S.sales;
  // the older packet overtakes it - and must not roll the kitchen back
  a.sales = afterNew + 999;
  MB.applySnapshot(a);
  assert.strictEqual(S.sales, afterNew, 'a stale packet overwrote newer state');
  S.role = 'host';
});

test('the shift plays the recording, and is never left silent without one', function () {
  var B = global.Bgm;
  var played = 0, paused = 0, onError = null, built = null;

  var realAudio = global.Audio;
  global.Audio = function (src) {
    built = src;
    this.loop = false; this.preload = ''; this.volume = 1;
    this.play = function () { played++; return { 'catch': function () {} }; };
    this.pause = function () { paused++; };
    this.addEventListener = function (t, fn) { if (t === 'error') onError = fn; };
  };
  var was = { el: B.el, gain: B.gain, fallback: B.fallback, playing: B.playing };
  B.el = null; B.gain = null; B.fallback = false; B.playing = false;

  try {
    B.start();
    assert.ok(/\.mp3$/.test(built || ''), 'it should reach for the recording, got ' + built);
    assert.strictEqual(B.el.loop, true, 'a backing track that stops after one pass is not one');
    assert.strictEqual(played, 1, 'it never actually started');
    assert.ok(B.playing, 'and it should know it is playing');

    // level rides the pressure rather than the arrangement
    B.setIntensity(0);
    var quiet = B.el.volume;
    B.setIntensity(1);
    assert.ok(B.el.volume > quiet, 'a full board should not be quieter than an empty one');

    B.stop();
    assert.strictEqual(paused, 1, 'stopping the music left it running');
    assert.ok(!B.playing);

    // a file that will not decode must hand the shift back to the synth
    B.start();
    onError();
    assert.ok(B.fallback, 'a broken recording should fall back');
    assert.strictEqual(B.el, null, 'and let go of the element');
    B.stop();
    B.start();
    assert.ok(!B.el, 'once it has fallen back it should stop retrying the file');
  } finally {
    if (realAudio === undefined) delete global.Audio; else global.Audio = realAudio;
    B.stop();
    B.el = was.el; B.gain = was.gain; B.fallback = was.fallback; B.playing = was.playing;
  }
});

test('restarting the day leaves the music playing, from the top', function () {
  var B = global.Bgm;
  var realAudio = global.Audio;
  var tape = [];
  global.Audio = function () {
    var el = this;
    this.loop = false; this.preload = ''; this.volume = 1;
    this._t = 0;
    Object.defineProperty(this, 'currentTime', {
      get: function () { return el._t; },
      set: function (v) { el._t = v; tape.push('seek' + v); }
    });
    this.play = function () { tape.push('play'); return { 'catch': function () {} }; };
    this.pause = function () { tape.push('pause'); };
    this.addEventListener = function () {};
  };
  var was = { el: B.el, gain: B.gain, fallback: B.fallback, playing: B.playing };
  B.el = null; B.gain = null; B.fallback = false; B.playing = false;

  try {
    startShift(4);
    B.stop(); B.playing = false;
    B.start();
    B.el._t = 33.7;
    tape.length = 0;

    // the pause sheet, then RESTART THE DAY
    MB.setPaused(true);
    MB.setPaused(false);
    MB.startDay(S.day);

    assert.ok(B.playing, 'restarting the day left the track stopped');
    assert.strictEqual(B.el._t, 0, 'it carried on from ' + B.el._t + 's instead of the top');
    /*
     * The order is the whole bug: setPaused(false) starts the track, startDay
     * rewinds it, and a seek issued while play() is still resolving aborts it.
     * Whatever the order, the last thing that happens has to be a play().
     */
    var last = tape.filter(function (e) { return e === 'play' || /^seek/.test(e); }).pop();
    assert.strictEqual(last, 'play',
      'the last thing done to the element was ' + last + ' - a seek after play() ' +
      'kills it, and the music comes back only on the next tap. Tape: ' + tape.join(','));
  } finally {
    if (realAudio === undefined) delete global.Audio; else global.Audio = realAudio;
    B.stop();
    B.el = was.el; B.gain = was.gain; B.fallback = was.fallback; B.playing = was.playing;
  }
});

test('a new day opens on the first bar, a pause picks up where it stopped', function () {
  var B = global.Bgm;
  var realAudio = global.Audio;
  global.Audio = function () {
    this.loop = false; this.preload = ''; this.volume = 1; this.currentTime = 0;
    this.play = function () { return { 'catch': function () {} }; };
    this.pause = function () {};
    this.addEventListener = function () {};
  };
  var was = { el: B.el, gain: B.gain, fallback: B.fallback, playing: B.playing };
  B.el = null; B.gain = null; B.fallback = false; B.playing = false;

  try {
    B.start();
    B.el.currentTime = 41.5;            // partway through the loop

    // pausing and coming back is the same shift
    MB.setPaused(true);
    MB.setPaused(false);
    assert.strictEqual(B.el.currentTime, 41.5,
      'a pause restarted the music; it should pick up where it stopped');

    // ...and so is the tab going away and coming back
    B.stop(); B.start();
    assert.strictEqual(B.el.currentTime, 41.5, 'a plain stop/start should not rewind');

    // opening a new day is not
    MB.startDay(3);
    assert.strictEqual(B.el.currentTime, 0,
      'RESTART THE DAY carried on from the middle of the track');
  } finally {
    if (realAudio === undefined) delete global.Audio; else global.Audio = realAudio;
    B.stop();
    B.el = was.el; B.gain = was.gain; B.fallback = was.fallback; B.playing = was.playing;
  }
});

test('the board only chops while a cook is standing at it', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;
  work(crateOf(veg));
  work(MB.boardRect());
  assert.strictEqual(S.board.id, veg, 'setup: the vegetable should be on the board');

  pump(0.5);
  var withHim = S.board.cut;
  assert.ok(withHim > 0, 'the knife never started while he was standing there');
  assert.strictEqual(S.board.working, true, 'it should know he is on it');

  // send him across the kitchen before it can finish
  MB.sendChef({ kind: 'grill', i: 0 }, 0);
  pump(1.2);
  var away = S.board.cut;
  assert.ok(away < 1, 'setup: it should not have had time to finish');
  pump(2.0);
  assert.strictEqual(S.board.cut, away,
    'the board chopped itself with nobody there: ' + away + ' -> ' + S.board.cut);
  assert.strictEqual(S.board.working, false, 'and it should know it is stalled');
  assert.ok(!S.board.portions, 'it even finished the job unattended');

  // and it picks up where it stopped when he comes back
  work(MB.boardRect());
  pump(0.4);
  assert.ok(S.board.cut > away, 'it did not start again when he came back');
});

test('holding the chopping pose does not restart it every frame', function () {
  startShift(6);
  var veg = S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
  S.chef.holding = null;
  work(crateOf(veg));
  work(MB.boardRect());
  pump(0.2);
  var m = S.chefMood;
  assert.ok(m && m.mode === 'cook', 'setup: he should be chopping');
  var at = m.at, until = m.until;

  pump(0.5);
  assert.strictEqual(S.chefMood.at, at,
    'the pose was restarted, which pins him to the first frame of the swing');
  assert.ok(S.chefMood.until > until, 'the pose was not held while he kept working');
});

/*
 * Everything the cook can pick up, measured and drawn.
 *
 * drawChef asks for a half-width BEFORE it puts the arms down, then paints the
 * object last so the hands sit on top of it. If the two passes disagree the
 * arms close on air beside whatever is being carried - which is exactly what a
 * new carry shape (the tray) is most likely to break.
 */
var CARRIES = [
  { kind: 'ing', id: 'cheese', done: 0, char: 0 },
  { kind: 'ing', id: 'bun', done: 0, char: 0 },
  { kind: 'ing', id: 'patty', cook: 1, done: 1, char: 0 },
  { kind: 'ing', id: 'lettuce', done: 0, char: 0 },
  { kind: 'ing', id: 'lettuce', done: 0, char: 0, prepped: true },
  { kind: 'fries', cook: 1, done: 0.8, char: 0 },
  { kind: 'cup', flavor: 'cola' },
  { kind: 'plate', stack: [{ id: 'bun', cook: 1 }, { id: 'patty', cook: 1 }] },
  { kind: 'plate', stack: [{ id: 'bun', cook: 1 }], drink: 'cola' },
  { kind: 'plate', stack: [{ id: 'bun', cook: 1 }], side: 'fries', sideCook: 0.8 },
  { kind: 'plate', stack: [], drink: 'cider' },
  { kind: 'plate', stack: [{ id: 'bun', cook: 1 }, { id: 'patty', cook: 1 }],
    side: 'fries', sideCook: 0.8, drink: 'cola' }
];
function carryName(h, i) { return '#' + i + ' ' + (h.id || h.kind) +
  (h.side ? '+fries' : '') + (h.drink ? '+drink' : ''); }

test('the hands close on what is actually drawn, whatever the cook carries', function () {
  startShift(8);
  [[54, 0.72, 0.205], [96, 0.72, 0.205]].forEach(function (sz) {
    var maxW = sz[0] * sz[1], maxH = sz[0] * sz[2];
    CARRIES.forEach(function (h, i) {
      var g = makeCtx();
      var measured = MB.drawCarried(g, 100, 100, maxW, maxH, h, true);
      var drawn = MB.drawCarried(g, 100, 100, maxW, maxH, h, false);
      var at = 's' + sz[0] + ' ' + carryName(h, i) + ': ';
      assert.ok(isFinite(measured) && measured > 0, at + 'measured ' + measured);
      assert.strictEqual(measured, drawn,
        at + 'the hands close at ' + measured + ' but it drew at ' + drawn);
      assert.ok(measured <= maxW / 2 + 0.01,
        at + 'wider than the carry box, ' + measured.toFixed(1) + ' vs ' + (maxW / 2).toFixed(1));
    });
  });
});

test('nothing the cook carries leaks a save() into the rest of the frame', function () {
  startShift(8);
  CARRIES.forEach(function (h, i) {
    var depth = 0, worst = 0;
    var g = makeCtx();
    g.save = function () { depth++; };
    g.restore = function () { depth--; if (depth < worst) worst = depth; };
    MB.drawCarried(g, 100, 100, 54 * 0.72, 54 * 0.205, h, false);
    assert.strictEqual(depth, 0,
      carryName(h, i) + ' left the context ' + depth + ' save(s) deep - everything ' +
      'drawn after it inherits the shadow and the clip');
    assert.strictEqual(worst, 0, carryName(h, i) + ' restored more than it saved');
  });
});

test('a set is drawn as a set, on the bench and in the hands', function () {
  startShift(8);
  function pieces(fn) {
    var seen = { tray: 0, fries: 0, cup: 0 };
    var t = Art.item.tray, f = Art.item.friesBox, c = Art.item.cup;
    Art.item.tray = function () { seen.tray++; };
    Art.item.friesBox = function () { seen.fries++; };
    Art.item.cup = function () { seen.cup++; };
    try { fn(); } finally { Art.item.tray = t; Art.item.friesBox = f; Art.item.cup = c; }
    return seen;
  }

  // in the hands
  var full = { kind: 'plate', stack: [{ id: 'bun', cook: 1 }], side: 'fries', drink: 'cola' };
  var got = pieces(function () {
    MB.drawCarried(makeCtx(), 100, 100, 40, 12, full, false);
  });
  assert.deepStrictEqual(got, { tray: 1, fries: 1, cup: 1 },
    'a carried combo drew ' + JSON.stringify(got));

  // ...and a plain plate is still a plain plate
  var bare = pieces(function () {
    MB.drawCarried(makeCtx(), 100, 100, 40, 12,
      { kind: 'plate', stack: [{ id: 'bun', cook: 1 }] }, false);
  });
  assert.deepStrictEqual(bare, { tray: 0, fries: 0, cup: 0 },
    'a plain plate grew a tray: ' + JSON.stringify(bare));

  // on the bench, while it is still being built
  S.plates[0].stack = [{ id: 'bun', cook: 1 }];
  S.plates[0].side = null;
  S.plates[0].drink = 'cola';
  var bench = pieces(function () { MB.drawPlates(); });
  assert.strictEqual(bench.tray, 1, 'the bench never put the set on a tray');
  assert.strictEqual(bench.cup, 1, 'the drink on the plate was invisible on the bench');
  assert.strictEqual(bench.fries, 0, 'it drew fries nobody ordered');
});

/* --------------------------------------------- the board and your cook */

var SCREEN_SIZES = [[360, 720], [412, 915], [820, 600], [320, 568]];

test('the board and the cook screen draw at every size, in every state', function () {
  var A = global.Art;
  var rows = [
    { rank: 1, name: 'Joowon', day: 8, money: '$378.13', named: true },
    { rank: 2, name: 'Cook', day: 5, money: '$317.90', named: false },
    { rank: 3, name: 'Cook', day: 5, money: '$9,999.99', named: false }
  ];
  var states = [
    ['board', { rows: rows, me: 2 }],
    ['board', { rows: rows, me: null, mine: { rank: 12, name: 'Joowon', day: 3, money: '$88.20', named: true }, more: 8 }],
    ['board', { rows: [], note: 'YOU ARE OFFLINE' }],
    ['cook', { name: 'Joowon', typed: '' }],
    ['cook', { name: 'Joowon', typed: 'K4M', note: 'Saving…' }],
    ['cook', { name: 'A Very Long Cook Name Indeed', code: 'K4M9P', left: '9:41 LEFT', typed: 'K4M9P' }]
  ];

  SCREEN_SIZES.forEach(function (sz) {
    states.forEach(function (st, i) {
      var depth = 0, worst = 0;
      var g = makeCtx();
      g.save = function () { depth++; };
      g.restore = function () { depth--; if (depth < worst) worst = depth; };
      A.ui[st[0]](g, 0, 0, sz[0], sz[1], st[1]);
      var at = sz.join('x') + ' ' + st[0] + '#' + i + ': ';
      assert.strictEqual(depth, 0, at + 'left the context ' + depth + ' save(s) deep');
      assert.strictEqual(worst, 0, at + 'restored more than it saved');
    });
  });
});

test('every control on the two drawn screens sits on the sheet and can be hit', function () {
  var A = global.Art;
  SCREEN_SIZES.forEach(function (sz) {
    var W = sz[0], H = sz[1];
    [['board', A.ui.boardBoxes(0, 0, W, H), ['back']],
     ['cook', A.ui.cookBoxes(0, 0, W, H, false), ['name', 'save', 'getCode', 'codeIn', 'load', 'back']],
     ['cook+code', A.ui.cookBoxes(0, 0, W, H, true), ['name', 'save', 'codeIn', 'load', 'back']]
    ].forEach(function (set) {
      var B = set[1];
      set[2].forEach(function (k) {
        var r = B[k], at = sz.join('x') + ' ' + set[0] + '.' + k + ': ';
        assert.ok(r && isFinite(r.x) && isFinite(r.y) && r.w > 0 && r.h > 0,
          at + 'is not a box: ' + JSON.stringify(r));
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01,
          at + 'runs off the screen: ' + JSON.stringify(r));
        assert.ok(r.y >= B.sheet.py - 0.01 && r.y + r.h <= B.sheet.py + B.sheet.ph + 0.01,
          at + 'is off the sheet it is drawn on');
      });
      // nothing may sit on top of anything else
      for (var a = 0; a < set[2].length; a++) {
        for (var b = a + 1; b < set[2].length; b++) {
          var p = B[set[2][a]], q = B[set[2][b]];
          assert.ok(!(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h),
            sz.join('x') + ' ' + set[0] + ': ' + set[2][a] + ' and ' + set[2][b] + ' overlap');
        }
      }
    });
  });
});

test('the board maps what the worker sends, wherever the player sits in it', function () {
  function top(meAt) {
    var out = [];
    for (var i = 1; i <= 20; i++) {
      out.push({ rank: i, name: i === meAt ? 'Joowon' : 'Cook',
                 day: 21 - i, earned: i * 100, me: i === meAt });
    }
    return out;
  }

  // the player is inside the visible run
  var near = MB.lbMap(top(3), null);
  assert.strictEqual(near.rows.length, 8, 'the sheet holds eight rows, got ' + near.rows.length);
  assert.strictEqual(near.me, 3, 'the player should be marked in the run');
  assert.strictEqual(near.mine, null, 'and must not also be repeated below it');
  assert.strictEqual(near.rows[0].named, false, '"Cook" is the unnamed default');
  assert.strictEqual(near.rows[2].named, true, 'a named cook should be inked as one');
  assert.strictEqual(near.rows[0].money, Core.money(100), 'money is not formatted');

  // ...and below it, where they get their own row under a gap
  var far = MB.lbMap(top(14), null);
  assert.strictEqual(far.me, null, 'rank 14 is not in the visible eight');
  assert.ok(far.mine && far.mine.rank === 14, 'a player below the run should still get a row');
  assert.strictEqual(far.more, 5, 'ranks 9..13 are the five between, got ' + far.more);

  // ...or reported separately by the worker
  var sep = MB.lbMap(top(0), { rank: 31, name: 'Joowon', day: 2, earned: 400 });
  assert.ok(sep.mine && sep.mine.rank === 31, 'the worker\'s own row was dropped');
  assert.strictEqual(sep.more, 22, 'got ' + sep.more + ' cooks in the gap');

  // an empty board says so rather than drawing nothing
  var none = MB.lbMap([], null);
  assert.strictEqual(none.rows.length, 0);
  assert.ok(/NOBODY/.test(none.note), 'an empty board should say it is empty');
});

/* ---------------------------------------- the freezer and the fountain */

test('the fountain always points at the drink the board is waiting for', function () {
  [3, 5, 8, 12, 16, 20, 25].forEach(function (day) {
    startShift(day);
    pump(0.3);
    var taps = S.drinkTaps || [];
    if (!taps.length) {
      assert.deepStrictEqual(MB.dispenserView().ids, [], 'day ' + day + ' has no taps to show');
      return;
    }
    // drive every plumbed flavour through the front of the board in turn
    taps.forEach(function (id) {
      S.tickets = [{ drink: id, items: ['bun'], side: null, t: {}, done: false }];
      var v = MB.dispenserView();
      var at = 'day ' + day + ' wanting ' + id + ': ';
      assert.strictEqual(v.ids.length, 3, at + 'the machine is three columns wide');
      assert.ok(v.active >= 0 && v.active <= 2, at + 'active is off the machine: ' + v.active);
      assert.strictEqual(v.ids[v.active], id,
        at + 'the lever it pulls is ' + v.ids[v.active] + ', not what was ordered');
      // an unplumbed column is allowed, but never the one being poured
      assert.ok(v.ids[v.active], at + 'it is pouring from a spout with nothing behind it');
    });
    S.tickets = [];
  });
});

test('taking a basket opens the freezer, and it shuts itself again', function () {
  startShift(8);
  pump(0.3);
  assert.ok(S.fryer.length, 'setup: day 8 should have a fry line');

  var cold = MB.freezerPose();
  assert.strictEqual(cold.open, 0, 'the freezer starts shut');
  assert.strictEqual(cold.grab, 0, 'and with nothing in the air');

  loadWell(0);
  assert.ok(S.fryer[0], 'setup: the bag should be in the oil');

  assert.ok(S.fryGrab, 'the freezer was never told a bag came out');

  // the pose is an envelope, so it is zero at the instant it starts
  pump(0.4);
  var open = MB.freezerPose();
  assert.ok(open.open > 0, 'the lid never moved when the bag came out');
  assert.ok(open.grab > 0, 'no bag came up out of the well');

  // it is an envelope, not a latch: everything settles
  var was = S.fryGrab;
  S.fryGrab = was - 4000;
  var shut = MB.freezerPose();
  assert.strictEqual(shut.open, 0, 'the freezer was left standing open');
  assert.strictEqual(shut.grab, 0, 'a bag was left hanging in the air');
  S.fryGrab = was;
});

/*
 * The grill wall reads top to bottom in the order the food moves: freezer,
 * fryer, burners. The freezer is pinned to the top-left corner of the room -
 * it used to be drawn inside the fry box's own top third, which made it a
 * decoration on another machine rather than a place you go.
 */
test('the grill wall runs freezer, fryer, then burners, top to bottom', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 812], [412, 915], [820, 600], [412, 430], [360, 640]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    startShift(8);
    pump(0.3);
    var r = MB.fryerRect(), fz = MB.freezerRect(), L2 = MB.layout;
    var at = sz.join('x') + ': ';
    assert.ok(r.h > 0 && fz.h > 0, at + 'setup: day 8 should have a fry line');

    // top-left corner, on the grill wall, above the fryer
    assert.strictEqual(fz.x, L2.grillX, at + 'the freezer left the grill wall');
    assert.ok(fz.x < L2.W / 2, at + 'the grill wall is not on the left');
    assert.ok(fz.y >= L2.cratesBottom, at + 'the freezer climbed into the crate shelf');
    assert.ok(fz.y + fz.h <= r.y + 0.01,
      at + 'the freezer overlaps the fryer: ends ' + (fz.y + fz.h).toFixed(0) +
      ' vs fryer at ' + r.y.toFixed(0));

    // the burners are under the fryer, at the bottom of the band
    var g0 = MB.slotRect(0), gN = S.grill.length;
    var gLast = MB.slotRect(gN - 1);
    assert.ok(g0.y >= r.y + r.h - 0.01,
      at + 'the burners climbed into the fryer: ' + g0.y.toFixed(0) + ' vs ' + (r.y + r.h).toFixed(0));
    assert.ok(gLast.y + gLast.h <= L2.midBottom + 0.01, at + 'the burners run past the band');

    for (var i = 0; i < S.fryer.length; i++) {
      var wr = MB.fryWellRect(i);
      assert.ok(wr.y >= r.y - 0.01 && wr.y + wr.h <= r.y + r.h + 0.01,
        at + 'well ' + i + ' hangs out of the fry box');
    }
    // and drawing the whole station throws at none of these sizes
    var g = makeCtx();
    var depth = 0;
    g.save = function () { depth++; };
    g.restore = function () { depth--; };
    assert.doesNotThrow(function () { MB.drawFryStation(); }, at + 'the fry station threw');
    assert.doesNotThrow(function () { MB.drawFountain(); }, at + 'the fountain threw');
  });
  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

test('a drink parked on a plate does not lock the burger out of it', function () {
  startShift(12);
  S.chef.holding = null;
  S.pour = null;
  S.plates.forEach(function (p) { p.stack = []; p.side = null; p.drink = null; });
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];

  // the cider goes down first, on its own
  pourCup(0);
  work(MB.plateRect(0));
  assert.ok(S.plates[0].drink, 'setup: the drink should be on plate 0');
  assert.strictEqual(S.plates[0].stack.length, 0, 'setup: and nothing else');

  // the burger is built on the other plate and carried over
  work(crateOf('bun'));
  work(MB.plateRect(1));
  assert.strictEqual(S.plates[1].stack.length, 1, 'setup: the bun should be on plate 1');
  work(MB.plateRect(1));
  assert.strictEqual(held() && held().kind, 'plate', 'setup: the tray should be in hand');

  work(MB.plateRect(0));
  assert.strictEqual(held(), null,
    'the tray came back - a drink on a plate blocked the burger joining it');
  assert.strictEqual(S.plates[0].stack.length, 1, 'the burger never landed');
  assert.strictEqual(S.plates[0].drink, S.drinkTaps[0], 'the drink was lost in the merge');

  // ...but two trays that want the same slot still refuse
  S.plates[1].stack = [{ id: 'bun', cook: 1 }];
  work(MB.plateRect(1));
  assert.ok(held(), 'setup: pick the second tray up');
  work(MB.plateRect(0));
  assert.ok(held(), 'two trays with food on both should not merge');
});

test('the fountain costs the cook time, and only while he is standing there', function () {
  startShift(12);
  S.chef.holding = null;
  S.pour = null;
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];

  var r = MB.tapRect();
  var w3 = r.w * 0.283;
  var cx = r.x + r.w * 0.217;
  work({ x: cx - w3 / 2, y: r.y, w: w3, h: r.h });
  assert.ok(S.pour, 'pressing a spout started nothing');
  assert.strictEqual(held(), null, 'the cup arrived instantly - it is meant to take time');

  pump(0.4);
  var partway = S.pour.t;
  assert.ok(partway > 0, 'the cup is not filling while he stands there');
  assert.strictEqual(S.pour.working, true, 'it should know he is on it');

  // send him away and the stream stops
  MB.sendChef({ kind: 'grill', i: 0 }, 0);
  pump(1.2);
  var away = S.pour.t;
  pump(1.5);
  assert.strictEqual(S.pour.t, away, 'the cup filled itself with nobody there');
  assert.strictEqual(S.pour.working, false, 'and it should know it is stalled');

  // come back, finish it, take it
  var got = pourCup(0);
  assert.ok(got && got.kind === 'cup', 'the cup never came off the spout');
  assert.strictEqual(S.pour, null, 'the spout was left holding a cup');
});

/*
 * The whole room, measured. Every fixture is a tap target and a picture; two
 * of them in the same pixels is both a wrong tap and a wrong drawing, and the
 * column has had three things added to it (board, fry line, fountain) since
 * anything checked.
 */
test('no two fixtures in the room stand in the same place', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 812], [412, 915], [360, 640], [412, 430], [820, 600], [320, 568]].forEach(function (sz) {
    [1, 5, 8, 12, 20, 25].forEach(function (day) {
      stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
      MB.startDay(day);
      pump(0.3);
      var where = sz.join('x') + ' day ' + day + ': ';

      var boxes = [];
      for (var i = 0; i < S.menu.length; i++) boxes.push(['crate' + i, MB.crateRect(i)]);
      for (i = 0; i < S.grill.length; i++) boxes.push(['grill' + i, MB.slotRect(i)]);
      for (i = 0; i < S.plates.length; i++) boxes.push(['plate' + i, MB.plateRect(i)]);
      if (MB.layout.fryH) boxes.push(['fryer', MB.fryerRect()]);
      if (MB.layout.freezerH) boxes.push(['freezer', MB.freezerRect()]);
      if (MB.layout.tapH) boxes.push(['tap', MB.tapRect()]);
      if (MB.layout.board) boxes.push(['board', MB.boardRect()]);
      boxes.push(['hatch', MB.hatchRect()], ['bin', MB.binRect()]);

      boxes.forEach(function (e) {
        var r = e[1];
        assert.ok(r && isFinite(r.x) && r.w > 0 && r.h > 0, where + e[0] + ' is not a box');
        assert.ok(r.x >= -1 && r.y >= -1 &&
                  r.x + r.w <= MB.layout.W + 1 && r.y + r.h <= MB.layout.H + 1,
          where + e[0] + ' hangs off the canvas: ' + JSON.stringify(r));
      });

      for (var a = 0; a < boxes.length; a++) {
        for (var b = a + 1; b < boxes.length; b++) {
          var p = boxes[a][1], q = boxes[b][1];
          var over = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) *
                     Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
          assert.strictEqual(over, 0,
            where + boxes[a][0] + ' and ' + boxes[b][0] + ' overlap by ' +
            over.toFixed(0) + 'px²');
        }
      }
    });
  });
  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

/*
 * Three fixtures a player reaches for without looking - the bin, the serving
 * hatch and the fountain - keep their place whatever the room rerolls. The bin
 * used to change corners from day seven and the fountain rode whichever column
 * the plates were on, so the two most-used targets moved under the player's
 * thumb. Everything else still varies: the palette, the crate line, the wall
 * colours, which wall is the grill.
 */
test('the bin, the hatch and the fountain never move house', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var sawGrillLeft = false, sawGrillRight = false;

  [[375, 812], [412, 915], [360, 640], [412, 430], [820, 600]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    for (var day = 1; day <= 30; day++) {
      S.runSeed = day * 7919;                 // a different run every pass
      MB.startDay(day);
      pump(0.2);
      var where = sz.join('x') + ' day ' + day + ': ';
      var bin = MB.binRect(), hatch = MB.hatchRect(), L2 = MB.layout;

      // bottom-left, always
      assert.ok(bin.x <= L2.pad + 0.01, where + 'the bin left the left-hand corner');
      assert.ok(bin.y + bin.h >= L2.H - L2.pad - 1, where + 'the bin left the bottom');

      // the hatch sits between the bin and whatever is to its right
      assert.ok(hatch.x >= bin.x + bin.w - 0.01, where + 'the hatch is left of the bin');
      assert.strictEqual(hatch.y, bin.y, where + 'the hatch and the bin are on different rows');

      if (L2.tapH) {
        var tap = MB.tapRect();
        assert.ok(tap.x + tap.w >= L2.W - L2.pad - 1, where + 'the fountain left the right corner');
        assert.strictEqual(tap.y, bin.y, where + 'the fountain is not on the bottom wall');
        assert.ok(tap.x >= hatch.x + hatch.w - 0.01, where + 'the fountain is left of the hatch');
        // and each of its three levers is still worth aiming at
        assert.ok(tap.w * 0.283 >= 22,
          where + 'a lever is ' + (tap.w * 0.283).toFixed(0) + 'px, under a thumb');
      }

      if (L2.room.grill === 'left' || L2.room.plain) sawGrillLeft = true;
      else sawGrillRight = true;
    }
  });

  // the rest of the room is still allowed to move
  assert.ok(sawGrillLeft && sawGrillRight,
    'pinning the bottom wall also froze which wall is the grill');

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

test('the lever you pressed wears the ring, and the levers do not overlap', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;

  [[375, 812], [412, 915], [320, 568], [820, 600]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    startShift(12);
    pump(0.3);
    var where = sz.join('x') + ': ';
    var r = MB.tapRect();
    assert.ok(r.w > 0, where + 'setup: day 12 should have a fountain');

    // three levers, side by side, inside the machine, each worth aiming at
    for (var i = 0; i < 3; i++) {
      var c = MB.tapColRect(i);
      assert.ok(c.x >= r.x - 0.01 && c.x + c.w <= r.x + r.w + 0.01,
        where + 'lever ' + i + ' hangs off the machine');
      assert.ok(c.y >= r.y - 0.01 && c.y + c.h <= r.y + r.h + 0.01,
        where + 'lever ' + i + ' hangs off the machine vertically');
      assert.ok(c.w >= 22, where + 'lever ' + i + ' is ' + c.w.toFixed(0) + 'px, under a thumb');
      if (i) {
        var prev = MB.tapColRect(i - 1);
        assert.ok(prev.x + prev.w <= c.x + 0.01, where + 'levers ' + (i - 1) + ' and ' + i + ' overlap');
      }
      // and a tap in the middle of a lever resolves to that lever
      assert.strictEqual(MB.tapColAt(c.x + c.w / 2), i,
        where + 'pressing lever ' + i + ' resolves to ' + MB.tapColAt(c.x + c.w / 2));
    }
  });

  /*
   * The ring means a lever is being worked. An untouched machine wears none -
   * it used to pre-mark the flavour the board wanted, which read as the game
   * answering the order for you.
   */
  stage.clientWidth = 412; stage.clientHeight = 915;
  startShift(12);
  pump(0.3);
  S.pour = null;
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].drink = S.drinkTaps[0];
  var idle = [], rr0 = Art.rr;
  Art.rr = function (g, x, y, w, h) { idle.push({ x: x, y: y, w: w, h: h }); };
  try { MB.drawFountain(); } finally { Art.rr = rr0; }
  var levers = [0, 1, 2].map(function (i) { return MB.tapColRect(i); });
  var marked = idle.filter(function (q) {
    return levers.some(function (L) { return Math.abs(q.x - L.x) < 1 && Math.abs(q.w - L.w) < 1; });
  });
  assert.strictEqual(marked.length, 0,
    'an untouched fountain pre-marked a lever - the ring is feedback, not an instruction');

  // the ring follows the press
  stage.clientWidth = 412; stage.clientHeight = 915;
  startShift(12);
  pump(0.3);
  S.chef.holding = null;
  S.pour = null;
  S.tickets.length = 0;

  var rings = [];
  var realRR = Art.rr;
  Art.rr = function (g, x, y, w, h) { rings.push({ x: x, y: y, w: w, h: h }); };
  try {
    for (var col = 0; col < 3; col++) {
      var ids = MB.dispenserView().ids;
      if (!ids[col]) continue;
      S.pour = { flavor: ids[col], t: 0.2, working: true, ids: ids.slice(), col: col };
      rings.length = 0;
      MB.drawFountain();
      var want = MB.tapColRect(col);
      var hit = rings.some(function (q) {
        return Math.abs(q.x - want.x) < 1 && Math.abs(q.y - want.y) < 1 &&
               Math.abs(q.w - want.w) < 1;
      });
      assert.ok(hit, 'pressing lever ' + col + ' (' + ids[col] + ') marked no lever - ' +
        'rings drawn at ' + JSON.stringify(rings.map(function (q) { return q.x.toFixed(0); })) +
        ', wanted ' + want.x.toFixed(0));
    }
  } finally { Art.rr = realRR; S.pour = null; }

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

/*
 * No wall may have a void on it.
 *
 * Both walls keep their fixtures in a fixed order and let the day decide how
 * many there are, so on a light day there is a lot of leftover height - and
 * whichever gap it all lands in becomes blank plaster. Bottom-aligning the
 * burners put 418px of nothing above a day-1 grill and 217px between the
 * fryer and the burners on day 5. The rule is that the slack is SHARED: the
 * gaps on a wall stay within sight of each other, whatever the day stocks.
 */
test('neither wall leaves a void above or below its fixtures', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;

  [[375, 812], [412, 915], [360, 640], [412, 430], [820, 600]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    for (var day = 1; day <= 25; day++) {
      MB.startDay(day);
      pump(0.25);
      var L2 = MB.layout, where = sz.join('x') + ' day ' + day + ': ';
      var band = L2.midBottom - L2.midTop;

      // --- the grill wall: [fry line] gapMid [burners] gapBot
      var gN = S.grill.length;
      var burners = gN * L2.slotH + (gN - 1) * L2.gap;
      var aboveEnd = L2.fryH ? L2.fryTop + L2.fryH : L2.midTop;
      var gMid = L2.grillTop - aboveEnd;
      var gBot = L2.midBottom - (L2.grillTop + burners);
      assert.ok(gMid >= -0.5 && gBot >= -0.5,
        where + 'the grill wall overflows its band: ' + gMid.toFixed(0) + '/' + gBot.toFixed(0));
      assert.ok(Math.abs(gMid - gBot) <= Math.max(6, band * 0.06),
        where + 'the grill wall dumped its slack into one gap: ' +
        gMid.toFixed(0) + 'px above the burners, ' + gBot.toFixed(0) + 'px below');

      // --- the plate wall: [board] gapMid [plates] gapBot
      var pN = S.plates.length;
      var stack = pN * L2.plateH + (pN - 1) * L2.gap;
      var pAbove = L2.board ? L2.board.y + L2.board.h : L2.midTop;
      var pMid = L2.plateTop - pAbove;
      var pBot = L2.midBottom - (L2.plateTop + stack);
      assert.ok(pBot >= -0.5, where + 'the plate wall overflows its band by ' + (-pBot).toFixed(0));
      assert.ok(Math.abs(pMid - pBot) <= Math.max(8, band * 0.10),
        where + 'the plate wall dumped its slack into one gap: ' +
        pMid.toFixed(0) + 'px above the plates, ' + pBot.toFixed(0) + 'px below');
    }
  });

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

test('every dish on the bench sits at the same height, set or no set', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 812], [412, 430], [820, 600]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    startShift(12);
    pump(0.3);
    var where = sz.join('x') + ': ';
    assert.ok(S.plates.length >= 3, where + 'setup: day 12 should have three plates');

    // one bare burger, one with a drink beside it, one with the full tray
    S.plates.forEach(function (p) { p.stack = [{ id: 'bun', cook: 1 }]; p.side = null; p.drink = null; });
    S.plates[1].drink = S.drinkTaps[0];
    S.plates[2].side = 'fries';
    S.plates[2].drink = S.drinkTaps[0];

    var seen = [], real = Art.scene.plate;
    Art.scene.plate = function (g, cx, cy) { seen.push(cy); };
    try { MB.drawPlates(); } finally { Art.scene.plate = real; }

    assert.strictEqual(seen.length, S.plates.length, where + 'not every plate drew a dish');
    var within = seen.map(function (cy, i) { return cy - MB.plateRect(i).y; });
    within.forEach(function (d, i) {
      assert.ok(Math.abs(d - within[0]) < 0.51,
        where + 'plate ' + i + ' sits ' + (d - within[0]).toFixed(1) +
        'px off the others - a column of plates should be one line, whatever is on them');
    });

    // and lifted clear of the slot's floor rather than pinned to it
    var L2 = MB.layout;
    if (L2.plateH > 50) {
      assert.ok(within[0] < L2.plateH - 12,
        where + 'the dish is pinned to the bottom of its slot');
    }
  });
  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

/*
 * The benches, not just the slots.
 *
 * drawGrill and drawPlates wrap their slots in a counter that reaches above
 * the first and below the last, and that chrome was not in the layout's
 * budget - so the grill bench cut 10-12px into the fryer above it and the
 * plate bench 3-5px into the board. The rect-level overlap sweep could not see
 * it, because the benches are drawn outside the rects they belong to.
 *
 * The wall pays for as much of the chrome as it can afford without pushing a
 * station under MIN_TAPPABLE, and the bench is drawn at exactly that size, so
 * an overlap is impossible rather than merely unlikely.
 */
test('no bench overlaps the machine above it, at any grill or plate count', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var checked = 0;

  [[375, 812], [412, 915], [360, 640], [412, 430], [320, 568], [820, 600]].forEach(function (sz) {
    [{}, { plate: 2, burner: 2, grill: 3, shoes: 3 }].forEach(function (levels, li) {
      stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
      [1, 5, 8, 12, 16, 20, 25].forEach(function (day) {
        S.levels = JSON.parse(JSON.stringify(levels));
        MB.startDay(day);
        pump(0.25);
        if (S.cramped) return;                 // the room already says it is unusable
        checked++;
        var L2 = MB.layout;
        var where = sz.join('x') + (li ? ' maxed' : ' base') + ' day ' + day + ': ';
        var gN = S.grill.length, pN = S.plates.length;

        // measure the bench the game actually DRAWS, not the one it budgeted -
        // the two drifting apart is the whole defect
        var drawn = [], realCounter = Art.scene.counter;
        Art.scene.counter = function (g, x, y, w, h) { drawn.push({ y: y, h: h }); };
        try { MB.drawGrill(); MB.drawPlates(); } finally { Art.scene.counter = realCounter; }
        assert.strictEqual(drawn.length, 2, where + 'expected one bench each');
        var benchTop = drawn[0].y;
        var benchBot = drawn[0].y + drawn[0].h;
        var above = L2.fryH ? L2.fryTop + L2.fryH : L2.midTop;
        assert.ok(benchTop >= above - 0.6,
          where + 'the grill bench cuts ' + (above - benchTop).toFixed(1) + 'px into the fryer');
        assert.ok(benchBot <= L2.midBottom + 0.6,
          where + 'the grill bench runs ' + (benchBot - L2.midBottom).toFixed(1) + 'px past the band');

        var pTop = drawn[1].y;
        var pBot = drawn[1].y + drawn[1].h;
        var pAbove = L2.board ? L2.board.y + L2.board.h : L2.midTop;
        assert.ok(pTop >= pAbove - 0.6,
          where + 'the plate bench cuts ' + (pAbove - pTop).toFixed(1) + 'px into the board');
        assert.ok(pBot <= L2.midBottom + 0.6,
          where + 'the plate bench runs ' + (pBot - L2.midBottom).toFixed(1) + 'px past the band');

        // and paying for the chrome must never cost a tappable station
        assert.ok(L2.slotH >= 22 && L2.plateH >= 22,
          where + 'a station fell under a thumb: ' +
          L2.slotH.toFixed(0) + '/' + L2.plateH.toFixed(0));
      });
    });
  });

  assert.ok(checked > 50, 'only ' + checked + ' layouts were actually checked');
  S.levels = {};
  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

/*
 * The fry line starts at the freezer.
 *
 * A well used to light itself on an empty-handed tap, so the potatoes came
 * from nowhere and the freezer beside it was scenery that animated. It is the
 * same shape as the patty now: fetch, then cook.
 */
test('the fryer will not run without a bag carried over from the freezer', function () {
  startShift(8);
  S.chef.holding = null;

  work(MB.fryWellRect(0));
  assert.strictEqual(S.fryer[0], null, 'an empty-handed tap lit the well');

  work(MB.freezerRect());
  var bag = held();
  assert.ok(bag && bag.kind === 'fryBag', 'the freezer handed out ' + JSON.stringify(bag));

  // the freezer will not hand out a second one on top of it
  work(MB.freezerRect());
  assert.strictEqual(held().kind, 'fryBag', 'it stacked two bags in one pair of hands');

  // ...and a bag is not a topping
  work(MB.plateRect(0));
  assert.ok(held(), 'a bag of frozen chips went onto a plate');

  work(MB.fryWellRect(0));
  assert.ok(S.fryer[0], 'the bag never went in');
  assert.strictEqual(held(), null, 'the bag stayed in his hands');

  // a busy well refuses a second bag rather than swallowing it
  work(MB.freezerRect());
  work(MB.fryWellRect(0));
  assert.ok(held() && held().kind === 'fryBag', 'a busy well swallowed a second bag');
  work(MB.fryWellRect(1));
  assert.ok(S.fryer[1], 'the free well refused it');

  // and the carry has a size, so the hands close on something
  var g = makeCtx();
  var measured = MB.drawCarried(g, 100, 100, 40, 12, { kind: 'fryBag' }, true);
  var drawn = MB.drawCarried(g, 100, 100, 40, 12, { kind: 'fryBag' }, false);
  assert.ok(measured > 0 && measured === drawn,
    'a carried bag measures ' + measured + ' but draws at ' + drawn);

  // over the wire too
  var back = MB.unpackHold(MB.packHold({ kind: 'fryBag' }));
  assert.strictEqual(back.kind, 'fryBag', 'a bag came back as ' + JSON.stringify(back));
});

/*
 * The fry wells wear the grill's doneness bar.
 *
 * They used to ask the player to read raw / perfect / over / burnt off the
 * colour of the fries alone - a far finer distinction than a bar, and one the
 * basket half covers. Same curve, same window, same bar, so a basket and a
 * patty are read the same way.
 */
test('a basket in the oil shows how done it is, the way a patty does', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var g = stage.getContext('2d');

  [[375, 812], [412, 430], [820, 600]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    startShift(8);
    pump(0.3);
    var where = sz.join('x') + ': ';
    assert.ok(S.fryer.length, where + 'setup: day 8 should have a fry line');

    /*
     * Count the rounded rects each station paints inside one cooking slot: a
     * track, the green window marked on it, and the fill. The colour mapping
     * is one line shared with the grill, so what this has to prove is that the
     * bar is THERE - the wells had none.
     */
    function barsIn(rect, paint) {
      var seen = [], realRR = Art.rr;
      Art.rr = function (c, x, y, w, h) { seen.push({ x: x, y: y, w: w, h: h }); };
      try { paint(); } finally { Art.rr = realRR; }
      return seen.filter(function (b) {
        return b.w > 0 && b.h > 0 &&
               b.x >= rect.x - 0.6 && b.x + b.w <= rect.x + rect.w + 0.6 &&
               b.y >= rect.y - 0.6 && b.y + b.h <= rect.y + rect.h + 0.6;
      });
    }

    [1, Core.COOK_TIME, Core.COOK_TIME + 2.4, Core.COOK_TIME * 2].forEach(function (t) {
      S.fryer[0] = { t: t };
      var n = barsIn(MB.fryWellRect(0), MB.drawFryStation).length;
      assert.ok(n >= 3, where + 'a basket at ' + t.toFixed(1) + 's drew ' + n +
        ' bars in its well - it needs a track, a window and a fill');
    });
    S.fryer[0] = null;

    // an empty well has nothing to say
    assert.strictEqual(barsIn(MB.fryWellRect(0), MB.drawFryStation).length, 0,
      where + 'an empty well drew a doneness bar');

    // and the patty still has its own
    S.grill[0] = { id: 'patty', t: Core.COOK_TIME };
    var gn = barsIn(MB.slotRect(0), MB.drawGrill).length;
    S.grill[0] = null;
    assert.ok(gn >= 3, where + 'the grill lost its bar: ' + gn);
  });

  stage.clientWidth = w0; stage.clientHeight = h0;
  pump(0.3);
});

/*
 * The board is the specification.
 *
 * bestMatch picks the CLOSEST ticket and payout grades against it, so a burger
 * with a filling nobody asked for used to be quietly sold to whoever wanted
 * the most of it - at a discount, but sold. A plate either matches something
 * on the board or it goes back.
 */
test('a burger nobody ordered goes back, however close it was', function () {
  startShift(10);
  S.tickets.length = 0;
  MB.spawnTicket();
  var want = S.tickets[0].items.slice();
  S.tickets[0].side = null;
  S.tickets[0].drink = null;

  function serve(items) {
    var sales = S.sales, tips = S.tips, wasted = S.waste, served = S.served;
    MB.deliver(items.map(function (id) { return { id: id, cook: 1 }; }), {}, 0);
    return { pay: S.sales - sales, tip: S.tips - tips,
             waste: S.waste - wasted, served: S.served - served };
  }

  // exactly what was asked for: paid, and counted
  var right = serve(want);
  assert.ok(right.pay > 0, 'the right burger paid nothing');
  assert.strictEqual(right.waste, 0, 'the right burger went in the bin');
  assert.strictEqual(right.served, 1, 'the right burger was not counted as served');

  // one filling too many - as close as a wrong plate gets
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].items = want.slice();
  S.tickets[0].side = null;
  S.tickets[0].drink = null;
  var extra = want.concat(['cheese']);
  var near = serve(extra);
  assert.strictEqual(near.pay, 0,
    'a burger with a filling nobody ordered still sold for ' + near.pay);
  assert.strictEqual(near.tip, 0, 'it was tipped for');
  assert.ok(near.waste > 0, 'a rejected plate cost the shop nothing');
  assert.strictEqual(near.served, 0, 'it was counted as served');

  // ...and one filling short is no better
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].items = want.slice();
  S.tickets[0].side = null;
  S.tickets[0].drink = null;
  var short = serve(want.slice(0, want.length - 1));
  assert.strictEqual(short.pay, 0, 'a burger missing a filling sold for ' + short.pay);
  assert.ok(short.waste > 0, 'a short burger cost the shop nothing');
});

/*
 * One failure condition: the day has to cover its rent.
 *
 * The hearts were a second one running alongside it - five mistakes shut the
 * shop whatever the till said - and they measured something the money already
 * measured. A plate that goes back is food in the bin, and the shop pays for
 * it, so a bad shift shows up as a shortfall in the number the day is judged
 * by rather than as a separate bar.
 */
test('a shift is won or lost on the till, and the bin counts against it', function () {
  startShift(10);
  assert.strictEqual(S.waste, 0, 'a fresh shift starts with an empty bin');
  assert.ok(S.rent > 0, 'setup: there should be rent to make');

  // serving what was asked for puts money in
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].side = null;
  S.tickets[0].drink = null;
  var want = S.tickets[0].items.slice();
  MB.deliver(want.map(function (id) { return { id: id, cook: 1 }; }), {}, 0);
  var earned = S.sales + S.tips;
  assert.ok(earned > 0, 'the right burger paid nothing');
  assert.strictEqual(S.waste, 0, 'the right burger went in the bin');

  // a rejected one takes money back OUT
  S.tickets.length = 0;
  MB.spawnTicket();
  S.tickets[0].items = want.slice();
  S.tickets[0].side = null;
  S.tickets[0].drink = null;
  MB.deliver(want.concat(['cheese']).map(function (id) { return { id: id, cook: 1 }; }), {}, 0);
  assert.ok(S.waste > 0, 'a binned plate cost the shop nothing');
  assert.strictEqual(S.sales + S.tips, earned, 'a binned plate still paid out');

  // the bin is charged at a share of the menu price, not the whole thing -
  // full price makes day one brutal and day twenty cheap
  var full = Core.menuPrice(want.concat(['cheese']));
  assert.ok(S.waste < full, 'the bin is charged at the full menu price');
  assert.ok(S.waste > full * 0.2, 'the bin is barely charged at all: ' + S.waste + ' of ' + full);

  // and the day is judged on what is left
  var till = S.sales + S.tips - S.waste;
  S.rent = till;
  MB.endDay();
  assert.strictEqual(elements.dayEnd.hidden, false,
    'a till exactly covering the rent should pass');

  startShift(10);
  S.sales = 5000; S.tips = 0; S.waste = 5000;
  S.rent = 1;
  MB.endDay();
  assert.strictEqual(elements.over.hidden, false,
    'a shift that binned everything it made should fail');
});

/*
 * The number the whole day is judged by must not be drawn through the bar
 * that measures the same thing. It was: the target sat on a baseline whose
 * cap height reached down into the takings thermometer, because nothing in
 * the file connected the two constants. They come from hudBoxes now.
 */
test('the day\'s target is not drawn through the takings bar', function () {
  [[320, 48], [375, 58], [412, 58], [560, 72]].forEach(function (sz) {
    var B = Art.ui.hudBoxes(0, 0, sz[0], sz[1]);
    var where = sz.join('x') + ': ';
    ['need', 'bar', 'pause'].forEach(function (k) {
      var r = B[k];
      assert.ok(r && isFinite(r.x) && r.w > 0 && r.h > 0, where + k + ' is not a box');
      assert.ok(r.y >= -0.5 && r.y + r.h <= sz[1] + 0.5, where + k + ' hangs off the HUD');
    });
    assert.ok(B.need.y + B.need.h <= B.bar.y + 0.01,
      where + 'the target overlaps the takings bar by ' +
      (B.need.y + B.need.h - B.bar.y).toFixed(1) + 'px');
    // the pause square is on the left, the target on the right - never both
    assert.ok(B.pause.x + B.pause.w <= B.right - 1, where + 'the pause square reaches the target');
  });

  // and the HUD draws at every state without throwing
  [[12.34, 2.5], [0, 0], [0.01, 99.9]].forEach(function (st) {
    assert.doesNotThrow(function () {
      Art.ui.hud(makeCtx(), 0, 0, 412, 58, {
        day: 12, time: '1:20', earned: 58.66, goal: 71, pct: 0.82, tip: 0.5,
        need: st[0], waste: st[1]
      });
    }, 'the HUD threw with need=' + st[0]);
  });
});

/*
 * A shop row is four things side by side - the icon, the name and its line,
 * the pips, and the price - and they were laid out against four separate
 * fractions of the sheet. The price oval's width now comes off the ROW rather
 * than the sheet, and the text column's width comes off the oval, so the two
 * cannot drift into each other.
 */
test('a shop row lays its icon, name and price out without them touching', function () {
  var SIZES = [[320, 568], [375, 812], [412, 915], [360, 640], [820, 600], [1280, 800]];

  SIZES.forEach(function (sz) {
    [1, 3, 5].forEach(function (rows) {
      [false, true].forEach(function (hasUnlocks) {
        var B = Art.ui.shopBoxes(0, 0, sz[0], sz[1], rows, hasUnlocks);
        var where = sz.join('x') + ' ' + rows + ' rows' + (hasUnlocks ? ' +unlocks' : '') + ': ';
        assert.strictEqual(B.buys.length, rows, where + 'a row lost its price');

        var iconRight = B.x0 + B.iw * 0.135;
        var textLeft = B.x0 + B.iw * 0.180;
        assert.ok(iconRight <= textLeft, where + 'the icon runs into the name');

        B.buys.forEach(function (b, i) {
          var at = where + 'row ' + i + ': ';
          // the oval stands rather than lies down - that is the whole look
          assert.ok(b.h > b.w, at + 'the price oval is ' + b.w.toFixed(0) + 'x' +
            b.h.toFixed(0) + ' - lying down, not standing');
          // it stays on the sheet
          assert.ok(b.x + b.w <= B.x0 + B.iw + 0.01, at + 'the oval runs off the sheet');
          assert.ok(b.x >= B.x0, at + 'the oval is off the left of the sheet');
          // and there is real room left for the words beside it
          var textW = b.x - textLeft - B.iw * 0.030;
          assert.ok(textW > B.iw * 0.35,
            at + 'the name has only ' + textW.toFixed(0) + 'px, ' +
            (textW / B.iw * 100).toFixed(0) + '% of the row');
          // rows do not sit on each other
          if (i) {
            var prev = B.buys[i - 1];
            assert.ok(prev.y + prev.h <= b.y + 0.01,
              at + 'this row overlaps the one above by ' + (prev.y + prev.h - b.y).toFixed(1));
          }
        });

        // the stack of rows ends above the footer
        if (rows) {
          var last = B.buys[rows - 1];
          assert.ok(last.y + last.h <= B.primary.y + 0.01,
            where + 'the rows run into the START THE DAY button');
        }
      });
    });
  });

  // and it draws, at every size, with and without the unlock slip
  SIZES.forEach(function (sz) {
    [0, 4].forEach(function (n) {
      assert.doesNotThrow(function () {
        Art.ui.shop(makeCtx(), 0, 0, sz[0], sz[1], {
          title: 'THE SHOP', day: 'DAY 12 · CLOSED', till: '$142.80',
          unlocks: n ? [{ id: 'bacon', name: 'Bacon', price: '$1.30' }] : [],
          upgrades: Array.from({ length: n }, function (_, i) {
            return { id: 'grill', t: 'ONE MORE BURNER', d: 'A fourth pan on the line',
                     p: '$1,240', pips: ['#e8a021', '#e8a021'] };
          }),
          tomorrow: 'TOMORROW: 12 CUSTOMERS', rent: 'RENT DUE $70.50',
          link: 'CHANGE THE COOK’S OUTFIT', primary: 'START DAY 13'
        });
      }, sz.join('x') + ' with ' + n + ' upgrades threw');
    });
  });
});

/*
 * ── the lying-down room ──────────────────────────────────────────────────
 *
 * A phone on its side hands the kitchen about 620x313, and the standing-up
 * layout cannot use it: two columns of stations down the sides need height
 * the room does not have, and the left one alone wants a freezer, a fryer
 * and five burners. Measured before the bands existed, EVERY landscape phone
 * went cramped - the smallest by day 2.
 *
 * So the walls lie down: the fry line and the burners in a band along the
 * top, the board and the plates along the bottom, the floor between them.
 * These three tests are the ones that would have caught the version that did
 * not fit, and the ones that stop it drifting back.
 */
function wideRooms(fn) {
  /*
   * Real landscape handsets, less the HUD and the board column beside the
   * room. 618x291 is not a calculation - it is what an 812x375 phone actually
   * reported through the browser, and it is 22px shorter than the arithmetic
   * predicted, so it is the one that stays honest about the HUD.
   */
  [[618, 291], [620, 313], [652, 328], [548, 298], [475, 313], [832, 538]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    for (var day = 1; day <= 25; day++) {
      S.levels = { plate: 2, burner: 2, grill: 3, shoes: 3 };
      MB.startDay(day); MB.resize();
      fn(sz.join('x') + ' day ' + day, sz);
    }
  });
}

/** Every box the room draws, by the name it should be reported under. */
function roomBoxes() {
  var R = [], i, n = S.grill.length, p = S.plates.length;
  for (i = 0; i < n; i++) R.push(['burner' + i, MB.slotRect(i)]);
  for (i = 0; i < p; i++) R.push(['plate' + i, MB.plateRect(i)]);
  if (S.fryer.length) R.push(['fryer', MB.fryerRect()], ['freezer', MB.freezerRect()]);
  if (S.board) R.push(['board', MB.boardRect()]);
  R.push(['hatch', MB.hatchRect()], ['bin', MB.binRect()]);
  if (L.tapH) R.push(['fountain', MB.tapRect()]);
  for (i = 0; i < L.crates.length; i++) R.push(['crate' + i, L.crates[i]]);
  // the counters the slots are recessed into, which is what actually gets
  // drawn - the slots alone never caught a bench running into its neighbour
  R.push(['grillBench', {
    x: MB.slotRect(0).x - 3, y: L.grillTop - L.gPadTop,
    w: (MB.slotRect(n - 1).x + L.colW) - MB.slotRect(0).x + 6,
    h: L.slotH + L.gPadTop + L.gPadBot
  }], ['plateBench', {
    x: MB.plateRect(0).x - 3, y: L.plateTop - L.pPadTop,
    w: (MB.plateRect(p - 1).x + L.plateW) - MB.plateRect(0).x + 6,
    h: L.plateH + L.pPadTop + L.pPadBot
  }], ['floor', {
    x: L.floor.x0, y: L.floor.y0,
    w: L.floor.x1 - L.floor.x0, h: L.floor.y1 - L.floor.y0
  }]);
  return R;
}

test('a room lying down fits its kitchen in, on every landscape phone', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var worst = null;
  wideRooms(function (where) {
    assert.ok(L.wide, where + ': should have laid out as a wide room');
    if (S.cramped) worst = worst || where;
    // the floor is not a leftover - the cook has to stand in it
    assert.ok(L.floor.y1 - L.floor.y0 >= L.chefS * 0.95,
      where + ': floor is ' + (L.floor.y1 - L.floor.y0).toFixed(0) +
      'px for a ' + L.chefS.toFixed(0) + 'px cook');
  });
  assert.strictEqual(worst, null,
    'a landscape phone should never ask the player to turn it back; first: ' + worst);
  stage.clientWidth = w0; stage.clientHeight = h0; MB.resize();
});

test('nothing in a lying-down room overlaps anything else, or leaves it', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var clashes = [], escaped = [];
  wideRooms(function (where, sz) {
    var R = roomBoxes();
    for (var i = 0; i < R.length; i++) {
      var a = R[i][0], r = R[i][1];
      if (r.x < -1 || r.y < -1 || r.x + r.w > sz[0] + 1 || r.y + r.h > sz[1] + 1) {
        escaped.push(where + ' ' + a);
      }
      for (var j = i + 1; j < R.length; j++) {
        var b = R[j][0];
        // a slot inside its own counter is the point of the counter
        if (/^crate/.test(a) && /^crate/.test(b)) continue;
        if (a === 'grillBench' && /^burner/.test(b)) continue;
        if (b === 'grillBench' && /^burner/.test(a)) continue;
        if (a === 'plateBench' && /^plate\d/.test(b)) continue;
        if (b === 'plateBench' && /^plate\d/.test(a)) continue;
        var ox = Math.min(r.x + r.w, R[j][1].x + R[j][1].w) - Math.max(r.x, R[j][1].x);
        var oy = Math.min(r.y + r.h, R[j][1].y + R[j][1].h) - Math.max(r.y, R[j][1].y);
        if (ox > 0.5 && oy > 0.5) {
          clashes.push(where + ' ' + a + ' x ' + b + ' by ' + Math.min(ox, oy).toFixed(0) + 'px');
        }
      }
    }
  });
  assert.deepStrictEqual(escaped, [], 'these left the room');
  assert.deepStrictEqual(clashes.slice(0, 6), [], 'these stand in each other');
  stage.clientWidth = w0; stage.clientHeight = h0; MB.resize();
});

test('a lying-down room is worked from in front of the counter, not the end of it', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  var reaches = [], misses = [];
  wideRooms(function (where) {
    var T = [], i;
    for (i = 0; i < S.grill.length; i++) T.push(['grill', i, MB.slotRect(i)]);
    for (i = 0; i < S.plates.length; i++) T.push(['plate', i, MB.plateRect(i)]);
    if (S.fryer.length) T.push(['fryer', null, MB.fryerRect()]);
    if (S.board) T.push(['board', null, MB.boardRect()]);
    T.forEach(function (t) {
      var p = MB.standPoint({ kind: t[0], i: t[1] || 0 }), r = t[2];
      /*
       * The cook belongs in FRONT of the fixture, which in a band means their
       * x is inside its span. Left on the standing-up axis this came out at
       * the end of the band, so working the fifth burner meant standing past
       * the fourth and reaching sideways over three more.
       */
      if (p.x < r.x - 2 || p.x > r.x + r.w + 2) {
        reaches.push(where + ' ' + t[0] + t[1] + ' stands off the end of its band');
      }
      var probe = MB.stationAt(r.x + r.w * 0.28, r.y + r.h * 0.4);
      if (!probe || probe.kind !== t[0]) {
        misses.push(where + ' tap on ' + t[0] + t[1] + ' hit ' + (probe ? probe.kind : 'nothing'));
      }
    });
  });
  assert.deepStrictEqual(reaches.slice(0, 6), [], 'these are worked from the wrong side');
  assert.deepStrictEqual(misses.slice(0, 6), [], 'these could not be tapped');
  stage.clientWidth = w0; stage.clientHeight = h0; MB.resize();
});

test('a room standing up still stands up', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  [[375, 576], [412, 679], [360, 560]].forEach(function (sz) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    for (var day = 1; day <= 25; day++) {
      S.levels = { plate: 2, burner: 2, grill: 3, shoes: 3 };
      MB.startDay(day); MB.resize();
      var where = sz.join('x') + ' day ' + day;
      assert.ok(!L.wide, where + ': a tall room should not lie down');
      assert.strictEqual(S.cramped, false, where + ': should not be cramped');
      // the columns: two slots on the same wall share an x and differ in y
      if (S.grill.length > 1) {
        assert.strictEqual(MB.slotRect(0).x, MB.slotRect(1).x, where + ': the grill is a column');
        assert.ok(MB.slotRect(1).y > MB.slotRect(0).y, where + ': and it runs downwards');
      }
      // and the fry line still hangs off the top of that same column
      if (S.fryer.length) {
        assert.strictEqual(MB.fryerRect().x, MB.slotRect(0).x, where + ': the fryer shares the wall');
        assert.ok(MB.freezerRect().y < MB.fryerRect().y, where + ': freezer above fryer');
      }
    }
  });
  stage.clientWidth = w0; stage.clientHeight = h0; MB.resize();
});

test('a shift costs the same walking whichever way the room is lying', function () {
  var w0 = stage.clientWidth, h0 = stage.clientHeight;
  /*
   * Walking time IS the difficulty, and the day's targets are one curve for
   * every device - so a kitchen laid out in bands has to cost what one laid
   * out in columns costs, or landscape is a different game at the same target.
   *
   * It did not, at first. The speed was normalised against the floor's
   * diagonal, which in a 600x67 room is basically its width, while the trips
   * are short hops across it: serving came out three to five times cheaper.
   */
  function shiftCost(sz, day) {
    stage.clientWidth = sz[0]; stage.clientHeight = sz[1];
    S.levels = { plate: 2, burner: 2, grill: 3, shoes: 3 };
    MB.startDay(day); MB.resize();
    function leg(a, b) {
      var p = MB.standPoint(a), q = MB.standPoint(b);
      return Math.hypot(p.x - q.x, p.y - q.y) / L.walkScale;
    }
    // the round trip a burger actually makes: shelf, grill, plate, pass
    return (leg({ kind: 'crate', i: 0 }, { kind: 'grill', i: 0 }) +
            leg({ kind: 'grill', i: S.grill.length - 1 }, { kind: 'plate', i: 0 }) +
            leg({ kind: 'plate', i: 0 }, { kind: 'hatch', i: 0 })) / 3;
  }

  [5, 12, 20].forEach(function (day) {
    var tall = shiftCost([375, 576], day);
    [[620, 313], [548, 298], [832, 538]].forEach(function (sz) {
      var wide = shiftCost(sz, day);
      var off = Math.abs(wide - tall) / tall;
      assert.ok(off <= 0.18,
        'day ' + day + ' on ' + sz.join('x') + ' costs ' + wide.toFixed(0) +
        ' against a portrait kitchen’s ' + tall.toFixed(0) +
        ' - ' + (off * 100).toFixed(0) + '% out');
    });
  });
  stage.clientWidth = w0; stage.clientHeight = h0; MB.resize();
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');


