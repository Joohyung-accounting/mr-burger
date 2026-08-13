/*
 * Mr. Burger - fry station & 16oz drinks, drawn with the same pen as art.js.
 *
 * Load AFTER art.js. It reads the exported toolkit (ink / hatch / rectPts /
 * ellPts / blobPts / ui.letters) and hangs new pieces off the existing
 * namespaces, so nothing in art.js has to move:
 *
 *   Art.scene.sack      (ctx, x, y, w, h, o)   burlap potato sack
 *   Art.scene.cutter    (ctx, x, y, w, h, o)   hand-crank peeler / julienne cutter
 *   Art.scene.fryer     (ctx, x, y, w, h, o)   two-well deep fryer
 *   Art.item.potato     (ctx, cx, cy, r, o)    one potato (raw or peeled)
 *   Art.item.friesRaw   (ctx, cx, cy, w, o)    a handful of pale cut sticks
 *   Art.item.basket     (ctx, x, y, w, h, o)   wire fry basket, optionally full
 *   Art.item.friesBox   (ctx, x, y, w, h, o)   the carton that goes on the tray
 *   Art.item.cup        (ctx, x, y, w, h, o)   16oz cup, paper or clear
 *
 * Every wobble comes from Art.hash(seed), never Math.random, so a machine that
 * is not animating holds perfectly still between frames. The only arguments
 * that change per frame are o.t (seconds, for bubbles and steam), o.spin
 * (crank phase) and the 0..1 state numbers.
 */
