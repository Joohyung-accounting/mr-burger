/* art-prep.js - cutting board, knives and sliced vegetables, drawn with the
 * same pen as art.js. Load AFTER art.js (order against art-fries-drinks.js
 * does not matter). It hangs itself on the existing Art object:
 *
 *   Art.scene.board     (ctx, x, y, w, h, o)   butcher-block board, top-down-ish
 *   Art.scene.boardSeat (x, y, w, h, o)        where things stand on that board
 *   Art.scene.prep      (ctx, x, y, w, h, o)   board + veg + knife, mid-chop
 *   Art.item.knife      (ctx, cx, cy, len, o)  chef / santoku / paring / cleaver
 *   Art.item.vegWhole   (ctx, cx, cy, r, o)    the uncut vegetable (art.js art)
 *   Art.item.vegSlice   (ctx, cx, cy, r, o)    ONE slice, seen face-on
 *   Art.item.vegCut     (ctx, cx, cy, w, o)    a fanned row of slices
 *   Art.VEG_IDS         ['tomato','onion','pickle','lettuce','jalapeno']
 *   Art.KNIVES          ['chef','santoku','paring','cleaver']
 *
 * Every wobble comes from Art.hash(seed), never Math.random, so a board redrawn
 * each frame keeps the same grain and the same knife scars.
 */
