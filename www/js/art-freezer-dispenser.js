/*
 * art-freezer-dispenser.js — two more machines for the fry/drink line, drawn
 * with the same pen as art.js and art-fries-drinks.js. Load AFTER both.
 *
 *   Art.scene.freezer    (ctx, x, y, w, h, o)   chest freezer, sliding glass lid
 *   Art.scene.dispenser  (ctx, x, y, w, h, o)   three-flavour fountain
 *   Art.item.fryBag      (ctx, x, y, w, h, o)   sealed bag of frozen fries
 *
 * Every wobble comes from Art.hash(seed), so a machine standing still does not
 * shimmer between frames; only the arguments that describe MOTION (open, pour,
 * t) are allowed to change what is drawn.
 */
(function (root) {
  'use strict';

  function install(Art) {
    var ink = Art.ink, hatch = Art.hatch, trace = Art.trace, jitter = Art.jitter,
        rectPts = Art.rectPts, ellPts = Art.ellPts,
        hash = Art.hash, mix = Art.mixHex, letters = Art.ui.letters;

    var TAU = Math.PI * 2;

    function wob(seed, i) { return hash(seed * 733 + i * 61 + 17) - 0.5; }
    function poly(list, amt, seed) { return jitter(list.slice(), amt, seed); }

    /** trace() curves through every point, so a 4-corner box rounds into a
     * lozenge. Subdividing each edge keeps a steel panel's corners square. */
    function dens(pts, per, close) {
      var o = [], i, k, n = pts.length, last = close ? n : n - 1;
      for (i = 0; i < last; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        for (k = 0; k < per; k++) {
          o.push([a[0] + (b[0] - a[0]) * k / per, a[1] + (b[1] - a[1]) * k / per]);
        }
      }
      if (!close) o.push(pts[n - 1].slice());
      return o;
    }
    function box(x, y, w, h, per, amt, seed) {
      return jitter(dens([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], per || 6, true),
                    amt === undefined ? Math.min(w, h) * 0.014 : amt, seed);
    }

    function line(ctx, pts, color, width, alpha, seed) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha === undefined ? 0.9 : alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = width;
      trace(ctx, jitter(pts.slice(), width * 0.16, seed || 1));
      ctx.stroke();
      ctx.restore();
    }

    /** Cold air rolling out of an open freezer: heavier and slower than steam,
     * so it sinks a little before it fades instead of rising in wisps. */
    function coldRoll(ctx, cx, y, w, h, amount, t, seed) {
      if (amount <= 0.04) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#e8f4fa';
      for (var i = 0; i < 5; i++) {
        var ph = ((t * 0.22 + hash(seed * 7 + i) * 3) % 1);
        var sx = cx + (hash(seed * 3 + i) - 0.5) * w * 1.5;
        var sy = y + ph * h * 0.55;
        ctx.globalAlpha = amount * 0.34 * (1 - ph) * (1 - ph);
        ctx.lineWidth = Math.max(1.2, w * (0.055 + ph * 0.075));
        ctx.beginPath();
        for (var k = 0; k <= 5; k++) {
          ctx.lineTo(sx + Math.sin(ph * 4 + k * 0.9 + i) * w * 0.14 + k * w * 0.055 * (i % 2 ? 1 : -1),
                     sy + k * h * 0.055);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    /** Frost rime: short ticks crowding an edge, densest where the cold sits. */
    function rime(ctx, pts, seed, n, len, alpha) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = alpha === undefined ? 0.55 : alpha;
      ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var p = pts[Math.floor(hash(seed * 13 + i) * pts.length)];
        var a = hash(seed * 17 + i) * TAU;
        var L = len * (0.45 + hash(seed * 19 + i) * 0.8);
        ctx.lineWidth = Math.max(0.8, len * 0.28);
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ------------------------------------------------------- frozen fry bag */

    /**
     * A sealed bag of frozen fries: crimped top, soft shoulders, a window with
     * three fries showing, frost on the film.
     *   o.frost 0..1  how iced the film is, default 0.7
     *   o.tilt  radians, default 0
     */
    function drawFryBag(ctx, x, y, w, h, o) {
      o = o || {};
      var s = o.seed === undefined ? 1301 : o.seed;
      var lw = Math.max(1, w * 0.030);
      var frost = o.frost === undefined ? 0.7 : o.frost;
      var cx = x + w / 2;

      ctx.save();
      if (o.tilt) {
        ctx.translate(cx, y + h / 2);
        ctx.rotate(o.tilt);
        ctx.translate(-cx, -(y + h / 2));
      }

      // a soft-sided sack: shoulders in, belly out, flat where it sits
      var i, pts = [
        [x + w * 0.180, y + h * 0.130], [x + w * 0.060, y + h * 0.360],
        [x + w * 0.075, y + h * 0.760], [x + w * 0.170, y + h * 0.945],
        [x + w * 0.830, y + h * 0.945], [x + w * 0.925, y + h * 0.760],
        [x + w * 0.940, y + h * 0.360], [x + w * 0.820, y + h * 0.130]
      ];
      var body = jitter(dens(pts, 5, true), w * 0.014, s);
      ink(ctx, body, '#dceaf2', { lw: lw, off: w * 0.012, line: '#5d7f90', seed: s });
      hatch(ctx, body, '#8fb3c4', s, { n: 6, alpha: 0.16, gap: h * 0.075 });

      // crimped top seal
      var seal = box(x + w * 0.160, y + h * 0.055, w * 0.680, h * 0.095, 7, w * 0.010, s + 2);
      ink(ctx, seal, '#b7cfdb', { lw: lw * 0.85, line: '#4a6b7a', seed: s + 2 });
      ctx.save();
      trace(ctx, seal);
      ctx.clip();
      for (i = 0; i < 9; i++) {
        var zx = x + w * (0.185 + i * 0.075);
        line(ctx, [[zx, y + h * 0.055], [zx + w * 0.012, y + h * 0.150]], '#4a6b7a', lw * 0.6, 0.5, s + 3 + i);
      }
      ctx.restore();

      // the window: three fries behind clear film
      var win = box(x + w * 0.250, y + h * 0.400, w * 0.500, h * 0.310, 6, w * 0.010, s + 6);
      ink(ctx, win, '#fbf3dc', { lw: lw * 0.8, line: '#5d7f90', seed: s + 6 });
      ctx.save();
      trace(ctx, win);
      ctx.clip();
      if (Art.item && Art.item.stick) {
        for (i = 0; i < 3; i++) {
          Art.item.stick(ctx, x + w * (0.340 + i * 0.155), y + h * (0.585 - i * 0.045),
                         w * 0.230, w * 0.070, -1.32 + (i - 1) * 0.16,
                         '#f2e0a8', '#c9ab6a', s + 20 + i);
        }
      }
      ctx.restore();

      // brand band above the window - dropped once the bag is small enough
      // that the words are grit rather than words. Three bags stacked in a
      // freezer well are about seven pixels tall.
      if (h * 0.098 >= 5) {
        letters(ctx, o.label || 'FRIES', cx, y + h * 0.335, h * 0.098, {
          fill: '#2f5c70', weight: 0.145, track: 0.13, seed: s + 30
        });
        letters(ctx, '1KG', cx, y + h * 0.855, h * 0.070, {
          fill: '#5d7f90', weight: 0.125, track: 0.16, seed: s + 31
        });
      }

      if (frost > 0.05) rime(ctx, body, s + 40, Math.round(14 * frost), w * 0.055, 0.5 * frost);
      ctx.restore();
    }

    /* ----------------------------------------------------------- freezer */

    /**
     * Chest freezer with two sliding glass lids. The right lid slides open and
     * the cook reaches in for a bag.
     *
     * The unit CONTAINS its own drawing: a lifted bag rises above the cabinet,
     * so the geometry is inset from the top of the passed box by `head`.
     * Callers can trust (x, y, w, h) as the extent.
     *
     *   o.open  0..1   right lid slid aside
     *   o.grab  0..1   a bag lifted out of the well (needs open)
     *   o.temp  string on the badge, default '-18'
     *   o.t     seconds, drives the cold roll
     */
    function drawFreezer(ctx, x, y, w, h, o) {
      o = o || {};
      var head = h * 0.20;
      y += head; h -= head;
      var s = 1201, lw = Math.max(1, w * 0.011), i, k;
      var open = Math.max(0, Math.min(1, o.open === undefined ? 0 : o.open));
      var grab = Math.max(0, Math.min(1, o.grab || 0)) * open;
      var t = o.t || 0;

      /* --- the top face, seen slightly from above: back edge inset --- */
      var topBack = y + h * 0.045, topFront = y + h * 0.250;
      var inset = w * 0.070;
      var top = jitter(dens([[x + inset, topBack], [x + w - inset, topBack],
                             [x + w, topFront], [x, topFront]], 7, true), w * 0.005, s + 1);

      // cabinet first, so the top face overlaps its front edge
      var cab = jitter(dens([[x, topFront], [x + w, topFront],
                             [x + w, y + h * 0.925], [x, y + h * 0.925]], 8, true), w * 0.005, s);
      ink(ctx, cab, '#cfd6da', { lw: lw * 1.2, off: w * 0.004, line: '#5d6b73', seed: s });
      hatch(ctx, cab, '#5d6b73', s, { n: 9, alpha: 0.16, gap: h * 0.058 });

      ink(ctx, top, '#e2e8ec', { lw: lw * 1.1, off: w * 0.003, line: '#5d6b73', seed: s + 1 });

      /* --- the well: a dark cold hole inside the rim --- */
      var wIn = w * 0.055, wellBack = topBack + h * 0.032, wellFront = topFront - h * 0.030;
      var well = jitter(dens([[x + inset + wIn, wellBack], [x + w - inset - wIn, wellBack],
                              [x + w - wIn * 0.6, wellFront], [x + wIn * 0.6, wellFront]], 7, true),
                        w * 0.004, s + 2);
      ink(ctx, well, '#2b3a44', { lw: lw, line: '#1c262c', seed: s + 2 });

      ctx.save();
      trace(ctx, well);
      ctx.clip();
      // cold walls, palest at the bottom where the frost gathers
      ink(ctx, jitter(dens([[x + wIn, wellFront - h * 0.055], [x + w - wIn, wellFront - h * 0.055],
                            [x + w - wIn * 0.6, wellFront], [x + wIn * 0.6, wellFront]], 5, true),
                      w * 0.004, s + 3),
          '#5d7f90', { lw: 0 });
      // bags stacked in the well, revealed as the lid slides
      var bagW = (w - inset * 2 - wIn * 2) * 0.255;
      for (k = 0; k < 3; k++) {
        var bx = x + inset + wIn + (w - inset * 2 - wIn * 2) * (0.045 + k * 0.320);
        drawFryBag(ctx, bx, wellBack + h * 0.010 + k * h * 0.006, bagW, h * 0.185,
                   { seed: 1310 + k * 7, frost: 0.85, tilt: (k - 1) * 0.05 });
      }
      rime(ctx, well, s + 4, 26, w * 0.020, 0.45);
      ctx.restore();

      /* --- the two lids: steel frames with glass, right one slides right --- */
      function lid(f0, f1, dx, seed) {
        var a = x + inset + (w - inset * 2) * f0 + dx;
        var b = x + inset + (w - inset * 2) * f1 + dx;
        var fa = x + (w) * f0 + dx, fb = x + (w) * f1 + dx;
        var p = jitter(dens([[a, topBack], [b, topBack], [fb, topFront], [fa, topFront]], 7, true),
                       w * 0.004, seed);
        ink(ctx, p, 'rgba(214,236,246,0.86)', { lw: lw * 1.3, off: w * 0.003, line: '#5d7f90', seed: seed });
        // one straight glare streak: the read that says glass, not steel
        ctx.save();
        trace(ctx, p);
        ctx.clip();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#ffffff';
        trace(ctx, jitter(dens([[a + (b - a) * 0.10, topBack], [a + (b - a) * 0.34, topBack],
                                [fa + (fb - fa) * 0.14, topFront], [fa + (fb - fa) * 0.02, topFront]], 5, true),
                          w * 0.004, seed + 1));
        ctx.fill();
        ctx.restore();
        rime(ctx, p, seed + 2, 8, w * 0.016, 0.30);
        // the grab rail along the front edge
        line(ctx, [[fa + (fb - fa) * 0.20, topFront - h * 0.012],
                   [fa + (fb - fa) * 0.80, topFront - h * 0.012]], '#8fa3ae', lw * 2.2, 0.95, seed + 3);
      }
      // the right lid slides LEFT, over its neighbour, the way a real chest
      // freezer works: it never leaves the cabinet, so the unit stays inside
      // the box the caller gave us and the right half of the well opens up
      lid(0.015, 0.500, 0, s + 14);
      lid(0.500, 0.985, -open * (w - inset * 2) * 0.480, s + 10);

      if (open > 0.10) {
        coldRoll(ctx, x + w * 0.74, wellFront - h * 0.02, w * 0.20, h * 0.30, open, t, s + 18);
      }

      /* --- a bag lifted out. The lift is driven by `head`, not by a loose
       * coefficient: a fully raised bag clears the lid and still lands inside
       * the (x, y, w, h) the caller handed us. --- */
      if (grab > 0.03) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, grab * 2.2);
        drawFryBag(ctx, x + w * 0.700, topBack - h * 0.02 - grab * (head * 0.72 + h * 0.015),
                   w * 0.190, h * 0.230, { seed: 1361, frost: 0.9, tilt: 0.16 });
        ctx.restore();
      }

      /* --- the front: handle, badge, plate, lamp, feet --- */
      var fy = topFront + h * 0.055;
      line(ctx, [[x + w * 0.075, fy], [x + w * 0.925, fy]], '#4a565d', lw * 2.4, 0.9, s + 20);
      line(ctx, [[x + w * 0.075, fy], [x + w * 0.925, fy]], '#e6edf1', lw * 0.9, 0.7, s + 21);

      /*
       * The lettering has a floor.
       *
       * In the design this machine is 330px tall and its captions are a
       * comfortable read. Standing in the game's fry column it is nearer 36px,
       * where h * 0.072 is under three pixels and hand lettering turns to
       * grit - the same reason drawCrate refuses to draw its flame under 62px
       * wide. The badge and the plate keep their SHAPES, which still read as
       * detail; only the words drop out.
       */
      var readable = h * 0.072 >= 5;

      var badge = box(x + w * 0.070, y + h * 0.430, w * 0.230, h * 0.150, 6, w * 0.005, s + 22);
      ink(ctx, badge, '#eef5f9', { lw: lw, line: '#5d6b73', seed: s + 22 });
      if (readable) {
        letters(ctx, (o.temp === undefined ? '-18' : o.temp) + '°', x + w * 0.185, y + h * 0.540, h * 0.088, {
          fill: '#2f6b8f', weight: 0.15, track: 0.06, seed: s + 23
        });
      }

      var plate = box(x + w * 0.700, y + h * 0.440, w * 0.230, h * 0.115, 6, w * 0.005, s + 24);
      ink(ctx, plate, '#f0b429', { lw: lw * 0.85, line: '#8a6a1c', seed: s + 24 });
      if (readable) {
        letters(ctx, 'MR.B', x + w * 0.815, y + h * 0.525, h * 0.066, {
          fill: '#4a3226', weight: 0.15, track: 0.08, seed: s + 25, tilt: 0.04
        });
        letters(ctx, 'FROZEN FRIES', x + w * 0.500, y + h * 0.760, h * 0.072, {
          fill: '#5d6b73', weight: 0.13, track: 0.20, seed: s + 26
        });
      }

      // pilot lamp: cold blue when the compressor is holding temperature
      var lx = x + w * 0.500, ly = y + h * 0.520;
      ink(ctx, ellPts(lx, ly, w * 0.024, w * 0.024, 12, w * 0.003, s + 27),
          open > 0.5 ? '#e0c422' : '#5aa8d8', { lw: lw * 0.9, line: '#3f4a51', seed: s + 27 });
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = open > 0.5 ? '#ffe680' : '#a8dcf6';
      trace(ctx, ellPts(lx, ly, w * 0.050, w * 0.050, 14, w * 0.004, s + 28));
      ctx.fill();
      ctx.restore();

      [0.085, 0.915].forEach(function (f, j) {
        ink(ctx, box(x + w * f - w * 0.030, y + h * 0.920, w * 0.060, h * 0.060, 5, w * 0.004, s + 30 + j),
            '#3a3330', { lw: lw * 0.9, line: '#1c2226', seed: s + 30 + j });
      });
    }

    /* --------------------------------------------------------- dispenser */

    /**
     * Three-flavour fountain: mustard header, a badge + paddle + nozzle per
     * flavour, a cup standing in the drip tray under the one being pulled.
     *
     *   o.flavors  ids from Art.FLAVORS, default ['cola','orange','lemon']
     *   o.active   0..2 which lever is under the hand, default 0
     *   o.pour     0..1 the stream
     *   o.fill     0..1 how full the cup is; omit the cup with o.cup = false
     *   o.t        seconds, drives the stream wobble and the fizz
     */
    function drawDispenser(ctx, x, y, w, h, o) {
      o = o || {};
      var s = 1401, lw = Math.max(1, w * 0.014), i;
      var F = Art.FLAVORS || {};
      var ids = o.flavors || ['cola', 'orange', 'lemon'];
      var active = Math.max(0, Math.min(2, o.active === undefined ? 0 : o.active));
      var pour = Math.max(0, Math.min(1, o.pour === undefined ? 0 : o.pour));
      var t = o.t || 0;

      /* Vertical plan, all fractions of h. The bay has to be tall enough that a
       * cup standing in it is the biggest single shape on the machine - that is
       * what makes this read as a fountain and not as a microwave. */
      var signT = 0.040, signB = 0.128;
      var badgeT = 0.168, badgeB = 0.268;
      var deckT = 0.290, deckB = 0.336;      // the shelf the nozzles hang off
      var padT = 0.336, padB = 0.404;        // push paddles
      var nozT = 0.404, nozB = 0.452;
      var bayT = 0.452, trayT = 0.822;
      var trayB = 0.886, baseB = 0.952;

      /* --- back slab, then the recessed bay cut into it --- */
      var slab = jitter(dens([[x + w * 0.030, y + h * 0.026], [x + w * 0.970, y + h * 0.026],
                              [x + w * 0.970, y + h * trayT], [x + w * 0.030, y + h * trayT]], 8, true),
                        w * 0.005, s);
      ink(ctx, slab, '#cfd6da', { lw: lw, off: w * 0.005, line: '#5d6b73', seed: s });
      hatch(ctx, slab, '#5d6b73', s, { n: 8, alpha: 0.14, gap: h * 0.044 });

      var bay = jitter(dens([[x + w * 0.150, y + h * bayT], [x + w * 0.850, y + h * bayT],
                             [x + w * 0.850, y + h * trayT], [x + w * 0.150, y + h * trayT]], 8, true),
                       w * 0.005, s + 1);
      ink(ctx, bay, '#a3b3bc', { lw: lw, line: '#4a565d', seed: s + 1 });
      // one soft shadow down the left wall: enough depth without a grey wash
      ctx.save();
      trace(ctx, bay);
      ctx.clip();
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = '#3f4a51';
      trace(ctx, jitter(dens([[x + w * 0.150, y + h * bayT], [x + w * 0.290, y + h * bayT],
                              [x + w * 0.250, y + h * trayT], [x + w * 0.150, y + h * trayT]], 5, true),
                        w * 0.005, s + 2));
      ctx.fill();
      ctx.restore();

      /* --- header sign --- */
      var sign = jitter(dens([[x + w * 0.080, y + h * signT], [x + w * 0.920, y + h * signT],
                              [x + w * 0.920, y + h * signB], [x + w * 0.080, y + h * signB]], 7, true),
                        w * 0.005, s + 5);
      ink(ctx, sign, '#f0b429', { lw: lw, off: w * 0.004, line: '#8a6a1c', seed: s + 5 });
      hatch(ctx, sign, '#8a6a1c', s + 5, { n: 4, alpha: 0.14, gap: h * 0.026 });
      /*
       * Same floor as the freezer's captions. In the design this machine is
       * 370px tall; standing in the game's drink column it is nearer 90, where
       * the header is under five pixels. The mustard sign still reads as a
       * sign without the word on it, and the flavour badges still read as
       * flavours by colour - which is exactly what the beads they replaced did.
       */
      var readable = h * 0.052 >= 5;
      if (readable) {
        letters(ctx, o.brand || 'MR.B DRINKS', x + w * 0.500, y + h * (signB - 0.024), h * 0.052, {
          fill: '#4a3226', weight: 0.14, track: 0.11, seed: s + 6, tilt: 0.03
        });
      }

      /* --- the nozzle deck: one shelf across, so the three spouts share a line */
      var deck = jitter(dens([[x + w * 0.075, y + h * deckT], [x + w * 0.925, y + h * deckT],
                              [x + w * 0.925, y + h * deckB], [x + w * 0.075, y + h * deckB]], 7, true),
                        w * 0.005, s + 8);
      ink(ctx, deck, '#e2e8ec', { lw: lw, off: w * 0.004, line: '#5d6b73', seed: s + 8 });

      /* --- one column per flavour: badge, paddle, nozzle --- */
      var colStep = 0.283, col0 = 0.217;
      var badgeHalf = w * colStep * 0.415;
      for (i = 0; i < 3; i++) {
        /*
         * A tap that is not plumbed yet.
         *
         * The machine is three columns wide and the shop opens with two
         * flavours, so the third has to say something. A '?' badge reads as a
         * bug; dead steel with no label reads as a spout waiting to be
         * connected, which is what it is.
         */
        var fl = F[ids[i]];
        var blank = !fl;
        if (blank) fl = { label: '', band: '#aeb8bd', ink: '#aeb8bd', liquid: '#8fa3ae' };
        var cx = x + w * (col0 + i * colStep);
        var seed = s + 20 + i * 9;
        var on = i === active && pour > 0.05 && !blank;

        var bd = jitter(dens([[cx - badgeHalf, y + h * badgeT], [cx + badgeHalf, y + h * badgeT],
                              [cx + badgeHalf, y + h * badgeB], [cx - badgeHalf, y + h * badgeB]], 6, true),
                        w * 0.005, seed);
        ctx.save();
        if (blank) ctx.globalAlpha = 0.55;
        ink(ctx, bd, fl.band, { lw: lw * 0.9, off: w * 0.004, line: mix(fl.band, '#1c2226', 0.45), seed: seed });
        ctx.restore();
        // the label is measured against the badge and shrunk to fit, so a long
        // flavour ('ICE TEA') can never bleed into the badge beside it
        if (!blank && readable) {
          var lsz = h * 0.042, track = 0.055;
          var avail = badgeHalf * 2 - w * 0.030;
          var lw2 = Art.ui.width(fl.label, lsz, track);
          if (lw2 > avail) lsz *= avail / lw2;
          letters(ctx, fl.label, cx, y + h * (badgeB - 0.028), lsz, {
            fill: fl.ink, weight: 0.145, track: track, seed: seed + 1, tilt: 0.03
          });
        }

        // push paddle: leans in when this one is being pulled
        var lean = w * colStep * 0.12 * (on ? 1 : 0);
        ink(ctx, jitter(dens([[cx - badgeHalf * 0.62, y + h * padT], [cx + badgeHalf * 0.62, y + h * padT],
                              [cx + badgeHalf * 0.48 + lean, y + h * padB],
                              [cx - badgeHalf * 0.48 + lean, y + h * padB]], 6, true),
                        w * 0.004, seed + 2),
            on ? '#f6fafc' : '#b9c2c7', { lw: lw * 0.9, off: w * 0.003, line: '#4a565d', seed: seed + 2 });

        // nozzle
        var nozHalf = badgeHalf * 0.32;
        ink(ctx, jitter(dens([[cx - nozHalf, y + h * nozT], [cx + nozHalf, y + h * nozT],
                              [cx + nozHalf * 0.66, y + h * nozB], [cx - nozHalf * 0.66, y + h * nozB]], 5, true),
                        w * 0.004, seed + 3),
            '#9aa5ac', { lw: lw * 0.85, line: '#3f4a51', seed: seed + 3 });
        ink(ctx, ellPts(cx, y + h * nozB, nozHalf * 0.62, h * 0.010, 12, w * 0.003, seed + 4),
            '#2b3439', { lw: lw * 0.8, line: '#1c2226', seed: seed + 4 });
      }

      /* --- stream, then the cup on top of it: the drink disappears INTO the cup */
      var acx = x + w * (col0 + active * colStep);
      var cupH = h * 0.310, cupW = cupH * 0.615;
      var cupTop = y + h * trayT - cupH;
      var hasCup = o.cup !== false;
      if (pour > 0.05) {
        var fa = F[ids[active]] || { liquid: '#8fa3ae', foam: '#ffffff' };
        var landY = hasCup ? cupTop + cupH * (0.30 + 0.55 * (1 - (o.fill === undefined ? 0.55 : o.fill)))
                           : y + h * trayT;
        pourStream(ctx, acx, y + h * (nozB + 0.006), badgeHalf * 0.30, fa,
                   landY - y - h * (nozB + 0.006), t, s + 50);
      }
      if (hasCup && Art.item && Art.item.cup) {
        Art.item.cup(ctx, acx - cupW / 2, cupTop, cupW, cupH, {
          flavor: ids[active], clear: o.clear !== false, lid: false, straw: false,
          fill: o.fill === undefined ? 0.55 : o.fill, seed: 1450
        });
      }

      /* --- drip tray --- */
      var tray = jitter(dens([[x + w * 0.135, y + h * trayT], [x + w * 0.865, y + h * trayT],
                              [x + w * 0.865, y + h * trayB], [x + w * 0.135, y + h * trayB]], 8, true),
                        w * 0.005, s + 60);
      ink(ctx, tray, '#b9c2c7', { lw: lw, off: w * 0.004, line: '#4a565d', seed: s + 60 });
      ctx.save();
      trace(ctx, tray);
      ctx.clip();
      for (i = 0; i < 11; i++) {
        var gx = x + w * (0.175 + i * 0.066);
        line(ctx, [[gx, y + h * (trayT + 0.005)], [gx + w * 0.004, y + h * (trayB - 0.005)]],
             '#4a565d', lw * 0.7, 0.30, s + 61 + i);
      }
      ctx.restore();

      /* --- plinth and feet --- */
      var base = jitter(dens([[x + w * 0.070, y + h * trayB], [x + w * 0.930, y + h * trayB],
                              [x + w * 0.930, y + h * baseB], [x + w * 0.070, y + h * baseB]], 7, true),
                        w * 0.005, s + 80);
      ink(ctx, base, '#cfd6da', { lw: lw, off: w * 0.004, line: '#5d6b73', seed: s + 80 });
      hatch(ctx, base, '#5d6b73', s + 80, { n: 3, alpha: 0.18, gap: h * 0.020 });
      [0.140, 0.860].forEach(function (fr, j) {
        ink(ctx, box(x + w * fr - w * 0.030, y + h * baseB, w * 0.060, h * 0.042, 5, w * 0.004, s + 82 + j),
            '#3a3330', { lw: lw * 0.9, line: '#1c2226', seed: s + 82 + j });
      });
    }

    /** The stream out of one nozzle, plus the fizz where it lands. */
    function pourStream(ctx, nx, ny, halfW, f, len, t, seed) {
      var H = Math.max(halfW, len);
      ctx.save();
      ctx.globalAlpha = 0.92;
      var pts = [], i;
      for (i = 0; i <= 6; i++) {
        var fr = i / 6;
        pts.push([nx + Math.sin(t * 5 + fr * 3) * halfW * 0.22 * fr, ny + H * fr]);
      }
      ctx.strokeStyle = f.liquid;
      ctx.lineCap = 'round';
      ctx.lineWidth = halfW * 0.85;
      trace(ctx, pts);
      ctx.stroke();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = f.foam || '#ffffff';
      ctx.lineWidth = halfW * 0.24;
      trace(ctx, jitter(pts.slice(), halfW * 0.10, seed));
      ctx.stroke();
      // fizz where it lands
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(0.8, halfW * 0.18);
      for (var k = 0; k < 4; k++) {
        var a = -0.4 - k * 0.55 + Math.sin(t * 6 + k) * 0.2;
        var r = halfW * (1.1 + hash(seed * 3 + k) * 0.9);
        ctx.beginPath();
        ctx.arc(nx + (k % 2 ? r * 0.5 : -r * 0.5), ny + H, r * 0.6, a, a + 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* -------------------------------------------------------- register */
    Art.scene = Art.scene || {};
    Art.item = Art.item || {};
    Art.scene.freezer = drawFreezer;
    Art.scene.dispenser = drawDispenser;
    Art.item.fryBag = drawFryBag;
  }

  /* Install now, and again if art.js is reloaded under us. */
  function tryInstall() {
    var A = root.Art;
    if (A && A.ink && A.ui && A.ui.letters && A.item && A.item.stick) { install(A); return true; }
    return false;
  }
  if (!tryInstall()) {
    var n = 0;
    var iv = setInterval(function () {
      if (tryInstall() || ++n > 200) clearInterval(iv);
    }, 30);
    // Node keeps the process alive for a pending timer, and `npm test` loads
    // this file. Without unref the suite sat for six seconds after its last
    // assertion - art-prep.js and art-title.js both learned this the hard way.
    if (iv && iv.unref) iv.unref();
  }
/*
 * `self` first, the way art.js and art-fries-drinks.js resolve it.
 *
 * The handoff reaches for `window`, which is right in a browser and wrong
 * everywhere else: at module scope in CommonJS `this` is module.exports, not
 * the global, so under Node this installed onto an object nobody would ever
 * look at and Art.scene.freezer came back undefined in the test suite.
 */
})(typeof self !== 'undefined' ? self
   : (typeof window !== 'undefined' ? window
   : (typeof globalThis !== 'undefined' ? globalThis : this)));
