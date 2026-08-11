/*
 * Mr. Burger - the kitchen.
 *
 * The whole game is one room. Stations live at fixed places on the floor and the
 * chef has to walk to them, so the difficulty is routing and timing, not memory.
 *
 *   crates (top wall)  ->  grill (left wall)  ->  plates (right wall)  ->  hatch
 *
 * One rule covers every station: empty hands TAKE, full hands GIVE.
 *
 * Rules and money live in core.js; food is drawn by art.js.
 */
(function () {
  'use strict';

  var Core = window.Core, Art = window.Art, Sfx = window.Sfx, Bgm = window.Bgm;
  var Net = window.Net || { online: false, send: function () {}, leave: function () {},
    init: function () { return Promise.resolve(this); }, push: function () {},
    pull: function () { return Promise.resolve(null); },
    leaderboard: function () { return Promise.resolve(null); },
    makeCode: function () { return Promise.resolve(null); },
    claim: function () { return Promise.resolve({ error: 'offline' }); },
    setName: function () { return Promise.resolve(false); },
    connect: function () {}, newRoomCode: function () { return 'LOCAL'; } };
  var SAVE_KEY = 'mb_save_v2';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  /** Catmull-Rom through p1..p2, using p0 and p3 to pick the tangents. */
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function buzz(ms) {
    if (!S.muted && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  /* ------------------------------------------------------- shell feedback */
  /*
   * Two things the canvas cannot say, because they are about the whole app and
   * not about one station.
   *
   * flash() tints the entire shell for half a second on a verdict. The banner
   * already names what happened, but a player watching the grill has not
   * looked up yet - the tint reaches them anyway, sage for a plate that landed
   * and tomato for one that came back.
   *
   * setRush() turns the room tense when the board is close to boiling over. It
   * reads the same pressure number the backing track arranges to, so what you
   * hear and what you see are one fact rather than two. Hysteresis either side
   * of the line, or a board sitting exactly on it strobes.
   *
   * Both are decoration on a DOM the game does not otherwise need: if the node
   * is missing or the stub has no classList, the shift carries on regardless.
   */
  var flashNode = null;
  function flash(kind) {
    if (!flashNode) flashNode = document.getElementById('flash');
    if (!flashNode) return;
    try {
      flashNode.className = '';
      void flashNode.offsetWidth;        // restart it when the same verdict repeats
      flashNode.className = kind;
    } catch (e) { /* the banner already said it */ }
  }

  var rushOn = false;
  function setRush(heat) {
    var next = rushOn ? heat > 0.55 : heat > 0.72;
    if (next === rushOn) return;
    rushOn = next;
    try {
      document.body.classList.toggle('rush', rushOn);
    } catch (e) { /* no shell to warm up */ }
  }

  /* -------------------------------------------------------------- palette */
  /*
   * The ramps the shell is built from ("Organic": cream ground, terracotta
   * accent, sage second voice, plus the alarm role the game adds for things
   * going wrong). Canvas cannot read CSS variables without a getComputedStyle
   * per frame, so the steps this file actually paints with are copied here -
   * same values, same names, one place to retune. See css/style.css.
   */
  var C = {
    paper: '#f9f4ed',      // neutral-100
    ink: '#2e2b25',        // neutral-900
    quiet: '#82796a',      // neutral-600
    sageInk: '#56633f',    // accent-2-700
    sage: '#aebf92',       // accent-2-400
    sageLift: '#ccdbb2',   // accent-2-300
    warm: '#f6a06b',       // accent-400
    warmDeep: '#d67f48',   // accent-500
    burnt: '#402310',      // accent-900
    alarm: '#d2543c'       // alarm-500
  };

  /* A ladder from sage to tomato: how well it went, said in the palette's own
     two voices rather than in traffic lights borrowed from somewhere else. */
  var VERDICT = {
    perfect: { text: 'PERFECT!', color: C.sageLift },
    great: { text: 'GREAT', color: C.sage },
    good: { text: 'GOOD', color: C.warm },
    meh: { text: 'THEY\'LL TAKE IT', color: C.warmDeep },
    bad: { text: 'SENT IT BACK!', color: C.alarm }
  };

  /* ----------------------------------------------------------------- type */
  /*
   * The same two faces the shell sets: Caprasimo for the things that shout,
   * Figtree for the things that label. Figtree stops at 700, so nothing here
   * asks for 900 and gets a synthesised bold that does not match the HUD an
   * inch above it. Fallbacks match the CSS, for a first launch with no network.
   */
  var FONT_FALLBACK = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  function fontBody(size, weight) {
    return (weight || 700) + ' ' + size + 'px "Figtree", ' + FONT_FALLBACK;
  }
  function fontDisplay(size) {
    return '400 ' + size + 'px "Caprasimo", ' + FONT_FALLBACK;
  }

  /* ----------------------------------------------------------------- state */
  var cv, ctx, L = {}, el = {};
  var uid = 0;

  var S = {
    screen: 'title',
    day: 1, bestDay: 1, money: 0, levels: {}, muted: false,
    fx: Core.effects({}),

    hearts: 5, sales: 0, tips: 0, served: 0, walked: 0, perfect: 0,
    lifetime: 0,
    spawned: 0, spawnTimer: 0, cfg: null, rent: 0, menu: [],
    timeLeft: 0, dayLength: 0,   // the shift clock; see Core.dayLength
    closedBy: null,              // 'clock' when the buzzer ended it

    tickets: [],   // { uid, arch, items, patience, max, node, barEl }
    plates: [],    // { stack: [{id, cook}] }
    grill: [],     // { id, t } | null
    // One cook in single player, two in co-op. S.me is which one this device
    // drives; S.chef below stays a live alias to it so the rest of the game
    // reads exactly as it did before.
    chefs: [],
    me: 0,
    role: 'solo',        // solo | host | guest
    peer: false,         // is the other cook connected
    snapSeq: 0,
    bannerId: 0,
    lastBannerId: -1,
    roomCode: null,
    reconnectTries: 0,
    coopStarted: false,
    snapInterval: 80,    // measured ms between host snapshots
    lastSnapAt: 0,
    clockOff: null,      // host clock -> ours; see hostToLocal()
    hostPaused: false,   // guest side: the host has the pause menu open
    renderT: null,       // the moment in the buffer we are showing; playoutTime()

    floats: [], sparks: [], banner: null, shake: 0,
    flyers: [], cratePop: [], binPop: 0,
    musicTimer: 0,
    paused: false,       // tab hidden
    userPaused: false,   // pause menu open
    cramped: false       // screen too short to hit the stations; see showCramped
  };

  function makeChef() {
    return {
      x: 0, y: 0, tx: 0, ty: 0, target: null, holding: null,
      phase: 0, face: 1, blink: 0, blinkIn: 2, hop: 0,
      px: 0, py: 0, lerp: 1
    };
  }
  S.chefs = [makeChef()];

  // Keeps every `S.chef.…` in the rest of the file pointing at the local cook.
  Object.defineProperty(S, 'chef', {
    get: function () { return S.chefs[S.me] || S.chefs[0]; }
  });

  function chefAt(i) { return S.chefs[i] || S.chefs[0]; }
  function coop() { return S.role === 'host' || S.role === 'guest'; }

  /** Is any cook on their way to this station? Drives the yellow highlight. */
  function targeted(kind, i) {
    for (var k = 0; k < S.chefs.length; k++) {
      var t = S.chefs[k].target;
      if (t && t.kind === kind && (i === undefined || t.i === i)) return true;
    }
    return false;
  }

  /** True if any cook is carrying a finished plate - lights the hatch up. */
  function anyPlateHeld() {
    for (var k = 0; k < S.chefs.length; k++) {
      var h = S.chefs[k].holding;
      if (h && h.kind === 'plate') return true;
    }
    return false;
  }

  /* ----------------------------------------------------------- persistence */
  function save() {
    var blob = {
      day: S.day, bestDay: S.bestDay, money: S.money, levels: S.levels, muted: S.muted, lifetime: S.lifetime || 0
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
    } catch (e) { /* private mode: play without persistence */ }
    // Mirrored to the cloud when signed in. Debounced inside Net, and never
    // allowed to fail into the game loop.
    Net.push(blob, S.bestDay, S.lifetime || 0);
  }

  // A save is JSON from a device - it can be truncated, hand-edited, or synced
  // down from another install - so it goes through the rules before it goes
  // anywhere near the game. See Core.sanitiseSave for what that means.
  function load() {
    try {
      return Core.sanitiseSave(JSON.parse(localStorage.getItem(SAVE_KEY)));
    } catch (e) { return null; }
  }

  function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  /* --------------------------------------------------------------- palette */
  /* The app chrome is dark; the kitchen itself is a bright little room lit
     from above. Food art reads far better against cream than against brown. */
  /*
   * The room, the counters, the crates and the crockery are all drawn by
   * art.js now, from the six kitchen palettes it owns - see decor(). What is
   * left here is the two appliances that keep their own colours whatever the
   * decor is, plus the ink the HUD writes in.
   */
  var K = {
    grillTop: '#57403a', grillTop2: '#3d2b26', grillSide: '#241713',
    plateTop: '#fffaf1', plateTop2: '#f0e5d6', plateSide: '#c9b499',
    ink: '#643312',                       // accent-800
    inkSoft: 'rgba(100,51,18,0.55)',
    hot: C.alarm,
    go: C.sage,
    pick: C.warm
  };

  var DEPTH = { counter: 10, crate: 7, grill: 11, plate: 10, hatch: 11 };

  /* ---------------------------------------------------------------- layout */
  // The whole line lives on one shelf: eight boxes side by side beats three
  // labelled rows, and the boxes get tall enough to look like boxes.
  var CRATE_MAX_W = 84, GAP = 6, HATCH_H = 46;
  var SLOT_H = 42, PLATE_H = 50, CHEF_S = 54;

  // The kitchen the speeds in core.js were tuned against: a 412x360 stage.
  // Every other screen scales its walking speed relative to this.
  var REF_FLOOR_DIAG = 282;
  /*
   * Strides it takes to walk the floor's diagonal.
   *
   * Measured against the cook's own height instead, the cadence came out at
   * 2.07 steps/s on a phone and 2.86 on a desktop: the character stops growing
   * at the k cap of 1.5 while the room and the walking speed keep going, so the
   * legs had to spin faster to keep up. Pinning strides to the room instead
   * makes the cadence identical everywhere by construction - and 3.1 of them
   * per diagonal is a stride, not the scurry it was doing before.
   */
  var STRIDES_PER_DIAG = 3.1;

  function menuLen() { return (S.menu && S.menu.length) || 1; }

  /**
   * Box size for today's line.
   *
   * Width is capped: on day 1 there are only two crates, and letting them split
   * the whole counter made each one half a screen wide. Height follows width so
   * a box stays box-shaped whether there are two of them or eight.
   */
  function crateSize(W) {
    var n = menuLen();
    var gap = Math.min(GAP, (W - 16) * 0.02);
    var w = Math.min((W - 16 - gap * (n - 1)) / n, CRATE_MAX_W);
    return { w: w, h: clamp(w * 1.02, 54, 92), gap: gap, n: n };
  }

  /** The height the room needs at its most compact, before any growing. */
  function compactHeight() {
    var gN = S.grill.length || 2, pN = S.plates.length || 2;
    return 8 + crateSize(cv.clientWidth || 400).h + 12
      + Math.max(150, gN * SLOT_H + (gN - 1) * GAP, pN * PLATE_H + (pN - 1) * GAP)
      + 10 + HATCH_H + 8;
  }

  function resize() {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    showCramped();
  }

  // A finger needs something to aim at. Below this the stations are still drawn
  // correctly, they are just too small to hit on purpose.
  var MIN_TAPPABLE = 22;

  /**
   * The room is laid out top to bottom, so a short viewport squeezes the
   * stations rather than the floor - and a phone turned sideways leaves them
   * around 15px tall. Rather than guess at screen sizes in a media query, key
   * off the size the stations actually came out at.
   */
  function showCramped() {
    var cramped = L.slotH < MIN_TAPPABLE || L.plateH < MIN_TAPPABLE;
    if (cramped === S.cramped) return;
    S.cramped = cramped;
    if (document.body && document.body.classList) {
      document.body.classList.toggle('cramped', cramped);
    }
    // Coming back from it, the loop has been idle: don't hand it a huge dt.
    if (!cramped) last = 0;
  }

  function layout() {
    var W = cv.clientWidth, H = cv.clientHeight;
    var oldFloor = L.floor;          // to carry the cooks across, see below
    L.W = W; L.H = H;
    L.pad = 8;

    /* The whole room scales to the screen rather than just stretching the
       floor: a big phone would otherwise mean a longer walk, and a small one
       would squeeze the stations out of existence between the shelves and
       the hatch. */
    /*
     * Quantised on purpose. A phone's address bar grows and shrinks the
     * viewport by a few pixels as you touch the screen, and feeding that
     * straight into the room scale made the whole kitchen shimmer back and
     * forth on the first day. Steps of 24px absorb that; the canvas itself
     * still tracks the exact size so nothing stretches.
     */
    var k = clamp(Math.round(H / 24) * 24 / compactHeight(), 0.72, 1.5);
    var gap = GAP * k;
    L.gap = gap;
    L.k = k;
    L.chefS = CHEF_S * k;      // the cook grows with the room, not against it

    // Tonight's floor plan. Worked out from the day alone so a guest lands in
    // the same kitchen as the host; see Core.dayRoom.
    var room = Core.dayRoom(S.day || 1);
    L.room = room;

    /* --- the line along the top wall: every box on one shelf, sized to fit.
       dayMenu() already returns buns, then toppings, then sauces, so the row
       stays organised left to right without needing labelled sections. */
    // Crates size themselves off the screen width, not off k - they are already
    // width-constrained, and scaling them again just made them enormous.
    var box = crateSize(W);
    L.crateW = box.w;
    L.crateH = box.h;
    L.crates = [];
    var rowW = box.n * box.w + (box.n - 1) * box.gap;
    var y = L.pad + 4;
    var slack = W - rowW;                      // room the row does not fill

    /*
     * Where the line sits along the wall. On a busy day the row fills the width
     * and all of these collapse to the same thing, but early on - two or three
     * crates on a wide shelf - it is the difference between the same kitchen
     * every night and a room you have to actually look at.
     */
    var x0 = slack / 2;
    var splitAt = -1;
    if (!room.plain && slack > box.w * 0.6) {
      if (room.line === 'left') x0 = Math.min(slack, box.gap * 2);
      else if (room.line === 'right') x0 = slack - Math.min(slack, box.gap * 2);
      else if (room.line === 'split' && box.n >= 4) {
        // two shorter runs with the wall showing between them
        splitAt = Math.ceil(box.n / 2);
        x0 = slack / 2 - Math.min(slack / 2, box.gap * 1.5);
      }
    }

    var extra = splitAt > 0 ? Math.min(slack, box.gap * 3) : 0;
    for (var c = 0; c < box.n; c++) {
      L.crates[c] = {
        x: x0 + c * (box.w + box.gap) + (splitAt > 0 && c >= splitAt ? extra : 0),
        y: y, w: box.w, h: box.h
      };
    }
    L.cratesBottom = y + box.h;
    // one counter run, bleeding off both edges of the room
    L.counters = [{ x: -8, y: L.pad - 3, w: W + 16, h: box.h + 12 }];

    // --- serving hatch and bin along the bottom wall. The bin changes ends
    // with the room, so "throw it away" is not always the same corner.
    L.hatchH = HATCH_H * k;
    L.hatchY = H - L.pad - L.hatchH;
    L.binW = 52 * k;
    var binRight = !room.plain && room.bin === 'right';
    L.binX = binRight ? W - L.pad - L.binW : L.pad;
    L.hatchX = binRight ? L.pad : L.pad + L.binW + gap;
    L.hatchW = W - L.pad * 2 - L.binW - gap;

    // --- the two working walls. Which one is the grill changes every shift.
    L.midTop = L.cratesBottom + 10 * k;
    L.midBottom = L.hatchY - 10 * k;
    L.colW = clamp(W * 0.19, 62, 92);
    var leftX = L.pad, rightX = W - L.pad - L.colW;
    var grillLeft = room.plain || room.grill === 'left';
    L.grillX = grillLeft ? leftX : rightX;
    L.plateX = grillLeft ? rightX : leftX;

    var midH = L.midBottom - L.midTop;
    var gN = S.grill.length || 2, pN = S.plates.length || 2;
    L.slotH = Math.min(SLOT_H * k, (midH - gap * (gN - 1)) / gN);
    L.plateH = Math.min(PLATE_H * k, (midH - gap * (pN - 1)) / pN);
    L.grillTop = L.midTop + (midH - (gN * L.slotH + (gN - 1) * gap)) / 2;
    L.plateTop = L.midTop + (midH - (pN * L.plateH + (pN - 1) * gap)) / 2;

    // --- the walkable floor: whatever is left between the two walls
    L.floor = {
      x0: leftX + L.colW + 16,
      x1: rightX - 16,
      y0: L.cratesBottom + 16,
      y1: L.hatchY - 14
    };

    /*
     * Walking speed is quoted in pixels, but a kitchen on a tablet is nearly
     * twice the width of one on a small phone - at a fixed px/s the same shift
     * took 1.1s to cross on a phone and 2.0s on a desktop. Since the whole
     * difficulty model is "walking time is the load", that made the game about
     * twice as hard on a big screen. Scale the speed with the room so a
     * traverse costs the same wherever it is played.
     */
    var diag = Math.hypot(L.floor.x1 - L.floor.x0, L.floor.y1 - L.floor.y0);
    L.walkScale = clamp(diag / REF_FLOOR_DIAG, 0.6, 2.2);
    L.stride = Math.max(10, diag / STRIDES_PER_DIAG);

    /*
     * Carry the cooks across the relayout.
     *
     * A cook's x/y are absolute pixels, so when the room moves underneath them
     * - which a phone does constantly, because the address bar slides away the
     * moment you tap PLAY and keeps resizing the viewport for a few hundred
     * milliseconds - they used to stay nailed to their old screen position and
     * visibly skate around the kitchen. Worse, tx/ty were snapshotted from the
     * station rect back when the walk was ordered, so the cook was heading for
     * a spot the counter had since moved away from, then snapped when it
     * arrived. That is the stutter in the opening seconds.
     *
     * Remap position by where they were in the old floor, and re-derive the
     * target from the station itself, which is authoritative.
     */
    for (var ci = 0; ci < S.chefs.length; ci++) {
      var c = S.chefs[ci];
      if (!c.x) {
        // never placed: middle of the floor, spread apart so two cooks do not
        // start standing on top of each other
        var frac = S.chefs.length > 1 ? (ci === 0 ? 0.35 : 0.65) : 0.5;
        c.x = L.floor.x0 + (L.floor.x1 - L.floor.x0) * frac;
        c.y = (L.floor.y0 + L.floor.y1) / 2;
        c.tx = c.x; c.ty = c.y;
        c.px = c.x;
        continue;
      }
      if (oldFloor) {
        c.x = remap(c.x, oldFloor.x0, oldFloor.x1, L.floor.x0, L.floor.x1);
        c.y = remap(c.y, oldFloor.y0, oldFloor.y1, L.floor.y0, L.floor.y1);
        c.px = c.x;
      }
      if (c.target) {
        var p = standPoint(c.target);
        c.tx = p.x; c.ty = p.y;
      } else if (oldFloor) {
        c.tx = c.x; c.ty = c.y;
      }
    }
  }

  /** Same relative spot, new box. Degenerate boxes just take the new middle. */
  function remap(v, a0, a1, b0, b1) {
    var span = a1 - a0;
    if (!(span > 0.001)) return (b0 + b1) / 2;
    return b0 + ((v - a0) / span) * (b1 - b0);
  }

  function crateRect(i) {
    return L.crates[i] || { x: 0, y: 0, w: 0, h: 0 };
  }

  function slotRect(i) {
    return { x: L.grillX, y: L.grillTop + i * (L.slotH + L.gap), w: L.colW, h: L.slotH };
  }

  function plateRect(i) {
    return { x: L.plateX, y: L.plateTop + i * (L.plateH + L.gap), w: L.colW, h: L.plateH };
  }

  function hatchRect() { return { x: L.hatchX, y: L.hatchY, w: L.hatchW, h: L.hatchH }; }
  function binRect() { return { x: L.binX, y: L.hatchY, w: L.binW, h: L.hatchH }; }

  /**
   * Where the chef stands to work a station - always inside the floor, and
   * always on the side of it the station is actually on.
   *
   * This used to name the edges outright: the grill was f.x0 and the plates
   * were f.x1, which was true right up until the room started moving them.
   * Once the grill could be on the right wall, tapping it walked the cook to
   * the left edge - where the plates now were - and the grill's business was
   * then done from in front of the plates. Ask the rect which wall it is on.
   */
  function standPoint(t) {
    var f = L.floor, r;
    if (t.kind === 'crate') {
      r = crateRect(t.i);
      return { x: clamp(r.x + r.w / 2, f.x0, f.x1), y: nearEdge(r, f, 'y') };
    }
    if (t.kind === 'grill' || t.kind === 'plate') {
      r = t.kind === 'grill' ? slotRect(t.i) : plateRect(t.i);
      return { x: nearEdge(r, f, 'x'), y: clamp(r.y + r.h / 2, f.y0, f.y1) };
    }
    if (t.kind === 'hatch' || t.kind === 'bin') {
      r = t.kind === 'hatch' ? hatchRect() : binRect();
      return { x: clamp(r.x + r.w / 2, f.x0, f.x1), y: nearEdge(r, f, 'y') };
    }
    return { x: clamp(t.x, f.x0, f.x1), y: clamp(t.y, f.y0, f.y1) };
  }

  /** Whichever edge of the floor this rect is closest to, along one axis. */
  function nearEdge(r, f, axis) {
    var mid = axis === 'x' ? r.x + r.w / 2 : r.y + r.h / 2;
    var lo = axis === 'x' ? f.x0 : f.y0;
    var hi = axis === 'x' ? f.x1 : f.y1;
    return Math.abs(mid - lo) <= Math.abs(mid - hi) ? lo : hi;
  }

  /** Which station is under this canvas point? */
  function stationAt(x, y) {
    function inside(r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
    var i;
    for (i = 0; i < menuLen(); i++) if (inside(crateRect(i))) return { kind: 'crate', i: i };
    for (i = 0; i < S.grill.length; i++) if (inside(slotRect(i))) return { kind: 'grill', i: i };
    for (i = 0; i < S.plates.length; i++) if (inside(plateRect(i))) return { kind: 'plate', i: i };
    if (inside(hatchRect())) return { kind: 'hatch' };
    if (inside(binRect())) return { kind: 'bin' };
    return { kind: 'floor', x: x, y: y };
  }

  /* ------------------------------------------------------------------- fx */
  function float(text, x, y, color, size) {
    S.floats.push({ text: text, x: x, y: y, color: color || C.paper, size: size || 14, t: 0, max: 1.05 });
  }

  /*
   * Each banner gets its own id. The snapshot used to stamp banners with the
   * ever-incrementing snapshot counter, so a guest saw a "new" banner on every
   * packet and restarted the pop-in animation fifteen times a second - which is
   * exactly what the flashing DAY screen was.
   */
  function banner(title, sub, color) {
    S.bannerId++;
    S.banner = {
      title: title, sub: sub || '', color: color || C.paper,
      t: 0, max: 1.3, id: S.bannerId
    };
  }

  function spark(x, y, n, color, kind) {
    for (var i = 0; i < n; i++) {
      if (S.sparks.length > 300) return;
      var steam = kind === 'steam';
      S.sparks.push({
        kind: kind || 'spark',
        x: x + rnd(-8, 8), y: y,
        vx: steam ? rnd(-9, 9) : rnd(-40, 40),
        vy: steam ? rnd(-34, -18) : rnd(-90, -26),
        t: 0,
        max: steam ? rnd(0.9, 1.5) : rnd(0.3, 0.7),
        size: steam ? rnd(3.5, 6.5) : rnd(1.2, 2.8),
        color: color || 'rgba(255,225,170,0.95)'
      });
    }
  }

  /**
   * Lift an item out of its box: the box recoils, the item arcs across to the
   * cook. Purely cosmetic - the game state already changed - but the hands stay
   * empty until it lands, so the two never show the same thing twice.
   */
  function pullFromBox(index, id, ci) {
    var r = crateRect(index);
    if (!r || !r.w) return;
    var c = chefAt(ci || 0);
    var cs = L.chefS || CHEF_S;
    S.cratePop[index] = 1;
    S.flyers.push({
      id: id, chef: ci || 0,
      done: Core.byId(id) && Core.byId(id).grill ? 0 : undefined,
      char: 0,
      x0: r.x + r.w / 2, y0: r.y + r.h * 0.42,
      x1: c.x, y1: c.y - cs * 0.22,
      // ends at exactly the size the hands will hold it, so nothing jumps
      w: cs * 0.76, lift: 24, spin: 1,
      t: 0, max: 0.26
    });
  }

  /**
   * The other half of pullFromBox, running the other way.
   *
   * The rules already fired the instant the cook arrived - the hands are empty
   * and the plate has the layer on it - so this is only the thing itself
   * finishing the journey: an arc down onto the burner or the plate over a
   * fifth of a second, shrinking to the size it will sit at. Without it a patty
   * teleported from a fist to a grill between two frames, which is what made
   * the kitchen feel like a state machine rather than a place.
   *
   * `fixed` is what separates the two directions: an incoming flyer chases the
   * cook, who is usually still walking, and an outgoing one must not - it is
   * aimed at a station that does not move.
   */
  function dropOnto(kind, i, id, x1, y1, w1, ci, look) {
    var c = chefAt(ci || 0);
    var cs = L.chefS || CHEF_S;
    S.flyers.push({
      id: id, chef: ci || 0, fixed: true, to: { kind: kind, i: i },
      done: look && look.done, char: look && look.char,
      x0: c.x, y0: c.y - cs * 0.22,
      x1: x1, y1: y1,
      w0: cs * 0.76, w: w1,
      lift: 14, spin: -0.5,
      t: 0, max: 0.2
    });
  }

  /*
   * A station with something still on its way draws itself without that thing.
   * The rules changed on arrival, so the plate already has the layer and the
   * burner already has the patty - and without this the same slice of cheese is
   * visibly in two places for a fifth of a second, which is worse than no
   * animation at all. pullFromBox solves the same problem at the other end by
   * leaving the hands empty until the item lands.
   */
  function inbound(kind, i) {
    for (var f = 0; f < S.flyers.length; f++) {
      var to = S.flyers[f].to;
      if (to && to.kind === kind && to.i === i) return true;
    }
    return false;
  }

  function nope(msg, ci) {
    var c = chefAt(ci || 0);
    if (msg) float(msg, c.x, c.y - CHEF_S - 14, C.alarm, 12);
    Sfx.reject();
  }

  /* --------------------------------------------------------------- tickets */
  function ticketOf(id) {
    for (var i = 0; i < S.tickets.length; i++) if (S.tickets[i].uid === id) return S.tickets[i];
    return null;
  }

  /*
   * Who actually walked in. The five archetypes are rules - how long they wait
   * and what they tip - and there are only five of them, so a board of five
   * tickets used to be five copies of the same face. Each archetype casts from
   * its own set of people instead: a Rush is somebody with somewhere to be, a
   * Kid is a child. Art.GUESTS has the fourteen.
   */
  var GUEST_CAST = {
    regular: ['office', 'student', 'artist', 'farmer', 'granny', 'grandpa'],
    rush:    ['office', 'courier', 'builder', 'police', 'nurse'],
    chill:   ['teen', 'artist', 'athlete', 'student', 'grandpa'],
    foodie:  ['office', 'artist', 'student', 'nurse', 'granny'],
    kid:     ['kid', 'baby', 'kid', 'teen']
  };

  var GUEST_OK = {};
  Art.GUESTS.forEach(function (id) { GUEST_OK[id] = true; });

  function castGuest(archId) {
    var cast = GUEST_CAST[archId] || GUEST_CAST.regular;
    return cast[Math.floor(Math.random() * cast.length) % cast.length];
  }

  function spawnTicket() {
    var arch = Core.pickCustomer(S.day, Math.random);
    var order = Core.makeOrder(S.day, Math.random, arch);
    var secs = S.cfg.patience * arch.patience;
    S.tickets.push({
      uid: ++uid, arch: arch, guest: castGuest(arch.id), items: order.items,
      patience: secs, max: secs, tick: 0
    });
    S.spawned++;
    Sfx.doorbell();
    renderBoard();
  }

  function dropTicket(t, cssClass) {
    if (t.node) t.node.classList.add(cssClass || 'leaving');
    var i = S.tickets.indexOf(t);
    if (i >= 0) S.tickets.splice(i, 1);
    setTimeout(renderBoard, 320);
  }

  function walkout(t) {
    S.walked++;
    S.hearts--;
    dropTicket(t);
    banner('WALKED OUT', t.arch.name + ' gave up waiting', C.alarm);
    S.shake = 14;
    Sfx.walkout();
    buzz([30, 40, 60]);
    syncHud();
    if (S.hearts <= 0) endDay();
  }

  /* -------------------------------------------------------------- day loop */
  /**
   * Tell the board how tall a ticket can get today, before any ticket exists.
   *
   * A ticket was as tall as its order was long, so the board went from 42px to
   * 165px the moment the first customer arrived - and the kitchen, which lives
   * on whatever is left over, lost a quarter of its height in a single frame.
   * A jump that size reads to the size watchdog as a rotation, so it relaid the
   * whole room immediately: three seconds into every shift the kitchen visibly
   * snapped smaller. It then twitched again each time a longer order landed.
   *
   * The longest order a day can produce is knowable from the day alone.
   * makeOrder() takes at most `maxExtras` distinct extras, and from day 8 it may
   * add a second patty - which is one more row, because orderList() only counts
   * patties when there is more than one. Reserve that and the board holds still
   * until tomorrow, when the shop screen is covering the change anyway.
   */
  function reserveBoard(day) {
    var cfg = Core.dayConfig(day);
    var rows = cfg.maxExtras + ((day >= 8 && cfg.maxExtras >= 2) ? 1 : 0);
    try {
      document.documentElement.style.setProperty('--order-rows', Math.max(1, rows));
    } catch (e) { /* a stubbed DOM has no style object; the board just flows */ }
  }

  function startDay(day) {
    hideModal(el.dayEnd);
    hideModal(el.shop);
    hideModal(el.over);
    hideModal(el.pause);
    S.userPaused = false;

    S.day = day;
    S.cfg = Core.dayConfig(day);
    S.rent = Core.dayGoal(day);
    S.fx = Core.effects(S.levels, day);
    S.menu = Core.dayMenu(day);
    S.sections = Core.menuSections(day);
    reserveBoard(day);

    S.hearts = Core.START_HEARTS;
    S.sales = 0; S.tips = 0; S.served = 0; S.walked = 0; S.perfect = 0;
    S.spawned = 0; S.spawnTimer = 1.2;
    S.dayLength = Core.dayLength(day);
    S.timeLeft = S.dayLength;
    S.closedBy = null;
    S.tickets = [];
    S.plates = [];
    for (var i = 0; i < S.fx.plates; i++) S.plates.push({ stack: [] });
    S.grill = new Array(S.fx.grillSlots).fill(null);

    // two cooks in co-op, one otherwise
    var want = coop() ? 2 : 1;
    while (S.chefs.length < want) S.chefs.push(makeChef());
    S.chefs.length = want;
    if (S.me >= want) S.me = 0;
    S.chefs.forEach(function (c) {
      c.holding = null; c.target = null; c.x = 0;   // re-centred by layout()
    });

    S.floats.length = 0;
    S.sparks.length = 0;
    S.flyers.length = 0;
    S.cratePop = [];
    S.banner = null;
    S.screen = 'service';

    resize();
    renderBoard();
    syncHud();
    banner('DAY ' + day, 'RENT ' + Core.money(S.rent), C.warm);
  }

  function endDay() {
    if (S.screen !== 'service') return;
    S.screen = 'dayEnd';
    S.chef.target = null;
    S.userPaused = false;
    hideModal(el.pause);
    var total = S.sales + S.tips;
    var ranOut = S.hearts <= 0;
    var passed = !ranOut && total >= S.rent;

    if (passed) {
      S.money += total - S.rent;
      S.lifetime = (S.lifetime || 0) + total;
      S.bestDay = Math.max(S.bestDay, S.day);
      save();
      Sfx.fanfare();
    } else {
      Sfx.fail();
    }
    showDayEnd(passed, ranOut, total);
  }

  /* ------------------------------------------------------------- pause menu */
  function setPaused(on) {
    if (S.screen !== 'service' && on) return;
    S.userPaused = !!on;
    if (S.userPaused) {
      S.chef.target = null;          // don't let a queued walk resolve later
      Bgm.stop();
      el.pauseDay.textContent = S.day;
      el.pauseEarned.textContent = Core.money(S.sales + S.tips);
      el.pauseRent.textContent = Core.money(S.rent);
      el.pauseSoundBtn.textContent = 'SOUND: ' + (S.muted ? 'OFF' : 'ON');
      showModal(el.pause);
      Sfx.tap();
    } else {
      hideModal(el.pause);
      Bgm.start();
      last = 0;                      // don't hand the loop a huge dt
    }
  }

  function quitToTitle() {
    setPaused(false);
    Bgm.stop();
    if (coop()) endCoop();
    S.screen = 'title';
    S.tickets = [];
    S.chef.holding = null;
    S.chef.target = null;
    renderBoard();
    var saved = load();
    el.continueBtn.hidden = !saved;
    if (saved) el.continueDay.textContent = saved.day;
    showModal(el.start);
  }

  /* -------------------------------------------------------- the chef works */
  function sendChef(target, ci) {
    if (S.screen !== 'service') return;
    var c = chefAt(ci || 0);
    c.target = target;
    var p = standPoint(target);
    c.tx = p.x;
    c.ty = p.y;
  }

  /** Fired when the chef reaches whatever the player tapped. */
  function arrive(t, ci) {
    ci = ci || 0;
    var me = chefAt(ci);
    var hold = me.holding;

    if (t.kind === 'crate') {
      var id = S.menu[t.i];
      if (hold) { nope('HANDS FULL', ci); return; }
      // No `cook` yet: that absence is what stops a raw patty reaching a plate.
      me.holding = { kind: 'ing', id: id, done: 0, char: 0 };
      pullFromBox(t.i, id, ci);
      Sfx.lift();
      buzz(8);
      return;
    }

    if (t.kind === 'grill') {
      var g = S.grill[t.i];
      if (hold && hold.kind === 'ing' && Core.byId(hold.id) && Core.byId(hold.id).grill) {
        if (g) { nope('BURNER BUSY', ci); return; }
        // Put a half-cooked patty back and it carries on from where it was.
        // Resetting to 0 turned a seared patty raw again the moment it touched
        // the grill a second time.
        S.grill[t.i] = { id: hold.id, t: hold.grillT || 0 };
        me.holding = null;
        var gr = slotRect(t.i);
        dropOnto('grill', t.i, hold.id, gr.x + gr.w / 2, gr.y + gr.h * 0.58, gr.w * 0.62, ci, hold);
        Sfx.sizzle();
        buzz(12);
        return;
      }
      if (!hold && g) {
        var q = Core.cookQuality(g.t, S.fx.perfectWindow);
        var stage = Core.cookStage(g.t, S.fx.perfectWindow);
        var look = Core.cookLook(g.t, S.fx.perfectWindow);
        // grillT rides along so the patty can go back on and keep cooking
        me.holding = {
          kind: 'ing', id: g.id, cook: q,
          done: look.done, char: look.char, grillT: g.t
        };
        S.grill[t.i] = null;
        var r = slotRect(t.i);
        if (stage === 'perfect') {
          float('PERFECT SEAR', r.x + r.w / 2 + 34, r.y, K.go, 12);
          spark(r.x + r.w / 2, r.y + r.h / 2, 12, 'rgba(174,191,146,0.95)');
          Sfx.perfect();
          buzz(20);
        } else if (stage === 'burnt') {
          float('BURNT', r.x + r.w / 2 + 30, r.y, C.alarm, 12);
          Sfx.burnt();
        } else {
          float(stage === 'raw' ? 'UNDERDONE' : 'OVERDONE', r.x + r.w / 2 + 34, r.y,
            stage === 'raw' ? '#3d7fbf' : C.warmDeep, 11);
          Sfx.thud();
        }
        return;
      }
      nope(hold ? 'THAT DOESN\'T GRILL' : 'BURNER IS EMPTY', ci);
      return;
    }

    if (t.kind === 'plate') {
      var p = S.plates[t.i];
      if (hold && hold.kind === 'ing') {
        if (Core.byId(hold.id).grill && hold.cook === undefined) {
          nope('GRILL IT FIRST', ci);
          return;
        }
        p.stack.push({
          id: hold.id,
          cook: hold.cook === undefined ? 1 : hold.cook,
          done: hold.done, char: hold.char      // how it should look, not what it scores
        });
        me.holding = null;
        var pr = plateRect(t.i);
        dropOnto('plate', t.i, hold.id, pr.x + pr.w / 2, pr.y + pr.h * 0.58, pr.w * 0.58, ci, hold);
        var ing = Core.byId(hold.id);
        if (ing && ing.kind === 'sauce') Sfx.squirt(); else Sfx.stack(p.stack.length);
        buzz(8);
        return;
      }
      if (hold && hold.kind === 'plate') {
        if (p.stack.length) { nope('PLATE IN USE', ci); return; }
        p.stack = hold.stack;
        me.holding = null;
        Sfx.tap();
        return;
      }
      if (!hold && p.stack.length) {
        me.holding = { kind: 'plate', stack: p.stack };
        p.stack = [];
        Sfx.lift();
        buzz(10);
        return;
      }
      nope('NOTHING ON THAT PLATE', ci);
      return;
    }

    if (t.kind === 'hatch') {
      if (!hold || hold.kind !== 'plate') { nope('CARRY A PLATE OVER', ci); return; }
      deliver(hold.stack);
      me.holding = null;
      return;
    }

    if (t.kind === 'bin') {
      if (!hold) { nope('NOTHING TO BIN', ci); return; }
      me.holding = null;
      S.binPop = 1;
      float('BINNED', binRect().x + binRect().w / 2, L.hatchY - 16, K.ink, 12);
      Sfx.trash();
      return;
    }
  }

  /* --------------------------------------------------------------- serving */
  function deliver(stack) {
    if (!S.tickets.length) { nope('NO ORDERS UP'); return; }
    var t = Core.bestMatch(S.tickets, stack);

    var res = Core.payout({
      orderItems: t.items,
      built: stack,
      patienceRatio: t.patience / t.max,
      customer: t.arch,
      tipMult: S.fx.tipMult
    });

    S.sales += res.pay;
    S.tips += res.tip;
    S.hearts -= res.heartLoss;
    if (res.verdict === 'perfect') S.perfect++;
    if (res.verdict !== 'bad') S.served++;

    var v = VERDICT[res.verdict];
    // On anything short of great, name the worst thing wrong with it - a
    // rejected plate with no explanation just reads as the game being unfair.
    var worst = res.faults && res.faults.length ? res.faults[0] : null;
    var sub;
    if (res.total > 0) {
      sub = (worst && res.verdict !== 'perfect' && res.verdict !== 'great')
        ? t.arch.emoji + '  ' + worst.label + '  ·  ' + Core.money(res.total)
        : t.arch.emoji + '  ' + Core.money(res.pay) + ' + ' + Core.money(res.tip) + ' tip';
    } else {
      sub = t.arch.emoji + '  ' + (worst ? worst.label : 'no sale');
    }
    banner(v.text, sub, v.color);

    var h = hatchRect();
    if (res.total > 0) {
      float('+' + Core.money(res.total), h.x + h.w / 2, h.y - 22, K.go, 18);
      spark(h.x + h.w / 2, h.y - 8, 18, 'rgba(246,160,107,0.95)');
      Sfx.register();
      buzz(res.verdict === 'perfect' ? [15, 25, 35] : 15);
      flash('good');
    } else {
      S.shake = 16;
      Sfx.buzzer();
      buzz([50, 40, 50]);
      flash('bad');
    }

    dropTicket(t, 'served');
    syncHud();
    // Whether that was the last ticket is update()'s business, on the next
    // frame. Deciding it here as well is how the shift used to fail to end
    // when the last customer walked out instead of being served, and how the
    // receipt then missed that the buzzer was what closed the place.
  }

  /* --------------------------------------------------------------- update */
  function update(dt) {
    var i;

    for (i = S.floats.length - 1; i >= 0; i--) {
      S.floats[i].t += dt;
      S.floats[i].y -= 28 * dt;
      if (S.floats[i].t >= S.floats[i].max) S.floats.splice(i, 1);
    }
    for (i = S.sparks.length - 1; i >= 0; i--) {
      var p = S.sparks[i];
      p.t += dt;
      if (p.kind === 'steam') { p.vy *= 0.985; p.vx *= 0.98; }
      else { p.vy += 210 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t >= p.max) S.sparks.splice(i, 1);
    }
    if (S.banner) {
      S.banner.t += dt;
      if (S.banner.t >= S.banner.max) S.banner = null;
    }
    S.shake = Math.max(0, S.shake - dt * 42);

    for (i = S.flyers.length - 1; i >= 0; i--) {
      var fl = S.flyers[i];
      fl.t += dt;
      // chase the cook, who is usually still walking
      if (!fl.fixed) {
        var fc = chefAt(fl.chef || 0);
        fl.x1 = fc.x;
        fl.y1 = fc.y - (L.chefS || CHEF_S) * 0.22;
      }
      if (fl.t >= fl.max) S.flyers.splice(i, 1);
    }
    for (i = 0; i < S.cratePop.length; i++) {
      if (S.cratePop[i] > 0) S.cratePop[i] = Math.max(0, S.cratePop[i] - dt * 4.5);
    }
    if (S.binPop > 0) S.binPop = Math.max(0, S.binPop - dt * 2.2);

    // --- walk every cook. A guest does not simulate: it eases toward the
    // positions the host last sent instead.
    var walkSpeed = S.fx.speed * (L.walkScale || 1);
    var stride = L.stride || 70;
    var frameNow = nowMs();
    var render = S.role === 'guest' ? playoutTime(dt * 1000) : 0;
    for (var ci = 0; ci < S.chefs.length; ci++) {
      var c = S.chefs[ci];
      c.blinkIn -= dt;
      if (c.blinkIn <= 0) { c.blink = 1; c.blinkIn = rnd(2.6, 6.0); }
      c.blink = Math.max(0, c.blink - dt * 7);
      c.hop = Math.max(0, c.hop - dt * 5);

      if (S.role === 'guest') {
        /*
         * Render a fixed delay behind live and interpolate linearly between the
         * two real samples that straddle that moment.
         *
         * Easing toward "the newest packet" - what this used to do - restarts a
         * curve on every arrival, so any jitter in packet spacing turns into a
         * speed change you can see. Reading from a buffer at a steady offset
         * gives constant velocity between samples and survives both jittery
         * packets and dropped frames, because it is keyed off the clock rather
         * than off dt.
         */
        var b = c.buf;
        if (!b || !b.length) { c.phase = 0; continue; }
        var ax = c.x, ay = c.y;

        if (render <= b[0].t) {
          ax = b[0].x; ay = b[0].y;
        } else {
          var j = b.length - 1;
          while (j > 0 && b[j].t > render) j--;
          var s0 = b[j], s1 = b[j + 1];
          if (!s1) {
            // starved of packets: hold the last known spot rather than guess
            ax = s0.x; ay = s0.y;
          } else {
            var k2 = clamp((render - s0.t) / Math.max(1, s1.t - s0.t), 0, 1);
            /*
             * A straight line between samples is continuous in position but not
             * in velocity: the cook changes direction, in one frame, at every
             * sample boundary. On a curved path that reads as a faint tick
             * twenty times a second - the last of the roughness. Run a
             * Catmull-Rom spline through the neighbours instead, which matches
             * the velocity across the join. Falls back to the straight line at
             * the ends of the buffer, where there is no neighbour to use.
             */
            var sm1 = b[j - 1] || s0, s2 = b[j + 2] || s1;
            ax = catmull(sm1.x, s0.x, s1.x, s2.x, k2);
            ay = catmull(sm1.y, s0.y, s1.y, s2.y, k2);
          }
          // keep one sample behind the render point so the spline has a "before"
          while (b.length > 3 && b[2].t < render) b.shift();
        }

        var moved = Math.hypot(ax - c.x, ay - c.y);
        c.x = ax; c.y = ay;
        if (moved > 0.15) {
          c.phase = (c.phase + moved / stride) % 1;
          if (moved > 0.6) c.face = ax > c.px ? 1 : -1;
          c.px = ax;
        } else {
          c.phase = 0;
        }
        continue;
      }

      var dx = c.tx - c.x, dy = c.ty - c.y;
      var d = Math.hypot(dx, dy);
      if (d > 1.5) {
        var step = Math.min(d, walkSpeed * dt);
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
        // legs keep pace with the ground covered, not with the clock
        c.phase = (c.phase + step / stride) % 1;
        if (Math.abs(dx) > 2) c.face = dx > 0 ? 1 : -1;
      } else {
        c.phase = 0;
        if (c.target) {
          var t = c.target;
          c.target = null;
          c.hop = 1;                       // little bounce on arrival
          arrive(t, ci);
        }
      }
    }

    if (S.screen !== 'service') return;

    // A guest renders what the host sends and simulates none of it.
    if (S.role === 'guest') { updateBoardBars(); syncClock(); return; }

    for (i = 0; i < S.grill.length; i++) {
      if (S.grill[i]) {
        S.grill[i].t += dt;
        var r = slotRect(i);
        if (Math.random() < dt * 5) {
          spark(r.x + r.w * 0.5, r.y + r.h * 0.45, 1, 'rgba(255,190,120,0.75)');
        }
        if (Math.random() < dt * 3.5) {
          spark(r.x + r.w * 0.5, r.y + r.h * 0.3, 1, 'rgba(255,255,255,0.5)', 'steam');
        }
      }
    }

    /*
     * The shift clock. Runs down only while the kitchen is actually open, so
     * the pause menu and the tab going away do not cost the player anything -
     * update() is not called in either case.
     *
     * Nobody new comes in once it is out: the last few minutes of a shift
     * should be about clearing the board, not being handed a fresh order you
     * cannot possibly finish.
     */
    var wasOpen = S.timeLeft > 0;
    S.timeLeft = Math.max(0, S.timeLeft - dt);
    if (wasOpen && S.timeLeft <= 0) {
      Sfx.warn();
      banner('LAST ORDERS', 'clear the board', C.warm);
    }

    if (S.timeLeft > 0 && S.spawned < S.cfg.customers && S.tickets.length < S.cfg.concurrent) {
      S.spawnTimer -= dt;
      if (S.spawnTimer <= 0) {
        spawnTicket();
        S.spawnTimer = rnd(S.cfg.spawnMin, S.cfg.spawnMax);
      }
    }

    for (i = S.tickets.length - 1; i >= 0; i--) {
      var tk = S.tickets[i];
      tk.patience -= dt;
      var ratio = tk.patience / tk.max;
      if (ratio < 0.25) {
        tk.tick -= dt;
        if (tk.tick <= 0) { Sfx.warn(); tk.tick = ratio < 0.12 ? 0.34 : 0.7; }
      }
      if (tk.patience <= 0) walkout(tk);
    }

    if (S.hearts <= 0) { endDay(); return; }

    // The shift is over when the last customer is gone, however they went.
    // This is the only place that decides it. It used to be checked where a
    // plate was handed over instead, so a last customer who walked out rather
    // than being served left the day running forever - an empty board, nothing
    // to spawn, and no way out but the pause menu.
    var noneLeftToCome = S.timeLeft <= 0 || S.spawned >= S.cfg.customers;
    if (noneLeftToCome && S.tickets.length === 0) {
      // The buzzer gets the credit whenever it went before the shift did,
      // whether that turned customers away at the door or just drew a line
      // under a board the player was still working through.
      if (S.timeLeft <= 0) S.closedBy = 'clock';
      endDay();
      return;
    }

    // The backing track leans on how close the board is to boiling over:
    // how full it is, and how near the worst ticket is to walking.
    S.musicTimer -= dt;
    if (S.musicTimer <= 0) {
      S.musicTimer = 0.5;
      var full = S.tickets.length / Math.max(1, S.cfg.concurrent);
      var worst = 0;
      for (i = 0; i < S.tickets.length; i++) {
        worst = Math.max(worst, 1 - S.tickets[i].patience / S.tickets[i].max);
      }
      var heat = full * 0.45 + worst * 0.55;
      Bgm.setIntensity(heat);
      setRush(heat);
    }

    updateBoardBars();
    syncClock();
  }

  /* ----------------------------------------------------------------- draw */
  function label(text, cx, y, color, size, align) {
    ctx.save();
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontBody(size || 8, 700);
    ctx.letterSpacing = '1.2px';
    ctx.fillStyle = color || K.inkSoft;
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  /*
   * The room never moves, but painting it cost ~110 floor tiles plus the wall
   * grid on every single frame - the largest fixed cost in the loop, and pure
   * waste. Bake it once per layout and blit it. Keyed on the layout numbers it
   * actually reads, so a resize rebuilds it and nothing else does.
   */
  /*
   * Tonight's decor. The plan picks one of these, so the room reads as a
   * different kitchen at a glance rather than the same one with the furniture
   * moved. Kept in the same warm family as the rest of the art - a burger place
   * that redecorates, not six unrelated games.
   *
   * The six palettes live in art.js now, because the floor and the wall are
   * drawn with the same pen as the food and they need the grout and tile-line
   * colours that go with each top. Same order, same counter colours as before.
   */
  var THEME_IDS = ['diner', 'tiles', 'sunset', 'night', 'brass', 'harbour'];

  function decor() {
    var i = (L.room && !L.room.plain) ? L.room.palette : 0;
    var T = Art.scene.THEMES;
    return T[THEME_IDS[i % THEME_IDS.length]] || T.diner;
  }

  var roomCache = null;
  function drawRoom() {
    var key = L.W + 'x' + L.H + ':' + L.cratesBottom + ':' + (L.k || 1) +
      ':' + (L.room ? L.room.palette + '/' + L.room.plain : '0');
    if (!roomCache || roomCache.key !== key) roomCache = bakeRoom(key);
    if (roomCache.cv) ctx.drawImage(roomCache.cv, 0, 0, L.W, L.H);
    else paintRoom(ctx);          // no offscreen canvas available, paint direct
  }

  function bakeRoom(key) {
    var made = { key: key, cv: null };
    if (!L.W || !L.H) return made;
    var off, g;
    try {
      off = document.createElement('canvas');
      var dpr = Math.min(window.devicePixelRatio || 1, 3);
      off.width = Math.round(L.W * dpr);
      off.height = Math.round(L.H * dpr);
      g = off.getContext('2d');
      if (!g) return made;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (e) { return made; }
    paintRoom(g);
    made.cv = off;
    return made;
  }

  function paintRoom(g) {
    var floorTop = L.cratesBottom + 8;
    var D = decor();

    // Subway-tiled back wall and a checkerboard floor, both drawn with the pen
    // that draws the food: the grout lines wobble and the tiles sit slightly
    // off their own outlines. Art.scene.floor does its own light falloff.
    Art.scene.wall(g, 0, 0, L.W, floorTop, D);
    Art.scene.floor(g, 0, floorTop, L.W, L.H - floorTop, D, Math.max(22, L.W / 10));

    // the counter casts onto the floor right below the line of crates
    var vg = g.createLinearGradient(0, floorTop, 0, floorTop + 46);
    vg.addColorStop(0, 'rgba(95,62,42,0.26)');
    vg.addColorStop(1, 'rgba(95,62,42,0)');
    g.fillStyle = vg;
    g.fillRect(0, floorTop, L.W, 46);
  }

  function drawCounter() {
    var D = decor();
    for (var i = 0; i < L.counters.length; i++) {
      var r = L.counters[i];
      Art.scene.counter(ctx, r.x, r.y, r.w, r.h, DEPTH.counter * (L.k || 1), D);
    }
  }

  /**
   * A guest framed head-and-shoulders in a w x h box whose top-left is the
   * current origin - the order board and the serving window both want that.
   *
   * Not Art.drawGuestFace, which anchors the feet and so frames a baby and a
   * builder by the same rule: the builder loses the top of his hard hat and the
   * baby sits half out of the bottom. Scaling to the box and standing them a
   * little below it puts all fourteen behind the same window.
   */
  function guestBust(g, id, w, h, mood) {
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    Art.drawGuest(g, w / 2, h * 1.28, h / 0.62, { type: id, mood: mood });
    g.restore();
  }

  /**
   * The ring that says "this is the station the cook is walking to". The slabs
   * used to draw it themselves; the hand-drawn kitchen objects don't, so it
   * lives here and goes on over the top of whichever one was tapped.
   */
  function pickRing(r, rad) {
    ctx.save();
    ctx.shadowColor = K.pick;
    ctx.shadowBlur = 12;
    Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.strokeStyle = K.pick;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * An open crate with the stock sitting down inside it.
   *
   * The order matters: back wall, then contents, then the FRONT panel over the
   * top of them. Without that last step the food reads as sitting on a tile
   * rather than being in a box.
   */
  function drawCrates() {
    for (var i = 0; i < S.menu.length; i++) {
      var r = crateRect(i);
      if (!r.w) continue;
      var id = S.menu[i];
      var ing = Core.byId(id) || {};
      var live = targeted('crate', i);
      var pop = S.cratePop[i] || 0;

      // the box recoils a little when something is pulled out of it
      ctx.save();
      if (pop > 0) {
        var cx0 = r.x + r.w / 2, cy0 = r.y + r.h;
        ctx.translate(cx0, cy0);
        ctx.scale(1 + pop * 0.06, 1 - pop * 0.08);
        ctx.translate(-cx0, -cy0);
      }

      // a slatted wooden crate with a shadowed inside, drawn in ink
      Art.scene.crate(ctx, r.x, r.y, r.w, r.h, decor());

      /* The crate holds the INGREDIENT, not a pile of burger layers: half an
         avocado with the stone in, a whole tomato with its calyx, a bottle of
         ketchup. Art.drawPortrait draws that; it falls back to the layer art
         for anything without a portrait of its own.

         It sits over the front slats rather than down behind them: a crate is
         44px wide and the box only leaves a third of that clear above its
         front, which is not enough of an avocado to recognise. */
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h * 0.86);
      ctx.clip();
      ctx.translate(r.x, r.y + r.h * 0.05);
      Art.drawPortrait(ctx, id, r.w, r.h * 0.80);
      ctx.translate(-r.x, -(r.y + r.h * 0.05));
      var sg = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * 0.35);
      sg.addColorStop(0, 'rgba(40,22,6,0.35)');
      sg.addColorStop(1, 'rgba(40,22,6,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(r.x, r.y, r.w, r.h * 0.35);
      ctx.restore();

      if (live) pickRing(r, 6);

      /*
       * A paper label nailed to the slats. It needs its own pale ground now
       * that the front is grained wood - ink on walnut is not readable at 44px.
       */
      var labH = Math.max(13, r.h * 0.30);
      var lab = { x: r.x + 2.5, y: r.y + r.h - labH - 1.5, w: r.w - 5, h: labH };
      Art.rr(ctx, lab.x, lab.y, lab.w, lab.h, 3);
      ctx.fillStyle = 'rgba(253,246,230,0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(111,69,38,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      /*
       * A band of the ingredient's own colour along the bottom of the crate,
       * the same colour as the square beside its name on a ticket. The board
       * says CHEESE next to an orange square; the crate to fetch it from wears
       * the same orange. One glance links them, without having to read either.
       */
      if (ing.swatch) {
        var bandH = Math.max(2.5, lab.h * 0.17);
        Art.rr(ctx, lab.x + 1.5, lab.y + lab.h - bandH - 1.5, lab.w - 3, bandH, bandH * 0.45);
        ctx.fillStyle = ing.swatch;
        ctx.fill();
      }

      // a warm tag on anything that has to be cooked first
      if (ing.grill) {
        Art.rr(ctx, lab.x + 1.5, lab.y + 2, 3.5, lab.h - 4, 1.8);
        ctx.fillStyle = K.hot;
        ctx.fill();
      }

      label(ing.short || ing.name || id, r.x + r.w / 2, lab.y + lab.h * 0.35, C.burnt,
        Math.min(8, r.w * 0.145));
      ctx.restore();
    }
  }

  /** Items arcing out of a box into the cook's hands. */
  function drawFlyers() {
    for (var i = 0; i < S.flyers.length; i++) {
      var fl = S.flyers[i];
      var p = clamp(fl.t / fl.max, 0, 1);
      var e = 1 - Math.pow(1 - p, 2.2);
      var x = fl.x0 + (fl.x1 - fl.x0) * e;
      var y = fl.y0 + (fl.y1 - fl.y0) * e - Math.sin(p * Math.PI) * fl.lift;
      var w0 = fl.w0 === undefined ? fl.w * 0.55 : fl.w0;
      var w = w0 + (fl.w - w0) * e;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((1 - e) * -0.5 * fl.spin);
      ctx.shadowColor = 'rgba(80,50,32,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;
      Art.drawLayer(ctx, fl.id, 0, -Art.heightOf(fl.id, w) / 2, w,
        { done: fl.done, char: fl.char });
      ctx.restore();
    }
  }

  function drawGrill() {
    // one grill unit with the burners recessed into its top
    var n = S.grill.length;
    var last = slotRect(n - 1);
    var body = {
      x: L.grillX - 3, y: L.grillTop - 16,
      w: L.colW + 6, h: (last.y + last.h) - L.grillTop + 22
    };
    // the chassis, in the same ink as the counters but in cast-iron colours
    Art.scene.counter(ctx, body.x, body.y, body.w, body.h, DEPTH.grill * (L.k || 1),
      { top: K.grillTop, top2: K.grillTop2, side: K.grillSide });
    label('GRILL', body.x + body.w / 2, L.grillTop - 8, '#ffc6a5', 8);

    var win = S.fx.perfectWindow;
    var tMax = Core.COOK_TIME + win / 2 + Core.BURN_TIME;

    for (var i = 0; i < S.grill.length; i++) {
      var r = slotRect(i);
      var g = S.grill[i];
      var live = targeted('grill', i);

      /*
       * One burner per slot. Drawn taller than the slot and cropped to it: the
       * control knobs live at 80% of the grill's height, which on a 42px slot
       * put two dials straight through the cooking timer. Off the bottom they
       * go, and the bars fill the slot instead of sharing it.
       */
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      Art.scene.grill(ctx, r.x, r.y - r.h * 0.10, r.w, r.h * 1.45, { hot: g ? 1 : 0 });
      ctx.restore();

      // embers under whatever is cooking
      if (g) {
        ctx.save();
        Art.rr(ctx, r.x, r.y, r.w, r.h, 10);
        ctx.clip();
        var eg = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h * 0.5, 2,
          r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.6);
        eg.addColorStop(0, 'rgba(255,120,50,0.30)');
        eg.addColorStop(1, 'rgba(255,120,50,0)');
        ctx.fillStyle = eg;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }

      if (live) {
        Art.rr(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, 11);
        ctx.strokeStyle = K.pick;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }

      if (!g) continue;

      var stage = Core.cookStage(g.t, win);
      var look = Core.cookLook(g.t, win);
      var pw = r.w * 0.72;
      var barTop = r.y + r.h - 13;
      if (!inbound('grill', i)) {
        var ph = Art.heightOf(g.id, pw);
        Art.drawLayer(ctx, g.id, r.x + r.w / 2, (r.y + barTop) / 2 - ph / 2, pw,
          { done: look.done, char: look.char });
      }

      if (stage === 'perfect') {
        ctx.save();
        ctx.shadowColor = 'rgba(174,191,146,0.95)';
        ctx.shadowBlur = 14;
        Art.rr(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 11);
        ctx.strokeStyle = K.go;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
      }

      var bx = r.x + 6, bw = r.w - 12, by = r.y + r.h - 10, bh = 5;
      Art.rr(ctx, bx, by, bw, bh, 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();
      var ps = (Core.COOK_TIME - win / 2) / tMax, pe = (Core.COOK_TIME + win / 2) / tMax;
      Art.rr(ctx, bx + bw * ps, by, bw * (pe - ps), bh, 2.5);
      ctx.fillStyle = 'rgba(174,191,146,0.6)';
      ctx.fill();
      Art.rr(ctx, bx, by, Math.max(2, bw * clamp(g.t / tMax, 0, 1)), bh, 2.5);
      ctx.fillStyle = stage === 'perfect' ? K.go
        : (stage === 'raw' ? '#7fb6e8' : (stage === 'over' ? C.warm : K.hot));
      ctx.fill();
    }
  }

  /**
   * How close this plate is to being somebody's order, 0..1. Only a plate that
   * is nearly right lights up - a halo on every plate with food on it would
   * say nothing.
   *
   * Scoring a plate against every waiting ticket is a dozen Core.evaluate calls
   * and the object churn that comes with them, and none of it can change
   * between two frames without a tap. Cached on the plate, refreshed 8 times a
   * second, which no eye can tell from every frame on a halo that fades in.
   */
  function plateGlow(p) {
    if (!p.stack || !p.stack.length) return 0;
    var now = nowMs();
    if (p.glowAt === undefined || now - p.glowAt >= 120) {
      p.glowAt = now;
      var best = 0;
      for (var i = 0; i < S.tickets.length; i++) {
        var q = Core.evaluate(S.tickets[i].items, p.stack).quality;
        if (q > best) best = q;
      }
      p.glow = clamp((best - 0.75) / 0.25, 0, 1);
    }
    return p.glow || 0;
  }

  function drawPlates() {
    // one plating bench with the plates sitting on it
    var n = S.plates.length;
    var last = plateRect(n - 1);
    var body = {
      x: L.plateX - 3, y: L.plateTop - 16,
      w: L.colW + 6, h: (last.y + last.h) - L.plateTop + 22
    };
    Art.scene.counter(ctx, body.x, body.y, body.w, body.h, DEPTH.plate * (L.k || 1),
      { top: K.plateTop, top2: K.plateTop2, side: K.plateSide });
    label('PLATES', body.x + body.w / 2, L.plateTop - 8, C.sageInk, 8);

    for (var i = 0; i < n; i++) {
      var r = plateRect(i);
      var p = S.plates[i];
      var live = targeted('plate', i);
      var cx = r.x + r.w / 2, py = r.y + r.h - 10;

      // A plate that would be taken as it stands wears a halo, so a finished
      // order is visible from across the room instead of needing to be read.
      Art.scene.plate(ctx, cx, py - 2, r.w * 0.80, { glow: plateGlow(p) });

      if (live) {
        Art.rr(ctx, r.x, r.y, r.w, r.h, 11);
        ctx.strokeStyle = K.pick;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }

      var built = inbound('plate', i) ? p.stack.slice(0, -1) : p.stack;
      if (!built.length) {
        label('EMPTY', cx, r.y + r.h * 0.42, 'rgba(111,74,51,0.35)', 7.5);
        continue;
      }
      var shown = Core.displayStack(built);
      var bw = Art.fitWidth(shown, r.w * 0.74, r.h - 16);
      Art.drawStack(ctx, shown, cx, py - 3, bw);
    }
  }

  function drawHatchAndBin() {
    var h = hatchRect();
    var live = targeted('hatch');
    var ready = anyPlateHeld();

    // a window onto the lit dining room, with an awning and a call bell. It
    // brightens the moment a finished plate is in someone's hands.
    Art.scene.hatch(ctx, h.x, h.y, h.w, h.h, decor(), { lit: ready ? 1 : 0.30 });

    /*
     * Somebody is actually standing there. The window used to say SERVE into an
     * empty lit hole; the person who has been waiting longest is a better sign
     * than the word, and their face sours as their bar runs down.
     */
    var next = S.tickets[0];
    if (next && next.guest) {
      ctx.save();
      ctx.translate(h.x + h.w * 0.07, h.y + h.h * 0.27);
      guestBust(ctx, next.guest, h.w * 0.86, h.h * 0.54,
        clamp(next.patience / next.max, 0, 1));
      ctx.restore();
    }

    // the prompt moves down to the sill so it does not sit across their face
    label(ready ? '▲  S E R V E  ▲' : S.tickets.length + ' waiting',
      h.x + h.w / 2, h.y + h.h * 0.87, ready ? C.sageInk : K.inkSoft, ready ? 9 : 7.5);
    if (live) pickRing(h, 14);

    var b = binRect();
    var bl = targeted('bin');
    // The lid flips up as something goes in. Same recoil timer the crates use.
    Art.scene.bin(ctx, b.x, b.y, b.w, b.h, { open: S.binPop || 0 });
    if (bl) pickRing(b, 14);
    label('BIN', b.x + b.w / 2, b.y + b.h * 0.99, K.inkSoft, 7);
  }

  /**
   * Draws whatever the cook is holding as the actual object - the real slice of
   * cheese, the real seared patty, the real plated burger - rather than an icon
   * in a floating card. Returns its half-width so the hands can close on it.
   */
  function drawCarried(g, cx, baseY, maxW, maxH, hold) {
    if (!hold) return 0;

    g.save();
    g.shadowColor = 'rgba(80,50,32,0.35)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;

    if (hold.kind === 'plate') {
      var shown = Core.displayStack(hold.stack);
      var bw = Art.fitWidth(shown, maxW * 0.78, maxH - 6);
      var pr = Math.max(bw * 0.62, maxW * 0.34);
      // the dish first, then the food standing on it
      g.beginPath();
      g.ellipse(cx, baseY, pr, pr * 0.26, 0, 0, Math.PI * 2);
      g.fillStyle = '#f4f8fb';
      g.fill();
      g.restore();
      g.beginPath();
      g.ellipse(cx, baseY, pr, pr * 0.26, 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(120,150,180,0.55)';
      g.lineWidth = 1.2;
      g.stroke();
      Art.drawStack(g, shown, cx, baseY - pr * 0.14, bw);
      return pr;
    }

    // a loose ingredient, carried as itself. Beef carries its doneness with it,
    // so raw / seared / burnt is readable without any badge.
    var w = maxW;
    var h = Art.heightOf(hold.id, w);
    if (h > maxH) { w *= maxH / h; h = maxH; }
    Art.drawLayer(g, hold.id, cx, baseY - h, w, { done: hold.done, char: hold.char });
    g.restore();
    return (Art.layerWidth(hold.id, w)) / 2;
  }

  function drawChefs() {
    var cs = L.chefS || CHEF_S;
    // painter's order: whoever is further down the floor is nearer the camera
    var order = S.chefs.map(function (c, i) { return i; })
      .sort(function (a, b) { return S.chefs[a].y - S.chefs[b].y; });

    order.forEach(function (i) {
      var c = S.chefs[i];
      var flying = S.flyers.some(function (f) { return (f.chef || 0) === i && !f.fixed; });
      // a marker so you can tell which cook is yours
      if (S.chefs.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + 2, cs * 0.30, cs * 0.10, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i === S.me ? 'rgba(174,191,146,0.95)' : 'rgba(90,134,184,0.9)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
      }
      Art.drawChef(ctx, c.x, c.y, cs, {
        face: c.face, bob: c.phase, blink: c.blink, hop: c.hop,
        // hands stay empty while the item is still in the air
        carry: (c.holding && !flying)
          ? function (g, cx, baseY, maxW, maxH) {
            return drawCarried(g, cx, baseY, maxW, maxH, c.holding);
          }
          : null
      });
    });
  }

  function drawFloats() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < S.floats.length; i++) {
      var f = S.floats[i];
      var t = f.t / f.max;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = fontDisplay(f.size);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(46,43,37,0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawSparks() {
    ctx.save();
    for (var i = 0; i < S.sparks.length; i++) {
      var p = S.sparks[i];
      var f = p.t / p.max;
      if (p.kind === 'steam') {
        // puffs swell and thin out as they climb
        ctx.globalAlpha = Math.sin(Math.min(1, f) * Math.PI) * 0.45;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + f * 1.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /*
   * The band used to be scaled along with the text, so during the pop-in it was
   * narrower than the screen - a dark stripe hanging in mid-air - and then
   * easeOutBack overshot it past both edges, which pushed its soft ends off
   * screen and turned them into hard cuts. Read as the card "coming up wrong".
   * The band now stays exactly screen-width and opens vertically; only the
   * lettering pops.
   */
  function drawBanner() {
    if (!S.banner) return;
    var b = S.banner, t = b.t / b.max;
    var open = t < 0.16 ? easeOutCubic(t / 0.16) : 1;         // band shutter
    var pop = t < 0.30 ? easeOutBack(clamp(t / 0.30, 0, 1)) : 1;  // lettering
    var alpha = t > 0.72 ? clamp(1 - (t - 0.72) / 0.28, 0, 1) : 1;

    var size = Math.min(L.W * 0.07, 24);
    var bh = size * (b.sub ? 2.5 : 1.7);
    var cy = (L.floor.y0 + L.floor.y1) / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    var band = ctx.createLinearGradient(0, 0, L.W, 0);
    band.addColorStop(0, 'rgba(46,43,37,0)');
    band.addColorStop(0.18, 'rgba(46,43,37,0.92)');
    band.addColorStop(0.82, 'rgba(46,43,37,0.92)');
    band.addColorStop(1, 'rgba(46,43,37,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, cy - bh * 0.42 * open, L.W, bh * open);

    // clip the lettering to the band so it cannot spill out while it opens
    ctx.beginPath();
    ctx.rect(0, cy - bh * 0.42 * open, L.W, bh * open);
    ctx.clip();

    ctx.translate(L.W / 2, cy);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = fontDisplay(size);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(46,43,37,0.92)';
    ctx.strokeText(b.title, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.title, 0, 0);
    if (b.sub) {
      ctx.font = fontBody(size * 0.46, 700);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(46,43,37,0.92)';
      ctx.strokeText(b.sub, 0, size * 0.88);
      ctx.fillStyle = C.paper;
      ctx.fillText(b.sub, 0, size * 0.88);
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.save();
    if (S.shake > 0.2) ctx.translate(rnd(-S.shake, S.shake) * 0.3, rnd(-S.shake, S.shake) * 0.3);

    drawRoom();
    drawCounter();
    drawCrates();
    drawGrill();
    drawPlates();
    drawChefs();
    drawFlyers();
    drawHatchAndBin();     // nearest the camera, so it draws over the cook
    drawSparks();
    drawFloats();
    drawBanner();
    drawWaiting();

    ctx.restore();
  }

  /*
   * The host reads its receipt and shops between shifts; the guest has no such
   * screens, so without this it just sits looking at the last frame of a shift
   * that already ended - which reads as the game having hung. The banner that
   * fires on the change is gone in a second; this stays up for as long as the
   * wait actually lasts.
   */
  function drawWaiting() {
    if (S.role !== 'guest') return;
    var between = S.screen !== 'service';
    if (!between && !S.hostPaused) return;

    var title, sub;
    if (S.hostPaused && !between) {
      title = 'PAUSED';
      sub = 'the host stopped the clock';
    } else if (S.screen === 'over') {
      title = 'SHIFT OVER';
      sub = 'waiting for the host';
    } else {
      title = 'DAY ' + S.day + ' DONE';
      sub = 'the host is counting up';
    }

    ctx.save();
    ctx.fillStyle = 'rgba(46,43,37,0.62)';
    ctx.fillRect(0, 0, L.W, L.H);

    var cy = (L.floor.y0 + L.floor.y1) / 2;
    var size = Math.min(L.W * 0.062, 22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = fontDisplay(size);
    ctx.fillStyle = C.warm;
    ctx.fillText(title, L.W / 2, cy - size * 0.6);

    ctx.font = fontBody(size * 0.6, 600);
    ctx.fillStyle = 'rgba(249,244,237,0.78)';
    ctx.fillText(sub, L.W / 2, cy + size * 0.5);

    // three dots ticking over, so it is visibly alive rather than frozen
    var n = Math.floor(nowMs() / 400) % 4;
    var dot = size * 0.16;
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = i < n ? 0.9 : 0.25;
      ctx.beginPath();
      ctx.arc(L.W / 2 + (i - 1) * dot * 3, cy + size * 1.5, dot, 0, Math.PI * 2);
      ctx.fillStyle = C.paper;
      ctx.fill();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- HUD/DOM */
  /*
   * Only touches the DOM when a value actually changed. A guest calls this on
   * every state packet, and rewriting the hearts markup several times a second
   * is exactly the sort of thing a phone stutters on.
   */
  var hudLast = {};
  function syncHud() {
    var total = S.sales + S.tips;
    if (hudLast.day !== S.day) { hudLast.day = S.day; el.dayNum.textContent = S.day; }

    var goal = Core.money(total) + ' / ' + Core.money(S.rent);
    if (hudLast.goal !== goal) {
      hudLast.goal = goal;
      el.goalText.textContent = goal;
      var met = total >= S.rent;
      el.goalFill.style.width = (S.rent ? clamp(total / S.rent, 0, 1) * 100 : 0) + '%';
      el.goalFill.classList.toggle('met', met);
      el.goalText.classList.toggle('met', met);
    }

    if (hudLast.hearts !== S.hearts) {
      hudLast.hearts = S.hearts;
      var hearts = '';
      for (var i = 0; i < Core.START_HEARTS; i++) {
        hearts += '<span class="h' + (i < S.hearts ? '' : ' lost') + '">❤</span>';
      }
      el.hearts.innerHTML = hearts;
    }

    syncClock();
  }

  /*
   * The shift clock, kept out of syncHud's change-detection because it moves
   * every frame by nature - so it does its own, on the whole second rather than
   * on the raw number. Rewriting a text node sixty times a second for a display
   * that only changes once is exactly what made the phone stutter before.
   */
  function syncClock() {
    if (!el.clockText) return;
    var running = S.screen === 'service' && S.dayLength > 0;
    if (document.body && document.body.classList) {
      document.body.classList.toggle('no-clock', !running);
    }
    if (!running) { hudLast.clock = null; setRush(0); return; }

    var secs = Math.max(0, Math.ceil(S.timeLeft));
    var band = secs <= 15 ? 'urgent' : (secs <= 60 ? 'warm' : '');
    if (hudLast.clock === secs && hudLast.clockBand === band) return;

    if (hudLast.clock !== secs) {
      hudLast.clock = secs;
      el.clockText.textContent = Core.clockText(secs);
      if (el.clockFill) {
        el.clockFill.style.width = clamp(S.timeLeft / S.dayLength, 0, 1) * 100 + '%';
      }
    }
    if (hudLast.clockBand !== band) {
      hudLast.clockBand = band;
      ['warm', 'urgent'].forEach(function (c) {
        if (el.clockBox) el.clockBox.classList.toggle(c, band === c);
        if (el.clockFill) el.clockFill.classList.toggle(c, band === c);
      });
    }
  }

  // Smaller than it was: the words below it do the identifying now, and the
  // board had grown to a fifth of a phone screen at the kitchen's expense.
  var MINI_W = 38, MINI_H = 42;
  // the customer's head, cropped at the shoulders. guestBust fills it.
  var WHO_W = 34, WHO_H = 24;

  /*
   * What the ticket is actually asking for, in words.
   *
   * The little burger above it is charming and it tells you the shape of the
   * order at a glance, but it cannot tell you what is in one: a layer gets two
   * or three pixels of height on a phone, and at that size cheese and mustard
   * are both "a yellow thing". Measured across every pair of ingredients at
   * ticket scale, sixty of the hundred and five pairs were closer than the
   * threshold at which they read as different.
   *
   * So the burger stays as the picture and this says the words. Bun and patty
   * are in every order and would only be noise - unless there are two patties,
   * which is worth calling out.
   */
  function orderList(items) {
    var wrap = document.createElement('span');
    wrap.className = 'order-list';

    var counts = {};
    items.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });

    var rows = [];
    if (counts.patty > 1) rows.push({ id: 'patty', n: counts.patty });
    Object.keys(counts).forEach(function (id) {
      if (id === 'bun' || id === 'patty') return;
      rows.push({ id: id, n: counts[id] });
    });

    if (!rows.length) {
      var plain = document.createElement('span');
      plain.className = 'order-row plain';
      plain.textContent = 'PLAIN';
      wrap.appendChild(plain);
      return wrap;
    }

    rows.forEach(function (r) {
      var ing = Core.byId(r.id);
      var row = document.createElement('span');
      row.className = 'order-row';

      // 'swatch', not 'chip' - the receipt already owns .chip for its stat
      // tiles, and its padding was quietly inflating these into tall bars
      var chip = document.createElement('i');
      chip.className = 'swatch';
      chip.style.background = ing.swatch;
      row.appendChild(chip);

      var name = document.createElement('b');
      name.textContent = r.n > 1 ? ing.short + ' x' + r.n : ing.short;
      row.appendChild(name);

      wrap.appendChild(row);
    });
    return wrap;
  }

  function renderBoard() {
    el.board.innerHTML = '';
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

    S.tickets.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'ticket' + (t.arch.id === 'rush' ? ' rush' : '');
      d.setAttribute('data-uid', t.uid);

      // the customer, drawn with the same pen as the cook rather than an emoji
      var who = document.createElement('canvas');
      who.className = 'who';
      who.width = Math.round(WHO_W * dpr);
      who.height = Math.round(WHO_H * dpr);
      d.appendChild(who);
      t.faceEl = who;
      t.faceMood = -1;

      var c = document.createElement('canvas');
      c.className = 'mini';
      c.width = Math.round(MINI_W * dpr);
      c.height = Math.round(MINI_H * dpr);
      d.appendChild(c);

      var bar = document.createElement('span');
      bar.className = 'bar';
      var fill = document.createElement('i');
      bar.appendChild(fill);
      d.appendChild(bar);

      el.board.appendChild(d);

      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var shown = Core.displayStack(t.items);
      var bunW = Art.fitWidth(shown, MINI_W * 0.86, MINI_H - 3);
      Art.drawStack(g, shown, MINI_W / 2, MINI_H - 1, bunW);

      d.insertBefore(orderList(t.items), bar);

      t.node = d; t.barEl = fill;
    });

    var empties = (S.cfg ? S.cfg.concurrent : 2) - S.tickets.length;
    for (var i = 0; i < empties; i++) {
      var e = document.createElement('div');
      e.className = 'ticket empty';
      el.board.appendChild(e);
    }
    updateBoardBars();
  }

  /**
   * The customer on a ticket, redrawn only when their face would actually
   * change. A guest is a couple of hundred pen strokes; drawing one on every
   * bar update would repaint four of them sixty times a second for nothing.
   */
  function drawTicketFace(t, ratio) {
    // 4 steps of mood: happy while there is time, then souring toward a scowl
    var step = Math.min(3, Math.floor(clamp(ratio, 0, 1) * 4));
    if (!t.faceEl || t.faceMood === step) return;
    t.faceMood = step;
    var g = t.faceEl.getContext('2d');
    if (!g) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, WHO_W, WHO_H);
    guestBust(g, t.guest, WHO_W, WHO_H, step / 3);
  }

  function updateBoardBars() {
    for (var i = 0; i < S.tickets.length; i++) {
      var t = S.tickets[i];
      var ratio = clamp(t.patience / t.max, 0, 1);
      drawTicketFace(t, ratio);
      if (!t.barEl) continue;
      t.barEl.style.width = (ratio * 100) + '%';
      t.barEl.className = ratio < 0.12 ? 'crit' : (ratio < 0.28 ? 'warn' : '');
    }
  }

  /* -------------------------------------------------------------- screens */
  function showModal(node) { node.hidden = false; node.classList.add('show'); }
  function hideModal(node) { node.classList.remove('show'); node.hidden = true; }

  function showDayEnd(passed, ranOut, total) {
    if (!passed) {
      el.overTitle.textContent = ranOut ? 'SHUT DOWN' : 'RENT UNPAID';
      el.overReason.textContent = ranOut
        ? 'Five orders blown. The landlord changed the locks.'
        : (S.closedBy === 'clock'
          ? 'Closing time came round with ' + Core.money(total) + ' in the till against ' +
            Core.money(S.rent) + ' of rent. Faster tomorrow.'
          : 'You took in ' + Core.money(total) + ' against ' + Core.money(S.rent) +
            ' of rent. The landlord is not sympathetic.');
      el.overDay.textContent = S.day;
      el.overBest.textContent = S.bestDay;
      el.retryDay.textContent = S.day;
      showModal(el.over);
      return;
    }
    el.dayEndTitle.textContent = 'DAY ' + S.day + ' CLOSED';
    el.rSales.textContent = Core.money(S.sales);
    el.rTips.textContent = Core.money(S.tips);
    el.rTotal.textContent = Core.money(total);
    el.rRent.textContent = '-' + Core.money(S.rent);
    el.rNet.textContent = Core.money(total - S.rent);
    el.rPerfect.textContent = S.perfect;
    el.rServed.textContent = S.served;
    el.rWalked.textContent = S.walked;
    el.dayEndNote.textContent = S.closedBy === 'clock'
      ? 'Closing time, and the rent still made. ' + Core.money(S.money) + ' in the till.'
      : (S.perfect === S.served && S.served > 0
        ? 'Every single ticket perfect. The regulars are talking.'
        : 'Rent covered. ' + Core.money(S.money) + ' in the till.');
    showModal(el.dayEnd);
  }

  function renderShop() {
    el.walletText.textContent = Core.money(S.money);
    el.nextDayNum.textContent = S.day + 1;
    el.nextRent.textContent = Core.money(Core.dayGoal(S.day + 1));
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

    // What tomorrow's kitchen and rush will actually look like, so the shop
    // is a decision and not a guess.
    var today = Core.effects(S.levels, S.day);
    var next = Core.effects(S.levels, S.day + 1);
    var cfg = Core.dayConfig(S.day + 1);
    function grew(a, b) { return b > a ? ' <em>+1</em>' : ''; }
    el.nextKitchen.innerHTML =
      '<span>TOMORROW</span>' +
      '<b>' + next.plates + '</b> plates' + grew(today.plates, next.plates) +
      ' &nbsp;·&nbsp; <b>' + next.grillSlots + '</b> burners' + grew(today.grillSlots, next.grillSlots) +
      ' &nbsp;·&nbsp; <b>' + cfg.concurrent + '</b> orders up' +
      ' &nbsp;·&nbsp; <b>' + Core.dayMenu(S.day + 1).length + '</b> crates';

    var news = Core.unlockedOn(S.day + 1);
    el.unlockBox.hidden = news.length === 0;
    if (news.length) {
      el.unlockList.innerHTML = '';
      /*
       * In a bun, not on its own. drawIcon draws a layer at the height that
       * layer really has, and a sauce is two pixels of it - so the sauces, the
       * ones a player is least able to picture, arrived as an empty box with a
       * word under it. Between two bun halves every unlock is the same size and
       * reads as "this is what you will be putting on a burger tomorrow".
       */
      var UW = 40, UH = 34;
      news.forEach(function (ing) {
        var d = document.createElement('div');
        d.className = 'u';
        var c = document.createElement('canvas');
        c.width = Math.round(UW * dpr);
        c.height = Math.round(UH * dpr);
        d.appendChild(c);
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = ing.name;
        d.appendChild(n);
        el.unlockList.appendChild(d);
        var g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var shown = Core.displayStack(['bun', ing.id]);
        Art.drawStack(g, shown, UW / 2, UH - 2, Art.fitWidth(shown, UW * 0.88, UH - 4));
      });
    }

    el.upgradeList.innerHTML = '';
    Core.UPGRADES.forEach(function (u) {
      var lvl = S.levels[u.id] || 0;
      var cost = Core.upgradeCost(u.id, lvl);
      var row = document.createElement('div');
      row.className = 'upg';
      var pips = '';
      for (var i = 0; i < u.max; i++) pips += '<i class="' + (i < lvl ? 'on' : '') + '"></i>';
      row.innerHTML =
        '<span class="uicon">' + u.icon + '</span>' +
        '<div><b>' + u.name + '</b><small>' + u.desc + '</small>' +
        '<div class="pips">' + pips + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'ubuy' + (cost === null ? ' maxed' : '');
      if (cost === null) {
        btn.textContent = 'MAX';
        btn.disabled = true;
      } else {
        btn.textContent = Core.money(cost);
        btn.disabled = S.money < cost;
        btn.addEventListener('click', function () { buyUpgrade(u.id); });
      }
      row.appendChild(btn);
      el.upgradeList.appendChild(row);
    });
  }

  /* ------------------------------------------------------- online screens */
  function setNetState() {
    el.netState.textContent = Net.online
      ? 'signed in as ' + (Net.name || 'Cook') + ' — progress syncs across devices'
      : 'offline — progress stays on this device';
    el.netState.classList.toggle('on', !!Net.online);
  }

  function showLeaderboard() {
    showModal(el.leaderboard);
    el.lbList.innerHTML = '';
    el.lbNote.textContent = Net.online ? 'Loading…' : 'You are offline — no board to show.';
    if (!Net.online) return;

    Net.leaderboard(20).then(function (data) {
      if (!data) { el.lbNote.textContent = 'Could not reach the board.'; return; }
      var rows = (data.top || []).slice();
      var html = rows.map(function (r) {
        return '<div class="lb-row' + (r.me ? ' me' : '') + '">' +
          '<span class="r">' + r.rank + '</span>' +
          '<span class="n">' + escapeHtml(r.name) + '</span>' +
          '<span class="d">DAY ' + r.day + '</span>' +
          '<span class="e">' + Core.money(r.earned) + '</span></div>';
      }).join('');
      if (data.mine) {
        html += '<div class="lb-gap">···</div>' +
          '<div class="lb-row me"><span class="r">' + data.mine.rank + '</span>' +
          '<span class="n">' + escapeHtml(data.mine.name) + '</span>' +
          '<span class="d">DAY ' + data.mine.day + '</span>' +
          '<span class="e">' + Core.money(data.mine.earned) + '</span></div>';
      }
      el.lbList.innerHTML = html || '';
      el.lbNote.textContent = rows.length
        ? 'Furthest day wins; money breaks ties.'
        : 'Nobody has finished a day yet. Be first.';
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showAccount() {
    showModal(el.account);
    el.nameInput.value = Net.name || '';
    el.codeOut.hidden = true;
    el.accountNote.textContent = Net.online ? '' : 'You are offline — none of this will stick.';
  }

  /* ----------------------------------------------------------- co-op flow
   *
   * Phones drop sockets constantly - screen lock, a walk between wifi and
   * mobile data, a background tab. So a dropped guest does NOT end the session:
   * the host keeps cooking with its friend's chef parked, and the guest
   * reconnects into the same room and picks that chef back up.
   *
   * A dropped host does end it, because the simulation lived there.
   */
  var MAX_RECONNECT = 8;

  function enterRoom(code) {
    S.roomCode = code;
    S.reconnectTries = 0;
    S.coopStarted = false;
    el.coopNote.textContent = 'Connecting…';
    connectRoom();
  }

  /*
   * Everything the interpolator learned belongs to one socket: the offset
   * between the two clocks, the measured packet spacing, and the samples in
   * flight. Carrying them into a fresh connection makes the first second after
   * a reconnect read from a timeline that no longer exists.
   */
  function resetSync() {
    S.clockOff = null;
    S.lastSnapAt = 0;
    S.snapInterval = 80;
    S.snapN = 0;
    S.renderT = null;
    S.chefs.forEach(function (c) { c.buf = null; });
  }

  function connectRoom() {
    var code = S.roomCode;
    if (!code) return;
    Net.connect(code, {
      onRole: function (role) {
        S.role = role;
        S.me = role === 'host' ? 0 : 1;
        S.peer = false;
        S.reconnectTries = 0;
        resetSync();
        el.coopNote.textContent = role === 'host'
          ? 'Room ' + code + ' is open. Waiting for your friend…'
          : 'Joined room ' + code + '. Waiting for the host…';
        if (role === 'guest') {
          // the guest never simulates; it just needs a room to render into
          hideModal(el.coop);
          hideModal(el.start);
          S.screen = 'service';
          if (S.chefs.length < 2) S.chefs = [makeChef(), makeChef()];
          S.lastBannerId = -1;
          resize();
          banner('JOINED', 'waiting for the host', C.sage);
        }
      },

      onPeer: function (joined, hostLeft) {
        S.peer = joined;
        if (joined) {
          if (S.role !== 'host') return;
          hideModal(el.coop);
          hideModal(el.start);
          if (!S.coopStarted) {
            // first time only: a rejoin must not restart the day
            S.coopStarted = true;
            el.coopNote.textContent = 'Your friend is in. Starting…';
            Sfx.init(); Bgm.start();
            startDay(S.day);
          } else {
            banner('FRIEND IS BACK', '', C.sage);
          }
          return;
        }
        if (hostLeft) { endCoop('the host left'); return; }
        // The guest dropped. Keep the room open and park their chef.
        var c = S.chefs[1];
        if (c) { c.target = null; c.tx = c.x; c.ty = c.y; }
        banner('FRIEND DROPPED', 'room ' + S.roomCode + ' is still open', C.warm);
      },

      onMessage: onCoopMessage,

      onClose: function (why) {
        if (!coop()) { el.coopNote.textContent = why; return; }
        // Our own socket died. Try to get back into the same room.
        if (S.roomCode && S.reconnectTries < MAX_RECONNECT) {
          S.reconnectTries++;
          banner('RECONNECTING', 'try ' + S.reconnectTries + ' of ' + MAX_RECONNECT, C.warm);
          setTimeout(connectRoom, Math.min(500 * S.reconnectTries, 3000));
          return;
        }
        endCoop(why);
      }
    });
  }

  /** Deliberate or final exit from co-op - back to one cook, back to solo. */
  function endCoop(why) {
    var was = S.role;
    Net.leave();
    S.role = 'solo';
    S.peer = false;
    S.me = 0;
    S.roomCode = null;
    S.reconnectTries = 0;
    S.coopStarted = false;
    resetSync();
    S.chefs.length = 1;
    if (was === 'host' || was === 'guest') {
      banner('CO-OP ENDED', why || '', C.alarm);
      if (was === 'guest') {
        S.screen = 'title';
        showModal(el.start);
      }
    }
  }
  var leaveCoop = endCoop;   // older name, still used by the pause menu

  function buyUpgrade(id) {
    var lvl = S.levels[id] || 0;
    var cost = Core.upgradeCost(id, lvl);
    if (cost === null || S.money < cost) return;
    S.money -= cost;
    S.levels[id] = lvl + 1;
    S.fx = Core.effects(S.levels, S.day);
    save();
    Sfx.upgrade();
    buzz(20);
    renderShop();
  }

  /* ------------------------------------------------------------- co-op sync
   *
   * The host keeps simulating exactly as in single player and ships a snapshot
   * a dozen times a second. The guest never simulates; it renders what it is
   * told and sends back which station it tapped.
   *
   * Cook positions travel normalised to the floor rect, so the two devices can
   * have completely different screen sizes.
   */
  /*
   * Two packet rates. Motion needs a fast sample rate to look right, but plates
   * and tickets barely change - sending everything at motion rate was both
   * wasteful on mobile data and, because each packet restarted an ease, the
   * source of the remaining judder.
   */
  var POS_HZ = 20;      // cook positions only, ~80 bytes
  var STATE_HZ = 8;     // the whole kitchen
  var posTimer = 0, stateTimer = 0;

  // How far behind live the guest renders. One packet of slack absorbs jitter;
  // any less and a late packet shows up as a stall.
  function interpDelay() { return clamp(S.snapInterval * 1.7, 90, 260); }

  /*
   * The moment in the buffer we are showing right now.
   *
   * Deriving it as "now minus the delay" every frame sounds equivalent, but the
   * delay is an estimate off a running average of packet spacing - so it moves,
   * and every time it moves the render point jumps backwards or forwards
   * through the samples. On a phone joining a room that estimate travels a long
   * way in the first second, and the cook visibly stalls and lurches while it
   * settles. That was the last of the judder.
   *
   * Instead run a clock of our own and correct it the way audio playout does:
   * never jump, just run it a few percent fast or slow until it is back where
   * it belongs. A few percent is invisible; a jump is not.
   */
  var MAX_WARP = 0.08;         // +/-8% of real time
  var RESEAT_MS = 800;         // past this it is a stall, not drift
  function playoutTime(dtMs) {
    var newest = 0;
    for (var i = 0; i < S.chefs.length; i++) {
      var b = S.chefs[i].buf;
      if (b && b.length) newest = Math.max(newest, b[b.length - 1].t);
    }
    if (!newest) { S.renderT = null; return 0; }

    var target = newest - interpDelay();
    if (S.renderT == null || Math.abs(target - S.renderT) > RESEAT_MS) {
      S.renderT = target;               // first packet, or we lost the thread
      return S.renderT;
    }
    var drift = target - S.renderT;
    var warp = clamp(drift / 600, -MAX_WARP, MAX_WARP);
    S.renderT += Math.max(0, dtMs) * (1 + warp);
    return S.renderT;
  }

  // Single clock for everything interpolation-related. Overridable so the
  // smoke test can drive it deterministically instead of sleeping.
  var clockFn = null;
  function nowMs() {
    if (clockFn) return clockFn();
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function packHold(h) {
    if (!h) return null;
    if (h.kind === 'plate') return { k: 'p', s: h.stack };
    return { k: 'i', id: h.id, c: h.cook, d: h.done, ch: h.char, gt: h.grillT };
  }
  function unpackHold(h) {
    if (!h) return null;
    if (h.k === 'p') return { kind: 'plate', stack: h.s || [] };
    return { kind: 'ing', id: h.id, cook: h.c, done: h.d, char: h.ch, grillT: h.gt };
  }

  function snapshot() {
    var fw = Math.max(1, L.floor.x1 - L.floor.x0);
    var fh = Math.max(1, L.floor.y1 - L.floor.y0);
    return {
      type: 'state',
      t: Math.round(nowMs()),
      day: S.day, hearts: S.hearts, sales: S.sales, tips: S.tips, rent: S.rent,
      screen: S.screen, menu: S.menu, concurrent: S.cfg ? S.cfg.concurrent : 3,
      paused: !!S.userPaused,
      left: Math.round(S.timeLeft * 10) / 10, len: S.dayLength,
      plates: S.plates.map(function (p) { return p.stack; }),
      grill: S.grill.map(function (g) { return g ? { id: g.id, t: g.t } : null; }),
      tickets: S.tickets.map(function (t) {
        return { uid: t.uid, a: t.arch.id, g: t.guest, items: t.items, p: t.patience, m: t.max };
      }),
      chefs: S.chefs.map(function (c) {
        return {
          x: (c.x - L.floor.x0) / fw, y: (c.y - L.floor.y0) / fh,
          f: c.face, h: packHold(c.holding)
        };
      }),
      banner: S.banner ? { t: S.banner.title, s: S.banner.sub, c: S.banner.color, n: S.banner.id } : null
    };
  }

  var ARCH_BY_ID = {};
  Core.CUSTOMERS.forEach(function (c) { ARCH_BY_ID[c.id] = c; });

  function applySnapshot(m) {
    // Anything that changes the size or count of a station changes the room.
    var shapeChanged =
      (S.menu || []).length !== (m.menu || []).length ||
      S.plates.length !== m.plates.length ||
      S.grill.length !== m.grill.length ||
      S.day !== m.day;

    S.day = m.day; S.hearts = m.hearts; S.sales = m.sales; S.tips = m.tips; S.rent = m.rent;
    S.menu = m.menu;
    if (!S.cfg || S.cfg.day !== m.day) S.cfg = Core.dayConfig(m.day);
    S.cfg.concurrent = m.concurrent;

    var wasService = S.screen === 'service';
    S.screen = m.screen;
    S.hostPaused = !!m.paused;
    /*
     * The clock comes down the wire rather than being run locally. It only
     * arrives eight times a second, but the guest's own update() does not tick
     * it between packets on purpose: two clocks drifting apart is worse than
     * one that steps, and a shift that ends at a different moment on each
     * screen would be indefensible.
     */
    if (m.len !== undefined) S.dayLength = m.len;
    if (m.left !== undefined) S.timeLeft = m.left;

    S.plates = m.plates.map(function (st) { return { stack: st }; });
    S.grill = m.grill;

    // keep ticket objects (and their DOM nodes) alive across snapshots
    var byUid = {};
    S.tickets.forEach(function (t) { byUid[t.uid] = t; });
    var changed = S.tickets.length !== m.tickets.length;
    S.tickets = m.tickets.map(function (t) {
      var old = byUid[t.uid];
      if (!old) changed = true;
      var tk = old || { uid: t.uid, tick: 0 };
      tk.arch = ARCH_BY_ID[t.a] || Core.CUSTOMERS[0];
      // both screens have to show the same person at the window
      tk.guest = GUEST_OK[t.g] ? t.g : castGuest(tk.arch.id);
      tk.items = t.items;
      tk.patience = t.p; tk.max = t.m;
      return tk;
    });

    // The day's shape drives the layout: if the host has more plates, more
    // burners or a different line than we last laid out for, the room has to be
    // rebuilt or we draw yesterday's kitchen with today's contents.
    if (shapeChanged) resize();

    bufferPositions(m.chefs, m.t);
    m.chefs.forEach(function (snap, i) {
      S.chefs[i].holding = unpackHold(snap.h);
    });

    if (m.banner && m.banner.n !== S.lastBannerId) {
      S.lastBannerId = m.banner.n;
      banner(m.banner.t, m.banner.s, m.banner.c);
    }
    if (changed) renderBoard();
    syncHud();
    if (wasService && m.screen !== 'service') {
      banner('DAY OVER', 'waiting for the host', C.warm);
    }
  }

  /** Just where the cooks are - the part that has to arrive often. */
  function posPacket() {
    var fw = Math.max(1, L.floor.x1 - L.floor.x0);
    var fh = Math.max(1, L.floor.y1 - L.floor.y0);
    return {
      type: 'pos',
      t: Math.round(nowMs()),
      c: S.chefs.map(function (c) {
        return {
          x: Math.round((c.x - L.floor.x0) / fw * 1000) / 1000,
          y: Math.round((c.y - L.floor.y0) / fh * 1000) / 1000,
          f: c.face
        };
      })
    };
  }

  /*
   * Put a host timestamp on our own clock.
   *
   * Stamping samples with the moment they arrived bakes the network's jitter
   * straight into the timeline: the host sends on an exact 50ms beat, but the
   * packets land at 45, 58, 47, 60ms, so interpolating between arrival times
   * replays that wobble as a speed change. The host now says when it sent each
   * one, and we only need the offset between the two clocks.
   *
   * (arrival - sent) is that offset plus the trip time, so it is always an
   * over-estimate, and the smallest one we have seen is the closest to the
   * truth. Track the minimum, drop to it quickly, and let it drift back up
   * slowly so a genuinely slow clock or a route change is still followed.
   */
  function hostToLocal(hostT, localT) {
    if (!hostT) return localT;                    // peer predates the timestamp
    var obs = localT - hostT;
    if (S.clockOff == null || Math.abs(obs - S.clockOff) > 2000) {
      S.clockOff = obs;                           // first packet, or a new route
      return hostT + S.clockOff;
    }
    var before = S.clockOff;
    if (obs < S.clockOff) S.clockOff = S.clockOff * 0.3 + obs * 0.7;
    else S.clockOff = S.clockOff * 0.995 + obs * 0.005;
    /*
     * Revising the offset would otherwise leave the samples already in the
     * buffer stamped against the old one - so the segment either side of the
     * revision is stretched or squashed, and the cook lurches. That is most of
     * what a guest sees in its first second, while the estimate is still
     * settling. Move the whole timeline together and the revision costs nothing.
     */
    var delta = S.clockOff - before;
    if (delta) {
      for (var i = 0; i < S.chefs.length; i++) {
        var b = S.chefs[i].buf;
        if (!b) continue;
        for (var j = 0; j < b.length; j++) b[j].t += delta;
      }
      if (S.lastSnapAt) S.lastSnapAt += delta;
      if (S.renderT != null) S.renderT += delta;
    }
    return hostT + S.clockOff;
  }

  /** Feed one sample per cook into the guest's interpolation buffers. */
  function bufferPositions(list, hostT) {
    var now = nowMs();
    var t = hostToLocal(hostT, now);
    if (S.lastSnapAt) {
      var gapMs = clamp(t - S.lastSnapAt, 20, 400);
      // The seed is a guess; lean hard on the first few real measurements so the
      // render delay is right within a couple of packets rather than a second.
      S.snapN = (S.snapN || 0) + 1;
      var a = S.snapN < 5 ? 0.6 : 0.25;
      S.snapInterval = S.snapInterval * (1 - a) + gapMs * a;
    }
    // out-of-order or duplicate packet: it would fold the buffer back on itself
    if (S.lastSnapAt && t <= S.lastSnapAt) return;
    S.lastSnapAt = t;

    var fw = Math.max(1, L.floor.x1 - L.floor.x0);
    var fh = Math.max(1, L.floor.y1 - L.floor.y0);
    while (S.chefs.length < list.length) S.chefs.push(makeChef());
    S.chefs.length = list.length;

    list.forEach(function (snap, i) {
      var c = S.chefs[i];
      var x = L.floor.x0 + snap.x * fw;
      var y = L.floor.y0 + snap.y * fh;
      c.face = snap.f;
      c.buf = c.buf || [];
      c.buf.push({ t: t, x: x, y: y });
      if (c.buf.length > 8) c.buf.shift();
      if (!c.x) { c.x = x; c.y = y; }        // first sample: no easing in from 0,0
    });
  }

  function pumpNetwork(dt) {
    if (S.role !== 'host' || !S.peer) return;
    posTimer -= dt;
    if (posTimer <= 0) {
      posTimer = 1 / POS_HZ;
      Net.send(posPacket());
    }
    stateTimer -= dt;
    if (stateTimer <= 0) {
      stateTimer = 1 / STATE_HZ;
      S.snapSeq++;
      Net.send(snapshot());
    }
  }

  function onCoopMessage(m) {
    if (!m || !m.type) return;
    if (S.role === 'host' && m.type === 'tap' && m.target) {
      // the guest is always cook #2 - never let a stray tap drive the host's own
      if (S.chefs.length > 1) sendChef(m.target, 1);
      return;
    }
    if (S.role !== 'guest') return;
    if (m.type === 'pos' && m.c) bufferPositions(m.c, m.t);
    else if (m.type === 'state') applySnapshot(m);
  }

  /* ----------------------------------------------------------------- input */
  function onTap(e) {
    if (S.screen !== 'service' || S.userPaused) return;
    var r = cv.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > L.W || y > L.H) return;
    var target = stationAt(x, y);
    // Stations travel by index, not pixels - the two screens are different sizes.
    if (S.role === 'guest') Net.send({ type: 'tap', target: target });
    else sendChef(target, S.me);
    Sfx.tap();
    e.preventDefault();
  }

  function bind() {
    cv.addEventListener('pointerdown', onTap, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    el.playBtn.addEventListener('click', function () {
      Sfx.init();
      Bgm.start();
      hideModal(el.start);
      S.day = 1; S.money = 0; S.levels = {}; S.bestDay = 1;
      wipe();
      startDay(1);
    });
    el.continueBtn.addEventListener('click', function () {
      Sfx.init();
      Bgm.start();
      hideModal(el.start);
      startDay(S.day);
    });
    el.dayEndBtn.addEventListener('click', function () {
      hideModal(el.dayEnd);
      S.screen = 'shop';
      renderShop();
      showModal(el.shop);
    });
    el.nextDayBtn.addEventListener('click', function () {
      hideModal(el.shop);
      startDay(S.day + 1);
    });
    el.retryBtn.addEventListener('click', function () {
      hideModal(el.over);
      startDay(S.day);
    });
    el.wipeBtn.addEventListener('click', function () {
      wipe();
      S.day = 1; S.money = 0; S.levels = {}; S.bestDay = 1;
      hideModal(el.over);
      startDay(1);
    });
    el.pauseBtn.addEventListener('click', function () { setPaused(true); });
    el.resumeBtn.addEventListener('click', function () { setPaused(false); });
    el.restartBtn.addEventListener('click', function () {
      setPaused(false);
      startDay(S.day);
    });
    el.quitBtn.addEventListener('click', quitToTitle);
    el.pauseSoundBtn.addEventListener('click', function () {
      S.muted = !S.muted;
      Sfx.setMuted(S.muted);
      el.pauseSoundBtn.textContent = 'SOUND: ' + (S.muted ? 'OFF' : 'ON');
      save();
    });

    /* --- leaderboard / account / co-op */
    el.howBtn.addEventListener('click', function () { showModal(el.how); });
    el.howClose.addEventListener('click', function () { hideModal(el.how); });
    el.boardBtn.addEventListener('click', showLeaderboard);
    el.lbClose.addEventListener('click', function () { hideModal(el.leaderboard); });
    el.accountBtn.addEventListener('click', showAccount);
    el.accountClose.addEventListener('click', function () { hideModal(el.account); });

    el.nameSave.addEventListener('click', function () {
      var name = (el.nameInput.value || '').trim().slice(0, 16) || 'Cook';
      el.accountNote.textContent = 'Saving…';
      Net.setName(name).then(function (ok) {
        setNetState();
        el.accountNote.textContent = ok ? 'Saved as ' + Net.name + '.' : 'Saved on this device only.';
      });
    });

    el.makeCodeBtn.addEventListener('click', function () {
      el.accountNote.textContent = '';
      Net.makeCode().then(function (code) {
        if (!code) { el.accountNote.textContent = 'Could not get a code.'; return; }
        el.codeOut.hidden = false;
        el.codeOut.innerHTML = escapeHtml(code) + '<small>type this on the other device within 10 minutes</small>';
      });
    });

    el.claimBtn.addEventListener('click', function () {
      var code = (el.claimInput.value || '').trim().toUpperCase();
      if (code.length < 4) { el.accountNote.textContent = 'Enter the code first.'; return; }
      el.accountNote.textContent = 'Loading…';
      Net.claim(code).then(function (res) {
        if (res.error) { el.accountNote.textContent = res.error; return; }
        if (res.save) {
          S.day = res.save.day || 1;
          S.bestDay = res.save.bestDay || S.day;
          S.money = res.save.money || 0;
          S.levels = res.save.levels || {};
          S.fx = Core.effects(S.levels, S.day);
          save();
          el.continueBtn.hidden = false;
          el.continueDay.textContent = S.day;
        }
        setNetState();
        el.accountNote.textContent = 'Loaded ' + (res.name || 'that save') +
          (res.save ? ' — day ' + (res.save.day || 1) + '.' : ' (no save on it yet).');
      });
    });

    el.coopBtn.addEventListener('click', function () {
      Sfx.init();
      el.coopNote.textContent = Net.online ? '' : 'You are offline — co-op needs a connection.';
      el.roomOut.hidden = true;
      showModal(el.coop);
    });
    el.coopClose.addEventListener('click', function () {
      hideModal(el.coop);
      if (S.role === 'host' && !S.peer) endCoop();
    });
    el.hostBtn.addEventListener('click', function () {
      var code = Net.newRoomCode();
      el.roomOut.hidden = false;
      el.roomOut.innerHTML = escapeHtml(code) + '<small>read this out to your friend</small>';
      enterRoom(code);
    });
    el.joinBtn.addEventListener('click', function () {
      var code = (el.joinInput.value || '').trim().toUpperCase();
      if (code.length < 4) { el.coopNote.textContent = 'Enter the room code first.'; return; }
      enterRoom(code);
    });

    // Debounced: a mobile address bar animating in or out fires this a dozen
    // times in a row, and re-laying-out on every one of them is the flicker.
    var resizeTimer = null;
    function resizeSoon() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resizeTimer = null; resize(); }, 120);
    }
    window.addEventListener('resize', resizeSoon);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeSoon);
    window.addEventListener('orientationchange', function () {
      setTimeout(resize, 250);      // the viewport is still settling on rotate
    });
    document.addEventListener('visibilitychange', function () {
      S.paused = document.hidden;
      // Don't keep a scheduler running against a backgrounded tab's throttled
      // clock - it comes back as a burst of stacked-up notes.
      if (document.hidden) { Bgm.stop(); return; }
      last = 0;
      if (!S.userPaused && S.screen !== 'title') Bgm.start();
      // A phone drops the socket while locked; pick the room back up.
      if (coop() && S.roomCode && !Net.room) {
        S.reconnectTries = 0;
        connectRoom();
      }
    });
  }

  /* ------------------------------------------------------------------ boot */
  var last = 0;
  var sizeOffSince = 0;

  /*
   * The resize *event* is debounced, but this per-frame safety net used to call
   * resize() the instant the canvas box changed - which handed back every
   * millisecond the debounce was there to absorb. Tapping PLAY on a phone hides
   * the address bar, and the viewport then animates for a few hundred ms: that
   * was a full canvas reallocation plus relayout on every single frame of the
   * animation, and it is why the opening seconds hitched and the DAY card
   * jumped about. Wait for the size to sit still first. A big jump (rotation)
   * still goes through immediately, because holding a stretched bitmap through
   * that reads far worse than one dropped frame.
   */
  var SETTLE_MS = 120, MAX_WAIT_MS = 600, BIG_JUMP = 0.18;
  var seenW = 0, seenH = 0, offFirst = 0;
  function sizeSettled(ts) {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w === L.W && h === L.H) { sizeOffSince = 0; offFirst = 0; return false; }
    if (!L.W || !L.H) return true;                    // first layout, just do it
    if (Math.abs(w - L.W) / L.W > BIG_JUMP || Math.abs(h - L.H) / L.H > BIG_JUMP) {
      sizeOffSince = 0; offFirst = 0; return true;    // rotation, or a real jump
    }
    if (!offFirst) offFirst = ts;
    if (w !== seenW || h !== seenH) {                 // still moving - keep waiting
      seenW = w; seenH = h; sizeOffSince = ts;
    }
    // ...unless it never stops. A viewport that jitters by a pixel forever
    // would otherwise leave us drawing at a stale size for good.
    if (ts - sizeOffSince < SETTLE_MS && ts - offFirst < MAX_WAIT_MS) return false;
    sizeOffSince = 0; offFirst = 0;
    return true;
  }

  function frame(ts) {
    // Book the next frame before doing any work: one thrown exception in draw()
    // used to unregister the loop and freeze the game for good.
    requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (sizeSettled(ts)) resize();
    // A paused kitchen still gets painted - the frozen frame is the backdrop
    // the pause sheet sits on. A cramped one is covered by the turn-your-phone
    // sheet, so there is nothing to paint and, more to the point, the shift
    // must not keep running while the player cannot reach the stations.
    if (!S.paused && !S.cramped) {
      if (!S.userPaused) update(dt);
      draw();
    }

    /*
     * Outside all of that on purpose. The guest's entire world is these
     * packets, and this used to be sent from inside update(), below its
     * "not in a shift, nothing to do" return - so the host went silent the
     * instant it stopped playing: reading the day's receipt, in the shop,
     * or on the pause menu. The guest was left holding the last frame of a
     * shift that had already ended, tickets frozen on the board, with no
     * word of what had happened; from their side the host had moved on
     * without them. Keep talking, and the snapshot's own screen and paused
     * flags tell them exactly what is going on.
     */
    pumpNetwork(dt);
  }

  function init() {
    cv = document.getElementById('stage');
    ctx = cv.getContext('2d');

    ['dayNum', 'goalText', 'goalFill', 'hearts', 'board', 'pauseBtn',
      'clockText', 'clockFill', 'clockBox',
      'pause', 'pauseDay', 'pauseEarned', 'pauseRent', 'pauseSoundBtn',
      'resumeBtn', 'restartBtn', 'quitBtn',
      'start', 'playBtn', 'continueBtn', 'continueDay',
      'dayEnd', 'dayEndTitle', 'dayEndBtn', 'dayEndNote', 'rSales', 'rTips', 'rTotal',
      'rRent', 'rNet', 'rPerfect', 'rServed', 'rWalked',
      'coopBtn', 'netState', 'boardBtn', 'accountBtn', 'howBtn', 'how', 'howClose',
      'leaderboard', 'lbList', 'lbNote', 'lbClose',
      'account', 'nameInput', 'nameSave', 'makeCodeBtn', 'codeOut',
      'claimInput', 'claimBtn', 'accountNote', 'accountClose',
      'coop', 'hostBtn', 'roomOut', 'joinInput', 'joinBtn', 'coopNote', 'coopClose',
      'shop', 'walletText', 'unlockBox', 'unlockList', 'upgradeList', 'nextRent', 'nextKitchen',
      'nextDayBtn', 'nextDayNum', 'over', 'overTitle', 'overReason', 'overDay',
      'overBest', 'retryBtn', 'retryDay', 'wipeBtn'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    var saved = load();
    if (saved) {
      S.day = saved.day;
      S.bestDay = saved.bestDay || saved.day;
      S.money = saved.money || 0;
      S.levels = saved.levels || {};
      S.muted = !!saved.muted;
      S.lifetime = saved.lifetime || 0;
      S.fx = Core.effects(S.levels, S.day);
      el.continueBtn.hidden = false;
      el.continueDay.textContent = saved.day;
    }
    // Size the board for the shift the player is about to resume, not for day
    // one - otherwise it resizes behind the title sheet as that sheet fades.
    reserveBoard(S.day || 1);
    Sfx.setMuted(S.muted);
    el.pauseSoundBtn.textContent = 'SOUND: ' + (S.muted ? 'OFF' : 'ON');

    S.menu = Core.dayMenu(S.day);
    S.sections = Core.menuSections(S.day);
    for (var i = 0; i < S.fx.plates; i++) S.plates.push({ stack: [] });
    S.grill = new Array(S.fx.grillSlots).fill(null);
    S.rent = Core.dayGoal(S.day);
    resize();
    syncHud();
    renderBoard();
    bind();
    requestAnimationFrame(frame);

    // Sign in quietly in the background. Everything above already works
    // offline; this only ever adds the board, co-op and cross-device saves.
    Net.init().then(function () {
      setNetState();
      if (!Net.online) return;
      return Net.pull().then(function (raw) {
        // The server treats the save blob as opaque - it size-caps it and never
        // reads it - so what comes back down deserves exactly as much trust as
        // what came off this device's disk. Same rules, same door.
        var cloud = Core.sanitiseSave(raw);
        // Only offer the cloud save if it is genuinely further along.
        if (!cloud || cloud.day <= S.day) return;
        S.day = cloud.day;
        S.bestDay = Math.max(S.bestDay, cloud.bestDay);
        S.money = cloud.money;
        S.levels = cloud.levels;
        S.lifetime = Math.max(S.lifetime || 0, cloud.lifetime);
        S.fx = Core.effects(S.levels, S.day);
        save();
        el.continueBtn.hidden = false;
        el.continueDay.textContent = S.day;
      });
    }).catch(function () { setNetState(); });
  }

  // Exposed for the smoke test and for poking at a live shift in DevTools.
  window.MrBurger = {
    state: S, layout: L,
    startDay: startDay, spawnTicket: spawnTicket, endDay: endDay,
    renderBoard: renderBoard,
    sendChef: sendChef, arrive: arrive, deliver: deliver,
    stationAt: stationAt, standPoint: standPoint,
    setPaused: setPaused, quitToTitle: quitToTitle,
    snapshot: snapshot, applySnapshot: applySnapshot, onCoopMessage: onCoopMessage,
    leaveCoop: endCoop, endCoop: endCoop, chefAt: chefAt,
    _setClock: function (fn) { clockFn = fn; },
    enterRoom: enterRoom, connectRoom: connectRoom,
    crateRect: crateRect, slotRect: slotRect, plateRect: plateRect,
    hatchRect: hatchRect, binRect: binRect,
    buyUpgrade: buyUpgrade, ticketOf: ticketOf
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();









