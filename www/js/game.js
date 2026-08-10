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

  var VERDICT = {
    perfect: { text: 'PERFECT!', color: '#6bbf59' },
    great: { text: 'GREAT', color: '#a8e063' },
    good: { text: 'GOOD', color: '#f4b41a' },
    meh: { text: 'THEY\'LL TAKE IT', color: '#ff9f1c' },
    bad: { text: 'SENT IT BACK!', color: '#e63946' }
  };

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
    flyers: [], cratePop: [],
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
   * Everything in the room is a slab: a top face with a darker side face
   * peeking out below it. Cheap fake 3D, but with contact shadows and a rim
   * light it reads as a chunky little kitchen rather than flat rectangles.
   */
  var K = {
    wallA: '#fdf5e9', wallB: '#f0e0c8',
    wallTile: 'rgba(150,110,80,0.07)',
    floorA: '#f8e9d3', floorB: '#e9cfae',
    counterTop: '#e4c496', counterTop2: '#d2ad7c', counterSide: '#a97d4e',
    // open crates on the line, contents stacked inside
    boxTop: '#d9a35f', boxTop2: '#bb8140', boxSide: '#8d5c26',
    boxIn: '#a5763f', boxIn2: '#7a5225',
    boxFront: '#e8bd83', boxFront2: '#cd9a5b',
    grillTop: '#57403a', grillTop2: '#3d2b26', grillSide: '#241713',
    plateTop: '#fffaf1', plateTop2: '#f0e5d6', plateSide: '#c9b499',
    hatchTop: '#fff6e4', hatchTop2: '#f6e3c2', hatchSide: '#c8a878',
    hatchGoTop: '#d6f2cf', hatchGoTop2: '#b3e2ac', hatchGoSide: '#6ba364',
    shadow: 'rgba(95,62,42,0.30)',
    edge: 'rgba(120,80,50,0.32)',
    ink: '#6f4a33',
    inkSoft: 'rgba(111,74,51,0.55)',
    hot: '#e2704f',
    go: '#4fa860',
    pick: '#f0a81e'
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
    var x0 = (W - rowW) / 2;                  // centred, however few there are
    var y = L.pad + 4;
    for (var c = 0; c < box.n; c++) {
      L.crates[c] = { x: x0 + c * (box.w + box.gap), y: y, w: box.w, h: box.h };
    }
    L.cratesBottom = y + box.h;
    // one counter run, bleeding off both edges of the room
    L.counters = [{ x: -8, y: L.pad - 3, w: W + 16, h: box.h + 12 }];

    // --- serving hatch and bin along the bottom wall
    L.hatchH = HATCH_H * k;
    L.hatchY = H - L.pad - L.hatchH;
    L.binW = 52 * k;
    L.binX = L.pad;
    L.hatchX = L.pad + L.binW + gap;
    L.hatchW = W - L.pad * 2 - L.binW - gap;

    // --- grill on the left wall, plates on the right
    L.midTop = L.cratesBottom + 10 * k;
    L.midBottom = L.hatchY - 10 * k;
    L.colW = clamp(W * 0.19, 62, 92);
    L.grillX = L.pad;
    L.plateX = W - L.pad - L.colW;

    var midH = L.midBottom - L.midTop;
    var gN = S.grill.length || 2, pN = S.plates.length || 2;
    L.slotH = Math.min(SLOT_H * k, (midH - gap * (gN - 1)) / gN);
    L.plateH = Math.min(PLATE_H * k, (midH - gap * (pN - 1)) / pN);
    L.grillTop = L.midTop + (midH - (gN * L.slotH + (gN - 1) * gap)) / 2;
    L.plateTop = L.midTop + (midH - (pN * L.plateH + (pN - 1) * gap)) / 2;

    // --- the walkable floor
    L.floor = {
      x0: L.grillX + L.colW + 16,
      x1: L.plateX - 16,
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

  /** Where the chef stands to work a station - always inside the floor. */
  function standPoint(t) {
    var f = L.floor, r;
    if (t.kind === 'crate') {
      r = crateRect(t.i);
      return { x: clamp(r.x + r.w / 2, f.x0, f.x1), y: f.y0 };
    }
    if (t.kind === 'grill') {
      r = slotRect(t.i);
      return { x: f.x0, y: clamp(r.y + r.h / 2, f.y0, f.y1) };
    }
    if (t.kind === 'plate') {
      r = plateRect(t.i);
      return { x: f.x1, y: clamp(r.y + r.h / 2, f.y0, f.y1) };
    }
    if (t.kind === 'hatch') {
      r = hatchRect();
      return { x: clamp(r.x + r.w / 2, f.x0, f.x1), y: f.y1 };
    }
    if (t.kind === 'bin') {
      r = binRect();
      return { x: clamp(r.x + r.w / 2, f.x0, f.x1), y: f.y1 };
    }
    return { x: clamp(t.x, f.x0, f.x1), y: clamp(t.y, f.y0, f.y1) };
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
    S.floats.push({ text: text, x: x, y: y, color: color || '#fff4e0', size: size || 14, t: 0, max: 1.05 });
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
      title: title, sub: sub || '', color: color || '#fff4e0',
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

  function nope(msg, ci) {
    var c = chefAt(ci || 0);
    if (msg) float(msg, c.x, c.y - CHEF_S - 14, '#d1493a', 12);
    Sfx.reject();
  }

  /* --------------------------------------------------------------- tickets */
  function ticketOf(id) {
    for (var i = 0; i < S.tickets.length; i++) if (S.tickets[i].uid === id) return S.tickets[i];
    return null;
  }

  function spawnTicket() {
    var arch = Core.pickCustomer(S.day, Math.random);
    var order = Core.makeOrder(S.day, Math.random, arch);
    var secs = S.cfg.patience * arch.patience;
    S.tickets.push({
      uid: ++uid, arch: arch, items: order.items,
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
    banner('WALKED OUT', t.arch.name + ' gave up waiting', '#e63946');
    S.shake = 14;
    Sfx.walkout();
    buzz([30, 40, 60]);
    syncHud();
    if (S.hearts <= 0) endDay();
  }

  /* -------------------------------------------------------------- day loop */
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

    S.hearts = Core.START_HEARTS;
    S.sales = 0; S.tips = 0; S.served = 0; S.walked = 0; S.perfect = 0;
    S.spawned = 0; S.spawnTimer = 1.2;
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
    banner('DAY ' + day, 'RENT ' + Core.money(S.rent), '#f4b41a');
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
          spark(r.x + r.w / 2, r.y + r.h / 2, 12, 'rgba(120,220,120,0.95)');
          Sfx.perfect();
          buzz(20);
        } else if (stage === 'burnt') {
          float('BURNT', r.x + r.w / 2 + 30, r.y, '#d1493a', 12);
          Sfx.burnt();
        } else {
          float(stage === 'raw' ? 'UNDERDONE' : 'OVERDONE', r.x + r.w / 2 + 34, r.y,
            stage === 'raw' ? '#3d7fbf' : '#e08c10', 11);
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
      spark(h.x + h.w / 2, h.y - 8, 18, 'rgba(240,168,30,0.95)');
      Sfx.register();
      buzz(res.verdict === 'perfect' ? [15, 25, 35] : 15);
    } else {
      S.shake = 16;
      Sfx.buzzer();
      buzz([50, 40, 50]);
    }

    dropTicket(t, 'served');
    syncHud();

    if (S.hearts <= 0) { endDay(); return; }
    if (S.spawned >= S.cfg.customers && S.tickets.length === 0) endDay();
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
      var fc = chefAt(fl.chef || 0);
      fl.x1 = fc.x;
      fl.y1 = fc.y - (L.chefS || CHEF_S) * 0.22;
      if (fl.t >= fl.max) S.flyers.splice(i, 1);
    }
    for (i = 0; i < S.cratePop.length; i++) {
      if (S.cratePop[i] > 0) S.cratePop[i] = Math.max(0, S.cratePop[i] - dt * 4.5);
    }

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
    if (S.role === 'guest') { updateBoardBars(); return; }

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

    if (S.spawned < S.cfg.customers && S.tickets.length < S.cfg.concurrent) {
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

    // The shift is over when the last customer is gone, however they went.
    // This used to be checked only where a plate was handed over, so if the
    // last customer of the day walked out instead of being served the day
    // simply never ended: an empty board, nothing left to spawn, and no way
    // out but the pause menu. Checking it here covers every way a ticket can
    // leave, including any added later.
    if (S.spawned >= S.cfg.customers && S.tickets.length === 0) { endDay(); return; }

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
      Bgm.setIntensity(full * 0.45 + worst * 0.55);
    }

    updateBoardBars();
  }

  /* ----------------------------------------------------------------- draw */
  function label(text, cx, y, color, size, align) {
    ctx.save();
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + (size || 8) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.letterSpacing = '1.2px';
    ctx.fillStyle = color || K.inkSoft;
    ctx.fillText(text, cx, y);
    ctx.restore();
  }

  /**
   * A station as a solid block: side face dropped below the top face, a soft
   * contact shadow on the floor, a rim light along the top edge.
   */
  function slab(r, topA, topB, side, rad, depth, live) {
    var d = depth * (L.k || 1);

    ctx.save();
    ctx.shadowColor = K.shadow;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    Art.rr(ctx, r.x, r.y + d, r.w, r.h, rad);
    ctx.fillStyle = side;
    ctx.fill();
    ctx.restore();

    var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, topA);
    g.addColorStop(1, topB);
    Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.fillStyle = g;
    ctx.fill();

    // rim light so the top face catches the room light
    ctx.save();
    Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 2.4;
    Art.rr(ctx, r.x + 1.2, r.y + 1.2, r.w - 2.4, r.h - 2.4, Math.max(1, rad - 1));
    ctx.stroke();
    ctx.restore();

    if (live) {
      ctx.save();
      ctx.shadowColor = K.pick;
      ctx.shadowBlur = 12;
      Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.strokeStyle = K.pick;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.stroke();
      ctx.restore();
    } else {
      Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
      ctx.strokeStyle = K.edge;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  /** A recess cut into a slab - grill wells, the hatch window. */
  function well(r, fill, rad) {
    Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    Art.rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.40)';
    ctx.lineWidth = 3;
    Art.rr(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, Math.max(1, rad - 1));
    ctx.stroke();
    ctx.restore();
  }

  /*
   * The room never moves, but painting it cost ~110 floor tiles plus the wall
   * grid on every single frame - the largest fixed cost in the loop, and pure
   * waste. Bake it once per layout and blit it. Keyed on the layout numbers it
   * actually reads, so a resize rebuilds it and nothing else does.
   */
  var roomCache = null;
  function drawRoom() {
    var key = L.W + 'x' + L.H + ':' + L.cratesBottom + ':' + (L.k || 1);
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

    // --- tiled back wall
    var wg = g.createLinearGradient(0, 0, 0, floorTop);
    wg.addColorStop(0, K.wallA);
    wg.addColorStop(1, K.wallB);
    g.fillStyle = wg;
    g.fillRect(0, 0, L.W, floorTop);
    g.strokeStyle = K.wallTile;
    g.lineWidth = 1;
    var t = 18 * (L.k || 1);
    for (var wy = t; wy < floorTop; wy += t) {
      g.beginPath(); g.moveTo(0, wy); g.lineTo(L.W, wy); g.stroke();
    }
    for (var wx = t * 1.6; wx < L.W; wx += t * 1.6) {
      g.beginPath(); g.moveTo(wx, 0); g.lineTo(wx, floorTop); g.stroke();
    }

    // --- checkerboard floor running to the bottom of the room
    var y1 = L.H;
    g.save();
    g.beginPath();
    g.rect(0, floorTop, L.W, y1 - floorTop);
    g.clip();
    var tile = Math.max(22, L.W / 10);
    for (var y = floorTop; y < y1; y += tile) {
      for (var x = -tile; x < L.W + tile; x += tile) {
        var odd = (Math.floor(x / tile) + Math.floor((y - floorTop) / tile)) % 2;
        g.fillStyle = odd ? K.floorB : K.floorA;
        g.fillRect(x, y, tile, tile);
      }
    }
    // the counter casts onto the floor, and the light falls off toward the back
    var vg = g.createLinearGradient(0, floorTop, 0, floorTop + 46);
    vg.addColorStop(0, 'rgba(95,62,42,0.30)');
    vg.addColorStop(1, 'rgba(95,62,42,0)');
    g.fillStyle = vg;
    g.fillRect(0, floorTop, L.W, 46);
    var lg = g.createLinearGradient(0, floorTop, 0, y1);
    lg.addColorStop(0, 'rgba(255,255,255,0.0)');
    lg.addColorStop(1, 'rgba(255,255,255,0.30)');
    g.fillStyle = lg;
    g.fillRect(0, floorTop, L.W, y1 - floorTop);
    g.restore();
  }

  function drawCounter() {
    for (var i = 0; i < L.counters.length; i++) {
      slab(L.counters[i], K.counterTop, K.counterTop2, K.counterSide, 12, DEPTH.counter, false);
    }
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
      var raw = ing.grill ? { done: 0 } : null;
      var pop = S.cratePop[i] || 0;

      // the box recoils a little when something is pulled out of it
      ctx.save();
      if (pop > 0) {
        var cx0 = r.x + r.w / 2, cy0 = r.y + r.h;
        ctx.translate(cx0, cy0);
        ctx.scale(1 + pop * 0.06, 1 - pop * 0.08);
        ctx.translate(-cx0, -cy0);
      }

      slab(r, K.boxTop, K.boxTop2, K.boxSide, 6, DEPTH.crate, live);

      // interior
      var frontH = Math.max(13, r.h * 0.30);
      var w = { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - frontH - 3 };
      var wg = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
      wg.addColorStop(0, K.boxIn2);
      wg.addColorStop(1, K.boxIn);
      Art.rr(ctx, w.x, w.y, w.w, w.h, 4);
      ctx.fillStyle = wg;
      ctx.fill();

      // contents, stacked so the box reads as stocked
      ctx.save();
      Art.rr(ctx, w.x, w.y, w.w, w.h, 4);
      ctx.clip();
      /* Stack as many as it takes to fill the box. A fixed count left a tub of
         sauce looking empty (it is 2px tall) while buns overflowed it. */
      var hFrac = Math.max(0.04, Art.heightOf(id, 1));
      var iw = Math.min(w.w - 4, (w.h * 0.42) / hFrac);
      var ih = hFrac * iw;
      var step = Math.max(1.5, ih * 0.74);
      var count = clamp(Math.round((w.h * 0.58) / step), 2, 6);
      var base = w.y + w.h + ih * 0.35;
      for (var k = count - 1; k >= 0; k--) {
        ctx.globalAlpha = k === 0 ? 1 : Math.max(0.45, 0.92 - k * 0.1);
        Art.drawLayer(ctx, id, w.x + w.w / 2, base - ih - k * step, iw, raw);
      }
      ctx.globalAlpha = 1;
      var sg = ctx.createLinearGradient(0, w.y, 0, w.y + w.h * 0.5);
      sg.addColorStop(0, 'rgba(40,22,6,0.45)');
      sg.addColorStop(1, 'rgba(40,22,6,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(w.x, w.y, w.w, w.h * 0.5);
      ctx.restore();

      // front panel, drawn over the contents
      var f = { x: r.x + 1, y: r.y + r.h - frontH, w: r.w - 2, h: frontH };
      var fg = ctx.createLinearGradient(0, f.y, 0, f.y + f.h);
      fg.addColorStop(0, K.boxFront);
      fg.addColorStop(1, K.boxFront2);
      Art.rr(ctx, f.x, f.y, f.w, f.h, 5);
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,70,25,0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // slat seam
      ctx.strokeStyle = 'rgba(110,70,25,0.22)';
      ctx.beginPath();
      ctx.moveTo(f.x + 3, f.y + f.h * 0.62);
      ctx.lineTo(f.x + f.w - 3, f.y + f.h * 0.62);
      ctx.stroke();

      // a warm tag on anything that has to be cooked first
      if (ing.grill) {
        Art.rr(ctx, f.x + 2.5, f.y + 2.5, 3.5, f.h - 5, 1.8);
        ctx.fillStyle = K.hot;
        ctx.fill();
      }

      label(ing.short || ing.name || id, r.x + r.w / 2, f.y + f.h * 0.35, '#5b3a17',
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
      var w = fl.w * (0.55 + 0.45 * e);
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
    slab(body, K.grillTop, K.grillTop2, K.grillSide, 13, DEPTH.grill, false);
    label('GRILL', body.x + body.w / 2, L.grillTop - 8, '#ffb59c', 8);

    var win = S.fx.perfectWindow;
    var tMax = Core.COOK_TIME + win / 2 + Core.BURN_TIME;

    for (var i = 0; i < S.grill.length; i++) {
      var r = slotRect(i);
      var g = S.grill[i];
      var live = targeted('grill', i);
      well(r, g ? '#2a1a15' : '#1f1310', 10);

      ctx.save();
      Art.rr(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 2;
      for (var gx = r.x + 4; gx < r.x + r.w; gx += 8) {
        ctx.beginPath();
        ctx.moveTo(gx, r.y);
        ctx.lineTo(gx, r.y + r.h);
        ctx.stroke();
      }
      // embers under whatever is cooking
      if (g) {
        var eg = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h * 0.5, 2,
          r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.6);
        eg.addColorStop(0, 'rgba(255,120,50,0.30)');
        eg.addColorStop(1, 'rgba(255,120,50,0)');
        ctx.fillStyle = eg;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();

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
      var ph = Art.heightOf(g.id, pw);
      Art.drawLayer(ctx, g.id, r.x + r.w / 2, (r.y + barTop) / 2 - ph / 2, pw,
        { done: look.done, char: look.char });

      if (stage === 'perfect') {
        ctx.save();
        ctx.shadowColor = 'rgba(79,168,96,0.95)';
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
      ctx.fillStyle = 'rgba(79,168,96,0.6)';
      ctx.fill();
      Art.rr(ctx, bx, by, Math.max(2, bw * clamp(g.t / tMax, 0, 1)), bh, 2.5);
      ctx.fillStyle = stage === 'perfect' ? K.go
        : (stage === 'raw' ? '#7fb6e8' : (stage === 'over' ? '#f0a81e' : K.hot));
      ctx.fill();
    }
  }

  function drawPlates() {
    // one plating bench with the plates sitting on it
    var n = S.plates.length;
    var last = plateRect(n - 1);
    var body = {
      x: L.plateX - 3, y: L.plateTop - 16,
      w: L.colW + 6, h: (last.y + last.h) - L.plateTop + 22
    };
    slab(body, K.plateTop, K.plateTop2, K.plateSide, 13, DEPTH.plate, false);
    label('PLATES', body.x + body.w / 2, L.plateTop - 8, '#5a86b8', 8);

    for (var i = 0; i < n; i++) {
      var r = plateRect(i);
      var p = S.plates[i];
      var live = targeted('plate', i);
      var cx = r.x + r.w / 2, py = r.y + r.h - 10;

      // the plate, as a shallow dish with a rim
      ctx.save();
      ctx.shadowColor = 'rgba(95,62,42,0.28)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.ellipse(cx, py, r.w * 0.40, r.h * 0.13, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d9e3ec';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.ellipse(cx, py - 2, r.w * 0.40, r.h * 0.13, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f8fb';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, py - 2, r.w * 0.26, r.h * 0.085, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#e6eef5';
      ctx.fill();

      if (live) {
        Art.rr(ctx, r.x, r.y, r.w, r.h, 11);
        ctx.strokeStyle = K.pick;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }

      if (!p.stack.length) {
        label('EMPTY', cx, r.y + r.h * 0.42, 'rgba(111,74,51,0.35)', 7.5);
        continue;
      }
      var shown = Core.displayStack(p.stack);
      var bw = Art.fitWidth(shown, r.w * 0.74, r.h - 16);
      Art.drawStack(ctx, shown, cx, py - 3, bw);
    }
  }

  function drawHatchAndBin() {
    var h = hatchRect();
    var live = targeted('hatch');
    var ready = anyPlateHeld();
    slab(h,
      ready ? K.hatchGoTop : K.hatchTop,
      ready ? K.hatchGoTop2 : K.hatchTop2,
      ready ? K.hatchGoSide : K.hatchSide, 14, DEPTH.hatch, live);

    // a serving window cut through to the lit dining room beyond
    var wRect = { x: h.x + 8, y: h.y + 6, w: h.w - 16, h: h.h - 22 };
    well(wRect, ready ? '#cdf0c6' : '#fff0cf', 8);
    label('▲  S E R V E  ▲', h.x + h.w / 2, wRect.y + wRect.h / 2,
      ready ? '#2c7038' : '#8a6039', 10);
    label(S.tickets.length + ' waiting', h.x + h.w / 2, h.y + h.h - 8, K.inkSoft, 7.5);

    var b = binRect();
    var bl = targeted('bin');
    slab(b, K.hatchTop, K.hatchTop2, K.hatchSide, 14, DEPTH.hatch, bl);

    // Drawn rather than an emoji: 🗑 has no glyph on plenty of Android builds.
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2 - 4;
    var bw = Math.min(b.w * 0.44, 20), bh = bw * 1.05;
    ctx.save();
    ctx.fillStyle = '#8fa3ae';
    Art.rr(ctx, cx - 4, cy - bh / 2 - 8, 8, 3, 1.5);            // handle
    ctx.fill();
    Art.rr(ctx, cx - bw / 2 - 3, cy - bh / 2 - 5, bw + 6, 4, 2); // lid
    ctx.fill();
    ctx.beginPath();                                            // tapered body
    ctx.moveTo(cx - bw / 2, cy - bh / 2);
    ctx.lineTo(cx + bw / 2, cy - bh / 2);
    ctx.lineTo(cx + bw * 0.36, cy + bh / 2);
    ctx.lineTo(cx - bw * 0.36, cy + bh / 2);
    ctx.closePath();
    ctx.fillStyle = '#a8bcc7';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,115,130,0.65)';
    ctx.lineWidth = 1.4;
    for (var s = -1; s <= 1; s++) {
      ctx.beginPath();
      ctx.moveTo(cx + s * bw * 0.24, cy - bh * 0.32);
      ctx.lineTo(cx + s * bw * 0.18, cy + bh * 0.36);
      ctx.stroke();
    }
    ctx.restore();
    label('BIN', cx, b.y + b.h - 8, K.inkSoft, 7);
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
      var flying = S.flyers.some(function (f) { return (f.chef || 0) === i; });
      // a marker so you can tell which cook is yours
      if (S.chefs.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y + 2, cs * 0.30, cs * 0.10, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i === S.me ? 'rgba(79,168,96,0.95)' : 'rgba(90,134,184,0.9)';
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
      ctx.font = '900 ' + f.size + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(12,7,5,0.9)';
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
    band.addColorStop(0, 'rgba(12,7,5,0)');
    band.addColorStop(0.18, 'rgba(12,7,5,0.92)');
    band.addColorStop(0.82, 'rgba(12,7,5,0.92)');
    band.addColorStop(1, 'rgba(12,7,5,0)');
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

    ctx.font = '900 ' + size + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(12,7,5,0.92)';
    ctx.strokeText(b.title, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.title, 0, 0);
    if (b.sub) {
      ctx.font = '800 ' + (size * 0.46) + 'px "Trebuchet MS", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(12,7,5,0.92)';
      ctx.strokeText(b.sub, 0, size * 0.88);
      ctx.fillStyle = '#fff4e0';
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
    ctx.fillStyle = 'rgba(12,7,5,0.62)';
    ctx.fillRect(0, 0, L.W, L.H);

    var cy = (L.floor.y0 + L.floor.y1) / 2;
    var size = Math.min(L.W * 0.062, 22);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '900 ' + size + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = '#f4b41a';
    ctx.fillText(title, L.W / 2, cy - size * 0.6);

    ctx.font = '700 ' + (size * 0.6) + 'px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,244,224,0.78)';
    ctx.fillText(sub, L.W / 2, cy + size * 0.5);

    // three dots ticking over, so it is visibly alive rather than frozen
    var n = Math.floor(nowMs() / 400) % 4;
    var dot = size * 0.16;
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = i < n ? 0.9 : 0.25;
      ctx.beginPath();
      ctx.arc(L.W / 2 + (i - 1) * dot * 3, cy + size * 1.5, dot, 0, Math.PI * 2);
      ctx.fillStyle = '#fff4e0';
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
  }

  var MINI_W = 44, MINI_H = 50;

  function renderBoard() {
    el.board.innerHTML = '';
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

    S.tickets.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'ticket' + (t.arch.id === 'rush' ? ' rush' : '');
      d.setAttribute('data-uid', t.uid);

      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = t.arch.emoji;
      d.appendChild(who);

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

  function updateBoardBars() {
    for (var i = 0; i < S.tickets.length; i++) {
      var t = S.tickets[i];
      if (!t.barEl) continue;
      var ratio = clamp(t.patience / t.max, 0, 1);
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
        : 'You took in ' + Core.money(total) + ' against ' + Core.money(S.rent) +
          ' of rent. The landlord is not sympathetic.';
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
    el.dayEndNote.textContent = S.perfect === S.served && S.served > 0
      ? 'Every single ticket perfect. The regulars are talking.'
      : 'Rent covered. ' + Core.money(S.money) + ' in the till.';
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
      news.forEach(function (ing) {
        var d = document.createElement('div');
        d.className = 'u';
        var c = document.createElement('canvas');
        c.width = Math.round(64 * dpr);
        c.height = Math.round(34 * dpr);
        d.appendChild(c);
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = ing.name;
        d.appendChild(n);
        el.unlockList.appendChild(d);
        var g = c.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        Art.drawIcon(g, ing.id, 64, 34);
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
          banner('JOINED', 'waiting for the host', '#4fa860');
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
            banner('FRIEND IS BACK', '', '#4fa860');
          }
          return;
        }
        if (hostLeft) { endCoop('the host left'); return; }
        // The guest dropped. Keep the room open and park their chef.
        var c = S.chefs[1];
        if (c) { c.target = null; c.tx = c.x; c.ty = c.y; }
        banner('FRIEND DROPPED', 'room ' + S.roomCode + ' is still open', '#f0a81e');
      },

      onMessage: onCoopMessage,

      onClose: function (why) {
        if (!coop()) { el.coopNote.textContent = why; return; }
        // Our own socket died. Try to get back into the same room.
        if (S.roomCode && S.reconnectTries < MAX_RECONNECT) {
          S.reconnectTries++;
          banner('RECONNECTING', 'try ' + S.reconnectTries + ' of ' + MAX_RECONNECT, '#f0a81e');
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
      banner('CO-OP ENDED', why || '', '#d1493a');
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
      plates: S.plates.map(function (p) { return p.stack; }),
      grill: S.grill.map(function (g) { return g ? { id: g.id, t: g.t } : null; }),
      tickets: S.tickets.map(function (t) {
        return { uid: t.uid, a: t.arch.id, items: t.items, p: t.patience, m: t.max };
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
      banner('DAY OVER', 'waiting for the host', '#f4b41a');
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