(function (root) {
  'use strict';

  var Art = root.Art;
  if (!Art) { if (typeof console !== 'undefined') console.warn('art-fries-drinks.js: load art.js first'); return; }

  var ink = Art.ink, hatch = Art.hatch, trace = Art.trace, jitter = Art.jitter,
      rectPts = Art.rectPts, ellPts = Art.ellPts, blobPts = Art.blobPts,
      hash = Art.hash, mix = Art.mixHex, letters = Art.ui.letters, textW = Art.ui.width;

  var TAU = Math.PI * 2;

  function wob(seed, i) { return hash(seed * 733 + i * 61 + 17) - 0.5; }
  function poly(list, amt, seed) { return jitter(list.slice(), amt, seed); }

  /*
   * trace() runs a quadratic through the midpoint of every edge, so a shape
   * only ever passes NEAR the points it is given. Four points is not enough
   * for a trapezoid: the curve cuts every corner at once and the carton comes
   * out a lozenge with its label hanging off the bottom. drawCup already works
   * around it by walking midpoints along the brand band by hand - `edged` is
   * that trick as a function, so the fry carton, the basket and the cutter's
   * funnel keep the straight sides they are drawn with. Corners stay soft,
   * because one segment of rounding is what makes them look drawn.
   */
  function edged(list, per) {
    per = per || 4;
    var out = [], i, k, a, b;
    for (i = 0; i < list.length; i++) {
      a = list[i]; b = list[(i + 1) % list.length];
      for (k = 0; k < per; k++) {
        out.push([a[0] + (b[0] - a[0]) * (k / per), a[1] + (b[1] - a[1]) * (k / per)]);
      }
    }
    return out;
  }

  /** Open wobbled polyline, stroked twice like every other line in this set. */
  function line(ctx, pts, color, width, alpha, seed) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha === undefined ? 0.88 : alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.globalAlpha = (alpha === undefined ? 0.88 : alpha) * 0.32;
    ctx.lineWidth = width * 0.68;
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      ctx.lineTo(pts[i][0] + wob(seed || 3, i * 2) * width * 0.9,
                 pts[i][1] + wob(seed || 3, i * 2 + 1) * width * 0.9);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Steam / heat: three wisps rising, phase-shifted. */
  function wisps(ctx, cx, y, w, h, amount, t, seed, color) {
    if (amount <= 0.04) return;
    ctx.save();
    ctx.globalAlpha = 0.34 * amount;
    ctx.strokeStyle = color || '#f2e7d6';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, h * 0.045);
    for (var i = 0; i < 3; i++) {
      var ph = t * 0.9 + i * 2.1;
      ctx.globalAlpha = 0.34 * amount * (0.55 + 0.45 * Math.sin(ph));
      ctx.beginPath();
      for (var k = 0; k <= 6; k++) {
        ctx.lineTo(cx + (i - 1) * w * 0.30 + Math.sin(ph + k * 0.8) * w * 0.075,
                   y - k * h / 6);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- potato */

  /**
   * One potato. (cx, cy) is the centre, r the long radius.
   *   o.peeled 0..1   raw skin -> clean pale flesh
   *   o.seed          change it and you get a differently-lumpy potato
   */
  function drawPotato(ctx, cx, cy, r, o) {
    o = o || {};
    var s = o.seed === undefined ? 301 : o.seed;
    var peeled = o.peeled || 0;
    var lw = Math.max(0.9, r * 0.11), i;
    var skin = mix('#d2a86e', '#f2e4bd', peeled);
    var edge = mix('#8a5f34', '#c4a878', peeled);

    var body = blobPts(cx, cy, r, r * 0.72, 3, 0.085, s * 0.31, 22, r * 0.045, s);
    ink(ctx, body, skin, { lw: lw, off: r * 0.045, line: edge, seed: s });
    hatch(ctx, body, mix('#8a5f34', '#d8c496', peeled), s, { n: 5, alpha: 0.20, gap: r * 0.26 });

    // eyes: little crescent nicks, the one mark that says potato and not stone
    for (i = 0; i < 4; i++) {
      var a = hash(s * 7 + i) * TAU, d = 0.30 + hash(s * 11 + i) * 0.42;
      var ex = cx + Math.cos(a) * r * d, ey = cy + Math.sin(a) * r * 0.70 * d;
      ctx.save();
      ctx.globalAlpha = 0.55 - peeled * 0.42;
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = lw * 0.72;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.09, a + 0.6, a + 3.0);
      ctx.stroke();
      ctx.restore();
    }
    if (peeled < 0.5) {
      for (i = 0; i < 5; i++) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#6b4a2a';
        trace(ctx, ellPts(cx + (hash(s * 13 + i) - 0.5) * r * 1.2,
                          cy + (hash(s * 17 + i) - 0.5) * r * 0.9,
                          r * 0.055, r * 0.04, 8, r * 0.012, s + 40 + i));
        ctx.fill();
        ctx.restore();
      }
    }
    // a single pale highlight so it reads round
    ink(ctx, ellPts(cx - r * 0.30, cy - r * 0.28, r * 0.26, r * 0.14, 12, r * 0.02, s + 5),
        'rgba(255,246,222,0.50)', { lw: 0 });
  }

  /* --------------------------------------------------------------- sack */

  /**
   * The burlap sack the potatoes come out of. (x, y) top-left of the box.
   *   o.open   0..1  mouth folded shut -> gaping with potatoes at the lip
   *   o.count  how full it looks (0..1, default 1)
   *   o.label  stencil text, default 'POTATO'
   */
  function drawSack(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 811, lw = Math.max(1, w * 0.016), i;
    var open = o.open === undefined ? 1 : o.open;
    var fill = o.count === undefined ? 1 : o.count;
    var neckY = y + h * (0.20 - open * 0.045);
    var slump = 1 - fill * 0.35;

    // contact shadow
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#3f2a1c';
    trace(ctx, ellPts(x + w * 0.52, y + h * 0.965, w * 0.50, h * 0.055, 18, w * 0.008, s + 2));
    ctx.fill();
    ctx.restore();

    var body = poly([
      [x + w * 0.360, neckY],
      [x + w * 0.300, y + h * 0.245],
      [x + w * 0.190, y + h * 0.365],
      [x + w * 0.118, y + h * 0.520],
      [x + w * 0.100, y + h * 0.720 * slump + h * 0.02],
      [x + w * 0.135, y + h * 0.895],
      [x + w * 0.230, y + h * 0.972],
      [x + w * 0.500, y + h * 0.988],
      [x + w * 0.775, y + h * 0.968],
      [x + w * 0.870, y + h * 0.888],
      [x + w * 0.902, y + h * 0.712 * slump + h * 0.02],
      [x + w * 0.884, y + h * 0.515],
      [x + w * 0.812, y + h * 0.360],
      [x + w * 0.702, y + h * 0.243],
      [x + w * 0.640, neckY]
    ], w * 0.014, s);

    ink(ctx, body, '#d9c298', { lw: lw, off: w * 0.010, line: '#8a6f47', seed: s });
    hatch(ctx, body, '#8a6f47', s, { n: 7, alpha: 0.16, gap: h * 0.10 });

    // burlap weave - a coarse cross-hatch, clipped, kept faint so the stencil reads
    ctx.save();
    trace(ctx, body);
    ctx.clip();
    ctx.strokeStyle = '#a88a5e';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.7, w * 0.008);
    for (i = 0; i < 16; i++) {
      ctx.globalAlpha = 0.16 + hash(s * 3 + i) * 0.10;
      var yy = y + h * 0.16 + i * h * 0.055;
      ctx.beginPath();
      for (var c = 0; c <= 5; c++) ctx.lineTo(x + w * 0.02 + c * w * 0.196, yy + wob(s + i, c) * h * 0.012);
      ctx.stroke();
    }
    for (i = 0; i < 11; i++) {
      ctx.globalAlpha = 0.11 + hash(s * 5 + i) * 0.08;
      var xx = x + w * 0.05 + i * w * 0.092;
      ctx.beginPath();
      for (c = 0; c <= 4; c++) ctx.lineTo(xx + wob(s + 60 + i, c) * w * 0.010, y + h * 0.18 + c * h * 0.21);
      ctx.stroke();
    }
    ctx.restore();

    // stencilled label on the belly, faded the way a printed sack is
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.translate(x + w * 0.50, y + h * 0.665);
    ctx.rotate(-0.035);
    letters(ctx, o.label === undefined ? 'POTATO' : o.label, 0, 0, h * 0.115, {
      fill: '#6b5433', weight: 0.145, track: 0.12, seed: s + 7, tilt: 0.03, wobble: 0.035
    });
    letters(ctx, o.sub === undefined ? '10 KG' : o.sub, 0, h * 0.165, h * 0.072, {
      fill: '#8a6f47', weight: 0.13, track: 0.20, seed: s + 8, tilt: 0.04
    });
    ctx.restore();

    // the folded / gaping mouth
    var lipY = neckY + h * 0.005;
    if (open > 0.35) {
      // rolled-down cuff first, so the dark mouth sits inside it
      var cuff = poly([
        [x + w * 0.295, lipY + h * 0.020], [x + w * 0.325, lipY - h * 0.036],
        [x + w * 0.50, lipY - h * 0.052], [x + w * 0.675, lipY - h * 0.036],
        [x + w * 0.705, lipY + h * 0.020], [x + w * 0.672, lipY + h * 0.062],
        [x + w * 0.50, lipY + h * 0.078], [x + w * 0.328, lipY + h * 0.062]
      ], w * 0.010, s + 13);
      ink(ctx, cuff, '#e2cda6', { lw: lw, off: w * 0.008, line: '#8a6f47', seed: s + 13 });
      hatch(ctx, cuff, '#8a6f47', s + 13, { n: 4, alpha: 0.22, gap: h * 0.024 });

      var mouth = ellPts(x + w * 0.502, lipY + h * 0.004, w * 0.170, h * 0.042, 16, w * 0.008, s + 12);
      ink(ctx, mouth, '#6b5334', { lw: lw * 0.9, line: '#42341f', seed: s + 12 });
      ink(ctx, ellPts(x + w * 0.502, lipY + h * 0.010, w * 0.140, h * 0.030, 14, w * 0.007, s + 17),
          '#4f3f27', { lw: 0 });

      // potatoes crowding the opening
      for (i = 0; i < 3; i++) {
        drawPotato(ctx, x + w * (0.385 + i * 0.115), lipY - h * (0.030 + hash(s + i) * 0.026),
                   w * 0.078, { seed: 320 + i * 9 });
      }
    } else {
      // tied shut: gathered neck + twine
      var neck = poly([
        [x + w * 0.335, lipY + h * 0.030], [x + w * 0.375, lipY - h * 0.070],
        [x + w * 0.50, lipY - h * 0.098], [x + w * 0.625, lipY - h * 0.070],
        [x + w * 0.665, lipY + h * 0.030]
      ], w * 0.012, s + 14);
      ink(ctx, neck, '#ddc79e', { lw: lw, off: w * 0.008, line: '#8a6f47', seed: s + 14 });
      line(ctx, poly([[x + w * 0.325, lipY], [x + w * 0.50, lipY + h * 0.014], [x + w * 0.675, lipY]], w * 0.006, s + 15),
           '#a4552f', lw * 1.15, 0.85, s + 15);
    }
  }

  /* ------------------------------------------------------------- cutter */

  /**
   * The hand-crank machine: potatoes go in the hopper, julienne sticks come out
   * of the chute. Cast body, wooden crank knob, blade grid you can see through
   * the front mouth.
   *   o.spin    radians (or seconds * speed) - turns the crank
   *   o.load    0..1  a potato sitting in the hopper
   *   o.out     0..1  sticks falling out of the chute
   */
  function drawCutter(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 857, lw = Math.max(1, w * 0.014), i;
    var spin = o.spin || 0;
    var out = o.out || 0;

    // hopper: an open funnel on top
    var hop = poly(edged([
      [x + w * 0.215, y + h * 0.045], [x + w * 0.605, y + h * 0.045],
      [x + w * 0.545, y + h * 0.240], [x + w * 0.275, y + h * 0.240]
    ]), w * 0.012, s + 1);
    ink(ctx, hop, '#b9c2c7', { lw: lw, off: w * 0.008, line: '#5d6b73', seed: s + 1 });
    hatch(ctx, hop, '#5d6b73', s + 1, { n: 5, alpha: 0.20, gap: h * 0.045 });
    var rim = ellPts(x + w * 0.410, y + h * 0.048, w * 0.195, h * 0.032, 18, w * 0.008, s + 2);
    ink(ctx, rim, '#2f3a40', { lw: lw, line: '#2b3439', seed: s + 2 });
    ink(ctx, ellPts(x + w * 0.410, y + h * 0.052, w * 0.156, h * 0.023, 16, w * 0.007, s + 3),
        '#1c2226', { lw: 0 });

    if (o.load) {
      ctx.save();
      ctx.globalAlpha = o.load;
      drawPotato(ctx, x + w * 0.410, y + h * 0.042, w * 0.100, { seed: 341 });
      ctx.restore();
    }

    // body
    var body = rectPts(x + w * 0.105, y + h * 0.225, w * 0.660, h * 0.535, h * 0.055, w * 0.007, s);
    ink(ctx, body, '#cfd6da', { lw: lw, off: w * 0.007, line: '#5d6b73', seed: s });
    hatch(ctx, body, '#5d6b73', s, { n: 7, alpha: 0.18, gap: h * 0.052 });

    // the blade mouth: a dark round port with a julienne grid across it
    var mcx = x + w * 0.335, mcy = y + h * 0.450, mr = w * 0.150;
    var mouth = ellPts(mcx, mcy, mr, mr * 0.98, 20, w * 0.006, s + 5);
    ink(ctx, mouth, '#2b3439', { lw: lw * 1.1, line: '#1c2226', seed: s + 5 });
    ctx.save();
    trace(ctx, mouth);
    ctx.clip();
    ctx.strokeStyle = '#e6edf1';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.9, w * 0.011);
    for (i = -3; i <= 3; i++) {
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(mcx + i * mr * 0.30, mcy - mr);
      ctx.lineTo(mcx + i * mr * 0.30 + wob(s + 5, i + 4) * mr * 0.05, mcy + mr);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mcx - mr, mcy + i * mr * 0.30);
      ctx.lineTo(mcx + mr, mcy + i * mr * 0.30 + wob(s + 6, i + 4) * mr * 0.05);
      ctx.stroke();
    }
    ctx.restore();
    ink(ctx, ellPts(mcx, mcy, mr * 1.06, mr * 1.04, 18, w * 0.006, s + 7), null,
        { lw: lw * 1.2, line: '#8fa3ae', lineAlpha: 0.75, seed: s + 7 });

    // maker's plate
    var pl = rectPts(x + w * 0.545, y + h * 0.320, w * 0.170, h * 0.080, h * 0.012, w * 0.005, s + 8);
    ink(ctx, pl, '#f0b429', { lw: lw * 0.8, line: '#8a6a1c', seed: s + 8 });
    letters(ctx, 'MR.B', x + w * 0.630, y + h * 0.381, h * 0.050, {
      fill: '#4a3226', weight: 0.15, track: 0.08, seed: s + 9, tilt: 0.04
    });

    // crank: hub, arm, wooden knob - the arm is the only thing that moves
    var hx = x + w * 0.800, hy = y + h * 0.545, ar = w * 0.140;
    ink(ctx, ellPts(hx, hy, w * 0.052, w * 0.052, 14, w * 0.005, s + 10),
        '#9aa5ac', { lw: lw, line: '#4a565d', seed: s + 10 });
    var kx = hx + Math.cos(spin) * ar, ky = hy + Math.sin(spin) * ar * 0.98;
    line(ctx, poly([[hx, hy], [kx, ky]], w * 0.006, s + 11), '#5d6b73', lw * 2.3, 0.92, s + 11);
    line(ctx, poly([[hx, hy], [kx, ky]], w * 0.006, s + 12), '#c9d2d7', lw * 0.9, 0.75, s + 12);
    ink(ctx, ellPts(kx, ky, w * 0.055, w * 0.052, 14, w * 0.005, s + 13),
        '#b5824a', { lw: lw, line: '#6b4423', seed: s + 13 });
    hatch(ctx, ellPts(kx, ky, w * 0.055, w * 0.052, 14, w * 0.005, s + 13), '#6b4423', s + 13,
          { n: 3, alpha: 0.26, gap: w * 0.026 });

    // chute + legs
    var chute = poly(edged([
      [x + w * 0.150, y + h * 0.740], [x + w * 0.430, y + h * 0.740],
      [x + w * 0.370, y + h * 0.885], [x + w * 0.078, y + h * 0.885]
    ]), w * 0.010, s + 15);
    ink(ctx, chute, '#b9c2c7', { lw: lw, off: w * 0.006, line: '#5d6b73', seed: s + 15 });
    hatch(ctx, chute, '#5d6b73', s + 15, { n: 4, alpha: 0.22, gap: h * 0.030 });
    ink(ctx, poly(edged([[x + w * 0.078, y + h * 0.885], [x + w * 0.370, y + h * 0.885],
                         [x + w * 0.358, y + h * 0.915], [x + w * 0.090, y + h * 0.915]]), w * 0.008, s + 16),
        '#2b3439', { lw: lw * 0.9, line: '#1c2226', seed: s + 16 });

    [0.22, 0.66].forEach(function (f, k) {
      line(ctx, poly([[x + w * (0.105 + f * 0.660), y + h * 0.755],
                      [x + w * (0.105 + f * 0.660) + (k ? w * 0.02 : -w * 0.02), y + h * 0.960]], w * 0.006, s + 20 + k),
           '#5d6b73', lw * 2.0, 0.9, s + 20 + k);
      ink(ctx, ellPts(x + w * (0.105 + f * 0.660) + (k ? w * 0.02 : -w * 0.02), y + h * 0.962,
                      w * 0.036, w * 0.020, 12, w * 0.004, s + 22 + k),
          '#3a3330', { lw: lw * 0.8, line: '#1c2226', seed: s + 22 + k });
    });

    // sticks tumbling out of the chute
    if (out > 0.04) {
      ctx.save();
      ctx.globalAlpha = out;
      for (i = 0; i < 5; i++) {
        var fx = x + w * (0.12 + hash(s * 31 + i) * 0.22);
        var fy = y + h * (0.905 + hash(s * 37 + i) * 0.075);
        stick(ctx, fx, fy, w * 0.090, w * 0.026, (hash(s * 41 + i) - 0.5) * 1.6, '#f2e0a8', '#c9ab6a', s + 50 + i);
      }
      ctx.restore();
    }
  }

  /* --------------------------------------------------------- fry sticks */

  /** One fry. (cx, cy) centre, len the long side, ang radians. */
  function stick(ctx, cx, cy, len, wid, ang, fill, edge, seed) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    var p = poly([
      [-len / 2, -wid / 2], [-len * 0.17, -wid * 0.56], [len * 0.17, -wid * 0.54], [len / 2, -wid / 2],
      [len / 2, wid / 2], [len * 0.17, wid * 0.56], [-len * 0.17, wid * 0.54], [-len / 2, wid / 2]
    ], wid * 0.11, seed);
    ink(ctx, p, fill, { lw: Math.max(0.7, wid * 0.40), off: wid * 0.07, line: edge, lineAlpha: 0.85, seed: seed });
    ctx.restore();
  }

  /**
   * A handful of cut sticks on the board. (cx, cy) is the centre of the pile.
   *   o.cooked 0..1  pale raw julienne -> golden fried
   */
  function drawFriesRaw(ctx, cx, cy, w, o) {
    o = o || {};
    var s = o.seed === undefined ? 877 : o.seed;
    var cooked = o.cooked || 0;
    var fill = mix('#f2e6b4', '#eeb43c', cooked);
    var edge = mix('#c9ab6a', '#a4692c', cooked);
    var n = o.n || 18;
    for (var i = 0; i < n; i++) {
      // julienne comes off the blade roughly parallel, then settles into a pile
      var a = (hash(s * 3 + i) - 0.5) * 0.85;
      stick(ctx, cx + (hash(s * 7 + i) - 0.5) * w * 0.34,
            cy + (hash(s * 11 + i) - 0.5) * w * 0.34,
            w * (0.44 + hash(s * 13 + i) * 0.14), w * 0.055, a, fill, edge, s + i);
    }
  }

  /* ------------------------------------------------------------- basket */

  /**
   * Wire fry basket. (x, y) top-left of the basket box; the handle rises out of
   * the top-right and is drawn ABOVE y.
   *   o.fries 0..1  how full     o.cooked 0..1  pale -> golden
   *   o.handle false to leave the handle off (baskets sitting in a rack)
   */
  function drawBasket(ctx, x, y, w, h, o) {
    o = o || {};
    var s = o.seed === undefined ? 883 : o.seed;
    var lw = Math.max(1, w * 0.016), i;
    var fries = o.fries === undefined ? 0 : o.fries;
    var cooked = o.cooked === undefined ? 1 : o.cooked;

    var body = poly(edged([
      [x + w * 0.035, y + h * 0.06], [x + w * 0.965, y + h * 0.06],
      [x + w * 0.845, y + h * 0.965], [x + w * 0.155, y + h * 0.965]
    ]), w * 0.012, s);

    // fries first: they sit inside and spill over the rim
    if (fries > 0.04) {
      ctx.save();
      trace(ctx, poly(edged([[x + w * 0.05, y - h * 0.16], [x + w * 0.95, y - h * 0.16],
                             [x + w * 0.85, y + h * 0.95], [x + w * 0.15, y + h * 0.95]]), w * 0.01, s + 1));
      ctx.clip();
      var count = Math.round(4 + fries * 12);
      for (i = 0; i < count; i++) {
        stick(ctx,
              x + w * (0.18 + hash(s * 17 + i) * 0.64),
              y + h * (0.72 - fries * 0.62 * (0.35 + hash(s * 19 + i) * 0.9)) + h * 0.10,
              w * (0.34 + hash(s * 23 + i) * 0.18), w * 0.056,
              (hash(s * 29 + i) - 0.5) * 2.2,
              mix('#f2e6b4', i % 3 ? '#eeb43c' : '#e09a2a', cooked),
              mix('#c9ab6a', '#a4692c', cooked), s + 60 + i);
      }
      ctx.restore();
    }

    // mesh, drawn as an open weave rather than a filled panel
    ctx.save();
    trace(ctx, body);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#8a9aa4';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, w * 0.011);
    for (i = -6; i <= 12; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.10 * i, y);
      ctx.lineTo(x + w * 0.10 * i + w * 0.55, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.10 * i + w * 0.55, y);
      ctx.lineTo(x + w * 0.10 * i, y + h);
      ctx.stroke();
    }
    ctx.restore();

    ink(ctx, body, null, { lw: lw * 1.15, line: '#5d6b73', seed: s });
    // rim and foot rails - the two heavy wires that hold the mesh
    line(ctx, poly([[x + w * 0.02, y + h * 0.065], [x + w * 0.98, y + h * 0.065]], w * 0.008, s + 3),
         '#4a565d', lw * 1.9, 0.92, s + 3);
    line(ctx, poly([[x + w * 0.145, y + h * 0.955], [x + w * 0.855, y + h * 0.955]], w * 0.008, s + 4),
         '#4a565d', lw * 1.5, 0.9, s + 4);

    if (o.handle !== false) {
      var d = o.lean < 0 ? -1 : 1;
      var hx = x + w * (d > 0 ? 0.885 : 0.115);
      line(ctx, poly([[hx, y + h * 0.10], [hx + d * w * 0.11, y - h * 0.30],
                      [hx + d * w * 0.21, y - h * 0.50]], w * 0.010, s + 5),
           '#4a565d', lw * 2.1, 0.92, s + 5);
      ctx.save();
      ctx.translate(hx + d * w * 0.245, y - h * 0.545);
      ctx.rotate(d * -0.60);
      ink(ctx, rectPts(d > 0 ? -w * 0.03 : -w * 0.24, -w * 0.052, w * 0.27, w * 0.104, w * 0.05, w * 0.006, s + 6),
          '#3a3330', { lw: lw, line: '#1c2226', seed: s + 6 });
      ctx.restore();
    }
  }

  /* -------------------------------------------------------------- fryer */

  /**
   * Two-well deep fryer. (x, y) top-left of the whole unit.
   *   o.hot    0..1   cold oil -> shimmering, bubbling
   *   o.t      seconds, for bubbles and steam
   *   o.slots  [{down 0..1, fries 0..1, cooked 0..1}, ...] up to 2 baskets
   *   o.temp   text on the dial, default '180'
   */
  function drawFryer(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 907, lw = Math.max(1, w * 0.011), i, k;
    var hot = o.hot === undefined ? 0 : o.hot;
    var t = o.t || 0;
    var slots = o.slots || [];

    // splash back
    var back = rectPts(x + w * 0.045, y, w * 0.91, h * 0.30, h * 0.035, w * 0.005, s + 1);
    ink(ctx, back, '#b9c2c7', { lw: lw, off: w * 0.004, line: '#5d6b73', seed: s + 1 });
    hatch(ctx, back, '#5d6b73', s + 1, { n: 5, alpha: 0.16, gap: h * 0.045 });

    // hanging rail across the back, where wet baskets drip
    line(ctx, poly([[x + w * 0.09, y + h * 0.235], [x + w * 0.91, y + h * 0.235]], w * 0.005, s + 2),
         '#4a565d', lw * 2.0, 0.9, s + 2);

    // cabinet
    var cab = rectPts(x, y + h * 0.28, w, h * 0.70, h * 0.045, w * 0.005, s);
    ink(ctx, cab, '#cfd6da', { lw: lw * 1.2, off: w * 0.004, line: '#5d6b73', seed: s });
    hatch(ctx, cab, '#5d6b73', s, { n: 8, alpha: 0.17, gap: h * 0.062 });

    // top deck: the two oil wells, drawn as recessed rectangles
    var deckY = y + h * 0.30;
    for (k = 0; k < 2; k++) {
      var wx = x + w * (0.055 + k * 0.475), ww = w * 0.415;
      var well = rectPts(wx, deckY, ww, h * 0.235, h * 0.020, w * 0.004, s + 10 + k);
      ink(ctx, well, '#8f9aa1', { lw: lw, line: '#3f4a51', seed: s + 10 + k });

      // the oil itself
      var oil = rectPts(wx + ww * 0.045, deckY + h * 0.022, ww * 0.91, h * 0.190, h * 0.014, w * 0.004, s + 14 + k);
      var oilCol = mix('#c9922e', '#e8b23c', hot);
      ink(ctx, oil, oilCol, { lw: lw * 0.8, line: '#8a5f1c', lineAlpha: 0.7, seed: s + 14 + k });
      ctx.save();
      trace(ctx, oil);
      ctx.clip();
      // surface sheen
      ink(ctx, ellPts(wx + ww * 0.34, deckY + h * 0.062, ww * 0.24, h * 0.026, 14, w * 0.004, s + 18 + k),
          'rgba(255,240,196,0.42)', { lw: 0 });
      // bubbles - the one thing that reads "it is frying"
      if (hot > 0.10) {
        for (i = 0; i < 9; i++) {
          var ph = (t * (0.6 + hash(s * 3 + i + k * 7) * 0.7) + hash(s * 5 + i + k * 7) * 3) % 1;
          var bx = wx + ww * (0.10 + hash(s * 7 + i + k * 11) * 0.80);
          var by = deckY + h * 0.205 - ph * h * 0.165;
          var br = ww * (0.012 + hash(s * 11 + i) * 0.020) * (0.5 + ph);
          ctx.save();
          ctx.globalAlpha = 0.55 * hot * (1 - ph * 0.65);
          ctx.strokeStyle = '#fff2ce';
          ctx.lineWidth = Math.max(0.7, br * 0.55);
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, TAU);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();

      // basket in this well
      var sl = slots[k];
      if (sl) {
        var down = sl.down === undefined ? 1 : sl.down;
        var bw = ww * 0.80, bh = h * 0.30;
        var bx2 = wx + ww * 0.10;
        var by2 = deckY - h * 0.20 + down * h * 0.185;
        ctx.save();
        // clip anything below the oil line so a lowered basket is really IN the oil
        ctx.beginPath();
        ctx.rect(x - w, y - h, w * 3, deckY + h * 0.215 - (y - h));
        ctx.clip();
        drawBasket(ctx, bx2, by2, bw, bh, {
          fries: sl.fries === undefined ? 0 : sl.fries,
          cooked: sl.cooked === undefined ? 1 : sl.cooked,
          lean: k === 0 ? -1 : 1,
          seed: 883 + k * 17
        });
        ctx.restore();
      }

      wisps(ctx, wx + ww * 0.5, deckY - h * 0.03, ww * 0.5, h * 0.24, hot * (slots[k] ? 1 : 0.55), t + k * 1.7, s + 30 + k);
    }

    // control panel on the front face
    var pyy = y + h * 0.615;
    var panel = rectPts(x + w * 0.055, pyy, w * 0.89, h * 0.22, h * 0.022, w * 0.004, s + 40);
    ink(ctx, panel, '#e2e8ec', { lw: lw, line: '#5d6b73', seed: s + 40 });

    // dial
    var dcx = x + w * 0.155, dcy = pyy + h * 0.110, dr = w * 0.055;
    ink(ctx, ellPts(dcx, dcy, dr, dr, 16, w * 0.004, s + 41), '#3a3330',
        { lw: lw, line: '#1c2226', seed: s + 41 });
    var da = -2.2 + hot * 2.6;
    line(ctx, [[dcx, dcy], [dcx + Math.cos(da) * dr * 0.78, dcy + Math.sin(da) * dr * 0.78]],
         '#f0b429', lw * 1.7, 0.95, s + 42);
    for (i = 0; i < 5; i++) {
      var ta = -2.5 + i * 0.72;
      line(ctx, [[dcx + Math.cos(ta) * dr * 1.22, dcy + Math.sin(ta) * dr * 1.22],
                 [dcx + Math.cos(ta) * dr * 1.42, dcy + Math.sin(ta) * dr * 1.42]],
           '#8fa3ae', lw * 1.0, 0.8, s + 43 + i);
    }

    letters(ctx, (o.temp === undefined ? '180' : o.temp) + '°', x + w * 0.335, dcy + h * 0.030, h * 0.088, {
      fill: hot > 0.6 ? '#c0562f' : '#5d6b73', weight: 0.14, track: 0.07, align: 'left', seed: s + 50
    });
    letters(ctx, 'FRYER', x + w * 0.905, dcy + h * 0.026, h * 0.070, {
      fill: '#8fa3ae', weight: 0.12, track: 0.20, align: 'right', seed: s + 51
    });

    // pilot lamp
    ink(ctx, ellPts(x + w * 0.615, dcy - h * 0.005, w * 0.026, w * 0.026, 12, w * 0.003, s + 52),
        hot > 0.15 ? '#e05a2a' : '#9aa5ac', { lw: lw * 0.9, line: '#3f4a51', seed: s + 52 });
    if (hot > 0.15) {
      ctx.save();
      ctx.globalAlpha = 0.30 * hot;
      ctx.fillStyle = '#ff8a3c';
      trace(ctx, ellPts(x + w * 0.615, dcy - h * 0.005, w * 0.055, w * 0.055, 14, w * 0.004, s + 53));
      ctx.fill();
      ctx.restore();
    }

    // feet
    [0.10, 0.90].forEach(function (f, j) {
      ink(ctx, rectPts(x + w * f - w * 0.035, y + h * 0.965, w * 0.07, h * 0.035, h * 0.010, w * 0.004, s + 60 + j),
          '#3a3330', { lw: lw * 0.9, line: '#1c2226', seed: s + 60 + j });
    });
  }

  /* ----------------------------------------------------------- fry box */

  /**
   * The red carton that goes on the tray. (x, y) top-left of the carton;
   * the fries poke out above y.
   *   o.fries 0..1   o.brand text on the front, default 'MR.B'
   */
  function drawFriesBox(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 941, lw = Math.max(1, w * 0.024), i;
    var fries = o.fries === undefined ? 1 : o.fries;

    // fries behind the front panel
    if (fries > 0.03) {
      var n = Math.round(6 + fries * 8);
      for (i = 0; i < n; i++) {
        var a = -1.57 + (hash(s * 3 + i) - 0.5) * 1.25;
        var fx = x + w * (0.22 + hash(s * 7 + i) * 0.56);
        var fy = y + h * 0.10 - hash(s * 11 + i) * h * fries * 0.26;
        stick(ctx, fx, fy, w * (0.40 + hash(s * 13 + i) * 0.20), w * 0.062, a,
              i % 3 ? '#eeb43c' : '#e6a02a', '#a4692c', s + 20 + i);
      }
    }

    // tapered carton
    var box = poly(edged([
      [x + w * 0.075, y], [x + w * 0.925, y],
      [x + w * 0.815, y + h * 0.985], [x + w * 0.185, y + h * 0.985]
    ]), w * 0.014, s);
    ink(ctx, box, '#c0392b', { lw: lw, off: w * 0.010, line: '#7d2018', seed: s });
    hatch(ctx, box, '#7d2018', s, { n: 5, alpha: 0.16, gap: h * 0.14 });

    // the pale band the brand sits on
    var band = poly(edged([
      [x + w * 0.098, y + h * 0.30], [x + w * 0.902, y + h * 0.30],
      [x + w * 0.868, y + h * 0.62], [x + w * 0.132, y + h * 0.62]
    ]), w * 0.012, s + 1);
    ink(ctx, band, '#f6efe0', { lw: lw * 0.7, off: w * 0.006, line: '#a4552f', lineAlpha: 0.7, seed: s + 1 });
    letters(ctx, o.brand === undefined ? 'MR.B' : o.brand, x + w * 0.5, y + h * 0.525, h * 0.185, {
      fill: '#c0392b', line: '#7d2018', weight: 0.15, track: 0.09, seed: s + 2, tilt: 0.03
    });
    letters(ctx, 'FRIES', x + w * 0.5, y + h * 0.83, h * 0.095, {
      fill: '#f6d8c4', weight: 0.13, track: 0.26, seed: s + 3, tilt: 0.04
    });
  }

  /* ------------------------------------------------------- 16 oz drinks */

  var FLAVORS = {
    cola:    { label: 'COLA',    band: '#a4352a', ink: '#fdf6e6', liquid: '#3d2118', foam: '#8a5a3c' },
    cider:   { label: 'CIDER',   band: '#2f8f6a', ink: '#f2fbf6', liquid: '#e4f4ea', foam: '#ffffff' },
    orange:  { label: 'ORANGE',  band: '#e07a1c', ink: '#3f2a1c', liquid: '#e8801f', foam: '#f7c07a' },
    lemon:   { label: 'LEMON',   band: '#e0c422', ink: '#4a3226', liquid: '#f0d84a', foam: '#fbf0a8' },
    root:    { label: 'ROOT',    band: '#6b4423', ink: '#f6efe0', liquid: '#4a2a16', foam: '#b58a5a' },
    tea:     { label: 'ICE TEA', band: '#a4602a', ink: '#fdf6e6', liquid: '#a4602a', foam: '#d2a06a' }
  };

  /**
   * 16 oz cup. (x, y, w, h) is the FULL box including lid and straw, so a row of
   * cups laid out on a grid lines up without the caller doing trigonometry.
   *   o.flavor  key of FLAVORS (default 'cola')
   *   o.clear   true -> PET cup, you see the drink and the ice through it
   *   o.lid     'dome' | 'flat' | false
   *   o.straw   true (default) | false
   *   o.fill    0..1 how much drink is in it (clear cups only), default 0.86
   */
  function drawCup(ctx, x, y, w, h, o) {
    o = o || {};
    var f = FLAVORS[o.flavor] || FLAVORS.cola;
    var s = o.seed === undefined ? 967 : o.seed;
    var clear = !!o.clear;
    var lidKind = o.lid === undefined ? 'dome' : o.lid;
    var hasStraw = o.straw !== false;
    var fill = o.fill === undefined ? 0.86 : o.fill;
    var i;

    // vertical budget: straw head-room, then lid, then the cup itself
    var strawTop = y;
    var cupTop = y + (hasStraw ? h * 0.215 : h * 0.02);
    var cupBot = y + h * 0.985;
    var ch = cupBot - cupTop;
    var lw = Math.max(1, w * 0.020);

    var topR = w * 0.36, botR = topR * 0.735;
    var cx = x + w * 0.5;
    var lidH = lidKind ? ch * 0.10 : 0;
    var rimY = cupTop + lidH;
    var bodyTop = rimY;
    var bodyBot = cupBot - ch * 0.035;

    // contact shadow
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#3f2a1c';
    trace(ctx, ellPts(cx + w * 0.02, cupBot - ch * 0.010, botR * 1.12, ch * 0.030, 16, w * 0.006, s + 1));
    ctx.fill();
    ctx.restore();

    // body: a tapered tube, drawn as one closed contour
    var body = [], n = 9;
    for (i = 0; i <= n; i++) body.push([cx - topR + (topR - botR) * (i / n), bodyTop + (bodyBot - bodyTop) * (i / n)]);
    body.push([cx - botR, bodyBot]);
    for (i = 0; i <= 10; i++) {
      var a = Math.PI - i / 10 * Math.PI;
      body.push([cx + Math.cos(a) * -botR, bodyBot + Math.sin(a) * ch * 0.045]);
    }
    for (i = n; i >= 0; i--) body.push([cx + topR - (topR - botR) * (i / n), bodyTop + (bodyBot - bodyTop) * (i / n)]);
    jitter(body, w * 0.009, s);

    var paper = clear ? 'rgba(244,250,252,0.55)' : '#fdfaf2';
    ink(ctx, body, paper, { lw: lw, off: w * 0.008, line: clear ? '#8fa3ae' : '#a89880', seed: s });

    if (clear) {
      // the drink, clipped to the cup
      ctx.save();
      trace(ctx, body);
      ctx.clip();
      var lvY = bodyTop + (bodyBot - bodyTop) * (1 - fill);
      var lvR = topR - (topR - botR) * (1 - fill);
      var liq = [];
      liq.push([cx - lvR, lvY]);
      for (i = 0; i <= 8; i++) liq.push([cx - lvR + 2 * lvR * (i / 8), lvY + Math.sin(i / 8 * Math.PI) * ch * 0.012]);
      liq.push([cx + botR * 1.02, bodyBot + ch * 0.05], [cx - botR * 1.02, bodyBot + ch * 0.05]);
      jitter(liq, w * 0.008, s + 5);
      ink(ctx, liq, f.liquid, { lw: 0, alpha: f === FLAVORS.cider ? 0.55 : 0.92 });

      // ice cubes
      for (i = 0; i < 5; i++) {
        var ix = cx + (hash(s * 7 + i) - 0.5) * topR * 1.15;
        var iy = lvY + ch * (0.10 + hash(s * 11 + i) * 0.52);
        var ir = w * (0.055 + hash(s * 13 + i) * 0.030);
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate((hash(s * 17 + i) - 0.5) * 1.1);
        ink(ctx, rectPts(-ir, -ir * 0.85, ir * 2, ir * 1.7, ir * 0.32, ir * 0.10, s + 30 + i),
            'rgba(255,255,255,0.50)', { lw: Math.max(0.7, lw * 0.55), line: 'rgba(255,255,255,0.85)', lineAlpha: 0.7, seed: s + 30 + i });
        ctx.restore();
      }
      // fizz
      for (i = 0; i < 10; i++) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(0.6, w * 0.010);
        ctx.beginPath();
        ctx.arc(cx + (hash(s * 19 + i) - 0.5) * topR * 1.3,
                lvY + ch * (0.06 + hash(s * 23 + i) * 0.62),
                w * (0.010 + hash(s * 29 + i) * 0.012), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // re-draw the contour so the ink sits on top of the drink
      ink(ctx, body, null, { lw: lw, line: '#8fa3ae', lineAlpha: 0.85, seed: s });
    } else {
      hatch(ctx, body, '#c9b89a', s, { n: 5, alpha: 0.13, gap: ch * 0.13 });
    }

    // brand band + flavour, on paper cups only
    if (!clear) {
      var bandTop = bodyTop + (bodyBot - bodyTop) * 0.30;
      var bandBot = bodyTop + (bodyBot - bodyTop) * 0.68;
      var rAt = function (f) { return topR - (topR - botR) * f; };
      var rT = rAt(0.30), rB = rAt(0.68);
      // midpoints along every edge: trace() smooths the polyline, and a bare
      // 4-point trapezoid rounds itself into a blob far inside its own corners
      var band = [], q;
      for (q = 0; q <= 4; q++) band.push([cx - rT + 2 * rT * (q / 4), bandTop]);
      for (q = 1; q <= 3; q++) band.push([cx + rAt(0.30 + 0.38 * (q / 4)), bandTop + (bandBot - bandTop) * (q / 4)]);
      for (q = 4; q >= 0; q--) band.push([cx - rB + 2 * rB * (q / 4), bandBot]);
      for (q = 3; q >= 1; q--) band.push([cx - rAt(0.30 + 0.38 * (q / 4)), bandTop + (bandBot - bandTop) * (q / 4)]);
      band = poly(band, w * 0.007, s + 40);
      ink(ctx, band, f.band, { lw: lw * 0.7, off: w * 0.006, line: mix(f.band, '#000000', 0.35), lineAlpha: 0.75, seed: s + 40 });
      hatch(ctx, band, mix(f.band, '#000000', 0.4), s + 40, { n: 4, alpha: 0.14, gap: ch * 0.06 });

      // fit the flavour to the band's real width at the baseline, then shrink
      var baseF = 0.30 + 0.38 * 0.56;
      var avail = rAt(baseF) * 2 - lw * 3.2;
      var lSize = ch * 0.088, lTrack = 0.10;
      if (textW(f.label, lSize, lTrack) > avail) { lTrack = 0.045; }
      while (lSize > ch * 0.045 && textW(f.label, lSize, lTrack) > avail) lSize *= 0.94;
      letters(ctx, f.label, cx, bandTop + (bandBot - bandTop) * 0.56, lSize, {
        fill: f.ink, weight: 0.145, track: lTrack, seed: s + 41, tilt: 0.03
      });
      letters(ctx, '16 OZ', cx, bandBot + (bodyBot - bodyTop) * 0.115, ch * 0.052, {
        fill: '#a08a6e', weight: 0.12, track: 0.22, seed: s + 42, tilt: 0.04
      });
      letters(ctx, 'MR.B', cx, bandTop - (bodyBot - bodyTop) * 0.075, ch * 0.055, {
        fill: '#c0562f', weight: 0.14, track: 0.16, seed: s + 43, tilt: 0.05
      });
    }

    // lid
    if (lidKind) {
      var lidR = topR * 1.075;
      if (lidKind === 'dome') {
        var dome = [];
        for (i = 0; i <= 16; i++) {
          var da2 = Math.PI + i / 16 * Math.PI;
          dome.push([cx + Math.cos(da2) * lidR, rimY + Math.sin(da2) * lidH * 1.55]);
        }
        dome.push([cx + lidR, rimY + lidH * 0.30], [cx - lidR, rimY + lidH * 0.30]);
        jitter(dome, w * 0.008, s + 50);
        ink(ctx, dome, clear ? 'rgba(238,246,250,0.80)' : '#e8e2d4',
            { lw: lw, off: w * 0.006, line: '#8fa3ae', seed: s + 50 });
      } else {
        ink(ctx, rectPts(cx - lidR, rimY - lidH * 0.95, lidR * 2, lidH * 1.25, lidH * 0.30, w * 0.006, s + 50),
            clear ? 'rgba(238,246,250,0.80)' : '#e8e2d4', { lw: lw, off: w * 0.006, line: '#8fa3ae', seed: s + 50 });
      }
      // the collar that snaps over the rim
      ink(ctx, rectPts(cx - lidR * 1.02, rimY + lidH * 0.18, lidR * 2.04, lidH * 0.55, lidH * 0.18, w * 0.006, s + 51),
          '#d8d2c4', { lw: lw * 0.9, line: '#8fa3ae', seed: s + 51 });
    }

    // straw: candy-striped, leaning, with a bend
    if (hasStraw) {
      var sxx = cx + topR * 0.30;
      var pts = poly([[sxx, rimY - lidH * 0.30], [sxx + w * 0.055, strawTop + h * 0.115],
                      [sxx + w * 0.085, strawTop + h * 0.045], [sxx + w * 0.175, strawTop + h * 0.020]], w * 0.006, s + 60);
      line(ctx, pts, '#f6efe0', Math.max(2, w * 0.075), 1, s + 60);
      line(ctx, pts, '#8fa3ae', Math.max(2.4, w * 0.085), 0.55, s + 61);
      // stripes
      ctx.save();
      ctx.strokeStyle = f.band;
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(1.6, w * 0.070);
      for (i = 0; i < 5; i++) {
        var tt = 0.10 + i * 0.20;
        var seg = Math.min(pts.length - 2, Math.floor(tt * (pts.length - 1)));
        var lt = tt * (pts.length - 1) - seg;
        var ax = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * lt;
        var ay = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * lt;
        var bx2 = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * Math.min(1, lt + 0.34);
        var by2 = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * Math.min(1, lt + 0.34);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx2, by2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ----------------------------------------------------------- register */
  Art.scene.sack = drawSack;
  Art.scene.cutter = drawCutter;
  Art.scene.fryer = drawFryer;

  Art.item = Art.item || {};
  Art.item.potato = drawPotato;
  Art.item.friesRaw = drawFriesRaw;
  Art.item.basket = drawBasket;
  Art.item.friesBox = drawFriesBox;
  Art.item.cup = drawCup;
  Art.item.stick = stick;
  Art.FLAVORS = FLAVORS;
  Art.FLAVOR_IDS = ['cola', 'cider', 'orange', 'lemon', 'root', 'tea'];
})(typeof self !== 'undefined' ? self : this);
