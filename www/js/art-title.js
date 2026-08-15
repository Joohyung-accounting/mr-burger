/* art-title.js - the title screen, rebuilt as one scene instead of a card in a
 * dark room. Load AFTER art.js (order against the other extension modules does
 * not matter). Registers:
 *
 *   Art.ui.titleHero(ctx, x, y, w, h, o)   the whole screen
 *   Art.ui.wordmark (ctx, cx, cy, w, o)    just the painted MR. BURGER sign
 *   Art.ui.heroBoxes(x, y, w, h, nTiles)   where the controls landed
 *
 * Built for a portrait phone (roughly 1:2). Every wobble comes from Art.hash,
 * so only the things that should move - the bulb, the steam, the cook's breath -
 * move between frames.
 */
(function (root) {
  'use strict';

  var MARK = '_titleArt';

  function apply(A) {
    if (A && A.ink && A.ui && !A[MARK]) {
      try { install(A); A[MARK] = true; }
      catch (e) { if (typeof console !== 'undefined') console.warn('[art-title]', e); }
    }
    return A;
  }

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
  } catch (e) { /* watchdog below */ }
  apply(root.Art);

  var ticks = 0, iv = setInterval(function () {
    if (root.Art && root.Art.ink && root.Art.ui && !root.Art[MARK]) apply(root.Art);
    if (++ticks > 4000) clearInterval(iv);
  }, 150);
  // In Node this handle would keep a test runner alive for ten minutes.
  if (iv && typeof iv.unref === 'function') iv.unref();

  function install(Art) {

  var ink = Art.ink, hatch = Art.hatch, trace = Art.trace, jitter = Art.jitter,
      rectPts = Art.rectPts, ellPts = Art.ellPts, blobPts = Art.blobPts,
      hash = Art.hash, mix = Art.mixHex,
      letters = Art.ui.letters, textW = Art.ui.width;

  var TAU = Math.PI * 2;
  var CREAM = '#f6efe0', RED = '#c0562f', DEEPRED = '#8a3a1c',
      YELLOW = '#f0b429', INK = '#4a3226';

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function line(ctx, pts, color, width, alpha, seed) {
    var al = alpha === undefined ? 0.9 : alpha, i;
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

  /** Letters with hatching inside the strokes - canvas cannot clip to text, so
   * they are drawn on their own layer and the hatch is laid on source-atop. */
  function hatchedText(ctx, txt, cx, baseY, size, lo, hcol, seed, alpha) {
    var track = lo.track === undefined ? 0.085 : lo.track;
    var tw = textW(txt, size, track);
    var pad = size * 0.9;
    var cw = Math.ceil(tw + pad * 2), ch = Math.ceil(size * 2.6);
    if (!(cw > 0 && ch > 0) || typeof document === 'undefined') {
      letters(ctx, txt, cx, baseY, size, lo);
      return;
    }
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    var by = ch * 0.74;
    letters(g, txt, cw / 2, by, size, lo);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = hcol;
    g.globalAlpha = alpha === undefined ? 0.30 : alpha;
    g.lineWidth = Math.max(1, size * 0.030);
    g.lineCap = 'round';
    var gap = size * 0.155;
    for (var i = -ch; i < cw + ch; i += gap) {
      g.beginPath();
      g.moveTo(i + (hash(seed + i) - 0.5) * gap * 0.4, ch);
      g.lineTo(i + ch + (hash(seed + i * 3) - 0.5) * gap * 0.4, 0);
      g.stroke();
    }
    g.restore();
    ctx.drawImage(c, cx - cw / 2, baseY - by);
  }

  /**
   * The identity mark on its own: a cream field hand-painted on the wall, MR. on
   * a little red ribbon, BURGER filling the field, a swash under it.
   * (cx, cy) is the centre of the field, `w` its width. Returns its height.
   */
  function drawWordmark(ctx, cx, cy0, w, o) {
    o = o || {};
    var s = o.seed === undefined ? 2101 : o.seed, i;
    // The MR. ribbon rides ABOVE the painted field, so the mark is taller than
    // the field. Everything below works in field space; the whole mark still
    // fits inside the box this function reports, centred on the cy passed in.
    var fh0 = w * 0.455;
    var rh = fh0 * 0.145;
    var over = o.field === false ? 0 : rh * 0.62;
    var fh = fh0 - over;
    var cy = cy0 - fh0 / 2 + over + fh / 2;
    var lw = Math.max(1.2, w * 0.008);
    var top = cy - fh / 2;

    if (o.field !== false) {
      // the painted field: a squircle, not a rectangle - it reads as sign paint
      var field = [];
      for (i = 0; i < 56; i++) {
        var a = i / 56 * TAU;
        var ca = Math.cos(a), sa2 = Math.sin(a);
        field.push([cx + (ca < 0 ? -1 : 1) * Math.pow(Math.abs(ca), 0.56) * w * 0.500,
                    cy + (sa2 < 0 ? -1 : 1) * Math.pow(Math.abs(sa2), 0.56) * fh * 0.500]);
      }
      field = jitter(field, w * 0.005, s);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#3a2416';
      trace(ctx, jitter(field.map(function (p) { return [p[0] + w * 0.012, p[1] + w * 0.014]; }), w * 0.004, s + 1));
      ctx.fill();
      ctx.restore();
      ink(ctx, field, CREAM, { lw: lw * 2.2, off: w * 0.005, line: RED, seed: s + 2 });
      // a second, thinner painted rule just inside the first
      var inner = field.map(function (p) {
        return [cx + (p[0] - cx) * 0.945, cy + (p[1] - cy) * 0.925];
      });
      line(ctx, inner.concat([inner[0]]), DEEPRED, lw * 0.9, 0.55, s + 3);
    }

    // BURGER, sized to the field. Everything else is placed off the cap height,
    // so MR. can never land on the letters however the size lands.
    var target = w * (o.field === false ? 0.98 : 0.70);
    var size = fh * 0.42, track = 0.075;
    var meas = textW('BURGER', size, track);
    if (meas > 0) size *= target / meas;
    var wmY = cy + fh * (o.field === false ? 0.30 : 0.205);
    hatchedText(ctx, 'BURGER', cx, wmY, size, {
      fill: YELLOW, line: '#3f2a1c', weight: 0.155, track: track, seed: s + 5, tilt: 0.035
    }, '#7a3e20', s + 5, 0.30);

    // MR. on a small painted ribbon riding the top edge of the sign
    var rw = w * 0.285;
    var ry2 = (o.field === false ? wmY - size - rh * 1.05 : top - rh * 0.62);
    var rib = jitter([
      [cx - rw / 2, ry2], [cx + rw / 2, ry2],
      [cx + rw / 2 + rh * 0.34, ry2 + rh * 0.5], [cx + rw / 2, ry2 + rh],
      [cx - rw / 2, ry2 + rh], [cx - rw / 2 - rh * 0.34, ry2 + rh * 0.5]
    ], w * 0.004, s + 6);
    ink(ctx, rib, RED, { lw: lw * 1.1, off: w * 0.004, line: DEEPRED, seed: s + 6 });
    letters(ctx, 'MR.', cx, ry2 + rh * 0.72, rh * 0.60, {
      fill: CREAM, weight: 0.155, track: 0.30, seed: s + 7, tilt: 0.04
    });

    // swash under the wordmark, two passes of one stroke
    ctx.save();
    ctx.strokeStyle = RED;
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.globalAlpha = i ? 0.40 : 0.9;
      ctx.lineWidth = Math.max(1.2, w * (i ? 0.008 : 0.013));
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.29, cy + fh * 0.360 + i * fh * 0.014);
      ctx.bezierCurveTo(cx - w * 0.09, cy + fh * 0.406 + i * fh * 0.012,
                        cx + w * 0.11, cy + fh * 0.326 + i * fh * 0.012,
                        cx + w * 0.29, cy + fh * 0.372 + i * fh * 0.014);
      ctx.stroke();
    }
    ctx.restore();

    // paint worn off the sign in a few places
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#8a7259';
    for (i = 0; i < 7; i++) {
      trace(ctx, blobPts(cx + (hash(s * 13 + i) - 0.5) * w * 0.86,
                         cy + (hash(s * 17 + i) - 0.5) * fh * 0.80,
                         w * 0.012 + hash(s * 19 + i) * w * 0.022,
                         w * 0.008 + hash(s * 23 + i) * w * 0.016,
                         4, 0.4, hash(s + i) * 6, 12, w * 0.003, s + 30 + i));
      ctx.fill();
    }
    ctx.restore();
    return fh0;
  }

  /** The bulb on its flex, swinging a little. Returns where its light lands. */
  function drawBulb(ctx, cx, topY, dropH, r, t, seed) {
    var ang = Math.sin(t * 0.62) * 0.045 + Math.sin(t * 0.29 + 1.1) * 0.018;
    var bx = cx + Math.sin(ang) * dropH, by = topY + Math.cos(ang) * dropH;
    var lw = Math.max(1, r * 0.14);
    line(ctx, [[cx, topY], [cx + Math.sin(ang) * dropH * 0.5, topY + Math.cos(ang) * dropH * 0.5], [bx, by]],
         '#2c1d13', lw * 1.1, 0.85, seed);
    ink(ctx, rectPts(bx - r * 0.42, by - r * 0.10, r * 0.84, r * 0.52, r * 0.14, r * 0.03, seed + 1),
        '#8d949a', { lw: lw, off: r * 0.03, line: '#3d454b', seed: seed + 1 });
    var glass = blobPts(bx, by + r * 0.86, r * 0.80, r * 0.86, 3, 0.05, 1.2, 20, r * 0.03, seed + 2);
    ink(ctx, glass, '#ffe9ae', { lw: lw * 0.9, off: r * 0.03, line: '#a8853c', seed: seed + 2 });
    ink(ctx, ellPts(bx - r * 0.26, by + r * 0.62, r * 0.20, r * 0.13, 10, r * 0.02, seed + 3),
        'rgba(255,255,255,0.75)', { lw: 0 });
    // filament
    line(ctx, [[bx - r * 0.20, by + r * 0.80], [bx - r * 0.06, by + r * 1.02],
               [bx + r * 0.06, by + r * 0.78], [bx + r * 0.20, by + r * 1.00]],
         '#c98a2a', lw * 0.7, 0.75, seed + 4);
    return { x: bx, y: by + r * 0.9 };
  }

  function warmPool(ctx, cx, cy, r, a) {
    var g = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
    g.addColorStop(0, 'rgba(255,214,150,' + a + ')');
    g.addColorStop(0.55, 'rgba(255,196,120,' + (a * 0.42) + ')');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Steam / heat: three wisps rising, phase-shifted. */
  function wisps(ctx, cx, y, w, h, amount, t, color) {
    if (amount <= 0.04) return;
    ctx.save();
    ctx.strokeStyle = color || '#f2e7d6';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, h * 0.05);
    for (var i = 0; i < 3; i++) {
      var ph = t * 0.9 + i * 2.1;
      ctx.globalAlpha = 0.30 * amount * (0.55 + 0.45 * Math.sin(ph));
      ctx.beginPath();
      for (var k = 0; k <= 6; k++) {
        ctx.lineTo(cx + (i - 1) * w * 0.30 + Math.sin(ph + k * 0.8) * w * 0.09, y - k * h / 6);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A small enamel sign swinging on two chains. */
  function drawHangSign(ctx, cx, topY, w, t, seed) {
    var ang = Math.sin(t * 0.85 + 0.7) * 0.055;
    var h = w * 0.44, drop = w * 0.34;
    var lw = Math.max(1, w * 0.022);
    ctx.save();
    ctx.translate(cx, topY);
    ctx.rotate(ang);
    line(ctx, [[-w * 0.30, 0], [-w * 0.28, drop]], '#6b6f74', lw * 0.8, 0.8, seed);
    line(ctx, [[w * 0.30, 0], [w * 0.28, drop]], '#6b6f74', lw * 0.8, 0.8, seed + 1);
    ink(ctx, rectPts(-w / 2, drop, w, h, h * 0.22, w * 0.01, seed + 2),
        '#2f6b58', { lw: lw, off: w * 0.008, line: '#173a2f', seed: seed + 2 });
    ink(ctx, rectPts(-w * 0.44, drop + h * 0.13, w * 0.88, h * 0.74, h * 0.16, w * 0.008, seed + 3),
        null, { lw: lw * 0.5, line: '#cfe6d8', lineAlpha: 0.75, seed: seed + 3 });
    letters(ctx, 'OPEN', 0, drop + h * 0.66, h * 0.40, {
      fill: '#f2f8f2', weight: 0.15, track: 0.20, seed: seed + 4, tilt: 0.03
    });
    ctx.restore();
  }

  /**
   * Where drawTitleHero puts everything you can press.
   *
   * Same contract as Art.ui.titleBoxes: the game hangs its real <button>s on
   * these rects and paints them out, so the scene keeps its drawn controls
   * without losing focus, keyboard or a screen reader. Both this and the
   * drawing read the same constants, so they cannot drift apart.
   */
  function heroBoxes(x, y, w, h, n) {
    var cx = x + w / 2;
    var bw = w * 0.76, bx = cx - bw / 2;
    var out = {
      primary: { x: bx, y: y + h * 0.688, w: bw, h: h * 0.072 },
      secondary: { x: bx + bw * 0.11, y: y + h * 0.778, w: bw * 0.78, h: h * 0.052 },
      tiles: []
    };
    n = n || 0;
    if (n) {
      var gap = w * 0.045, tw = (bw - gap * (n - 1)) / n;
      var th = h * 0.070, ty = y + h * 0.858;
      for (var i = 0; i < n; i++) out.tiles.push({ x: bx + i * (tw + gap), y: ty, w: tw, h: th });
    }
    return out;
  }

  /**
   * The whole title screen.
   *   o.t                 seconds - bulb sway, steam, the cook's breathing
   *   o.day               a number turns the primary button into CONTINUE
   *   o.primary/secondary button labels
   *   o.tagline           the line under the sign
   *   o.tiles / o.tile    up to three small buttons along the bottom
   *   o.note              a tiny line at the very bottom
   */
  function drawTitleHero(ctx, x, y, w, h, o) {
    o = o || {};
    var t = o.t || 0;
    var s = 2201, i;
    var T = Art.scene.THEMES.diner;
    var CT = {};
    for (var k in T) if (Object.prototype.hasOwnProperty.call(T, k)) CT[k] = T[k];
    CT.top = mix(T.top || '#d8c3a0', '#6b4a2a', 0.34);
    CT.top2 = mix(T.top2 || '#c9b08a', '#6b4a2a', 0.34);
    CT.side = mix(T.side || '#a8875f', '#432b18', 0.36);
    var cx = x + w / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // ---- room ------------------------------------------------------------
    ctx.save();
    ctx.fillStyle = '#3a2416';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    var wallH = h * 0.605;
    Art.scene.wall(ctx, x - w * 0.04, y - h * 0.03, w * 1.08, wallH + h * 0.03, T);
    Art.scene.floor(ctx, x - w * 0.04, y + wallH, w * 1.08, h * 0.12, T);

    // warm the room down so the yellow sign and the burger are the light
    ctx.save();
    ctx.fillStyle = 'rgba(122,68,30,0.30)';
    ctx.fillRect(x, y, w, h * 0.70);
    ctx.restore();

    // ---- the sign painted on the wall -------------------------------------
    var signW = w * 0.86;
    var signCy = y + h * 0.215;
    drawWordmark(ctx, cx, signCy, signW, { seed: 2101 });

    if (o.tagline) {
      letters(ctx, o.tagline, cx, y + h * 0.368, h * 0.0185, {
        fill: '#ffe6bc', line: '#5a3418', weight: 0.14, track: 0.36, seed: s + 8, tilt: 0.05
      });
    }

    // ---- bulb and its light ------------------------------------------------
    var pool = drawBulb(ctx, x + w * 0.225, y - h * 0.005, h * 0.082, w * 0.058, t, s + 10);
    warmPool(ctx, pool.x + w * 0.10, pool.y + h * 0.06, w * 0.92, 0.34);
    drawHangSign(ctx, x + w * 0.845, y + h * 0.045, w * 0.155, t, s + 14);

    // ---- counter, cook, props ---------------------------------------------
    var counterY = y + h * 0.560;
    var feetY = counterY + h * 0.030;
    var chefS = h * 0.205;

    var plateGlow = 0.35 + 0.20 * Math.sin(t * 1.4);
    function carryPlate(g, ccx, ccy, cw) {
      var pw = cw * 0.86, py = ccy + cw * 0.060;
      Art.scene.plate(g, ccx, py, pw, { glow: plateGlow });
      var seat = Art.scene.plateSeat(ccx, py, pw);
      var stack = ['bunBottom', 'patty', 'cheese', 'bunTop']
        .filter(function (id) { return Art.has(id); });
      Art.drawStack(g, stack, seat.x, seat.y, pw * 0.37, {});
      return pw * 0.50;
    }

    var pose = Art.chefPose ? Art.chefPose('idle', t) : { bob: (t * 0.55) % 1 };
    pose.carry = carryPlate;
    Art.drawChef(ctx, cx, feetY, chefS, pose);

    Art.scene.counter(ctx, x - w * 0.05, counterY, w * 1.10, h * 0.055, h * 0.026, CT);

    // things standing on the counter. propBase is the FRONT of the counter's
    // top face - anything higher up that face looks like it is floating.
    var propBase = counterY + h * 0.047;
    if (Art.scene.board) {
      var bdW = w * 0.265, bdH = h * 0.046, bdX = x + w * 0.030;
      Art.scene.board(ctx, bdX, propBase - bdH, bdW, bdH,
                      { wood: 'maple', scars: 0.45, brand: '', groove: false, handleSide: 'left' });
      var seat = Art.scene.boardSeat(bdX, propBase - bdH, bdW, bdH, { handleSide: 'left' });
      Art.item.knife(ctx, seat.x0 + seat.w * 0.24, seat.baseY, seat.w * 0.80,
                     { type: 'chef', lift: 0, seed: 1301 });
      Art.item.vegWhole(ctx, bdX + bdW + w * 0.052, propBase - h * 0.030, h * 0.021, { id: 'tomato' });
    }
    if (Art.item && Art.item.friesBox) {
      var fbW = w * 0.115, fbH = h * 0.088;
      Art.item.friesBox(ctx, x + w * 0.735, propBase - fbH - h * 0.012, fbW, fbH, { fries: 1 });
      Art.item.cup(ctx, x + w * 0.870, propBase - h * 0.098 - h * 0.012, w * 0.098, h * 0.098, { flavor: 'cola' });
      wisps(ctx, x + w * 0.793, propBase - fbH * 0.95 - h * 0.012, w * 0.060, h * 0.050, 0.85, t);
    }

    // ---- warm vignette so the eye lands on the sign and the burger ---------
    var vg = ctx.createRadialGradient(cx, y + h * 0.38, h * 0.10, cx, y + h * 0.38, h * 0.62);
    vg.addColorStop(0, 'rgba(58,36,22,0)');
    vg.addColorStop(0.72, 'rgba(48,28,16,0.16)');
    vg.addColorStop(1, 'rgba(38,22,12,0.46)');
    ctx.save();
    ctx.fillStyle = vg;
    ctx.fillRect(x, y, w, h * 0.72);
    ctx.restore();

    // ---- the paper the buttons live on ------------------------------------
    var cardTop = y + h * 0.638;
    var card = Art.ui.torn(x - w * 0.03, cardTop, w * 1.06, h * 0.40, h * 0.010, s + 20);
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#2a1a10';
    trace(ctx, jitter(card.map(function (p) { return [p[0], p[1] - h * 0.010]; }), h * 0.002, s + 21));
    ctx.fill();
    ctx.restore();
    ink(ctx, card, '#fdf6e6', { lw: Math.max(1, w * 0.004), off: w * 0.003, line: '#d8c3a0', lineAlpha: 0.6, seed: s + 22 });
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#e8d8bb';
    trace(ctx, jitter(card.slice(0, 14), h * 0.002, s + 23));
    ctx.fill();
    ctx.restore();

    // ---- the one thing to press -------------------------------------------
    var day = o.day;
    var B = heroBoxes(x, y, w, h, (o.tiles || []).length);
    var P = B.primary, Q = B.secondary;
    var breathe = 1 + Math.sin(t * 1.8) * 0.008;
    ctx.save();
    ctx.translate(cx, P.y + P.h / 2);
    ctx.scale(breathe, breathe);
    ctx.translate(-cx, -(P.y + P.h / 2));
    Art.ui.button(ctx, P.x, P.y, P.w, P.h,
                  o.primary || (day ? 'CONTINUE — DAY ' + day : 'START THE SHIFT'),
                  { fill: YELLOW, line: '#8a5a12', text: '#3f2a08', seed: s + 50, size: 0.36 });
    ctx.restore();

    Art.ui.button(ctx, Q.x, Q.y, Q.w, Q.h,
                  o.secondary || 'NEW SHIFT',
                  { fill: null, line: '#b09a7d', text: '#7d6249', dashed: true, seed: s + 60, size: 0.34 });

    // ---- quiet row of extras ----------------------------------------------
    var tiles = o.tiles || [];
    for (i = 0; i < tiles.length; i++) {
      var T2 = B.tiles[i], tx = T2.x, ty = T2.y, tw = T2.w, th = T2.h;
      var box = rectPts(tx, ty, tw, th, tw * 0.16, tw * 0.014, s + 70 + i);
      ctx.save();
      ctx.strokeStyle = '#cdb694';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1, tw * 0.032);
      ctx.lineJoin = 'round';
      trace(ctx, box);
      ctx.stroke();
      ctx.restore();
      if (o.tile) o.tile(ctx, tiles[i].id, tx + tw * 0.30, ty + th * 0.12, tw * 0.40, th * 0.44);
      letters(ctx, tiles[i].label || '', tx + tw / 2, ty + th * 0.88, th * 0.20, {
        fill: '#8a7259', weight: 0.115, track: 0.14, seed: s + 90 + i, tilt: 0.05
      });
    }

    if (o.note) {
      letters(ctx, o.note, cx, y + h * 0.968, h * 0.0155, {
        fill: '#b09a7d', weight: 0.11, track: 0.14, seed: s + 100, tilt: 0.06
      });
    }

    ctx.restore();
  }

  Art.ui.titleHero = drawTitleHero;
  Art.ui.wordmark = drawWordmark;
  Art.ui.heroBoxes = heroBoxes;
  }
})(typeof self !== 'undefined' ? self : this);