(function (root) {
  'use strict';

  var MARK = '_prepArt';

  function apply(A) {
    if (A && A.ink && !A[MARK]) {
      try { install(A); A[MARK] = true; }
      catch (e) { if (typeof console !== 'undefined') console.warn('[art-prep]', e); }
    }
    return A;
  }

  /* art.js ends with a wholesale `root.Art = {...}`, and helmet scripts can be
   * evaluated more than once, so a later art.js throws away whatever we hung on
   * the old object. We CHAIN onto any accessor already installed (art-fries-
   * drinks.js installs one) instead of replacing it, so both extension modules
   * re-attach - in load order - every time a fresh Art lands. */
  var prev = Object.getOwnPropertyDescriptor(root, 'Art');
  var store = prev && !prev.get ? prev.value : undefined;
  try {
    Object.defineProperty(root, 'Art', {
      configurable: true,
      enumerable: true,
      get: prev && prev.get ? prev.get : function () { return store; },
      set: function (v) {
        if (prev && prev.set) prev.set.call(root, v); else store = v;
        apply(prev && prev.get ? prev.get.call(root) : store);
      }
    });
  } catch (e) { /* fall through to the watchdog */ }
  apply(root.Art);

  /* last resort: if a module loaded later replaces the accessor outright, this
   * still puts us back. One property read per tick - cheap.
   *
   * unref'd where that exists: in a browser this is a timer on a page that is
   * running anyway, but in Node it is a handle that keeps the process alive,
   * and 4000 ticks at 150ms is ten minutes of a test runner refusing to exit. */
  var ticks = 0, iv = setInterval(function () {
    if (root.Art && root.Art.ink && !root.Art[MARK]) apply(root.Art);
    if (++ticks > 4000) clearInterval(iv);
  }, 150);
  if (iv && typeof iv.unref === 'function') iv.unref();

  function install(Art) {

  var ink = Art.ink, hatch = Art.hatch, trace = Art.trace, jitter = Art.jitter,
      rectPts = Art.rectPts, ellPts = Art.ellPts, blobPts = Art.blobPts,
      hash = Art.hash, mix = Art.mixHex, letters = Art.ui.letters;

  var TAU = Math.PI * 2;

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy) || 1e-6; }
  function along(a, b, d) { var k = d / dist(a, b); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
  function qbez(a, p, b, t) {
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * p[0] + t * t * b[0],
            u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]];
  }

  /** trace() curves through every point, so a sparse outline rounds into a
   * blob. Subdividing each segment keeps straight runs straight. */
  function dens(pts, per) {
    var o = [], i, k;
    for (i = 0; i < pts.length - 1; i++) {
      for (k = 0; k < per; k++) {
        o.push([lerp(pts[i][0], pts[i + 1][0], k / per), lerp(pts[i][1], pts[i + 1][1], k / per)]);
      }
    }
    o.push(pts[pts.length - 1]);
    return o;
  }

  /** Rounded polygon through arbitrary corners - the board is a trapezoid. */
  function roundPoly(corners, rad, amt, seed) {
    var pts = [], n = corners.length, c, i;
    for (c = 0; c < n; c++) {
      var p = corners[c], pr = corners[(c + n - 1) % n], nx = corners[(c + 1) % n];
      var a = along(p, pr, Math.min(rad, dist(p, pr) * 0.45));
      var b = along(p, nx, Math.min(rad, dist(p, nx) * 0.45));
      for (i = 0; i <= 4; i++) pts.push(qbez(a, p, b, i / 4));
    }
    return jitter(pts, amt, seed);
  }

  /** Open wobbled polyline, stroked twice - same pen as the rest of the set. */
  function line(ctx, pts, color, width, alpha, seed) {
    var al = alpha === undefined ? 0.88 : alpha, i;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = al;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.globalAlpha = al * 0.30;
    ctx.lineWidth = width * 0.66;
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      ctx.lineTo(pts[i][0] + (hash(seed * 31 + i * 7) - 0.5) * width,
                 pts[i][1] + (hash(seed * 37 + i * 11) - 0.5) * width);
    }
    ctx.stroke();
    ctx.restore();
  }

  function shadow(ctx, cx, cy, rx, ry, a, seed) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#3f2a1c';
    trace(ctx, ellPts(cx, cy, rx, ry, 18, rx * 0.03, seed));
    ctx.fill();
    ctx.restore();
  }

  /* ================================================================= board */

  var WOODS = {
    maple:  { face: '#ecd0a0', alt: '#e2c089', edge: '#c89c5f', line: '#8a5f34', grain: '#c49a63', deep: '#a9793f' },
    walnut: { face: '#b58353', alt: '#a67442', edge: '#8a5a30', line: '#503319', grain: '#7d5128', deep: '#6d4420' },
    olive:  { face: '#dcbe84', alt: '#cfad6c', edge: '#ab8c4c', line: '#6d5423', grain: '#a8873f', deep: '#8d6f34' }
  };

  function boardGeom(x, y, w, h) {
    var th = h * 0.125;
    var topY = y + h * 0.055;
    var topH = h - h * 0.055 - th - h * 0.055;
    return {
      cx: x + w * 0.5, topY: topY, topH: topH, th: th,
      topW: w * 0.905, botW: w * 0.985,
      baseY: topY + topH * 0.70
    };
  }

  /**
   * Where things stand on the board. Callers place a vegetable with its bottom
   * on `baseY` and keep it between x0 and x1 to stay clear of the handle hole.
   */
  function boardSeat(x, y, w, h, o) {
    var g = boardGeom(x, y, w, h);
    var side = (o && o.handleSide === 'left') ? -1 : 1;
    var hx = (o && o.handle === false) ? 0 : w * 0.115;
    var x0 = x + w * 0.085 + (side < 0 ? hx : 0);
    var x1 = x + w * 0.915 - (side > 0 ? hx : 0);
    return {
      x0: x0, x1: x1, w: x1 - x0, cx: (x0 + x1) / 2,
      y0: g.topY + g.topH * 0.16, y1: g.topY + g.topH * 0.94,
      baseY: g.baseY, h: g.topH, topY: g.topY
    };
  }

  /**
   * The board. (x, y, w, h) is the whole footprint, shadow included.
   *   o.wood        'maple' | 'walnut' | 'olive'
   *   o.handle      hole at one end, default true
   *   o.handleSide  'right' (default) | 'left'
   *   o.groove      juice groove, default true
   *   o.scars   0..1  knife marks worn into the surface, default 0.55
   *   o.wet     0..1  juice smears
   *   o.juice   smear colour, default tomato red
   *   o.brand   burnt-in mark, default 'MR.B'; '' for none
   */
  function drawBoard(ctx, x, y, w, h, o) {
    o = o || {};
    var W = WOODS[o.wood] || WOODS.maple;
    var s = o.seed === undefined ? 1201 : o.seed, i, k;
    var g = boardGeom(x, y, w, h);
    var lw = Math.max(1, w * 0.0095);
    var handle = o.handle === undefined ? true : o.handle;
    var side = o.handleSide === 'left' ? -1 : 1;
    var scars = o.scars === undefined ? 0.55 : o.scars;

    var topL = g.cx - g.topW / 2, topR = g.cx + g.topW / 2;
    var botL = g.cx - g.botW / 2, botR = g.cx + g.botW / 2;
    var y0 = g.topY, y1 = g.topY + g.topH;
    var rad = w * 0.045;

    shadow(ctx, g.cx + w * 0.005, y1 + g.th * 0.92, g.botW * 0.50, h * 0.045, 0.17, s + 1);

    // slab thickness: the same trapezoid dropped by th, so only the front lip shows
    var edgeShape = roundPoly([[topL, y0 + g.th], [topR, y0 + g.th],
                               [botR, y1 + g.th], [botL, y1 + g.th]], rad, w * 0.004, s + 2);
    ink(ctx, edgeShape, W.edge, { lw: lw, off: w * 0.004, line: W.line, seed: s + 2 });
    hatch(ctx, edgeShape, W.deep, s + 3, { n: 4, alpha: 0.22, gap: w * 0.028 });

    var top = roundPoly([[topL, y0], [topR, y0], [botR, y1], [botL, y1]], rad, w * 0.004, s + 4);
    ink(ctx, top, W.face, { lw: lw, off: w * 0.005, line: W.line, seed: s + 4 });

    // butcher block: lengthwise staves, every other one a shade darker
    ctx.save();
    trace(ctx, top);
    ctx.clip();
    var staves = 5;
    for (i = 0; i < staves; i++) {
      var a = i / staves, b = (i + 1) / staves;
      var ya = lerp(y0, y1, a), yb = lerp(y0, y1, b);
      var wa = lerp(g.topW, g.botW, a) / 2, wbn = lerp(g.topW, g.botW, b) / 2;
      if (i % 2) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = W.alt;
        trace(ctx, jitter([[g.cx - wa, ya], [g.cx + wa, ya], [g.cx + wbn, yb], [g.cx - wbn, yb]], w * 0.004, s + 10 + i));
        ctx.fill();
        ctx.restore();
      }
      // the seam between staves, then grain inside it
      if (i) {
        line(ctx, jitter([[g.cx - wa * 1.05, ya], [g.cx - wa * 0.2, ya + h * 0.004],
                          [g.cx + wa * 0.5, ya - h * 0.003], [g.cx + wa * 1.05, ya]], w * 0.003, s + 20 + i),
             W.line, lw * 0.55, 0.30, s + 20 + i);
      }
      for (k = 0; k < 3; k++) {
        var gy = lerp(ya, yb, 0.22 + k * 0.28 + (hash(s * 3 + i * 7 + k) - 0.5) * 0.12);
        var gw = lerp(wa, wbn, 0.5) * (0.55 + hash(s * 5 + i * 11 + k) * 0.40);
        var gx = g.cx + (hash(s * 7 + i * 13 + k) - 0.5) * wa * 0.6;
        var pts = [];
        for (var q = 0; q <= 6; q++) {
          pts.push([gx - gw + (gw * 2) * (q / 6),
                    gy + Math.sin(q * 1.1 + i + k) * h * 0.006]);
        }
        line(ctx, pts, W.grain, lw * 0.45, 0.20 + hash(s + i * 3 + k) * 0.12, s + 30 + i * 5 + k);
      }
    }

    // knife scars: short pale nicks clustered where the blade actually lands
    for (i = 0; i < Math.round(26 * scars); i++) {
      var sx = g.cx + (hash(s * 11 + i) - 0.55) * g.botW * 0.62;
      var sy = lerp(y0 + g.topH * 0.20, y1 - g.topH * 0.10, hash(s * 13 + i));
      var sl = w * (0.02 + hash(s * 17 + i) * 0.075);
      var sa = (hash(s * 19 + i) - 0.5) * 0.5 + (hash(s * 23 + i) > 0.75 ? 1.45 : 0);
      line(ctx, [[sx - Math.cos(sa) * sl, sy - Math.sin(sa) * sl],
                 [sx + Math.cos(sa) * sl, sy + Math.sin(sa) * sl]],
           hash(s * 29 + i) > 0.5 ? W.line : '#fff6e2',
           lw * 0.5, 0.16 + hash(s * 31 + i) * 0.22, s + 60 + i);
    }

    // juice soaked into the grain
    if (o.wet > 0.02) {
      for (i = 0; i < 5; i++) {
        ctx.save();
        ctx.globalAlpha = 0.10 * o.wet + hash(s * 41 + i) * 0.05 * o.wet;
        ctx.fillStyle = o.juice || '#c0392b';
        trace(ctx, blobPts(g.cx + (hash(s * 43 + i) - 0.5) * g.botW * 0.55,
                           lerp(y0 + g.topH * 0.3, y1 - g.topH * 0.12, hash(s * 47 + i)),
                           w * (0.02 + hash(s * 53 + i) * 0.045), w * (0.012 + hash(s * 59 + i) * 0.03),
                           4, 0.30, hash(s + i) * 6, 16, w * 0.004, s + 70 + i));
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // juice groove, inset and stopping short of the handle end
    if (o.groove !== false) {
      var gi = w * 0.052, gt = g.topH * 0.115;
      var hIn = handle ? w * 0.115 : 0;
      var gL = topL + gi + (side < 0 ? hIn : 0), gR = topR - gi - (side > 0 ? hIn : 0);
      var gBL = botL + gi + (side < 0 ? hIn : 0), gBR = botR - gi - (side > 0 ? hIn : 0);
      var gr = roundPoly([[gL, y0 + gt], [gR, y0 + gt], [gBR, y1 - gt], [gBL, y1 - gt]],
                         rad * 0.8, w * 0.003, s + 80);
      line(ctx, gr.concat([gr[0]]), W.line, lw * 0.85, 0.42, s + 80);
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = '#fff6e2';
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      for (i = 0; i < gr.length; i++) ctx.lineTo(gr[i][0], gr[i][1] + lw * 0.9);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // hanging hole
    if (handle) {
      var hx = g.cx + side * (g.botW * 0.5 - w * 0.058);
      var hy = lerp(y0, y1, 0.46);
      var hr = w * 0.028;
      ink(ctx, ellPts(hx, hy, hr, hr * 1.06, 18, hr * 0.10, s + 90), W.deep,
          { lw: lw * 0.8, off: w * 0.003, line: W.line, seed: s + 90 });
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#fff6e2';
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.arc(hx, hy, hr * 0.72, 2.4, 4.4);
      ctx.stroke();
      ctx.restore();
    }

    var brand = o.brand === undefined ? 'MR.B' : o.brand;
    if (brand) {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.translate(g.cx - side * g.botW * 0.34, y1 - g.topH * 0.11);
      ctx.rotate(-0.05);
      letters(ctx, brand, 0, 0, g.topH * 0.11, {
        fill: W.line, weight: 0.15, track: 0.16, seed: s + 95, tilt: 0.04
      });
      ctx.restore();
    }

    return boardSeat(x, y, w, h, o);
  }

  /* ================================================================ knife */

  /* Normalised blade outlines. `piv` is where along the edge the blade rocks on
   * the board - the local origin sits there, so rotating lifts the handle and
   * leaves the contact point put. Spine runs heel -> tip, edge runs tip -> heel. */
  var KNIFE = {
    chef: {
      bl: 0.615, bol: 0.052, hl: 0.333, bh: 0.225, hh: 0.60, hy: 0.52, piv: 0.30, grip: 'wood',
      spine: [[1, -1], [0.82, -1.02], [0.62, -1.00], [0.45, -0.94], [0.30, -0.82], [0.17, -0.62], [0.07, -0.34], [0, -0.07]],
      edge: [[0.04, 0.00], [0.12, 0.010], [0.24, 0.016], [0.40, 0.013], [0.62, 0.006], [0.84, 0.001], [1, 0]]
    },
    santoku: {
      bl: 0.600, bol: 0.048, hl: 0.352, bh: 0.255, hh: 0.55, hy: 0.50, piv: 0.24, grip: 'wood', dimple: 1,
      spine: [[1, -1], [0.75, -1.02], [0.50, -1.01], [0.31, -0.99], [0.18, -0.94], [0.09, -0.82], [0.035, -0.62], [0.005, -0.34]],
      edge: [[0.00, -0.06], [0.05, 0.004], [0.20, 0.010], [0.45, 0.012], [0.70, 0.006], [1, 0]]
    },
    paring: {
      bl: 0.520, bol: 0.042, hl: 0.438, bh: 0.150, hh: 0.92, hy: 0.55, piv: 0.34, grip: 'dark',
      spine: [[1, -1], [0.78, -0.99], [0.55, -0.93], [0.36, -0.80], [0.20, -0.58], [0.08, -0.30], [0, -0.06]],
      edge: [[0.05, 0.004], [0.25, 0.018], [0.55, 0.016], [0.80, 0.007], [1, 0]]
    },
    cleaver: {
      bl: 0.585, bol: 0.048, hl: 0.367, bh: 0.440, hh: 0.30, hy: 0.74, piv: 0.26, grip: 'dark', hole: 1,
      spine: [[1, -1], [0.70, -1.01], [0.35, -1.01], [0.13, -1.00], [0.035, -0.93], [0.005, -0.78]],
      edge: [[0.00, -0.04], [0.04, 0.006], [0.30, 0.012], [0.65, 0.010], [1, 0]]
    }
  };

  /**
   * A knife lying along the x axis, handle to the right. (cx, cy) is the point
   * of the edge that rests on the board, so a rock-chop is one rotation.
   *   o.type   'chef' (default) | 'santoku' | 'paring' | 'cleaver'
   *   o.lift   0..1  0 = edge flat on the board, 1 = handle raised to chop
   *   o.angle  radians, overrides lift
   *   o.flip   true  = tip to the right instead (left-handed / mirrored)
   *   o.juice  colour smeared on the blade, e.g. '#c0392b'
   *   o.shine  0..1, default 1
   */
  function drawKnife(ctx, cx, cy, len, o) {
    o = o || {};
    var K = KNIFE[o.type] || KNIFE.chef;
    var s = o.seed === undefined ? 1301 : o.seed, i;
    var lift = o.lift === undefined ? 0 : cl(o.lift, 0, 1);
    var ang = o.angle === undefined ? -lift * 0.62 : o.angle;
    var flip = o.flip ? -1 : 1;
    var lw = Math.max(0.9, len * 0.011);
    var bl = K.bl * len, bh = K.bh * len, bol = K.bol * len, hl = K.hl * len;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang * flip);
    ctx.scale(flip, 1);
    ctx.translate(-K.piv * bl, 0);

    var steel = '#dde5ea', steelDark = '#9fb1bc', steelLine = '#5b6f7a';
    function scaled(list) {
      var o = [], j;
      for (j = 0; j < list.length; j++) o.push([list[j][0] * bl, list[j][1] * bh]);
      return o;
    }
    var spinePts = dens(scaled(K.spine), 6);
    var edgePts = dens(scaled(K.edge), 6);

    // blade body: spine heel -> tip, then edge tip -> heel
    var body = jitter(spinePts.concat(edgePts), len * 0.003, s);
    ink(ctx, body, steel, { lw: lw * 1.15, off: len * 0.0035, line: steelLine, seed: s });
    hatch(ctx, body, steelDark, s + 1, { n: 3, alpha: 0.13, gap: len * 0.035 });

    // the bevel: a bright band riding the cutting edge - the bit that says sharp
    var eh = bh * 0.19, bev = edgePts.slice(), j2;
    for (j2 = edgePts.length - 1; j2 >= 0; j2--) {
      bev.push([edgePts[j2][0], edgePts[j2][1] - eh * (0.35 + 0.65 * (edgePts[j2][0] / bl))]);
    }
    ink(ctx, jitter(bev, len * 0.002, s + 2), '#f7fbfd',
        { lw: lw * 0.5, off: len * 0.0015, line: '#b9c8d1', lineAlpha: 0.5, seed: s + 2 });

    // spine, drawn heavier than the rest of the outline
    line(ctx, jitter(spinePts, len * 0.002, s + 3), steelLine, lw * 1.05, 0.55, s + 3);

    // reflections
    var sh = o.shine === undefined ? 1 : o.shine;
    if (sh > 0.03) {
      for (i = 0; i < 3; i++) {
        var t0 = 0.22 + i * 0.24;
        line(ctx, [[bl * t0, -bh * 0.78], [bl * (t0 + 0.055), -bh * 0.30]],
             '#ffffff', lw * (1.5 - i * 0.3), 0.34 * sh, s + 10 + i);
      }
    }
    if (K.dimple) {
      for (i = 0; i < 5; i++) {
        ink(ctx, ellPts(bl * (0.16 + i * 0.16), -bh * 0.42, bh * 0.075, bh * 0.10, 12, bh * 0.01, s + 20 + i),
            'rgba(150,172,186,0.45)', { lw: 0 });
      }
    }
    if (K.hole) {
      ink(ctx, ellPts(bl * 0.20, -bh * 0.80, bh * 0.075, bh * 0.075, 14, bh * 0.008, s + 25),
          '#c3d0d8', { lw: lw * 0.7, line: steelLine, seed: s + 25 });
    }

    // maker's mark near the heel
    ctx.save();
    ctx.globalAlpha = 0.42;
    letters(ctx, 'MR.B', bl * 0.78, -bh * 0.62, Math.min(bh * 0.20, len * 0.048), {
      fill: '#5b6f7a', weight: 0.16, track: 0.10, seed: s + 30, tilt: 0.03
    });
    ctx.restore();

    // juice on the blade
    if (o.juice) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = o.juice;
      for (i = 0; i < 4; i++) {
        trace(ctx, blobPts(bl * (0.18 + hash(s * 61 + i) * 0.6), -bh * (0.10 + hash(s * 67 + i) * 0.35),
                           bh * 0.10, bh * 0.16, 4, 0.35, hash(s + i) * 6, 14, bh * 0.012, s + 40 + i));
        ctx.fill();
      }
      ctx.restore();
    }

    // bolster
    var hy = -bh * K.hy;
    var hh = bh * K.hh;
    ink(ctx, rectPts(bl - lw, hy - hh * 0.62, bol + lw * 2, hh * 1.24, hh * 0.22, len * 0.003, s + 50),
        '#c6d2d9', { lw: lw * 0.9, off: len * 0.003, line: steelLine, seed: s + 50 });

    // handle: tapers out to a slightly fatter butt
    var hx0 = bl + bol, hx1 = hx0 + hl;
    var grip = K.grip === 'dark' ? { f: '#4e4a46', l: '#28241f', hi: 'rgba(255,255,255,0.22)' }
                                 : { f: '#a9743f', l: '#5f3c18', hi: 'rgba(255,240,214,0.35)' };
    if (o.handleColor) grip = { f: o.handleColor, l: mix(o.handleColor, '#2a1c10', 0.55), hi: 'rgba(255,255,255,0.25)' };
    var H = jitter([
      [hx0, hy - hh * 0.50], [hx0 + hl * 0.30, hy - hh * 0.56],
      [hx0 + hl * 0.72, hy - hh * 0.58], [hx1 - hh * 0.22, hy - hh * 0.52],
      [hx1, hy - hh * 0.18], [hx1, hy + hh * 0.20],
      [hx1 - hh * 0.22, hy + hh * 0.54], [hx0 + hl * 0.72, hy + hh * 0.60],
      [hx0 + hl * 0.30, hy + hh * 0.58], [hx0, hy + hh * 0.52]
    ], len * 0.004, s + 55);
    ink(ctx, H, grip.f, { lw: lw * 1.1, off: len * 0.004, line: grip.l, seed: s + 55 });
    hatch(ctx, H, grip.l, s + 56, { n: 3, alpha: 0.16, gap: len * 0.03 });
    line(ctx, [[hx0 + hl * 0.12, hy - hh * 0.36], [hx1 - hh * 0.30, hy - hh * 0.40]],
         grip.hi, lw * 1.3, 0.7, s + 57);
    for (i = 0; i < 3; i++) {
      var rx = hx0 + hl * (0.24 + i * 0.26);
      ink(ctx, ellPts(rx, hy, hh * 0.10, hh * 0.10, 12, hh * 0.008, s + 60 + i),
          '#cdd6db', { lw: lw * 0.6, line: '#6b7a83', seed: s + 60 + i });
    }

    ctx.restore();
  }

  /* ============================================================ vegetables */

  var VEG = {
    tomato: { juice: '#c0392b', r: 0.98, thin: 0.30 },
    onion: { juice: '#efe6d2', r: 0.95, thin: 0.26 },
    pickle: { juice: '#7fa63a', r: 0.92, thin: 0.22 },
    lettuce: { juice: '#8dc25a', r: 0.72, thin: 0.34, shred: 1 },
    jalapeno: { juice: '#4f8f34', r: 0.62, thin: 0.20 }
  };

  /** One slice, face-on, centred on (cx, cy) with radius r. */
  function drawSlice(ctx, cx, cy, r, o) {
    o = o || {};
    var id = o.id || 'tomato';
    var s = o.seed === undefined ? 1401 : o.seed, i;
    var lw = Math.max(0.7, r * 0.13);
    var sq = o.squash === undefined ? 1 : o.squash;

    ctx.save();
    ctx.translate(cx, cy);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(1, sq);

    if (id === 'lettuce') {
      // a shred, not a disc: a frilly ribbon
      var top = [], bot = [], n = 9;
      for (i = 0; i <= n; i++) {
        var t = i / n, xx = -r + 2 * r * t;
        top.push([xx, -r * 0.30 - Math.sin(t * 7 + s) * r * 0.16 - hash(s * 7 + i) * r * 0.10]);
      }
      for (i = n; i >= 0; i--) {
        var t2 = i / n, x2 = -r + 2 * r * t2;
        bot.push([x2, r * 0.16 + Math.sin(t2 * 5 + s * 0.5) * r * 0.08]);
      }
      var rib = jitter(top.concat(bot), r * 0.03, s);
      ink(ctx, rib, '#9ecb63', { lw: lw * 0.8, off: r * 0.04, line: '#4f8f34', seed: s });
      for (i = 0; i < 3; i++) {
        line(ctx, [[-r * 0.8 + i * r * 0.7, -r * 0.20], [-r * 0.6 + i * r * 0.7, r * 0.10]],
             '#dff0c4', lw * 0.5, 0.5, s + i);
      }
      ctx.restore();
      return;
    }

    if (id === 'onion') {
      var disc = ellPts(0, 0, r, r * 0.97, 26, r * 0.035, s);
      ink(ctx, disc, '#fdf6e6', { lw: lw, off: r * 0.05, line: o.purple ? '#8f6ba8' : '#c9b48c', seed: s });
      for (i = 0; i < 4; i++) {
        var rr = r * (0.82 - i * 0.19);
        line(ctx, ellPts(0, 0, rr, rr * 0.96, 22, r * 0.018, s + 5 + i).concat([[rr, 0]]),
             o.purple ? mix('#a98bbf', '#e8dcc4', i / 4) : '#dccfb2', lw * 0.62, 0.85, s + 5 + i);
      }
      ink(ctx, ellPts(0, 0, r * 0.10, r * 0.09, 10, r * 0.01, s + 9), '#efe4cc', { lw: lw * 0.5, line: '#c9b48c', seed: s + 9 });
      ctx.restore();
      return;
    }

    if (id === 'pickle') {
      // crinkle-cut: the radius ripples
      var chip = [];
      for (i = 0; i < 34; i++) {
        var a = i / 34 * TAU;
        var rr2 = r * (0.94 + Math.sin(a * 9) * 0.055);
        chip.push([Math.cos(a) * rr2, Math.sin(a) * rr2 * 0.97]);
      }
      chip = jitter(chip, r * 0.015, s);
      ink(ctx, chip, '#b9cf62', { lw: lw, off: r * 0.045, line: '#4f7a2a', seed: s });
      ink(ctx, ellPts(0, 0, r * 0.60, r * 0.58, 20, r * 0.03, s + 2), '#dbe79b', { lw: 0 });
      for (i = 0; i < 6; i++) {
        var a2 = hash(s * 11 + i) * TAU, d2 = r * (0.14 + hash(s * 13 + i) * 0.32);
        ink(ctx, ellPts(Math.cos(a2) * d2, Math.sin(a2) * d2 * 0.9, r * 0.055, r * 0.075, 10, r * 0.006, s + 20 + i),
            '#eef3c8', { lw: lw * 0.4, line: '#7fa63a', seed: s + 20 + i });
      }
      hatch(ctx, chip, '#4f7a2a', s + 3, { n: 3, alpha: 0.14, gap: r * 0.22 });
      ctx.restore();
      return;
    }

    if (id === 'jalapeno') {
      var ring = ellPts(0, 0, r, r * 0.96, 22, r * 0.03, s);
      ink(ctx, ring, '#5fa73c', { lw: lw, off: r * 0.05, line: '#2f5c1c', seed: s });
      ink(ctx, ellPts(0, 0, r * 0.62, r * 0.58, 18, r * 0.025, s + 1), '#f3f6de',
          { lw: lw * 0.6, line: '#8fbf6a', seed: s + 1 });
      for (i = 0; i < 3; i++) {
        ink(ctx, ellPts((hash(s * 7 + i) - 0.5) * r * 0.6, (hash(s * 11 + i) - 0.5) * r * 0.5,
                        r * 0.10, r * 0.08, 10, r * 0.008, s + 30 + i),
            '#f0dc8a', { lw: lw * 0.35, line: '#b79a3a', seed: s + 30 + i });
      }
      ctx.restore();
      return;
    }

    // tomato
    var d = ellPts(0, 0, r, r * 0.97, 28, r * 0.03, s);
    ink(ctx, d, '#e2584a', { lw: lw * 1.1, off: r * 0.055, line: '#a32b1f', seed: s });
    line(ctx, ellPts(0, 0, r * 0.87, r * 0.845, 24, r * 0.02, s + 1).concat([[r * 0.87, 0]]),
         '#c0392b', lw * 0.7, 0.55, s + 1);
    var star = [];
    for (i = 0; i < 44; i++) {
      var sa = i / 44 * TAU;
      var sr = r * (0.24 + 0.26 * Math.pow(Math.abs(Math.cos(sa * 2.5)), 1.6));
      star.push([Math.cos(sa) * sr, Math.sin(sa) * sr * 0.96]);
    }
    ink(ctx, jitter(star, r * 0.022, s + 2), '#f8ddc4', { lw: lw * 0.45, line: '#e8b79a', lineAlpha: 0.6, seed: s + 2 });
    for (i = 0; i < 5; i++) {
      var pa = (i / 5) * TAU + 0.62;
      var px = Math.cos(pa) * r * 0.56, py = Math.sin(pa) * r * 0.54;
      ink(ctx, ellPts(px, py, r * 0.165, r * 0.13, 14, r * 0.013, s + 40 + i), '#f0a08c',
          { lw: lw * 0.4, line: '#c9584a', lineAlpha: 0.7, seed: s + 40 + i });
      for (var q2 = 0; q2 < 2; q2++) {
        ink(ctx, ellPts(px + (q2 - 0.5) * r * 0.14, py + (hash(s + i * 3 + q2) - 0.5) * r * 0.10,
                        r * 0.052, r * 0.038, 10, r * 0.005, s + 50 + i * 2 + q2),
            '#f6e3a8', { lw: lw * 0.3, line: '#c9a44a', seed: s + 50 + i * 2 + q2 });
      }
    }
    ink(ctx, ellPts(-r * 0.34, -r * 0.36, r * 0.24, r * 0.11, 12, r * 0.02, s + 7),
        'rgba(255,246,222,0.42)', { lw: 0 });
    ctx.restore();
  }

  /** The uncut vegetable, using the same art the ingredient crates use. */
  function drawVegWhole(ctx, cx, cy, r, o) {
    o = o || {};
    var id = o.id || 'tomato';
    if (o.shadow !== false) shadow(ctx, cx, cy + r * 0.92, r * 0.86, r * 0.16, 0.16, 1501);
    ctx.save();
    ctx.translate(cx, cy);
    if (o.tilt) ctx.rotate(o.tilt);
    if (o.squash) ctx.scale(1, o.squash);
    ctx.translate(-r, -r);
    Art.drawPortrait(ctx, id, r * 2, r * 2);
    ctx.restore();
  }

  /**
   * A row of slices fanned across width w, newest on top.
   *   o.id, o.n (default 5), o.lean tilt spread, o.squash (default 0.86)
   */
  function drawVegCut(ctx, cx, cy, w, o) {
    o = o || {};
    var id = o.id || 'tomato';
    var V = VEG[id] || VEG.tomato;
    var n = o.n === undefined ? 5 : Math.max(1, Math.round(o.n));
    var s = o.seed === undefined ? 1601 : o.seed, i;
    var r = (o.r === undefined ? w / (n * 0.52 + 0.9) : o.r) * V.r;
    var step = n > 1 ? (w - r * 2) / (n - 1) : 0;
    var sq = o.squash === undefined ? 0.86 : o.squash;
    for (i = 0; i < n; i++) {
      var x = cx - w / 2 + r + step * i;
      var lean = (o.lean === undefined ? 0.16 : o.lean) * ((i / Math.max(1, n - 1)) - 0.5) * 2;
      shadow(ctx, x + r * 0.06, cy + r * sq * 0.92, r * 0.80, r * 0.13, 0.13, s + i);
      drawSlice(ctx, x, cy, r, {
        id: id, seed: s + i * 7, rot: lean + (hash(s * 3 + i) - 0.5) * 0.10,
        squash: sq, purple: o.purple
      });
    }
  }

  /* ============================================================ prep scene */

  /*
   * Phase 0 is the edge in the wood. A chop hangs at the top, accelerates on
   * the way down and stops dead - so the fall is q*q (fastest at contact) and
   * there is a real dwell at both ends. The previous curve fell with exponent
   * 0.62, an ease-out, which decelerated the blade into the board.
   */
  function chopPhase(t) {
    var p = (t * 1.55) % 1;
    if (p < 0.09) return 1;
    if (p < 0.66) { var u = (p - 0.09) / 0.57; return (1 - u) * (1 - u); }
    if (p < 0.76) return 0;
    var q = (p - 0.76) / 0.24;
    return q * q;
  }

  /**
   * The whole chopping station in one call. (x, y, w, h) is the true footprint -
   * the top ~30% is headroom the raised knife swings into, so the board sits low.
   *   o.veg    'tomato' | 'onion' | 'pickle' | 'lettuce' | 'jalapeno'
   *   o.cut    0..1  whole vegetable -> nothing left but slices
   *   o.left   0..1  how much of the PILE remains; defaults to o.cut
   *   o.chop   0..1  0 = knife up, 1 = edge on the board (overrides o.t)
   *   o.t      seconds, drives a rock-chop cycle when o.chop is absent
   *   o.hit    0..1  impact spray; defaults to being derived from o.chop
   *   o.hitSeed      integer, re-seeds the spray so strikes differ
   *   o.knife  knife type, o.board  options passed to Art.scene.board
   */
  function drawPrep(ctx, x, y, w, h, o) {
    o = o || {};
    var head = h * 0.30;
    var bo = o.board || {};
    var seat = drawBoard(ctx, x, y + head, w, h - head, bo);
    var id = o.veg || 'tomato';
    var V = VEG[id] || VEG.tomato;
    // with no cut given, an animated station eats through the vegetable one
    // chop at a time and starts a fresh one - 8 chops to the loop
    var cut = o.cut !== undefined ? cl(o.cut, 0, 1)
            : (o.t === undefined ? 0.45 : cl((Math.floor(o.t * 1.55) % 8) / 7, 0, 1));
    var chop = o.chop === undefined ? (o.t === undefined ? 0.2 : chopPhase(o.t)) : cl(o.chop, 0, 1);
    var s = 1701, i;

    /*
     * The width cap was 0.150, which suited the long counter this used to be
     * drawn on. As a column fixture beside the plates the board is about half
     * that wide, and 0.150 shrank the vegetable to something you could not
     * identify. The height cap still governs on a wide board, so nothing that
     * was already legible grows.
     */
    var R = Math.min(seat.h * 0.44, seat.w * 0.200) * V.r;
    var vegX = seat.x0 + seat.w * 0.66;
    var vegY = seat.baseY - R * 0.86;
    // the cut face eats rightwards through the vegetable as cut climbs
    var faceX = vegX - R + cut * R * 1.92;
    // How much of the PILE is left, which is not the same question as how far
    // the blade got. While chopping they agree; once the board is full and the
    // cook starts drawing portions off it, only `left` falls. Defaults to
    // `cut`, so a caller that does not know about portions is unaffected.
    var left = o.left === undefined ? cut : cl(o.left, 0, 1);
    var pileW = seat.w * 0.44 * (0.32 + left * 0.68);
    var pileX = seat.x0 + pileW / 2 + seat.w * 0.015;
    var nSlices = Math.max(1, Math.round(1 + left * 5));

    if (cut > 0.02 && left > 0.02) {
      drawVegCut(ctx, pileX, seat.baseY - R * 0.70, pileW, {
        id: id, n: nSlices, r: R * 0.82, seed: s + 10, squash: 0.88
      });
    }

    // knife in front of the finished slices, behind the piece still being cut
    var len = seat.w * 0.62;
    var px = faceX - R * 0.18;
    var py = seat.baseY;
    /*
     * The blade has to actually travel. drawKnife only ROTATES about (cx, cy),
     * so with a fixed pivot the knife see-sawed - the tip drove down into the
     * board as the handle came up - and `lift` bottomed out at 0.14, meaning
     * the edge never lay flat even at full contact. Lift the pivot as well,
     * and let the angle reach zero.
     */
    var rise = (1 - chop) * R * 0.55;
    drawKnife(ctx, px, py - rise, len, {
      type: o.knife || 'chef', lift: 0.86 * (1 - chop), seed: 1301,
      juice: cut > 0.15 ? V.juice : null
    });

    // what is left of the vegetable, with a cut face where the blade went
    if (cut < 0.96) {
      shadow(ctx, (faceX + vegX + R) / 2, seat.baseY + R * 0.04, (vegX + R - faceX) * 0.46, R * 0.13, 0.16, s);
      ctx.save();
      ctx.beginPath();
      ctx.rect(faceX, y, x + w - faceX, h);
      ctx.clip();
      drawVegWhole(ctx, vegX, vegY, R, { id: id, shadow: false });
      ctx.restore();
      // the cross-section, foreshortened and shrinking as the blade nears the
      // end. The 0.05 floor used to keep a sliver of cut face on the silhouette
      // of a vegetable nothing had touched yet - let it grow from nothing.
      if (cut > 0.03) {
        var u = cl((faceX - vegX) / R, -1, 0.95);
        ctx.save();
        ctx.translate(faceX, vegY);
        ctx.scale(V.thin + 0.06, Math.sqrt(Math.max(0, 1 - u * u)));
        drawSlice(ctx, 0, 0, R * 0.84, { id: id, seed: s + 3 });
        ctx.restore();
      }
    }

    // impact: juice jumps off the edge and the board takes a tap
    /*
     * Driven off the landing when the caller can say where the landing is.
     * Derived from the blade's height it was symmetric about contact, so half
     * the spray came off a vegetable the knife had not reached yet.
     */
    var hit = o.hit !== undefined ? cl(o.hit, 0, 1)
            : (chop > 0.90 ? (chop - 0.90) / 0.10 : 0);
    if (hit > 0) {
      // re-seeded per strike, so four identical rays do not replay every swing
      var hs = s * 7 + (o.hitSeed || 0) * 31;
      ctx.save();
      ctx.globalAlpha = 0.5 * hit;
      ctx.strokeStyle = V.juice;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, R * 0.055);
      for (i = 0; i < 4; i++) {
        var a = -2.55 + i * 0.40 + (hash(hs + i * 3 + 1) - 0.5) * 0.26;
        var d = R * (0.45 + hash(hs + i) * 0.45);
        // off the cut face rather than the pivot, and falling as it goes out
        ctx.beginPath();
        ctx.moveTo(faceX + Math.cos(a) * d * 0.45, py + Math.sin(a) * d * 0.45);
        ctx.lineTo(faceX + Math.cos(a) * d, py + Math.sin(a) * d * 0.82);
        ctx.stroke();
      }
      ctx.restore();
    }
    return seat;
  }

  /* ------------------------------------------------------------- register */
  Art.scene = Art.scene || {};
  Art.scene.board = drawBoard;
  Art.scene.boardSeat = boardSeat;
  Art.scene.prep = drawPrep;

  Art.item = Art.item || {};
  Art.item.knife = drawKnife;
  Art.item.vegWhole = drawVegWhole;
  Art.item.vegSlice = drawSlice;
  Art.item.vegCut = drawVegCut;

  Art.VEG_IDS = ['tomato', 'onion', 'pickle', 'lettuce', 'jalapeno'];
  Art.KNIVES = ['chef', 'santoku', 'paring', 'cleaver'];
  Art.WOODS = ['maple', 'walnut', 'olive'];
  }
})(typeof self !== 'undefined' ? self : this);
