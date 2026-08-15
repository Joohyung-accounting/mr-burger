/*
 * The fry line and the 16oz drinks: `node test/fries.test.js`.
 *
 * There is no canvas in Node, so these tests do not look at pixels - they
 * record the calls the pieces make against a stub context and reason about the
 * tape. That turns out to catch the three things that actually go wrong with
 * handoff art:
 *
 *   1. it throws at some size nobody previewed (a phone crate is 54px wide,
 *      the design document drew everything at 150),
 *   2. it leaks a ctx.save() or a ctx.clip(), and every station drawn after it
 *      inherits the clip - the bug that shows up three screens away,
 *   3. a documented state value is quietly ignored, so `cooked` or `fill` is
 *      in the handoff notes and in the caller and nowhere in the drawing.
 *
 * The tape is also the determinism check. art-fries-drinks.js promises every
 * wobble comes from Art.hash rather than Math.random, so that a machine which
 * is not animating holds perfectly still between frames; drawing the same
 * piece twice has to produce byte-identical tape or that promise is broken.
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

/* ------------------------------------------------------------ the tape */

var CALLS = ['setTransform', 'clearRect', 'save', 'restore', 'translate', 'scale',
  'rotate', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'ellipse', 'closePath',
  'rect', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke', 'fillRect',
  'strokeRect', 'fillText', 'strokeText', 'setLineDash', 'clip', 'drawImage'];

var PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'lineCap',
  'lineJoin', 'font', 'textAlign', 'textBaseline', 'letterSpacing', 'filter',
  'globalCompositeOperation', 'shadowColor', 'shadowBlur', 'shadowOffsetY'];

function num(v) {
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return 'BAD:' + v;          // NaN and Infinity are failures, not values
  return (Math.round(v * 1000) / 1000).toString();
}

/**
 * A context that writes down everything asked of it. `depth` tracks the
 * save/restore balance and `floor` remembers whether it ever went negative -
 * one restore too many pops a state the caller never pushed, which is just as
 * broken as leaving one behind.
 */
function tape() {
  var t = { log: [], depth: 0, floor: 0 };
  CALLS.forEach(function (m) {
    t[m] = function () {
      if (m === 'save') t.depth++;
      if (m === 'restore') { t.depth--; if (t.depth < t.floor) t.floor = t.depth; }
      var a = Array.prototype.slice.call(arguments).map(num);
      t.log.push(m + '(' + a.join(',') + ')');
    };
  });
  PROPS.forEach(function (p) {
    var v = '';
    Object.defineProperty(t, p, {
      get: function () { return v; },
      set: function (x) { v = x; t.log.push(p + '=' + num(x)); }
    });
  });
  t.createLinearGradient = function () { return { addColorStop: function () {} }; };
  t.createRadialGradient = t.createLinearGradient;
  t.measureText = function (s) { return { width: (s || '').length * 6 }; };
  return t;
}

/* ------------------------------------------------------------- loading */

global.self = global;                     // art.js hangs itself off `self` in the browser
require('../www/js/art.js');
require('../www/js/art-fries-drinks.js');
require('../www/js/art-freezer-dispenser.js');
var Art = global.Art;

/*
 * The eight pieces, each wrapped in the box-to-arguments convention its own
 * caller uses, so the whole set can be driven from one (w, h). These are the
 * same placements the design document previews them at.
 */
var PIECES = {
  sack:     function (g, w, h, o) { Art.scene.sack(g, w * 0.10, h * 0.04, w * 0.80, h * 0.92, o); },
  cutter:   function (g, w, h, o) { Art.scene.cutter(g, w * 0.06, h * 0.03, w * 0.88, h * 0.94, o); },
  fryer:    function (g, w, h, o) { Art.scene.fryer(g, w * 0.04, h * 0.06, w * 0.92, h * 0.90, o); },
  potato:   function (g, w, h, o) { Art.item.potato(g, w * 0.5, h * 0.5, w * 0.36, o); },
  friesRaw: function (g, w, h, o) { Art.item.friesRaw(g, w * 0.5, h * 0.5, w * 0.86, o); },
  basket:   function (g, w, h, o) { Art.item.basket(g, w * 0.10, h * 0.40, w * 0.72, h * 0.52, o); },
  friesBox: function (g, w, h, o) { Art.item.friesBox(g, w * 0.20, h * 0.42, w * 0.60, h * 0.55, o); },
  cup:      function (g, w, h, o) { Art.item.cup(g, w * 0.14, h * 0.03, w * 0.72, h * 0.94, o); }
};

