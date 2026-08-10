/*
 * Mr. Burger - procedural ingredient art, hand-drawn ("ink & wash") edition.
 *
 * Drop-in replacement for www/js/art.js. The public API, the layer ids and
 * every hFrac / wFrac are unchanged, so game.js, core.js and the tests do not
 * move: only the marks on the canvas are different.
 *
 * What changed: nothing is a clean vector any more. Every contour is a wobbled
 * polyline, the colour is laid down slightly off its outline the way a cheap
 * two-pass print misses register, and shading is hatched by hand instead of
 * blended. The wobble is derived from `hash(seed)` - NOT Math.random - so a
 * layer looks identical on every frame and never boils while the cook walks.
 *
 * Layers are drawn into a box: (x, y) is the top-left, w is the *bun* width.
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var INK = '#4a3226';        // pen
  var INK_SOFT = '#6b4a37';   // second, lighter pass

  /* ------------------------------------------------------------ helpers */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /** Stable pseudo-random so seeds, char marks and every pen wobble hold still. */
  function hash(n) {
    var t = (n + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function grad(ctx, x, y0, y1, top, bottom) {
    var g = ctx.createLinearGradient(x, y0, x, y1);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    return g;
  }

  /**
   * Blend two #rrggbb colours. Returns hex, not rgb(), so the result can be fed
   * straight back in - the patty chains raw -> seared -> charred, and an rgb()
   * return silently parsed to NaN and painted nothing at all.
   */
  function mixHex(a, b, t) {
    function p(h) {
      return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    }
    var ca = p(a), cb = p(b);
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.round(Math.max(0, Math.min(255, ca[i] + (cb[i] - ca[i]) * t)));
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  /* ------------------------------------------------------- the pen */
  /* A jitter that depends only on (seed, index): the same layer wobbles the
   * same way at any position on screen, so walking does not make it shimmer. */
  function wob(seed, i) { return hash(seed * 733 + i * 61 + 17) - 0.5; }

  function jitter(pts, amt, seed) {
    for (var i = 0; i < pts.length; i++) {
      pts[i][0] += wob(seed, i * 2) * amt;
      pts[i][1] += wob(seed, i * 2 + 1) * amt;
    }
    return pts;
  }

  function ellPts(cx, cy, rx, ry, n, amt, seed) {
    var o = [];
    for (var i = 0; i < n; i++) {
      var t = i / n * TAU;
      o.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    return jitter(o, amt, seed);
  }

  function blobPts(cx, cy, rx, ry, lobes, amp, ph, n, amt, seed) {
    var o = [];
    for (var i = 0; i < n; i++) {
      var t = i / n * TAU, r = 1 + Math.sin(t * lobes + ph) * amp;
      o.push([cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r]);
    }
    return jitter(o, amt, seed);
  }

  /** A crescent (moon) ring - the avocado slice silhouette. `th` is 0..1 of ry. */
  function crescentPts(cx, cy, rx, ry, th, amt, seed) {
    var o = [], n = 14, i, t;
    for (i = 0; i <= n; i++) {
      t = Math.PI + i / n * Math.PI;
      o.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }
    for (i = n; i >= 0; i--) {
      t = Math.PI + i / n * Math.PI;
      o.push([cx + Math.cos(t) * rx * (1 - th * 0.55), cy + Math.sin(t) * ry * (1 - th)]);
    }
    return jitter(o, amt, seed);
  }

  function rectPts(x, y, w, h, rad, amt, seed) {    rad = Math.min(rad, Math.abs(w) / 2, Math.abs(h) / 2);
    var o = [], step = 0.35;
    var c = [[x + rad, y + rad, Math.PI, 1.5 * Math.PI],
             [x + w - rad, y + rad, 1.5 * Math.PI, TAU],
             [x + w - rad, y + h - rad, 0, 0.5 * Math.PI],
             [x + rad, y + h - rad, 0.5 * Math.PI, Math.PI]];
    for (var k = 0; k < 4; k++) {
      var q = c[k];
      for (var a = q[2]; a <= q[3] + 1e-6; a += step) o.push([q[0] + Math.cos(a) * rad, q[1] + Math.sin(a) * rad]);
    }
    return jitter(o, amt, seed);
  }

  /** A band with wavy top and bottom edges, as a point ring - lettuce, sauces. */
  function bandPts(x, y, w, h, amp, waves, phase, amt, seed) {
    var o = [], n = 16, i, f;
    for (i = 0; i <= n; i++) {
      f = i / n;
      o.push([x + f * w, y + amp * Math.sin(f * waves * TAU + phase)]);
    }
    for (i = n; i >= 0; i--) {
      f = i / n;
      o.push([x + f * w, y + h + amp * Math.sin(f * waves * TAU + phase + 2.1)]);
    }
    return jitter(o, amt, seed);
  }

  function trace(ctx, pts) {
    var n = pts.length, i;
    ctx.beginPath();
    ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }

  function shifted(pts, dx, dy) {
    var o = [], i;
    for (i = 0; i < pts.length; i++) o.push([pts[i][0] + dx, pts[i][1] + dy]);
    return o;
  }

  /**
   * Lay colour down off-register, then draw the pen contour over it.
   * `o.lw` is the pen width; pass 0 for a shape that carries no line
   * (inner flesh, highlights) so tiny layers do not turn into solid ink.
   */
  function ink(ctx, pts, fill, o) {
    o = o || {};
    var lw = o.lw === undefined ? 1.2 : o.lw;
    var off = o.off || 0;
    if (fill) {
      ctx.save();
      if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
      trace(ctx, off ? shifted(pts, off, off * 0.85) : pts);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
    if (lw <= 0) return;
    ctx.save();
    ctx.strokeStyle = o.line || INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = o.lineAlpha === undefined ? 0.88 : o.lineAlpha;
    ctx.lineWidth = lw;
    trace(ctx, pts);
    ctx.stroke();
    // a second, lighter pass - the pen never lands twice in the same place
    ctx.globalAlpha = (o.lineAlpha === undefined ? 0.88 : o.lineAlpha) * 0.34;
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = o.line || INK_SOFT;
    trace(ctx, jitter(shifted(pts, 0, 0), lw * 0.5, (o.seed || 1) + 91));
    ctx.stroke();
    ctx.restore();
  }

  /** Hand hatching, clipped to a shape. The only shading in this style. */
  function hatch(ctx, pts, color, seed, opt) {
    opt = opt || {};
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i;
    for (i = 0; i < pts.length; i++) {
      x0 = Math.min(x0, pts[i][0]); y0 = Math.min(y0, pts[i][1]);
      x1 = Math.max(x1, pts[i][0]); y1 = Math.max(y1, pts[i][1]);
    }
    var bw = x1 - x0, bh = y1 - y0;
    var gap = opt.gap || Math.max(1.6, bh * 0.22);
    var n = opt.n || 4;
    ctx.save();
    trace(ctx, pts);
    ctx.clip();
    ctx.translate(x0 + bw * (opt.side === 'l' ? 0.24 : 0.72), y0 + bh * 0.55);
    ctx.rotate(-0.95);
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.9, gap * 0.34);
    for (i = 0; i < n; i++) {
      ctx.globalAlpha = (opt.alpha || 0.22) * (0.65 + hash(seed * 17 + i) * 0.6);
      var len = (bw + bh) * (0.16 + hash(seed * 29 + i) * 0.14);
      var yy = (i - n / 2) * gap;
      ctx.beginPath();
      ctx.moveTo(-len / 2, yy);
      ctx.quadraticCurveTo(0, yy + (hash(seed * 7 + i) - 0.5) * gap, len / 2, yy + (hash(seed * 5 + i) - 0.5) * gap);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Pen width for a layer, kept sane on both a 6px sauce and a 40px bun. */
  function pen(w, h) { return Math.max(0.9, Math.min(w * 0.017, h * 0.30)); }

  /* --------------------------------------------------------- ingredients */
  // hFrac / wFrac are multiples of the bun width - unchanged from the original.
  var LAYERS = {

    bunBottom: {
      hFrac: 0.24, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 11;
        var p = rectPts(x, y, w, h, h * 0.50, w * 0.012, s);
        ink(ctx, p, '#e8b46f', { lw: lw, off: w * 0.012, seed: s });
        hatch(ctx, p, '#a4692c', s, { n: 4, alpha: 0.20, gap: h * 0.26 });
        // toasted face, no line of its own
        ink(ctx, rectPts(x + w * 0.05, y + h * 0.03, w * 0.90, h * 0.30, h * 0.14, w * 0.010, s + 3),
            'rgba(255,236,196,0.55)', { lw: 0 });
      }
    },

    bunTop: {
      hFrac: 0.40, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 23, i;
        var d = [], n = 22;
        for (i = 0; i <= n; i++) {
          var t = Math.PI + i / n * Math.PI;
          d.push([x + w / 2 + Math.cos(t) * w * 0.5, y + h * 0.94 + Math.sin(t) * h * 0.86]);
        }
        d.push([x + w, y + h], [x + w * 0.5, y + h * 1.02], [x, y + h]);
        jitter(d, w * 0.013, s);
        ink(ctx, d, '#eab470', { lw: lw, off: w * 0.012, seed: s });
        hatch(ctx, d, '#a4692c', s, { n: 5, alpha: 0.20, gap: h * 0.16 });

        // sesame seeds - drawn as little wobbled ovals, not perfect ellipses
        for (i = 0; i < 6; i++) {
          var sx = x + w * (0.18 + hash(i * 3 + 1) * 0.64);
          var sy = y + h * (0.30 + hash(i * 5 + 2) * 0.42);
          ink(ctx, ellPts(sx, sy, w * 0.032, w * 0.019, 9, w * 0.006, s + i),
              '#fff4dd', { lw: lw * 0.55, line: '#a8763f', lineAlpha: 0.55, seed: s + i });
        }
      }
    },

    patty: {
      hFrac: 0.18, wFrac: 1.03,
      /*
       * opts.done  0 = raw beef out of the crate, 1 = properly seared
       * opts.char  0 = none, 1 = written off
       * The hero of the burger, so it gets real thickness: a dark side wall
       * under a domed top face, a bitten-in rim and sear marks with weight.
       */
      draw: function (ctx, x, y, w, h, opts) {
        var done = opts && typeof opts.done === 'number' ? opts.done : 1;
        var char = (opts && opts.char) || 0;
        var lw = pen(w, h) * 1.15, s = 37, i;

        var body = mixHex('#e08c83', '#8f5731', done);
        var deep = mixHex('#b2504a', '#532c1a', done);
        if (char > 0) {
          body = mixHex(body, '#3a2a20', char);
          deep = mixHex(deep, '#1c1210', char);
        }

        // side wall
        var side = blobPts(x + w / 2, y + h * 0.62, w * 0.50, h * 0.36, 6, 0.04, 0.4, 24, w * 0.009, s + 1);
        ink(ctx, side, deep, { lw: lw, off: w * 0.008, seed: s + 1 });
        // top face, sitting proud of the wall
        var p = blobPts(x + w / 2, y + h * 0.40, w * 0.495, h * 0.34, 7, 0.05, 0.4, 26, w * 0.009, s);
        ink(ctx, p, body, { lw: lw, off: w * 0.008, seed: s });
        hatch(ctx, p, deep, s, { n: 4, alpha: 0.26, gap: h * 0.16 });

        ctx.save();
        trace(ctx, p);
        ctx.clip();

        if (done < 0.85) {
          ctx.globalAlpha = 0.5 * (1 - done);
          ctx.fillStyle = '#f8e2d6';
          for (i = 0; i < 7; i++) {
            trace(ctx, ellPts(x + hash(i * 17 + 3) * w, y + h * 0.28 + hash(i * 19 + 8) * h * 0.26,
                              w * 0.028, h * 0.09, 8, w * 0.005, s + i));
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        if (done > 0.60 || char > 0) {
          var mark = Math.min(1, (done - 0.60) / 0.40 + char);
          ctx.strokeStyle = mixHex(deep, '#1d0e06', 0.6);
          ctx.lineWidth = Math.max(1.6, h * 0.13);
          ctx.lineCap = 'round';
          ctx.globalAlpha = mark * 0.9;
          for (i = 0; i < 4; i++) {
            var lx = x + w * (0.20 + i * 0.20);
            ctx.beginPath();
            ctx.moveTo(lx + wob(s, i) * w * 0.015, y + h * 0.20);
            ctx.quadraticCurveTo(lx + w * 0.05, y + h * 0.40, lx + w * 0.08 + wob(s, i + 9) * w * 0.015, y + h * 0.58);
            ctx.stroke();
          }
        }
        // juicy top light
        ctx.globalAlpha = 0.16 * (1 - char);
        ctx.fillStyle = '#ffffff';
        trace(ctx, ellPts(x + w * 0.38, y + h * 0.28, w * 0.18, h * 0.07, 12, w * 0.004, s + 40));
        ctx.fill();
        ctx.restore();
      }
    },

    /* Cheese: one tilted slice whose corners hang past the bun and whose lower
     * edge has actually melted into lobes - not a rectangle with legs. */
    cheese: {
      hFrac: 0.10, wFrac: 1.08,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 51, i, f;
        /* The read has to survive a 100x10 sliver, so the silhouette does the
         * work: a square slice sits at an angle on a round bun, which means two
         * sharp corners hanging DOWN past the ends and a melted sag between
         * them. Colour alone was never going to say "cheese" at this size. */
        var top = y - h * 0.16, H = h * 2.0;
        var pts = [];
        // Corner points are repeated: trace() smooths through its points, and a
        // single vertex at a corner just rounds it back off into a blob.
        pts.push([x, top + H * 0.70]);
        pts.push([x, top + H * 0.70]);
        pts.push([x, top + H * 0.70]);
        pts.push([x + w * 0.14, top + H * 0.10]);
        pts.push([x + w * 0.52, top]);
        pts.push([x + w * 0.86, top + H * 0.06]);
        pts.push([x + w, top + H * 0.62]);
        pts.push([x + w, top + H * 0.62]);
        pts.push([x + w, top + H * 0.62]);
        for (i = 5; i >= 1; i--) {
          f = i / 6;
          var sag = 0.60 + 0.26 * Math.sin(f * Math.PI) + 0.09 * Math.sin(f * 9);
          pts.push([x + f * w, top + H * sag]);
        }
        jitter(pts, w * 0.006, s);
        ink(ctx, pts, '#f7c343', { lw: lw, off: w * 0.007, line: '#a86f08', seed: s });
        ctx.save();
        trace(ctx, pts);
        ctx.clip();
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = '#b07607';
        trace(ctx, ellPts(x + w * 0.30, top + H * 0.34, w * 0.045, H * 0.11, 10, w * 0.004, s + 4)); ctx.fill();
        trace(ctx, ellPts(x + w * 0.66, top + H * 0.28, w * 0.034, H * 0.09, 10, w * 0.004, s + 5)); ctx.fill();
        ctx.globalAlpha = 0.40;
        ctx.fillStyle = '#fff0b8';
        trace(ctx, ellPts(x + w * 0.40, top + H * 0.14, w * 0.22, H * 0.06, 12, w * 0.004, s + 6)); ctx.fill();
        ctx.restore();
      }
    },

    /* Lettuce: three ruffled leaf lobes overlapping, pale rib down each one.
     * The only ingredient with a torn, non-repeating edge. */
    lettuce: {
      hFrac: 0.14, wFrac: 1.10,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 67, i;
        for (i = 0; i < 3; i++) {
          var cx = x + w * (0.24 + i * 0.26);
          var p = blobPts(cx, y + h * (0.46 + (i % 2) * 0.10), w * 0.30, h * 0.42,
                          9, 0.20, 0.6 + i * 1.7, 30, w * 0.008, s + i);
          ink(ctx, p, i === 1 ? '#9ad46e' : '#84c25c',
              { lw: lw * 0.95, off: w * 0.006, line: '#3f7a2a', seed: s + i });
          ctx.save();
          trace(ctx, p);
          ctx.clip();
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = Math.max(0.9, h * 0.06);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - w * 0.18, y + h * 0.55);
          ctx.quadraticCurveTo(cx, y + h * 0.40, cx + w * 0.18, y + h * 0.55);
          ctx.stroke();
          ctx.restore();
          hatch(ctx, p, '#3f7a2a', s + i, { n: 2, alpha: 0.20, gap: h * 0.18 });
        }
      }
    },

    /* Tomato: a thick slice with a lobed rim and three big seed cavities.
     * Five thin membranes vanished at burger scale; three fat ones survive. */
    tomato: {
      hFrac: 0.11, wFrac: 0.94,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 83, i;
        var cx = x + w / 2, cy = y + h * 0.44, H = h * 1.25;
        // cut face is a lobed round, not a clean ellipse
        var side = blobPts(cx, cy + H * 0.26, w * 0.5, H * 0.42, 6, 0.045, 0.5, 26, w * 0.006, s + 1);
        ink(ctx, side, '#b8271f', { lw: lw, off: w * 0.006, line: '#8a1a14', seed: s + 1 });
        var p = blobPts(cx, cy, w * 0.5, H * 0.44, 6, 0.05, 0.5, 26, w * 0.006, s);
        ink(ctx, p, '#ef5346', { lw: lw, off: w * 0.007, line: '#9e2019', seed: s });
        ctx.save();
        trace(ctx, p);
        ctx.clip();
        ctx.fillStyle = '#fbc0b2';
        trace(ctx, blobPts(cx, cy, w * 0.40, H * 0.30, 6, 0.07, 0.5, 22, w * 0.005, s + 2)); ctx.fill();
        // three fat seed pockets with a pale wall around each
        for (i = 0; i < 3; i++) {
          var px = cx + (i - 1) * w * 0.26;
          ctx.fillStyle = '#ffe6da';
          trace(ctx, ellPts(px, cy, w * 0.105, H * 0.24, 14, w * 0.004, s + i + 10)); ctx.fill();
          ctx.fillStyle = '#f2cf7a';
          trace(ctx, ellPts(px - w * 0.028, cy - H * 0.03, w * 0.030, H * 0.09, 9, w * 0.003, s + i + 20)); ctx.fill();
          trace(ctx, ellPts(px + w * 0.030, cy + H * 0.05, w * 0.026, H * 0.08, 9, w * 0.003, s + i + 30)); ctx.fill();
        }
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ffffff';
        trace(ctx, ellPts(cx - w * 0.16, cy - H * 0.26, w * 0.14, H * 0.07, 12, w * 0.004, s + 40)); ctx.fill();
        ctx.restore();
      }
    },

    onion: {
      hFrac: 0.095, wFrac: 0.90,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 97;
        for (var i = 0; i < 3; i++) {
          var cx = x + w * (0.22 + i * 0.28);
          var p = ellPts(cx, y + h * 0.5, w * 0.15, h * 0.44, 16, w * 0.007, s + i);
          ink(ctx, p, '#d9c0ea', { lw: lw * 0.9, off: w * 0.006, seed: s + i });
          ink(ctx, ellPts(cx, y + h * 0.5, w * 0.075, h * 0.22, 14, w * 0.005, s + i + 40),
              null, { lw: lw * 0.7, line: '#9b74c0', lineAlpha: 0.7, seed: s + i });
        }
      }
    },

    /* Pickle: three FAT crinkle-cut coins, olive-yellow, pale seeded middle.
     * Deliberately the roundest, warmest green in the kitchen so it never
     * reads as lettuce (frilly, cool) or avocado (crescent, dark-rimmed). */
    pickle: {
      hFrac: 0.085, wFrac: 0.84,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 113, i, k;
        for (i = 0; i < 3; i++) {
          var cx = x + w * (0.19 + i * 0.31);
          // crinkle cut: many small lobes on the rim
          var p = blobPts(cx, y + h * 0.5, w * 0.155, h * 0.50, 11, 0.11, 0.3 + i, 26, w * 0.005, s + i);
          ink(ctx, p, '#c2cc4e', { lw: lw * 0.9, off: w * 0.005, line: '#5f7a1e', seed: s + i });
          ink(ctx, ellPts(cx, y + h * 0.5, w * 0.085, h * 0.28, 12, w * 0.004, s + i + 30),
              '#e6ee9e', { lw: 0 });
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = '#7d952c';
          for (k = 0; k < 3; k++) {
            var a = k * TAU / 3 + i;
            trace(ctx, ellPts(cx + Math.cos(a) * w * 0.042, y + h * 0.5 + Math.sin(a) * h * 0.13,
                              w * 0.016, h * 0.055, 7, w * 0.002, s + i * 5 + k));
            ctx.fill();
          }
          ctx.restore();
        }
      }
    },

    bacon: {
      hFrac: 0.11, wFrac: 0.98,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 131;
        for (var i = 0; i < 2; i++) {
          var p = bandPts(x, y + h * (0.05 + i * 0.47), w, h * 0.36, h * 0.15, 2.4, i * 1.9, w * 0.008, s + i);
          ink(ctx, p, '#c9503a', { lw: lw * 0.95, off: w * 0.007, seed: s + i });
          ctx.save();
          trace(ctx, p);
          ctx.clip();
          ctx.strokeStyle = '#ffcfc2';
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = Math.max(1, h * 0.10);
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (var px = 0; px <= w; px += Math.max(3, w / 12)) {
            ctx.lineTo(x + px, y + h * (0.19 + i * 0.47) + Math.sin(px / w * 5 + i * 2) * h * 0.09);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    },

    /* Jalapeno: small deep-green rings with a real hole punched through them.
     * Smallest and darkest of the greens, and the only one you can see the
     * plate through. */
    jalapeno: {
      hFrac: 0.08, wFrac: 0.82,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 149, i, n = 3;
        var R = h * 0.56;
        var tiny = R < 3.2;
        for (i = 0; i < n; i++) {
          var cx = x + w * (0.22 + i * 0.28), cy = y + h * 0.5;
          // slightly oval, wall thicker than the hole: reads as a chilli tube
          ink(ctx, ellPts(cx, cy, R * 1.05, R, 16, w * 0.004, s + i), '#2f7d2b',
              { lw: lw * 0.9, off: w * 0.004, line: '#17470f', seed: s + i });
          if (tiny) {
            ink(ctx, ellPts(cx, cy, R * 0.36, R * 0.34, 8, 0, s + i + 20), '#f2f8d8', { lw: 0 });
            continue;
          }
          ink(ctx, ellPts(cx, cy, R * 0.42, R * 0.40, 12, w * 0.003, s + i + 20),
              '#f2f8d8', { lw: lw * 0.6, line: '#17470f', lineAlpha: 0.75, seed: s + i + 20 });
          ctx.save();
          ctx.strokeStyle = '#f2f8d8';
          ctx.globalAlpha = 0.75;
          ctx.lineWidth = Math.max(0.9, R * 0.13);
          ctx.lineCap = 'round';
          for (var k = 0; k < 4; k++) {
            var a = k * TAU / 4 + i * 0.3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * R * 0.40, cy + Math.sin(a) * R * 0.38);
            ctx.lineTo(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.68);
            ctx.stroke();
          }
          ctx.restore();
          // tiny seeds inside the hole - the giveaway that it is a chilli
          ctx.save();
          ctx.fillStyle = '#e8d98a';
          ctx.globalAlpha = 0.9;
          for (k = 0; k < 2; k++) {
            trace(ctx, ellPts(cx + (k ? R * 0.14 : -R * 0.13), cy + (k ? -R * 0.10 : R * 0.09),
                              R * 0.10, R * 0.09, 7, 0, s + i * 3 + k));
            ctx.fill();
          }
          ctx.restore();
        }
      }
    },

    egg: {
      hFrac: 0.14, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 167;
        var p = blobPts(x + w * 0.5, y + h * 0.55, w * 0.47, h * 0.44, 5, 0.09, 0.7, 24, w * 0.010, s);
        ink(ctx, p, '#fffaee', { lw: lw, off: w * 0.008, seed: s });
        hatch(ctx, p, '#cbb794', s, { n: 3, alpha: 0.30, gap: h * 0.20 });
        var yk = blobPts(x + w * 0.5, y + h * 0.50, w * 0.16, h * 0.32, 6, 0.05, 1.2, 16, w * 0.006, s + 7);
        ink(ctx, yk, '#f9c53c', { lw: lw * 0.85, off: w * 0.006, seed: s + 7 });
        hatch(ctx, yk, '#e08f13', s + 7, { n: 2, alpha: 0.28, gap: h * 0.16 });
      }
    },

    /* Avocado: overlapping CRESCENT fans with a dark skin edge along the outer
     * curve - the one green in the kitchen that is not a circle, and the only
     * one carrying a near-black rim. */
    avocado: {
      hFrac: 0.10, wFrac: 0.92,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 181, i;
        for (i = 0; i < 3; i++) {
          var cx = x + w * (0.22 + i * 0.28), cy = y + h * 0.62;
          var rx = w * 0.17, ry = h * 0.94, th = 0.52;
          var p = crescentPts(cx, cy, rx, ry, th, w * 0.005, s + i);
          ink(ctx, p, '#cfe08f', { lw: lw * 0.85, off: w * 0.005, line: '#3f5d28', seed: s + i });
          // dark skin hugging the outer arc only
          ctx.save();
          trace(ctx, p);
          ctx.clip();
          ctx.strokeStyle = '#3f5d28';
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = Math.max(1.3, ry * 0.30);
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.02, Math.PI * 1.98);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  };

  /* The heel: a flat slab with a pale cut face on top and a rounded bottom.
   * It used to alias to bunTop, which put a seeded crown under the patty and
   * made every burger look like two lids stuck together. */
  LAYERS.bun = {
    hFrac: 0.20, wFrac: 1.00,
    draw: function (ctx, x, y, w, h) {
      var lw = pen(w, h), s = 29, i;
      var d = [], n = 14;
      // rounded underside
      for (i = 0; i <= n; i++) {
        var t = i / n * Math.PI;
        d.push([x + w * 0.5 - Math.cos(t) * w * 0.5, y + h * 0.42 + Math.sin(t) * h * 0.60]);
      }
      d.push([x + w * 0.5, y + h * 0.30], [x, y + h * 0.42]);
      jitter(d, w * 0.010, s);
      ink(ctx, d, '#e0a75f', { lw: lw, off: w * 0.010, line: '#8f5a24', seed: s });
      hatch(ctx, d, '#a4692c', s, { n: 4, alpha: 0.22, gap: h * 0.30 });
      // pale cut face along the top, the giveaway that this is a sliced heel
      var cut = [];
      for (i = 0; i <= 12; i++) {
        var f = i / 12;
        cut.push([x + f * w, y + h * (0.30 + 0.05 * Math.sin(f * 5))]);
      }
      for (i = 12; i >= 0; i--) {
        var g2 = i / 12;
        cut.push([x + g2 * w, y + h * (0.62 + 0.05 * Math.sin(g2 * 5 + 1.4))]);
      }
      jitter(cut, w * 0.008, s + 3);
      ink(ctx, cut, '#f6dcae', { lw: lw * 0.8, off: w * 0.006, line: '#a8763f', lineAlpha: 0.7, seed: s + 3 });
    }
  };

  /* -------------------------------------------------------------- sauces */
  /* Five sauces that have to be told apart in a 6px band, so each one gets its
   * own MARK, not just its own colour: ketchup zig-zags, mustard is a thin fast
   * squiggle, mayo is a row of fat dollops, BBQ is a solid slab with a dark
   * lower edge, the house sauce is a drizzle with dots. */
  var SAUCES = {
    ketchup: '#d62828',
    mustard: '#f0bc18',
    mayo: '#fbf3dd',
    bbq: '#a45520',
    special: '#ff8fab'
  };
  var SAUCE_LINE = {
    ketchup: '#8f1c1c',
    mustard: '#a87d09',
    mayo: '#c9b98d',
    bbq: '#5c2a0c',
    special: '#c65f7c'
  };
  var SAUCE_MARK = { ketchup: 'zig', mustard: 'fine', mayo: 'fat', bbq: 'pool', special: 'drizzle' };

  Object.keys(SAUCES).forEach(function (id, k) {
    LAYERS[id] = {
      hFrac: 0.06, wFrac: 0.88,
      sauce: true,
      /* Sauce is squeezed, not spread: it is a ROPE with round ends and a wet
       * highlight along the top, and each bottle pipes a different line. A flat
       * wavy band read as a coloured hairline and nothing else. */
      draw: function (ctx, x, y, w, h, opts) {
        var s = 199 + k * 13, mark = SAUCE_MARK[id], i, f;
        var cy = y + h * 0.52;
        var col = SAUCES[id], dark = SAUCE_LINE[id];

        if (mark === 'pool') {
          // BBQ floods rather than pipes: a broad pool with drips off the front.
          // Kept lighter than the other sauces on purpose - it lives inside a
          // dark brown crate, where a true BBQ brown disappears entirely.
          var p = bandPts(x, y + h * 0.10, w, h * 0.62, h * 0.14, 2, 0.6, w * 0.005, s);
          ink(ctx, p, col, { lw: Math.max(0.9, h * 0.16), line: dark, lineAlpha: 0.85, off: w * 0.004, seed: s });
          ctx.save();
          trace(ctx, p); ctx.clip();
          ctx.globalAlpha = 0.42; ctx.fillStyle = '#ffd9a8';
          ctx.fillRect(x, y + h * 0.14, w, h * 0.16);
          ctx.restore();
          ctx.save();
          for (i = 0; i < 3; i++) {
            var dx2 = x + w * (0.22 + i * 0.28);
            trace(ctx, ellPts(dx2, y + h * 0.86, w * 0.030, h * 0.30, 10, w * 0.003, s + i));
            ctx.fillStyle = dark; ctx.globalAlpha = 0.9; ctx.fill();
          }
          ctx.restore();
          return;
        }

        var amp = h * (mark === 'fine' ? 0.20 : 0.30);
        var freq = mark === 'zig' ? 3.5 : (mark === 'fine' ? 6 : 2);
        var rope = mark === 'fat' ? h * 0.78 : (mark === 'fine' ? h * 0.34 : h * 0.54);
        var n = 40, path = [];
        for (i = 0; i <= n; i++) {
          f = i / n;
          var yy = mark === 'zig'
            ? cy + amp * (Math.abs(((f * freq) % 1) * 2 - 1) * 2 - 1)
            : cy + amp * Math.sin(f * freq * TAU + 0.4);
          if (mark === 'fat') yy += Math.sin(f * 9) * h * 0.10;
          path.push([x + f * w, yy + wob(s, i) * h * 0.05]);
        }

        function stroke(width, color, alpha) {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(0.8, width);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(path[0][0], path[0][1]);
          for (var j = 1; j < path.length; j++) ctx.lineTo(path[j][0], path[j][1]);
          ctx.stroke();
          ctx.restore();
        }

        stroke(rope + Math.max(1, h * 0.18), dark, 0.85);
        stroke(rope, col, 1);
        // wet highlight riding the top of the rope
        ctx.save();
        ctx.translate(0, -rope * 0.24);
        stroke(rope * 0.24, '#ffffff', mark === 'fat' ? 0.55 : 0.40);
        ctx.restore();

        if (mark === 'fat') {
          // mayo lands in blobs, so give the rope visible round ends
          for (i = 0; i < 5; i++) {
            ink(ctx, ellPts(x + w * (0.10 + i * 0.20), path[Math.round(i * 8 + 4)][1],
                            rope * 0.42, rope * 0.40, 12, w * 0.003, s + i),
                col, { lw: Math.max(0.8, h * 0.14), line: dark, lineAlpha: 0.8, seed: s + i });
          }
        }
        if (mark === 'drizzle') {
          ctx.save();
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.95;
          for (i = 0; i < 4; i++) {
            trace(ctx, ellPts(x + w * (0.16 + i * 0.23), y + h * (i % 2 ? 0.12 : 0.88),
                              w * 0.020, h * 0.15, 8, 0, s + i));
            ctx.fill();
          }
          ctx.restore();
        }
      }
    };
  });

  /* ----------------------------------------------- crate portraits
   * The crate is a container of INGREDIENTS, not a stack of burger layers, so
   * what sits in it is the whole thing you would recognise in a fridge: half an
   * avocado with the stone in, a whole tomato with its calyx, a bottle of
   * ketchup. The sliced/stacked versions above are only for the burger itself.
   * Call Art.drawPortrait(ctx, id, w, h); it falls back to drawIcon when an
   * ingredient has no portrait of its own.
   */
  function tapered(cx, cy, len, halfW, bend, taper, bumps, amt, seed) {
    var L = [], Rt = [], n = 12, i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var px = cx + Math.sin(t * 1.7 + 0.2) * bend;
      var py = cy - len / 2 + t * len;
      var hw = halfW * (1 - t * taper) * (bumps ? 1 + Math.sin(t * 9) * 0.10 : 1);
      hw *= Math.sin(Math.min(1, t * 3.2)) * 0.35 + 0.75;
      L.push([px - hw, py]);
      Rt.push([px + hw, py]);
    }
    return jitter(L.concat(Rt.reverse()), amt, seed);
  }

  var PORTRAITS = {
    bun: function (ctx, cx, cy, P, lw) {
      var s = 401, i;
      ink(ctx, rectPts(cx - P * 0.36, cy + P * 0.10, P * 0.72, P * 0.20, P * 0.09, P * 0.008, s + 1),
          '#dda45f', { lw: lw, off: P * 0.008, line: '#8f5a24', seed: s + 1 });
      var d = [];
      for (i = 0; i <= 20; i++) {
        var t = Math.PI + i / 20 * Math.PI;
        d.push([cx + Math.cos(t) * P * 0.38, cy + P * 0.12 + Math.sin(t) * P * 0.34]);
      }
      d.push([cx + P * 0.38, cy + P * 0.14], [cx - P * 0.38, cy + P * 0.14]);
      jitter(d, P * 0.009, s);
      ink(ctx, d, '#eab470', { lw: lw, off: P * 0.008, line: '#8f5a24', seed: s });
      hatch(ctx, d, '#a4692c', s, { n: 5, alpha: 0.20, gap: P * 0.055 });
      for (i = 0; i < 6; i++) {
        ink(ctx, ellPts(cx - P * 0.26 + hash(i * 3 + 1) * P * 0.52, cy - P * 0.16 + hash(i * 5) * P * 0.20,
                        P * 0.030, P * 0.017, 9, P * 0.004, s + i + 10),
            '#fff4dd', { lw: lw * 0.55, line: '#a8763f', lineAlpha: 0.55, seed: s + i });
      }
    },
    patty: function (ctx, cx, cy, P, lw) {
      var s = 403;
      ink(ctx, blobPts(cx, cy + P * 0.14, P * 0.36, P * 0.17, 6, 0.05, 0.4, 24, P * 0.008, s + 1),
          '#a8564c', { lw: lw, off: P * 0.007, line: '#6b2f24', seed: s + 1 });
      var p = blobPts(cx, cy - P * 0.02, P * 0.36, P * 0.19, 7, 0.06, 0.4, 26, P * 0.008, s);
      ink(ctx, p, '#e08c83', { lw: lw, off: P * 0.007, line: '#6b2f24', seed: s });
      ctx.save(); trace(ctx, p); ctx.clip();
      ctx.fillStyle = '#f9e3d8'; ctx.globalAlpha = 0.8;
      for (var i = 0; i < 9; i++) {
        trace(ctx, ellPts(cx - P * 0.3 + hash(i * 17) * P * 0.6, cy - P * 0.14 + hash(i * 19) * P * 0.24,
                          P * 0.028, P * 0.014, 8, P * 0.004, s + i)); ctx.fill();
      }
      ctx.restore();
      hatch(ctx, p, '#8f3f34', s, { n: 4, alpha: 0.20, gap: P * 0.045 });
    },
    cheese: function (ctx, cx, cy, P, lw) {
      var s = 405, i;
      // a wedge, plus one slice leaning behind it
      ink(ctx, rectPts(cx - P * 0.30, cy - P * 0.22, P * 0.46, P * 0.34, P * 0.03, P * 0.008, s + 1),
          '#f0b52c', { lw: lw, off: P * 0.007, line: '#a86f08', seed: s + 1 });
      var w = jitter([[cx - P * 0.34, cy + P * 0.26], [cx + P * 0.34, cy + P * 0.26],
                      [cx + P * 0.34, cy - P * 0.02], [cx - P * 0.34, cy + P * 0.12]], P * 0.010, s);
      ink(ctx, w, '#f7c343', { lw: lw, off: P * 0.008, line: '#a86f08', seed: s });
      ctx.save(); trace(ctx, w); ctx.clip();
      ctx.globalAlpha = 0.32; ctx.fillStyle = '#8a5a05';
      for (i = 0; i < 3; i++) {
        trace(ctx, ellPts(cx - P * 0.18 + i * P * 0.19, cy + P * (0.10 + (i % 2) * 0.07),
                          P * 0.045, P * 0.036, 11, P * 0.004, s + i)); ctx.fill();
      }
      ctx.restore();
      hatch(ctx, w, '#b57806', s, { n: 3, alpha: 0.20, gap: P * 0.05 });
    },
    lettuce: function (ctx, cx, cy, P, lw) {
      var s = 407, i;
      // A whole head: pale round core wrapped in big outer leaves.
      var head = blobPts(cx, cy + P * 0.04, P * 0.31, P * 0.30, 5, 0.05, 0.8, 30, P * 0.007, s);
      ink(ctx, head, '#cfe6a0', { lw: lw, off: P * 0.006, line: '#4f8f34', seed: s });
      // outer leaves hugging the sides, ruffled at the top
      for (i = 0; i < 4; i++) {
        var a = Math.PI + 0.35 + i * (Math.PI - 0.7) / 3;
        var lx = cx + Math.cos(a) * P * 0.24, ly = cy + P * 0.06 + Math.sin(a) * P * 0.22;
        ink(ctx, blobPts(lx, ly, P * 0.16, P * 0.15, 8, 0.22, i * 1.6, 26, P * 0.007, s + i),
            i % 2 ? '#7fbc57' : '#8ecb63', { lw: lw * 0.9, off: P * 0.006, line: '#3f7a2a', seed: s + i });
      }
      // veins on the exposed core
      ctx.save();
      trace(ctx, head); ctx.clip();
      ctx.strokeStyle = '#8ab861'; ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, P * 0.014); ctx.lineCap = 'round';
      for (i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * P * 0.10, cy + P * 0.26);
        ctx.quadraticCurveTo(cx + i * P * 0.16, cy + P * 0.02, cx + i * P * 0.05, cy - P * 0.20);
        ctx.stroke();
      }
      ctx.restore();
      hatch(ctx, head, '#6ba044', s + 9, { n: 3, alpha: 0.20, gap: P * 0.05 });
    },
    tomato: function (ctx, cx, cy, P, lw) {
      var s = 409, i;
      var p = blobPts(cx, cy + P * 0.06, P * 0.34, P * 0.31, 4, 0.035, 0.6, 26, P * 0.008, s);
      ink(ctx, p, '#e04a3f', { lw: lw, off: P * 0.008, line: '#9e2019', seed: s });
      hatch(ctx, p, '#9e2019', s, { n: 4, alpha: 0.18, gap: P * 0.055 });
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffffff';
      trace(ctx, ellPts(cx - P * 0.12, cy - P * 0.08, P * 0.09, P * 0.05, 12, P * 0.004, s + 3)); ctx.fill();
      ctx.restore();
      for (i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * TAU / 5;
        ink(ctx, blobPts(cx + Math.cos(a) * P * 0.13, cy - P * 0.24 + Math.sin(a) * P * 0.06,
                         P * 0.10, P * 0.05, 3, 0.20, a, 14, P * 0.005, s + i + 10),
            '#4f8f34', { lw: lw * 0.8, line: '#2f5c1c', seed: s + i });
      }
      ink(ctx, rectPts(cx - P * 0.025, cy - P * 0.36, P * 0.05, P * 0.11, P * 0.02, P * 0.005, s + 20),
          '#4f8f34', { lw: lw * 0.8, line: '#2f5c1c', seed: s + 20 });
    },
    onion: function (ctx, cx, cy, P, lw) {
      var s = 411, i;
      var p = blobPts(cx, cy + P * 0.08, P * 0.30, P * 0.30, 4, 0.04, 0.9, 26, P * 0.008, s);
      ink(ctx, p, '#d3b0e8', { lw: lw, off: P * 0.007, line: '#7d4fa8', seed: s });
      ctx.save(); trace(ctx, p); ctx.clip();
      ctx.strokeStyle = '#a87ccc'; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1, P * 0.012);
      for (i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * P * 0.11, cy - P * 0.24);
        ctx.quadraticCurveTo(cx + i * P * 0.16, cy + P * 0.08, cx + i * P * 0.06, cy + P * 0.38);
        ctx.stroke();
      }
      ctx.restore();
      // papery neck
      ink(ctx, jitter([[cx - P * 0.06, cy - P * 0.22], [cx + P * 0.06, cy - P * 0.22],
                       [cx + P * 0.02, cy - P * 0.40], [cx - P * 0.03, cy - P * 0.38]], P * 0.008, s + 5),
          '#e8dcc4', { lw: lw * 0.85, line: '#a89170', seed: s + 5 });
    },
    pickle: function (ctx, cx, cy, P, lw) {
      var s = 413, i;
      // The jar pickle everyone pictures: fat oblong, blunt ends, warty skin,
      // pale stripes running the length of it.
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.28); ctx.translate(-cx, -cy);
      var p = blobPts(cx, cy, P * 0.15, P * 0.34, 14, 0.045, 0.4, 34, P * 0.006, s);
      ink(ctx, p, '#6f9a34', { lw: lw, off: P * 0.006, line: '#33500f', seed: s });
      ctx.save();
      trace(ctx, p); ctx.clip();
      ctx.strokeStyle = '#9dc456'; ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1, P * 0.020); ctx.lineCap = 'round';
      for (i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * P * 0.075, cy - P * 0.30);
        ctx.quadraticCurveTo(cx + i * P * 0.095, cy, cx + i * P * 0.070, cy + P * 0.30);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85; ctx.fillStyle = '#43681c';
      for (i = 0; i < 10; i++) {
        trace(ctx, ellPts(cx - P * 0.10 + hash(i * 13) * P * 0.20,
                          cy - P * 0.30 + hash(i * 7) * P * 0.60,
                          P * 0.016, P * 0.013, 8, P * 0.003, s + i));
        ctx.fill();
      }
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffffff';
      trace(ctx, ellPts(cx - P * 0.06, cy - P * 0.08, P * 0.028, P * 0.15, 12, P * 0.004, s + 30));
      ctx.fill();
      ctx.restore();
      ctx.restore();
    },
    bacon: function (ctx, cx, cy, P, lw) {
      var s = 415, i;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5); ctx.translate(-cx, -cy);
      var pts = [], n = 14;
      for (i = 0; i <= n; i++) { var f = i / n; pts.push([cx - P * 0.34 + f * P * 0.68, cy - P * 0.14 + Math.sin(f * 6) * P * 0.05]); }
      for (i = n; i >= 0; i--) { var g = i / n; pts.push([cx - P * 0.34 + g * P * 0.68, cy + P * 0.14 + Math.sin(g * 6 + 2) * P * 0.05]); }
      jitter(pts, P * 0.008, s);
      ink(ctx, pts, '#c9503a', { lw: lw, off: P * 0.007, line: '#7d2818', seed: s });
      ctx.save(); trace(ctx, pts); ctx.clip();
      ctx.strokeStyle = '#ffcfc2'; ctx.lineWidth = P * 0.045; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
      [-0.05, 0.06].forEach(function (fy, k) {
        ctx.beginPath();
        for (var x2 = 0; x2 <= 1; x2 += 0.08) ctx.lineTo(cx - P * 0.34 + x2 * P * 0.68, cy + P * fy + Math.sin(x2 * 6 + k) * P * 0.05);
        ctx.stroke();
      });
      ctx.restore(); ctx.restore();
    },
    jalapeno: function (ctx, cx, cy, P, lw) {
      var s = 417;
      // Fat at the shoulders, tapering to a blunt curved tip, glossy, with a
      // proper crooked stem and cap - a thin cone read as a green bean.
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(0.18); ctx.translate(-cx, -cy);
      var p = tapered(cx, cy + P * 0.06, P * 0.54, P * 0.155, P * 0.11, 0.70, false, P * 0.006, s);
      ink(ctx, p, '#3a8f2c', { lw: lw, off: P * 0.006, line: '#17470f', seed: s });
      ctx.save();
      trace(ctx, p); ctx.clip();
      ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffffff';
      trace(ctx, ellPts(cx - P * 0.055, cy - P * 0.02, P * 0.030, P * 0.17, 12, P * 0.004, s + 3)); ctx.fill();
      ctx.globalAlpha = 0.30; ctx.fillStyle = '#17470f';
      trace(ctx, ellPts(cx + P * 0.075, cy + P * 0.06, P * 0.035, P * 0.20, 12, P * 0.004, s + 4)); ctx.fill();
      ctx.restore();
      // shoulder cap, then the crooked stem
      ink(ctx, ellPts(cx, cy - P * 0.22, P * 0.10, P * 0.055, 14, P * 0.005, s + 6),
          '#4f8f34', { lw: lw * 0.85, line: '#2f5c1c', seed: s + 6 });
      ink(ctx, jitter([[cx - P * 0.030, cy - P * 0.24], [cx + P * 0.030, cy - P * 0.24],
                       [cx + P * 0.105, cy - P * 0.40], [cx + P * 0.045, cy - P * 0.42]], P * 0.007, s + 7),
          '#5f9e3f', { lw: lw * 0.85, line: '#2f5c1c', seed: s + 7 });
      ctx.restore();
    },
    egg: function (ctx, cx, cy, P, lw) {
      var s = 419;
      var p = blobPts(cx, cy + P * 0.02, P * 0.24, P * 0.31, 3, 0.045, 1.6, 26, P * 0.007, s);
      ink(ctx, p, '#fdf3e0', { lw: lw, off: P * 0.006, line: '#b9a17c', seed: s });
      hatch(ctx, p, '#c9b18c', s, { n: 4, alpha: 0.30, gap: P * 0.055 });
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffffff';
      trace(ctx, ellPts(cx - P * 0.08, cy - P * 0.10, P * 0.06, P * 0.09, 12, P * 0.004, s + 3)); ctx.fill();
      ctx.restore();
    },
    avocado: function (ctx, cx, cy, P, lw) {
      var s = 421;
      // half an avocado, stone in - the shape everyone pictures
      var skin = blobPts(cx, cy + P * 0.03, P * 0.26, P * 0.34, 3, 0.09, 1.6, 30, P * 0.007, s);
      ink(ctx, skin, '#3f5d28', { lw: lw, off: P * 0.006, line: '#223714', seed: s });
      var flesh = blobPts(cx, cy + P * 0.03, P * 0.215, P * 0.295, 3, 0.09, 1.6, 28, P * 0.006, s + 2);
      ink(ctx, flesh, '#d9e8a2', { lw: lw * 0.8, off: P * 0.005, line: '#7fa04e', seed: s + 2 });
      ctx.save(); trace(ctx, flesh); ctx.clip();
      ctx.globalAlpha = 0.55; ctx.fillStyle = '#b3cf72';
      trace(ctx, blobPts(cx, cy + P * 0.09, P * 0.20, P * 0.27, 3, 0.09, 1.6, 24, P * 0.006, s + 4)); ctx.fill();
      ctx.restore();
      var pit = blobPts(cx, cy + P * 0.09, P * 0.115, P * 0.115, 4, 0.03, 0.7, 20, P * 0.005, s + 6);
      ink(ctx, pit, '#a4703f', { lw: lw * 0.9, off: P * 0.005, line: '#5f3d1c', seed: s + 6 });
      hatch(ctx, pit, '#6f4527', s + 6, { n: 3, alpha: 0.30, gap: P * 0.040 });
    }
  };

  /* Sauce portraits: five bottles with five different silhouettes. */
  var BOTTLE = {
    ketchup: { body: '#d62828', line: '#8f1c1c', cap: '#f4ead6', shape: 'squeeze' },
    mustard: { body: '#f0bc18', line: '#a87d09', cap: '#f4ead6', shape: 'nozzle' },
    mayo: { body: '#fbf3dd', line: '#c9b98d', cap: '#8fb3d6', shape: 'jar' },
    bbq: { body: '#7a3b18', line: '#3d1c08', cap: '#c9a86a', shape: 'tall' },
    special: { body: '#ff8fab', line: '#c65f7c', cap: '#f4ead6', shape: 'squeeze' }
  };
  Object.keys(BOTTLE).forEach(function (id) {
    PORTRAITS[id] = function (ctx, cx, cy, P, lw) {
      var B = BOTTLE[id], s = 431 + id.length * 7;
      var jar = B.shape === 'jar', tall = B.shape === 'tall';
      var bw = jar ? P * 0.40 : (tall ? P * 0.26 : P * 0.32);
      var bh = jar ? P * 0.44 : (tall ? P * 0.60 : P * 0.52);
      var by = cy + P * 0.36 - bh;
      if (B.shape === 'nozzle') {
        ink(ctx, jitter([[cx - P * 0.03, cy - P * 0.40], [cx + P * 0.03, cy - P * 0.40],
                         [cx + P * 0.07, cy - P * 0.20], [cx - P * 0.07, cy - P * 0.20]], P * 0.007, s + 1),
            B.cap, { lw: lw * 0.85, line: '#a89170', seed: s + 1 });
      } else {
        ink(ctx, rectPts(cx - bw * (jar ? 0.42 : 0.30), by - P * (jar ? 0.10 : 0.13),
                         bw * (jar ? 0.84 : 0.60), P * (jar ? 0.11 : 0.14), P * 0.02, P * 0.006, s + 1),
            B.cap, { lw: lw * 0.85, line: '#a89170', seed: s + 1 });
      }
      var b = rectPts(cx - bw / 2, by, bw, bh, jar ? P * 0.05 : P * 0.09, P * 0.008, s);
      ink(ctx, b, B.body, { lw: lw, off: P * 0.007, line: B.line, seed: s });
      hatch(ctx, b, B.line, s, { n: 5, alpha: 0.18, gap: P * 0.055 });
      ink(ctx, rectPts(cx - bw * 0.36, by + bh * 0.34, bw * 0.72, bh * 0.34, P * 0.02, P * 0.006, s + 3),
          '#f8f2e2', { lw: lw * 0.8, line: '#b9a888', seed: s + 3 });
      ink(ctx, ellPts(cx, by + bh * 0.51, bw * 0.16, bh * 0.11, 12, P * 0.004, s + 4),
          B.body, { lw: 0 });
    };
  });

  function drawPortrait(ctx, id, w, h) {
    var P = Math.min(w, h) * 0.94;
    var fn = PORTRAITS[id];
    if (!fn) { drawIcon(ctx, id, w, h); return; }
    fn(ctx, w / 2, h / 2, P, Math.max(1, P * 0.028));
  }

  /* --------------------------------------------------------------- API */
  function layerOf(id) { return LAYERS[id] || LAYERS.cheese; }

  function heightOf(id, bunWidth) {
    return layerOf(id).hFrac * bunWidth;
  }

  /** How wide the layer actually paints - lettuce spills past the bun. */
  function layerWidth(id, bunWidth) {
    return layerOf(id).wFrac * bunWidth;
  }

  /** Total height of a stack drawn at this bun width. */
  function stackHeight(items, bunWidth) {
    var t = 0;
    for (var i = 0; i < items.length; i++) {
      t += heightOf(items[i].id || items[i], bunWidth);
    }
    return t;
  }

  /** Draw one layer with its box centred on `cx`, top edge at `y`. */
  function drawLayer(ctx, id, cx, y, bunWidth, opts) {
    var L = layerOf(id);
    var w = L.wFrac * bunWidth;
    var h = L.hFrac * bunWidth;
    ctx.save();
    if (opts && opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    L.draw(ctx, cx - w / 2, y, w, h, opts);
    ctx.restore();
    return h;
  }

  /**
   * Draw a stack bottom-up, with the base of the bottom bun at `baseY`.
   * `items` are ids or {id, cook, burnt, pop} objects; `pop` (0..1) lifts a
   * freshly-added layer into place.
   */
  function drawStack(ctx, items, cx, baseY, bunWidth, opts) {
    opts = opts || {};
    var y = baseY;
    for (var i = 0; i < items.length; i++) {
      var it = typeof items[i] === 'string' ? { id: items[i] } : items[i];
      var h = heightOf(it.id, bunWidth);
      y -= h;
      var lift = it.pop !== undefined && it.pop < 1 ? (1 - it.pop) * bunWidth * 0.55 : 0;
      drawLayer(ctx, it.id, cx, y - lift, bunWidth, {
        done: it.done,
        char: it.char,
        alpha: opts.alpha !== undefined ? opts.alpha : (it.pop !== undefined ? Math.min(1, it.pop * 1.6) : 1)
      });
    }
    return baseY - y;
  }

  /** Fit a whole stack inside `maxH` by shrinking the bun width. */
  function fitWidth(items, preferredWidth, maxH) {
    var h = stackHeight(items, preferredWidth);
    if (h <= maxH || h === 0) return preferredWidth;
    return preferredWidth * (maxH / h);
  }

  /* ----------------------------------------------------------- the chef */
  /**
   * Draws the cook standing on (x, y) - that point is the feet, so callers can
   * treat the chef as a dot on the kitchen floor. `s` is the full height.
   *
   * Deliberately chibi: the head is nearly half the body and the toque is
   * bigger than the head. Now drawn with the same wobbling pen as the food, so
   * the cook and the burger look like they came out of one sketchbook.
   *
   * opts: { face, bob, blink, hop, carry }
   */
  function drawChef(ctx, x, y, s, opts) {
    opts = opts || {};
    var face = opts.face >= 0 ? 1 : -1;
    var swing = Math.sin((opts.bob || 0) * TAU);
    var hop = opts.hop || 0;
    var blink = opts.blink || 0;
    var lw = Math.max(1, s * 0.018);
    var sd = 311;

    var sx = 1 + hop * 0.12, sy = 1 - hop * 0.14;
    var cy = y - Math.abs(swing) * s * 0.045 - hop * s * 0.10;

    // scribbled contact shadow
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (var g = 0; g < 3; g++) {
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = s * 0.030;
      var ww = s * 0.26 * (1 - g * 0.18) * (1 + hop * 0.15);
      ctx.beginPath();
      ctx.moveTo(x - ww, y + g * s * 0.018);
      ctx.quadraticCurveTo(x, y + g * s * 0.018 + s * 0.01, x + ww, y + g * s * 0.018);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(sx, sy);
    ctx.translate(-x, -cy);

    // legs
    ink(ctx, rectPts(x - s * 0.15 + swing * s * 0.085, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.05, s * 0.006, sd),
        '#7a5a8a', { lw: lw * 0.9, off: s * 0.006, seed: sd });
    ink(ctx, rectPts(x + s * 0.03 - swing * s * 0.085, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.05, s * 0.006, sd + 2),
        '#7a5a8a', { lw: lw * 0.9, off: s * 0.006, seed: sd + 2 });

    // chef whites
    var bw = s * 0.44, bh = s * 0.32;
    var body = rectPts(x - bw / 2, cy - s * 0.46, bw, bh, s * 0.14, s * 0.008, sd + 4);
    ink(ctx, body, '#fffaf0', { lw: lw, off: s * 0.007, seed: sd + 4 });
    hatch(ctx, body, '#c3ac91', sd + 4, { n: 4, alpha: 0.28, gap: s * 0.035 });

    // neckerchief
    ink(ctx, rectPts(x - s * 0.13, cy - s * 0.475, s * 0.26, s * 0.075, s * 0.032, s * 0.005, sd + 6),
        '#ef7d6b', { lw: lw * 0.85, off: s * 0.005, seed: sd + 6 });

    // buttons
    ink(ctx, ellPts(x, cy - s * 0.33, s * 0.020, s * 0.020, 8, s * 0.003, sd + 8), null, { lw: lw * 0.7, line: '#a98d70', lineAlpha: 0.7 });
    ink(ctx, ellPts(x, cy - s * 0.24, s * 0.020, s * 0.020, 8, s * 0.003, sd + 9), null, { lw: lw * 0.7, line: '#a98d70', lineAlpha: 0.7 });

    var handSpread = bw / 2 + s * 0.01, handY = cy - s * 0.30;

    // head
    var hy = cy - s * 0.62, hr = s * 0.215;
    var head = blobPts(x, hy, hr, hr, 5, 0.02, 0.9, 20, s * 0.006, sd + 11);
    ink(ctx, head, '#f7cfa4', { lw: lw, off: s * 0.006, seed: sd + 11 });
    hatch(ctx, head, '#c99a6d', sd + 11, { n: 3, alpha: 0.22, gap: s * 0.030 });

    // rosy cheeks
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#f4948a';
    trace(ctx, ellPts(x - hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 9, s * 0.003, sd + 13)); ctx.fill();
    trace(ctx, ellPts(x + hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 9, s * 0.003, sd + 14)); ctx.fill();
    ctx.restore();

    // eyes
    var ex = face * hr * 0.10, eo = hr * 0.34, ey = hy - hr * 0.02;
    var open = 1 - blink;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = 'round';
    if (open > 0.12) {
      trace(ctx, ellPts(x + ex - eo, ey, hr * 0.10, hr * 0.13 * open, 8, s * 0.002, sd + 15)); ctx.fill();
      trace(ctx, ellPts(x + ex + eo, ey, hr * 0.10, hr * 0.13 * open, 8, s * 0.002, sd + 16)); ctx.fill();
    } else {
      ctx.lineWidth = Math.max(1, hr * 0.09);
      ctx.beginPath();
      ctx.moveTo(x + ex - eo - hr * 0.09, ey); ctx.lineTo(x + ex - eo + hr * 0.09, ey);
      ctx.moveTo(x + ex + eo - hr * 0.09, ey); ctx.lineTo(x + ex + eo + hr * 0.09, ey);
      ctx.stroke();
    }
    // smile, drawn with a slightly overshooting stroke
    ctx.lineWidth = Math.max(1, hr * 0.085);
    ctx.beginPath();
    ctx.arc(x + ex, hy + hr * 0.20, hr * 0.24, 0.22 * Math.PI, 0.80 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // toque
    ink(ctx, rectPts(x - hr * 0.98, hy - hr * 1.08, hr * 1.96, hr * 0.44, hr * 0.16, s * 0.006, sd + 18),
        '#fffdf7', { lw: lw, off: s * 0.005, seed: sd + 18 });
    var puff = blobPts(x, hy - hr * 1.42, hr * 1.10, hr * 0.62, 3, 0.16, 0.6, 22, s * 0.008, sd + 20);
    ink(ctx, puff, '#ffffff', { lw: lw, off: s * 0.006, seed: sd + 20 });
    hatch(ctx, puff, '#c9b9a4', sd + 20, { n: 3, alpha: 0.25, gap: s * 0.030 });

    if (opts.carry) {
      var carryY = cy - s * 0.05;
      var half = opts.carry(ctx, x, carryY, s * 0.76, s * 0.46);
      handSpread = Math.max(s * 0.18, (half || s * 0.30) * 0.94);
      handY = carryY - s * 0.04;
    }

    ink(ctx, ellPts(x - handSpread, handY, s * 0.062, s * 0.062, 12, s * 0.004, sd + 22), '#f7cfa4', { lw: lw * 0.9, seed: sd + 22 });
    ink(ctx, ellPts(x + handSpread, handY, s * 0.062, s * 0.062, 12, s * 0.004, sd + 23), '#f7cfa4', { lw: lw * 0.9, seed: sd + 23 });

    ctx.restore();
  }

  /**
   * Single-layer icon centred in a w x h box at the current origin.
   * Deliberately does NOT clear: it is composited into scenes as well as onto
   * dedicated canvases, and clearing punched holes in the kitchen behind it.
   */
  function drawIcon(ctx, id, w, h, opts) {
    var L = layerOf(id);
    var bun = Math.min(w / Math.max(L.wFrac, 1), h / Math.max(L.hFrac, 0.16) * 0.9);
    var lh = L.hFrac * bun;
    drawLayer(ctx, id, w / 2, (h - lh) / 2, bun, opts);
  }

  /* ------------------------------------------------------------- the room
   * Everything that is not food: floor, wall, counter, crate boxes, grill,
   * plates, serving hatch, bin. Same pen, same off-register fills, so the
   * kitchen looks drawn by the hand that drew the burger instead of being a
   * set of rounded rectangles the ingredients happen to sit on.
   *
   * Every function takes a THEME object (see SCENE_THEMES) so the six kitchens
   * in game.js keep their identities.
   */
  var SCENE_THEMES = {
    diner:   { floorA: '#e8d5b8', floorB: '#c9a87d', grout: '#a8845a', wall: '#f2e2c6', wallLine: '#c9ab82',
               top: '#e4c496', top2: '#d2ad7c', side: '#a97d4e', trim: '#c0562f' },
    tiles:   { floorA: '#e4ece4', floorB: '#b9cbbd', grout: '#8ba394', wall: '#eef3ec', wallLine: '#b6c8bb',
               top: '#cfd9d0', top2: '#b6c3b8', side: '#7d8d81', trim: '#4f8f7a' },
    sunset:  { floorA: '#f7dfd2', floorB: '#e0b0a0', grout: '#b8877a', wall: '#fbe8dd', wallLine: '#d3a695',
               top: '#e8bfb4', top2: '#d6a396', side: '#a3705f', trim: '#d2603f' },
    night:   { floorA: '#ddd4ec', floorB: '#b3a6cf', grout: '#8b7cae', wall: '#e6dff2', wallLine: '#ab9cc9',
               top: '#cfc7e4', top2: '#b6aad2', side: '#7d709b', trim: '#6a4fa3' },
    brass:   { floorA: '#efe0b6', floorB: '#cbb883', grout: '#a08f5c', wall: '#f5ead0', wallLine: '#c4b184',
               top: '#ddcb92', top2: '#c6b276', side: '#8f7c46', trim: '#b08420' },
    harbour: { floorA: '#e2ecf2', floorB: '#b5c8d6', grout: '#8ba0b0', wall: '#eaf1f6', wallLine: '#adc0cd',
               top: '#c6d5e0', top2: '#adbfcd', side: '#728799', trim: '#3f6f92' }
  };

  /** Checkerboard floor, drawn in rows so the grout lines wobble like grout. */
  function drawFloor(ctx, x, y, w, h, T, tile) {
    T = T || SCENE_THEMES.diner;
    tile = tile || Math.max(14, w / 8);
    var s = 601, cols = Math.ceil(w / tile) + 1, rows = Math.ceil(h / tile) + 1, r, c;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = T.floorA;
    ctx.fillRect(x, y, w, h);
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        if ((r + c) % 2) continue;
        var tx = x + c * tile, ty = y + r * tile;
        trace(ctx, rectPts(tx, ty, tile, tile, tile * 0.06, tile * 0.035, s + r * 31 + c));
        ctx.fillStyle = T.floorB;
        ctx.fill();
      }
    }
    // grout, drawn over the top as a single wobbling pen
    ctx.strokeStyle = T.grout;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.7, tile * 0.035);
    ctx.lineCap = 'round';
    for (r = 0; r <= rows; r++) {
      ctx.beginPath();
      for (c = 0; c <= cols * 2; c++) {
        var gx = x + c * tile / 2;
        ctx.lineTo(gx, y + r * tile + wob(s + r, c) * tile * 0.05);
      }
      ctx.stroke();
    }
    for (c = 0; c <= cols; c++) {
      ctx.beginPath();
      for (r = 0; r <= rows * 2; r++) {
        var gy = y + r * tile / 2;
        ctx.lineTo(x + c * tile + wob(s + c + 90, r) * tile * 0.05, gy);
      }
      ctx.stroke();
    }
    // light falls off toward the back of the room
    ctx.globalAlpha = 1;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(60,34,18,0.26)');
    g.addColorStop(0.45, 'rgba(60,34,18,0.04)');
    g.addColorStop(1, 'rgba(60,34,18,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /** Back wall: subway tiles, a rail and a hanging bulb. */
  function drawWall(ctx, x, y, w, h, T) {
    T = T || SCENE_THEMES.diner;
    var s = 631, rowH = Math.max(8, h / 5), r, c;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = T.wall;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = T.wallLine;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(0.7, rowH * 0.05);
    ctx.lineCap = 'round';
    for (r = 0; r * rowH < h + rowH; r++) {
      var ty = y + r * rowH;
      ctx.beginPath();
      for (c = 0; c <= 10; c++) ctx.lineTo(x + c * w / 10, ty + wob(s + r, c) * rowH * 0.05);
      ctx.stroke();
      var off = (r % 2) * rowH * 0.9;
      for (c = 0; c * rowH * 1.8 < w + rowH * 2; c++) {
        var vx = x + off + c * rowH * 1.8;
        ctx.beginPath();
        ctx.moveTo(vx + wob(s + c, r) * rowH * 0.05, ty);
        ctx.lineTo(vx + wob(s + c, r + 5) * rowH * 0.05, ty + rowH);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** A worktop slab seen slightly from above: top face + front face. */
  function drawCounter(ctx, x, y, w, h, depth, T) {
    T = T || SCENE_THEMES.diner;
    var s = 641, lw = Math.max(1, Math.min(w * 0.004, 2.2));
    var front = rectPts(x, y + h - depth, w, depth, Math.min(6, depth * 0.4), w * 0.002, s + 1);
    ink(ctx, front, T.side, { lw: lw, off: w * 0.0015, seed: s + 1 });
    hatch(ctx, front, mixHex(T.side, '#2a1a10', 0.5), s + 1, { n: 6, alpha: 0.16, gap: depth * 0.5 });
    var top = rectPts(x, y, w, h - depth * 0.4, Math.min(8, h * 0.2), w * 0.002, s);
    ink(ctx, top, T.top, { lw: lw, off: w * 0.0015, seed: s });
    ctx.save();
    trace(ctx, top); ctx.clip();
    ctx.strokeStyle = T.top2;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.7, h * 0.03);
    ctx.lineCap = 'round';
    for (var i = 0; i < 5; i++) {
      var gy = y + h * (0.14 + i * 0.17);
      ctx.beginPath();
      for (var c = 0; c <= 14; c++) ctx.lineTo(x + c * w / 14, gy + Math.sin(c * 0.9 + i) * h * 0.02);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A wooden crate: slatted front, dark inside, name板 in the middle. */
  function drawCrate(ctx, x, y, w, h, T) {
    var s = 653, lw = Math.max(1, w * 0.02), i;
    // shadowed interior
    ink(ctx, rectPts(x + w * 0.05, y, w * 0.90, h * 0.52, w * 0.04, w * 0.006, s + 1),
        '#5b3d24', { lw: lw * 0.8, seed: s + 1 });
    // front panel with three slats
    var f = rectPts(x, y + h * 0.34, w, h * 0.66, w * 0.05, w * 0.006, s);
    ink(ctx, f, '#c89a63', { lw: lw, off: w * 0.006, line: '#6f4526', seed: s });
    ctx.save();
    trace(ctx, f); ctx.clip();
    ctx.strokeStyle = '#8f6437';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(0.8, w * 0.016);
    for (i = 1; i < 3; i++) {
      var ly = y + h * 0.34 + h * 0.66 * i / 3;
      ctx.beginPath();
      for (var c = 0; c <= 8; c++) ctx.lineTo(x + c * w / 8, ly + wob(s + i, c) * h * 0.012);
      ctx.stroke();
    }
    ctx.restore();
    hatch(ctx, f, '#6f4526', s, { n: 5, alpha: 0.14, gap: h * 0.14 });
    // corner bands
    [x + w * 0.02, x + w * 0.88].forEach(function (bx, k) {
      ink(ctx, rectPts(bx, y + h * 0.34, w * 0.10, h * 0.66, w * 0.03, w * 0.005, s + 10 + k),
          '#a87c48', { lw: lw * 0.9, line: '#6f4526', seed: s + 10 + k });
    });
  }

  /** Cast-iron grill: body, bars, two knobs, optional heat shimmer. */
  function drawGrill(ctx, x, y, w, h, opts) {
    var s = 661, lw = Math.max(1, w * 0.012), i;
    var hot = (opts && opts.hot) || 0;
    var body = rectPts(x, y + h * 0.18, w, h * 0.82, h * 0.14, w * 0.005, s);
    ink(ctx, body, '#5a5350', { lw: lw, off: w * 0.004, line: '#2b2523', seed: s });
    hatch(ctx, body, '#2b2523', s, { n: 6, alpha: 0.22, gap: h * 0.14 });
    // cooking surface
    var top = rectPts(x + w * 0.04, y + h * 0.10, w * 0.92, h * 0.44, h * 0.10, w * 0.005, s + 1);
    ink(ctx, top, '#3a3330', { lw: lw, off: w * 0.004, line: '#1c1715', seed: s + 1 });
    ctx.save();
    trace(ctx, top); ctx.clip();
    for (i = 0; i < 5; i++) {
      var by = y + h * 0.14 + i * h * 0.09;
      ctx.strokeStyle = mixHex('#6b615c', '#ff7a3c', hot * 0.85);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1, h * 0.035);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (var c = 0; c <= 10; c++) ctx.lineTo(x + w * 0.08 + c * w * 0.084, by + wob(s + i, c) * h * 0.012);
      ctx.stroke();
    }
    ctx.restore();
    // knobs
    [0.26, 0.74].forEach(function (f, k) {
      ink(ctx, ellPts(x + w * f, y + h * 0.80, w * 0.055, w * 0.055, 14, w * 0.004, s + 20 + k),
          '#d9cfc6', { lw: lw * 0.9, line: '#2b2523', seed: s + 20 + k });
      ctx.save();
      ctx.strokeStyle = '#2b2523';
      ctx.lineWidth = Math.max(0.9, w * 0.012);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + w * f, y + h * 0.80);
      ctx.lineTo(x + w * f - w * 0.03, y + h * 0.755);
      ctx.stroke();
      ctx.restore();
    });
    if (hot > 0.05) {
      ctx.save();
      ctx.globalAlpha = 0.30 * hot;
      ctx.strokeStyle = '#ff9d5c';
      ctx.lineWidth = Math.max(0.9, h * 0.02);
      ctx.lineCap = 'round';
      for (i = 0; i < 3; i++) {
        ctx.beginPath();
        for (var t = 0; t <= 6; t++) {
          ctx.lineTo(x + w * (0.24 + i * 0.26) + Math.sin(t * 1.3 + i) * w * 0.02,
                     y + h * 0.08 - t * h * 0.045);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** A plate seen from above, with the rim ring drawn as its own pass. */
  function drawPlate(ctx, cx, cy, w, opts) {
    var s = 673, r = w / 2, lw = Math.max(1, w * 0.018);
    var glow = (opts && opts.glow) || 0;
    if (glow > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.35 * glow;
      ctx.fillStyle = '#f4b41a';
      trace(ctx, ellPts(cx, cy, r * 1.22, r * 0.52, 20, w * 0.006, s + 9));
      ctx.fill();
      ctx.restore();
    }
    ink(ctx, ellPts(cx, cy, r, r * 0.40, 24, w * 0.008, s), '#f4f8fb',
        { lw: lw, off: w * 0.006, line: '#8fa3ae', seed: s });
    ink(ctx, ellPts(cx, cy, r * 0.70, r * 0.27, 20, w * 0.006, s + 1), '#e6eef5',
        { lw: lw * 0.7, line: '#8fa3ae', lineAlpha: 0.7, seed: s + 1 });
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    trace(ctx, ellPts(cx - r * 0.34, cy - r * 0.12, r * 0.26, r * 0.07, 12, w * 0.004, s + 2));
    ctx.fill();
    ctx.restore();
  }

  /** The serving hatch: a window in the wall with a little awning and a bell. */
  function drawHatch(ctx, x, y, w, h, T, opts) {
    T = T || SCENE_THEMES.diner;
    var s = 683, lw = Math.max(1, w * 0.008), i;
    var lit = (opts && opts.lit) || 0;
    // the dark opening
    var hole = rectPts(x + w * 0.06, y + h * 0.26, w * 0.88, h * 0.56, h * 0.10, w * 0.003, s + 1);
    ink(ctx, hole, mixHex('#2a1a12', '#f4b41a', lit * 0.35), { lw: lw, line: '#1a100b', seed: s + 1 });
    // sill
    ink(ctx, rectPts(x, y + h * 0.74, w, h * 0.24, h * 0.07, w * 0.003, s + 2),
        T.top, { lw: lw, off: w * 0.002, line: mixHex(T.side, '#2a1a10', 0.4), seed: s + 2 });
    // scalloped awning
    var aw = [];
    aw.push([x, y + h * 0.24]);
    aw.push([x + w * 0.03, y]);
    aw.push([x + w * 0.97, y]);
    aw.push([x + w, y + h * 0.24]);
    for (i = 8; i >= 0; i--) {
      var f = i / 8;
      aw.push([x + f * w, y + h * (0.24 + 0.055 * Math.abs(Math.sin(f * 9)))]);
    }
    jitter(aw, w * 0.003, s);
    ink(ctx, aw, '#f2e2c6', { lw: lw, off: w * 0.002, line: '#a8845a', seed: s });
    ctx.save();
    trace(ctx, aw); ctx.clip();
    ctx.fillStyle = T.trim;
    for (i = 0; i < 5; i++) {
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x + w * (0.06 + i * 0.19), y - h * 0.05, w * 0.095, h * 0.36);
    }
    ctx.restore();
    // call bell on the sill
    ink(ctx, ellPts(x + w * 0.82, y + h * 0.78, w * 0.055, w * 0.040, 14, w * 0.003, s + 5),
        '#e8c56a', { lw: lw, line: '#8a6416', seed: s + 5 });
    ink(ctx, rectPts(x + w * 0.795, y + h * 0.80, w * 0.05, h * 0.045, h * 0.02, w * 0.002, s + 6),
        '#c9a33f', { lw: lw * 0.8, line: '#8a6416', seed: s + 6 });
  }

  /** Kerbside bin: pedal, ribbed drum, bag folded over the rim, hinged lid. */
  function drawBin(ctx, x, y, w, h, opts) {
    var s = 691, lw = Math.max(1, w * 0.030), i;
    var open = (opts && opts.open) || 0;
    var bodyTop = y + h * 0.34;
    var footY = y + h * 0.94;

    // pedal and foot, so it reads as a bin you step on rather than a vase
    ink(ctx, rectPts(x + w * 0.06, footY - h * 0.01, w * 0.26, h * 0.050, w * 0.02, w * 0.006, s + 8),
        '#6e828c', { lw: lw * 0.85, line: '#33454e', seed: s + 8 });

    // drum: a cylinder, so the sides are parallel and the foot is an ellipse
    var bodyW = w * 0.72, bx = x + (w - bodyW) / 2;
    var body = jitter([[bx, bodyTop], [bx + bodyW, bodyTop],
                       [bx + bodyW, footY], [bx, footY]], w * 0.008, s);
    ink(ctx, body, '#93a7b2', { lw: lw, off: w * 0.008, line: '#33454e', seed: s });
    // the base, seen as a shallow ellipse - what makes it read as round
    ink(ctx, ellPts(x + w * 0.5, footY, bodyW / 2, h * 0.055, 20, w * 0.007, s + 11),
        '#7f95a1', { lw: lw, off: w * 0.006, line: '#33454e', seed: s + 11 });
    ctx.save();
    trace(ctx, body); ctx.clip();
    // a soft shade down each side turns the flat drum into a cylinder
    var cyl = ctx.createLinearGradient(bx, 0, bx + bodyW, 0);
    cyl.addColorStop(0, 'rgba(30,48,58,0.34)');
    cyl.addColorStop(0.32, 'rgba(255,255,255,0.16)');
    cyl.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    cyl.addColorStop(1, 'rgba(30,48,58,0.40)');
    ctx.fillStyle = cyl;
    ctx.fillRect(bx, bodyTop, bodyW, footY - bodyTop);
    // vertical ribs
    ctx.strokeStyle = '#637c88';
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(0.9, w * 0.022);
    ctx.lineCap = 'round';
    for (i = 0; i < 5; i++) {
      var vx = bx + bodyW * (0.16 + i * 0.17);
      ctx.beginPath();
      ctx.moveTo(vx, bodyTop + h * 0.05);
      ctx.lineTo(vx, footY - h * 0.02);
      ctx.stroke();
    }
    // two hoop bands, bowed like the rim so they wrap the drum
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#5b737f';
    ctx.lineWidth = Math.max(1, w * 0.034);
    [0.30, 0.72].forEach(function (f) {
      var by = bodyTop + (footY - bodyTop) * f;
      ctx.beginPath();
      for (var c = 0; c <= 10; c++) {
        var t = c / 10;
        ctx.lineTo(bx + bodyW * t, by + Math.sin(t * Math.PI) * h * 0.022);
      }
      ctx.stroke();
    });
    ctx.restore();
    hatch(ctx, body, '#33454e', s, { n: 4, alpha: 0.10, gap: h * 0.22 });

    // rim, dark mouth, and the bag folded over the lip
    ink(ctx, ellPts(x + w * 0.5, bodyTop, bodyW / 2, h * 0.070, 20, w * 0.008, s + 2),
        '#aebfc9', { lw: lw, off: w * 0.006, line: '#33454e', seed: s + 2 });
    ink(ctx, ellPts(x + w * 0.5, bodyTop + h * 0.006, bodyW * 0.38, h * 0.048, 18, w * 0.006, s + 7),
        '#2b3a42', { lw: lw * 0.7, line: '#17222a', seed: s + 7 });
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (i = 0; i < 5; i++) {
      var a = Math.PI * (0.10 + i * 0.20);
      ink(ctx, blobPts(x + w * 0.5 + Math.cos(a) * bodyW * 0.40, bodyTop + Math.sin(a) * h * 0.048 + h * 0.012,
                       w * 0.075, h * 0.028, 4, 0.22, i, 14, w * 0.005, s + 20 + i),
          '#3d4a52', { lw: lw * 0.6, line: '#1c262b', lineAlpha: 0.8, seed: s + 20 + i });
    }
    ctx.restore();

    // lid, hinged at the back-left and lifted clear when open
    ctx.save();
    ctx.translate(bx + bodyW * 0.06, bodyTop - h * 0.06);
    ctx.rotate(-open * 0.66);
    ctx.translate(-(bx + bodyW * 0.06), -(bodyTop - h * 0.06));
    ctx.translate(0, -open * h * 0.055);
    ink(ctx, ellPts(x + w * 0.5, bodyTop - h * 0.075, bodyW * 0.60, h * 0.072, 20, w * 0.008, s + 3),
        '#c2d3dc', { lw: lw, off: w * 0.007, line: '#33454e', seed: s + 3 });
    ink(ctx, ellPts(x + w * 0.5, bodyTop - h * 0.105, bodyW * 0.40, h * 0.048, 18, w * 0.006, s + 9),
        '#aebfc9', { lw: lw * 0.8, line: '#33454e', lineAlpha: 0.7, seed: s + 9 });
    ctx.save();
    ctx.strokeStyle = '#5b737f';
    ctx.lineWidth = Math.max(1.2, w * 0.030);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x + w * 0.5, bodyTop - h * 0.135, bodyW * 0.16, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  var SCENE = {
    THEMES: SCENE_THEMES,
    floor: drawFloor,
    wall: drawWall,
    counter: drawCounter,
    crate: drawCrate,
    grill: drawGrill,
    plate: drawPlate,
    hatch: drawHatch,
    bin: drawBin
  };

  /* ------------------------------------------------------------- guests
   * The people on the other side of the hatch, drawn to the chef's own recipe:
   * one head, one soft body, dot eyes, rosy cheeks. Everything that makes a
   * guest a PERSON rather than a palette swap lives in three places - the
   * silhouette on top of the head, the shape of the torso, and one prop.
   *
   * Art.drawGuest(ctx, x, y, s, { type, blink, bob, mood })
   *   x, y  feet baseline    s  the same scale number you pass drawChef
   */
  var GUESTS = {
    kid:      { h: 0.74, skin: '#f7cfa4', hair: '#6b4423', top: '#f2b33c', bot: '#5f8fc4', style: 'mop',    prop: 'balloon' },
    student:  { h: 0.86, skin: '#f2c08a', hair: '#3a2a20', top: '#4f6fa8', bot: '#3a4a63', style: 'bob',    prop: 'satchel' },
    teen:     { h: 0.94, skin: '#f7cfa4', hair: '#2f2a28', top: '#7a5a8a', bot: '#43506b', style: 'capBack',prop: 'phone' },
    office:   { h: 1.00, skin: '#f2c08a', hair: '#3a2a20', top: '#4a5568', bot: '#2f3542', style: 'part',   prop: 'coffee' },
    nurse:    { h: 0.98, skin: '#eab98a', hair: '#4a3226', top: '#dff0ea', bot: '#8fbfae', style: 'bun',    prop: 'clipboard' },
    police:   { h: 1.02, skin: '#d9a06a', hair: '#2f2a28', top: '#3f5a8a', bot: '#2b3a56', style: 'peaked', prop: null },
    builder:  { h: 1.00, skin: '#e0a06a', hair: '#4a3226', top: '#e8a021', bot: '#6b5a4a', style: 'hardhat',prop: 'plank' },
    courier:  { h: 0.96, skin: '#c98a58', hair: '#2f2a28', top: '#c0562f', bot: '#3a3a3a', style: 'helmet', prop: 'box' },
    farmer:   { h: 0.98, skin: '#e0a06a', hair: '#7a6a4a', top: '#8fa8c4', bot: '#6b7a4a', style: 'straw',  prop: null },
    athlete:  { h: 1.00, skin: '#b87a4a', hair: '#2f2a28', top: '#e8e2d2', bot: '#c9302c', style: 'ponytail',prop: 'bottle' },
    artist:   { h: 0.96, skin: '#f2c08a', hair: '#8a4a2a', top: '#c9a8d6', bot: '#4a4a4a', style: 'beret',  prop: null },
    granny:   { h: 0.88, skin: '#f0d0b0', hair: '#d8d2cc', top: '#d68aa0', bot: '#7a6a8a', style: 'bunGrey',prop: 'bag' },
    grandpa:  { h: 0.90, skin: '#e8c4a0', hair: '#d8d2cc', top: '#8a9a7a', bot: '#5a5a4a', style: 'flatcap',prop: 'cane' },
    baby:     { h: 0.62, skin: '#fbd9b8', hair: '#c9a06a', top: '#f7c9d6', bot: '#f7c9d6', style: 'curl',   prop: null }
  };
  var GUEST_IDS = ['baby', 'kid', 'student', 'teen', 'athlete', 'courier', 'builder',
                   'police', 'nurse', 'office', 'artist', 'farmer', 'granny', 'grandpa'];

  function drawGuest(ctx, x, y, s, opts) {
    opts = opts || {};
    var G = GUESTS[opts.type] || GUESTS.office;
    var blink = opts.blink || 0;
    var swing = Math.sin((opts.bob || 0) * TAU);
    var mood = opts.mood === undefined ? 1 : opts.mood;   // 1 happy .. 0 cross
    s = s * G.h;
    var lw = Math.max(1, s * 0.018);
    var sd = 811 + GUEST_IDS.indexOf(opts.type) * 7;
    var cy = y - Math.abs(swing) * s * 0.04;

    // scribbled contact shadow, same three strokes as the chef
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (var q = 0; q < 3; q++) {
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = s * 0.030;
      var ww = s * 0.24 * (1 - q * 0.18);
      ctx.beginPath();
      ctx.moveTo(x - ww, y + q * s * 0.018);
      ctx.quadraticCurveTo(x, y + q * s * 0.018 + s * 0.01, x + ww, y + q * s * 0.018);
      ctx.stroke();
    }
    ctx.restore();

    // legs
    ink(ctx, rectPts(x - s * 0.15 + swing * s * 0.07, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.05, s * 0.006, sd),
        G.bot, { lw: lw * 0.9, off: s * 0.006, seed: sd });
    ink(ctx, rectPts(x + s * 0.03 - swing * s * 0.07, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.05, s * 0.006, sd + 2),
        G.bot, { lw: lw * 0.9, off: s * 0.006, seed: sd + 2 });

    // torso
    var bw = s * 0.44, bh = s * 0.32;
    var body = rectPts(x - bw / 2, cy - s * 0.46, bw, bh, s * 0.14, s * 0.008, sd + 4);
    ink(ctx, body, G.top, { lw: lw, off: s * 0.007, seed: sd + 4 });
    hatch(ctx, body, mixHex(G.top, '#2a1a12', 0.45), sd + 4, { n: 4, alpha: 0.20, gap: s * 0.035 });

    // one detail that says the job, drawn on the chest
    if (opts.type === 'police') {
      ink(ctx, blobPts(x - bw * 0.26, cy - s * 0.38, s * 0.045, s * 0.045, 5, 0.30, 1.6, 18, s * 0.004, sd + 5),
          '#f4d35e', { lw: lw * 0.7, line: '#8a6416', seed: sd + 5 });
    } else if (opts.type === 'nurse') {
      ctx.save();
      ctx.fillStyle = '#c9302c';
      ctx.fillRect(x - s * 0.018, cy - s * 0.41, s * 0.036, s * 0.10);
      ctx.fillRect(x - s * 0.050, cy - s * 0.378, s * 0.10, s * 0.036);
      ctx.restore();
    } else if (opts.type === 'athlete') {
      ctx.save();
      ctx.strokeStyle = '#c9302c';
      ctx.lineWidth = Math.max(1, s * 0.022);
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.30, cy - s * 0.44);
      ctx.lineTo(x + bw * 0.10, cy - s * 0.20);
      ctx.stroke();
      ctx.restore();
    } else if (opts.type === 'office') {
      ink(ctx, jitter([[x - s * 0.030, cy - s * 0.455], [x + s * 0.030, cy - s * 0.455],
                       [x + s * 0.012, cy - s * 0.30], [x - s * 0.012, cy - s * 0.30]], s * 0.005, sd + 6),
          '#c9302c', { lw: lw * 0.7, line: '#7a1a16', seed: sd + 6 });
    } else if (opts.type === 'farmer') {
      ctx.save();
      ctx.strokeStyle = mixHex(G.top, '#2a1a12', 0.5);
      ctx.lineWidth = Math.max(1, s * 0.014);
      [-1, 1].forEach(function (d) {
        ctx.beginPath();
        ctx.moveTo(x + d * bw * 0.20, cy - s * 0.46);
        ctx.lineTo(x + d * bw * 0.20, cy - s * 0.22);
        ctx.stroke();
      });
      ctx.restore();
    }

    // head
    var hy = cy - s * 0.62, hr = s * 0.215;
    var head = blobPts(x, hy, hr, hr, 5, 0.02, 0.9, 20, s * 0.006, sd + 11);
    ink(ctx, head, G.skin, { lw: lw, off: s * 0.006, seed: sd + 11 });
    hatch(ctx, head, mixHex(G.skin, '#8a5a30', 0.55), sd + 11, { n: 3, alpha: 0.18, gap: s * 0.030 });

    drawHair(ctx, x, hy, hr, s, lw, G, sd);

    // cheeks
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#f4948a';
    trace(ctx, ellPts(x - hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 9, s * 0.003, sd + 13)); ctx.fill();
    trace(ctx, ellPts(x + hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 9, s * 0.003, sd + 14)); ctx.fill();
    ctx.restore();

    // eyes and mouth
    var eo = hr * 0.34, ey = hy - hr * 0.02, open = 1 - blink;
    ctx.save();
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    if (open > 0.12) {
      trace(ctx, ellPts(x - eo, ey, hr * 0.10, hr * 0.13 * open, 8, s * 0.002, sd + 15)); ctx.fill();
      trace(ctx, ellPts(x + eo, ey, hr * 0.10, hr * 0.13 * open, 8, s * 0.002, sd + 16)); ctx.fill();
    } else {
      ctx.lineWidth = lw * 0.9;
      [-1, 1].forEach(function (d) {
        ctx.beginPath();
        ctx.moveTo(x + d * eo - hr * 0.10, ey);
        ctx.lineTo(x + d * eo + hr * 0.10, ey);
        ctx.stroke();
      });
    }
    ctx.lineWidth = lw * 0.95;
    ctx.beginPath();
    ctx.moveTo(x - hr * 0.17, hy + hr * 0.38);
    ctx.quadraticCurveTo(x, hy + hr * (0.38 + 0.34 * (mood * 2 - 1)), x + hr * 0.17, hy + hr * 0.38);
    ctx.stroke();
    if (opts.type === 'grandpa' || opts.type === 'farmer') {
      // glasses / squint lines, drawn after the eyes so they read as worn
      ctx.lineWidth = lw * 0.7;
      ctx.globalAlpha = 0.7;
      [-1, 1].forEach(function (d) {
        ctx.beginPath();
        ctx.arc(x + d * eo, ey, hr * 0.20, 0, TAU);
        ctx.stroke();
      });
    }
    ctx.restore();

    drawGuestProp(ctx, x, cy, s, lw, G, sd);
  }

  function drawHair(ctx, x, hy, hr, s, lw, G, sd) {
    var st = G.style, c = G.hair;
    function cap(fill, wide, tall, lobes) {
      ink(ctx, blobPts(x, hy - hr * 0.34, hr * (wide || 1.06), hr * (tall || 0.72), lobes || 4, 0.10, 0.8, 24, s * 0.006, sd + 20),
          fill, { lw: lw, off: s * 0.005, seed: sd + 20 });
    }
    if (st === 'mop') {
      cap(c, 1.10, 0.80, 6);
      ink(ctx, blobPts(x - hr * 0.72, hy - hr * 0.05, hr * 0.30, hr * 0.42, 4, 0.20, 1.2, 18, s * 0.005, sd + 21), c, { lw: lw * 0.8, seed: sd + 21 });
      ink(ctx, blobPts(x + hr * 0.72, hy - hr * 0.05, hr * 0.30, hr * 0.42, 4, 0.20, 0.4, 18, s * 0.005, sd + 22), c, { lw: lw * 0.8, seed: sd + 22 });
    } else if (st === 'curl') {
      cap(c, 0.72, 0.52, 5);
      ink(ctx, ellPts(x + hr * 0.30, hy - hr * 0.92, hr * 0.16, hr * 0.20, 12, s * 0.004, sd + 23), c, { lw: lw * 0.8, seed: sd + 23 });
    } else if (st === 'bob') {
      cap(c, 1.12, 0.74, 4);
      [-1, 1].forEach(function (d, i) {
        ink(ctx, rectPts(x + d * hr * 0.92 - hr * 0.16, hy - hr * 0.55, hr * 0.32, hr * 1.10, hr * 0.14, s * 0.005, sd + 24 + i), c, { lw: lw * 0.85, seed: sd + 24 + i });
      });
    } else if (st === 'part') {
      cap(c, 1.08, 0.62, 3);
      ctx.save();
      ctx.strokeStyle = mixHex(c, '#ffffff', 0.25);
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(x - hr * 0.30, hy - hr * 0.86);
      ctx.lineTo(x - hr * 0.05, hy - hr * 0.40);
      ctx.stroke();
      ctx.restore();
    } else if (st === 'bun' || st === 'bunGrey') {
      cap(c, 1.06, 0.66, 3);
      ink(ctx, blobPts(x, hy - hr * 1.06, hr * 0.36, hr * 0.32, 4, 0.14, 0.5, 18, s * 0.005, sd + 26), c, { lw: lw * 0.85, seed: sd + 26 });
    } else if (st === 'ponytail') {
      cap(c, 1.06, 0.66, 3);
      ink(ctx, blobPts(x + hr * 1.02, hy - hr * 0.28, hr * 0.26, hr * 0.58, 4, 0.18, 1.1, 20, s * 0.005, sd + 27), c, { lw: lw * 0.85, seed: sd + 27 });
    } else if (st === 'capBack') {
      cap(c, 1.06, 0.58, 3);
      ink(ctx, blobPts(x, hy - hr * 0.62, hr * 1.02, hr * 0.52, 3, 0.06, 0.6, 22, s * 0.005, sd + 28), '#3f7a2a', { lw: lw, seed: sd + 28 });
      ink(ctx, rectPts(x + hr * 0.72, hy - hr * 0.72, hr * 0.60, hr * 0.26, hr * 0.10, s * 0.005, sd + 29), '#3f7a2a', { lw: lw * 0.9, seed: sd + 29 });
    } else if (st === 'peaked') {
      ink(ctx, blobPts(x, hy - hr * 0.66, hr * 1.04, hr * 0.50, 3, 0.05, 0.6, 22, s * 0.005, sd + 30), '#2b3a56', { lw: lw, seed: sd + 30 });
      ink(ctx, rectPts(x - hr * 1.10, hy - hr * 0.46, hr * 2.20, hr * 0.22, hr * 0.10, s * 0.005, sd + 31), '#1e2a40', { lw: lw * 0.9, seed: sd + 31 });
      ink(ctx, ellPts(x, hy - hr * 0.86, hr * 0.16, hr * 0.14, 10, s * 0.004, sd + 32), '#f4d35e', { lw: lw * 0.7, line: '#8a6416', seed: sd + 32 });
    } else if (st === 'hardhat') {
      ink(ctx, blobPts(x, hy - hr * 0.60, hr * 1.06, hr * 0.66, 3, 0.04, 0.6, 24, s * 0.005, sd + 33), '#f4b41a', { lw: lw, line: '#8a6416', seed: sd + 33 });
      ink(ctx, rectPts(x - hr * 1.18, hy - hr * 0.44, hr * 2.36, hr * 0.20, hr * 0.09, s * 0.005, sd + 34), '#e8a021', { lw: lw * 0.9, line: '#8a6416', seed: sd + 34 });
      ctx.save();
      ctx.strokeStyle = '#c98a10';
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, hy - hr * 1.22);
      ctx.lineTo(x, hy - hr * 0.50);
      ctx.stroke();
      ctx.restore();
    } else if (st === 'helmet') {
      ink(ctx, blobPts(x, hy - hr * 0.44, hr * 1.14, hr * 0.94, 3, 0.04, 0.6, 26, s * 0.005, sd + 35), '#c0562f', { lw: lw, line: '#6f2a14', seed: sd + 35 });
      ink(ctx, rectPts(x - hr * 1.16, hy - hr * 0.30, hr * 2.32, hr * 0.20, hr * 0.09, s * 0.005, sd + 36), '#9e3f20', { lw: lw * 0.9, seed: sd + 36 });
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffffff';
      trace(ctx, ellPts(x - hr * 0.40, hy - hr * 0.72, hr * 0.24, hr * 0.14, 12, s * 0.003, sd + 37));
      ctx.fill();
      ctx.restore();
    } else if (st === 'straw') {
      cap(c, 1.02, 0.52, 3);
      ink(ctx, ellPts(x, hy - hr * 0.52, hr * 1.60, hr * 0.34, 22, s * 0.006, sd + 38), '#e0c06a', { lw: lw, line: '#a08430', seed: sd + 38 });
      ink(ctx, blobPts(x, hy - hr * 0.80, hr * 0.70, hr * 0.40, 3, 0.05, 0.6, 20, s * 0.005, sd + 39), '#eacf82', { lw: lw * 0.9, line: '#a08430', seed: sd + 39 });
    } else if (st === 'beret') {
      cap(c, 1.10, 0.70, 4);
      ink(ctx, blobPts(x - hr * 0.10, hy - hr * 0.78, hr * 0.92, hr * 0.36, 3, 0.10, 0.7, 22, s * 0.005, sd + 40), '#c9302c', { lw: lw, line: '#7a1a16', seed: sd + 40 });
      ink(ctx, ellPts(x + hr * 0.60, hy - hr * 1.00, hr * 0.09, hr * 0.09, 8, s * 0.003, sd + 41), '#c9302c', { lw: lw * 0.7, line: '#7a1a16', seed: sd + 41 });
    } else if (st === 'flatcap') {
      cap(c, 1.04, 0.50, 3);
      ink(ctx, blobPts(x - hr * 0.06, hy - hr * 0.70, hr * 1.02, hr * 0.40, 3, 0.08, 0.6, 22, s * 0.005, sd + 42), '#7a6a5a', { lw: lw, seed: sd + 42 });
      ink(ctx, rectPts(x - hr * 1.24, hy - hr * 0.52, hr * 0.90, hr * 0.18, hr * 0.08, s * 0.005, sd + 43), '#5f5245', { lw: lw * 0.9, seed: sd + 43 });
    }
  }

  function drawGuestProp(ctx, x, cy, s, lw, G, sd) {
    var p = G.prop, hx = x + s * 0.30, hy = cy - s * 0.30;
    if (!p) return;
    if (p === 'balloon') {
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(hx + s * 0.06, hy - s * 0.24, hx + s * 0.02, hy - s * 0.44);
      ctx.stroke();
      ctx.restore();
      ink(ctx, blobPts(hx + s * 0.02, hy - s * 0.56, s * 0.12, s * 0.14, 3, 0.05, 0.6, 20, s * 0.005, sd + 50),
          '#e63946', { lw: lw * 0.85, line: '#7a1a16', seed: sd + 50 });
    } else if (p === 'satchel') {
      ink(ctx, rectPts(x + s * 0.20, cy - s * 0.30, s * 0.20, s * 0.17, s * 0.04, s * 0.005, sd + 51),
          '#8a5a30', { lw: lw * 0.9, line: '#4a2f18', seed: sd + 51 });
    } else if (p === 'phone') {
      ink(ctx, rectPts(hx - s * 0.02, hy - s * 0.06, s * 0.10, s * 0.15, s * 0.02, s * 0.004, sd + 52),
          '#3a3a3a', { lw: lw * 0.8, line: '#1a1a1a', seed: sd + 52 });
    } else if (p === 'coffee') {
      ink(ctx, jitter([[hx, hy - s * 0.02], [hx + s * 0.11, hy - s * 0.02],
                       [hx + s * 0.09, hy + s * 0.13], [hx + s * 0.02, hy + s * 0.13]], s * 0.005, sd + 53),
          '#f6efdd', { lw: lw * 0.85, line: '#a89170', seed: sd + 53 });
      ink(ctx, rectPts(hx - s * 0.005, hy - s * 0.045, s * 0.12, s * 0.035, s * 0.014, s * 0.004, sd + 54),
          '#c0562f', { lw: lw * 0.8, seed: sd + 54 });
    } else if (p === 'clipboard') {
      ink(ctx, rectPts(hx - s * 0.01, hy - s * 0.02, s * 0.14, s * 0.18, s * 0.02, s * 0.004, sd + 55),
          '#fdf6e6', { lw: lw * 0.85, line: '#8a7259', seed: sd + 55 });
      ink(ctx, rectPts(hx + s * 0.03, hy - s * 0.045, s * 0.06, s * 0.035, s * 0.012, s * 0.003, sd + 56),
          '#8fa3ae', { lw: lw * 0.7, seed: sd + 56 });
    } else if (p === 'plank') {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(-0.5);
      ink(ctx, rectPts(-s * 0.05, -s * 0.24, s * 0.10, s * 0.48, s * 0.02, s * 0.005, sd + 57),
          '#c89a63', { lw: lw * 0.85, line: '#6f4526', seed: sd + 57 });
      ctx.restore();
    } else if (p === 'box') {
      ink(ctx, rectPts(x + s * 0.18, cy - s * 0.36, s * 0.24, s * 0.22, s * 0.02, s * 0.005, sd + 58),
          '#d9a86a', { lw: lw * 0.9, line: '#6f4526', seed: sd + 58 });
      ctx.save();
      ctx.strokeStyle = '#a8804a';
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.30, cy - s * 0.36);
      ctx.lineTo(x + s * 0.30, cy - s * 0.14);
      ctx.stroke();
      ctx.restore();
    } else if (p === 'bottle') {
      ink(ctx, rectPts(hx, hy - s * 0.04, s * 0.09, s * 0.20, s * 0.03, s * 0.004, sd + 59),
          '#8fd0e8', { lw: lw * 0.85, line: '#3f7a92', seed: sd + 59 });
    } else if (p === 'bag') {
      ink(ctx, jitter([[x + s * 0.20, cy - s * 0.28], [x + s * 0.42, cy - s * 0.28],
                       [x + s * 0.39, cy - s * 0.08], [x + s * 0.23, cy - s * 0.08]], s * 0.006, sd + 60),
          '#d68aa0', { lw: lw * 0.9, line: '#8a4a5a', seed: sd + 60 });
      ctx.save();
      ctx.strokeStyle = '#8a4a5a';
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.arc(x + s * 0.31, cy - s * 0.28, s * 0.07, Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    } else if (p === 'cane') {
      ctx.save();
      ctx.strokeStyle = '#8a5a30';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.2, s * 0.022);
      ctx.beginPath();
      ctx.moveTo(hx + s * 0.04, cy);
      ctx.lineTo(hx + s * 0.02, cy - s * 0.30);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx - s * 0.03, cy - s * 0.30, s * 0.05, 0, Math.PI, true);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Head-only portrait for an order ticket, at any tiny size. */
  function drawGuestFace(ctx, id, w, h, opts) {
    var s = Math.min(w / 0.62, h / 0.42);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    drawGuest(ctx, w / 2, h + s * 0.30, s, {
      type: id, mood: opts && opts.mood !== undefined ? opts.mood : 1
    });
    ctx.restore();
  }

  root.Art = {
    rr: rr,
    hash: hash,
    grad: grad,
    mixHex: mixHex,
    heightOf: heightOf,
    layerWidth: layerWidth,
    stackHeight: stackHeight,
    drawLayer: drawLayer,
    drawStack: drawStack,
    fitWidth: fitWidth,
    drawIcon: drawIcon,
    drawPortrait: drawPortrait,
    drawChef: drawChef,
    SAUCES: SAUCES,
    has: function (id) { return !!LAYERS[id]; },
    // hand-drawn toolkit, exported so game.js can draw counters, crates and the
    // grill with the same pen instead of clean rounded rectangles
    ink: ink,
    hatch: hatch,
    trace: trace,
    rectPts: rectPts,
    ellPts: ellPts,
    blobPts: blobPts,
    crescentPts: crescentPts,
    scene: SCENE,
    GUESTS: GUEST_IDS,
    drawGuest: drawGuest,
    drawGuestFace: drawGuestFace,
    INK: INK
  };
})(typeof self !== 'undefined' ? self : this);
