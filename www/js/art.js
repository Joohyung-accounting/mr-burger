/*
 * Mr. Burger - procedural ingredient art.
 * Every ingredient is drawn with canvas paths, so the app ships zero image
 * assets and every layer scales to any size without going soft.
 *
 * Layers are drawn into a box: (x, y) is the top-left, w is the *bun* width.
 * Each ingredient picks its own width and height relative to that.
 */
(function (root) {
  'use strict';

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

  /** Stable pseudo-random so sesame seeds and char marks never jitter. */
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

  /** A band with sine-wave top and bottom edges - lettuce, bacon, sauces. */
  function wavyBand(ctx, x, y, w, h, amp, waves, phase) {
    var step = Math.max(1.5, w / 34), i;
    ctx.beginPath();
    ctx.moveTo(x, y + amp * Math.sin(phase));
    for (i = 0; i <= w; i += step) {
      ctx.lineTo(x + i, y + amp * Math.sin((i / w) * waves * Math.PI * 2 + phase));
    }
    for (i = w; i >= 0; i -= step) {
      ctx.lineTo(x + i, y + h + amp * Math.sin((i / w) * waves * Math.PI * 2 + phase + 2.1));
    }
    ctx.closePath();
  }

  /* --------------------------------------------------------- ingredients */
  // hFrac / wFrac are multiples of the bun width.
  var LAYERS = {

    bunBottom: {
      hFrac: 0.24, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        rr(ctx, x, y, w, h, h * 0.55);
        ctx.fillStyle = grad(ctx, x, y, y + h, '#e9b571', '#c07f3d');
        ctx.fill();
        // toasted face
        rr(ctx, x + w * 0.03, y, w * 0.94, h * 0.30, h * 0.15);
        ctx.fillStyle = 'rgba(255,229,180,0.55)';
        ctx.fill();
      }
    },

    bunTop: {
      hFrac: 0.40, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        // dome: flat bottom, curved crown
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + h * 0.62);
        ctx.bezierCurveTo(x, y - h * 0.10, x + w, y - h * 0.10, x + w, y + h * 0.62);
        ctx.lineTo(x + w, y + h);
        ctx.closePath();
        ctx.fillStyle = grad(ctx, x, y, y + h, '#f0c081', '#c98545');
        ctx.fill();

        // gloss
        ctx.save();
        ctx.clip();
        ctx.beginPath();
        ctx.ellipse(x + w * 0.34, y + h * 0.34, w * 0.22, h * 0.20, -0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,240,205,0.45)';
        ctx.fill();
        ctx.restore();

        // sesame seeds
        ctx.fillStyle = '#fff6df';
        for (var i = 0; i < 7; i++) {
          var sx = x + w * (0.16 + hash(i * 3 + 1) * 0.68);
          var sy = y + h * (0.25 + hash(i * 5 + 2) * 0.42);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate((hash(i * 7 + 3) - 0.5) * 1.6);
          ctx.beginPath();
          ctx.ellipse(0, 0, w * 0.036, w * 0.020, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    },

    patty: {
      hFrac: 0.18, wFrac: 1.03,
      /*
       * opts.done  0 = raw beef out of the crate, 1 = properly seared
       * opts.char  0 = none, 1 = written off
       * Anything drawn without opts (a ticket, a menu icon) shows the patty the
       * customer is picturing: cooked.
       */
      draw: function (ctx, x, y, w, h, opts) {
        var done = opts && typeof opts.done === 'number' ? opts.done : 1;
        var char = (opts && opts.char) || 0;

        var top = mixHex('#e2887e', '#7c4527', done);
        var bot = mixHex('#b8544f', '#4a2716', done);
        if (char > 0) {
          top = mixHex(top, '#33241c', char);
          bot = mixHex(bot, '#1a100c', char);
        }

        rr(ctx, x, y, w, h, h * 0.42);
        ctx.fillStyle = grad(ctx, x, y, y + h, top, bot);
        ctx.fill();

        ctx.save();
        ctx.clip();

        var i, px, py;
        // Raw mince is pale fat through red meat; cooked mince is dark pitting.
        if (done < 0.85) {
          ctx.fillStyle = 'rgba(248,226,214,' + (0.62 * (1 - done)) + ')';
          for (i = 0; i < 11; i++) {
            px = x + hash(i * 17 + 3) * w;
            py = y + hash(i * 19 + 8) * h;
            ctx.beginPath();
            ctx.ellipse(px, py, w * 0.022 + hash(i * 5) * w * 0.014, h * 0.13, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          // wet sheen along the top of raw meat
          ctx.fillStyle = 'rgba(255,255,255,' + (0.20 * (1 - done)) + ')';
          rr(ctx, x + w * 0.10, y + h * 0.12, w * 0.80, h * 0.22, h * 0.11);
          ctx.fill();
        }
        if (done > 0.15) {
          ctx.fillStyle = 'rgba(0,0,0,' + (0.17 * done) + ')';
          for (i = 0; i < 14; i++) {
            px = x + hash(i * 11 + 5) * w;
            py = y + hash(i * 13 + 6) * h;
            ctx.beginPath();
            ctx.arc(px, py, w * 0.016 + hash(i) * w * 0.012, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // grill bars, once there has been enough contact to leave any
        if (done > 0.65 || char > 0) {
          var mark = Math.min(1, (done - 0.65) / 0.35 + char);
          ctx.strokeStyle = 'rgba(0,0,0,' + (0.30 + 0.45 * char) + ')';
          ctx.lineWidth = Math.max(1.5, h * 0.14);
          ctx.lineCap = 'round';
          ctx.globalAlpha = mark;
          for (i = 0; i < 3; i++) {
            var lx = x + w * (0.22 + i * 0.26);
            ctx.beginPath();
            ctx.moveTo(lx, y + h * 0.24);
            ctx.lineTo(lx + w * 0.10, y + h * 0.78);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    },

    /*
     * Cheese pushed to a warm orange and given corners.
     *
     * It used to be the same yellow as mustard, and at ticket scale - two or
     * three pixels of height - "a yellow thing" was all either of them read as.
     * Orange against mustard's acid yellow separates them by hue, and the
     * square corners poking past the bun separate them by silhouette, which is
     * the half that survives when the layer is too thin to have a colour.
     */
    cheese: {
      hFrac: 0.11, wFrac: 1.12,
      draw: function (ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.18);
        ctx.lineTo(x + w * 0.5, y);
        ctx.lineTo(x + w, y + h * 0.18);
        ctx.lineTo(x + w, y + h * 0.72);
        ctx.lineTo(x, y + h * 0.72);
        ctx.closePath();
        ctx.fillStyle = grad(ctx, x, y, y + h, '#ffb238', '#ef7f11');
        ctx.fill();
        // melted corners hanging past the bun
        ctx.fillStyle = '#f79413';
        [0.10, 0.44, 0.80].forEach(function (f, i) {
          var dw = w * 0.14;
          var dh = h * (0.8 + hash(i * 17) * 1.3);
          ctx.beginPath();
          ctx.moveTo(x + w * f, y + h * 0.6);
          ctx.lineTo(x + w * f + dw, y + h * 0.6);
          ctx.lineTo(x + w * f + dw * 0.5, y + h * 0.6 + dh);
          ctx.closePath();
          ctx.fill();
        });
      }
    },

    lettuce: {
      hFrac: 0.14, wFrac: 1.10,
      draw: function (ctx, x, y, w, h) {
        wavyBand(ctx, x, y + h * 0.18, w, h * 0.62, h * 0.30, 3.5, 0.4);
        ctx.fillStyle = grad(ctx, x, y, y + h, '#8ed765', '#4f9e34');
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = Math.max(1, h * 0.08);
        ctx.stroke();
      }
    },

    tomato: {
      hFrac: 0.11, wFrac: 0.94,
      draw: function (ctx, x, y, w, h) {
        rr(ctx, x, y, w, h, h * 0.42);
        ctx.fillStyle = grad(ctx, x, y, y + h, '#f0554b', '#c22e26');
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = 'rgba(255,160,150,0.55)';
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + w * (0.22 + i * 0.28), y + h * 0.5, w * 0.09, h * 0.30, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    },

    onion: {
      hFrac: 0.095, wFrac: 0.90,
      draw: function (ctx, x, y, w, h) {
        ctx.strokeStyle = '#c9a6dd';
        ctx.lineWidth = Math.max(1.4, h * 0.26);
        for (var i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + w * (0.22 + i * 0.28), y + h * 0.5, w * 0.13, h * 0.34, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(150,105,185,0.75)';
        ctx.lineWidth = Math.max(1, h * 0.10);
        for (i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + w * (0.22 + i * 0.28), y + h * 0.5, w * 0.13, h * 0.34, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },

    // Four ingredients on this line are green, so they are separated by how
    // dark they are and by what shape they make, not by being green.
    // Pickle is the dark olive one, cut into wide coins.
    pickle: {
      hFrac: 0.085, wFrac: 0.84,
      draw: function (ctx, x, y, w, h) {
        for (var i = 0; i < 4; i++) {
          var cx = x + w * (0.14 + i * 0.24);
          ctx.beginPath();
          ctx.ellipse(cx, y + h * 0.5, w * 0.11, h * 0.48, 0, 0, Math.PI * 2);
          ctx.fillStyle = grad(ctx, x, y, y + h, '#9aa832', '#5f6a18');
          ctx.fill();
          ctx.strokeStyle = 'rgba(30,40,8,0.6)';
          ctx.lineWidth = Math.max(1, h * 0.12);
          ctx.stroke();
        }
      }
    },

    bacon: {
      hFrac: 0.11, wFrac: 0.98,
      draw: function (ctx, x, y, w, h) {
        for (var i = 0; i < 2; i++) {
          wavyBand(ctx, x, y + h * (0.06 + i * 0.46), w, h * 0.36, h * 0.16, 2.5, i * 1.9);
          ctx.fillStyle = grad(ctx, x, y, y + h, '#c94b34', '#8e2f1f');
          ctx.fill();
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = 'rgba(255,205,195,0.75)';
          ctx.lineWidth = Math.max(1.2, h * 0.11);
          ctx.beginPath();
          ctx.moveTo(x, y + h * (0.18 + i * 0.46));
          for (var px = 0; px <= w; px += Math.max(2, w / 24)) {
            ctx.lineTo(x + px, y + h * (0.18 + i * 0.46) + Math.sin(px / w * 5 + i * 2) * h * 0.10);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    },

    // Vivid emerald rings with a pale eye - the most saturated green on the
    // line, and the only one made of small circles.
    jalapeno: {
      hFrac: 0.08, wFrac: 0.82,
      draw: function (ctx, x, y, w, h) {
        for (var i = 0; i < 6; i++) {
          var cx = x + w * (0.08 + i * 0.17);
          ctx.beginPath();
          ctx.arc(cx, y + h * 0.5, h * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = '#0f9b4c';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, y + h * 0.5, h * 0.2, 0, Math.PI * 2);
          ctx.fillStyle = '#f2ffd9';
          ctx.fill();
        }
      }
    },

    egg: {
      hFrac: 0.14, wFrac: 1.00,
      draw: function (ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.04, y + h * 0.62);
        for (var a = 0; a <= 24; a++) {
          var t = a / 24 * Math.PI * 2;
          var rad = 1 + Math.sin(t * 5) * 0.07;
          ctx.lineTo(
            x + w * 0.5 + Math.cos(t) * w * 0.46 * rad,
            y + h * 0.55 + Math.sin(t) * h * 0.42 * rad
          );
        }
        ctx.closePath();
        ctx.fillStyle = '#fffaf0';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + w * 0.5, y + h * 0.52, w * 0.15, h * 0.30, 0, 0, Math.PI * 2);
        ctx.fillStyle = grad(ctx, x, y, y + h, '#ffd54a', '#f5a623');
        ctx.fill();
      }
    },

    // The pale yellow-green one, in long overlapping fans rather than coins,
    // so it does not read as pickle with the lights turned up.
    avocado: {
      hFrac: 0.10, wFrac: 0.92,
      draw: function (ctx, x, y, w, h) {
        for (var i = 0; i < 5; i++) {
          var cx = x + w * (0.10 + i * 0.20);
          ctx.beginPath();
          ctx.ellipse(cx, y + h * 0.5, w * 0.09, h * 0.5, 0.55, 0, Math.PI * 2);
          ctx.fillStyle = grad(ctx, x, y, y + h, '#d7ea94', '#9cc45c');
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = Math.max(0.8, h * 0.07);
          ctx.stroke();
        }
      }
    }
  };

  // The 'bun' crate and the bun a customer orders both show the crown.
  LAYERS.bun = LAYERS.bunTop;

  /* -------------------------------------------------------------- sauces */
  /*
   * Four sauces that were four wavy bands in four colours - and colour is the
   * first thing to go when a layer is three pixels tall. Ketchup and BBQ
   * scored as the single most confusable pair in the whole set.
   *
   * Each one gets its own drizzle now: how many passes it makes, how tight the
   * wave is, and whether it is glossy, matte or speckled. Two of those survive
   * being shrunk, where the colour on its own did not.
   */
  var SAUCES = {
    ketchup: { fill: '#e02b1d', waves: 3.0, amp: 0.30, passes: 1, gloss: 0.26 },
    mustard: { fill: '#f2d115', waves: 5.5, amp: 0.34, passes: 1, gloss: 0.30 },
    mayo:    { fill: '#f6efe2', waves: 2.0, amp: 0.20, passes: 2, gloss: 0.12 },
    bbq:     { fill: '#4a2411', waves: 3.0, amp: 0.26, passes: 1, gloss: 0.0, speck: '#a2643a' },
    special: { fill: '#ff8fab', waves: 4.0, amp: 0.30, passes: 1, gloss: 0.24 }
  };

  Object.keys(SAUCES).forEach(function (id) {
    var S = SAUCES[id];
    LAYERS[id] = {
      hFrac: 0.065, wFrac: 0.88,
      sauce: true,
      draw: function (ctx, x, y, w, h) {
        for (var p = 0; p < S.passes; p++) {
          var oy = y + h * (0.14 + p * 0.34);
          wavyBand(ctx, x, oy, w, h * (S.passes > 1 ? 0.34 : 0.58), h * S.amp, S.waves, 0.9 + p * 1.7);
          ctx.fillStyle = S.fill;
          ctx.fill();
          if (S.gloss > 0) {
            wavyBand(ctx, x, oy, w, h * 0.20, h * S.amp, S.waves, 0.9 + p * 1.7);
            ctx.fillStyle = 'rgba(255,255,255,' + S.gloss + ')';
            ctx.fill();
          }
        }
        if (S.speck) {
          ctx.fillStyle = S.speck;
          for (var i = 0; i < 7; i++) {
            var sx = x + w * (0.08 + i * 0.13);
            ctx.beginPath();
            ctx.arc(sx, y + h * (0.34 + hash(i * 31) * 0.34), Math.max(0.6, h * 0.11), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };
  });

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
   * bigger than the head. Realistic proportions read as a smudge at 44px.
   *
   * opts: {
   *   face: 1|-1, bob: 0..1 walk phase, blink: 0..1, hop: 0..1,
   *   carry: fn(ctx, cx, baseY, maxW, maxH) -> halfWidth
   * }
   *
   * `carry` draws whatever the cook is holding as a real object down at hip
   * height, and gets called at the right point in the z-order: after the body
   * and head, before the hands close around it.
   */
  function drawChef(ctx, x, y, s, opts) {
    opts = opts || {};
    var face = opts.face >= 0 ? 1 : -1;
    var swing = Math.sin((opts.bob || 0) * Math.PI * 2);
    var hop = opts.hop || 0;
    var blink = opts.blink || 0;

    // squash and stretch on the little arrival hop
    var sx = 1 + hop * 0.12, sy = 1 - hop * 0.14;
    var cy = y - Math.abs(swing) * s * 0.045 - hop * s * 0.10;

    // shadow stays put on the floor while the body bobs
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.26 * (1 + hop * 0.15), s * 0.075, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(70,40,30,0.28)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(sx, sy);
    ctx.translate(-x, -cy);

    // Little legs. The swing is wide on purpose: fewer, bigger steps read as
    // walking, where a small fast shuffle reads as scurrying.
    ctx.fillStyle = '#6b4d7a';
    rr(ctx, x - s * 0.15 + swing * s * 0.085, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.055);
    ctx.fill();
    rr(ctx, x + s * 0.03 - swing * s * 0.085, cy - s * 0.16, s * 0.12, s * 0.16, s * 0.055);
    ctx.fill();

    // rounded chef whites
    var bw = s * 0.44, bh = s * 0.32;
    rr(ctx, x - bw / 2, cy - s * 0.46, bw, bh, s * 0.15);
    ctx.fillStyle = grad(ctx, x, cy - s * 0.46, cy - s * 0.14, '#ffffff', '#ecdcc6');
    ctx.fill();
    // neckerchief
    ctx.fillStyle = '#ef7d6b';
    rr(ctx, x - s * 0.13, cy - s * 0.47, s * 0.26, s * 0.075, s * 0.035);
    ctx.fill();
    // buttons
    ctx.fillStyle = 'rgba(190,160,130,0.7)';
    ctx.beginPath(); ctx.arc(x, cy - s * 0.33, s * 0.019, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy - s * 0.24, s * 0.019, 0, Math.PI * 2); ctx.fill();

    // hands stay at the sides unless something is being carried
    var handSpread = bw / 2 + s * 0.01, handY = cy - s * 0.30;

    // big round head
    var hy = cy - s * 0.62, hr = s * 0.215;
    ctx.beginPath();
    ctx.arc(x, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#f7cfa4';
    ctx.fill();

    // rosy cheeks
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#f4948a';
    ctx.beginPath(); ctx.ellipse(x - hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + hr * 0.55, hy + hr * 0.28, hr * 0.24, hr * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // eyes - squashed flat mid-blink
    var ex = face * hr * 0.10, eo = hr * 0.34, ey = hy - hr * 0.02;
    ctx.fillStyle = '#54382a';
    var open = 1 - blink;
    if (open > 0.12) {
      ctx.beginPath(); ctx.ellipse(x + ex - eo, ey, hr * 0.10, hr * 0.13 * open, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + ex + eo, ey, hr * 0.10, hr * 0.13 * open, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#54382a';
      ctx.lineWidth = Math.max(1, hr * 0.09);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + ex - eo - hr * 0.09, ey); ctx.lineTo(x + ex - eo + hr * 0.09, ey);
      ctx.moveTo(x + ex + eo - hr * 0.09, ey); ctx.lineTo(x + ex + eo + hr * 0.09, ey);
      ctx.stroke();
    }

    // smile
    ctx.strokeStyle = '#54382a';
    ctx.lineWidth = Math.max(1, hr * 0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x + ex, hy + hr * 0.22, hr * 0.24, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();

    // big puffy toque
    rr(ctx, x - hr * 0.98, hy - hr * 1.06, hr * 1.96, hr * 0.42, hr * 0.16);
    ctx.fillStyle = '#fffdf7';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - hr * 0.52, hy - hr * 1.34, hr * 0.50, hr * 0.44, 0, 0, Math.PI * 2);
    ctx.ellipse(x + hr * 0.52, hy - hr * 1.34, hr * 0.50, hr * 0.44, 0, 0, Math.PI * 2);
    ctx.ellipse(x, hy - hr * 1.56, hr * 0.58, hr * 0.50, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // whatever the cook is carrying, held out in front at hip height
    if (opts.carry) {
      // Held low, in front of the waist. Raising it any further would put a
      // tall burger straight over the face.
      var carryY = cy - s * 0.05;
      var half = opts.carry(ctx, x, carryY, s * 0.76, s * 0.46);
      handSpread = Math.max(s * 0.18, (half || s * 0.30) * 0.94);
      handY = carryY - s * 0.04;
    }

    ctx.fillStyle = '#f7cfa4';
    ctx.beginPath(); ctx.arc(x - handSpread, handY, s * 0.062, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + handSpread, handY, s * 0.062, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  /**
   * Single-layer icon centred in a w x h box at the current origin.
   * Deliberately does NOT clear: it is composited into scenes as well as onto
   * dedicated canvases, and clearing punched holes in the kitchen behind it.
   */
  function drawIcon(ctx, id, w, h, opts) {
    var L = layerOf(id);
    // Buns and the patty read better slightly smaller; thin layers need scaling up.
    var bun = Math.min(w / Math.max(L.wFrac, 1), h / Math.max(L.hFrac, 0.16) * 0.9);
    var lh = L.hFrac * bun;
    drawLayer(ctx, id, w / 2, (h - lh) / 2, bun, opts);
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
    drawChef: drawChef,
    SAUCES: SAUCES,
    has: function (id) { return !!LAYERS[id]; }
  };
})(typeof self !== 'undefined' ? self : this);