/* Every state the handoff notes document, per piece. */
var STATES = {
  sack:     [{}, { open: 0 }, { open: 1, count: 0 }, { open: 1, count: 1, label: 'SPUDS', sub: '25 KG' }],
  cutter:   [{}, { spin: -0.9, load: 1, out: 1 }, { spin: 3.7, load: 0, out: 0 }],
  fryer:    [{}, { hot: 0 }, { hot: 0.5, t: 9, slots: [{}], temp: '165' },
             { hot: 1, t: 1.4, slots: [{ down: 1, fries: 0.9, cooked: 0.8 }, { down: 0.1, fries: 0.5, cooked: 1 }] }],
  potato:   [{}, { peeled: 0 }, { peeled: 1 }, { seed: 7 }],
  friesRaw: [{}, { cooked: 0, n: 12 }, { cooked: 1, n: 30 }, { n: 0 }],
  basket:   [{}, { fries: 1, cooked: 0 }, { fries: 0.5, cooked: 1, lean: -1 }, { fries: 1, handle: false }],
  friesBox: [{}, { fries: 0 }, { fries: 1, brand: 'BURG' }],
  cup:      [{}, { flavor: 'cider' }, { flavor: 'tea', lid: 'flat' }, { flavor: 'root', straw: false },
             { flavor: 'cola', clear: true, fill: 0.88 }, { flavor: 'lemon', clear: true, fill: 1 },
             { flavor: 'orange', clear: true, fill: 0, lid: false, straw: false }]
};

// a tray icon, a crate on a narrow phone, the document's own size, a tablet
var SIZES = [[8, 9], [40, 44], [54, 55], [150, 168], [420, 470]];

var NAMES = Object.keys(PIECES);

function draw(name, o, w, h) {
  var g = tape();
  PIECES[name](g, w === undefined ? 200 : w, h === undefined ? 220 : h, o);
  return g;
}

/* --------------------------------------------------------------- tests */

test('every piece the handoff documents is registered on Art', function () {
  ['sack', 'cutter', 'fryer'].forEach(function (k) {
    assert.strictEqual(typeof Art.scene[k], 'function', 'Art.scene.' + k + ' is missing');
  });
  ['potato', 'friesRaw', 'basket', 'friesBox', 'cup', 'stick'].forEach(function (k) {
    assert.strictEqual(typeof Art.item[k], 'function', 'Art.item.' + k + ' is missing');
  });
  assert.deepStrictEqual(Art.FLAVOR_IDS, ['cola', 'cider', 'orange', 'lemon', 'root', 'tea']);
  Art.FLAVOR_IDS.forEach(function (id) {
    assert.ok(Art.FLAVORS[id] && Art.FLAVORS[id].label, id + ' has no flavour entry');
  });
});

test('registering the fry line leaves the kitchen art.js published alone', function () {
  ['THEMES', 'floor', 'wall', 'counter', 'crate', 'grill', 'plate', 'hatch', 'bin']
    .forEach(function (k) {
      assert.ok(Art.scene[k], 'art.js scene.' + k + ' was clobbered by the fry line');
    });
});

test('nothing throws, at a tray icon or at a tablet', function () {
  NAMES.forEach(function (name) {
    STATES[name].forEach(function (o) {
      SIZES.forEach(function (s) {
        assert.doesNotThrow(function () { draw(name, o, s[0], s[1]); },
          name + ' ' + JSON.stringify(o) + ' at ' + s[0] + 'x' + s[1]);
      });
    });
  });
});

test('no piece emits NaN or Infinity into the context', function () {
  NAMES.forEach(function (name) {
    STATES[name].forEach(function (o) {
      SIZES.forEach(function (s) {
        var bad = draw(name, o, s[0], s[1]).log.filter(function (l) { return l.indexOf('BAD:') >= 0; });
        assert.strictEqual(bad.length, 0,
          name + ' ' + JSON.stringify(o) + ' at ' + s[0] + 'x' + s[1] + ': ' + bad.slice(0, 3).join(' '));
      });
    });
  });
});

test('every piece hands the context back the way it found it', function () {
  NAMES.forEach(function (name) {
    STATES[name].forEach(function (o) {
      SIZES.forEach(function (s) {
        var g = draw(name, o, s[0], s[1]);
        var where = name + ' ' + JSON.stringify(o) + ' at ' + s[0] + 'x' + s[1];
        assert.strictEqual(g.depth, 0, where + ' left ' + g.depth + ' save(s) open');
        assert.strictEqual(g.floor, 0, where + ' restored past its own first save');
      });
    });
  });
});

