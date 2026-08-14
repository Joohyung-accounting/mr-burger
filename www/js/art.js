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
 * Customers are not part of this build - the guest drawings in the design
 * handoff are deliberately left out, and the chef carries CHEF_SKINS.
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
        // a bed under the rings: three rings on a band this wide leave gaps you
        // can see straight through, and the bun above them then reads as floating
        ink(ctx, bandPts(x + w * 0.04, y + h * 0.30, w * 0.92, h * 0.64, h * 0.08, 2.2, 0.5, w * 0.006, s + 60),
            '#c8aade', { lw: lw * 0.7, off: w * 0.004, line: '#9b74c0', lineAlpha: 0.8, seed: s + 60 });
        for (var i = 0; i < 4; i++) {
          var cx = x + w * (0.19 + i * 0.21);
          var p = ellPts(cx, y + h * 0.5, w * 0.145, h * 0.46, 16, w * 0.007, s + i);
          ink(ctx, p, '#d9c0ea', { lw: lw * 0.9, off: w * 0.006, seed: s + i });
          ink(ctx, ellPts(cx, y + h * 0.5, w * 0.072, h * 0.23, 14, w * 0.005, s + i + 40),
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
        ink(ctx, bandPts(x + w * 0.03, y + h * 0.28, w * 0.94, h * 0.66, h * 0.08, 2.4, 0.3, w * 0.006, s + 60),
            '#b3bd45', { lw: lw * 0.7, off: w * 0.004, line: '#5f7a1e', lineAlpha: 0.8, seed: s + 60 });
        for (i = 0; i < 4; i++) {
          var cx = x + w * (0.17 + i * 0.22);
          // crinkle cut: many small lobes on the rim
          var p = blobPts(cx, y + h * 0.5, w * 0.150, h * 0.50, 11, 0.11, 0.3 + i, 26, w * 0.005, s + i);
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
        var lw = pen(w, h), s = 149, i, n = 5;
        var R = h * 0.56;
        var tiny = R < 3.2;
        /* A bed under the rings. Five rings spaced across a band ten times as
         * wide as they are tall still leave gaps you can see the patty through,
         * and a layer you can see through does not look like it is resting on
         * anything. */
        ink(ctx, bandPts(x + w * 0.04, y + h * 0.34, w * 0.92, h * 0.62, h * 0.08, 2.4, 0.7, w * 0.006, s + 60),
            '#3f8f34', { lw: lw * 0.7, off: w * 0.004, line: '#17470f', lineAlpha: 0.85, seed: s + 60 });
        for (i = 0; i < n; i++) {
          var cx = x + w * (0.14 + i * 0.18), cy = y + h * 0.5;
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

    /* Avocado: a fanned row of crescent slices with a dark skin edge along the
     * outer curve - the one green in the kitchen that is not a circle, and the
     * only one carrying a near-black rim.
     *
     * The slices overlap and their tips reach the BOTTOM of the band, over a
     * bed of flesh. Three separate thin arcs floating in the middle of the band
     * left daylight under every one of them, and the whole layer read as three
     * green marks hovering above the patty. */
    avocado: {
      hFrac: 0.10, wFrac: 0.92,
      draw: function (ctx, x, y, w, h) {
        var lw = pen(w, h), s = 181, i;
        var bed = bandPts(x + w * 0.03, y + h * 0.40, w * 0.94, h * 0.58, h * 0.09, 2.2, 0.4, w * 0.006, s + 40);
        ink(ctx, bed, '#b9cf7a', { lw: lw * 0.75, off: w * 0.004, line: '#3f5d28', lineAlpha: 0.85, seed: s + 40 });
        for (i = 0; i < 4; i++) {
          var cx = x + w * (0.17 + i * 0.22), cy = y + h * 0.99;
          var rx = w * 0.20, ry = h * 0.97, th = 0.46;
          var p = crescentPts(cx, cy, rx, ry, th, w * 0.005, s + i);
          ink(ctx, p, '#cfe08f', { lw: lw * 0.85, off: w * 0.005, line: '#3f5d28', seed: s + i });
          // dark skin hugging the outer arc only
          ctx.save();
          trace(ctx, p);
          ctx.clip();
          ctx.strokeStyle = '#3f5d28';
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = Math.max(1.3, ry * 0.20);
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
      var lw = pen(w, h), s = 29, i, f;
      /* The drawn body must FILL its band: anything drawn below y + h leaves a
       * gap under the layer above and the burger reads as disassembled. */
      var top = y + h * 0.10, bot = y + h * 0.96;
      var d = [];
      for (i = 0; i <= 14; i++) {
        var t = i / 14 * Math.PI;
        d.push([x + w * 0.5 - Math.cos(t) * w * 0.5, top + Math.sin(t) * (bot - top)]);
      }
      for (i = 12; i >= 0; i--) {
        f = i / 12;
        d.push([x + f * w, top + h * 0.04 * Math.sin(f * 5)]);
      }
      jitter(d, w * 0.010, s);
      ink(ctx, d, '#e0a75f', { lw: lw, off: w * 0.010, line: '#8f5a24', seed: s });
      hatch(ctx, d, '#a4692c', s, { n: 4, alpha: 0.22, gap: h * 0.30 });
      // pale cut face along the top, the giveaway that this is a sliced heel
      var cut = [];
      for (i = 0; i <= 12; i++) {
        f = i / 12;
        cut.push([x + f * w * 0.995 + w * 0.002, top + h * 0.04 * Math.sin(f * 5)]);
      }
      for (i = 12; i >= 0; i--) {
        var g2 = i / 12;
        cut.push([x + g2 * w * 0.98 + w * 0.01, top + h * (0.30 + 0.05 * Math.sin(g2 * 5 + 1.4))]);
      }
      jitter(cut, w * 0.007, s + 3);
      ink(ctx, cut, '#f6dcae', { lw: lw * 0.8, off: w * 0.005, line: '#a8763f', lineAlpha: 0.7, seed: s + 3 });
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

  /* ------------------------------------------------------------- seating
   * Where a layer's INK actually lives inside its own band, as a fraction of
   * the band height: [top, bottom]. MEASURED, not guessed - each layer was
   * rendered alone and its painted rows scanned across the middle 60% of its
   * width (the part that meets the layer below). Guessed numbers are how the
   * avocado ended up floating: its fan is drawn from -0.37h to 0.50h and never
   * reaches the bottom of its own band at all.
   *
   * Re-measure after changing any layer's drawing. Anything missing here is
   * assumed to fill its band.
   */
  var SEAT = {
    bunBottom: [-0.04, 1.03],
    bun:       [0.07, 0.98],
    bunTop:    [0.13, 1.05],
    patty:     [0.04, 1.02],
    cheese:    [-0.17, 1.08],   // measures 1.57: that is the melt draping DOWN
    lettuce:   [0.02, 1.02],    // the sides of what is under it, not its underside
    tomato:    [-0.15, 1.36],
    onion:     [0.04, 1.05],
    pickle:    [-0.04, 1.06],
    bacon:     [-0.03, 1.06],
    jalapeno:  [0.21, 1.08],
    egg:       [0.10, 1.05],
    avocado:   [0.00, 1.10],
    ketchup:   [0.17, 1.00],
    mustard:   [0.28, 0.89],
    mayo:      [0.06, 1.11],
    bbq:       [0.00, 0.94],
    special:   [0.17, 1.00]
  };
  /* The full painted extent of each layer, [top, bottom], in the same units as
   * SEAT. SEAT is where a layer is SOLID (what the next one lands on); this is
   * where its last pixel is. Two different questions - using SEAT for both
   * under-reports the stack by a few percent, which is enough for a burger
   * fitted to a box with fitWidth() to have its crown clipped flat. */
  var PAINT = {
    bunBottom: [-0.04, 1.03],
    bun:       [0.00, 1.00],
    bunTop:    [0.06, 1.05],
    patty:     [-0.02, 1.02],
    cheese:    [-0.20, 1.63],
    lettuce:   [-0.07, 1.10],
    tomato:    [-0.21, 1.39],
    onion:     [-0.07, 1.09],
    pickle:    [-0.12, 1.14],
    bacon:     [-0.18, 1.12],
    jalapeno:  [-0.17, 1.17],
    egg:       [0.07, 1.10],
    avocado:   [-0.07, 1.13],
    ketchup:   [-0.17, 1.22],
    mustard:   [0.00, 1.00],
    mayo:      [-0.28, 1.39],
    bbq:       [-0.17, 1.17],
    special:   [-0.17, 1.22]
  };

  /*
   * How deep a layer sits into the one below it.
   *
   * Scaled off BOTH neighbours, not just the thinner one: a bun crown landing
   * on a 6px sauce rope has to come down far enough to touch it, and a bite
   * measured off the sauce alone left the whole lid hanging in the air. Capped
   * against the thinner one so the sauce is still visible under the lid.
   */
  function biteBetween(a, b) {
    return Math.min((a + b) * 0.13, Math.min(a, b) * 0.65);
  }

  /* ------------------------------------------------------------ upgrades
   * The five things the shop sells, drawn with the same pen as the food. They
   * were emoji, which meant the shop was the one screen where the game's own
   * hand disappeared and the platform's font took over - and 🍳 next to 🔥 does
   * not say "one more burner" next to "a wider perfect window" to anyone.
   *
   * Art.drawUpgrade(ctx, id, w, h) - fills the box, centred.
   * ids: shoes / plate / grill / burner / sign  (Core.UPGRADES)
   */
  var UPGRADE_IDS = ['shoes', 'plate', 'grill', 'burner', 'sign'];

  function drawUpgrade(ctx, id, w, h) {
    var P = Math.min(w, h) * 0.96, cx = w / 2, cy = h / 2;
    var lw = Math.max(1, P * 0.052), s = 977, i;
    /** points given in box units (-0.5 .. 0.5), wobbled */
    function up(list, jit, seed) {
      return jitter(list.map(function (p) { return [cx + p[0] * P, cy + p[1] * P]; }),
                    (jit === undefined ? 0.012 : jit) * P, seed);
    }
    function stroke(list, color, width, alpha) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      list.forEach(function (p, k) {
        var X = cx + p[0] * P, Y = cy + p[1] * P;
        if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      });
      ctx.stroke();
      ctx.restore();
    }

    if (id === 'shoes') {
      // Everything here stays inside +/-0.44 box units: the jitter and half the
      // pen width live in what is left, and anything past it clips flat.
      stroke([[-0.44, -0.14], [-0.28, -0.14]], '#c0562f', lw * 0.9, 0.6);
      stroke([[-0.42, 0.00], [-0.26, 0.00]], '#c0562f', lw * 0.9, 0.4);
      var shoe = up([[-0.24, 0.10], [-0.26, -0.14], [-0.17, -0.28], [-0.05, -0.20],
                     [0.06, -0.08], [0.20, 0.00], [0.34, 0.04], [0.40, 0.10],
                     [0.40, 0.14], [-0.24, 0.14]], 0.010, s);
      ink(ctx, shoe, '#fffaf0', { lw: lw, off: P * 0.008, seed: s });
      hatch(ctx, shoe, '#c3ac91', s, { n: 2, alpha: 0.14, gap: P * 0.12 });
      // sole, with the toe kicked up
      ink(ctx, up([[-0.30, 0.08], [0.36, 0.01], [0.44, 0.06], [0.44, 0.20], [-0.30, 0.24]], 0.008, s + 1),
          '#c0562f', { lw: lw * 0.9, line: '#7a2f14', seed: s + 1 });
      // stripe and laces - what makes it a running shoe and not a slipper
      ctx.save();
      trace(ctx, shoe);
      ctx.clip();
      ctx.strokeStyle = '#c0562f';
      ctx.lineWidth = Math.max(1.2, P * 0.075);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - P * 0.22, cy - P * 0.02);
      ctx.quadraticCurveTo(cx + P * 0.02, cy + P * 0.08, cx + P * 0.28, cy + P * 0.02);
      ctx.stroke();
      ctx.restore();
      for (i = 0; i < 3; i++) {
        stroke([[-0.12 + i * 0.09, -0.19 + i * 0.055], [-0.03 + i * 0.09, -0.07 + i * 0.055]],
               '#8a7259', lw * 0.7, 0.9);
      }
    } else if (id === 'plate') {
      ink(ctx, ellPts(cx, cy + P * 0.20, P * 0.42, P * 0.12, 20, P * 0.008, s + 10),
          '#f0e5d6', { lw: lw * 0.9, line: '#a4906f', seed: s + 10 });
      ink(ctx, ellPts(cx, cy + P * 0.04, P * 0.47, P * 0.14, 22, P * 0.008, s + 11),
          '#fffaf1', { lw: lw, off: P * 0.006, line: '#a4906f', seed: s + 11 });
      ink(ctx, ellPts(cx, cy + P * 0.03, P * 0.28, P * 0.075, 18, P * 0.005, s + 12),
          null, { lw: lw * 0.6, line: '#c9b499', lineAlpha: 0.8, seed: s + 12 });
      // something to build on it
      var dome = [], n = 14;
      for (i = 0; i <= n; i++) {
        var t = Math.PI + i / n * Math.PI;
        dome.push([cx + Math.cos(t) * P * 0.20, cy - P * 0.05 + Math.sin(t) * P * 0.20]);
      }
      dome.push([cx + P * 0.20, cy - P * 0.03], [cx - P * 0.20, cy - P * 0.03]);
      ink(ctx, jitter(dome, P * 0.008, s + 13), '#eab470', { lw: lw * 0.85, line: '#a4692c', seed: s + 13 });
    } else if (id === 'grill') {
      var f1 = up([[0.00, -0.46], [0.17, -0.18], [0.29, 0.06], [0.19, 0.29], [-0.03, 0.37],
                   [-0.25, 0.26], [-0.30, 0.02], [-0.13, -0.15], [-0.05, -0.33]], 0.014, s + 20);
      ink(ctx, f1, '#e2704f', { lw: lw, off: P * 0.008, line: '#8a3a1c', seed: s + 20 });
      var f2 = up([[0.01, -0.16], [0.14, 0.04], [0.10, 0.24], [-0.05, 0.30],
                   [-0.16, 0.20], [-0.13, 0.00]], 0.010, s + 21);
      ink(ctx, f2, '#f4b41a', { lw: lw * 0.7, line: '#a8721a', lineAlpha: 0.8, seed: s + 21 });
    } else if (id === 'burner') {
      var body = rectPts(cx - P * 0.44, cy - P * 0.26, P * 0.88, P * 0.56, P * 0.10, P * 0.008, s + 30);
      ink(ctx, body, '#5a5350', { lw: lw, off: P * 0.006, line: '#2b2523', seed: s + 30 });
      ctx.save();
      trace(ctx, body);
      ctx.clip();
      for (i = 0; i < 3; i++) {
        stroke([[-0.36, -0.14 + i * 0.17], [0.36, -0.14 + i * 0.17]], '#e2704f', Math.max(1.2, P * 0.075), 0.95);
      }
      ctx.restore();
      hatch(ctx, body, '#2b2523', s + 30, { n: 3, alpha: 0.20, gap: P * 0.14 });
      ink(ctx, ellPts(cx + P * 0.30, cy + P * 0.38, P * 0.075, P * 0.075, 12, P * 0.005, s + 31),
          '#d9cfc6', { lw: lw * 0.8, line: '#2b2523', seed: s + 31 });
    } else if (id === 'sign') {
      for (i = 0; i < 4; i++) {
        var a = -Math.PI * 0.86 + i * Math.PI * 0.24;
        stroke([[Math.cos(a) * 0.30, Math.sin(a) * 0.30 - 0.04],
                [Math.cos(a) * 0.41, Math.sin(a) * 0.41 - 0.04]], '#e8a021', lw * 0.9, 0.85);
      }
      ink(ctx, blobPts(cx, cy - P * 0.08, P * 0.23, P * 0.26, 4, 0.03, 0.5, 22, P * 0.008, s + 40),
          '#f7d774', { lw: lw, off: P * 0.007, line: '#a8763f', seed: s + 40 });
      ink(ctx, rectPts(cx - P * 0.12, cy + P * 0.15, P * 0.24, P * 0.20, P * 0.04, P * 0.006, s + 41),
          '#c4ab8a', { lw: lw * 0.9, line: '#7d6249', seed: s + 41 });
      stroke([[-0.06, -0.02], [-0.02, -0.12], [0.02, -0.02], [0.06, -0.12]], '#c0562f', lw * 0.8, 0.9);
      stroke([[-0.09, 0.19], [0.09, 0.19]], '#7d6249', lw * 0.6, 0.7);
      stroke([[-0.09, 0.26], [0.09, 0.26]], '#7d6249', lw * 0.6, 0.7);
    } else {
      drawIcon(ctx, id, w, h);
    }
  }


  /* --------------------------------------------------------------- API */
  function layerOf(id) { return LAYERS[id] || LAYERS.cheese; }
  function seatOf(id) { return SEAT[id] || [0.02, 0.98]; }
  function paintOf(id) { return PAINT[id] || seatOf(id); }

  /**
   * Work out where every layer's band goes, bottom up, in offsets from the
   * baseline (negative = above it). One place decides it so stackHeight() and
   * drawStack() can never disagree - the plate used to be sized by one and
   * painted by the other.
   */
  function seatStack(items, bunWidth) {
    var rows = [], topY = 0, botY = 0, prevTop = 0, prevH = 0, prevW = 0, i;
    for (i = 0; i < items.length; i++) {
      var it = typeof items[i] === 'string' ? { id: items[i] } : items[i];
      var h = heightOf(it.id, bunWidth), st = seatOf(it.id), pt = paintOf(it.id), y;
      if (i === 0) y = -st[1] * h;                       // its underside on the baseline
      else y = prevTop + biteBetween(h, prevH) - st[1] * h;
      rows.push({ it: it, y: y, h: h, seat: st, w: layerWidth(it.id, bunWidth), prevW: prevW });
      prevTop = y + st[0] * h;
      prevH = h;
      prevW = layerWidth(it.id, bunWidth);
      // the reported height covers the PAINT, not the seating surface
      if (y + pt[0] * h < topY) topY = y + pt[0] * h;
      if (y + pt[1] * h > botY) botY = y + pt[1] * h;
    }
    return { rows: rows, height: botY - topY, top: topY, bottom: botY };
  }

  function heightOf(id, bunWidth) {
    return layerOf(id).hFrac * bunWidth;
  }

  /** How wide the layer actually paints - lettuce spills past the bun. */
  function layerWidth(id, bunWidth) {
    return layerOf(id).wFrac * bunWidth;
  }

  /** Total painted height of a stack drawn at this bun width. */
  function stackHeight(items, bunWidth) {
    if (!items || !items.length) return 0;
    return seatStack(items, bunWidth).height;
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
    if (!items || !items.length) return 0;
    var plan = seatStack(items, bunWidth);
    for (var i = 0; i < plan.rows.length; i++) {
      var r = plan.rows[i], it = r.it;
      var lift = it.pop !== undefined && it.pop < 1 ? (1 - it.pop) * bunWidth * 0.55 : 0;
      var a = opts.alpha !== undefined ? opts.alpha : (it.pop !== undefined ? Math.min(1, it.pop * 1.6) : 1);
      /* A soft shadow in the seam. Geometry alone gets the layers touching, but
       * two flat drawings that touch still read as two stickers side by side -
       * the shadow is what says one is RESTING ON the other. Drawn before the
       * layer, so the layer covers all but a crescent of it. */
      if (i > 0 && !lift && opts.seam !== false) {
        var sw = Math.min(r.w, r.prevW) * 0.46;
        var sy = baseY + r.y + r.seat[1] * r.h - r.h * 0.16;
        ctx.save();
        ctx.globalAlpha = 0.17 * a;
        ctx.fillStyle = '#4a3226';
        trace(ctx, ellPts(cx, sy, sw, Math.max(1, r.h * 0.30), 16, bunWidth * 0.004, 900 + i));
        ctx.fill();
        ctx.restore();
      }
      drawLayer(ctx, it.id, cx, baseY + r.y - lift, bunWidth, {
        done: it.done,
        char: it.char,
        alpha: a
      });
    }
    return plan.height;
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
  var CHEF_SKINS = {
    classic: {
      trousers: '#7a5a8a', whites: '#fffaf0', whitesHatch: '#c3ac91',
      scarf: '#ef7d6b', buttons: '#a98d70',
      skin: '#f7cfa4', skinHatch: '#c99a6d', cheek: '#f4948a',
      toqueBand: '#fffdf7', toquePuff: '#ffffff', toqueHatch: '#c9b9a4'
    },
    garden: {                                   // sage, the kitchen's own second voice
      trousers: '#56633f', whites: '#e6efd2', whitesHatch: '#aebf92',
      scarf: '#8fa073', buttons: '#728157',
      skin: '#f2c79a', skinHatch: '#c08f61', cheek: '#e8907f',
      toqueBand: '#f7faf0', toquePuff: '#ffffff', toqueHatch: '#ccdbb2'
    },
    head: {                                     // the one in charge: cocoa and brass
      trousers: '#402310', whites: '#f6e3c2', whitesHatch: '#b28f63',
      scarf: '#c67139', buttons: '#8c491a',
      skin: '#e0ad7c', skinHatch: '#a9754a', cheek: '#d97b62',
      toqueBand: '#fff6e6', toquePuff: '#fffaf0', toqueHatch: '#c9a97e'
    },
    night: {                                    // the deep outlier - a late shift
      trousers: '#232028', whites: '#4a4753', whitesHatch: '#2e2b35',
      scarf: '#f6a06b', buttons: '#8f8a99',
      skin: '#d9a97e', skinHatch: '#9d7048', cheek: '#c9705c',
      toqueBand: '#5d5a68', toquePuff: '#6d6a78', toqueHatch: '#3c3945'
    },
    berry: {                                    // the milkshake counter
      trousers: '#a85f74', whites: '#ffe4ea', whitesHatch: '#e4b5be',
      scarf: '#d2543c', buttons: '#c98a97',
      skin: '#f7cfa4', skinHatch: '#c99a6d', cheek: '#ee8f92',
      toqueBand: '#fff7f8', toquePuff: '#ffffff', toqueHatch: '#eec4cc'
    },
    gold: {                                     // the top of the menu
      trousers: '#5c4415', whites: '#fff0c8', whitesHatch: '#cbab63',
      scarf: '#b8860b', buttons: '#9c7c2a',
      skin: '#f2c79a', skinHatch: '#bd8b57', cheek: '#e69076',
      toqueBand: '#fff5d6', toquePuff: '#fffdf2', toqueHatch: '#d9bd7a'
    }
  };

  function skinOf(id) {
    var k = CHEF_SKINS[id] || CHEF_SKINS.classic;
    if (!k.hair) k.hair = mixHex(k.skinHatch, '#241708', 0.62);
    return k;
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
   * opts: { face, bob, blink, hop, carry, walk, work, cheer, droop }
   *   walk   phase in TURNS (0..1 loops) - the waddle. Weight rolls from one
   *          foot to the other: the body leans over the planted foot, the hips
   *          shift under it, he rises between steps and the belly lags behind.
   *   work   0..1 hands alternate up/down (chopping, flipping)
   *   cheer  1 = both arms up
   *   droop  0..1 shoulders sag, moustache and eyes fall (a lost order)
   * Art.chefPose(mode, t) builds this bag from a clock - use that instead of
   * hand-tuning sine waves in game.js.
   */
  function drawChef(ctx, x, y, s, opts) {
    opts = opts || {};
    var K = skinOf(opts.skin);
    var face = opts.face >= 0 ? 1 : -1;
    var swing = Math.sin((opts.bob || 0) * TAU);
    var hop = opts.hop || 0;
    var blink = opts.blink || 0;
    var droop = opts.droop || 0;
    var work = opts.work || 0;
    var lw = Math.max(1, s * 0.018);
    var sd = 311, i;

    // the waddle. w8 = which foot carries the weight (+1 left .. -1 right),
    // stp = how far the legs are apart, lag = the belly arriving late
    var wk = opts.walk === undefined ? 0 : 1;
    var ph = (opts.walk || 0) * TAU;
    var w8 = Math.cos(ph) * wk, stp = Math.sin(ph) * wk;
    var lag = Math.sin(ph - 0.9) * wk;
    var rot = -w8 * 0.095;
    var sway = -w8 * s * 0.022;
    var rise = -(1 - Math.abs(w8)) * s * 0.030 * wk;

    // Stretch in the air, squash on the ground - it was the other way round,
    // so he flattened at the top of every hop.
    var sx = (1 - hop * 0.06) * (1 + Math.abs(w8) * 0.030);
    var sy = (1 + hop * 0.08) * (1 - Math.abs(w8) * 0.035);
    var cy = y - Math.abs(swing) * s * 0.045 - hop * s * 0.10 + rise;

    // scribbled contact shadow
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (var g = 0; g < 3; g++) {
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = s * 0.030;
      // ...and the shadow shrinks as he leaves the floor, rather than growing
      var ww = s * 0.30 * (1 - g * 0.18) * (1 - hop * 0.22);
      ctx.beginPath();
      ctx.moveTo(x - ww + sway, y + g * s * 0.018);
      ctx.quadraticCurveTo(x + sway, y + g * s * 0.018 + s * 0.01, x + ww + sway, y + g * s * 0.018);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(x + sway, cy);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.translate(-x, -cy);

    // legs: stubby, set wide apart, one swinging forward while the other plants
    var legW = s * 0.130, legH = s * 0.140, legY = cy - legH;
    for (i = 0; i < 2; i++) {
      var dir = i ? 1 : -1;
      var fwd = stp * dir * s * 0.050;
      var lift = Math.max(0, stp * dir) * s * 0.040;
      var lx = x + dir * s * 0.090 - legW / 2 + fwd;
      ink(ctx, rectPts(lx, legY - lift, legW, legH + lift * 0.5, s * 0.052, s * 0.006, sd + i * 2),
          K.trousers, { lw: lw * 0.9, off: s * 0.006, seed: sd + i * 2 });
      ink(ctx, ellPts(lx + legW * 0.5 + dir * s * 0.014, cy - lift, s * 0.088, s * 0.033, 14, s * 0.004, sd + 40 + i),
          mixHex(K.trousers, "#231c2a", 0.45), { lw: lw * 0.85, off: s * 0.004, seed: sd + 40 + i });
    }

    // chef whites: a pear, not a box - narrow shoulders over a heavy belly
    var bTop = cy - s * 0.500, bH = s * 0.385, bBot = bTop + bH;
    var prof = [[0.170, 0.00], [0.222, 0.15], [0.270, 0.35], [0.297, 0.57],
                [0.296, 0.78], [0.256, 0.93], [0.150, 1.00]];
    var body = [];
    for (i = 0; i < prof.length; i++) {
      body.push([x + prof[i][0] * s * (1 + lag * 0.045), bTop + prof[i][1] * bH]);
    }
    body.push([x + s * 0.012 * lag, bBot + s * 0.010]);
    for (i = prof.length - 1; i >= 0; i--) {
      body.push([x - prof[i][0] * s * (1 - lag * 0.045), bTop + prof[i][1] * bH]);
    }
    body.push([x, bTop - s * 0.014]);
    body = jitter(body, s * 0.007, sd + 4);
    ink(ctx, body, K.whites, { lw: lw, off: s * 0.007, seed: sd + 4 });
    hatch(ctx, body, K.whitesHatch, sd + 4, { n: 4, alpha: 0.26, gap: s * 0.038 });

    // the belly itself: one soft crease so the coat reads as stretched over it
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = K.whitesHatch;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.arc(x + lag * s * 0.010, bTop + bH * 0.50, s * 0.185, 0.32 * Math.PI, 0.68 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // double-breasted buttons, riding the curve of the belly
    for (i = 0; i < 3; i++) {
      ink(ctx, ellPts(x + lag * s * 0.008, bTop + bH * (0.20 + i * 0.24), s * 0.021, s * 0.021, 8, s * 0.003, sd + 8 + i),
          null, { lw: lw * 0.7, line: K.buttons, lineAlpha: 0.7 });
    }

    var shoulderY = bTop + bH * 0.16;
    var bw2 = s * 0.255;
    var handSpread = bw2 + s * 0.045, handY = cy - s * 0.285;
    var lhx = x - handSpread - stp * s * 0.030, rhx = x + handSpread + stp * s * 0.030;
    var lhy = handY + stp * s * 0.022 + droop * s * 0.045;
    var rhy = handY - stp * s * 0.022 + droop * s * 0.045;
    if (work) { lhy -= work * s * 0.055; rhy += work * s * 0.055; }

    // head
    var hy = cy - s * 0.655, hr = s * 0.215;
    var head = blobPts(x, hy + hr * 0.05, hr * 1.06, hr * 1.00, 5, 0.022, 0.9, 22, s * 0.006, sd + 11);
    ink(ctx, head, K.skin, { lw: lw, off: s * 0.006, seed: sd + 11 });
    hatch(ctx, head, K.skinHatch, sd + 11, { n: 3, alpha: 0.22, gap: s * 0.030 });

    // jowls: a soft second chin, the fastest way to read heavy
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = K.skinHatch;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.arc(x, hy + hr * 0.30, hr * 0.62, 0.24 * Math.PI, 0.76 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // rosy cheeks, pushed out and down on the fuller face
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = K.cheek;
    trace(ctx, ellPts(x - hr * 0.62, hy + hr * 0.34, hr * 0.27, hr * 0.18, 9, s * 0.003, sd + 13)); ctx.fill();
    trace(ctx, ellPts(x + hr * 0.62, hy + hr * 0.34, hr * 0.27, hr * 0.18, 9, s * 0.003, sd + 14)); ctx.fill();
    ctx.restore();

    // eyes
    var ex = face * hr * 0.10, eo = hr * 0.34, ey = hy - hr * 0.10;
    var open = (1 - blink) * (1 - droop * 0.45);
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
    // bushy brows, to answer the moustache
    ctx.lineWidth = Math.max(1, hr * 0.15);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x + ex - eo - hr * 0.17, ey - hr * (0.30 - droop * 0.10));
    ctx.lineTo(x + ex - eo + hr * 0.15, ey - hr * (0.36 + droop * 0.14));
    ctx.moveTo(x + ex + eo - hr * 0.15, ey - hr * (0.36 + droop * 0.14));
    ctx.lineTo(x + ex + eo + hr * 0.17, ey - hr * (0.30 - droop * 0.10));
    ctx.stroke();
    // smile, drawn with a slightly overshooting stroke
    ctx.globalAlpha = 0.88;
    ctx.lineWidth = Math.max(1, hr * 0.085);
    ctx.beginPath();
    if (droop > 0.5) ctx.arc(x + ex, hy + hr * 0.86, hr * 0.24, 1.20 * Math.PI, 1.80 * Math.PI);
    else ctx.arc(x + ex, hy + hr * 0.40, hr * 0.24, 0.22 * Math.PI, 0.80 * Math.PI);
    ctx.stroke();
    ctx.restore();

    // nose: a bulb, so the moustache has something to sit under
    ink(ctx, ellPts(x + ex * 1.4, hy + hr * 0.12, hr * 0.155, hr * 0.135, 14, s * 0.003, sd + 17),
        mixHex(K.skin, "#c07f52", 0.35), { lw: lw * 0.75, off: s * 0.003, line: K.skinHatch, seed: sd + 17 });

    // the moustache: a handlebar, tips curling up (down when he is beaten)
    drawStache(ctx, x + ex * 1.2, hy + hr * (0.36 + droop * 0.05), hr * 0.46, hr * 0.135,
               droop, lag * 0.35, lw, sd + 19, K);

    // toque
    ink(ctx, rectPts(x - hr * 1.02, hy - hr * 1.02, hr * 2.04, hr * 0.44, hr * 0.16, s * 0.006, sd + 18),
        K.toqueBand, { lw: lw, off: s * 0.005, seed: sd + 18 });
    var puff = blobPts(x + lag * s * 0.008, hy - hr * 1.36, hr * 1.16, hr * 0.64, 3, 0.16, 0.6, 22, s * 0.008, sd + 20);
    ink(ctx, puff, K.toquePuff, { lw: lw, off: s * 0.006, seed: sd + 20 });
    hatch(ctx, puff, K.toqueHatch, sd + 20, { n: 3, alpha: 0.25, gap: s * 0.030 });

    // neckerchief, tucked under the chin where the head meets the coat
    ink(ctx, rectPts(x - s * 0.145, cy - s * 0.462, s * 0.29, s * 0.080, s * 0.034, s * 0.005, sd + 6),
        K.scarf, { lw: lw * 0.85, off: s * 0.005, seed: sd + 6 });

    if (opts.cheer) {
      lhx = x - bw2 * 0.80; rhx = x + bw2 * 0.80;
      lhy = rhy = hy - hr * 1.05;
    }
    if (opts.carry) {
      /*
       * The baseline has to clear the hand, not sit in it. The hand is a
       * circle of radius 0.066s centred  below this line, so an offset
       * under 0.066s buries the object - at the old 0.035s it was a quarter
       * of a hand deep, and since the sleeves are painted AFTER this
       * callback the arms closed over its bottom edge. That is the "held by
       * the arms" read.
       *
       * 0.062s leaves a 0.004s bite: the hands still overlap the very
       * bottom of it, which is what makes them read as fingers curled under
       * rather than as a sticker laid on top. The hand line itself does not
       * move - both numbers shift together.
       */
      /*
       * The box is 0.20s tall, not 0.42s. From a baseline at cy-0.302s a
       * full-height item reached cy-0.72s - past the eyes (cy-0.705s) and
       * almost to the toque. Every carry covered the face.
       */
      var boxW = s * 0.72, boxH = s * 0.205;
      var carryY = cy - s * 0.302;
      // Measured, not drawn. The object has to be painted AFTER the sleeves,
      // and the sleeves cannot be drawn until the hands are placed, and the
      // hands cannot be placed until the object is measured - so the callback
      // is asked twice: once for its half-width, once for the marks.
      var half = opts.carry(ctx, x, carryY, boxW, boxH, true);
      // The floor only has to stop the hands crossing. At 0.13s it was wider
      // than a cup (0.095s) and a fry carton (0.085s), so neither was gripped.
      handSpread = Math.max(s * 0.08, (half || s * 0.30) * 0.94);
      /*
       * Carrying is a MODIFIER, not a replacement.
       *
       * This block used to assign the hands outright, after every other pose
       * had already written them - so picking anything up silently deleted the
       * walk's hand swing, the droop of a lost order and the alternating chop.
       * A cook carrying a plate through a walkout stood dead level with a sad
       * face. The carry sets where the hands MEET; the poses still move them.
       *
       * Cheer is the one exception, and deliberately: you cannot throw both
       * arms over your head while holding a plate.
       */
      var cyH = carryY + s * 0.062 + droop * s * 0.045;
      lhx = x - handSpread - stp * s * 0.012;
      rhx = x + handSpread + stp * s * 0.012;
      lhy = cyH - work * s * 0.030 + stp * s * 0.010;
      rhy = cyH + work * s * 0.030 - stp * s * 0.010;
    }

    // short sleeves out to each hand: a fat cook cannot hang his arms straight
    sleeve(ctx, x - bw2 * 0.72, shoulderY, lhx, lhy, s, lw, K);
    sleeve(ctx, x + bw2 * 0.72, shoulderY, rhx, rhy, s, lw, K);

    /*
     * The carried object goes on LAST, over the arms.
     *
     * It used to be painted before them, and the sleeve is a 0.112s-thick
     * stroke with a round cap running from the shoulder down to the hand - its
     * top edge reaches 0.192s above the object's baseline, so a fat white bar
     * was laid across the lower half of everything the cook carried. That is
     * the forearm-carrying look, and no amount of resizing the object was ever
     * going to fix it: the arm was simply on top.
     *
     * The hands then go on over the object, so the fingers still close in
     * front of its bottom edge and it reads as gripped rather than glued on.
     */
    if (opts.carry) opts.carry(ctx, x, carryY, boxW, boxH, false);

    ink(ctx, ellPts(lhx, lhy, s * 0.066, s * 0.066, 12, s * 0.004, sd + 22), K.skin, { lw: lw * 0.9, seed: sd + 22 });
    ink(ctx, ellPts(rhx, rhy, s * 0.066, s * 0.066, 12, s * 0.004, sd + 23), K.skin, { lw: lw * 0.9, seed: sd + 23 });

    ctx.restore();
  }

  /** One sleeve, drawn as an outlined fat stroke - no rotation maths needed. */
  // K is the cook's palette: these are siblings of drawChef, not closures
  // inside it, so the skin travels as an argument rather than as scope.
  function sleeve(ctx, x0, y0, x1, y1, s, lw, K) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = s * 0.112;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = K.whites;
    ctx.globalAlpha = 1;
    ctx.lineWidth = s * 0.112 - lw * 1.7;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  /**
   * Handlebar moustache. `dr` 0..1 drops the tips, `sw` shifts it sideways so
   * it can lag behind a waddle.
   */
  function drawStache(ctx, cx, cy, mw, mh, dr, sw, lw, seed, K) {
    var p = [], k;
    var up = 1 - dr * 2;
    p.push([cx, cy - mh * 0.50]);
    p.push([cx + mw * 0.36, cy - mh * 0.66]);
    p.push([cx + mw * 0.72, cy - mh * 0.78 + dr * mh * 0.9]);
    p.push([cx + mw * 1.02, cy - mh * 1.35 * up]);
    p.push([cx + mw * 1.20, cy - mh * 0.55 * up]);
    p.push([cx + mw * 0.98, cy - mh * 0.05 + dr * mh * 0.9]);
    p.push([cx + mw * 0.62, cy + mh * 0.52 + dr * mh * 0.5]);
    p.push([cx + mw * 0.30, cy + mh * 0.78]);
    p.push([cx, cy + mh * 0.66]);
    for (k = p.length - 2; k >= 1; k--) p.push([2 * cx - p[k][0], p[k][1]]);
    for (k = 0; k < p.length; k++) p[k][0] += sw * mw * 0.06;
    p = jitter(p, mh * 0.10, seed);
    ink(ctx, p, K.hair, { lw: lw * 0.85, off: mh * 0.09, line: K.hair, seed: seed });
    hatch(ctx, p, K.hair, seed + 1, { n: 3, alpha: 0.22, gap: mh * 0.32 });
  }

  /**
   * Turn a clock into a pose bag for drawChef, so game.js never hand-tunes a
   * sine wave: Art.drawChef(ctx, x, y, s, Art.chefPose('walk', t)).
   * modes: idle | walk | carry | cook | cheer | sad
   */
  function chefPose(mode, t, o) {
    o = o || {};
    t = t || 0;
    var p = { face: o.face === undefined ? 1 : o.face };
    p.blink = ((t * 0.29) % 1) > 0.962 ? 1 : 0;
    if (mode === 'walk' || mode === 'carry') {
      p.walk = (t * (o.speed === undefined ? 1.35 : o.speed)) % 1;
    } else if (mode === 'cook') {
      p.bob = (t * 1.1) % 1;
      p.work = 0.5 + 0.5 * Math.sin(t * 7.5);
    } else if (mode === 'cheer') {
      p.hop = Math.max(0, Math.sin(((t * 1.7) % 1) * Math.PI));
      p.cheer = 1;
      p.blink = 0;
    } else if (mode === 'sad') {
      p.droop = 1;
      p.bob = (t * 0.42) % 1;
    } else {
      p.bob = (t * 0.55) % 1;
    }
    return p;
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

  /**
   * A produce crate on the line - the item slot the player actually taps.
   *
   * Open at the top with the stock sitting down inside it, a slatted front
   * panel drawn OVER the stock so the food is in the box rather than on it,
   * two corner posts, and a paper label clipped to the front. Same pen, same
   * wobble and same hatching as the food, so the shelf stops looking like a
   * row of glossy plastic buttons borrowed from another game.
   *
   * Art.scene.crate(ctx, x, y, w, h, {
   *   id,    ingredient id - drawn inside with Art.drawPortrait
   *   name,  short label ('Cheese'); omit for no label plate
   *   tint,  the ingredient's swatch colour, a dot beside the name
   *   hot,   true for anything that has to be grilled - a little flame
   *   live,  true while a cook is walking to it - hand-drawn ring, no glow
   *   pop    0..1 recoil after something is lifted out
   * })
   * The 5th argument may still be a scene theme; it is ignored, as before.
   */
  function drawCrate(ctx, x, y, w, h, opts) {
    if (!opts || (opts.id === undefined && opts.name === undefined &&
                  opts.live === undefined && opts.pop === undefined)) opts = {};
    var s = 653, lw = Math.max(1.1, w * 0.024), i, c;
    var pop = opts.pop || 0;
    var frontH = Math.min(Math.max(h * 0.34, w * 0.24), h * 0.42);
    var lip = h * 0.05;

    ctx.save();
    if (pop > 0) {
      ctx.translate(x + w / 2, y + h);
      ctx.scale(1 + pop * 0.05, 1 - pop * 0.07);
      ctx.translate(-(x + w / 2), -(y + h));
    }

    // scribbled contact shadow, the same three strokes the cook stands on
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = h * 0.035;
      var sw = w * 0.46 * (1 - i * 0.22);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5 - sw, y + h + i * h * 0.03);
      ctx.quadraticCurveTo(x + w * 0.5, y + h + i * h * 0.03 + h * 0.02, x + w * 0.5 + sw, y + h + i * h * 0.03);
      ctx.stroke();
    }
    ctx.restore();

    // the dark inside of the box, seen over the top edge
    var back = rectPts(x + w * 0.04, y + lip, w * 0.92, h - lip - frontH * 0.30, w * 0.05, w * 0.008, s + 1);
    ink(ctx, back, '#8a5f2e', { lw: lw * 0.9, off: w * 0.006, line: '#4a2f18', seed: s + 1 });
    hatch(ctx, back, '#4a2f18', s + 1, { n: 5, alpha: 0.22, gap: h * 0.12 });

    // the stock, sitting down in the box
    if (opts.id) {
      var inW = w * 0.84, inH = h - lip - frontH * 0.62;
      ctx.save();
      trace(ctx, rectPts(x + w * 0.08, y + lip * 1.2, inW, inH, w * 0.04, 0, s + 2));
      ctx.clip();
      ctx.translate(x + w * 0.08, y + lip * 1.2);
      drawPortrait(ctx, opts.id, inW, inH * 1.02);
      ctx.restore();
      // the box's own shade falling across the top of what is in it
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = '#3a2110';
      trace(ctx, rectPts(x + w * 0.06, y + lip, w * 0.88, h * 0.16, w * 0.04, w * 0.005, s + 3));
      ctx.fill();
      ctx.restore();
    }

    // front panel over the stock, with the grain running along it
    var f = rectPts(x + w * 0.005, y + h - frontH, w * 0.99, frontH, w * 0.055, w * 0.007, s + 4);
    ink(ctx, f, '#d9a35f', { lw: lw, off: w * 0.007, line: '#6f4526', seed: s + 4 });
    ctx.save();
    trace(ctx, f); ctx.clip();
    ctx.strokeStyle = '#a8763f';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.8, w * 0.012);
    for (i = 0; i < 2; i++) {
      var gy = y + h - frontH * (0.72 - i * 0.44);
      ctx.beginPath();
      for (c = 0; c <= 8; c++) ctx.lineTo(x + c * w / 8, gy + wob(s + i, c) * frontH * 0.05);
      ctx.stroke();
    }
    ctx.restore();
    hatch(ctx, f, '#6f4526', s + 4, { n: 4, alpha: 0.13, gap: frontH * 0.34 });

    // corner posts, running the full height of the box
    [x + w * 0.01, x + w * 0.885].forEach(function (bx, k) {
      ink(ctx, rectPts(bx, y + h * 0.16, w * 0.105, h * 0.84, w * 0.035, w * 0.006, s + 10 + k),
          '#c08a4c', { lw: lw * 0.85, line: '#6f4526', seed: s + 10 + k });
    });

    // paper label clipped to the front panel
    if (opts.name) {
      var lx = x + w * 0.11, lw2 = w * 0.78, ly2 = y + h - frontH * 0.80, lh = frontH * 0.56;
      ink(ctx, rectPts(lx, ly2, lw2, lh, w * 0.02, w * 0.005, s + 20),
          '#fdf6e6', { lw: lw * 0.7, off: w * 0.004, line: '#8a7259', seed: s + 20 });
      var lpad = 0.08, rpad = 0.08;
      if (opts.tint && w >= 62) {
        lpad = 0.28;
        var dot = Math.min(lh * 0.34, w * 0.06);
        ink(ctx, ellPts(lx + lw2 * 0.14, ly2 + lh * 0.52, dot, dot, 10, w * 0.003, s + 21),
            opts.tint, { lw: lw * 0.55, line: '#5a4030', lineAlpha: 0.7, seed: s + 21 });
      }
      // anything that has to be grilled first wears a little flame
      if (opts.hot && w >= 62) {
        rpad = 0.24;
        var fx = lx + lw2 * 0.88, fy = ly2 + lh * 0.52, fh = lh * 0.62, fw = lh * 0.40;
        ink(ctx, jitter([[fx, fy - fh * 0.52], [fx + fw * 0.5, fy], [fx, fy + fh * 0.48],
                         [fx - fw * 0.5, fy]], w * 0.004, s + 22),
            '#e2704f', { lw: lw * 0.55, line: '#8a3a1c', seed: s + 22 });
      }
      var tx = lx + lw2 * (lpad + (1 - lpad - rpad) * 0.5);
      var room = lw2 * (1 - lpad - rpad);
      var txt = String(opts.name).toUpperCase();
      // Hand-lettered like every other label in the game. Same fit logic as
      // before: shrink first, and only squeeze horizontally when a long name
      // has nowhere left to go (JALAPENO on a 54px crate).
      var cap = Math.max(4.6, Math.min(lh * 0.46, w * 0.108));
      for (i = 0; i < 6; i++) {
        if (penTextWidth(txt, cap, 0.07) <= room || cap <= 4.6) break;
        cap *= 0.9;
      }
      var tw = penTextWidth(txt, cap, 0.07);
      ctx.save();
      if (tw > room) {
        ctx.translate(tx, 0);
        ctx.scale(room / tw, 1);
        ctx.translate(-tx, 0);
      }
      penLetters(ctx, txt, tx, ly2 + lh * 0.56 + cap * 0.44, cap, {
        fill: '#5a4030', weight: 0.145, track: 0.07, seed: s + 25, tilt: 0.05, wobble: 0.028
      });
      ctx.restore();
    }

    // targeted: a second pass of the pen round the box, not a neon glow
    if (opts.live) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#f0a81e';
      ctx.lineWidth = lw * 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      trace(ctx, rectPts(x + w * 0.005 - w * 0.012, y - w * 0.012, w * 0.99 + w * 0.024,
                         h + w * 0.024, w * 0.06, w * 0.008, s + 30));
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = lw * 0.9;
      trace(ctx, rectPts(x + w * 0.02, y + w * 0.006, w * 0.96, h - w * 0.01, w * 0.05, w * 0.008, s + 31));
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
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

  /* A plate seen from above.
   *
   * The burger used to look pasted onto a flat white disc because nothing
   * connected the two: no liner under it, no shadow where it touches, and the
   * food sat on the plate's centre line rather than in the WELL, which on a
   * plate seen at this angle is a little forward of centre.
   *
   * opts.food  0 = empty plate, 1 = something is sitting on it (draws the deli
   *            paper and the contact shadow; pass the burger's own width as
   *            opts.foodW so the shadow matches what it is under)
   * Art.scene.plateSeat(cx, cy, w) returns the {x, y} a burger should be drawn
   * at so it lands in the well instead of floating on the rim.
   */
  function plateSeat(cx, cy, w) {
    return { x: cx, y: cy + w * 0.030 };
  }

  function drawPlate(ctx, cx, cy, w, opts) {
    var s = 673, r = w / 2, lw = Math.max(1, w * 0.018), i;
    var glow = (opts && opts.glow) || 0;
    var food = (opts && opts.food) || 0;
    var fw = (opts && opts.foodW) || w * 0.52;
    var seat = plateSeat(cx, cy, w);

    if (glow > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.35 * glow;
      ctx.fillStyle = '#f4b41a';
      trace(ctx, ellPts(cx, cy, r * 1.22, r * 0.52, 20, w * 0.006, s + 9));
      ctx.fill();
      ctx.restore();
    }

    // the plate's own shadow on the counter, so it is resting rather than floating
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#3f2a1c';
    trace(ctx, ellPts(cx + w * 0.03, cy + r * 0.20, r * 0.98, r * 0.34, 20, w * 0.006, s + 12));
    ctx.fill();
    ctx.restore();

    ink(ctx, ellPts(cx, cy, r, r * 0.40, 24, w * 0.008, s), '#f4f8fb',
        { lw: lw, off: w * 0.006, line: '#8fa3ae', seed: s });
    ink(ctx, ellPts(cx, cy, r * 0.70, r * 0.27, 20, w * 0.006, s + 1), '#e6eef5',
        { lw: lw * 0.7, line: '#8fa3ae', lineAlpha: 0.7, seed: s + 1 });

    if (food > 0.02) {
      // square of deli paper, laid in the well at a lazy angle and clipped to
      // the well so it can never climb over the rim
      ctx.save();
      trace(ctx, ellPts(cx, cy, r * 0.72, r * 0.28, 20, w * 0.005, s + 1));
      ctx.clip();
      ctx.globalAlpha = food;
      ctx.translate(seat.x, seat.y);
      ctx.rotate(-0.16);
      ctx.scale(1, 0.42);
      var pw = fw * 0.42;
      var paper = jitter([[-pw, -pw], [pw, -pw * 0.94], [pw * 0.96, pw], [-pw * 0.98, pw * 0.96]], pw * 0.05, s + 20);
      ink(ctx, paper, '#fdf6e6', { lw: lw * 0.8, off: pw * 0.02, line: '#c9b98d', lineAlpha: 0.8, seed: s + 20 });
      ctx.save();
      trace(ctx, paper);
      ctx.clip();
      ctx.strokeStyle = '#e08e8a';
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = Math.max(1, pw * 0.07);
      for (i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * pw * 0.42, -pw * 1.1);
        ctx.lineTo(i * pw * 0.42, pw * 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-pw * 1.1, i * pw * 0.42);
        ctx.lineTo(pw * 1.1, i * pw * 0.42);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();

      // contact shadow: dark and tight where the food meets the paper
      ctx.save();
      ctx.globalAlpha = 0.30 * food;
      ctx.fillStyle = '#5f4230';
      trace(ctx, ellPts(seat.x + fw * 0.04, seat.y + fw * 0.02, fw * 0.44, fw * 0.11, 18, w * 0.004, s + 22));
      ctx.fill();
      ctx.globalAlpha = 0.14 * food;
      trace(ctx, ellPts(seat.x + fw * 0.06, seat.y + fw * 0.03, fw * 0.58, fw * 0.17, 18, w * 0.004, s + 23));
      ctx.fill();
      ctx.restore();
    }

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

  /**
   * The bin by the hatch. A tapered galvanised can with a rolled rim, two side
   * handles and a bag lining folded over the front lip; the lid is hinged at
   * the back and swings up when `open` goes to 1.
   *
   * Proportions are its own, not the box's: the slot the room gives it is wide
   * and short (52x46), and stretching a drum to fill that produced a squat
   * bulging pot that read as a cauldron. It now sizes itself off whichever of
   * the two is tighter and stands centred on the floor of its slot.
   */
  function drawBin(ctx, x, y, w, h, opts) {
    var s = 691, i, c;
    var open = (opts && opts.open) || 0;
    var cx = x + w * 0.5;
    var botY = y + h * 0.95;
    var bw = Math.min(w * 0.66, h * 0.70);          // width at the rim
    var bh = Math.min(h * 0.64, bw * 1.34);          // drum height - taller than wide
    var topY = botY - bh;
    var botW = bw * 0.82;                            // the taper
    var lw = Math.max(1, bw * 0.042);

    // scribbled contact shadow, the same three strokes everything else stands on
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = bh * 0.055;
      var sw = botW * 0.62 * (1 - i * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - sw, botY + i * bh * 0.035);
      ctx.quadraticCurveTo(cx, botY + i * bh * 0.035 + bh * 0.02, cx + sw, botY + i * bh * 0.035);
      ctx.stroke();
    }
    ctx.restore();

    // handles, behind the drum so only the loops show past its sides
    ctx.save();
    ctx.strokeStyle = '#5b737f';
    ctx.lineWidth = Math.max(1.2, bw * 0.055);
    ctx.lineCap = 'round';
    [-1, 1].forEach(function (d) {
      ctx.beginPath();
      ctx.arc(cx + d * bw * 0.46, topY + bh * 0.26, bw * 0.11,
              d > 0 ? -Math.PI * 0.55 : Math.PI * 0.45, d > 0 ? Math.PI * 0.55 : Math.PI * 1.55);
      ctx.stroke();
    });
    ctx.restore();

    // The lid is HINGED on the near-left of the rim and only ever rotates about
    // that point - it is never translated. Lifting it clear left it hanging in
    // the air with nothing holding it up, which is the thing that looked wrong
    // about the old bin in the first place. When it is open it is also drawn
    // BEFORE the rim, so the rim overlaps its lower edge: that overlap is what
    // says "still attached" rather than "resting above".
    var hx = cx - bw * 0.46, hy = topY - bh * 0.020;
    var lidY = topY - bh * 0.055;
    // Work out the widest swing this slot has headroom for ONCE, then take a
    // fraction of it. Clamping the angle itself made the lid stop moving at
    // open 0.4 and sit there for the rest of the animation.
    var probe = [[cx + bw * 0.56, lidY - bh * 0.09], [cx, lidY - bh * 0.085 - bw * 0.12],
                 [cx - bw * 0.56, lidY - bh * 0.09]];
    var swing = 1.0;
    while (swing > 0.05) {
      var top = 1e9;
      for (i = 0; i < probe.length; i++) {
        var px = probe[i][0] - hx, py = probe[i][1] - hy;
        top = Math.min(top, hy - px * Math.sin(swing) + py * Math.cos(swing));
      }
      if (top >= y + lw) break;
      swing *= 0.88;
    }
    var ang = -open * swing;

    function paintLid() {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ang);
      ctx.translate(-hx, -hy);
      ink(ctx, ellPts(cx, lidY, bw * 0.56, bh * 0.090, 22, bw * 0.009, s + 3),
          '#c2d3dc', { lw: lw, off: bw * 0.008, line: '#33454e', seed: s + 3 });
      ink(ctx, ellPts(cx, lidY - bh * 0.045, bw * 0.30, bh * 0.050, 18, bw * 0.007, s + 9),
          '#aebfc9', { lw: lw * 0.8, line: '#33454e', lineAlpha: 0.7, seed: s + 9 });
      ctx.strokeStyle = '#5b737f';
      ctx.lineWidth = Math.max(1.2, bw * 0.048);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, lidY - bh * 0.085, bw * 0.11, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.restore();
    }

    // the drum: a tapered barrel with slightly bowed sides
    var body = jitter([[cx - bw * 0.50, topY],
                       [cx - bw * 0.49, topY + bh * 0.50],
                       [cx - botW * 0.50, botY],
                       [cx, botY + bh * 0.035],
                       [cx + botW * 0.50, botY],
                       [cx + bw * 0.49, topY + bh * 0.50],
                       [cx + bw * 0.50, topY]], bw * 0.012, s);
    ink(ctx, body, '#93a7b2', { lw: lw, off: bw * 0.012, line: '#33454e', seed: s });
    hatch(ctx, body, '#33454e', s, { n: 5, alpha: 0.16, gap: bh * 0.13 });
    ctx.save();
    trace(ctx, body);
    ctx.clip();
    // two hoop bands, bowed so they wrap the drum instead of ruling across it
    ctx.strokeStyle = '#5b737f';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, bw * 0.050);
    ctx.lineCap = 'round';
    [0.36, 0.72].forEach(function (f, k) {
      var by = topY + bh * f;
      ctx.beginPath();
      for (c = 0; c <= 10; c++) {
        var t = c / 10;
        ctx.lineTo(cx - bw * 0.55 + bw * 1.10 * t, by + Math.sin(t * Math.PI) * bh * 0.045);
      }
      ctx.stroke();
    });
    // a couple of vertical seams, not a whole grid of them
    ctx.globalAlpha = 0.30;
    ctx.lineWidth = Math.max(0.9, bw * 0.030);
    [-0.22, 0.20].forEach(function (f, k) {
      ctx.beginPath();
      ctx.moveTo(cx + bw * f, topY + bh * 0.10);
      ctx.lineTo(cx + bw * f * 0.86, botY - bh * 0.04);
      ctx.stroke();
    });
    ctx.restore();

    // The mouth has to be a hole you can see into, or the bin reads as a closed
    // pot however far the lid is up: rolled rim as a ring, dark opening inside
    // it, and the bag folded over the FRONT lip only so it never covers the
    // hole. Order: rim, mouth, wrapper in the mouth, then the fold over the lip.
    if (open > 0.02) paintLid();
    ink(ctx, ellPts(cx, topY, bw * 0.53, bh * 0.105, 22, bw * 0.009, s + 2),
        '#aebfc9', { lw: lw, off: bw * 0.008, line: '#33454e', seed: s + 2 });
    // the hinge the lid actually turns on
    ink(ctx, rectPts(hx - bw * 0.055, hy - bh * 0.028, bw * 0.11, bh * 0.055, bh * 0.020, bw * 0.005, s + 30),
        '#5b737f', { lw: lw * 0.6, line: '#33454e', seed: s + 30 });

    if (open > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, open * 4);
      ink(ctx, ellPts(cx, topY + bh * 0.014, bw * 0.42, bh * 0.078, 20, bw * 0.008, s + 7),
          '#2b3a42', { lw: lw * 0.75, line: '#17222a', seed: s + 7 });
      // one wrapper poking out, so it reads as a bin in use rather than a churn
      ink(ctx, blobPts(cx + bw * 0.18, topY - bh * 0.030, bw * 0.15, bh * 0.070, 5, 0.26, 1.2, 18, bw * 0.010, s + 24),
          '#fdf6e6', { lw: lw * 0.7, line: '#a8907a', seed: s + 24 });
      ctx.save();
      ctx.strokeStyle = '#c0562f';
      ctx.globalAlpha = 0.8 * Math.min(1, open * 4);
      ctx.lineWidth = Math.max(0.9, bw * 0.030);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + bw * 0.13, topY - bh * 0.040);
      ctx.lineTo(cx + bw * 0.24, topY - bh * 0.018);
      ctx.stroke();
      ctx.restore();
      // the bag, folded over the near lip in three soft scallops
      for (i = 0; i < 3; i++) {
        var a = Math.PI * (0.22 + i * 0.28);
        ink(ctx, blobPts(cx + Math.cos(a) * bw * 0.40, topY + Math.sin(a) * bh * 0.085 + bh * 0.020,
                         bw * 0.13, bh * 0.045, 4, 0.20, i * 1.3, 16, bw * 0.008, s + 20 + i),
            '#dfe6ea', { lw: lw * 0.6, line: '#6b7f88', lineAlpha: 0.85, seed: s + 20 + i });
      }
      ctx.restore();
    }

    // the lid: flat on the rim when shut, tipped up and back when open
    if (open <= 0.02) paintLid();
  }

  /* ------------------------------------------------------------ pen font
   * A one-stroke alphabet, written out as centre lines rather than outlines, so
   * every letter is DRAWN by the same pen as the food instead of set in a
   * typeface. Each glyph lives in a box 1 unit tall (0 = cap line, 1 = the
   * baseline) and `adv` units wide; strokes are polylines through that box.
   *
   * Why bother: the wordmark was Trebuchet with a per-letter tilt, and a
   * tilted typeface still reads as a typeface. Hand-set centre lines wobble at
   * the joints, vary in weight, and close their bowls imperfectly - which is
   * what makes lettering look lettered.
   */
  var PEN_SRC = {
    'A': [0.66, '0.03,1 0.33,0.02 0.63,1|0.14,0.66 0.52,0.65'],
    'B': [0.62, '0.09,0.02 0.09,0.99|0.09,0.03 0.38,0.05 0.47,0.21 0.42,0.42 0.09,0.48|0.09,0.48 0.45,0.51 0.55,0.72 0.46,0.96 0.09,0.99'],
    'C': [0.62, '0.57,0.17 0.44,0.04 0.23,0.05 0.09,0.24 0.07,0.6 0.15,0.9 0.35,1 0.57,0.89'],
    'D': [0.64, '0.09,0.02 0.09,0.99|0.09,0.03 0.37,0.07 0.53,0.29 0.53,0.72 0.36,0.96 0.09,0.99'],
    'E': [0.58, '0.1,0.03 0.1,0.99|0.1,0.04 0.52,0.02|0.1,0.5 0.43,0.49|0.1,0.98 0.54,1'],
    'F': [0.56, '0.1,0.02 0.1,1|0.1,0.04 0.52,0.02|0.1,0.5 0.41,0.49'],
    'G': [0.66, '0.58,0.19 0.43,0.04 0.22,0.06 0.08,0.25 0.07,0.62 0.16,0.92 0.37,1 0.56,0.9 0.58,0.62|0.58,0.62 0.38,0.6'],
    'H': [0.64, '0.09,0.02 0.09,1|0.55,0.02 0.55,1|0.09,0.52 0.55,0.5'],
    'I': [0.3, '0.15,0.03 0.15,0.99'],
    'J': [0.56, '0.5,0.03 0.5,0.78 0.42,0.97 0.24,1 0.1,0.86'],
    'K': [0.62, '0.1,0.02 0.1,1|0.54,0.03 0.1,0.55|0.23,0.44 0.56,1'],
    'L': [0.54, '0.11,0.02 0.11,0.98|0.11,0.98 0.52,1'],
    'M': [0.8, '0.05,1 0.1,0.03|0.1,0.03 0.4,0.68|0.4,0.68 0.7,0.03|0.7,0.03 0.75,1'],
    'N': [0.68, '0.09,1 0.09,0.03|0.09,0.05 0.57,0.96|0.57,0.97 0.57,0.03'],
    'O': [0.7, '0.35,0.02 0.14,0.16 0.07,0.5 0.14,0.87 0.35,1 0.56,0.86 0.63,0.5 0.55,0.15 0.35,0.02 0.28,0.05'],
    'P': [0.6, '0.1,0.02 0.1,1|0.1,0.03 0.41,0.06 0.51,0.25 0.45,0.47 0.1,0.52'],
    'Q': [0.7, '0.35,0.02 0.14,0.16 0.07,0.5 0.14,0.87 0.35,1 0.56,0.86 0.63,0.5 0.55,0.15 0.35,0.02 0.28,0.05|0.42,0.76 0.66,1.09'],
    'R': [0.64, '0.1,0.02 0.1,1|0.1,0.03 0.41,0.06 0.51,0.25 0.43,0.47 0.1,0.51|0.27,0.51 0.58,1'],
    'S': [0.6, '0.55,0.15 0.37,0.03 0.17,0.08 0.13,0.27 0.31,0.45 0.49,0.57 0.53,0.81 0.37,0.99 0.15,0.94 0.07,0.82'],
    'T': [0.6, '0.04,0.04 0.56,0.02|0.3,0.03 0.3,1'],
    'U': [0.64, '0.09,0.03 0.09,0.74 0.21,0.97 0.42,0.98 0.54,0.76 0.54,0.02'],
    'V': [0.64, '0.05,0.03 0.32,1 0.6,0.02'],
    'W': [0.86, '0.03,0.03 0.18,1|0.18,1 0.42,0.4|0.42,0.4 0.64,1|0.64,1 0.8,0.02'],
    'X': [0.62, '0.06,0.03 0.56,1|0.56,0.03 0.06,1'],
    'Y': [0.62, '0.05,0.03 0.31,0.53 0.57,0.02|0.31,0.53 0.31,1'],
    'Z': [0.6, '0.06,0.05 0.55,0.03|0.55,0.03 0.08,0.97|0.08,0.97 0.57,1'],
    '0': [0.62, '0.31,0.03 0.12,0.18 0.07,0.52 0.14,0.88 0.31,1 0.49,0.87 0.55,0.5 0.48,0.16 0.31,0.03'],
    '1': [0.44, '0.08,0.19 0.28,0.03 0.28,1|0.12,1 0.45,0.99'],
    '2': [0.58, '0.08,0.21 0.21,0.05 0.43,0.07 0.51,0.26 0.36,0.51 0.1,0.98 0.55,0.96'],
    '3': [0.58, '0.1,0.11 0.35,0.03 0.51,0.17 0.41,0.44 0.21,0.47|0.41,0.44 0.55,0.66 0.47,0.93 0.22,0.99 0.08,0.88'],
    '4': [0.6, '0.43,0.03 0.06,0.71 0.57,0.7|0.43,0.03 0.43,1'],
    '5': [0.58, '0.51,0.04 0.15,0.05 0.13,0.45 0.35,0.42 0.53,0.57 0.51,0.84 0.31,0.99 0.1,0.92'],
    '6': [0.6, '0.51,0.06 0.27,0.07 0.11,0.35 0.09,0.72 0.21,0.96 0.41,0.98 0.55,0.79 0.47,0.56 0.23,0.53 0.11,0.67'],
    '7': [0.56, '0.06,0.05 0.55,0.04 0.28,1'],
    '8': [0.6, '0.32,0.04 0.15,0.15 0.17,0.36 0.33,0.48 0.5,0.6 0.5,0.86 0.32,0.99 0.14,0.86 0.16,0.61 0.33,0.48 0.48,0.36 0.5,0.15 0.32,0.04'],
    '9': [0.6, '0.14,0.95 0.37,0.96 0.53,0.7 0.55,0.31 0.43,0.06 0.23,0.05 0.11,0.21 0.17,0.43 0.41,0.47 0.53,0.35'],
    '$': [0.62, '0.34,-0.08 0.34,1.08|0.55,0.16 0.38,0.05 0.18,0.1 0.14,0.28 0.32,0.45 0.5,0.57 0.54,0.8 0.38,0.97 0.16,0.92 0.08,0.8'],
    '.': [0.28, '0.11,0.96 0.17,0.97'],
    ',': [0.28, '0.16,0.9 0.09,1.13'],
    ':': [0.28, '0.12,0.36 0.18,0.37|0.12,0.94 0.18,0.95'],
    '\u00b7': [0.32, '0.12,0.55 0.19,0.56'],
    '-': [0.46, '0.06,0.56 0.4,0.55'],
    '\u2014': [0.9, '0.05,0.56 0.85,0.54'],
    '/': [0.5, '0.05,1 0.45,0.02'],
    '!': [0.28, '0.15,0.03 0.14,0.68|0.13,0.95 0.19,0.96'],
    '?': [0.54, '0.08,0.19 0.23,0.03 0.43,0.09 0.45,0.29 0.28,0.45 0.26,0.63|0.24,0.95 0.3,0.96'],
    '+': [0.5, '0.07,0.55 0.43,0.54|0.25,0.36 0.25,0.73'],
    '%': [0.74, '0.14,0.04 0.06,0.14 0.13,0.24 0.21,0.15 0.14,0.04|0.6,0.98 0.68,0.87 0.61,0.76 0.53,0.87 0.6,0.98|0.66,0.05 0.09,1'],
    '(': [0.34, '0.26,0.0 0.11,0.3 0.11,0.72 0.26,1.02'],
    ')': [0.34, '0.08,0.0 0.23,0.3 0.23,0.72 0.08,1.02'],
    '\'': [0.24, '0.13,0.03 0.1,0.24'],
    '&': [0.7, '0.62,1 0.24,0.55 0.14,0.34 0.22,0.1 0.42,0.08 0.47,0.26 0.3,0.48 0.11,0.68 0.14,0.9 0.34,1 0.55,0.86'],
    // The typographic quotes, because copy gets written with them and a
    // missing glyph is silently dropped - COOK'S came out COOKS with no
    // warning anywhere. Same stroke as the typewriter pair.
    '’': [0.24, '0.13,0.03 0.1,0.24'],
    '‘': [0.24, '0.1,0.03 0.13,0.24'],
    '…': [0.82, '0.1,0.95 0.16,0.96|0.36,0.95 0.42,0.96|0.62,0.95 0.68,0.96'],
    ' ': [0.34, '']
  };
  var PEN_CACHE = {};
  function penGlyph(ch) {
    if (PEN_CACHE[ch]) return PEN_CACHE[ch];
    var src = PEN_SRC[ch];
    if (!src) return null;
    var strokes = src[1] ? src[1].split('|').map(function (sk) {
      return sk.split(' ').map(function (p) {
        var xy = p.split(',');
        return [parseFloat(xy[0]), parseFloat(xy[1])];
      });
    }) : [];
    PEN_CACHE[ch] = { adv: src[0], strokes: strokes };
    return PEN_CACHE[ch];
  }

  /** Smoothed open polyline - the pen never travels in straight segments. */
  function penPath(ctx, p) {
    ctx.beginPath();
    if (p.length < 3) {
      ctx.moveTo(p[0][0], p[0][1]);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      return;
    }
    ctx.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i][0], p[i][1],
                           (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  }

  /* Lowercase is drawn as small caps: this is signwriting, and a hand-painted
   * shop sign has no lowercase. */
  function penChars(txt) {
    var out = [], i, ch;
    for (i = 0; i < txt.length; i++) {
      ch = txt[i];
      var small = ch >= 'a' && ch <= 'z';
      if (small) ch = ch.toUpperCase();
      out.push({ ch: ch, g: penGlyph(ch), small: small });
    }
    return out;
  }

  function penTextWidth(txt, size, track) {
    var cs = penChars(txt), w = 0;
    track = track === undefined ? 0.055 : track;
    for (var i = 0; i < cs.length; i++) {
      if (!cs[i].g) continue;
      w += (cs[i].g.adv * (cs[i].small ? 0.80 : 1) + (i ? track : 0)) * size;
    }
    return w;
  }

  /**
   * Hand-lettered text.
   *   Art.ui.letters(ctx, 'BURGER', cx, baselineY, capHeight, {
   *     fill, line, weight, track, align, seed, tilt, wobble
   *   })
   * `fill` is the pen colour; `line` (optional) is a heavier stroke under it,
   * which is how the display sizes get their inked edge. Returns the width.
   */
  function penLetters(ctx, txt, cx, baseY, size, o) {
    o = o || {};
    var track = o.track === undefined ? 0.055 : o.track;
    var seed = o.seed || 0, i, k;
    var weight = (o.weight === undefined ? 0.105 : o.weight) * size;
    var jit = (o.wobble === undefined ? 0.022 : o.wobble) * size;
    var tilt = o.tilt === undefined ? 0.035 : o.tilt;
    var cs = penChars(txt);
    var total = penTextWidth(txt, size, track);
    var x = o.align === 'left' ? cx : o.align === 'right' ? cx - total : cx - total / 2;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i < cs.length; i++) {
      var g = cs[i].g;
      if (!g) continue;
      var sc = cs[i].small ? 0.80 : 1;
      var gw = g.adv * sc * size;
      if (g.strokes.length) {
        ctx.save();
        ctx.translate(x + gw / 2, baseY + wob(seed + i, 1) * size * 0.035);
        ctx.rotate(wob(seed + i, 2) * tilt);
        ctx.translate(-(x + gw / 2), -baseY);
        for (k = 0; k < g.strokes.length; k++) {
          var src = g.strokes[k], p = [];
          for (var j = 0; j < src.length; j++) {
            p.push([x + src[j][0] * sc * size, baseY - size * sc * (1 - src[j][1])]);
          }
          jitter(p, jit, seed + i * 7 + k);
          if (o.line) {
            ctx.strokeStyle = o.line;
            ctx.lineWidth = weight * sc * 2.05;
            penPath(ctx, p);
            ctx.stroke();
          }
          ctx.strokeStyle = o.fill || INK;
          ctx.lineWidth = weight * sc * (1 + wob(seed + i, 3 + k) * 0.18);
          penPath(ctx, p);
          ctx.stroke();
        }
        ctx.restore();
      }
      x += gw + track * size;
    }
    ctx.restore();
    return total;
  }

  /* ------------------------------------------------------------------ HUD
   * The status bar reads as a strip of paper taped over the top of the screen,
   * hand-lettered in the same pen as the food: the day and the clock written
   * on it, the takings drawn as a hatched thermometer, tips as a row of ticks,
   * and lives as five little inked hearts.
   *
   * The old bar was a dark rounded plate with CSS gradients, a candy-striped
   * fill and glossy inner highlights - the one thing left on screen that came
   * from a different game. Everything here is drawn with wobble, offset colour
   * and hatching, so it belongs to the kitchen behind it.
   */

  /** A small inked heart. `on` false leaves it as an empty outline. */
  function drawHeart(ctx, cx, cy, r, on, seed) {
    var p = [], i, t;
    for (i = 0; i <= 30; i++) {
      t = i / 30 * TAU;
      var sx = Math.pow(Math.sin(t), 3);
      var sy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      p.push([cx + sx * r * 1.00, cy - sy * r * 0.077]);
    }
    p = jitter(p, r * 0.06, seed);
    if (on) {
      ink(ctx, p, '#d94436', { lw: Math.max(0.9, r * 0.20), off: r * 0.09, line: '#7a1a16', seed: seed });
      hatch(ctx, p, '#7a1a16', seed, { n: 3, alpha: 0.18, gap: r * 0.60 });
    } else {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#a08a6e';
      ctx.lineWidth = Math.max(0.9, r * 0.17);
      ctx.lineJoin = 'round';
      trace(ctx, p);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Art.ui.hud(ctx, x, y, w, h, {
   *   day, time,            '4', '1:48'
   *   earned, goal,         numbers - written as $18.40 / $26.00
   *   pct,                  0..1 takings against the goal (defaults to earned/goal)
   *   tip,                  0..1 tip meter
   *   lives, maxLives,      hearts
   *   urgent,               true under a minute - the clock goes red and underlined
   *   paused                the pause square reads as two bars either way
   * })
   * Draws its own paper, so the host only needs to clear the strip behind it.
   */
  /**
   * The one thing on the HUD you can press.
   *   Art.ui.hudBoxes(x, y, w, h) -> { pause: {x,y,w,h} }
   * Same contract as titleBoxes: drawHUD reads it too, so the drawn square and
   * the tap target are the same square.
   */
  function hudBoxes(x, y, w, h) {
    var pad = h * 0.13, px = x + pad, pw = w - pad * 2, ph = h - pad * 2;
    var bs = ph * 0.52;
    return { pause: { x: px + pw * 0.028, y: y + h / 2 - bs / 2, w: bs, h: bs } };
  }

  function drawHUD(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 1471, i;
    var lives = o.lives === undefined ? 3 : o.lives;
    var maxL = o.maxLives || 5;
    var goal = o.goal === undefined ? 26 : o.goal;
    var earned = o.earned === undefined ? 0 : o.earned;
    var pct = o.pct === undefined ? (goal ? earned / goal : 0) : o.pct;
    pct = Math.max(0, Math.min(1, pct));
    var lw = Math.max(1, h * 0.030);

    // the paper, tilted a hair off level like everything else pinned up here
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-0.004);
    ctx.translate(-(x + w / 2), -(y + h / 2));

    var pad = h * 0.13;
    var px = x + pad, py = y + pad, pw = w - pad * 2, ph = h - pad * 2;
    var paper = rectPts(px, py, pw, ph, h * 0.06, w * 0.0035, s);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = INK;
    trace(ctx, rectPts(px + pad * 0.4, py + pad * 0.55, pw, ph, h * 0.06, w * 0.003, s + 1));
    ctx.fill();
    ctx.restore();
    ink(ctx, paper, '#fdf6e6', { lw: lw, off: w * 0.0025, line: '#8a7259', seed: s });
    hatch(ctx, paper, '#c4ab8a', s, { n: 4, alpha: 0.10, gap: ph * 0.42 });

    // two bits of tape holding it to the top of the screen - the rotated
    // corners have to clear y, so the strip is shorter than the padding
    [[px + pw * 0.10, -0.16], [px + pw * 0.90, 0.13]].forEach(function (t, k) {
      var th = pad * 0.62, tw = w * 0.045;
      ctx.save();
      ctx.translate(t[0], py + th * 0.20);
      ctx.rotate(t[1]);
      ctx.globalAlpha = 0.62;
      ink(ctx, rectPts(-tw, -th, tw * 2, th * 2, h * 0.012, w * 0.002, s + 5 + k),
          '#e8d5b8', { lw: lw * 0.55, line: '#a8907a', lineAlpha: 0.8, seed: s + 5 + k });
      ctx.restore();
    });

    // pause: a hand-drawn square with two bars, not a chrome button
    var pb = hudBoxes(x, y, w, h).pause;
    var bs = pb.w, bx = pb.x, by = pb.y;
    ink(ctx, rectPts(bx, by, bs, bs, bs * 0.20, bs * 0.035, s + 8),
        '#4a3226', { lw: lw * 0.9, off: bs * 0.030, line: '#2a1a12', seed: s + 8 });
    ctx.save();
    ctx.strokeStyle = '#fdf6e6';
    ctx.lineWidth = Math.max(1.2, bs * 0.13);
    ctx.lineCap = 'round';
    [-0.16, 0.16].forEach(function (d, k) {
      ctx.beginPath();
      ctx.moveTo(bx + bs * (0.5 + d) + wob(s + k, 0) * bs * 0.03, by + bs * 0.26);
      ctx.lineTo(bx + bs * (0.5 + d) + wob(s + k, 1) * bs * 0.03, by + bs * 0.74);
      ctx.stroke();
    });
    ctx.restore();

    // hearts, right-hand end, one row of five
    var hr = ph * 0.105, hgap = hr * 2.5;
    var hRight = px + pw * 0.972, hLeft = hRight - hgap * (maxL - 1) - hr;
    for (i = 0; i < maxL; i++) {
      drawHeart(ctx, hLeft + hr + i * hgap, y + h * 0.315, hr, i < lives, s + 40 + i);
    }

    var cx0 = bx + bs + pw * 0.032;             // left edge of the writing
    var cx1 = px + pw * 0.972;                  // right edge

    // Top line: DAY 4 · the clock · takings. Laid out by measuring, not by
    // fractions - '$120.50 / $150.00' on a 220px bar used to run straight
    // through the clock.
    var ty = y + h * 0.375;
    var daySize = ph * 0.145, numSize = ph * 0.215, clockSize = ph * 0.225;
    var dw = penTextWidth('DAY', daySize, 0.13);
    var dayTxt = String(o.day === undefined ? 1 : o.day);
    var dayEnd = cx0 + dw + ph * 0.09 + penTextWidth(dayTxt, numSize, 0.06);
    penLetters(ctx, 'DAY', cx0, ty, daySize, { fill: '#a08a6e', weight: 0.13, track: 0.13, align: 'left', seed: s + 11 });
    penLetters(ctx, dayTxt, cx0 + dw + ph * 0.09, ty + ph * 0.012, numSize, { fill: '#4a3226', line: '#8a7259', weight: 0.13, track: 0.06, align: 'left', seed: s + 12 });

    var clock = o.time === undefined ? '2:00' : o.time;
    var clockX = dayEnd + ph * 0.16;
    var clockW = penTextWidth(clock, clockSize, 0.07);
    penLetters(ctx, clock, clockX, ty + ph * 0.010, clockSize, {
      fill: o.urgent ? '#c0392b' : '#3f2a1c', weight: 0.135, track: 0.07, align: 'left', seed: s + 13
    });
    if (o.urgent) {
      ctx.save();
      ctx.strokeStyle = '#c0392b';
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = lw * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (i = 0; i <= 8; i++) {
        ctx.lineTo(clockX + clockW * i / 8, ty + ph * 0.115 + wob(s + 14, i) * ph * 0.02);
      }
      ctx.stroke();
      ctx.restore();
    }

    // takings: the longest wording that still fits between clock and hearts
    var moneyRight = hLeft - ph * 0.16;
    var room = moneyRight - (clockX + clockW + ph * 0.16);
    var forms = ['$' + earned.toFixed(2) + ' / $' + goal.toFixed(2),
                 '$' + earned.toFixed(2) + '/$' + goal.toFixed(2),
                 '$' + Math.round(earned) + '/$' + Math.round(goal),
                 Math.round(earned) + '/' + Math.round(goal)];
    var mSize = ph * 0.150, money = forms[0], fi = 0;
    while (penTextWidth(money, mSize, 0.06) > room) {
      if (fi < forms.length - 1) money = forms[++fi];
      else if (mSize > ph * 0.10) mSize *= 0.92;
      else break;
    }
    penLetters(ctx, money, moneyRight, ty, mSize, {
      fill: '#7d6249', weight: 0.125, track: 0.06, align: 'right', seed: s + 15
    });

    // takings thermometer: hatched fill with a torn leading edge
    var barY = y + h * 0.52, barH = ph * 0.20;
    var barW = cx1 - cx0;
    var track = rectPts(cx0, barY, barW, barH, barH * 0.42, barH * 0.06, s + 20);
    ink(ctx, track, '#efe3cc', { lw: lw * 0.85, off: 0, line: '#8a7259', seed: s + 20 });
    if (pct > 0.008) {
      ctx.save();
      trace(ctx, track);
      ctx.clip();
      var fill = rectPts(cx0, barY, Math.max(barH, barW * pct), barH, barH * 0.42, barH * 0.07, s + 21);
      ink(ctx, fill, '#f0b429', { lw: lw * 0.8, off: barH * 0.05, line: '#a8701a', seed: s + 21 });
      hatch(ctx, fill, '#a8701a', s + 21, { n: 7, alpha: 0.26, gap: barH * 0.80 });
      ctx.restore();
    }
    // quarter ticks over the top edge, hand-ruled
    ctx.save();
    ctx.strokeStyle = '#8a7259';
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(0.8, lw * 0.7);
    ctx.lineCap = 'round';
    [0.25, 0.5, 0.75].forEach(function (f, k) {
      var tx2 = cx0 + barW * f;
      ctx.beginPath();
      ctx.moveTo(tx2 + wob(s + 22, k) * barH * 0.10, barY - barH * 0.30);
      ctx.lineTo(tx2 + wob(s + 23, k) * barH * 0.10, barY + barH * 0.14);
      ctx.stroke();
    });
    ctx.restore();

    // tips: a label, then a row of dashes inked in as they fill
    var tipY = barY + barH * 1.70;
    var tipLabelW = penTextWidth('TIPS', ph * 0.105, 0.16);
    penLetters(ctx, 'TIPS', cx0, tipY + barH * 0.22, ph * 0.105, {
      fill: '#a08a6e', weight: 0.13, track: 0.16, align: 'left', seed: s + 32
    });
    var dashX = cx0 + tipLabelW + ph * 0.10, dashW = cx1 - dashX;
    var n = 12, tipOn = Math.round((o.tip || 0) * n);
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < n; i++) {
      var dx = dashX + (dashW / n) * (i + 0.14), dw2 = (dashW / n) * 0.62;
      ctx.strokeStyle = i < tipOn ? '#4f9d76' : '#c4ab8a';
      ctx.globalAlpha = i < tipOn ? 0.95 : 0.40;
      ctx.lineWidth = Math.max(1, barH * (i < tipOn ? 0.34 : 0.22));
      ctx.beginPath();
      ctx.moveTo(dx, tipY + wob(s + 30, i) * barH * 0.10);
      ctx.lineTo(dx + dw2, tipY + wob(s + 31, i) * barH * 0.10);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  /* ---------------------------------------------------------------- title
   * The front page, drawn as a sheet torn out of the shop's own order pad and
   * lettered by hand: every letter set individually with its own tilt, the
   * wordmark hatched inside, the buttons wobbled and shaded with strokes
   * instead of shadows.
   */

  /**
   * Run `paint` into an offscreen layer, then lay hatching over whatever it
   * drew and nothing else - the only way to get pen shading INSIDE letterforms,
   * since canvas cannot clip to text.
   */
  function hatchedLayer(ctx, bx, by, bw, bh, paint, hatchColor, seed, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') { paint(ctx, bx, by); return; }
    var d = Math.ceil(Math.max(1, bw)), e = Math.ceil(Math.max(1, bh));
    var cv = document.createElement('canvas');
    cv.width = d; cv.height = e;
    var g = cv.getContext('2d');
    paint(g, 0, 0);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = opts.alpha === undefined ? 0.24 : opts.alpha;
    g.strokeStyle = hatchColor;
    g.lineWidth = Math.max(1, e * (opts.lw || 0.018));
    g.lineCap = 'round';
    var gap = e * (opts.gap || 0.13);
    for (var k = -e; k < d + e; k += gap) {
      g.beginPath();
      g.moveTo(k + wob(seed, k) * gap * 0.3, e + gap);
      g.lineTo(k + e + gap + wob(seed + 1, k) * gap * 0.3, -gap);
      g.stroke();
    }
    g.restore();
    ctx.drawImage(cv, bx, by);
  }

  /** A torn-edge sheet: straight sides, ragged top and bottom. */
  function tornPts(x, y, w, h, tear, seed) {
    var p = [], n = 13, i, f;
    for (i = 0; i <= n; i++) {
      f = i / n;
      p.push([x + w * f, y + (i % 2 ? tear : 0) + wob(seed, i) * tear * 0.5]);
    }
    for (i = n; i >= 0; i--) {
      f = i / n;
      p.push([x + w * f, y + h - (i % 2 ? tear : 0) + wob(seed + 3, i) * tear * 0.5]);
    }
    return jitter(p, Math.min(w, h) * 0.004, seed);
  }

  /* ------------------------------------------------- paper UI primitives
   * The screens are all the same three moves: a dark room, a sheet of paper
   * clipped to a rail, and things written on the sheet. These are exported so
   * game.js can build the shop, the receipt and the pause card out of the same
   * parts as the title, instead of CSS panels.
   */

  /** The dark diner behind any paper screen, with the line hinted at the foot. */
  function drawScreenBack(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 2401, i;
    ctx.save();
    ctx.fillStyle = '#1b100c';
    ctx.fillRect(x, y, w, h);
    var glow = ctx.createRadialGradient(x + w * 0.5, y + h * 0.06, 0, x + w * 0.5, y + h * 0.06, h * 0.55);
    glow.addColorStop(0, 'rgba(122,62,32,0.55)');
    glow.addColorStop(1, 'rgba(27,16,12,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#000000';
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = Math.max(1, h * 0.004);
    for (i = 0; i < 26; i++) {
      var gy = y + h * (i / 26);
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy + wob(s + i, 2) * h * 0.008);
      ctx.stroke();
    }
    ctx.restore();

    if (o.kitchen !== false) {
      var T = SCENE_THEMES.diner;
      var roomY = y + h * (o.kitchenTop === undefined ? 0.80 : o.kitchenTop);
      var roomH = y + h - roomY;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, roomY, w, roomH);
      ctx.clip();
      drawFloor(ctx, x, roomY + roomH * 0.42, w, roomH * 0.58, T, w / 4.5);
      drawCounter(ctx, x - w * 0.06, roomY + roomH * 0.20, w * 1.12, roomH * 0.34, roomH * 0.12, T);
      drawPlate(ctx, x + w * 0.30, roomY + roomH * 0.30, w * 0.30, { food: 0 });
      drawStack(ctx, ['bun', 'patty', 'cheese', 'bunTop'], x + w * 0.72, roomY + roomH * 0.28, w * 0.16, {});
      ctx.globalAlpha = o.kitchenWash === undefined ? 0.52 : o.kitchenWash;
      ctx.fillStyle = '#1b100c';
      ctx.fillRect(x, roomY, w, roomH);
      ctx.restore();
    }
  }

  /**
   * The wooden rail a sheet hangs from. Returns its bottom edge.
   * `heat` 0..1 reddens the wood - the board's rush hour, drawn rather than
   * painted on the element behind the drawing.
   */
  function drawRail(ctx, x, y, w, h, seed, heat) {
    heat = Math.max(0, Math.min(1, heat || 0));
    ink(ctx, rectPts(x + w * 0.05, y, w * 0.90, h, h * 0.35, w * 0.004, seed),
        mixHex('#8a5a30', '#a3512a', heat),
        { lw: Math.max(1, w * 0.006), off: w * 0.003,
          line: mixHex('#4a2f18', '#6d3116', heat), seed: seed });
    return y + h;
  }

  /** A steel clip over the top edge of a sheet. */
  function drawClip(ctx, cx, y, w, h, seed) {
    ink(ctx, rectPts(cx - w / 2, y, w, h, h * 0.28, w * 0.05, seed),
        '#aebfc9', { lw: Math.max(1, w * 0.05), line: '#33454e', seed: seed });
  }

  /**
   * A sheet of paper: torn top and bottom, pencil rules, a coffee ring.
   * Art.ui.sheet(ctx, x, y, w, h, { rules, ring, seed, tear })
   */
  function drawSheet(ctx, x, y, w, h, o) {
    o = o || {};
    var s = o.seed === undefined ? 3110 : o.seed, i;
    var tear = h * (o.tear === undefined ? 0.012 : o.tear);
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000000';
    trace(ctx, tornPts(x + w * 0.012, y + h * 0.012, w, h, tear, s + 9));
    ctx.fill();
    ctx.restore();
    var sheet = tornPts(x, y, w, h, tear, s);
    ink(ctx, sheet, '#fdf6e6', { lw: Math.max(1.2, w * 0.006), off: w * 0.0025, line: '#8a7259', seed: s });
    ctx.save();
    trace(ctx, sheet);
    ctx.clip();
    if (o.rules !== false) {
      ctx.strokeStyle = '#c4ab8a';
      ctx.globalAlpha = 0.20;
      ctx.lineWidth = Math.max(0.8, w * 0.003);
      var n = o.rules || 16;
      for (i = 1; i < n; i++) {
        var ly = y + h * (i / n);
        ctx.beginPath();
        for (var c = 0; c <= 6; c++) ctx.lineTo(x + w * (c / 6), ly + wob(s + 30 + i, c) * h * 0.004);
        ctx.stroke();
      }
    }
    if (o.ring !== false) {
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#8a5a30';
      ctx.lineWidth = Math.max(1.4, w * 0.008);
      trace(ctx, ellPts(x + w * (o.ringX || 0.86), y + h * (o.ringY || 0.055),
                        w * 0.10, w * 0.085, 18, w * 0.006, s + 40));
      ctx.stroke();
    }
    ctx.restore();
    return sheet;
  }

  /**
   * A button drawn with the pen: wobbled outline, hatched face, and seven short
   * strokes for a shadow. `dashed` gives the quiet secondary version.
   * Art.ui.button(ctx, x, y, w, h, label, { fill, line, text, dashed, seed })
   */
  function drawSketchButton(ctx, bx, by, bw, bh, label, o) {
    o = o || {};
    var seed = o.seed === undefined ? 4210 : o.seed;
    var line = o.line || (o.dashed ? '#a8907a' : '#8a5a12');
    var pts = rectPts(bx, by, bw, bh, bh * 0.16, bw * 0.005, seed);
    ctx.save();
    ctx.strokeStyle = '#3f2a1c';
    ctx.globalAlpha = o.dashed ? 0.28 : 0.55;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, bh * 0.05);
    for (var k = 0; k < 7; k++) {
      var f = 0.10 + k * 0.13;
      ctx.beginPath();
      ctx.moveTo(bx + bw * f + bh * 0.10, by + bh + bh * 0.04);
      ctx.lineTo(bx + bw * f + bh * 0.26, by + bh + bh * 0.24);
      ctx.stroke();
    }
    ctx.restore();
    if (o.dashed) {
      ctx.save();
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1.2, bh * 0.075);
      ctx.lineCap = 'round';
      ctx.setLineDash([bh * 0.30, bh * 0.26]);
      trace(ctx, pts);
      ctx.stroke();
      ctx.restore();
    } else {
      ink(ctx, pts, o.fill || '#f0b429', { lw: Math.max(1.2, bh * 0.075), off: bh * 0.05, line: line, seed: seed });
      hatch(ctx, pts, line, seed, { n: 6, alpha: 0.16, gap: bh * 0.42 });
    }
    penLetters(ctx, label, bx + bw / 2, by + bh * 0.66, bh * (o.size || 0.32), {
      fill: o.text || (o.dashed ? '#5c4432' : '#3f2a08'),
      line: o.dashed ? null : mixHex(line, '#ffffff', 0.20),
      weight: 0.125, track: 0.10, seed: seed + 1, tilt: 0.04
    });
  }

  /** A hand-drawn dashed rule - the receipt's tear lines. */
  function drawRule(ctx, x, y, w, o) {
    o = o || {};
    var seed = o.seed === undefined ? 5310 : o.seed;
    ctx.save();
    ctx.strokeStyle = o.color || '#c4ab8a';
    ctx.globalAlpha = o.alpha === undefined ? 0.8 : o.alpha;
    ctx.lineWidth = o.lw || Math.max(1, w * 0.004);
    ctx.lineCap = 'round';
    var dash = w * 0.022, i = 0;
    for (var px2 = x; px2 < x + w; px2 += dash * 1.8, i++) {
      ctx.beginPath();
      ctx.moveTo(px2, y + wob(seed, i) * dash * 0.30);
      ctx.lineTo(Math.min(px2 + dash, x + w), y + wob(seed + 1, i) * dash * 0.30);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A written line: label on the left, value on the right, dot leaders between.
   * Art.ui.row(ctx, x, y, w, 'Till so far', '$18.40', { size, valueCol, seed })
   */
  function drawRow(ctx, x, y, w, label, value, o) {
    o = o || {};
    var size = o.size || w * 0.055;
    var seed = o.seed === undefined ? 6410 : o.seed;
    var lw2 = penLetters(ctx, label, x, y, size, {
      fill: o.labelCol || '#7d6249', weight: 0.12, track: 0.07, align: 'left', seed: seed
    });
    var vw = value === undefined || value === null ? 0 : penTextWidth(String(value), size * (o.valueSize || 1.06), 0.07);
    if (value !== undefined && value !== null) {
      penLetters(ctx, String(value), x + w, y, size * (o.valueSize || 1.06), {
        fill: o.valueCol || '#3f2a1c', weight: 0.135, track: 0.07, align: 'right', seed: seed + 1
      });
    }
    if (o.leaders !== false) {
      var from = x + lw2 + size * 0.4, to = x + w - vw - size * 0.4;
      if (to > from) {
        ctx.save();
        ctx.fillStyle = '#c4ab8a';
        ctx.globalAlpha = 0.7;
        for (var dx = from, i = 0; dx < to; dx += size * 0.42, i++) {
          ctx.beginPath();
          ctx.arc(dx, y - size * 0.12 + wob(seed + 2, i) * size * 0.06, Math.max(0.6, size * 0.045), 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    return y + size * 1.9;
  }

  /**
   * Art.ui.title(ctx, x, y, w, h, {
   *   day,                    a number turns the primary button into CONTINUE
   *   primary, secondary,     button labels (defaults from `day`)
   *   sub,                    the line under the wordmark
   *   tiles: [{id,label}],    up to three menu tiles along the bottom
   *   tile(ctx,id,x,y,w,h),   callback that draws a tile's glyph
   *   logo(ctx,x,y,w,h)       callback for the burger under the wordmark
   * })
   * Paints the whole screen: the dark diner behind, then the sheet.
   */
  /**
   * Where drawTitle puts everything you can press.
   *   Art.ui.titleBoxes(x, y, w, h, tileCount)
   *     -> { sheet, tilt, primary, secondary, tiles: [ {x,y,w,h}, ... ] }
   * The game hangs its real <button>s on these rects and paints them out, so
   * the slip keeps its hand-drawn buttons without losing focus, keyboard or a
   * screen reader. Both this and drawTitle read the same constants, so the
   * drawing and the touch target cannot drift apart.
   */
  function titleBoxes(x, y, w, h, n) {
    var railY = y + h * 0.055, railH = h * 0.022;
    var pw = w * 0.90, px = x + (w - pw) / 2;
    var py = railY + railH * 0.6, ph = h * 0.735;
    var cx = px + pw / 2, bw = pw * 0.80, bx = cx - bw / 2;
    var out = {
      sheet: { x: px, y: py, w: pw, h: ph },
      tilt: -0.014,
      primary: { x: bx, y: py + ph * 0.475, w: bw, h: ph * 0.095 },
      secondary: { x: bx, y: py + ph * 0.600, w: bw, h: ph * 0.080 },
      tiles: []
    };
    n = n || 0;
    if (n) {
      var gap = pw * 0.045, tw = (bw - gap * (n - 1)) / n;
      var th = ph * 0.165, ty = py + ph * 0.720;
      for (var i = 0; i < n; i++) out.tiles.push({ x: bx + i * (tw + gap), y: ty, w: tw, h: th });
    }
    return out;
  }

  function drawTitle(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 1907, i;
    var day = o.day;

    drawScreenBack(ctx, x, y, w, h, {});

    // the rail the sheet hangs from, and its clip
    var railY = y + h * 0.055, railH = h * 0.022;
    drawRail(ctx, x, railY, w, railH, s + 1);

    // the sheet
    var B = titleBoxes(x, y, w, h, (o.tiles || []).length);
    var pw = B.sheet.w, px = B.sheet.x, py = B.sheet.y, ph = B.sheet.h;
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2);
    ctx.rotate(B.tilt);
    ctx.translate(-(px + pw / 2), -(py + ph / 2));
    drawSheet(ctx, px, py, pw, ph, { seed: s + 2 });

    // the clip, over the top edge of the sheet
    drawClip(ctx, px + pw * 0.50, railY - railH * 0.25, pw * 0.16, railH * 1.7, s + 3);

    var cx = px + pw / 2;

    // MR.
    penLetters(ctx, 'MR.', cx, py + ph * 0.055, ph * 0.032, {
      fill: '#c0562f', line: '#8a3a1c', weight: 0.15, track: 0.50, seed: s + 4, tilt: 0.06
    });

    /*
     * BURGER, hand-lettered and hatched inside the strokes.
     *
     * The wordmark is the one thing on the slip sized off the sheet's width;
     * everything else is written off its height. On a short, wide screen -
     * a desktop window, a tablet on its side - pw * 0.175 alone grew the
     * letters until they swallowed MR. and climbed out over the rail. Cap it
     * against the height too, at the ratio the tall layout already lands on,
     * so the portrait slip is untouched and a wide one just gets a smaller
     * wordmark instead of a broken one.
     */
    var wmSize = Math.min(pw * 0.175, ph * 0.105), wmY = py + ph * 0.200;
    hatchedLayer(ctx, px, wmY - wmSize * 1.35, pw, wmSize * 1.70, function (g) {
      penLetters(g, 'BURGER', pw / 2, wmSize * 1.35, wmSize, {
        fill: '#f0b429', line: '#3f2a1c', weight: 0.150, track: 0.085, seed: s + 5, tilt: 0.04
      });
    }, '#7a3e20', s + 5, { alpha: 0.32, gap: 0.075, lw: 0.016 });

    /*
     * The swash under the wordmark, drawn as two passes of the same stroke.
     * It is underlining the letters, so it measures itself against them and
     * not against the paper - otherwise a capped wordmark sits over a rule
     * that still runs the full width of a wide sheet.
     */
    var swW = Math.min(pw * 0.60, penTextWidth('BURGER', wmSize, 0.085) * 0.73);
    var sw0 = cx - swW / 2;
    ctx.save();
    ctx.strokeStyle = '#c0562f';
    ctx.lineCap = 'round';
    for (i = 0; i < 2; i++) {
      ctx.globalAlpha = i ? 0.45 : 0.95;
      ctx.lineWidth = Math.max(1.2, swW * (i ? 0.0184 : 0.0267));
      ctx.beginPath();
      ctx.moveTo(sw0, py + ph * 0.228 + i * ph * 0.006);
      ctx.bezierCurveTo(sw0 + swW * 0.333, py + ph * 0.242 + i * ph * 0.005,
                        sw0 + swW * 0.700, py + ph * 0.217 + i * ph * 0.005,
                        sw0 + swW, py + ph * 0.232 + i * ph * 0.006);
      ctx.stroke();
    }
    ctx.restore();

    // the burger itself
    var lgW = pw * 0.52, lgH = ph * 0.150;
    if (o.logo) o.logo(ctx, cx - lgW / 2, py + ph * 0.250, lgW, lgH);

    penLetters(ctx, o.sub === undefined ? 'RUN THE LINE' : o.sub, cx, py + ph * 0.430, ph * 0.028, {
      fill: '#a08a6e', weight: 0.115, track: 0.28, seed: s + 6, tilt: 0.05
    });

    /** A wobbled button with strokes for a shadow instead of a soft one. */
    function button(bx, by, bw, bh, label, fill, line, textCol, seed, dashed) {
      drawSketchButton(ctx, bx, by, bw, bh, label,
                       { fill: fill, line: line, text: textCol, seed: seed, dashed: dashed });
    }

    var P = B.primary, Q = B.secondary;
    button(P.x, P.y, P.w, P.h,
           o.primary || (day ? 'CONTINUE \u2014 DAY ' + day : 'START THE SHIFT'),
           '#f0b429', '#8a5a12', '#3f2a08', s + 50, false);
    button(Q.x, Q.y, Q.w, Q.h,
           o.secondary || 'NEW SHIFT', null, '#a8907a', '#5c4432', s + 60, true);

    // the menu tiles, boxed by hand
    var tiles = o.tiles || [];
    if (tiles.length) {
      for (i = 0; i < tiles.length; i++) {
        var T = B.tiles[i], tx2 = T.x, tyy = T.y, tw = T.w, th = T.h;
        var box = rectPts(tx2, tyy, tw, th, tw * 0.10, tw * 0.012, s + 70 + i);
        ctx.save();
        ctx.strokeStyle = '#c4ab8a';
        ctx.lineWidth = Math.max(1.1, tw * 0.030);
        ctx.lineJoin = 'round';
        trace(ctx, box);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(0.9, tw * 0.020);
        trace(ctx, rectPts(tx2 + tw * 0.02, tyy + th * 0.02, tw * 0.96, th * 0.96, tw * 0.10, tw * 0.012, s + 80 + i));
        ctx.stroke();
        ctx.restore();
        if (o.tile) o.tile(ctx, tiles[i].id, tx2 + tw * 0.22, tyy + th * 0.10, tw * 0.56, th * 0.52);
        penLetters(ctx, tiles[i].label || '', tx2 + tw / 2, tyy + th * 0.90, th * 0.125, {
          fill: '#8a7259', weight: 0.115, track: 0.13, seed: s + 90 + i, tilt: 0.05
        });
      }
    }

    // a note written along the bottom of the sheet
    if (o.note) {
      penLetters(ctx, o.note, cx, py + ph * 0.945, ph * 0.025, {
        fill: '#a08a6e', weight: 0.11, track: 0.12, seed: s + 100, tilt: 0.06
      });
    }

    ctx.restore();
  }

  /**
   * The order rail: a wooden batten with the live tickets clipped to it.
   *
   * Art.ui.orders(ctx, x, y, w, h, {
   *   label,                        'ORDERS' burnt into the batten
   *   tickets: [{ who, items, rows, pct, bar }],
   *   face(ctx, who, x, y, w, h),   draws the guest's head
   *   food(ctx, t, x, y, w, h)      draws what they asked for
   * })
   * Each ticket is a torn slip under a steel clip, its lines written with the
   * pen and its patience drawn as a stroke that thins as it runs out - the CSS
   * version was a gradient batten, a clip-path zigzag and a typeface.
   */
  function drawOrders(ctx, x, y, w, h, o) {
    o = o || {};
    var s = 7700, i;
    var tickets = o.tickets || [];
    var railH = h * 0.115, railY = y + h * 0.014;
    drawRail(ctx, x, railY, w, railH, s, o.heat);
    penLetters(ctx, o.label === undefined ? 'ORDERS' : o.label, x + w / 2, railY + railH * 0.78, railH * 0.52, {
      fill: o.heat ? mixHex('#f0d8b4', '#ffd9a8', o.heat) : '#f0d8b4',
      weight: 0.13, track: 0.34, seed: s + 1, tilt: 0.03
    });
    if (!tickets.length) return;

    var gap = w * 0.016;
    var tw = (w - gap * (tickets.length + 1)) / tickets.length;
    // the slips hang BELOW the batten, so the clips never cross its lettering
    var ty = railY + railH * 1.02, th = h - (ty - y) - h * 0.035;

    for (i = 0; i < tickets.length; i++) {
      var t = tickets[i], tx = x + gap + i * (tw + gap);
      var seed = s + 10 + i * 9;
      ctx.save();
      ctx.translate(tx + tw / 2, ty + th / 2);
      ctx.rotate((wob(seed, 5)) * 0.045);
      ctx.translate(-(tx + tw / 2), -(ty + th / 2));

      drawSheet(ctx, tx, ty, tw, th, { seed: seed, rules: 7, ring: false, tear: 0.020 });
      drawClip(ctx, tx + tw * 0.5, ty - th * 0.055, tw * 0.30, th * 0.070, seed + 3);

      if (o.face) o.face(ctx, t.who, tx + tw * 0.20, ty + th * 0.075, tw * 0.60, th * 0.235);
      if (o.food) o.food(ctx, t, tx + tw * 0.14, ty + th * 0.325, tw * 0.72, th * 0.255);

      var rows = t.rows || [], ry = ty + th * 0.665, rs = th * 0.068;
      // From day nine an order can call for five lines. At the drawn pitch the
      // list runs past the bottom of the paper and through the patience stroke
      // - and nothing here is clipped, so it would simply spill onto the batten
      // below. Tighten the pitch, and only the pitch, once it has to: one, two
      // and three lines still sit exactly where they were drawn.
      var room = th * (0.900 - 0.665);
      // the trailing term is the glyph's own height - keep it in step with the
      // size below, or a five-line slip budgets for letters it no longer draws
      if (rows.length && (rows.length - 1) * rs * 1.15 + rs * 0.86 > room) {
        rs = room / ((rows.length - 1) * 1.15 + 0.86);
      }
      /*
       * The name is the thing the player actually reads across the room, and
       * it was set at 0.60 of the row - half the pitch, with the rest of the
       * line empty. Fill the row properly. fitLetters only shrinks when a long
       * name would run off the paper, so JALAPENO still fits while the short
       * names get the full size.
       */
      var chip = rs * 0.72;
      for (var k = 0; k < rows.length; k++) {
        ink(ctx, rectPts(tx + tw * 0.10, ry - chip, chip, chip, rs * 0.18, rs * 0.05, seed + 20 + k),
            rows[k].c, { lw: Math.max(0.8, rs * 0.12), line: '#4a3226', lineAlpha: 0.8, seed: seed + 20 + k });
        fitLetters(ctx, rows[k].n, tx + tw * 0.27, ry, rs * 0.86, tw * 0.66, {
          fill: '#4a3226', weight: 0.13, track: 0.05, align: 'left', seed: seed + 30 + k
        });
        ry += rs * 1.15;
      }

      // patience: one pen stroke over a faint one, thinning as it empties
      var pct = typeof t.pct === 'string' ? parseFloat(t.pct) / 100 : (t.pct || 0);
      var by = ty + th * 0.935, bx0 = tx + tw * 0.10, bw3 = tw * 0.80;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#c4ab8a';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, th * 0.014);
      ctx.beginPath();
      for (var c = 0; c <= 5; c++) ctx.lineTo(bx0 + bw3 * (c / 5), by + wob(seed + 40, c) * th * 0.006);
      ctx.stroke();
      ctx.strokeStyle = t.bar || '#3f7a2a';
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = Math.max(1.4, th * 0.024 * (0.6 + pct * 0.6));
      ctx.beginPath();
      for (c = 0; c <= 5; c++) {
        var f = (c / 5) * Math.max(0.06, pct);
        ctx.lineTo(bx0 + bw3 * f, by + wob(seed + 41, c) * th * 0.006);
      }
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
  }

  function drawGlyph(ctx, id, w, h) {

  var s = 760, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36, lw = Math.max(1.2, R * 0.10);
  if (id === 'coop') {
    ink(ctx, ellPts(cx - R * 0.42, cy - R * 0.20, R * 0.36, R * 0.36, 14, R * 0.05, s), '#e8a021', { lw: lw, line: '#4a3226', seed: s });
    ink(ctx, ellPts(cx + R * 0.42, cy - R * 0.20, R * 0.36, R * 0.36, 14, R * 0.05, s + 1), '#c0562f', { lw: lw, line: '#4a3226', seed: s + 1 });
    ink(ctx, blobPts(cx, cy + R * 0.58, R * 0.95, R * 0.40, 3, 0.10, 0.5, 20, R * 0.05, s + 2), '#fdf6e6', { lw: lw, line: '#4a3226', seed: s + 2 });
  } else if (id === 'rank') {
    ink(ctx, blobPts(cx, cy - R * 0.16, R * 0.52, R * 0.55, 3, 0.16, 1.6, 22, R * 0.05, s + 3), '#e8a021', { lw: lw, line: '#4a3226', seed: s + 3 });
    ink(ctx, rectPts(cx - R * 0.44, cy + R * 0.56, R * 0.88, R * 0.30, R * 0.08, R * 0.04, s + 4), '#c9a33f', { lw: lw, line: '#4a3226', seed: s + 4 });
  } else if (id === 'you') {
    // On cream paper a white toque disappears, so the hat carries a red band
    // and the face sits on a saturated scarf - the same weight as the others.
    ink(ctx, blobPts(cx, cy + R * 0.72, R * 0.78, R * 0.30, 3, 0.12, 0.5, 20, R * 0.05, s + 4), '#c0562f', { lw: lw, line: '#4a3226', seed: s + 4 });
    ink(ctx, ellPts(cx, cy + R * 0.16, R * 0.44, R * 0.46, 16, R * 0.05, s + 5), '#f2b877', { lw: lw, line: '#4a3226', seed: s + 5 });
    ink(ctx, blobPts(cx, cy - R * 0.46, R * 0.60, R * 0.30, 4, 0.16, 0.8, 22, R * 0.05, s + 6), '#fffdf7', { lw: lw * 1.2, line: '#4a3226', seed: s + 6 });
    ink(ctx, rectPts(cx - R * 0.46, cy - R * 0.24, R * 0.92, R * 0.20, R * 0.06, R * 0.03, s + 7), '#e8a021', { lw: lw, line: '#4a3226', seed: s + 7 });
  } else if (id === 'outfit') {
    // Not in the handoff - the store tile is this game's addition - so drawn
    // to the same recipe as its neighbours: one silhouette, two colours, ink.
    ink(ctx, blobPts(cx, cy + R * 0.10, R * 0.86, R * 0.74, 4, 0.10, 0.4, 24, R * 0.05, s + 30),
        '#fdf6e6', { lw: lw, line: '#4a3226', seed: s + 30 });
    ink(ctx, jitter([[cx - R * 0.40, cy - R * 0.62], [cx, cy - R * 0.06],
                     [cx + R * 0.40, cy - R * 0.62], [cx + R * 0.16, cy - R * 0.74],
                     [cx - R * 0.16, cy - R * 0.74]], R * 0.05, s + 31),
        '#c0562f', { lw: lw, line: '#4a3226', seed: s + 31 });
    ink(ctx, rectPts(cx - R * 0.10, cy - R * 0.04, R * 0.20, R * 0.80, R * 0.06, R * 0.03, s + 32),
        '#e8a021', { lw: lw * 0.8, line: '#4a3226', seed: s + 32 });
  } else if (id === 'grillUp') {
    drawGrill(ctx, w * 0.10, h * 0.18, w * 0.80, h * 0.66, { hot: 0.8 });
  } else if (id === 'shoes') {
    ink(ctx, blobPts(cx, cy + R * 0.20, R * 0.82, R * 0.42, 4, 0.14, 0.4, 22, R * 0.05, s + 7), '#c0562f', { lw: lw, line: '#4a3226', seed: s + 7 });
    ink(ctx, rectPts(cx - R * 0.78, cy + R * 0.52, R * 1.6, R * 0.26, R * 0.08, R * 0.04, s + 8), '#fdf6e6', { lw: lw, line: '#4a3226', seed: s + 8 });
  } else if (id === 'sound') {
    ink(ctx, jitter([[cx - R * 0.72, cy - R * 0.26], [cx - R * 0.30, cy - R * 0.26],
                       [cx + R * 0.10, cy - R * 0.76], [cx + R * 0.10, cy + R * 0.76],
                       [cx - R * 0.30, cy + R * 0.26], [cx - R * 0.72, cy + R * 0.26]], R * 0.05, s + 20),
          '#e8a021', { lw: lw, line: '#4a3226', seed: s + 20 });
    ctx.save();
    ctx.strokeStyle = '#4a3226'; ctx.lineWidth = lw * 0.9; ctx.lineCap = 'round';
    for (var w1 = 0; w1 < 2; w1++) {
      ctx.beginPath();
      ctx.arc(cx + R * 0.16, cy, R * (0.42 + w1 * 0.30), -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  } else if (id === 'music') {
    ink(ctx, ellPts(cx - R * 0.34, cy + R * 0.44, R * 0.30, R * 0.24, 14, R * 0.04, s + 22), '#c0562f', { lw: lw, line: '#4a3226', seed: s + 22 });
    ink(ctx, ellPts(cx + R * 0.44, cy + R * 0.20, R * 0.30, R * 0.24, 14, R * 0.04, s + 23), '#c0562f', { lw: lw, line: '#4a3226', seed: s + 23 });
    ctx.save();
    ctx.strokeStyle = '#4a3226'; ctx.lineWidth = lw * 1.1; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.06, cy + R * 0.46);
    ctx.lineTo(cx - R * 0.02, cy - R * 0.60);
    ctx.lineTo(cx + R * 0.74, cy - R * 0.84);
    ctx.lineTo(cx + R * 0.72, cy + R * 0.22);
    ctx.stroke();
    ctx.restore();
  } else if (id === 'board') {
    ink(ctx, rectPts(cx - R * 0.80, cy - R * 0.62, R * 1.6, R * 1.24, R * 0.10, R * 0.05, s + 9), '#fdf6e6', { lw: lw, line: '#4a3226', seed: s + 9 });
    ctx.save();
    ctx.strokeStyle = '#a08a6e'; ctx.lineWidth = Math.max(1, R * 0.09); ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.52, cy - R * 0.26 + i * R * 0.34);
      ctx.lineTo(cx + R * 0.52, cy - R * 0.26 + i * R * 0.34);
      ctx.stroke();
    }
    ctx.restore();
  }
  }

  /**
   * The wordmark's burger - a whole one, cross-sectioned, under MR. BURGER.
   * The handoff builds it out of the game's own layers rather than drawing a
   * logo, so the thing on the title slip is literally the thing you cook.
   */
  function drawLogo(ctx, w, h) {
    var lg = ['bun', 'patty', 'cheese', 'lettuce', 'tomato', 'bunTop'];
    drawStack(ctx, lg, w / 2, h * 0.94, fitWidth(lg, w * 0.50, h * 0.86), {});
  }


  /* ---------------------------------------------------------------- UI ink
   * The interface's own drawn parts, lifted from the handoff DOCUMENT the same
   * way the glyphs were: hearts, the two rubber stamps, the till bundle and the
   * swing tag a price hangs off. A UI kit would reach for an emoji or a stroked
   * pictogram for each of these; the point of the paper direction is that it
   * does not.
   *
   * Parameterised where the document hard-coded: it only ever drew five hearts
   * with three left, and only ever stamped the word PAID.
   */
  /* ------------------------------------------------------- whole sheets
   * The receipt, the shop and the pause slip, composed from the parts above
   * the same way the handoff document composes them.
   *
   * These live in the document's own <script> rather than in its art.js, which
   * is exactly the kind of thing a function-by-function audit of art.js misses.
   *
   * Each screen comes with a *Boxes() twin that reports where its controls
   * landed, so the game can hang real buttons on them. Both read the same
   * constants; neither can drift.
   */

  /**
   * penLetters, shrunk until it fits inside maxW.
   *
   * Every written line on these sheets is a single centred line with no wrap,
   * and the copy is written for a 600-wide mock while a phone gives the paper
   * about 320. Rather than keep the strings short enough for the narrowest
   * device and dull on every other one, measure and come down - the same thing
   * drawHUD already does for the takings.
   */
  function fitLetters(ctx, txt, cx, baseY, size, maxW, o) {
    o = o || {};
    var track = o.track === undefined ? 0.055 : o.track;
    var s = size;
    while (s > size * 0.55 && penTextWidth(txt, s, track) > maxW) s *= 0.94;
    return penLetters(ctx, txt, cx, baseY, s, o);
  }

  /** Run a draw-at-origin ornament at (x, y) instead. */
  function at(ctx, x, y, fn, w, h, t) {
    ctx.save();
    ctx.translate(x, y);
    var r = fn(ctx, w, h, t);
    ctx.restore();
    return r;
  }

  /** The dark room, the rail, and a tilted sheet clipped to it. */
  function screenShell(ctx, x, y, w, h, o) {
    o = o || {};
    var railY = y + h * 0.045, railH = h * 0.020;
    var pw = w * (o.wide === undefined ? 0.88 : o.wide), px = x + (w - pw) / 2;
    var py = railY + railH * 0.6, ph = h * (o.tall === undefined ? 0.80 : o.tall);
    return {
      px: px, py: py, pw: pw, ph: ph, cx: px + pw / 2,
      railY: railY, railH: railH,
      tilt: o.tilt === undefined ? 0.009 : o.tilt
    };
  }

  /** Paint that shell. Leaves the sheet's rotation ON - the caller restores. */
  function paintShell(ctx, x, y, w, h, o) {
    var B = screenShell(ctx, x, y, w, h, o);
    drawScreenBack(ctx, x, y, w, h, { kitchenTop: o.kitchenTop, kitchenWash: o.kitchenWash });
    drawRail(ctx, x, B.railY, w, B.railH, o.seed);
    ctx.save();
    ctx.translate(B.px + B.pw / 2, B.py + B.ph / 2);
    ctx.rotate(B.tilt);
    ctx.translate(-(B.px + B.pw / 2), -(B.py + B.ph / 2));
    drawSheet(ctx, B.px, B.py, B.pw, B.ph,
              { seed: o.seed, rules: o.rules, ringX: o.ringX, ringY: o.ringY });
    (o.clips || [0.5]).forEach(function (f, k) {
      drawClip(ctx, B.px + B.pw * f, B.railY - B.railH * 0.25, B.pw * 0.15, B.railH * 1.7, o.seed + 30 + k);
    });
    return B;
  }

  /* ---------------------------------------------------------- the receipt */

  function receiptBoxes(x, y, w, h) {
    var B = screenShell(null, x, y, w, h, { seed: 8100, tilt: 0.011 });
    return {
      sheet: B,
      primary: { x: B.px + B.pw * 0.10, y: B.py + B.ph * 0.855, w: B.pw * 0.80, h: B.ph * 0.085 }
    };
  }

  /**
   * Art.ui.receipt(ctx, x, y, w, h, {
   *   title, sub,            'DAY 4 CLOSED', the shop's own line
   *   lines: [{k,v,col}],    food sales / tips / took in / rent / profit
   *   chips: [{v,k}],        the three counted boxes
   *   paid,                  stamp it
   *   note, primary          the closing line and the button's label
   * })
   */
  function drawReceipt(ctx, x, y, w, h, o) {
    o = o || {};
    var B = paintShell(ctx, x, y, w, h,
                       { seed: 8100, kitchenTop: 0.88, kitchenWash: 0.66, tilt: 0.011, clips: [0.5] });
    var px = B.px, py = B.py, pw = B.pw, ph = B.ph, cx = B.cx;
    var pad = pw * 0.10, iw = pw - pad * 2, x0 = px + pad;

    fitLetters(ctx, o.title || 'DAY CLOSED', cx, py + ph * 0.075, ph * 0.038, iw, {
      fill: '#3f2a1c', line: '#8a7259', weight: 0.14, track: 0.13, seed: 8101
    });
    fitLetters(ctx, o.sub === undefined ? 'MR. BURGER · OPEN 24 HRS' : o.sub, cx, py + ph * 0.105, ph * 0.019, iw, {
      fill: '#a08a6e', weight: 0.12, track: 0.22, seed: 8102
    });
    drawRule(ctx, x0, py + ph * 0.135, iw, { seed: 8103 });

    var yy = py + ph * 0.185, rowSize = ph * 0.026;
    (o.lines || []).forEach(function (l, i) {
      drawRow(ctx, x0, yy, iw, l.k, l.v, { size: rowSize, valueCol: l.col, seed: 8110 + i * 3 });
      yy += rowSize * 2.15;
    });

    drawRule(ctx, x0, yy + ph * 0.005, iw, { seed: 8104 });

    var chips = o.chips || [];
    if (chips.length) {
      var cgap = iw * 0.05, cw = (iw - cgap * (chips.length - 1)) / chips.length;
      var chh = ph * 0.105, cy = yy + ph * 0.030;
      chips.forEach(function (c, i) {
        var bxx = x0 + i * (cw + cgap);
        ctx.save();
        ctx.strokeStyle = '#c4ab8a';
        ctx.lineWidth = Math.max(1.1, cw * 0.028);
        ctx.lineJoin = 'round';
        trace(ctx, rectPts(bxx, cy, cw, chh, cw * 0.09, cw * 0.012, 8120 + i));
        ctx.stroke();
        ctx.restore();
        penLetters(ctx, String(c.v), bxx + cw / 2, cy + chh * 0.60, chh * 0.44,
                   { fill: '#3f2a1c', weight: 0.14, track: 0.08, seed: 8130 + i });
        penLetters(ctx, c.k, bxx + cw / 2, cy + chh * 0.88, chh * 0.155,
                   { fill: '#a08a6e', weight: 0.12, track: 0.16, seed: 8140 + i });
      });
      if (o.paid) UI.stampAt(ctx, cx - pw * 0.23, cy + chh * 1.45, pw * 0.46, ph * 0.100, o.paid);
    }

    if (o.note) {
      fitLetters(ctx, o.note, cx, py + ph * 0.790, ph * 0.019, iw,
                 { fill: '#a08a6e', weight: 0.12, track: 0.14, seed: 8145 });
    }
    var P = receiptBoxes(x, y, w, h).primary;
    drawSketchButton(ctx, P.x, P.y, P.w, P.h, o.primary || 'TO THE SHOP', { seed: 8150 });
    ctx.restore();
  }

  /* ------------------------------------------------------------- the shop */

  /*
   * The shop's footer is measured up from the bottom of the paper, not down
   * from the top. The handoff lays out three upgrades at ph*0.128 apiece; this
   * shop stocks five, and pinning the closing lines to fixed fractions ran
   * TOMORROW straight through the last row and pushed RENT off the torn edge.
   *
   * So: the tail is fixed, the rows get what is left, and on a day with
   * nothing new on the menu the taped slip is skipped and the rows get its
   * room too - which is most days, and the difference between a 47px row and
   * a 71px one.
   */
  var SHOP_ROWS_END = 0.755;      // rows must have finished by here
  var SHOP_RULE = 0.768, SHOP_TOMORROW = 0.792, SHOP_LINK = 0.822;
  var SHOP_BTN = 0.845, SHOP_BTN_H = 0.072, SHOP_RENT = 0.958;

  function shopBoxes(x, y, w, h, n, hasUnlocks) {
    var B = screenShell(null, x, y, w, h, { seed: 8300, tilt: -0.008 });
    var pad = B.pw * 0.085, iw = B.pw - pad * 2, x0 = B.px + pad;
    var uyF = hasUnlocks ? 0.390 : 0.230;
    var uy = B.py + B.ph * uyF;
    var rowH = Math.min(B.ph * 0.128, n ? B.ph * (SHOP_ROWS_END - uyF) / n : B.ph * 0.128);
    var buys = [];
    for (var i = 0; i < (n || 0); i++) {
      buys.push({ x: x0 + iw * 0.70, y: uy + i * rowH, w: iw * 0.30, h: rowH * 0.72 });
    }
    return {
      sheet: B, rowH: rowH, x0: x0, iw: iw, uy: uy, unlockY: B.py + B.ph * 0.190,
      hasUnlocks: !!hasUnlocks,
      rowsEnd: uy + (n || 0) * rowH,
      buys: buys,
      link: { x: x0 + iw * 0.15, y: B.py + B.ph * (SHOP_LINK - 0.022), w: iw * 0.70, h: B.ph * 0.042 },
      primary: { x: x0, y: B.py + B.ph * SHOP_BTN, w: iw, h: B.ph * SHOP_BTN_H }
    };
  }

  /**
   * Art.ui.shop(ctx, x, y, w, h, {
   *   title, day, till,           'THE SHOP', 'DAY 4 - CLOSED', '$42.80'
   *   unlocks: [{id,name,price}], what the menu gains
   *   upgrades: [{id,t,d,p,pips}] pips is an array of colours, one per level
   *   tomorrow, rent,             the two footer lines
   *   link, primary,              labels
   *   upgrade(ctx,id,x,y,w,h),    draws an upgrade's icon
   *   portrait(ctx,id,x,y,w,h)    draws a newly unlocked ingredient
   * })
   */
  function drawShop(ctx, x, y, w, h, o) {
    o = o || {};
    var ups = o.upgrades || [];
    var unlocks = o.unlocks || [];
    var BX = shopBoxes(x, y, w, h, ups.length, unlocks.length > 0);
    var B = paintShell(ctx, x, y, w, h, {
      seed: 8300, kitchenTop: 0.90, kitchenWash: 0.70, tilt: -0.008,
      clips: [0.24, 0.76], ringX: 0.14, ringY: 0.42
    });
    var px = B.px, py = B.py, pw = B.pw, ph = B.ph, cx = B.cx;
    var iw = BX.iw, x0 = BX.x0;

    penLetters(ctx, o.title || 'THE SHOP', x0, py + ph * 0.055, ph * 0.032, {
      fill: '#3f2a1c', line: '#8a7259', weight: 0.135, track: 0.12, align: 'left', seed: 8301
    });
    if (o.day) {
      penLetters(ctx, o.day, x0 + iw, py + ph * 0.055, ph * 0.017, {
        fill: '#a08a6e', weight: 0.12, track: 0.16, align: 'right', seed: 8302
      });
    }
    drawRule(ctx, x0, py + ph * 0.075, iw, { seed: 8303 });

    UI.tillAt(ctx, x0, py + ph * 0.090, iw * 0.22, ph * 0.075);
    penLetters(ctx, 'IN THE TILL', x0 + iw * 0.27, py + ph * 0.115, ph * 0.017, {
      fill: '#a08a6e', weight: 0.12, track: 0.20, align: 'left', seed: 8304
    });
    penLetters(ctx, o.till || '$0.00', x0 + iw * 0.27, py + ph * 0.163, ph * 0.042, {
      fill: '#3f7a2a', line: '#22521a', weight: 0.135, track: 0.06, align: 'left', seed: 8305
    });

    // NEW ON THE MENU - a slip taped to the page, and only on a day that has
    // something to tape there. An empty box saying NOTHING NEW TODAY is a
    // whole band of paper spent on an absence.
    var ny = BX.unlockY, nh = ph * 0.145;
    if (unlocks.length) {
    ctx.save();
    ink(ctx, rectPts(x0, ny, iw, nh, iw * 0.012, iw * 0.004, 8310), '#f6ecd6',
        { lw: Math.max(1, iw * 0.005), line: '#e0cba6', seed: 8310 });
    ctx.globalAlpha = 0.62;
    ctx.save();
    ctx.translate(x0 + iw * 0.5, ny);
    ctx.rotate(-0.07);
    ink(ctx, rectPts(-iw * 0.09, -nh * 0.09, iw * 0.18, nh * 0.18, iw * 0.008, iw * 0.003, 8311),
        '#e8dcc0', { lw: Math.max(0.9, iw * 0.004), line: '#a8907a', lineAlpha: 0.8, seed: 8311 });
    ctx.restore();
    ctx.restore();
    penLetters(ctx, 'NEW ON THE MENU', x0 + iw * 0.06, ny + nh * 0.22, ph * 0.017,
               { fill: '#b07607', weight: 0.13, track: 0.18, align: 'left', seed: 8312 });
    unlocks.slice(0, 2).forEach(function (u, i) {
      var ux = x0 + iw * (0.30 + i * 0.34), uw = iw * 0.20;
      if (o.portrait) {
        ctx.save();
        ctx.translate(ux, ny + nh * 0.30);
        o.portrait(ctx, u.id, 0, 0, uw, nh * 0.46);
        ctx.restore();
      }
      penLetters(ctx, u.name, ux + uw / 2, ny + nh * 0.90, ph * 0.017,
                 { fill: '#5c4432', weight: 0.12, track: 0.08, seed: 8320 + i });
      if (u.price) {
        penLetters(ctx, u.price, ux + uw / 2, ny + nh * 1.02, ph * 0.015,
                   { fill: '#a08a6e', weight: 0.12, track: 0.10, seed: 8330 + i });
      }
    });
    }

    var rowH = BX.rowH, uy = BX.uy;
    ups.forEach(function (up, i) {
      var ry = uy + i * rowH;
      drawRule(ctx, x0, ry - rowH * 0.14, iw, { seed: 8340 + i, alpha: 0.55 });
      if (o.upgrade) {
        ctx.save();
        ctx.translate(x0, ry + rowH * 0.03);
        o.upgrade(ctx, up.id, 0, 0, iw * 0.135, iw * 0.135);
        ctx.restore();
      }
      penLetters(ctx, up.t, x0 + iw * 0.180, ry + rowH * 0.20, rowH * 0.205, {
        fill: '#3f2a1c', weight: 0.125, track: 0.07, align: 'left', seed: 8350 + i
      });
      penLetters(ctx, up.d, x0 + iw * 0.180, ry + rowH * 0.41, rowH * 0.140, {
        fill: '#a08a6e', weight: 0.12, track: 0.07, align: 'left', seed: 8360 + i
      });
      (up.pips || []).forEach(function (p, k) {
        ctx.save();
        ctx.strokeStyle = p;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.4, rowH * 0.070);
        ctx.beginPath();
        ctx.moveTo(x0 + iw * 0.180 + k * iw * 0.052, ry + rowH * 0.58);
        ctx.lineTo(x0 + iw * 0.180 + k * iw * 0.052 + iw * 0.036, ry + rowH * 0.575);
        ctx.stroke();
        ctx.restore();
      });
      var b = BX.buys[i];
      UI.priceTagAt(ctx, b.x, b.y + rowH * 0.06, b.w, b.h * 0.80, up.p);
    });

    drawRule(ctx, x0, py + ph * SHOP_RULE, iw, { seed: 8365, alpha: 0.55 });
    if (o.tomorrow) {
      fitLetters(ctx, o.tomorrow, cx, py + ph * SHOP_TOMORROW, ph * 0.018, iw,
                 { fill: '#b9a48a', weight: 0.12, track: 0.10, seed: 8366 });
    }
    if (o.link) {
      fitLetters(ctx, o.link, cx, py + ph * SHOP_LINK, ph * 0.019, iw,
                 { fill: '#c0562f', weight: 0.12, track: 0.11, seed: 8367 });
    }
    var P = BX.primary;
    drawSketchButton(ctx, P.x, P.y, P.w, P.h, o.primary || 'START THE DAY', { seed: 8370 });
    if (o.rent) {
      fitLetters(ctx, o.rent, cx, py + ph * SHOP_RENT, ph * 0.018, iw,
                 { fill: '#a08a6e', weight: 0.12, track: 0.14, seed: 8380 });
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ the pause */

  function pauseBoxes(x, y, w, h, n) {
    var B = screenShell(null, x, y, w, h, { seed: 8500, tilt: 0.012, wide: 0.86, tall: 0.74 });
    var pad = B.pw * 0.10, iw = B.pw - pad * 2, x0 = B.px + pad;
    var out = {
      sheet: B, x0: x0, iw: iw,
      primary: { x: x0, y: B.py + B.ph * 0.470, w: iw, h: B.ph * 0.085 },
      secondary: { x: x0, y: B.py + B.ph * 0.580, w: iw, h: B.ph * 0.072 },
      tertiary: { x: x0, y: B.py + B.ph * 0.675, w: iw, h: B.ph * 0.072 },
      toggles: []
    };
    n = n || 0;
    if (n) {
      var gap = iw * 0.05, tw = (iw - gap * (n - 1)) / n, th = B.ph * 0.135, ty = B.py + B.ph * 0.790;
      for (var i = 0; i < n; i++) out.toggles.push({ x: x0 + i * (tw + gap), y: ty, w: tw, h: th });
    }
    return out;
  }

  /**
   * Art.ui.pause(ctx, x, y, w, h, {
   *   stamp, sub,                 the rubber stamp and the line under it
   *   rows: [{k,v,col}],          what the shift stands at
   *   primary/secondary/tertiary, button labels
   *   toggles: [{id,k,on}],       the boxed switches along the bottom
   *   glyph(ctx,id,x,y,w,h)       draws a toggle's mark
   * })
   */
  function drawPause(ctx, x, y, w, h, o) {
    o = o || {};
    var tg = o.toggles || [];
    var BX = pauseBoxes(x, y, w, h, tg.length);
    var B = paintShell(ctx, x, y, w, h, {
      seed: 8500, kitchenTop: 0.60, kitchenWash: 0.58, tilt: 0.012,
      wide: 0.86, tall: 0.74, clips: [0.5]
    });
    var px = B.px, py = B.py, pw = B.pw, ph = B.ph, cx = B.cx;
    var iw = BX.iw, x0 = BX.x0;

    UI.pauseStampAt(ctx, cx - pw * 0.32, py + ph * 0.045, pw * 0.64, ph * 0.115, o.stamp);
    if (o.sub) {
      fitLetters(ctx, o.sub, cx, py + ph * 0.205, ph * 0.020, iw,
                 { fill: '#a08a6e', weight: 0.12, track: 0.14, seed: 8501 });
    }
    drawRule(ctx, x0, py + ph * 0.245, iw, { seed: 8502 });

    var yy = py + ph * 0.300, rs = ph * 0.028;
    (o.rows || []).forEach(function (r, i) {
      yy = drawRow(ctx, x0, yy, iw, r.k, r.v, { size: rs, valueCol: r.col, seed: 8510 + i * 3 });
    });
    drawRule(ctx, x0, yy - ph * 0.010, iw, { seed: 8503 });

    var P = BX.primary, Q = BX.secondary, R = BX.tertiary;
    drawSketchButton(ctx, P.x, P.y, P.w, P.h, o.primary || 'BACK TO WORK', { seed: 8520 });
    drawSketchButton(ctx, Q.x, Q.y, Q.w, Q.h, o.secondary || 'RESTART THE DAY',
                     { dashed: true, seed: 8530 });
    drawSketchButton(ctx, R.x, R.y, R.w, R.h, o.tertiary || 'CLOSE UP SHOP',
                     { dashed: true, line: '#ddcdb0', text: '#a08a6e', seed: 8540 });

    tg.forEach(function (t, i) {
      var T = BX.toggles[i];
      ctx.save();
      ctx.strokeStyle = t.on === false ? '#ddcdb0' : '#c4ab8a';
      ctx.lineWidth = Math.max(1.1, T.w * 0.030);
      ctx.lineJoin = 'round';
      trace(ctx, rectPts(T.x, T.y, T.w, T.h, T.w * 0.10, T.w * 0.012, 8550 + i));
      ctx.stroke();
      ctx.restore();
      if (o.glyph) {
        ctx.save();
        ctx.globalAlpha = t.on === false ? 0.42 : 1;
        ctx.translate(T.x + T.w * 0.26, T.y + T.h * 0.12);
        o.glyph(ctx, t.id, 0, 0, T.w * 0.48, T.h * 0.48);
        ctx.restore();
      }
      penLetters(ctx, t.k, T.x + T.w / 2, T.y + T.h * 0.88, T.h * 0.155,
                 { fill: t.on === false ? '#a08a6e' : '#5c4432', weight: 0.12, track: 0.14, seed: 8560 + i });
      /*
       * Off is struck through, not just faded. A switch that only goes a shade
       * paler when it is off is a switch you have to remember the state of -
       * and the one thing a mute button must never make you do is guess.
       */
      if (t.on === false) {
        ctx.save();
        ctx.strokeStyle = '#c0562f';
        ctx.globalAlpha = 0.75;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.4, T.w * 0.045);
        ctx.beginPath();
        for (var c = 0; c <= 4; c++) {
          var f = c / 4;
          ctx.lineTo(T.x + T.w * (0.14 + 0.72 * f),
                     T.y + T.h * (0.70 - 0.44 * f) + wob(8570 + i, c) * T.h * 0.018);
        }
        ctx.stroke();
        ctx.restore();
      }
    });
    ctx.restore();
  }

  /* -------------------------------------------------- the two odd screens */

  /**
   * The storefront sign that fills the slack above the board between shifts.
   * Art.ui.sign(ctx, x, y, w, h)
   *
   * The same wordmark the title inks, at a tenth of the size - it was three
   * spans of Caprasimo, so the game carried a drawn MR. BURGER and a typeset
   * one two screens apart.
   */
  function drawSign(ctx, x, y, w, h) {
    var s = 9100;
    var cx = x + w / 2;
    // MR. sits ABOVE the wordmark's cap line, not on it: BURGER's caps start at
    // (baseline - size), so the small line has to clear that or the two collide.
    var mr = h * 0.17, big = h * 0.44, sub = h * 0.13;
    var bigBase = y + h * 0.78;
    penLetters(ctx, 'MR.', cx, bigBase - big - h * 0.06, mr,
               { fill: '#c0562f', weight: 0.15, track: 0.46, seed: s, tilt: 0.05 });
    fitLetters(ctx, 'BURGER', cx, bigBase, big, w * 0.86,
               { fill: '#f0b429', line: '#7a3e20', weight: 0.145, track: 0.075, seed: s + 1, tilt: 0.03 });
    // two inked beads where the sign had ◦ OPEN 24 HRS ◦ - the bullet was
    // U+25E6, which is in no font this game ships
    var tw = penTextWidth('OPEN 24 HRS', sub, 0.30);
    penLetters(ctx, 'OPEN 24 HRS', cx, y + h * 0.98, sub,
               { fill: 'rgba(253,246,230,0.50)', weight: 0.12, track: 0.30, seed: s + 2 });
    ctx.save();
    ctx.fillStyle = 'rgba(240,180,41,0.55)';
    [-1, 1].forEach(function (d, i) {
      trace(ctx, ellPts(cx + d * (tw / 2 + sub * 0.85), y + h * 0.94, sub * 0.20, sub * 0.20, 10, sub * 0.03, s + 5 + i));
      ctx.fill();
    });
    ctx.restore();
  }

  /**
   * The turn-your-phone overlay: a handset on its side and an arrow bringing
   * it upright. Art.ui.rotate(ctx, x, y, w, h)
   */
  function drawRotate(ctx, x, y, w, h) {
    var s = 9200, cx = x + w / 2, cy = y + h * 0.40;
    var u = Math.min(w, h) * 0.20;                 // the phone's short side

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-1.05);
    ink(ctx, rectPts(-u * 0.92, -u * 0.52, u * 1.84, u * 1.04, u * 0.18, u * 0.02, s),
        '#2a1a15', { lw: Math.max(1.6, u * 0.075), off: u * 0.012, line: '#e8c9a0', seed: s });
    ink(ctx, rectPts(-u * 0.76, -u * 0.38, u * 1.52, u * 0.76, u * 0.10, u * 0.02, s + 1),
        '#4a2f24', { lw: Math.max(1, u * 0.035), line: '#a8907a', lineAlpha: 0.7, seed: s + 1 });
    ctx.restore();

    // the arrow that turns it
    ctx.save();
    ctx.strokeStyle = '#f0b429';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, u * 0.10);
    ctx.beginPath();
    for (var i = 0; i <= 12; i++) {
      var a = -2.5 + (i / 12) * 1.9;
      var r = u * 1.45 + wob(s + 10, i) * u * 0.03;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92);
    }
    ctx.stroke();
    var ea = -0.6, er = u * 1.45;
    var ex = cx + Math.cos(ea) * er, ey = cy + Math.sin(ea) * er * 0.92;
    ctx.beginPath();
    ctx.moveTo(ex - u * 0.30, ey - u * 0.20);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - u * 0.06, ey - u * 0.36);
    ctx.stroke();
    ctx.restore();

    fitLetters(ctx, 'TURN YOUR PHONE', cx, y + h * 0.68, h * 0.055, w * 0.82,
               { fill: '#fdf6e6', line: '#8a5a30', weight: 0.14, track: 0.12, seed: s + 20 });
    fitLetters(ctx, 'THE LINE RUNS TOP TO BOTTOM', cx, y + h * 0.745, h * 0.026, w * 0.82,
               { fill: 'rgba(253,246,230,0.60)', weight: 0.12, track: 0.16, seed: s + 21 });
    fitLetters(ctx, 'UPRIGHT, EVERYTHING IS BIG ENOUGH TO HIT', cx, y + h * 0.785, h * 0.026, w * 0.82,
               { fill: 'rgba(253,246,230,0.60)', weight: 0.12, track: 0.16, seed: s + 22 });
  }

  var UI = {
    /* --- the handoff kit --- */
    hud: drawHUD, title: drawTitle, orders: drawOrders, heart: drawHeart,
    text: penLetters, letters: penLetters, width: penTextWidth,
    back: drawScreenBack, rail: drawRail, clip: drawClip, sheet: drawSheet,
    button: drawSketchButton, rule: drawRule, row: drawRow, torn: tornPts,
    shell: paintShell,
    receipt: drawReceipt, shop: drawShop, pause: drawPause,
    sign: drawSign, rotate: drawRotate,
    titleBoxes: titleBoxes,
    hudBoxes: hudBoxes,
    receiptBoxes: receiptBoxes, shopBoxes: shopBoxes, pauseBoxes: pauseBoxes,

    /* The ornaments again, placed rather than filling their own canvas. The
       screens above compose them into a page; the game still paints a few of
       them into little canvases of their own. */
    stampAt: function (ctx, x, y, w, h, t) { return at(ctx, x, y, UI.stamp, w, h, t); },
    pauseStampAt: function (ctx, x, y, w, h, t) { return at(ctx, x, y, UI.pauseStamp, w, h, t); },
    tillAt: function (ctx, x, y, w, h) { return at(ctx, x, y, UI.till, w, h); },
    priceTagAt: function (ctx, x, y, w, h, t) { return at(ctx, x, y, UI.priceTag, w, h, t); },


    /* --- ornaments --- */

    /** n hearts, the first `left` of them still beating. */
    hearts: function (ctx, w, h, left, n) {
      n = n || 5;
      for (var k = 0; k < n; k++) {
        var r = Math.min(h * 0.30, w / n * 0.38);
        drawHeart(ctx, w * ((0.5 + k) / n), h * 0.52, r, k < left, 700 + k);
      }
    },

    /** The green oval a paid receipt gets. */
    stamp: function (ctx, w, h, text) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.14);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#3f7a2a';
      ctx.lineWidth = Math.max(1.6, w * 0.016);
      ctx.lineJoin = 'round';
      trace(ctx, ellPts(0, 0, w * 0.40, h * 0.36, 22, w * 0.012, 720));
      ctx.stroke();
      penLetters(ctx, text || 'PAID', 0, h * 0.10, h * 0.26,
                 { fill: '#3f7a2a', weight: 0.15, track: 0.14, seed: 721 });
      ctx.restore();
    },

    /** The double-ruled box the pause slip is stamped with. */
    pauseStamp: function (ctx, w, h, text) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.06);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#c0562f';
      ctx.lineWidth = Math.max(2, w * 0.012);
      ctx.lineJoin = 'round';
      trace(ctx, rectPts(-w * 0.40, -h * 0.32, w * 0.80, h * 0.64, h * 0.10, w * 0.008, 741));
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      trace(ctx, rectPts(-w * 0.36, -h * 0.26, w * 0.72, h * 0.52, h * 0.08, w * 0.008, 742));
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      penLetters(ctx, text || 'PAUSED', 0, h * 0.13, h * 0.30,
                 { fill: '#c0562f', weight: 0.145, track: 0.11, seed: 743 });
      ctx.restore();
    },

    /** A bundle of notes with a coin leaning on it. */
    till: function (ctx, w, h) {
      var s2 = 751, b;
      for (b = 2; b >= 0; b--) {
        ink(ctx, rectPts(w * 0.10 + b * w * 0.02, h * 0.30 - b * h * 0.09, w * 0.64, h * 0.34, h * 0.06, w * 0.008, s2 + b),
            b === 0 ? '#cfe0b4' : '#bcd39c', { lw: Math.max(1.1, w * 0.014), line: '#5c7a3a', seed: s2 + b });
      }
      ink(ctx, ellPts(w * 0.34, h * 0.30, w * 0.10, h * 0.14, 14, w * 0.006, s2 + 5), '#8fb35f', { lw: Math.max(1, w * 0.012), line: '#5c7a3a', seed: s2 + 5 });
      ink(ctx, ellPts(w * 0.78, h * 0.66, w * 0.16, h * 0.22, 16, w * 0.006, s2 + 6), '#f4c93f', { lw: Math.max(1.1, w * 0.014), line: '#8a6416', seed: s2 + 6 });
      ink(ctx, ellPts(w * 0.78, h * 0.66, w * 0.10, h * 0.14, 14, w * 0.005, s2 + 7), '#f7dc7a', { lw: Math.max(1, w * 0.010), line: '#8a6416', lineAlpha: 0.7, seed: s2 + 7 });
    },

    /** A swing tag: notched left edge, punched hole, the price written on it. */
    priceTag: function (ctx, w, h, text) {
      var s3 = 761;
      var pts = [[w * 0.16, h * 0.10], [w * 0.94, h * 0.12], [w * 0.92, h * 0.88],
                 [w * 0.16, h * 0.90], [w * 0.05, h * 0.50]];
      ink(ctx, pts, '#e8a021', { lw: Math.max(1.4, w * 0.014), off: w * 0.008, line: '#3f2a1c', seed: s3 });
      ctx.save();
      ctx.fillStyle = '#3f2a1c';
      ctx.globalAlpha = 0.85;
      trace(ctx, ellPts(w * 0.19, h * 0.50, w * 0.045, h * 0.075, 12, w * 0.004, s3 + 1));
      ctx.fill();
      ctx.restore();
      penLetters(ctx, text || '$0', w * 0.58, h * 0.66, h * 0.34,
                 { fill: '#3f2a1c', weight: 0.14, track: 0.06, seed: s3 + 2 });
    }
  };

  var SCENE = {
    THEMES: SCENE_THEMES,
    floor: drawFloor,
    wall: drawWall,
    counter: drawCounter,
    crate: drawCrate,
    grill: drawGrill,
    plate: drawPlate,
    plateSeat: plateSeat,
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
 *   opts.prop  false to leave the hand prop out (portraits crop at the shoulders)
   */
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
    drawUpgrade: drawUpgrade,
    UPGRADES: UPGRADE_IDS,
    drawChef: drawChef,
    chefPose: chefPose,
    SAUCES: SAUCES,
    has: function (id) { return !!LAYERS[id]; },
    // hand-drawn toolkit, exported so game.js can draw counters, crates and the
    // grill with the same pen instead of clean rounded rectangles
    ink: ink,
    hatch: hatch,
    trace: trace,
    jitter: jitter,
    rectPts: rectPts,
    ellPts: ellPts,
    blobPts: blobPts,
    crescentPts: crescentPts,
    scene: SCENE,
    ui: UI,
    glyph: drawGlyph,
    drawLogo: drawLogo,
    INK: INK
  };
})(typeof self !== 'undefined' ? self : this);