test('a clip is never the last thing left on the stack', function () {
  // clip() outside a save/restore pair is the one that poisons whatever the
  // game draws next, so it is worth asserting separately from the balance.
  NAMES.forEach(function (name) {
    STATES[name].forEach(function (o) {
      var g = draw(name, o), depth = 0, open = 0;
      g.log.forEach(function (l) {
        if (l.indexOf('save(') === 0) depth++;
        else if (l.indexOf('restore(') === 0) { if (depth > 0) depth--; else open--; }
        else if (l.indexOf('clip(') === 0 && depth === 0) open++;
      });
      assert.strictEqual(open, 0, name + ' ' + JSON.stringify(o) + ' clips outside a save/restore');
    });
  });
});

test('the same piece drawn twice is identical to the byte', function () {
  NAMES.forEach(function (name) {
    STATES[name].forEach(function (o) {
      var a = draw(name, o).log.join('|');
      var b = draw(name, o).log.join('|');
      assert.strictEqual(a, b, name + ' ' + JSON.stringify(o) + ' is not deterministic');
    });
  });
});

test('no wobble comes from Math.random or the clock', function () {
  var src = NAMES.map(function (n) {
    return (n === 'sack' || n === 'cutter' || n === 'fryer' ? Art.scene[n] : Art.item[n]).toString();
  }).join('') + Art.item.stick.toString();
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src),
    'a fry piece reads a random or a clock, so a still machine will shiver between frames');
});

/*
 * The point of the handoff notes is that the caller can drive the art with a
 * number. A parameter that leaves the tape untouched is a parameter the
 * drawing never read - and it fails silently forever, because the picture
 * still looks fine, just always the same.
 */
test('every documented state value actually changes the drawing', function () {
  var cases = [
    ['sack',     { open: 0 },                    { open: 1 }],
    ['sack',     { count: 0 },                   { count: 1 }],
    ['sack',     {},                             { label: 'SPUDS' }],
    ['sack',     {},                             { sub: '25 KG' }],
    ['cutter',   { spin: 0 },                    { spin: 2.1 }],
    ['cutter',   { load: 0 },                    { load: 1 }],
    ['cutter',   { out: 0 },                     { out: 1 }],
    ['fryer',    { hot: 0, t: 1 },               { hot: 1, t: 1 }],
    ['fryer',    { hot: 1, t: 1 },               { hot: 1, t: 2.5 }],
    ['fryer',    { hot: 1, t: 1 },               { hot: 1, t: 1, temp: '165' }],
    ['fryer',    { hot: 1, t: 1, slots: [{ down: 0, fries: 0.8 }] },
                 { hot: 1, t: 1, slots: [{ down: 1, fries: 0.8 }] }],
    ['fryer',    { hot: 1, t: 1, slots: [{ fries: 0.2 }] },
                 { hot: 1, t: 1, slots: [{ fries: 1 }] }],
    ['potato',   { peeled: 0 },                  { peeled: 1 }],
    ['potato',   { seed: 1 },                    { seed: 2 }],
    ['friesRaw', { cooked: 0 },                  { cooked: 1 }],
    ['friesRaw', { n: 6 },                       { n: 30 }],
    ['basket',   { fries: 0 },                   { fries: 1 }],
    ['basket',   { fries: 1, cooked: 0 },        { fries: 1, cooked: 1 }],
    ['basket',   { fries: 1 },                   { fries: 1, handle: false }],
    ['basket',   { fries: 1, lean: -1 },         { fries: 1, lean: 1 }],
    ['friesBox', { fries: 0 },                   { fries: 1 }],
    ['friesBox', { fries: 1 },                   { fries: 1, brand: 'BURG' }],
    ['cup',      { flavor: 'cola' },             { flavor: 'cola', clear: true }],
    ['cup',      { flavor: 'cola', lid: 'dome' }, { flavor: 'cola', lid: 'flat' }],
    ['cup',      { flavor: 'cola', lid: 'dome' }, { flavor: 'cola', lid: false }],
    ['cup',      { flavor: 'cola' },             { flavor: 'cola', straw: false }],
    ['cup',      { flavor: 'cola', clear: true, fill: 0.2 },
                 { flavor: 'cola', clear: true, fill: 0.9 }]
  ];
  cases.forEach(function (c) {
    var a = draw(c[0], c[1]).log.join('|');
    var b = draw(c[0], c[2]).log.join('|');
    assert.notStrictEqual(a, b,
      c[0] + ': ' + JSON.stringify(c[1]) + ' draws exactly the same as ' + JSON.stringify(c[2]));
  });
});

test('the six flavours are six different cups', function () {
  var seen = {};
  Art.FLAVOR_IDS.forEach(function (id) {
    var tapeStr = draw('cup', { flavor: id }).log.join('|');
    assert.ok(!seen[tapeStr], id + ' draws the same cup as ' + seen[tapeStr]);
    seen[tapeStr] = id;
  });
});

test('an unknown flavour falls back to cola rather than throwing', function () {
  assert.doesNotThrow(function () { draw('cup', { flavor: 'kombucha' }); });
  assert.strictEqual(draw('cup', { flavor: 'kombucha' }).log.join('|'),
                     draw('cup', { flavor: 'cola' }).log.join('|'));
});

/*
 * The straight sides are load-bearing. trace() runs a quadratic through the
 * midpoint of every edge, so a four-point trapezoid never reaches its own
 * corners and the carton comes out a lozenge with FRIES hanging off the
 * bottom. `edged` walks midpoints along each edge to hold the shape; if it
 * ever goes away, the carton's ink outline collapses back towards its centre.
 */
test('the straight-sided pieces carry enough points to stay straight', function () {
  // The first filled contour of each of these is the panel in question. A bare
  // trapezoid gives trace() four points and comes out a lozenge; edged() walks
  // midpoints along every edge, so the count is what to assert on - the control
  // points themselves sit on the corners either way, and say nothing.
  function firstContourPoints(name, o) {
    var log = draw(name, o, 200, 220).log;
    var i0 = log.indexOf('beginPath()'), i1 = log.indexOf('fill()');
    assert.ok(i0 >= 0 && i1 > i0, name + ' never filled a shape');
    return log.slice(i0, i1).filter(function (l) { return l.indexOf('quadraticCurveTo') === 0; }).length;
  }
  [['friesBox', { fries: 0 }, 'the fry carton'],
   ['basket',   { fries: 0 }, 'the wire basket'],
   ['cutter',   {},           "the cutter's funnel"]
  ].forEach(function (c) {
    var n = firstContourPoints(c[0], c[1]);
    assert.ok(n >= 12, c[2] + ' is traced through only ' + n +
      ' points, so trace() will round it into a blob');
  });
});

/* ------------------------------------------ the freezer and the fountain */

/*
 * A context that remembers where things were drawn.
 *
 * The handoff's promise for both machines is that they contain themselves -
 * "넘긴 상자 안에 스스로를 다 담고" - which is the property that decides
 * whether two machines standing next to each other collide. Anything drawn
 * inside a clip is skipped: the clip path was itself measured, and its
 * contents cannot escape it.
 */
function bboxTape() {
  var t = tape();
  var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  var clip = 0, stack = [];
  function pt(x, y) {
    if (clip || !isFinite(x) || !isFinite(y)) return;
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  }
  ['moveTo', 'lineTo'].forEach(function (m) {
    var real = t[m];
    t[m] = function (x, y) { pt(x, y); real.apply(t, arguments); };
  });
  var qc = t.quadraticCurveTo;
  t.quadraticCurveTo = function (cx, cy, x, y) { pt(cx, cy); pt(x, y); if (qc) qc.apply(t, arguments); };
  ['rect', 'fillRect', 'strokeRect'].forEach(function (m) {
    var real = t[m];
    t[m] = function (x, y, w, h) { pt(x, y); pt(x + w, y + h); if (real) real.apply(t, arguments); };
  });
  var arc = t.arc;
  t.arc = function (x, y, r) { pt(x - r, y - r); pt(x + r, y + r); if (arc) arc.apply(t, arguments); };
  var ell = t.ellipse;
  t.ellipse = function (x, y, rx, ry) { pt(x - rx, y - ry); pt(x + rx, y + ry); if (ell) ell.apply(t, arguments); };
  var sv = t.save, rs = t.restore, cl = t.clip;
  t.save = function () { stack.push(clip); sv.apply(t, arguments); };
  t.restore = function () { if (stack.length) clip = stack.pop(); rs.apply(t, arguments); };
  t.clip = function () { clip++; if (cl) cl.apply(t, arguments); };
  t.bbox = b;
  return t;
}

var COLD_STATES = [
  ['freezer', { open: 0 }],
  ['freezer', { open: 1, t: 2.4 }],
  ['freezer', { open: 1, grab: 1, t: 2.4 }],
  ['freezer', { open: 0.5, grab: 0.5, t: 0.3 }],
  ['dispenser', { pour: 0, fill: 0, cup: false }],
  ['dispenser', { active: 0, pour: 1, fill: 0.35, t: 1.1 }],
  ['dispenser', { active: 2, pour: 1, fill: 0.9, t: 3.7 }],
  ['dispenser', { flavors: ['cola', 'cider'], active: 1, pour: 1, fill: 0.4, t: 0.8 }],
  ['dispenser', { flavors: [], active: 0, pour: 0, cup: false }]
];

// the sizes they are actually given: the fry supply row and the drink column
// on a phone, on a tablet, and the roomy ones the handoff drew them at
var COLD_SIZES = [[68, 36], [92, 48], [71, 90], [92, 118], [330, 320], [250, 370]];

test('the freezer and the fountain are registered and never throw', function () {
  ['freezer', 'dispenser'].forEach(function (k) {
    assert.strictEqual(typeof Art.scene[k], 'function', 'Art.scene.' + k + ' is missing');
  });
  assert.strictEqual(typeof Art.item.fryBag, 'function', 'Art.item.fryBag is missing');

  COLD_SIZES.forEach(function (sz) {
    COLD_STATES.forEach(function (st, i) {
      var g = tape();
      assert.doesNotThrow(function () {
        Art.scene[st[0]](g, 0, 0, sz[0], sz[1], st[1]);
      }, sz.join('x') + ' ' + st[0] + '#' + i + ' threw');
      assert.strictEqual(g.depth, 0, sz.join('x') + ' ' + st[0] + '#' + i + ' leaked a save()');
      assert.strictEqual(g.floor, 0, sz.join('x') + ' ' + st[0] + '#' + i + ' over-restored');
      assert.ok(!/NaN|Infinity/.test(g.log.join('|')),
        sz.join('x') + ' ' + st[0] + '#' + i + ' emitted NaN into the context');
    });
  });
});

test('neither machine draws outside the box it was handed', function () {
  COLD_SIZES.forEach(function (sz) {
    var W = sz[0], H = sz[1];
    COLD_STATES.forEach(function (st, i) {
      var g = bboxTape();
      Art.scene[st[0]](g, 10, 20, W, H, st[1]);
      var b = g.bbox;
      if (!isFinite(b.x0)) return;                 // drew nothing measurable
      var at = sz.join('x') + ' ' + st[0] + '#' + i + ': ';
      // a stroke straddles its path, so allow half of the widest line
      var slack = Math.max(2.5, Math.min(W, H) * 0.06);
      assert.ok(b.x0 >= 10 - slack, at + 'ran ' + (10 - b.x0).toFixed(1) + 'px off the left');
      assert.ok(b.y0 >= 20 - slack, at + 'ran ' + (20 - b.y0).toFixed(1) + 'px off the top');
      assert.ok(b.x1 <= 10 + W + slack, at + 'ran ' + (b.x1 - 10 - W).toFixed(1) + 'px off the right');
      assert.ok(b.y1 <= 20 + H + slack, at + 'ran ' + (b.y1 - 20 - H).toFixed(1) + 'px off the bottom');
    });
  });
});

test('a spout with nothing plumbed to it draws as a spout, not as a question mark', function () {
  // two flavours in a three-column machine is the shop's first week
  var two = draw2('dispenser', { flavors: ['cola', 'cider'], active: 0, pour: 0 }, 250, 370);
  var three = draw2('dispenser', { flavors: ['cola', 'cider', 'orange'], active: 0, pour: 0 }, 250, 370);
  assert.ok(!/\?/.test(two.log.join('|')), 'an unplumbed spout drew a question mark');
  assert.notStrictEqual(two.log.join('|'), three.log.join('|'),
    'a two-flavour machine should not draw the same as a three-flavour one');
});

test('the cold machines hold still when nothing is moving', function () {
  var a = draw2('freezer', { open: 0, t: 1 }, 200, 200).log.join('|');
  var b = draw2('freezer', { open: 0, t: 9 }, 200, 200).log.join('|');
  assert.strictEqual(a, b, 'a shut freezer shimmered between frames');

  var c = draw2('dispenser', { pour: 0, fill: 0.5, t: 1 }, 200, 300).log.join('|');
  var d = draw2('dispenser', { pour: 0, fill: 0.5, t: 9 }, 200, 300).log.join('|');
  assert.strictEqual(c, d, 'an idle fountain shimmered between frames');

  // ...and that the clock DOES reach the parts that move
  var e = draw2('dispenser', { pour: 1, fill: 0.5, t: 1 }, 200, 300).log.join('|');
  var f = draw2('dispenser', { pour: 1, fill: 0.5, t: 9 }, 200, 300).log.join('|');
  assert.notStrictEqual(e, f, 'the stream is not animating at all');
});

function draw2(name, o, w, h) {
  var g = tape();
  Art.scene[name](g, 0, 0, w, h, o);
  return g;
}

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
