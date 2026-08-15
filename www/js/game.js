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
  /*
   * The cook reacts, briefly. A verdict is already a banner and a colour wash;
   * this is the third telling, and the only one that is HIM - a small cheer for
   * a plate that landed, a droop for one that came back.
   */
  function chefMood(mode, secs, who) {
    S.chefMood = { mode: mode, at: nowMs(), until: nowMs() + secs * 1000, who: who || 0 };
  }

  /*
   * Keep a pose alive without restarting it.
   *
   * The chopping pose is renewed every frame the cook stays at the board, and
   * chefMood stamps `at` - which is the phase the animation is read from - so
   * calling it each frame would pin him to the first frame of the swing
   * forever. Push the deadline instead and leave the phase alone.
   */
  function chefMoodHold(mode, secs, who) {
    var m = S.chefMood;
    who = who || 0;
    if (m && m.mode === mode && m.who === who && m.until > nowMs()) {
      m.until = nowMs() + secs * 1000;
      return;
    }
    chefMood(mode, secs, who);
  }

  function setRush(heat) {
    var next = rushOn ? heat > 0.55 : heat > 0.72;
    if (next === rushOn) return;
    rushOn = next;
    try {
      document.body.classList.toggle('rush', rushOn);
    } catch (e) { /* no shell to warm up */ }
    // The batten is part of the board's drawing now, so the wood reddening is
    // a repaint rather than a background on the element behind it.
    if (typeof renderBoard === 'function') renderBoard();
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
    // What real money bought, and which of it the cook is wearing. Deliberately
    // outside everything a new shop resets: a purchase is not progress.
    owned: [], skin: 'classic',
    fx: Core.effects({}),

    waste: 0, sales: 0, tips: 0, served: 0, walked: 0, perfect: 0,
    lifetime: 0,
    spawned: 0, spawnTimer: 0, cfg: null, rent: 0, menu: [],
    timeLeft: 0, dayLength: 0,   // the shift clock; see Core.dayLength
    closedBy: null,              // 'clock' when the buzzer ended it

    tickets: [],   // { uid, arch, items, patience, max, node, barEl }
    plates: [],    // { stack: [{id, cook}], side, drink }  - the whole tray
    grill: [],     // { id, t } | null
    fryer: [],     // { t } | null, one per well - the same clock the grill runs
    board: null,   // { id, cut, portions, wet, juice } - the prep board
    drinkTaps: [], // the flavours the fountain is plumbed for today
    pour: null,    // { flavor, t } - a cup filling under one of the spouts
    // One cook in single player, two in co-op. S.me is which one this device
    // drives; S.chef below stays a live alias to it so the rest of the game
    // reads exactly as it did before.
    chefs: [],
    me: 0,
    role: 'solo',        // solo | host | guest
    peer: false,         // is the other cook connected
    snapSeq: 0,
    lastSeq: -1,   // highest state packet a guest has applied

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

  /*
   * Which cook is working the board, or -1. "Working" means he is not on his
   * way somewhere else and his feet are within a body's width of the spot the
   * board is worked from - the same place tapping it would send him.
   */
  /*
   * Which cook is working a station, or -1.
   *
   * This used to ask whether anybody was standing NEAR the station, which is
   * not the same question. The board sits at the top of the plate wall and the
   * crate row runs along the top of the room, so on a 375px phone the stand
   * point for two of the crates is 2px from the board's - a cook fetching
   * cheese was chopping the tomato behind him. Ask what he was sent to
   * instead; it is exact, and it costs nothing.
   */
  function cookAtStation(kind) {
    for (var i = 0; i < S.chefs.length; i++) {
      var c = S.chefs[i];
      if (!c.target && c.at === kind) return i;
    }
    return -1;
  }

  function cookAtBoard() {
    return L.board ? cookAtStation('board') : -1;
  }

  /** Which cook is at the fountain, or -1. Same rule as the board. */
  function cookAtTap() {
    return L.tapH ? cookAtStation('tap') : -1;
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
      day: S.day, bestDay: S.bestDay, money: S.money, levels: S.levels,
      owned: S.owned || [], skin: S.skin || 'classic',
      muted: S.muted, musicOff: !!S.musicOff, lifetime: S.lifetime || 0,
      runSeed: S.runSeed || 0
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

  /*
   * Clears the run. Purchases are not part of the run - a player who starts a
   * brand new shop has not asked for a refund - so the receipts go straight
   * back to disk rather than waiting for the next autosave to notice.
   */
  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    if ((S.owned && S.owned.length) || (S.skin && S.skin !== 'classic')) save();
  }

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
  // under this a crate cannot show its name, and drawCrate stops drawing the
  // grill flame and the chop blade entirely - see the w >= 62 guards there
  var CRATE_MIN_W = 62;
  var SLOT_H = 42, PLATE_H = 50, CHEF_S = 54;
  // The fry box is deeper than a burner - it holds two wells and its supply -
  // and the fountain is a little taller than a plate.
  // The fry box carries its own supply above the wells, so it is deeper than a
  // burner. Splitting it here rather than floating the sack and the cutter over
  // the grill: at 28px wide over a 68px column they collided with each other
  // and with the burner above, and an illegible label is worse than none.
  var FRYER_H = 78, TAP_H = 54, FREEZER_H = 46;
  /*
   * One vegetable, one portion.
   *
   * This began as a PREP station - a board of tomato prepped once and drawn
   * from all service, so the walking cost was paid when the board ran dry
   * rather than on every plate. It is a per-order station now by request: a
   * tomato chops into a tomato.
   *
   * That is four times the trips and, since the board only advances while a
   * cook is standing at it, four times the standing. CHOP_TIME is the dial if
   * the later days come out too heavy - the cost per portion is CHOP_TIME plus
   * a crate round trip, where it used to be a quarter of that.
   */
  var CHOP_TIME = 3.4;        // seconds from whole vegetable to a full board
  var PREP_PORTIONS = 1;
  // strikes per vegetable. CHOP_TIME / CHOPS = 567ms a swing, near the 645ms
  // the free-running blade used to take, but now a whole number of them.
  var CHOPS = 6;
  // seconds of the cook standing at the fountain to fill one cup
  var POUR_TIME = 1.5;
  var FRY_SUPPLY = 0.36;          // the share of the box the supply row takes

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
  /*
   * Crates are width-driven: eight of them have to fit across the line, so how
   * wide they are is arithmetic and not a choice. Their HEIGHT gets to follow
   * the room a little, though - at k = 1.85 a 54px box under a 100px cook read
   * as a doll's shelf. Capped well below k so the boxes deepen without the row
   * eating the wall behind it.
   *
   * compactHeight() calls this without a k on purpose: it is measuring the room
   * at its most compact in order to work k out in the first place.
   */
  /*
   * The shelf. Pass roomH and it may run in two rows; leave it out and it
   * answers for the most compact shelf there is, which is what compactHeight
   * wants.
   *
   * A single row divides the wall between every box on the menu, and by the
   * time the menu is eight ingredients that is 40px on a phone: too narrow for
   * the name, and under the 62px the grill's flame and the board's blade need,
   * so the two markers that teach the game disappear exactly when the game
   * gets complicated enough to need them. Wrapping buys back the full width
   * per box at the cost of one row's height, which the columns below can
   * afford on a tall screen and cannot on a short one - hence the guard.
   *
   * Never three rows. That is a shelf with a kitchen attached.
   */
  function crateSize(W, k, roomH) {
    var n = menuLen();
    var gap = Math.min(GAP, (W - 16) * 0.02);
    var floor = 54 * clamp(k || 1, 1, 1.34);

    function fit(per) {
      var w = Math.min((W - 16 - gap * (per - 1)) / per, CRATE_MAX_W);
      return { w: w, h: clamp(w * 1.02, floor, 92) };
    }

    var rows = 1, per = n, f = fit(n);
    if (n > 1 && roomH && f.w < CRATE_MIN_W) {
      var two = fit(Math.ceil(n / 2));
      /*
       * Only if the columns can still stand up afterwards.
       *
       * A flat share of the room is the wrong test: it wraps a 320x480 into a
       * kitchen whose plates fall under MIN_TAPPABLE, and refuses a 360x640
       * that had the height to spare. Ask instead what the two walls actually
       * need for tonight's equipment - which is the same arithmetic the
       * layout below does - and only take the row if what is left covers it.
       */
      var gN = S.grill.length || 2, pN = S.plates.length || 2;
      var fryN = S.fryer.length ? 1 : 0;
      var tapN = 0;   // the fountain moved to the bottom wall; see L.tapX above
      var colW = clamp(W * 0.19, 62, 92);
      var target = MIN_TAPPABLE * 1.20;         // a margin over the turn-your-phone sheet
      var needGrill = gN * target + fryN * target * 1.35 + gap * (gN + fryN - 1);
      var needPlate = (S.board ? colW * 1.16 + gap + 4 : 0) +
                      pN * target + tapN * target * 1.10 + gap * (pN + tapN - 1);
      // what the mid band is left with once the shelf, the hatch and the
      // margins above and below it have taken their share
      var midAfter = roomH - (two.h * 2 + gap) - HATCH_H - 46;
      if (midAfter >= Math.max(needGrill, needPlate)) {
        rows = 2; per = Math.ceil(n / 2); f = two;
      }
    }
    return {
      w: f.w, h: f.h, gap: gap, n: n, rows: rows, per: per,
      shelfH: f.h * rows + gap * (rows - 1)
    };
  }

  /** The height the room needs at its most compact, before any growing. */
  function compactHeight() {
    var gN = S.grill.length || 2, pN = S.plates.length || 2;
    return 8 + crateSize(cv.clientWidth || 400).h + 12
      + Math.max(150, gN * SLOT_H + (gN - 1) * GAP, pN * PLATE_H + (pN - 1) * GAP)
      + 10 + HATCH_H + 8;
  }

  var layingOut = false;

  function resize() {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (layingOut) return;
    layingOut = true;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    showCramped();
    // The storefront sign only shows between shifts, and only when the spacer
    // has slack to give it - but its box changes with every relayout.
    if (el.signArt && el.signArt.clientWidth) {
      var sw = el.signArt.clientWidth, sh = el.signArt.clientHeight;
      if (sh > 8) paintOn(el.signArt, sw, sh, function (g) { Art.ui.sign(g, 0, 0, sw, sh); });
    }
    // Every drawn screen is a canvas, so a rotation or a resized window has to
    // redraw whichever one is up and move its controls back onto the boxes it
    // drew. Only one is ever showing, but checking all four is a line each.
    if (!el.start) return;
    if (el.start.classList.contains('show')) paintTitle();
    if (el.dayEnd && el.dayEnd.classList.contains('show')) paintDayEnd();
    if (el.shop && el.shop.classList.contains('show')) renderShop();
    if (el.pause && el.pause.classList.contains('show')) paintPause();
    layingOut = false;
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
  /*
   * The one switch that stops draw(), so it has to be impossible to get stuck
   * on. It used to return early whenever the value had not changed, which
   * meant a stale  survived a restart: the loop kept skipping draw()
   * and the kitchen stayed blank while the HUD and the board - which repaint
   * on their own - carried on as if nothing were wrong. A frozen room with a
   * running clock and no explanation on it.
   *
   * The class and the overlay are now written every time, and only the
   * transition work is guarded.
   */
  function showCramped() {
    var cramped = L.slotH < MIN_TAPPABLE || L.plateH < MIN_TAPPABLE;
    var changed = cramped !== S.cramped;
    S.cramped = cramped;
    if (document.body && document.body.classList) {
      document.body.classList.toggle('cramped', cramped);
    }
    if (cramped && el.rotateArt) {
      var rw = el.rotate.clientWidth || window.innerWidth;
      var rh = el.rotate.clientHeight || window.innerHeight;
      paintOn(el.rotateArt, rw, rh, function (g) { Art.ui.rotate(g, 0, 0, rw, rh); });
    }
    // Coming back from it, the loop has been idle: don't hand it a huge dt.
    if (changed && !cramped) last = 0;
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
    /*
     * The ceiling was 1.5, and a modern phone wants more than that. Once the
     * shift's slack stopped going to the storefront sign the kitchen got 531px
     * on a 375x812 handset, which asks for k = 1.76 - so the room stopped
     * growing at 1.5 and the other 26% became bare checkerboard with a small
     * cook standing in the middle of it. 1.85 closes that on the phones people
     * actually hold; a tablet still hits the cap, which is the point of having
     * one. Slot and plate heights are separately bounded by the band they sit
     * in, so nothing can grow past its own wall.
     */
    var k = clamp(Math.round(H / 24) * 24 / compactHeight(), 0.72, 1.85);
    var gap = GAP * k;
    L.gap = gap;
    L.k = k;
    L.chefS = CHEF_S * k;      // the cook grows with the room, not against it

    // Tonight's floor plan. Worked out from the day alone so a guest lands in
    // the same kitchen as the host; see Core.dayRoom.
    var room = Core.dayRoom(S.day || 1, S.runSeed);
    L.room = room;

    /* --- the line along the top wall: every box on one shelf, sized to fit.
       dayMenu() already returns buns, then toppings, then sauces, so the row
       stays organised left to right without needing labelled sections. */
    // Crates size themselves off the screen width, not off k - they are already
    // width-constrained, and scaling them again just made them enormous.
    var box = crateSize(W, k, H);
    L.crateW = box.w;
    L.crateH = box.h;
    L.crates = [];
    var rowW = Math.min(box.n, box.per) * box.w + (Math.min(box.n, box.per) - 1) * box.gap;
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
    // The decorative runs are a single-row idea; a wrapped shelf is busy
    // enough already, and both rows simply centre.
    if (box.rows === 1 && !room.plain && slack > box.w * 0.6) {
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
      var row = Math.floor(c / box.per);
      var col = c - row * box.per;
      // the last row can be short, so it centres on its own count
      var inRow = Math.min(box.per, box.n - row * box.per);
      var rx = box.rows === 1 ? x0
             : (W - (inRow * box.w + (inRow - 1) * box.gap)) / 2;
      L.crates[c] = {
        x: rx + col * (box.w + box.gap) + (splitAt > 0 && c >= splitAt ? extra : 0),
        y: y + row * (box.h + box.gap), w: box.w, h: box.h
      };
    }
    L.cratesBottom = y + box.shelfH;
    // one counter run, bleeding off both edges of the room
    L.counters = [{ x: -8, y: L.pad - 3, w: W + 16, h: box.shelfH + 12 }];

    // --- serving hatch and bin along the bottom wall. The bin changes ends
    // with the room, so "throw it away" is not always the same corner.
    /*
     * The bottom band is the hatch's own height, and the fountain standing on
     * it gets no more. Growing the band raises hatchY, which shortens the
     * floor - and by a different number of pixels on every screen, because it
     * scales with k. Walk fairness is normalised against the floor's DIAGONAL,
     * so a floor that changes shape per device makes the same traverse cost
     * 1.03s on one phone and 1.29s on another. Even a 8% bump broke it.
     *
     * The machine got its room in WIDTH instead, which is the axis the levers
     * are on: 71px in the plate column with a 20px lever, 93-170px here with
     * a 26-48px one.
     */
    L.hatchH = HATCH_H * k;
    L.hatchY = H - L.pad - L.hatchH;
    /*
     * The bottom wall is FIXED: bin left, hatch centre, fountain right.
     *
     * The bin used to change corners from day seven and the fountain rode
     * whichever column the plates were on, so the two things a player reaches
     * for without looking moved under them. Everything else about the room
     * still rerolls - the palette, the crate line, the wall colours, which
     * wall is the grill - but these three keep their place and only their
     * size answers to the room.
     */
    L.binW = 52 * k;
    L.binX = L.pad;

    /*
     * A window, not a serving bar.
     *
     * The hatch used to take every pixel the bin did not, which on a phone is
     * about 283 x 46 - a six-to-one letterbox with a little scalloped awning
     * on top of it, which reads as a comedy prop rather than a window onto a
     * dining room. Capped at a bit over three times its own height and centred
     * on the back wall, with the bin in whichever corner the room put it.
     *
     * Still an enormous tap target at ~150 x 46; MIN_TAPPABLE is 22.
     */
    /*
     * The fountain's width is set by its levers, not by the wall: it draws
     * three columns at a 0.283 step, so 92px is the narrowest that keeps each
     * one over MIN_TAPPABLE. In the plate column it was 71px wide and a lever
     * was 20px - a machine you could see three flavours on and not press one.
     */
    L.tapH = (S.drinkTaps && S.drinkTaps.length) ? L.hatchH : 0;
    L.tapW = L.tapH ? clamp(W * 0.33, 104, 190) : 0;
    L.tapX = W - L.pad - L.tapW;
    L.tapY = L.hatchY;

    var freeX = L.pad + L.binW + gap;
    var freeW = W - L.pad * 2 - L.binW - gap - (L.tapW ? L.tapW + gap : 0);
    L.hatchW = Math.min(freeW, Math.max(L.hatchH * 2.6, W * 0.42));
    L.hatchX = clamp((W - L.hatchW) / 2, freeX, freeX + freeW - L.hatchW);

    // --- the two working walls. Which one is the grill changes every shift.
    L.midTop = L.cratesBottom + 10 * k;
    L.midBottom = L.hatchY - 10 * k;
    L.colW = clamp(W * 0.19, 62, 92);
    var leftX = L.pad, rightX = W - L.pad - L.colW;
    /*
     * The grill wall is the left one, always. The freezer is pinned to the
     * top-left corner and the fryer hangs under it, so the wall they stand on
     * cannot be the one that flips - the whole fry line would change sides
     * with it. Variety lives in the palette, the crate line and the walls.
     */
    var grillLeft = true;
    L.grillX = grillLeft ? leftX : rightX;
    L.plateX = grillLeft ? rightX : leftX;

    /*
     * The prep board is a wall fitting, not an island.
     *
     * It used to stand in open floor because both walls were full - and it was
     * wrong in every way that mattered: the cook worked it from a clamped
     * point against the wall anyway, walked through the tabletop on the most
     * common traverse, and it ate the middle of the room.
     *
     * It goes on the plate side instead, at the top of the band, and the plate
     * stack gives up a little width and drops below it. The board keeps more
     * width than the plate column because the art needs it - the vegetable's
     * radius is capped at 0.15 of the board's width, so a column-width board
     * draws a 6px tomato nobody can identify.
     */
    L.plateW = S.board ? Math.max(52, L.colW * 0.86) : L.colW;
    // Only a shade wider than the column it shares a wall with. Wider was
    // tempting - the art likes a long counter - but the floor's edge is set by
    // the widest thing on this side, and a board half again the column's width
    // pulled that edge 36px in and left the bin out of the cook's reach on a
    // short screen. The legibility that bought is taken back in art-prep,
    // where the vegetable's radius was capped at 0.15 of the board's width.
    L.boardW = S.board ? L.colW : 0;
    // ...and never more than a third of the band, or a short landscape screen
    // hands the board so much height that the plates below it fall under
    // MIN_TAPPABLE and the room asks the player to turn the phone.
    L.boardH = S.board ? Math.min(L.boardW * 1.16, (L.midBottom - L.midTop) * 0.30) : 0;
    if (S.board) {
      L.plateX = grillLeft ? (W - L.pad - L.plateW) : leftX;
      L.boardX = grillLeft ? (W - L.pad - L.boardW) : leftX;
    }

    /*
     * The two working walls, each with a machine hung under its column.
     *
     * The fry station goes below the grill because it IS a grill: something
     * goes in, a timer runs, and it comes out perfect or ruined. The fountain
     * goes below the plates because a drink is assembly, not cooking. Both
     * columns had the room already - on a 375px phone the grill band used 155
     * of 340px and the plate band 183, so the machines are taking slack rather
     * than squeezing the stations that were there.
     *
     * They are counted into the column's own division, so when the kitchen
     * grows to five burners the fryer loses height with everything else and
     * showCramped still speaks for all of them.
     */
    var midH = L.midBottom - L.midTop;
    var gN = S.grill.length || 2, pN = S.plates.length || 2;
    var fryN = S.fryer.length ? 1 : 0;              // the fryer is one box, two wells
    // [] is truthy: without the length check the fountain stood in the room
    // from day one with CLOSED written on it, holding column space the plates
    // could have used, for a machine nothing could order from yet.
    var tapN = 0;   // the fountain moved to the bottom wall; see L.tapX above
    // the board owns the top of the plate band; everything under it divides
    // what is left, which is what makes the plate stack shrink and sit lower
    var boardFoot = S.board ? (L.cratesBottom + 8 + L.boardH) : L.midTop;
    var plateSpace = L.midBottom - boardFoot;
    /*
     * The left wall reads top to bottom in the order the food moves: the
     * freezer, the fryer under it, and the grill at the bottom. The freezer
     * used to be drawn inside the fry box's own top third, which made it a
     * decoration on another machine rather than a place; it has its own band
     * now and is pinned to the top-left corner of the room.
     */
    // drawGrill and drawPlates wrap their slots in a bench that reaches 16px
    // above the first and 6px below the last; both walls have to pay for it.
    var BENCH_TOP = 16, BENCH_BOT = 6, CHROME = BENCH_TOP + BENCH_BOT;
    L.freezerH = fryN ? Math.min(FREEZER_H * k, midH * 0.24) : 0;
    var coldBand = fryN ? L.freezerH + gap : 0;
    var leftSpace = midH - coldBand;
    /*
     * The bench's chrome is reserved when the wall can pay for it and given up
     * when it cannot. Charging it unconditionally pushed a 360x300 kitchen's
     * burners to 20.9px - under MIN_TAPPABLE - and the room started asking the
     * player to turn the phone. A bench that overlaps the fryer by a few px is
     * a smaller sin than a station nobody can hit.
     */
    function slotFor(chrome) {
      return Math.min(SLOT_H * k,
                      (leftSpace - chrome - gap * (gN + fryN - 1)) / (gN + fryN * 1.35));
    }
    var gChrome = afford(CHROME, leftSpace, gap * (gN + fryN - 1), gN + fryN * 1.35);
    L.slotH = slotFor(gChrome);
    /*
     * The fountain is budgeted at 1.55 slots because that is what it takes -
     * tapH is plateH * 1.55. Dividing by (pN + tapN) gave it one slot and the
     * column ran 8px past the bottom of its own band. It had slack to hide in
     * before the board moved in above it.
     */
    var tapSlots = 1.55;
    var pChrome = afford(CHROME, plateSpace, gap * (pN + tapN - 1), pN + tapN * 1.55);
    function plateFor(slots) {
      return Math.min(PLATE_H * k * 0.88,
                      (plateSpace - pChrome - gap * (pN + tapN - 1)) / (pN + tapN * slots));
    }
    L.plateH = plateFor(tapSlots);
    /*
     * ...but the taller fountain is a luxury, not a right. On a short screen
     * at four plates it eats enough of the column that the plates fall under
     * MIN_TAPPABLE and the room asks the player to turn the phone - which is a
     * worse trade than a smaller machine. Hand the room back and shrink it.
     */
    if (tapN && L.plateH < MIN_TAPPABLE) {
      tapSlots = 1.10;
      L.plateH = plateFor(tapSlots);
    }
    L.fryH = fryN ? Math.min(FRYER_H * k, L.slotH * 1.35) : 0;
    var gTotal = gN * L.slotH + (gN - 1) * gap + (fryN ? gap + L.fryH : 0);
    var pTotal = pN * L.plateH + (pN - 1) * gap + (tapN ? gap + L.tapH : 0);
    /*
     * The wall keeps its order - freezer, fryer, burners - and the leftover
     * height is SHARED between the two gaps rather than dumped into one.
     *
     * Hard bottom-alignment looked right on a full day 20 wall and wrong
     * everywhere else: on day 1 the grill is the only thing on that wall, and
     * pinning it to the floor left 418px of blank plaster above it. On day 5
     * it put 217px between the fryer and the burners. Splitting the slack in
     * two centres a sparse wall and still walks the burners down to the floor
     * as the wall fills up, which is where they belong when it matters.
     */
    /*
     * Both stacks are drawn inside a BENCH, and the bench is bigger than the
     * slots it holds: drawGrill and drawPlates start their counter 16px above
     * the first slot and end it 6px below the last. That chrome was not in
     * the budget, so the grill bench cut 10-12px into the fryer above it and
     * the plate bench 3-5px into the board. Reserve it here and the gaps are
     * real gaps.
     */
    var burners = gN * L.slotH + (gN - 1) * gap;
    var used = (fryN ? L.freezerH + gap + L.fryH : 0) + burners + gChrome;
    var each = Math.max(0, midH - used) / 2;
    L.freezerTop = L.midTop + 2;
    L.fryTop = L.midTop + coldBand;
    // the reserved chrome is split the way the bench draws it, 16 above to 6
    // below - offsetting by the full 16 while only reserving 4 ran the stack
    // out of the band by the difference
    /*
     * The bench is drawn with the padding that was actually reserved, not a
     * hard 16/6. On a wall that could only afford four of those pixels the
     * fixed bench cut 9px into the fryer above it; sized to its budget it
     * cannot overlap anything by construction.
     */
    L.gPadTop = gChrome * (BENCH_TOP / CHROME);
    L.gPadBot = gChrome - L.gPadTop;
    L.grillTop = L.midTop + (fryN ? coldBand + L.fryH : 0) + each + L.gPadTop;

    /*
     * The plate wall, the same shape. The board hangs off the crate shelf
     * rather than the top of the band, so its underside - not midTop - is
     * what the stack is measured from.
     */
    var stack = pN * L.plateH + (pN - 1) * gap;
    var pEach = Math.max(0, plateSpace - stack - pChrome) / 2;
    L.pPadTop = pChrome * (BENCH_TOP / CHROME);
    L.pPadBot = pChrome - L.pPadTop;
    L.plateTop = boardFoot + pEach + L.pPadTop;

    // --- the walkable floor: whatever is left between the two walls. The board
    // is the widest thing on the plate side, so it sets that edge.
    var plateBandW = Math.max(L.plateW, L.boardW || 0);
    L.floor = {
      x0: grillLeft ? (leftX + L.colW + 16) : (leftX + plateBandW + 16),
      x1: grillLeft ? (W - L.pad - plateBandW - 16) : (rightX - 16),
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
    /*
     * The prep table: an island, tucked up under the crate shelf rather than
     * dropped in the middle of the room. The cook crosses this floor all shift
     * between the burners and the plates, and a table sitting in that lane
     * read as something spilled rather than as furniture.
     *
     * `h` is the whole piece of furniture - the counter slab and the board
     * standing on it. drawPrepBoard splits it.
     */
    var fw = L.floor.x1 - L.floor.x0, fh2 = L.floor.y1 - L.floor.y0;
    // top of the plate band, against the wall - the plates start below it
    L.board = S.board ? {
      x: L.boardX, y: L.cratesBottom + 8, w: L.boardW, h: L.boardH
    } : null;

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

  /*
   * How much of a bench's chrome a wall can pay for.
   *
   * Charging all 22px unconditionally pushed a 360x300 kitchen's burners to
   * 20.9px, under MIN_TAPPABLE, and the room started asking the player to turn
   * the phone. Charging none of it let the bench cut 12px into the fryer above
   * it. Charge what is left over once every station is still worth tapping,
   * and the overlap is only ever what the wall genuinely could not afford.
   */
  function afford(want, space, gapsTotal, slots) {
    var spare = space - gapsTotal - MIN_TAPPABLE * slots;
    return clamp(Math.min(want, spare), 0, want);
  }

  function crateRect(i) {
    return L.crates[i] || { x: 0, y: 0, w: 0, h: 0 };
  }

  function slotRect(i) {
    return { x: L.grillX, y: L.grillTop + i * (L.slotH + L.gap), w: L.colW, h: L.slotH };
  }

  function plateRect(i) {
    return { x: L.plateX, y: L.plateTop + i * (L.plateH + L.gap), w: L.plateW || L.colW, h: L.plateH };
  }

  function boardRect() { return L.board || { x: 0, y: 0, w: 0, h: 0 }; }

  function fryerRect() { return { x: L.grillX, y: L.fryTop, w: L.colW, h: L.fryH }; }

  /** The freezer, pinned to the top of the grill wall. Scenery, not a target. */
  function freezerRect() { return { x: L.grillX, y: L.freezerTop, w: L.colW, h: L.freezerH }; }

  /** One well of the two, side by side inside the fry box. */
  function fryWellRect(i) {
    var r = fryerRect(), pad = r.w * 0.10, gap = r.w * 0.06;
    var ww = (r.w - pad * 2 - gap) / 2;
    var below = r.y;
    var bh = r.h;
    return { x: r.x + pad + i * (ww + gap), y: below + bh * 0.30, w: ww, h: bh * 0.44 };
  }

  /** Which well a tap landed in - the left half or the right. */
  function fryWellAt(x) {
    var r = fryerRect();
    return x < r.x + r.w / 2 ? 0 : 1;
  }

  /*
   * Which of the fountain's three spouts is under this point.
   *
   * The machine draws its columns at col0 = 0.217 with a step of 0.283, so the
   * boundaries between them are the midpoints of those - kept here rather than
   * guessed, because a lever that pours the flavour beside the one you pressed
   * is worse than no choice at all.
   */
  function tapColAt(x) {
    var r = tapRect();
    var f = r.w ? (x - r.x) / r.w : 0;
    return f < 0.217 + 0.283 * 0.5 ? 0 : (f < 0.217 + 0.283 * 1.5 ? 1 : 2);
  }

  /** Is there anything on this tray at all? */
  function trayBusy(p) { return !!(p.stack.length || p.side || p.drink); }

  /*
   * The flavour the fountain pours next: what the oldest ticket still waiting
   * on a drink asked for, skipping any that a tray already covers. Without the
   * skip, two cups for the same ticket is the easiest mistake in the kitchen
   * and the least interesting one.
   */
  function nextDrinkWanted() {
    var poured = {};
    S.plates.forEach(function (p) { if (p.drink) poured[p.drink] = (poured[p.drink] || 0) + 1; });
    S.chefs.forEach(function (c) {
      var h = c.holding;
      if (!h) return;
      if (h.kind === 'cup') poured[h.flavor] = (poured[h.flavor] || 0) + 1;
      if (h.kind === 'plate' && h.drink) poured[h.drink] = (poured[h.drink] || 0) + 1;
    });
    for (var i = 0; i < S.tickets.length; i++) {
      var d = S.tickets[i].drink;
      if (!d) continue;
      if (poured[d]) { poured[d]--; continue; }
      return d;
    }
    return null;
  }
  function tapRect() { return { x: L.tapX, y: L.tapY, w: L.tapW, h: L.tapH }; }

  /*
   * One lever assembly - the flavour badge and the paddle under it - as a box.
   * The fractions are the dispenser's own vertical plan: badge 0.168..0.268,
   * paddle 0.336..0.404, columns at col0 0.217 with a 0.283 step. Kept in step
   * with the drawing so the ring lands on the thing that was pressed.
   */
  function tapColRect(i) {
    var r = tapRect();
    var step = r.w * 0.283;
    var cx = r.x + r.w * (0.217 + 0.283 * clamp(i || 0, 0, 2));
    return { x: cx - step / 2, y: r.y + r.h * 0.150, w: step, h: r.h * 0.270 };
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
    if (t.kind === 'grill' || t.kind === 'plate' || t.kind === 'fryer' ||
        t.kind === 'freezer' || t.kind === 'board') {
      r = t.kind === 'grill' ? slotRect(t.i)
        : t.kind === 'plate' ? plateRect(t.i)
        : t.kind === 'fryer' ? fryerRect()
        : t.kind === 'freezer' ? freezerRect() : boardRect();
      return { x: nearEdge(r, f, 'x'), y: clamp(r.y + r.h / 2, f.y0, f.y1) };
    }
    if (t.kind === 'hatch' || t.kind === 'bin' || t.kind === 'tap') {
      r = t.kind === 'hatch' ? hatchRect() : (t.kind === 'bin' ? binRect() : tapRect());
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
    if (L.board && inside(boardRect())) return { kind: 'board' };
    if (L.freezerH && inside(freezerRect())) return { kind: 'freezer' };
    if (L.fryH && inside(fryerRect())) return { kind: 'fryer', i: fryWellAt(x, y) };
    if (L.tapH && inside(tapRect())) return { kind: 'tap', i: tapColAt(x) };
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

  function spawnTicket() {
    var arch = Core.pickCustomer(S.day, Math.random);
    var order = Core.makeOrder(S.day, Math.random, arch, S.runSeed);
    var secs = S.cfg.patience * arch.patience;
    S.tickets.push({
      uid: ++uid, arch: arch, items: order.items,
      side: order.side, drink: order.drink,
      patience: secs, max: secs, tick: 0
    });
    S.spawned++;
    Sfx.doorbell();
    renderBoard();
  }

  function dropTicket(t) {
    var i = S.tickets.indexOf(t);
    if (i >= 0) S.tickets.splice(i, 1);
    // Held in the drawing, fading, for as long as the CSS animation used to run
    holdLeaving(t);
    setTimeout(function () { releaseLeaving(t); renderBoard(); }, 320);
    renderBoard();
  }

  /*
   * What the day has actually made: everything taken, less the food thrown
   * away. This is the only number the shift is judged by now, and the one the
   * HUD counts up - so a plate that goes back is visible in the same place the
   * player is already watching.
   */
  function till() { return S.sales + S.tips - (S.waste || 0); }

  function walkout(t) {
    S.walked++;
    chefMood('sad', 1.4, S.me || 0);
    dropTicket(t);
    banner('WALKED OUT', t.arch.name + ' gave up waiting', C.alarm);
    S.shake = 14;
    Sfx.walkout();
    buzz([30, 40, 60]);
    syncHud();
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
   * add a second patty - which is one more row, because orderRows() only counts
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

    /*
     * Write down the day you are about to PLAY.
     *
     * The only save was at the end of a shift, and it stored the day that had
     * just been completed - so quitting during day 8 came back offering day 7,
     * the one you had already cleared. Saving here means CONTINUE always
     * resumes the shift you walked out of, whether you quit from the pause
     * sheet, closed the tab, or the phone killed the app mid-service.
     *
     * It costs one write per day, which is what the end of a shift already
     * cost - the shift itself is not saved, only which one it is.
     */
    S.day = day;
    S.saved = true;
    save();
    if (el.continueDay) el.continueDay.textContent = day;

    /*
     * A new shift opens on the first bar.
     *
     * The track deliberately survives a pause, a mute and the tab going to the
     * background - all of those are the same shift interrupted, and restarting
     * the music each time reads as a glitch. RESTART THE DAY and closing up for
     * the night are not that, and both come through here.
     */
    Bgm.rewind();
    // ...and a shift has music. Every way into a day used to have to remember
    // this for itself, and RESTART THE DAY is the one that did it in the wrong
    // order - it started the track and then rewound it, which stopped it.
    if (!S.musicOff) Bgm.start();

    S.day = day;
    S.cfg = Core.dayConfig(day);
    S.rent = Core.dayGoal(day);
    S.fx = Core.effects(activeLevels(), day);
    S.menu = Core.dayMenu(day, S.runSeed);
    S.sections = Core.menuSections(day, S.runSeed);
    reserveBoard(day);

    S.waste = 0;
    S.sales = 0; S.tips = 0; S.served = 0; S.walked = 0; S.perfect = 0;
    S.spawned = 0; S.spawnTimer = 1.2;
    S.dayLength = Core.dayLength(day);
    S.timeLeft = S.dayLength;
    S.closedBy = null;
    S.tickets = [];
    S.plates = [];
    for (var i = 0; i < S.fx.plates; i++) S.plates.push({ stack: [], side: null, drink: null });
    S.grill = new Array(S.fx.grillSlots).fill(null);
    // The fry station opens on day 5 and the fountain on day 3; before that the
    // machines are not in the room at all, so the columns keep their old height.
    S.fryer = day >= Core.SIDE_DAY ? [null, null] : [];
    /*
     * The prep table is only in the room on a day that stocks something to
     * put on it. Day 1 has bun and patty and nothing else, so a board there is
     * a station you cannot use standing in the middle of the walking lane -
     * the same reason the fryer and the fountain wait for their own days.
     */
    S.board = (S.menu || []).some(function (id) {
      var g = Core.byId(id);
      return g && g.chop;
    }) ? { id: null, cut: 0, portions: 0, wet: 0, juice: null } : null;
    S.drinkTaps = Core.drinkMenu(day);
    // Whatever the last shift decided about the room, this one measures it
    // again - resize() below re-derives it from the real canvas.
    S.cramped = false;

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

    // syncHud owns the no-clock class, which decides how much height the
    // kitchen gets - so it runs first and resize() measures the real budget.
    syncHud();
    resize();
    renderBoard();
    banner('DAY ' + day, 'RENT ' + Core.money(S.rent), C.warm);
  }

  function endDay() {
    if (S.screen !== 'service') return;
    S.screen = 'dayEnd';
    S.chef.target = null;
    S.userPaused = false;
    hideModal(el.pause);
    var total = till();
    /*
     * One test, at closing: did the day cover its rent.
     *
     * There were two before - five mistakes shut the shop on the spot, and the
     * rent was checked at the end. The hearts are gone; a plate that goes back
     * costs the food that was on it, so a bad shift shows up as a shortfall in
     * the same number the day is judged by rather than as a separate life bar.
     */
    var ranOut = false;
    var passed = total >= S.rent;

    if (passed) {
      S.money += total - S.rent;
      S.lifetime = (S.lifetime || 0) + total;
      S.bestDay = Math.max(S.bestDay, S.day);
      /*
       * The shift you cleared is behind you, so what gets written down is the
       * NEXT one. Between here and the shop screen the player may close the
       * app, and coming back to replay a day they had already banked is the
       * bug this pairs with startDay's own save.
       */
      S.day += 1;
      save();
      S.day -= 1;
      if (el.continueDay) el.continueDay.textContent = S.day + 1;
      S.saved = true;
      Sfx.fanfare();
    } else {
      Sfx.fail();
    }
    showDayEnd(passed, ranOut, total);
  }

  /* ------------------------------------------------------------- pause menu */
  /*
   * The pause slip, drawn. The BACK SOON stamp used to be a canvas sitting
   * under a DOM <h2> that said PAUSED - the same word twice, once in ink and
   * once in a webfont. Art.ui.pause draws the stamp, the three written lines
   * and all three buttons; the switches along the foot are the handoff's, and
   * MUSIC is now a real setting rather than something the sound toggle
   * silently took with it.
   */
  var PAUSE_TOGGLES = [
    { id: 'sound', k: 'SOUND', btn: 'pauseSoundBtn' },
    { id: 'music', k: 'MUSIC', btn: 'pauseMusicBtn' },
    { id: 'board', k: 'HOW TO', btn: 'howBtn' }
  ];

  function paintPause() {
    if (el.pauseRead) {
      el.pauseRead.textContent = 'Paused. Day ' + S.day + ', ' +
        Core.money(till()) + ' of ' + Core.money(S.rent) + ' taken, ' +
        Core.clockText(Math.max(0, Math.ceil(S.timeLeft))) + ' left.';
    }
    if (!el.pauseArt) return;
    var W = el.pause.clientWidth, H = el.pause.clientHeight;
    if (!W || !H) return;

    paintOn(el.pauseArt, W, H, function (g) {
      Art.ui.pause(g, 0, 0, W, H, {
        stamp: 'BACK SOON',
        sub: 'THE LINE IS HOLDING · NOTHING IS BURNING',
        rows: [
          { k: 'Day ' + S.day + ' · served', v: String(S.served) },
          { k: 'Till so far', v: Core.money(till()), col: '#3f7a2a' },
          { k: 'Time left', v: Core.clockText(Math.max(0, Math.ceil(S.timeLeft))) }
        ],
        primary: 'BACK TO WORK',
        secondary: 'RESTART THE DAY',
        tertiary: 'CLOSE UP SHOP',
        toggles: [
          { id: 'sound', k: 'SOUND', on: !S.muted },
          { id: 'music', k: 'MUSIC', on: !S.musicOff && !S.muted },
          { id: 'board', k: 'HOW TO', on: true }
        ],
        glyph: function (gg, id, gx, gy, gw, gh) { Art.glyph(gg, id, gw, gh); }
      });
    });

    var B = Art.ui.pauseBoxes(0, 0, W, H, PAUSE_TOGGLES.length);
    overlay(el.resumeBtn, grow(B.primary, MIN_TOUCH));
    overlay(el.restartBtn, grow(B.secondary, MIN_TOUCH));
    overlay(el.quitBtn, grow(B.tertiary, MIN_TOUCH));
    PAUSE_TOGGLES.forEach(function (t, i) { overlay(el[t.btn], grow(B.toggles[i], MIN_TOUCH)); });
  }

  function setPaused(on) {
    if (S.screen !== 'service' && on) return;
    S.userPaused = !!on;
    if (S.userPaused) {
      S.chef.target = null;          // don't let a queued walk resolve later
      Bgm.stop();
      showModal(el.pause);
      paintPause();
      Sfx.tap();
    } else {
      hideModal(el.pause);
      if (!S.musicOff) Bgm.start();
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
    S.saved = !!saved;
    if (saved) el.continueDay.textContent = saved.day;
    showModal(el.start);
    paintTitle();
  }

  /* -------------------------------------------------------- the chef works */
  function sendChef(target, ci) {
    if (S.screen !== 'service') return;
    var c = chefAt(ci || 0);
    // walking away from wherever he was
    c.at = null;
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
    // whatever the tap turns out to do, this is where he now IS
    me.at = t.kind;

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
        var ping = Core.byId(hold.id);
        if (ping && ping.grill && hold.cook === undefined) {
          nope('GRILL IT FIRST', ci);
          return;
        }
        // A whole tomato is not a burger topping until it has been through
        // the board - the same gate the grill has always had for the patty.
        if (ping && ping.chop && !hold.prepped) {
          nope('CHOP IT FIRST', ci);
          return;
        }
        p.stack.push({
          id: hold.id,
          cook: hold.cook === undefined ? 1 : hold.cook,
          done: hold.done, char: hold.char,     // how it should look, not what it scores
          // carried so evaluate() has something to check. It was dropped here,
          // which left the chop gate with no second line of defence.
          prepped: ping && ping.chop ? !!hold.prepped : undefined
        });
        me.holding = null;
        var pr = plateRect(t.i);
        dropOnto('plate', t.i, hold.id, pr.x + pr.w / 2, pr.y + pr.h * 0.58, pr.w * 0.58, ci, hold);
        var ing = Core.byId(hold.id);
        if (ing && ing.kind === 'sauce') Sfx.squirt(); else Sfx.stack(p.stack.length);
        buzz(8);
        return;
      }
      /*
       * A carton of fries and a cup go on the tray, not into the burger. They
       * are deliberately NOT pushed into p.stack: that array is the multiset
       * evaluate() scores against, and a drink in it would read as a filling
       * the customer never got.
       */
      if (hold && hold.kind === 'fries') {
        if (p.side) { nope('FRIES ALREADY ON IT', ci); return; }
        p.side = 'fries';
        p.sideCook = hold.cook;
        me.holding = null;
        Sfx.stack(p.stack.length + 1);
        buzz(8);
        return;
      }
      if (hold && hold.kind === 'cup') {
        if (p.drink) { nope('A DRINK IS ON IT', ci); return; }
        p.drink = hold.flavor;
        me.holding = null;
        Sfx.tap();
        buzz(8);
        return;
      }
      if (hold && hold.kind === 'plate') {
        /*
         * Two trays MERGE when they do not want the same slot.
         *
         * This used to refuse any occupied plate outright, which meant parking
         * the cider on a plate and then bringing the burger over - the obvious
         * way to build a set - came back "PLATE IN USE". A tray is three
         * slots, not one thing: only a slot that is already taken is a clash.
         */
        var clash = (hold.stack.length && p.stack.length) ? 'BOTH HAVE FOOD ON THEM'
                  : (hold.side && p.side) ? 'BOTH HAVE FRIES'
                  : (hold.drink && p.drink) ? 'BOTH HAVE A DRINK' : null;
        if (clash) { nope(clash, ci); return; }
        if (hold.stack.length) p.stack = hold.stack;
        if (hold.side) { p.side = hold.side; p.sideCook = hold.sideCook; }
        if (hold.drink) p.drink = hold.drink;
        me.holding = null;
        Sfx.tap();
        return;
      }
      if (!hold && trayBusy(p)) {
        me.holding = { kind: 'plate', stack: p.stack, side: p.side, sideCook: p.sideCook, drink: p.drink };
        p.stack = []; p.side = null; p.sideCook = undefined; p.drink = null;
        Sfx.lift();
        buzz(10);
        return;
      }
      nope('NOTHING ON THAT PLATE', ci);
      return;
    }

    /*
     * The board. Load a whole vegetable, let the knife work, then draw
     * portions off it until it is bare.
     *
     * Empty hands TAKE and full hands GIVE, the same as everywhere else - the
     * only new rule is that a vegetable has to come through here before a
     * plate will accept it.
     */
    if (t.kind === 'board') {
      var bd = S.board;
      if (!bd) { nope('NO BOARD IN HERE', ci); return; }
      var br = boardRect();

      if (hold) {
        var bing = hold.kind === 'ing' && Core.byId(hold.id);
        if (!bing || !bing.chop) { nope('THAT DOESN\'T GET CHOPPED', ci); return; }
        if (hold.prepped) { nope('ALREADY CHOPPED', ci); return; }
        if (bd.id) {
          // mid-chop is mid-chop; letting the knife be interrupted would make
          // a slow cut free to reroll
          if (!bd.portions) { nope('ONE AT A TIME', ci); return; }
          /*
           * A finished portion is never thrown away to make room.
           *
           * Loading a different vegetable over a ready board used to sweep it -
           * which made sense when a board held four portions and emptying it
           * by hand cost three trips to the bin. It holds ONE now, so sweeping
           * destroys the whole chop, and it did it silently under a player who
           * had just watched the knife finish. Take it first; it is one tap.
           */
          nope('TAKE THAT ONE FIRST', ci);
          return;
        }
        bd.id = hold.id;
        bd.cut = 0;
        bd.portions = 0;
        bd.juice = bing.swatch;
        me.holding = null;
        dropOnto('board', 0, hold.id, br.x + br.w / 2, br.y + br.h * 0.60, br.w * 0.24, ci, hold);
        // hands alternate for as long as the knife is working
        chefMood('cook', CHOP_TIME, ci);
        Sfx.stack(1);
        buzz(10);
        return;
      }

      if (!bd.id) { nope('PUT A VEGETABLE ON IT', ci); return; }
      if (!bd.portions) { nope('STILL CHOPPING', ci); return; }
      me.holding = { kind: 'ing', id: bd.id, done: 0, char: 0, prepped: true };
      bd.portions--;
      if (!bd.portions) {
        // wiped down, and the grain keeps the colour of what was on it
        bd.wet = Math.min(1, (bd.wet || 0) + 0.34);
        bd.id = null;
        bd.cut = 0;
      }
      /*
       * Say what is left. The board announced "4 READY" once and then never
       * mentioned the count again, and the heap on it drew the same at four
       * portions as at one - so a finite supply read as a bottomless one.
       */
      float(bd.portions ? bd.portions + ' LEFT' : 'BOARD CLEAR',
            br.x + br.w / 2, br.y, C.warm, 11);
      Sfx.lift();
      buzz(8);
      return;
    }

    /*
     * The fry station. It is the grill's mechanic with the supply built in:
     * the sack and the cutter beside it are where the cut potatoes come from,
     * so an empty-handed tap on an idle well drops a basket and starts the
     * clock. Come back at the right moment and you are holding a carton; come
     * back late and you are holding a carton of charcoal.
     */
    /*
     * The freezer. Empty hands come out holding a bag of frozen fries, which
     * is the only thing the fryer will take.
     *
     * The fry line used to start with a tap on an empty well and a basket that
     * came from nowhere - the freezer beside it was scenery that animated. The
     * potatoes come from somewhere now, the same way a patty comes out of a
     * crate before it reaches the grill.
     */
    if (t.kind === 'freezer') {
      if (hold) { nope('HANDS FULL', ci); return; }
      me.holding = { kind: 'fryBag' };
      S.fryGrab = nowMs();          // the lid slides and a bag comes up
      var fzr = freezerRect();
      float('FROZEN FRIES', fzr.x + fzr.w / 2, fzr.y + fzr.h * 0.30, '#2f6b8f', 10);
      Sfx.lift();
      buzz(8);
      return;
    }

    if (t.kind === 'fryer') {
      var w = clamp(t.i || 0, 0, Math.max(0, S.fryer.length - 1));
      var well = S.fryer[w];
      if (hold && hold.kind !== 'fryBag') {
        nope(hold.kind === 'fries' ? 'ALREADY GOT FRIES' : 'HANDS FULL', ci);
        return;
      }
      if (hold) {
        if (well) { nope('THAT WELL IS BUSY', ci); return; }
        S.fryer[w] = { t: 0 };
        me.holding = null;
        var fr0 = fryWellRect(w);
        Sfx.sizzle();
        buzz(12);
        float('IN THE OIL', fr0.x + fr0.w / 2, fr0.y, C.warm, 10);
        return;
      }
      if (!well) { nope('BRING A BAG FROM THE FREEZER', ci); return; }
      var fq = Core.cookQuality(well.t, S.fx.perfectWindow);
      var fstage = Core.cookStage(well.t, S.fx.perfectWindow);
      var flook = Core.cookLook(well.t, S.fx.perfectWindow);
      me.holding = { kind: 'fries', cook: fq, done: flook.done, char: flook.char };
      S.fryer[w] = null;
      var fr = fryWellRect(w);
      if (fstage === 'perfect') {
        float('GOLDEN', fr.x + fr.w / 2 + 26, fr.y, K.go, 12);
        spark(fr.x + fr.w / 2, fr.y + fr.h / 2, 10, 'rgba(240,180,41,0.95)');
        Sfx.perfect();
        buzz(20);
      } else if (fstage === 'burnt') {
        float('BURNT', fr.x + fr.w / 2 + 22, fr.y, C.alarm, 12);
        Sfx.burnt();
      } else {
        float(fstage === 'raw' ? 'STILL PALE' : 'GOING DARK', fr.x + fr.w / 2 + 26, fr.y,
          fstage === 'raw' ? '#3d7fbf' : C.warmDeep, 11);
        Sfx.thud();
      }
      return;
    }

    /*
     * The fountain. One tap, one cup - and it pours the flavour the oldest
     * ticket still waiting on a drink asked for. The decision the player is
     * making here is WHEN, not which: six spouts to aim at on a phone would be
     * a memory test wearing a kitchen's clothes, and the fry timer is already
     * carrying the skill on this side of the room.
     */
    /*
     * The fountain. Pick a spout, hold the cup under it, take it when it is
     * full.
     *
     * It used to hand over a finished cup of whatever the board wanted, in one
     * tap, with no choice and no cost - which made three flavours a decoration
     * and left the machine's own levers doing nothing. Now the lever you press
     * is the flavour you get, and filling a cup takes POUR_TIME of the cook's
     * time the way chopping does.
     */
    if (t.kind === 'tap') {
      if (hold) { nope('HANDS FULL', ci); return; }
      var vw = dispenserView();

      // a full cup comes off the spout that poured it
      if (S.pour && S.pour.t >= POUR_TIME) {
        me.holding = { kind: 'cup', flavor: S.pour.flavor };
        S.pour = null;
        Sfx.lift();
        buzz(8);
        return;
      }
      if (S.pour) { nope('STILL POURING', ci); return; }

      var col = clamp(t.i === undefined ? vw.active : t.i, 0, 2);
      var pick = vw.ids[col];
      if (!pick) { nope('NOTHING PLUMBED THERE', ci); return; }
      // the window is frozen with the cup, so the lever under the finger stays
      // the lever under the finger
      S.pour = { flavor: pick, t: 0, ids: vw.ids.slice(), col: col };
      var tr = tapRect();
      var dr = Core.drinkById(pick);
      float((dr ? dr.short : 'DRINK'), tr.x + tr.w / 2, tr.y, C.warm, 10);
      Sfx.tap();
      buzz(8);
      return;
    }

    if (t.kind === 'hatch') {
      if (!hold || hold.kind !== 'plate') { nope('CARRY A PLATE OVER', ci); return; }
      deliver(hold.stack, { side: hold.side || null, drink: hold.drink || null, sideCook: hold.sideCook }, ci);
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
  function deliver(stack, tray, ci) {
    if (!S.tickets.length) { nope('NO ORDERS UP'); return; }
    tray = tray || {};
    var t = Core.bestMatch(S.tickets, stack);

    var res = Core.payout({
      orderItems: t.items,
      built: stack,
      patienceRatio: t.patience / t.max,
      customer: t.arch,
      tipMult: S.fx.tipMult
    });

    /*
     * The other half of the tray, priced and judged on its own.
     *
     * evaluate() owns the burger and has never heard of fries; this owns the
     * fries and never touches the stack. What it can do is spoil a verdict:
     * a flawless burger with the drink missing is not a perfect order, and
     * saying so is the only way the board's third row means anything.
     */
    var ex = Core.checkExtras({ side: t.side, drink: t.drink }, tray);
    if (ex.asked) {
      var sideIng = Core.SIDES.fries;
      if (tray.side === t.side && t.side) {
        // Burnt fries are still fries, but nobody pays full price for them.
        var q = tray.sideCook === undefined ? 1 : tray.sideCook;
        res.pay += Math.round(sideIng.price * clamp(0.45 + q * 0.55, 0.45, 1));
      }
      if (tray.drink && tray.drink === t.drink) {
        var dr = Core.drinkById(t.drink);
        if (dr) res.pay += dr.price;
      }
    }
    if (ex.faults.length) {
      res.faults = (res.faults || []).concat(ex.faults);
      /*
       * One miss drops it a grade; both drop it two - but never past 'meh',
       * because 'bad' is the verdict that bins the plate and charges the
       * shop for it, and a correct burger with a forgotten drink is not that.
       *
       * The ladder is VERDICT's own, and it stops one short of the end. Naming
       * a grade that is not in that table put `undefined.text` on the screen.
       */
      var LADDER = ['perfect', 'great', 'good', 'meh'];
      var at = LADDER.indexOf(res.verdict);
      if (at >= 0) res.verdict = LADDER[Math.min(LADDER.length - 1, at + ex.faults.length)];
      res.tip = Math.round(res.tip * Math.max(0, 1 - ex.faults.length * 0.5));
    }

    /*
     * If nobody on the board actually ordered this, it goes back.
     *
     * bestMatch picks the CLOSEST ticket and payout grades against it, so a
     * burger with a filling nobody asked for used to be quietly sold to
     * whoever wanted the most of it - at a discount, but sold. The board is
     * the specification: a plate either matches something on it or it is
     * wrong, and being nearly right is not a thing you can serve.
     *
     * The tray is deliberately not part of this. A forgotten drink already
     * costs a grade, and the comment on that ladder is explicit that it must
     * not bin the burger - this is about what went in it.
     */
    var ordered = S.tickets.some(function (tk) {
      return Core.evaluate(tk.items, stack).exact;
    });
    if (!ordered) {
      res.verdict = 'bad';
      res.pay = 0;
      res.tip = 0;
      res.total = 0;
      res.waste = Math.max(res.waste || 0, Core.wasteOf(stack));
      res.faults = [{ code: 'unordered', label: 'NOBODY ORDERED THAT' }];
    }

    S.sales += res.pay;
    S.tips += res.tip;
    S.waste += res.waste || 0;
    if (res.verdict === 'perfect') { S.perfect++; chefMood('cheer', 1.2, ci || 0); }
    else if (res.verdict === 'bad') chefMood('sad', 1.4, ci || 0);
    if (res.verdict !== 'bad') S.served++;

    var v = VERDICT[res.verdict];
    // On anything short of great, name the worst thing wrong with it - a
    // rejected plate with no explanation just reads as the game being unfair.
    var worst = res.faults && res.faults.length ? res.faults[0] : null;
    /*
     * The archetype's name, not its emoji.
     *
     * This line is painted onto the stage with fillText, so `t.arch.emoji` put
     * the platform's colour emoji font in the middle of an inked kitchen -
     * several times a minute, and the one place the game's own hand dropped
     * out mid-shift. The name says the same thing and is set in the game's
     * own face.
     */
    var who = t.arch.name.toUpperCase();
    var sub;
    if (res.total > 0) {
      sub = (worst && res.verdict !== 'perfect' && res.verdict !== 'great')
        ? who + '  ·  ' + worst.label + '  ·  ' + Core.money(res.total)
        : who + '  ·  ' + Core.money(res.pay) + ' + ' + Core.money(res.tip) + ' tip';
    } else {
      sub = who + '  ·  ' + (worst ? worst.label : 'no sale');
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

    /*
     * The board does not chop itself.
     *
     * It used to advance on the clock alone, so a cook could load a vegetable,
     * walk to the grill, and come back to a finished board - the knife swinging
     * away at an empty station the whole time. The work happens while somebody
     * is standing there, which is also what makes the progress bar mean
     * something: it stops when he does.
     */
    if (S.board && S.board.id && !S.board.portions) {
      var chopper = cookAtBoard();
      S.board.working = chopper >= 0;
      if (S.board.working) {
        chefMoodHold('cook', 0.35, chopper);
        S.board.cut = Math.min(1, S.board.cut + dt / CHOP_TIME);
      }
      if (S.board.cut >= 1) {
        S.board.portions = PREP_PORTIONS;
        var brr = boardRect();
        float(PREP_PORTIONS > 1 ? PREP_PORTIONS + ' READY' : 'READY',
              brr.x + brr.w / 2, brr.y, K.go, 11);
        Sfx.stack(2);
      }
    }

    /*
     * A cup does not fill itself either. Same gate as the board: the work
     * happens while somebody is standing at the machine, which is what makes
     * the bar under it mean something.
     */
    if (S.pour && S.pour.t < POUR_TIME) {
      var pourer = cookAtTap();
      S.pour.working = pourer >= 0;
      if (S.pour.working) {
        chefMoodHold('cook', 0.35, pourer);
        S.pour.t = Math.min(POUR_TIME, S.pour.t + dt);
        if (S.pour.t >= POUR_TIME) {
          var trr = tapRect();
          float('READY', trr.x + trr.w / 2, trr.y, K.go, 11);
          Sfx.stack(2);
        }
      }
    }

    for (i = 0; i < S.fryer.length; i++) if (S.fryer[i]) S.fryer[i].t += dt;

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
  /*
   * The line of crates.
   *
   * This used to draw the box, then the stock inside it, then the label,
   * then the swatch band, then the flame - all of it a second copy of what
   * Art.scene.crate already knew how to do, kept in sync by hand. The crate
   * takes what it needs and draws its own picture now.
   */
  function drawCrates() {
    for (var i = 0; i < S.menu.length; i++) {
      var r = crateRect(i);
      if (!r.w) continue;
      var id = S.menu[i];
      var ing = Core.byId(id) || {};
      Art.scene.crate(ctx, r.x, r.y, r.w, r.h, {
        id: id,
        name: ing.short || ing.name || id,
        tint: ing.swatch,
        hot: !!ing.grill,
        chop: !!ing.chop,
        live: targeted('crate', i),
        pop: S.cratePop[i] || 0
      });
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
      x: L.grillX - 3, y: L.grillTop - L.gPadTop,
      w: L.colW + 6, h: (last.y + last.h) - L.grillTop + L.gPadTop + L.gPadBot
    };
    // the chassis, in the same ink as the counters but in cast-iron colours
    Art.scene.counter(ctx, body.x, body.y, body.w, body.h, DEPTH.grill * (L.k || 1),
      { top: K.grillTop, top2: K.grillTop2, side: K.grillSide });

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

      cookBar(r, g.t);
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

  /*
   * The fry station: the sack and the cutter standing behind a two-well
   * fryer. Only the fryer is a tap target - the other two are the supply
   * line, and they are what makes an empty-handed tap on a cold well read as
   * "drop a basket" rather than "conjure potatoes". The cutter cranks while
   * a well is running, so the machine is visibly doing the work.
   */
  /*
   * The board, and whatever is happening on it. Art.scene.prep draws the slab,
   * the vegetable, the pile of slices and the knife in one call; `cut` is how
   * much of the vegetable is gone and `chop` is where the blade is in its
   * swing, so the knife only rocks while there is something to cut.
   */
  function drawPrepBoard() {
    if (!L.board || !S.board || !Art.scene.prep) return;
    var r = L.board, bd = S.board;

    /*
     * A board does not float. The table goes down first and the board stands
     * on its top surface, overlapping it by a few pixels so it reads as
     * resting rather than hovering - and the cook's knife swings into the
     * headroom above, which is why the prep rect is taller than the board.
     */
    var topY = r.y + r.h * 0.56;
    Art.scene.counter(ctx, r.x + r.w * 0.02, topY, r.w * 0.96, r.h * 0.44, r.h * 0.17, decor());

    var wood = { wood: 'maple', scars: 0.55, wet: bd.wet || 0, juice: bd.juice || '#c0392b' };
    var bx = r.x + r.w * 0.07, bw2 = r.w * 0.86;

    // The vegetable is still in the air. The grill and the plates both wait for
    // their flyer to land before drawing what it carries; this did not, so the
    // vegetable was on screen twice for the 0.2s flight.
    if (!bd.id || inbound('board', 0)) {
      // bare: just the slab, sitting on the table
      Art.scene.board(ctx, bx, r.y + r.h * 0.20, bw2, r.h * 0.44, wood);
      return;
    }

    /*
     * The blade is phase-locked to the work.
     *
     * It used to run off the wall clock at a fixed 1.55Hz, which meant 5.27
     * swings per vegetable - a non-integer count, so the board finished
     * mid-stroke at a different point every time and the cut face crept
     * smoothly while the knife bounced past it. Now one vegetable is exactly
     * CHOPS strikes, the face steps one slice on each landing, and the last
     * strike is always a completed one.
     */
    var ph = bd.cut * CHOPS;
    var fr = ph - Math.floor(ph);
    Art.scene.prep(ctx, bx, r.y - r.h * 0.02, bw2, r.h * 0.64, {
      board: wood,
      veg: bd.id,
      cut: bd.portions ? 1 : Math.floor(ph) / CHOPS,
      // done -> the edge rests on the board. `chop` is 1 AT the board, not 0:
      // the old 0.06 held the knife at the top of its arc, a frozen mid-swing.
      // Nobody there is also a rest, not a freeze halfway up the arc.
      chop: (bd.portions || !bd.working) ? 1 : chopCurve(ph),
      // how much of the PILE is left, which `cut` cannot say - it only knows
      // how far the blade got. Without this the heap looked the same at four
      // portions and at one, so the supply read as bottomless.
      left: bd.portions ? bd.portions / PREP_PORTIONS : bd.cut,
      // strictly after the landing, so juice never leaves an untouched
      // vegetable, and re-seeded per strike so no two sprays match
      hit: (bd.portions || !bd.working) ? 0 : (fr < 0.09 ? 1 - fr / 0.09 : 0),
      hitSeed: Math.floor(ph)
    });

    /*
     * How much chopping is left.
     *
     * The board is the one station whose work is invisible from across the
     * room - a patty browns, fries darken, a cup fills, but a vegetable half
     * cut looks much like a vegetable. Green while the cook is on it, amber
     * when he has walked off, so a stalled board reads as stalled rather than
     * as broken.
     */
    if (!bd.portions) {
      var pbx = r.x + 5, pbw = r.w - 10, pby = r.y + r.h - 9, pbh = 5;
      Art.rr(ctx, pbx, pby, pbw, pbh, 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();
      Art.rr(ctx, pbx, pby, Math.max(2, pbw * clamp(bd.cut, 0, 1)), pbh, 2.5);
      ctx.fillStyle = bd.working ? K.go : C.warm;
      ctx.fill();
    }
    if (bd.portions) pickRing(r, 12);
    /*
     * Walking there. The crates, the grill, the plates, the hatch and the bin
     * all light up while a cook is on his way; the board was the only station
     * that did not - and it is the one with the longest walk, standing in open
     * floor. Thin, inset and unlit, so it never reads as the ready-to-take
     * ring above it.
     */
    if (targeted('board')) {
      ctx.save();
      Art.rr(ctx, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
      ctx.strokeStyle = 'rgba(174,191,146,0.80)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * The blade's own cycle, as a 0..1 phase. Phase 0 is the edge in the wood.
   *
   * The old curve was a power-law sawtooth that fell with exponent 0.62 -
   * an ease-OUT - so the knife left the apex at 70 units/s and arrived at the
   * board at 3.4, decelerating into the cut. It also had no dwell at either
   * end (16ms out of a 645ms cycle) and a velocity discontinuity at the top.
   * A chop hangs, accelerates, and stops dead. This one does.
   */
  function chopCurve(p) {
    p = p - Math.floor(p);
    if (p < 0.09) return 1;                              // buried in the board
    if (p < 0.66) { var u = (p - 0.09) / 0.57; return (1 - u) * (1 - u); }
    if (p < 0.76) return 0;                              // hanging at the top
    var q = (p - 0.76) / 0.24;
    return q * q;                                        // down under gravity
  }

  /** Seconds-based wrapper, for anything not driven by a vegetable. */
  function chopSwing(t) { return chopCurve(t * 1.55); }

  /*
   * The freezer, in the top-left corner on its own. It used to be drawn into
   * the fry box's top third, where it was a decoration on another machine and
   * shrank with it; it is a fixture of the room now, with the fryer under it.
   */
  function drawFreezerUnit() {
    if (!L.freezerH) return;
    var r = freezerRect(), t = nowMs() / 1000;
    if (Art.scene.freezer) {
      var pose = freezerPose();
      Art.scene.freezer(ctx, r.x, r.y, r.w, r.h, { open: pose.open, grab: pose.grab, t: t });
    } else if (Art.scene.sack) {
      // art-freezer-dispenser.js is a separate file; if it never loaded, the
      // sack it replaced still stands rather than leaving a hole
      Art.scene.sack(ctx, r.x + r.w * 0.20, r.y, r.w * 0.60, r.h, { open: 1, count: 4 });
    }
  }

  /*
   * The doneness bar: a track, the green window marked on it, and a fill
   * coloured by where the clock actually is - blue while raw, green in the
   * window, amber past it, red once it is written off.
   *
   * The grill has worn this from the beginning. The fry wells were asking the
   * player to read the same four states off the colour of the fries alone,
   * which is a far finer distinction than a bar and one the basket half
   * covers. Same curve, same window, same bar - so a basket and a patty are
   * read the same way.
   */
  function cookBar(r, t, scale) {
    var win = S.fx.perfectWindow;
    var tMax = Core.COOK_TIME + win / 2 + Core.BURN_TIME;
    var stage = Core.cookStage(t, win);
    /*
     *  trims the bar without moving it. The burner is the roomiest slot
     * in the kitchen and its bar was reading as a component of the machine
     * rather than a readout on it; the fry wells are half the size and keep
     * the full-width bar, which is why this is a knob and not a new constant.
     */
    scale = scale === undefined ? 1 : scale;
    var pad = Math.min(5, r.w * 0.10);
    var bw = (r.w - pad * 2) * scale;
    var bx = r.x + (r.w - bw) / 2;
    var bh = Math.max(4, Math.min(7, r.h * 0.18) * scale);
    var by = r.y + r.h - bh - Math.min(5, r.h * 0.10);
    if (bw <= 2) return;

    Art.rr(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    var ps = (Core.COOK_TIME - win / 2) / tMax, pe = (Core.COOK_TIME + win / 2) / tMax;
    Art.rr(ctx, bx + bw * ps, by, bw * (pe - ps), bh, bh / 2);
    ctx.fillStyle = 'rgba(174,191,146,0.6)';
    ctx.fill();
    Art.rr(ctx, bx, by, Math.max(2, bw * clamp(t / tMax, 0, 1)), bh, bh / 2);
    ctx.fillStyle = stage === 'perfect' ? K.go
      : (stage === 'raw' ? '#7fb6e8' : (stage === 'over' ? C.warm : K.hot));
    ctx.fill();
  }

  function drawFryStation() {
    // art-fries-drinks.js is a separate file. If it ever fails to load, the
    // station simply is not drawn - the room should not die with it.
    if (!L.fryH || !Art.scene.fryer || !Art.item) return;
    var r = fryerRect();
    var busy = S.fryer.some(function (w) { return !!w; });
    var t = nowMs() / 1000;   // the oil bubbles and the crank turn on real time

    Art.scene.fryer(ctx, r.x, r.y, r.w, r.h, {
      // o.temp is the TEXT on the dial, not a 0..1 heat - passing a fraction
      // wrote "0.82°" across the machine's own name. The default reads 180°.
      hot: 1, t: t,
      slots: S.fryer.map(function (w) {
        if (!w) return { down: 0, fries: 0, cooked: 0 };
        var look = Core.cookLook(w.t, S.fx.perfectWindow);
        return { down: 1, fries: 1, cooked: clamp(look.done, 0, 1) };
      })
    });

    // the same yellow ring the crates use, so "this one is ready" reads the
    // same way everywhere in the room
    S.fryer.forEach(function (w, i) {
      if (!w) return;
      var wr = fryWellRect(i);
      cookBar(wr, w.t);
      if (Core.cookStage(w.t, S.fx.perfectWindow) === 'perfect') pickRing(wr, 10);
    });
  }

  /*
   * The fountain. Six taps drawn across its face, and a cup under whichever
   * one is next - so the machine answers "what would I get if I tapped this"
   * before the cook walks over, which is the whole decision it offers.
   */
  /*
   * The freezer's one moving beat, as an envelope over the moment a basket
   * went in. The lid snaps aside, the bag comes up and back down, the lid
   * slides home - and the pilot lamp goes yellow for as long as it is open,
   * which is the design's "door left open" tell.
   */
  function freezerPose() {
    var age = (nowMs() - (S.fryGrab || -1e9)) / 1000;
    if (age < 0 || age > 1.5) return { open: 0, grab: 0 };
    var open = age < 0.15 ? age / 0.15
             : (age > 1.15 ? Math.max(0, 1 - (age - 1.15) / 0.35) : 1);
    var grab = age < 0.25 ? 0
             : (age < 0.75 ? (age - 0.25) / 0.50 : Math.max(0, 1 - (age - 0.75) / 0.30));
    return { open: open, grab: grab };
  }

  /*
   * Which three spouts the machine shows.
   *
   * The dispenser is three columns wide and the shop plumbs anywhere from two
   * flavours to six, so this picks a window of three around whatever the
   * machine is busy with - the cup it is filling if there is one, otherwise the
   * drink the front of the board is waiting for. Either way the flavour in
   * question is on the machine rather than off the edge of it. Short of three,
   * the spare column comes back undefined and draws as an unplumbed spout.
   */
  function dispenserView() {
    var taps = S.drinkTaps || [];
    var want = nextDrinkWanted();
    if (!taps.length) return { ids: [], active: 0, want: null };
    /*
     * While a cup is filling the machine holds still.
     *
     * Re-centring the window on whatever is pouring meant pressing the
     * right-hand lever slid all three labels sideways under the player's
     * finger, and the ring marking the press landed on a different column
     * from the one that was pressed. The window is captured with the cup.
     */
    if (S.pour && S.pour.ids) {
      return { ids: S.pour.ids, active: S.pour.col || 0, want: want };
    }
    var focus = want;
    var idx = taps.indexOf(focus);
    var start = idx < 0 ? 0 : Math.max(0, Math.min(idx - 1, taps.length - 3));
    return {
      ids: [taps[start], taps[start + 1], taps[start + 2]],
      active: idx < 0 ? 0 : idx - start,
      want: want
    };
  }

  function drawFountain() {
    if (!L.tapH || !Art.scene.dispenser) return;
    var r = tapRect();
    var v = dispenserView();
    var pr = S.pour;
    var done = pr && pr.t >= POUR_TIME;
    var filling = pr ? clamp(pr.t / POUR_TIME, 0, 1) : 0;

    Art.scene.dispenser(ctx, r.x, r.y, r.w, r.h, {
      flavors: v.ids,
      active: v.active,
      // the stream only runs while somebody is holding the lever down
      pour: (pr && !done && pr.working) ? 1 : 0,
      // a cup appears the moment a spout is pressed and fills as it goes
      fill: pr ? 0.06 + 0.86 * filling : 0,
      cup: !!pr,
      t: nowMs() / 1000
    });

    /*
     * How much longer. The same bar the board wears, for the same reason: the
     * work is invisible otherwise, and it stops when the cook walks off - so
     * green while somebody is on it, amber when nobody is.
     */
    if (pr && !done) {
      var bx = r.x + 5, bw = r.w - 10, by = r.y + r.h - 9, bh = 5;
      Art.rr(ctx, bx, by, bw, bh, 2.5);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();
      Art.rr(ctx, bx, by, Math.max(2, bw * filling), bh, 2.5);
      ctx.fillStyle = pr.working ? K.go : C.warm;
      ctx.fill();
    }

    /*
     * The yellow ring means a lever is BEING WORKED, and nothing else.
     *
     * It used to sit on the flavour the board was waiting for before anybody
     * touched the machine, which turned a piece of feedback into an
     * instruction - the player read the answer off the machine instead of off
     * the order. It appears when a lever is pressed and stays on that lever
     * until the cup is taken, which is the one thing it is for: saying the
     * press landed and the work is happening here.
     */
    if (pr) pickRing(tapColRect(v.active), 6);
    if (!pr && !v.want && !(S.drinkTaps || []).length) {
      Art.ui.letters(ctx, 'CLOSED', r.x + r.w / 2, r.y + r.h * 0.70, r.h * 0.055,
        { fill: 'rgba(63,74,80,0.70)', weight: 0.12, track: 0.14, seed: 5520 });
    }
  }

  function drawPlates() {
    // one plating bench with the plates sitting on it
    var n = S.plates.length;
    var last = plateRect(n - 1);
    var body = {
      x: L.plateX - 3, y: L.plateTop - L.pPadTop,
      w: (L.plateW || L.colW) + 6, h: (last.y + last.h) - L.plateTop + L.pPadTop + L.pPadBot
    };
    Art.scene.counter(ctx, body.x, body.y, body.w, body.h, DEPTH.plate * (L.k || 1),
      { top: K.plateTop, top2: K.plateTop2, side: K.plateSide });

    for (var i = 0; i < n; i++) {
      var r = plateRect(i);
      var p = S.plates[i];
      var live = targeted('plate', i);
      /*
       * Where the dish sits in its slot. A flat 10px off the bottom pinned it
       * to the floor of a tall slot; a share of the slot lifts it clear while
       * still leaving the food room to stack upwards, and the 10px floor keeps
       * a short slot exactly where it was.
       */
      var cx = r.x + r.w / 2, py = r.y + r.h - Math.max(10, r.h * 0.22);

      /*
       * Work out what is on the plate before drawing the plate: it lays deli
       * paper and a contact shadow under whatever it is carrying, and it needs
       * that thing's width to size them.
       *
       * A plate that would be taken as it stands also wears a halo, so a
       * finished order is visible from across the room without being read.
       */
      var pw = r.w * 0.80;
      var built = inbound('plate', i) ? p.stack.slice(0, -1) : p.stack;
      var shown = built.length ? Core.displayStack(built) : null;
      var bw = shown ? Art.fitWidth(shown, pw * 0.74, r.h - 22) : 0;

      /*
       * The moment a side or a drink joins it, the bench is building a SET and
       * has to show one. It used to draw the burger and nothing else, so the
       * player assembled a combo with no way to see the combo.
       */
      var benchEx = setExtras(p);
      if (benchEx.n) {
        /*
         * The tray's dish has to land on the same line as a bare plate's, or a
         * column of four sits at two different heights depending on which of
         * them happen to have a drink on them. drawSet takes the tray's front
         * edge, and the dish stands half a tray-height above it.
         */
        var trayW = r.w * 0.96;
        drawSet(ctx, { stack: built, side: p.side, sideCook: p.sideCook, drink: p.drink },
                cx, py - 2 + trayW * 0.20 * 0.50, trayW, r.h - 22, benchEx, plateGlow(p));
        if (live) {
          Art.rr(ctx, r.x, r.y, r.w, r.h, 11);
          ctx.strokeStyle = K.pick;
          ctx.lineWidth = 2.4;
          ctx.stroke();
        }
        continue;
      }

      Art.scene.plate(ctx, cx, py - 2, pw, {
        glow: plateGlow(p), food: shown ? 1 : 0, foodW: bw
      });

      if (live) {
        Art.rr(ctx, r.x, r.y, r.w, r.h, 11);
        ctx.strokeStyle = K.pick;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }

      // An empty plate is a drawn empty plate; it does not need to be captioned.
      if (!shown) continue;
      // plateSeat is where the burger rests, rather than the hand-picked
      // offset that used to leave it hovering a pixel or two over the rim.
      var seat = Art.scene.plateSeat(cx, py - 2, pw);
      Art.drawStack(ctx, shown, seat.x, seat.y, bw);
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
     * The window is a window, not a portrait. Nobody stands in it now, so the
     * prompt takes the middle of the opening instead of being squeezed onto the
     * sill underneath a face - which is where it had to go when there was one.
     * Light ink, because it is sitting on the dim room rather than on the wood.
     */
    /*
     * Written with the pen, not set in Figtree. The prompt used to be
     * '▲  S E R V E  ▲' - and U+25B2 is in no font this game ships, so the two
     * triangles came from whatever the device had. Art.ui.letters draws the
     * word in the same hand as the room it sits in, and its own tracking does
     * what the spaced-out capitals were reaching for.
     */
    Art.ui.letters(ctx, ready ? 'SERVE' : S.tickets.length + ' WAITING',
      h.x + h.w / 2, h.y + h.h * 0.56, ready ? 11 : 9, {
        fill: ready ? C.sageLift : 'rgba(249,244,237,0.62)',
        weight: 0.13, track: ready ? 0.30 : 0.14, seed: 4411
      });
    if (live) pickRing(h, 14);

    var b = binRect();
    var bl = targeted('bin');
    // The lid flips up as something goes in. Same recoil timer the crates use.
    // The bin is drawn as a bin, with a lid that flips. The word under it was
    // saying what the picture already said.
    Art.scene.bin(ctx, b.x, b.y, b.w, b.h, { open: S.binPop || 0 });
    if (bl) pickRing(b, 14);
  }

  /**
   * Draws whatever the cook is holding as the actual object - the real slice of
   * cheese, the real seared patty, the real plated burger - rather than an icon
   * in a floating card. Returns its half-width so the hands can close on it.
   */
  /**
   * How wide the thing in the cook's hands is, as a half-width.
   *
   * drawChef asks for this BEFORE it draws the arms, because the hands close
   * on the object and the sleeves end at the hands. Kept beside the drawing
   * rather than inside it so the two cannot disagree about a size.
   */
  function carriedHalf(maxW, hold, maxH) {
    if (!hold) return 0;
    // a tray is much wider than a dish, and the hands close on whatever this
    // says - get it wrong and the arms hold air beside the thing being carried
    if (hold.kind === 'plate') {
      return setExtras(hold).n ? trayWidth(maxW) / 2 : plateRadius(maxW);
    }
    if (hold.kind === 'fryBag') return maxW * 0.17;
    if (hold.kind === 'fries') return maxW * 0.20;
    if (hold.kind === 'cup') return maxW * 0.17;
    if (hold.id === 'bun') return Art.layerWidth('bunBottom', bunRollWidth(maxW)) / 2;
    if (wholeVeg(hold)) return veggieRadius(maxW, maxH);
    return Art.layerWidth(hold.id, looseWidth(maxW, hold.id)) / 2;
  }

  /** An uncut vegetable in the hands - not the burger layer it becomes. */
  function wholeVeg(hold) {
    if (!hold || hold.kind !== 'ing' || hold.prepped) return false;
    if (!Art.item || !Art.item.vegWhole) return false;   // art-prep.js absent
    var ing = Core.byId(hold.id);
    return !!(ing && ing.chop);
  }

  // the carry box is wide and flat, so a round thing is bounded by its height.
  // carriedHalf is called from the measure pass, which may not know maxH; the
  // fallback is the ratio art.js actually uses (0.205 / 0.72).
  function veggieRadius(maxW, maxH) {
    return Math.min(maxW * 0.17, (maxH || maxW * 0.2847) * 0.46);
  }

  /*
   * The dish is a dish. It used to be sized off the food on it, so an empty
   * plate was the widest thing the cook ever carried and loading it made it
   * 42% NARROWER - a plate that shrinks as you fill it.
   */
  function plateRadius(maxW) { return maxW * 0.30; }

  /*
   * Every loose ingredient got the full box, and `maxW` is a BUN width - so a
   * lettuce leaf, which deliberately overhangs its bun, painted 0.95s wide
   * against a 0.59s belly. The roll was already cut to 0.52 for exactly this
   * reason; the other fourteen never got the same treatment.
   */
  function looseWidth(maxW, id) {
    return maxW * 0.55 / Math.max(1, Art.layerWidth(id, 1));
  }
  function bunRollWidth(maxW) { return Art.fitWidth(['bunBottom', 'bunTop'], maxW * 0.52, 1e9); }

  function drawCarried(g, cx, baseY, maxW, maxH, hold, measure) {
    if (!hold) return 0;
    // The measuring pass: drawChef needs the width before it can place the
    // hands, and the object cannot be painted until the arms are down.
    if (measure) return carriedHalf(maxW, hold, maxH);

    g.save();
    g.shadowColor = 'rgba(80,50,32,0.35)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 3;

    if (hold.kind === 'fryBag') {
      if (Art.item.fryBag) {
        Art.item.fryBag(g, cx - maxW * 0.17, baseY - maxH * 0.98, maxW * 0.34, maxH * 0.98,
                        { frost: 0.9, seed: 1361 });
      }
      g.restore();
      return maxW * 0.17;
    }

    if (hold.kind === 'fries') {
      Art.item.friesBox(g, cx - maxW * 0.20, baseY - maxH * 0.92, maxW * 0.40, maxH * 0.92,
        { fries: 1, cooked: hold.done, brand: 'FRIES' });
      g.restore();
      // a HALF-WIDTH, which is what drawChef closes the hands on
      return maxW * 0.20;
    }

    if (hold.kind === 'cup') {
      Art.item.cup(g, cx - maxW * 0.17, baseY - maxH * 0.95, maxW * 0.34, maxH * 0.95,
        { flavor: hold.flavor, fill: 0.85, lid: 1, straw: true });
      g.restore();
      return maxW * 0.17;
    }

    if (hold.kind === 'plate') {
      // A set goes on a tray. Carried as a bare dish, a burger-fries-cola
      // order looked exactly like a burger, right up to the hatch.
      var carryEx = setExtras(hold);
      if (carryEx.n) {
        var tw = trayWidth(maxW);
        drawSet(g, hold, cx, baseY, tw, maxH, carryEx, 0);
        g.restore();
        return tw / 2;
      }

      var shown = Core.displayStack(hold.stack);
      var pr = plateRadius(maxW);
      // the food fits the dish, not the other way round
      var bw = Art.fitWidth(shown, pr * 1.55, maxH * 0.86);
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

    /*
     * A loose ingredient, carried as itself. Beef carries its doneness with it,
     * so raw / seared / burnt is readable without any badge.
     *
     * A bun is the exception: `bun` is one crate but two layers, and drawing
     * the layer by id gave the heel on its own - a cook walking a flat disc
     * across the room, which reads as a plate more than as bread. Carry the
     * whole roll, the way it comes out of the box.
     */
    if (hold.id === 'bun') {
      /*
       * Half the carry box, not all of it.
       *
       * `maxW` is 76% of the cook's whole height - fine for a patty, which is
       * one thin layer, but a roll is two stacked and at that width it came
       * out as wide as his chest, sat over his body and left the arms poking
       * out either side. It reads as caught on him rather than held.
       */
      var roll = ['bunBottom', 'bunTop'];
      var rw = bunRollWidth(maxW);
      Art.drawStack(g, roll, cx, baseY, rw);
      g.restore();
      return Art.layerWidth('bunBottom', rw) / 2;
    }

    /*
     * A head of lettuce is not shredded lettuce.
     *
     * Art.drawLayer paints the BURGER layer - a cut tomato face, three torn
     * leaves - so a vegetable straight out of the crate was drawn in the
     * cook's hands as though it had already been through the board. That is
     * the one distinction he has to be able to make at a glance, and it was
     * the only thing on screen that could have told him.
     */
    if (wholeVeg(hold)) {
      var vr = veggieRadius(maxW, maxH);
      Art.item.vegWhole(g, cx, baseY - vr, vr, { id: hold.id });
      g.restore();
      return vr;
    }

    // The raw patty came out of the crate a shade wider than the hands holding
    // it. Everything else is drawn at the width it is given.
    var w = looseWidth(maxW, hold.id);
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
      /*
       * The pose comes from Art.chefPose, not from sine waves written here.
       *
       * `phase` is already the distance he has walked in strides, so it feeds
       * the waddle directly - the lean, the hip shift, the rise between steps
       * and the belly arriving late are all one number now. Standing still he
       * breathes; a lost order leaves him drooping for a moment; a plate that
       * landed perfectly gets a little cheer.
       */
      /*
       * Walking is decided by MOTION, not by owning a target.
       *
       * `c.target` is only ever set on the host, so on a guest's screen both
       * cooks slid across the floor with their legs frozen - the waddle was
       * computed for them and never asked for. Comparing the drawn position
       * works the same on both sides of a co-op game.
       */
      var moved = Math.abs(c.x - (c.px0 === undefined ? c.x : c.px0)) +
                  Math.abs(c.y - (c.py0 === undefined ? c.y : c.py0));
      c.px0 = c.x; c.py0 = c.y;
      var walking = !!c.target || moved > 0.25;

      var pose;
      if (walking) {
        pose = { walk: c.phase };
      } else if (S.chefMood && S.chefMood.until > nowMs() && i === S.chefMood.who) {
        pose = Art.chefPose(S.chefMood.mode, (nowMs() - S.chefMood.at) / 1000);
      } else {
        pose = Art.chefPose('idle', nowMs() / 1000);
      }
      Art.drawChef(ctx, c.x, c.y, cs, {
        face: c.face,
        // chefPose decides both of these on purpose - a cheer holds its eyes
        // open and bounces - and drawChefs used to throw them away and read
        // the chef object instead, which made the bounce dead code.
        blink: pose.blink === undefined ? c.blink : Math.min(c.blink || 0, pose.blink),
        hop: Math.max(c.hop || 0, pose.hop || 0),
        walk: pose.walk, bob: pose.bob === undefined ? 0 : pose.bob,
        work: pose.work, cheer: pose.cheer, droop: pose.droop,
        // The second cook in co-op keeps the house whites, so two players are
        // still telling each other apart at 44px.
        skin: i === S.me ? S.skin : 'classic',
        // hands stay empty while the item is still in the air
        carry: (c.holding && !flying)
          ? function (g, cx, baseY, maxW, maxH, measure) {
            return drawCarried(g, cx, baseY, maxW, maxH, c.holding, measure);
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
    // a wall fitting now, like the plates it sits above - always behind the cook
    drawPrepBoard();
    drawGrill();
    drawFreezerUnit();
    drawFryStation();
    drawPlates();
    drawFountain();
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
  /*
   * The HUD is drawn, so "sync" means repaint rather than write six text nodes.
   * It still guards on a signature, and for the same reason as before: the
   * clock ticks every frame but only changes once a second, and repainting the
   * paper, the hearts and the thermometer sixty times a second for a display
   * that changed once is what made the phone stutter.
   */
  var hudLast = {};
  var titleFrame = 0;

  function paintHud() {
    var total = till();
    var running = S.screen === 'service' && S.dayLength > 0;
    var secs = Math.max(0, Math.ceil(S.timeLeft));

    // Said before it is drawn, and never gated on the canvas having a size: a
    // screen reader cannot read a canvas, so this line IS the HUD as far as
    // one is concerned, and it must not go stale because a repaint was skipped.
    if (el.hudRead) {
      el.hudRead.textContent = 'Day ' + S.day +
        (running ? ', ' + Core.clockText(secs) + ' left' : '') +
        ', ' + Core.money(total) + ' of ' + Core.money(S.rent) +
        ((S.waste || 0) ? ', ' + Core.money(S.waste) + ' thrown away' : '') + '.';
    }

    if (!el.hudArt) return;
    var W = el.hudArt.clientWidth, H = el.hudArt.clientHeight;
    if (!W || !H) return;
    paintOn(el.hudArt, W, H, function (g) {
      Art.ui.hud(g, 0, 0, W, H, {
        day: S.day,
        time: running ? Core.clockText(secs) : '',
        urgent: running && secs <= 15,
        // Art.ui.hud writes the money itself, in dollars, and shrinks or
        // shortens the string until it fits. Core keeps money in cents.
        earned: total / 100,
        goal: S.rent / 100,
        pct: S.rent ? clamp(total / S.rent, 0, 1) : 0,
        // Twelve dashes that fill as the line runs clean. Tips ARE the perfect
        // rate, so this is the number behind the money rather than a second
        // copy of it.
        tip: S.served ? clamp(S.perfect / S.served, 0, 1) : 0,
        // what is still owed on the day, which is the whole game now that
        // the hearts are gone
        need: Math.max(0, S.rent - total) / 100,
        waste: (S.waste || 0) / 100
      });
    });
    overlay(el.pauseBtn, grow(Art.ui.hudBoxes(0, 0, W, H).pause, MIN_TOUCH));
  }

  function syncHud() {
    var total = till();
    var sig = S.day + '|' + total + '|' + S.rent + '|' + S.waste + '|' + S.sales + '|' + S.tips;
    if (hudLast.sig !== sig) { hudLast.sig = sig; paintHud(); }
    syncClock();
  }

  /*
   * The shift clock, kept out of syncHud's change-detection because it moves
   * every frame by nature - so it does its own, on the whole second rather than
   * on the raw number.
   *
   * It also still owns `no-clock`, which is what hands the kitchen the slack
   * the storefront sign was holding. That has nothing to do with the clock's
   * appearance and everything to do with the layout, so it stays here.
   */
  function syncClock() {
    if (!el.hudArt) return;
    var running = S.screen === 'service' && S.dayLength > 0;
    if (document.body && document.body.classList) {
      /*
       * This class is not decoration: it flips #stage from flex-grow 6 to 40
       * and hides the storefront sign, which is about eighty pixels of the
       * kitchen's height on a phone.
       *
       * Flipping it used to be all this did. Nothing re-measured the canvas,
       * so the room stayed laid out for the budget it had a moment ago and the
       * per-frame watchdog only caught up 120ms later - a visible shrink at
       * the top of every first shift. Whoever changes the budget re-measures
       * it, in the same frame.
       */
      var was = document.body.classList.contains('no-clock');
      document.body.classList.toggle('no-clock', !running);
      if (was === running && !layingOut) resize();
    }
    if (!running) {
      if (hudLast.clock !== null) { hudLast.clock = null; paintHud(); }
      setRush(0);
      return;
    }

    var secs = Math.max(0, Math.ceil(S.timeLeft));
    if (hudLast.clock === secs) return;
    hudLast.clock = secs;
    paintHud();
  }

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
  function orderRows(items, side, drink) {
    var counts = {};
    items.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });

    var rows = [];
    if (counts.patty > 1) rows.push({ id: 'patty', n: counts.patty });
    Object.keys(counts).forEach(function (id) {
      if (id === 'bun' || id === 'patty') return;
      rows.push({ id: id, n: counts[id] });
    });

    var out = rows.map(function (r) {
      var ing = Core.byId(r.id);
      return { n: r.n > 1 ? ing.short + ' x' + r.n : ing.short, c: ing.swatch };
    });
    // The list describes the BURGER, so PLAIN means a plain burger - whether
    // or not a carton and a cup are riding beside it in the picture.
    if (!out.length) return [{ n: 'PLAIN', c: '#e0cba6' }];
    /*
     * The tray's own two lines are gone.
     *
     * drawTraySet already draws the carton and the cup beside the burger, in
     * their own colours, at a size you can read across the room - and then the
     * list underneath wrote FRIES and COLA again. Two of the five lines on a
     * busy slip were captioning a picture. What is left is the thing the
     * picture genuinely cannot say: which fillings go in the burger.
     */
    return out;
  }

  /*
   * A ticket drawn as the set it actually is: the burger, and beside it the
   * fries and the cup when they were asked for.
   *
   * A slip is about eighty pixels wide, so this is not three pictures sharing
   * the space equally - the burger is what the cook builds and stays the
   * biggest thing on the paper. The other two stand on the same line beside
   * it, the way a combo sits on a tray, and they shrink the burger rather
   * than crowding it.
   *
   * The words underneath still say WHICH drink: six flavours are six shades of
   * brown at this size, and the slip has always named what the picture cannot.
   */
  /** What rides beside the burger on this plate, if anything. */
  function setExtras(p) {
    var fries = !!(p && p.side && Core.SIDES[p.side]);
    var cup = !!(p && p.drink && Core.drinkById(p.drink));
    return { fries: fries, cup: cup, n: (fries ? 1 : 0) + (cup ? 1 : 0) };
  }

  /** The tray is nearly the whole carry box - it has three things on it. */
  function trayWidth(maxW) { return maxW * 0.92; }

  /*
   * A set on a tray: the burger on its dish with whatever rides beside it.
   *
   * One function for the plating bench and for the cook's hands, so a combo
   * cannot look like one thing while it is being built and another while it is
   * being carried - which is what it did, because neither drew the side or the
   * drink at all. A plate with a cola on it was a plate with a burger on it.
   *
   * (cx, baseY) is the middle of the tray's front edge, `w` the tray, `maxH`
   * the tallest anything standing on it may draw. Heights are held well under
   * maxH because the cup is the tall one and it must not reach past what the
   * cook carrying it has room for.
   */
  function drawSet(g, p, cx, baseY, w, maxH, ex, glow) {
    ex = ex || setExtras(p);
    var shown = Core.displayStack(p.stack || []);
    var th = w * 0.20;
    var tx = cx - w / 2, ty = baseY - th;
    if (Art.item && Art.item.tray) Art.item.tray(g, tx, ty, w, th, {});
    var foodY = ty + th * 0.50;

    // fries on the left, burger in the middle, cup on the right - the order a
    // tray is loaded in, and it keeps the burger centred when both are out
    var burgerW = ex.n === 1 ? w * 0.60 : w * 0.52;
    var sideW = ex.n ? (w - burgerW) / ex.n : 0;
    var bcx = tx + (ex.fries ? sideW : 0) + burgerW / 2;

    var dishW = burgerW * 0.92;
    var bw = shown.length ? Art.fitWidth(shown, dishW * 0.74, maxH * 0.62) : 0;
    Art.scene.plate(g, bcx, foodY, dishW,
                    { glow: glow || 0, food: shown.length ? 1 : 0, foodW: bw });
    if (shown.length) {
      var seat = Art.scene.plateSeat(bcx, foodY, dishW);
      Art.drawStack(g, shown, seat.x, seat.y, bw);
    }

    if (ex.fries && Art.item && Art.item.friesBox) {
      var cw = sideW * 0.78, ch = maxH * 0.55;
      Art.item.friesBox(g, tx + (sideW - cw) / 2, foodY - ch, cw, ch,
        { fries: 1, cooked: p.sideCook === undefined ? 0.82 : p.sideCook, brand: '' });
    }
    if (ex.cup && Art.item && Art.item.cup) {
      var uw = sideW * 0.60, uh = maxH * 0.70;
      Art.item.cup(g, tx + w - sideW + (sideW - uw) / 2, foodY - uh, uw, uh,
        { flavor: p.drink, fill: 0.85, lid: 1, straw: true });
    }
  }

  function drawTraySet(g, t, x, y, w, h) {
    var shown = Core.displayStack(t.items);
    // Ask Core, the same way orderRows and checkExtras do. A ticket carrying an
    // id this build has never heard of draws no carton rather than an unnamed
    // one - the picture and the words must not disagree about what was ordered.
    var hasFries = !!(t.side && Core.SIDES[t.side]);
    var hasCup = !!(t.drink && Core.drinkById(t.drink));
    var extras = (hasFries ? 1 : 0) + (hasCup ? 1 : 0);
    var baseY = y + h;                       // everything stands on one line

    if (!extras) {
      Art.drawStack(g, shown, x + w / 2, baseY, Art.fitWidth(shown, w * 0.88, h * 1.95));
      return;
    }

    /*
     * Widths as a share of the box. The burger keeps more than half of it even
     * with both extras out, because a ticket you cannot read the burger on is
     * a ticket you have to read twice.
     */
    var burgerW = extras === 1 ? w * 0.62 : w * 0.54;
    var sideW = (w - burgerW) / extras;
    var side = Art.item && Art.item.friesBox && Art.item.cup;

    // fries on the left, burger in the middle, cup on the right - the order a
    // tray is loaded in, and it keeps the burger centred when both are out
    var cursor = x + (hasFries ? sideW : 0);
    Art.drawStack(g, shown, cursor + burgerW / 2, baseY,
                  Art.fitWidth(shown, burgerW * 0.94, h * 1.55));

    if (!side) return;                       // art-fries-drinks.js never loaded

    /*
     * Heights are the DRAWN heights, not the boxes'. friesBox spills its own
     * fries about 0.16h + 0.3w above the box it is given, so asking for the
     * full band gave a carton that towered over the burger and climbed into
     * the clip. The cup is the honest one - its box really does contain its
     * lid and straw - so it is the only piece here allowed to be the tallest,
     * which is also how a combo looks on a tray.
     */
    if (hasFries) {
      var cw = sideW * 0.80, ch = h * 0.80;
      Art.item.friesBox(g, x + (sideW - cw) / 2, baseY - ch, cw, ch,
                        { fries: 1, cooked: 0.82, brand: '' });
    }
    if (hasCup) {
      var uw = sideW * 0.68, uh = h * 1.30;
      Art.item.cup(g, x + w - sideW + (sideW - uw) / 2, baseY - uh, uw, uh,
                   { flavor: t.drink, fill: 0.85, lid: 1, straw: true });
    }
  }

  /** The same list in a sentence, for a reader that cannot see the board. */
  function orderSpoken(t) {
    return orderRows(t.items, t.side, t.drink).map(function (r) { return r.n; }).join(', ');
  }

  /*
   * A slip on its way off the board. dropTicket used to add a class and let CSS
   * run the leaving animation on the ticket's own node; there are no nodes now,
   * so the ticket is kept in the drawing for the same 320ms and faded out by
   * hand. The board keeps its beat instead of a slip vanishing between frames.
   */
  var leaving = [];
  var boardLast = null;

  // How long the slip has left, said in the paper palette rather than in
  // traffic lights: the same three inks the receipt stamps and rules use.
  var BAR_GOOD = '#3f7a2a', BAR_WARN = '#e8a021', BAR_CRIT = '#c9302c';

  function holdLeaving(t) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var pct = clamp(t.patience / t.max, 0, 1);
    leaving.push({
      t: t, at: now, rows: orderRows(t.items, t.side, t.drink),
      bar: pct < 0.12 ? BAR_CRIT : (pct < 0.28 ? BAR_WARN : BAR_GOOD)
    });
  }

  function releaseLeaving(t) {
    for (var i = leaving.length - 1; i >= 0; i--) if (leaving[i].t === t) leaving.splice(i, 1);
  }

  function paintBoard() {
    // Spoken first, for the same reason the HUD's line is: it is the board to
    // anything that cannot see one, and it must not depend on a repaint.
    if (el.boardRead) {
      el.boardRead.textContent = S.tickets.length
        ? S.tickets.length + ' order' + (S.tickets.length > 1 ? 's' : '') + ': ' +
          S.tickets.map(orderSpoken).join('; ')
        : 'No orders waiting.';
    }

    if (!el.boardArt) return;
    var W = el.boardArt.clientWidth, H = el.boardArt.clientHeight;
    if (!W || !H) return;

    // Every slot the day can hold, so the slips keep their width as tickets
    // come and go - drawOrders divides the batten by however many it is given.
    var slots = Math.max(1, (S.cfg ? S.cfg.concurrent : 2));
    var live = S.tickets.slice(0, slots);
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var list = [];

    live.forEach(function (t) {
      var pct = clamp(t.patience / t.max, 0, 1);
      list.push({
        t: t, fade: 1, pct: pct,
        rows: orderRows(t.items, t.side, t.drink),
        bar: pct < 0.12 ? BAR_CRIT : (pct < 0.28 ? BAR_WARN : BAR_GOOD)
      });
    });
    leaving.forEach(function (L) {
      if (list.length >= slots) return;
      list.push({ t: L.t, fade: Math.max(0, 1 - (now - L.at) / 320), pct: 0, rows: L.rows, bar: L.bar });
    });
    while (list.length < slots) list.push(null);

    paintOn(el.boardArt, W, H, function (g) {
      Art.ui.orders(g, 0, 0, W, H, {
        /*
         * The board asks its own box which way it is hung. Stacked above the
         * kitchen it is wide and short; turned into a column beside it, tall
         * and narrow. Reading the shape rather than a flag means the CSS that
         * moves it and the drawing that fills it cannot disagree.
         */
        vertical: H > W,
        heat: rushOn ? 1 : 0,
        tickets: list.map(function (e) {
          return e ? { rows: e.rows, pct: e.pct, bar: e.bar, e: e } : { rows: [], pct: 0, bar: 'rgba(0,0,0,0)' };
        }),
        /*
         * No customers in this build, so the slip's portrait band is empty
         * paper. The burger takes it: drawOrders hands out an unclipped box,
         * and the band above this one is the face's, which nothing is using.
         */
        food: function (gg, tk, fx, fy, fw, fh) {
          if (!tk.e) return;
          gg.save();
          gg.globalAlpha = tk.e.fade;
          drawTraySet(gg, tk.e.t, fx, fy, fw, fh);
          gg.restore();
        }
      });
    });
  }

  function renderBoard() {
    boardLast = null;      // the ticket set changed; do not let the throttle skip it
    paintBoard();
  }

  function updateBoardBars() {
    /*
     * The patience strokes used to be a width on a DOM node, which the browser
     * could repaint for nothing. They are pen marks on the board's canvas now,
     * and the whole board - torn paper, hatching, hand-lettered rows - would be
     * redrawn with them, sixty times a second, for a stroke that moves about a
     * pixel a second on a 65px slip.
     *
     * So the signature is the drawn state, not the raw one: quantise each
     * patience to a fiftieth, and repaint only when a mark would actually land
     * somewhere else. Nothing on screen is dropped, and a full second of a
     * quiet board costs one repaint instead of sixty.
     */
    var sig = '';
    for (var i = 0; i < S.tickets.length; i++) {
      var t = S.tickets[i];
      sig += t.uid + ':' + Math.round(clamp(t.patience / t.max, 0, 1) * 50) + '|';
    }
    if (leaving.length) sig += 'x' + leaving.length;
    sig += rushOn ? '!' : '';
    if (sig === boardLast) return;
    boardLast = sig;
    paintBoard();
  }

  /* -------------------------------------------------------------- screens */
  function showModal(node) { node.hidden = false; node.classList.add('show'); }
  function hideModal(node) { node.classList.remove('show'); node.hidden = true; }

  function showDayEnd(passed, ranOut, total) {
    if (!passed) {
      el.overTitle.textContent = 'RENT UNPAID';
      /*
       * Name the shortfall, and name the bin if the bin is why.
       *
       * SHUT DOWN and "five orders blown" belonged to the hearts. There is one
       * way to lose now - the till did not cover the rent - so the sheet says
       * by how much, and calls out the wasted food when it was enough to have
       * made the difference.
       */
      var short = S.rent - total;
      var binned = S.waste || 0;
      el.overReason.textContent =
        (binned >= short
          ? 'You threw away ' + Core.money(binned) + ' of food and came up ' +
            Core.money(short) + ' short of the rent. Every plate that goes back is paid for.'
          : (S.closedBy === 'clock'
            ? 'Closing time came round ' + Core.money(short) + ' short of the ' +
              Core.money(S.rent) + ' rent. Faster tomorrow.'
            : 'You took in ' + Core.money(total) + ' against ' + Core.money(S.rent) +
              ' of rent. The landlord is not sympathetic.'));
      el.overDay.textContent = S.day;
      el.overBest.textContent = S.bestDay;
      el.retryDay.textContent = S.day;
      showModal(el.over);
      return;
    }
    dayEndData = {
      title: 'DAY ' + S.day + ' CLOSED',
      lines: [
        { k: 'Food sales', v: Core.money(S.sales) },
        { k: 'Tips', v: Core.money(S.tips) },
        { k: 'Took in', v: Core.money(total) },
        { k: 'Rent', v: '-' + Core.money(S.rent), col: '#c9302c' },
        { k: total - S.rent >= 0 ? 'Profit' : 'Short', v: Core.money(total - S.rent),
          col: total - S.rent >= 0 ? '#3f7a2a' : '#c9302c' }
      ],
      chips: [
        { v: S.perfect, k: 'PERFECT' },
        { v: S.served, k: 'SERVED' },
        { v: S.walked, k: 'WALKED' }
      ],
      // Rubber-stamped only when the rent is genuinely covered.
      paid: passed ? 'PAID' : null,
      note: S.closedBy === 'clock'
        ? 'CLOSING TIME · ' + Core.money(S.money) + ' IN THE TILL'
        : (S.perfect === S.served && S.served > 0
          ? 'EVERY TICKET PERFECT · THE REGULARS ARE TALKING'
          : 'RENT COVERED · ' + Core.money(S.money) + ' IN THE TILL')
    };
    showModal(el.dayEnd);
    paintDayEnd();
  }

  /*
   * The receipt, drawn. Art.ui.receipt lays out the whole slip - the torn
   * paper, the written lines with their dot leaders, the three counted boxes
   * and the PAID stamp - and the one button sits on the box it reports.
   *
   * The lines are held here rather than read off S at paint time because the
   * receipt is a snapshot of a day that has already ended: startDay() clears
   * S.sales the moment the player taps through, and a resize would otherwise
   * repaint the receipt with zeroes.
   */
  var dayEndData = null;

  function paintDayEnd() {
    if (!dayEndData) return;
    var d = dayEndData;
    if (el.dayEndRead) {
      el.dayEndRead.textContent = d.title + '. ' +
        d.lines.map(function (l) { return l.k + ' ' + l.v; }).join(', ') + '. ' +
        d.chips.map(function (c) { return c.v + ' ' + c.k.toLowerCase(); }).join(', ') + '.';
    }
    if (!el.dayEndArt) return;
    var W = el.dayEnd.clientWidth, H = el.dayEnd.clientHeight;
    if (!W || !H) return;
    paintOn(el.dayEndArt, W, H, function (g) {
      Art.ui.receipt(g, 0, 0, W, H, d);
    });
    overlay(el.dayEndBtn, grow(Art.ui.receiptBoxes(0, 0, W, H).primary, MIN_TOUCH));
  }

  /*
   * The five things the shop sells, drawn with the same pen as the food.
   *
   * They were emoji, which made the shop the one screen where the game's own
   * hand disappeared and the platform's font took over - and a frying pan next
   * to a flame does not say "one more burner" next to "a wider perfect
   * window" to anybody. Art.drawUpgrade splits those two into a flame and a
   * single burner plate, so the icon alone carries the difference.
   */
  /*
   * The title slip, painted whole by Art.ui.title.
   *
   * The slip used to be DOM: a .sheet, a Caprasimo wordmark and four emoji
   * tiles. The handoff draws all of it instead - the diner behind, the rail,
   * the clip, the torn paper, and the letters themselves, which is the only
   * way BURGER gets an inked outline with hatching inside the strokes. Nothing
   * on a sheet of paper is set in a typeface.
   *
   * Three tiles, as drawn. The outfit shop kept its own way in from the shop
   * screen ("Change the cook's outfit"), which is where the money is anyway.
   */
  var TITLE_TILES = [
    { id: 'coop', label: 'CO-OP', btn: 'coopBtn' },
    { id: 'rank', label: 'RANKS', btn: 'boardBtn' },
    { id: 'you', label: 'YOU', btn: 'accountBtn' }
  ];

  /** Size a canvas to the display, clear it, and hand the painter a CSS box. */
  function paintOn(cv, W, H, paint) {
    if (!cv || !cv.getContext) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    paint(g, W, H);
  }

  /*
   * A drawn control can be any size the drawing wants; the finger cannot. The
   * pause square comes out at 22px on a phone, which is half what a touch
   * target should be - so the button keeps the square's centre and grows to
   * meet the minimum. Drawn small, pressed big.
   */
  var MIN_TOUCH = 44;

  function grow(box, min) {
    var w = Math.max(box.w, min), h = Math.max(box.h, min);
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w: w, h: h };
  }

  /** Put a control exactly on a drawn box, or park it if there is no box. */
  function overlay(btn, box) {
    if (!btn) return;
    btn.hidden = !box;
    if (!box) { btn.style.left = '-9999px'; return; }
    btn.style.left = box.x + 'px';
    btn.style.top = box.y + 'px';
    btn.style.width = box.w + 'px';
    btn.style.height = box.h + 'px';
  }

  /** The line written along the foot of the slip. */
  function titleNote() {
    if (S.bestDay > 1) return 'BEST DAY ' + S.bestDay + ' · ' + Core.money(S.lifetime || 0);
    return Net.online ? 'SIGNED IN · SAVED EVERYWHERE'
                      : 'OFFLINE · SAVED ON THIS DEVICE';
  }

  function paintTitle() {
    if (!el.titleArt || !Art.ui || !Art.ui.title) return;
    var W = el.start.clientWidth || window.innerWidth;
    var H = el.start.clientHeight || window.innerHeight;
    if (!W || !H) return;

    // A save turns the top button into CONTINUE and pushes NEW SHIFT under it.
    // On a fresh install there is nothing to continue, so the second button
    // teaches the game instead of offering a restart of a shift never played.
    var resume = !!(S.saved && S.day > 0);

    paintOn(el.titleArt, W, H, function (g) {
      Art.ui.titleHero(g, 0, 0, W, H, {
        t: nowMs() / 1000,
        tagline: 'RUN THE LINE',
        day: resume ? S.day : 0,
        primary: resume ? null : 'START THE SHIFT',
        secondary: resume ? 'NEW SHIFT' : 'HOW TO PLAY',
        note: titleNote(),
        tiles: TITLE_TILES,
        logo: function (gg, lx, ly, lw, lh) {
          gg.save();
          gg.translate(lx, ly);
          Art.drawLogo(gg, lw, lh);
          gg.restore();
        },
        tile: function (gg, id, tx, ty, tw, th) {
          gg.save();
          gg.translate(tx, ty);
          Art.glyph(gg, id, tw, th);
          gg.restore();
        }
      });
    });

    var B = Art.ui.heroBoxes(0, 0, W, H, TITLE_TILES.length);
    overlay(el.continueBtn, resume ? B.primary : null);
    overlay(el.playBtn, resume ? B.secondary : B.primary);
    overlay(el.howBtn2, resume ? null : B.secondary);
    TITLE_TILES.forEach(function (t, i) { overlay(el[t.btn], B.tiles[i]); });
  }

  function upgradeIcon(host, id, size) {
    if (!host || !Art.drawUpgrade) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var cv = document.createElement('canvas');
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.width = size + 'px';
    cv.style.height = size + 'px';
    host.appendChild(cv);
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    Art.drawUpgrade(g, id, size, size);
  }

  /*
   * The shop, drawn. Art.ui.shop lays out the slip - the till bundle, the
   * taped NEW ON THE MENU slip, one ruled row per upgrade with its icon, its
   * level pips and a swing tag for the price - and reports where every price
   * tag landed so a real <button> can sit on it.
   *
   * The buy buttons are built once and then only re-placed, because a shop
   * repaint happens on every purchase and on every resize.
   */
  function shopModel() {
    var active = activeLevels();
    var today = Core.effects(active, S.day);
    var next = Core.effects(active, S.day + 1);
    var cfg = Core.dayConfig(S.day + 1);
    function grew(a2, b2) { return b2 > a2 ? '+' : ''; }

    var ups = Core.UPGRADES.map(function (u) {
      var lvl = active[u.id] || 0;
      var cost = Core.upgradeCost(u.id, lvl);
      /*
       * Asked about tomorrow, because that is the shift the purchase lands in.
       * The room grows on its own and the whole kitchen is capped at five
       * stations, so past a point another burner is a burner that can never be
       * installed - and this shop was happily charging for it.
       */
      var gains = Core.upgradeGains(u.id, S.day + 1, active);
      var pips = [];
      for (var i = 0; i < u.max; i++) pips.push(i < lvl ? '#e8a021' : '#ddcdb0');
      return {
        id: u.id, t: u.name,
        d: (cost !== null && !gains) ? 'The kitchen is already full' : u.desc,
        p: cost === null ? 'MAX' : (!gains ? 'FULL' : Core.money(cost)),
        pips: pips,
        cost: cost, buyable: cost !== null && !!gains && S.money >= cost
      };
    });

    return {
      title: 'THE SHOP',
      day: 'DAY ' + S.day + ' · CLOSED',
      till: Core.money(S.money),
      unlocks: Core.unlockedOn(S.day + 1).map(function (ing) {
        return { id: ing.id, name: ing.name };
      }),
      upgrades: ups,
      tomorrow: 'TOMORROW · ' + next.plates + grew(today.plates, next.plates) + ' PLATES · ' +
                next.grillSlots + grew(today.grillSlots, next.grillSlots) + ' BURNERS · ' +
                cfg.concurrent + ' ORDERS UP · ' + Core.dayMenu(S.day + 1).length + ' CRATES',
      link: 'CHANGE THE COOK’S OUTFIT',
      primary: 'START DAY ' + (S.day + 1),
      rent: 'RENT DUE TOMORROW · ' + Core.money(Core.dayGoal(S.day + 1))
    };
  }

  var shopBuyBtns = [];

  function renderShop() {
    var m = shopModel();

    if (el.shopRead) {
      el.shopRead.textContent = 'The shop. ' + m.till + ' in the till. ' +
        m.upgrades.map(function (u) { return u.t + ', ' + u.p; }).join('. ') + '. ' + m.rent;
    }
    if (!el.shopArt) return;
    var W = el.shop.clientWidth, H = el.shop.clientHeight;
    if (!W || !H) return;

    paintOn(el.shopArt, W, H, function (g) {
      Art.ui.shop(g, 0, 0, W, H, {
        title: m.title, day: m.day, till: m.till,
        unlocks: m.unlocks, upgrades: m.upgrades,
        tomorrow: m.tomorrow, link: m.link, primary: m.primary, rent: m.rent,
        upgrade: function (gg, id, ix, iy, iw, ih) { Art.drawUpgrade(gg, id, iw, ih); },
        /*
         * In a bun, not on its own. drawPortrait draws a whole ingredient, but
         * a sauce is a bottle and a player still has to picture it ON a burger.
         * Between two bun halves every unlock is the same size and reads as
         * 'this is what you will be putting on one tomorrow'.
         */
        portrait: function (gg, id, ix, iy, iw, ih) {
          var shown = Core.displayStack(['bun', id]);
          Art.drawStack(gg, shown, ix + iw / 2, iy + ih, Art.fitWidth(shown, iw * 0.88, ih));
        }
      });
    });

    var B = Art.ui.shopBoxes(0, 0, W, H, m.upgrades.length, m.unlocks.length > 0);
    while (shopBuyBtns.length < m.upgrades.length) {
      var btn = document.createElement('button');
      btn.className = 'hit';
      el.shopBuys.appendChild(btn);
      shopBuyBtns.push(btn);
    }
    m.upgrades.forEach(function (u, i) {
      var btn = shopBuyBtns[i];
      btn.textContent = 'Buy ' + u.t + ' for ' + u.p;
      btn.disabled = !u.buyable;
      btn.onclick = function () { buyUpgrade(u.id); };
      overlay(btn, grow(B.buys[i], MIN_TOUCH));
    });
    for (var k = m.upgrades.length; k < shopBuyBtns.length; k++) overlay(shopBuyBtns[k], null);
    overlay(el.shopStoreBtn, grow(B.link, MIN_TOUCH));
    overlay(el.nextDayBtn, grow(B.primary, MIN_TOUCH));
  }
  /* ------------------------------------------------------- online screens */
  function setNetState() {
    el.netState.textContent = Net.online
      ? 'signed in as ' + (Net.name || 'Cook') + ' — progress syncs across devices'
      : 'offline — progress stays on this device';
    el.netState.classList.toggle('on', !!Net.online);
  }

  /*
   * The board and the cook screen are drawn now, like the title and the shop.
   *
   * Eight rows is what the sheet holds at a size hand lettering survives. A
   * player further down than that gets the run, a torn rule, a count of who is
   * between, and their own row under it - which is the same shape the design
   * calls for and the same thing the old DOM list did with a "···".
   */
  var LB_ROWS = 8;
  var lbState = { rows: [], me: null, mine: null, more: 0, note: '' };

  function lbRow(r) {
    return {
      rank: r.rank, name: r.name || 'Cook', day: r.day,
      money: Core.money(r.earned),
      named: !!r.name && String(r.name).toLowerCase() !== 'cook'
    };
  }

  /*
   * The worker's payload as the sheet wants it. Pure on purpose - the mapping
   * is the part with the edge cases in it (a player inside the visible run, a
   * player below it, a player the worker reported separately) and a pure
   * function is the only version of that a test can pin down without waiting
   * on a promise.
   */
  function lbMap(top, minePayload) {
    top = top || [];
    var myIdx = -1;
    for (var i = 0; i < top.length; i++) if (top[i].me) myIdx = i;

    var shown = top.slice(0, LB_ROWS).map(lbRow);
    var mine = null;
    if (myIdx >= LB_ROWS) mine = lbRow(top[myIdx]);
    else if (minePayload) mine = lbRow(minePayload);

    return {
      rows: shown,
      me: (myIdx >= 0 && myIdx < LB_ROWS) ? top[myIdx].rank : null,
      mine: mine,
      more: mine ? Math.max(0, mine.rank - shown.length - 1) : 0,
      note: top.length ? '' : 'NOBODY HAS FINISHED A DAY YET'
    };
  }

  function paintLeaderboard() {
    if (!el.lbArt || !Art.ui.board) return;
    var W = el.leaderboard.clientWidth, H = el.leaderboard.clientHeight;
    if (!W || !H) return;
    paintOn(el.lbArt, W, H, function (g) { Art.ui.board(g, 0, 0, W, H, lbState); });
    overlay(el.lbClose, grow(Art.ui.boardBoxes(0, 0, W, H).back, MIN_TOUCH));
  }

  function showLeaderboard() {
    showModal(el.leaderboard);
    lbState = { rows: [], me: null, mine: null, more: 0,
                note: Net.online ? 'LOADING' : 'YOU ARE OFFLINE' };
    el.lbNote.textContent = Net.online ? 'Loading…' : 'You are offline — no board to show.';
    paintLeaderboard();
    if (!Net.online) return;

    Net.leaderboard(20).then(function (data) {
      if (!data) {
        lbState.note = 'COULD NOT REACH THE BOARD';
        el.lbNote.textContent = 'Could not reach the board.';
        paintLeaderboard();
        return;
      }
      var top = data.top || [];
      lbState = lbMap(top, data.mine);
      el.lbNote.textContent = top.length
        ? 'Furthest day wins; money breaks ties.'
        : 'Nobody has finished a day yet. Be first.';
      paintLeaderboard();
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /*
   * The cook screen. Both text fields stay real inputs, sitting invisibly on
   * their drawn boxes - the platform keyboard, autofill and selection are not
   * things worth reimplementing on a canvas - and every keystroke repaints so
   * the letters appear in the boxes the pen drew.
   */
  var acct = { code: '', at: 0, note: '' };
  var acctTimer = null;

  function codeLeft() {
    if (!acct.code) return '';
    var s = Math.max(0, 600 - Math.floor((nowMs() - acct.at) / 1000));
    if (!s) return 'EXPIRED';
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60) + ' LEFT';
  }

  function paintAccount() {
    if (!el.acctArt || !Art.ui.cook) return;
    var W = el.account.clientWidth, H = el.account.clientHeight;
    if (!W || !H) return;
    var typed = (el.claimInput.value || '').toUpperCase().slice(0, 5);
    paintOn(el.acctArt, W, H, function (g) {
      Art.ui.cook(g, 0, 0, W, H, {
        name: el.nameInput.value || Net.name || 'Cook',
        skin: S.skin,
        code: acct.code, left: codeLeft(), typed: typed, note: acct.note
      });
    });
    var B = Art.ui.cookBoxes(0, 0, W, H, !!acct.code);
    overlay(el.nameInput, grow(B.name, MIN_TOUCH));
    overlay(el.nameSave, grow(B.save, MIN_TOUCH));
    // once a code is on the sheet its button is gone, and so is its hit box
    overlay(el.makeCodeBtn, acct.code ? null : grow(B.getCode, MIN_TOUCH));
    overlay(el.claimInput, grow(B.codeIn, MIN_TOUCH));
    overlay(el.claimBtn, grow(B.load, MIN_TOUCH));
    overlay(el.accountClose, grow(B.back, MIN_TOUCH));
  }

  /** The countdown on an issued code only ticks while the sheet is up. */
  function acctTick(on) {
    if (acctTimer) { clearInterval(acctTimer); acctTimer = null; }
    if (!on) return;
    acctTimer = setInterval(function () {
      if (!acct.code || el.account.hidden) { acctTick(false); return; }
      paintAccount();
    }, 1000);
  }

  /*
   * One line of feedback, in both places it has to appear: lettered onto the
   * sheet for the player, and in the live region for a screen reader. Every
   * handler goes through here so the two cannot drift.
   */
  function note(msg) {
    acct.note = msg || '';
    if (el.accountNote) el.accountNote.textContent = acct.note;
    paintAccount();
  }

  function showAccount() {
    showModal(el.account);
    el.nameInput.value = Net.name || '';
    el.claimInput.value = '';
    acct.code = ''; acct.at = 0;
    acct.note = Net.online ? '' : 'Offline — none of this will stick.';
    el.accountNote.textContent = acct.note;
    paintAccount();
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
            Sfx.init(); if (!S.musicOff) Bgm.start();
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

  /*
   * Every level the cook actually has, earned and paid folded together and
   * capped by the track. Nothing outside this function should read S.levels to
   * decide what the kitchen can do - S.levels is only the part that was bought
   * with takings, which is what the shop spends into.
   */
  function activeLevels() { return Core.levelsWithGear(S.levels, S.owned); }

  function buyUpgrade(id) {
    var active = activeLevels();
    var lvl = active[id] || 0;
    var cost = Core.upgradeCost(id, lvl);
    if (cost === null || S.money < cost) return;
    // Never take money for a level that cannot do anything tomorrow.
    if (!Core.upgradeGains(id, S.day + 1, active)) return;
    S.money -= cost;
    S.levels[id] = (S.levels[id] || 0) + 1;
    S.fx = Core.effects(activeLevels(), S.day);
    save();
    Sfx.upgrade();
    buzz(20);
    renderShop();
  }

  /* ------------------------------------------------------- the outfitters */
  /*
   * The paid shop. Three product shapes and no fourth, because the fourth one
   * is always the one that quietly moves a number the difficulty simulation
   * reads - see the note over Core.STORE.
   *
   *   skin  swaps the cook's eleven colours. Bought once, worn whenever.
   *   gear  hands over a level in an upgrade track that already exists, and
   *         stops at that track's existing max. Sooner, never bigger.
   *   till  in-game cash. Repeatable, so it is spent rather than owned.
   *
   * Prices are not written down anywhere in this project. The platform store
   * owns them per territory, per tax rule, per promotion, so the card shows
   * whatever Billing hands back and falls through to a tier indicator when
   * nothing has arrived - which is also what a build with no billing wired up
   * shows, honestly labelled.
   */
  var storeTab = 'style';
  var storeBusy = null;

  function owns(id) { return (S.owned || []).indexOf(id) >= 0; }

  function openStore() {
    storeTab = 'style';
    var radios = el.storeTabs ? el.storeTabs.querySelectorAll('input') : [];
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === 'style';
    showModal(el.store);
    renderStore();
    Billing.ready().then(renderStore);
  }

  /** A cook standing in the given outfit, for a card. */
  /*
   * Framed as a bust, feet below the card. A whole cook at 52px is four pixels
   * of trouser and a white blob - and the whole product is the colour of the
   * jacket and the scarf, which is the part that has to be big.
   */
  function skinPreview(cv, skinId) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var W = 56, H = 56;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    Art.drawChef(g, W / 2, H * 1.22, H * 1.30, { face: 1, skin: skinId });
    g.restore();
  }

  function storeCard(p) {
    var row = document.createElement('div');
    row.className = 'sku';

    if (p.kind === 'skin') {
      var art = document.createElement('canvas');
      art.className = 'sku-art';
      row.appendChild(art);
      skinPreview(art, p.skin);
      if (S.skin === p.skin) row.classList.add('worn');
    } else {
      var badge = document.createElement('span');
      badge.className = 'sku-badge';
      row.appendChild(badge);
      // Gear is an upgrade, so it wears that upgrade's own icon. A till top-up
      // is not one - it used to keep a 💵, the last emoji in the shop, on the
      // one screen that exists to take money. Art.ui.till already draws a
      // bundle of notes with a coin leaning on it, which is exactly what the
      // emoji was standing in for.
      if (p.kind === 'gear') upgradeIcon(badge, p.track, 34);
      else paintOn(badge.appendChild(document.createElement('canvas')), 34, 26,
                   function (g, W, H) { Art.ui.till(g, W, H); });
    }

    var text = document.createElement('div');
    var name = document.createElement('b');
    name.textContent = p.name;
    var desc = document.createElement('small');
    desc.textContent = p.desc;
    text.appendChild(name);
    text.appendChild(desc);

    // Three coins, filled to the product's tier. Stands in for a price until
    // the platform hands one over, and says "this one costs more" either way.
    var tier = document.createElement('div');
    tier.className = 'tier';
    for (var t = 0; t < 3; t++) {
      var pip = document.createElement('i');
      if (t < p.tier) pip.className = 'on';
      tier.appendChild(pip);
    }
    text.appendChild(tier);
    row.appendChild(text);

    var btn = document.createElement('button');
    btn.className = 'sku-buy';
    var price = Billing.priceOf(p.sku);
    if (storeBusy === p.id) {
      btn.textContent = '···';
      btn.disabled = true;
      btn.classList.add('busy');
    } else if (p.kind === 'skin' && owns(p.id)) {
      if (S.skin === p.skin) {
        btn.textContent = 'WORN';
        btn.disabled = true;
        btn.classList.add('own');
      } else {
        btn.textContent = 'WEAR';
        btn.classList.add('own');
        btn.addEventListener('click', function () { wearSkin(p.skin); });
      }
    } else if (p.kind === 'gear' && owns(p.id)) {
      btn.textContent = 'OWNED';
      btn.disabled = true;
      btn.classList.add('own');
    } else {
      btn.textContent = price || 'GET';
      btn.addEventListener('click', function () { buyProduct(p.id); });
    }
    row.appendChild(btn);
    return row;
  }

  function renderStore() {
    if (!el.storeList) return;
    el.storeList.innerHTML = '';
    Core.STORE.forEach(function (p) {
      var mine = p.kind === 'skin' ? 'style' : 'kitchen';
      if (mine !== storeTab) return;
      el.storeList.appendChild(storeCard(p));
    });

    if (el.storeNote) {
      el.storeNote.textContent = Billing.sandbox
        ? 'No billing is wired up in this build, so nothing here charges anything ' +
          'and nothing here is a real price. Prices come from the store itself.'
        : 'Prices are set by the store and shown in your currency. Gear and skins ' +
          'are bought once; till top-ups can be bought again.';
    }
    if (el.storeRestore) el.storeRestore.disabled = Billing.sandbox;
  }

  function wearSkin(skinId) {
    if (Core.skinsOwned(S.owned).indexOf(skinId) < 0) return;
    S.skin = skinId;
    save();
    Sfx.tap();
    buzz(10);
    renderStore();
  }

  /*
   * Hand the sale to the billing layer and only change anything if it says the
   * sale happened. A cancelled purchase is a normal outcome and says nothing -
   * a player who backed out does not need to be told they backed out.
   */
  function buyProduct(id) {
    var p = Core.storeItem(id);
    if (!p || storeBusy) return;
    storeBusy = id;
    renderStore();
    Billing.buy(p.sku).then(function (res) {
      storeBusy = null;
      if (!res.ok) {
        if (el.storeNote && res.reason !== 'cancelled') {
          el.storeNote.textContent = res.reason === 'unavailable'
            ? 'The store is not reachable right now. Nothing was charged.'
            : 'That did not go through. Nothing was charged.';
        }
        renderStore();
        return;
      }
      return Billing.verify(res.receipt).then(function (good) {
        if (good) grant(p);
        renderStore();
      });
    }).catch(function () {
      storeBusy = null;
      renderStore();
    });
  }

  /** Apply a product the billing layer says is paid for. */
  function grant(p) {
    if (p.kind === 'till') {
      S.money += p.cents;                     // repeatable, so never "owned"
    } else if (!owns(p.id)) {
      S.owned.push(p.id);
      // A skin you just bought is a skin you want to be wearing.
      if (p.kind === 'skin') S.skin = p.skin;
      if (p.kind === 'gear') S.fx = Core.effects(activeLevels(), S.day);
    }
    save();
    Sfx.upgrade();
    buzz(20);
    if (S.screen === 'shop') renderShop();     // the till and the pips just moved
  }

  /** "I bought this on my old phone." Asks the platform, merges what it says. */
  function restorePurchases() {
    if (el.storeNote) el.storeNote.textContent = 'Checking with the store…';
    Billing.restore().then(function (skus) {
      var added = 0;
      skus.forEach(function (sku) {
        Core.STORE.forEach(function (p) {
          if (p.sku !== sku || p.kind === 'till' || owns(p.id)) return;
          S.owned.push(p.id);
          added++;
        });
      });
      if (added) { S.fx = Core.effects(activeLevels(), S.day); save(); }
      renderStore();
      if (el.storeNote) {
        el.storeNote.textContent = added
          ? 'Put back ' + added + (added === 1 ? ' purchase.' : ' purchases.')
          : 'Nothing to put back on this account.';
      }
    });
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

  /*
   * What a cook is holding, over the wire.
   *
   * Everything that was not a plate fell through to the ingredient branch -
   * but a fries carton is `{kind:'fries', cook, done, char}` and a cup is
   * `{kind:'cup', flavor}`, and neither has an `id`. So a partner carrying
   * either one arrived on the other screen as an ingredient with `id:
   * undefined`, which draws as nothing and loses the flavour outright. The
   * plate branch had the milder version of the same bug: it kept the stack
   * and dropped the tray's side and drink.
   */
  function packHold(h) {
    if (!h) return null;
    if (h.kind === 'plate') {
      return { k: 'p', s: h.stack, sd: h.side || null, sc: h.sideCook, dr: h.drink || null };
    }
    if (h.kind === 'fryBag') return { k: 'b' };
    if (h.kind === 'fries') return { k: 'f', c: h.cook, d: h.done, ch: h.char };
    if (h.kind === 'cup') return { k: 'c', fl: h.flavor };
    return { k: 'i', id: h.id, c: h.cook, d: h.done, ch: h.char, gt: h.grillT, pr: h.prepped ? 1 : 0 };
  }
  function unpackHold(h) {
    if (!h) return null;
    if (h.k === 'p') {
      return { kind: 'plate', stack: h.s || [], side: h.sd || null, sideCook: h.sc, drink: h.dr || null };
    }
    if (h.k === 'b') return { kind: 'fryBag' };
    if (h.k === 'f') return { kind: 'fries', cook: h.c, done: h.d, char: h.ch };
    if (h.k === 'c') return { kind: 'cup', flavor: h.fl };
    return { kind: 'ing', id: h.id, cook: h.c, done: h.d, char: h.ch, grillT: h.gt, prepped: !!h.pr };
  }

  function snapshot() {
    var fw = Math.max(1, L.floor.x1 - L.floor.x0);
    var fh = Math.max(1, L.floor.y1 - L.floor.y0);
    return {
      // one packet, one number - stamped where the packet is made, not in the
      // send loop, so every path that produces one gets a fresh number
      type: 'state',
      seq: ++S.snapSeq,
      t: Math.round(nowMs()),
      day: S.day, waste: S.waste, sales: S.sales, tips: S.tips, rent: S.rent,
      screen: S.screen, menu: S.menu, concurrent: S.cfg ? S.cfg.concurrent : 3,
      paused: !!S.userPaused,
      left: Math.round(S.timeLeft * 10) / 10, len: S.dayLength,
      plates: S.plates.map(function (p) {
        return { s: p.stack, sd: p.side || null, sc: p.sideCook, dr: p.drink || null };
      }),
      grill: S.grill.map(function (g) { return g ? { id: g.id, t: g.t } : null; }),
      fryer: S.fryer.map(function (w) { return w ? { t: w.t } : null; }),
      board: S.board ? { id: S.board.id, cut: S.board.cut, p: S.board.portions, w: !!S.board.working,
                         wet: S.board.wet, j: S.board.juice } : null,
      taps: S.drinkTaps,
      seed: S.runSeed || 0,
      tickets: S.tickets.map(function (t) {
        return { uid: t.uid, a: t.arch.id, items: t.items, sd: t.side || null,
                 dr: t.drink || null, p: t.patience, m: t.max };
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
    /*
     * State packets are not ordered by the transport, and this used to take
     * whichever one arrived last. A packet that overtook a newer one rebuilt
     * the guest's board with the old portion count - repainting a full pile of
     * slices on a board the host had already wiped - until the next in-order
     * packet corrected it ~125ms later. Ignore anything that goes backwards.
     */
    if (m.seq !== undefined) {
      if (S.lastSeq !== undefined && m.seq <= S.lastSeq) return;
      S.lastSeq = m.seq;
    }

    // Anything that changes the size or count of a station changes the room.
    var shapeChanged =
      (S.menu || []).length !== (m.menu || []).length ||
      S.plates.length !== m.plates.length ||
      S.grill.length !== m.grill.length ||
      S.fryer.length !== ((m.fryer || []).length) ||
      (!!S.board) !== (!!m.board) ||
      S.day !== m.day;

    var dayChanged = S.day !== m.day;
    S.day = m.day; S.waste = m.waste || 0; S.sales = m.sales; S.tips = m.tips; S.rent = m.rent;
    S.menu = m.menu;
    if (!S.cfg || S.cfg.day !== m.day) S.cfg = Core.dayConfig(m.day);
    S.cfg.concurrent = m.concurrent;
    /*
     * A guest never runs startDay, so nothing here used to reserve the board -
     * it kept whatever height its OWN saved day asked for and then drew the
     * host's orders into it. Reserve for the day it is actually being sent.
     */
    if (dayChanged) reserveBoard(m.day);

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

    // Older hosts send a bare stack array; newer ones send the whole tray.
    S.plates = m.plates.map(function (p) {
      return Array.isArray(p)
        ? { stack: p, side: null, drink: null }
        : { stack: p.s || [], side: p.sd || null, sideCook: p.sc, drink: p.dr || null };
    });
    S.grill = m.grill;
    /*
     * A well that was empty and is not any more means the partner just took a
     * bag out. The stamp is a local clock, so it cannot come over the wire -
     * derive it from the change instead and the guest sees the same freezer
     * open that the host does.
     */
    /*
     * A local timestamp cannot come over the wire, so derive it: a partner
     * whose hands just filled with a bag has been at the freezer.
     */
    var tookBag = (m.chefs || []).some(function (c, i) {
      var was = S.chefs[i] && S.chefs[i].holding;
      return c.h && c.h.k === 'b' && !(was && was.kind === 'fryBag');
    });
    S.fryer = m.fryer || [];
    if (tookBag) S.fryGrab = nowMs();
    S.drinkTaps = m.taps || [];
    // the guest only knows the day, so the run has to come down the wire or
    // the two kitchens are laid out differently and the taps miss
    S.runSeed = m.seed || 0;
    S.board = m.board
      ? { id: m.board.id, cut: m.board.cut, portions: m.board.p, working: !!m.board.w,
          wet: m.board.wet, juice: m.board.j }
      : null;

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
      tk.side = t.sd || null;
      tk.drink = t.dr || null;
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
      if (!S.musicOff) Bgm.start();
      hideModal(el.start);
      S.day = 1; S.money = 0; S.levels = {}; S.bestDay = 1;
      S.runSeed = Core.newRunSeed();   // a new run, a new kitchen
      wipe();          // S.owned and S.skin survive on purpose - they were paid for
      startDay(1);
    });
    el.continueBtn.addEventListener('click', function () {
      Sfx.init();
      if (!S.musicOff) Bgm.start();
      hideModal(el.start);
      startDay(S.day);
    });
    el.dayEndBtn.addEventListener('click', function () {
      hideModal(el.dayEnd);
      S.screen = 'shop';
      // Show first, paint second: a drawn screen measures its own canvas, and
      // a hidden modal measures zero - which silently skips the paint AND the
      // button placement, leaving the whole slip untappable.
      showModal(el.shop);
      renderShop();
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
      S.runSeed = Core.newRunSeed();   // a new run, a new kitchen   // not S.owned
      hideModal(el.over);
      startDay(1);
    });
    el.shopStoreBtn.addEventListener('click', openStore);
    el.storeClose.addEventListener('click', function () { hideModal(el.store); });
    el.storeRestore.addEventListener('click', restorePurchases);
    el.storeTabs.addEventListener('change', function (e) {
      storeTab = (e.target && e.target.value) || 'style';
      renderStore();
    });

    el.pauseBtn.addEventListener('click', function () { setPaused(true); });
    el.resumeBtn.addEventListener('click', function () { setPaused(false); });
    el.restartBtn.addEventListener('click', function () {
      setPaused(false);
      startDay(S.day);
    });
    el.quitBtn.addEventListener('click', quitToTitle);
    /*
     * The two switches on the pause slip. They used to be one: muting the
     * sound stopped the backing track with it and there was no way to keep
     * one without the other. The handoff draws them as separate boxes, and
     * separate is what they should always have been.
     */
    el.pauseSoundBtn.addEventListener('click', function () {
      S.muted = !S.muted;
      Sfx.setMuted(S.muted);
      if (S.muted) Bgm.stop();
      save();
      paintPause();
    });
    el.pauseMusicBtn.addEventListener('click', function () {
      S.musicOff = !S.musicOff;
      Bgm.stop();                    // the slip is up, so it starts again on resume
      save();
      paintPause();
    });

    /* --- leaderboard / account / co-op */
    el.howBtn.addEventListener('click', function () { showModal(el.how); });
    el.howBtn2.addEventListener('click', function () { showModal(el.how); });
    el.howClose.addEventListener('click', function () { hideModal(el.how); });
    el.boardBtn.addEventListener('click', showLeaderboard);
    el.lbClose.addEventListener('click', function () { hideModal(el.leaderboard); });
    el.accountBtn.addEventListener('click', showAccount);

    // every keystroke lands in a box the pen drew, so both fields repaint
    el.nameInput.addEventListener('input', paintAccount);
    el.claimInput.addEventListener('input', function () {
      var v = (el.claimInput.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (v !== el.claimInput.value) el.claimInput.value = v;
      paintAccount();
    });
    el.accountClose.addEventListener('click', function () {
      acctTick(false);
      hideModal(el.account);
    });

    el.nameSave.addEventListener('click', function () {
      var name = (el.nameInput.value || '').trim().slice(0, 16) || 'Cook';
      note('Saving…');
      Net.setName(name).then(function (ok) {
        setNetState();
        note(ok ? 'Saved as ' + Net.name + '.' : 'Saved on this device only.');
      });
    });

    el.makeCodeBtn.addEventListener('click', function () {
      note('');
      Net.makeCode().then(function (code) {
        if (!code) { note('Could not get a code.'); return; }
        acct.code = code;
        acct.at = nowMs();
        note('Type it on the other phone within ten minutes.');
        acctTick(true);
      });
    });

    el.claimBtn.addEventListener('click', function () {
      var code = (el.claimInput.value || '').trim().toUpperCase();
      if (code.length < 4) { note('Enter the code first.'); return; }
      note('Loading…');
      Net.claim(code).then(function (res) {
        if (res.error) { note(res.error); return; }
        // Through the same door as every other save. This one arrives over the
        // network rather than off disk, which is more reason to run it through
        // the rules, not less - and it now carries entitlements.
        var claimed = res.save && Core.sanitiseSave(res.save);
        if (claimed) {
          S.day = claimed.day;
          S.bestDay = claimed.bestDay || S.day;
          S.money = claimed.money || 0;
          S.levels = claimed.levels || {};
          S.owned = claimed.owned || [];
          S.skin = claimed.skin || 'classic';
          S.lifetime = Math.max(S.lifetime || 0, claimed.lifetime || 0);
          S.fx = Core.effects(activeLevels(), S.day);
          save();
          S.saved = true;
          el.continueDay.textContent = S.day;
          paintTitle();
        }
        setNetState();
        note('Loaded ' + (res.name || 'that save') +
             (res.save ? ' — day ' + (res.save.day || 1) + '.' : ' (no save on it yet).'));
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
      if (!S.userPaused && S.screen !== 'title' && !S.musicOff) Bgm.start();
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

    /*
     * The title is a scene now, not a still: the bulb swings, the fries
     * steam and the cook breathes. Fifteen frames a second is plenty for
     * all three and leaves the phone alone.
     */
    if (el.start && el.start.classList.contains('show') && ts - titleFrame > 66) {
      titleFrame = ts;
      paintTitle();
    }
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

    ['hudArt', 'hudRead', 'boardArt', 'boardRead', 'pauseBtn',
      'pause', 'pauseSoundBtn',
      'resumeBtn', 'restartBtn', 'quitBtn',
      'start', 'playBtn', 'continueBtn', 'continueDay',
      'dayEnd', 'dayEndBtn',
      'titleArt', 'signArt', 'rotate', 'rotateArt', 'coopBtn', 'netState', 'boardBtn', 'accountBtn',
      'howBtn', 'howBtn2', 'how', 'howClose',
      'leaderboard', 'lbArt', 'lbNote', 'lbClose',
      'account', 'acctArt', 'nameInput', 'nameSave', 'makeCodeBtn',
      'claimInput', 'claimBtn', 'accountNote', 'accountClose',
      'coop', 'hostBtn', 'roomOut', 'joinInput', 'joinBtn', 'coopNote', 'coopClose',
      'store', 'storeTabs', 'storeList', 'storeNote', 'storeRestore', 'storeClose',
      'shopStoreBtn', 'shop', 'shopArt', 'shopRead', 'shopBuys', 'nextDayBtn',
      'dayEndArt', 'dayEndRead', 'pauseArt', 'pauseRead', 'pauseMusicBtn',
      'over', 'overTitle', 'overReason', 'overDay',
      'overBest', 'retryBtn', 'retryDay', 'wipeBtn'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    var saved = load();
    if (saved) {
      S.day = saved.day;
      S.bestDay = saved.bestDay || saved.day;
      S.money = saved.money || 0;
      S.levels = saved.levels || {};
      S.owned = saved.owned || [];
      S.skin = saved.skin || 'classic';
      S.muted = !!saved.muted;
      S.musicOff = !!saved.musicOff;
      S.runSeed = saved.runSeed || 0;
      S.lifetime = saved.lifetime || 0;
      S.fx = Core.effects(activeLevels(), S.day);
      S.saved = true;
      el.continueDay.textContent = saved.day;
    }
    // Size the board for the shift the player is about to resume, not for day
    // one - otherwise it resizes behind the title sheet as that sheet fades.
    reserveBoard(S.day || 1);
    paintTitle();
    Sfx.setMuted(S.muted);

    S.menu = Core.dayMenu(S.day, S.runSeed);
    S.sections = Core.menuSections(S.day, S.runSeed);
    for (var i = 0; i < S.fx.plates; i++) S.plates.push({ stack: [], side: null, drink: null });
    S.grill = new Array(S.fx.grillSlots).fill(null);
    S.fryer = S.day >= Core.SIDE_DAY ? [null, null] : [];
    /*
     * The prep table is only in the room on a day that stocks something to
     * put on it. Day 1 has bun and patty and nothing else, so a board there is
     * a station you cannot use standing in the middle of the walking lane -
     * the same reason the fryer and the fountain wait for their own days.
     */
    S.board = (S.menu || []).some(function (id) {
      var g = Core.byId(id);
      return g && g.chop;
    }) ? { id: null, cut: 0, portions: 0, wet: 0, juice: null } : null;
    S.drinkTaps = Core.drinkMenu(S.day);
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
        // Purchases merge rather than replace: a device that bought a skin
        // offline must not lose it to a cloud save that predates the sale.
        (cloud.owned || []).forEach(function (id) {
          if (S.owned.indexOf(id) < 0) S.owned.push(id);
        });
        S.lifetime = Math.max(S.lifetime || 0, cloud.lifetime);
        S.fx = Core.effects(activeLevels(), S.day);
        save();
        S.saved = true;
        el.continueDay.textContent = S.day;
        paintTitle();
      });
    }).catch(function () { setNetState(); });
  }

  // Exposed for the smoke test and for poking at a live shift in DevTools.
  window.MrBurger = {
    state: S, layout: L,
    startDay: startDay, spawnTicket: spawnTicket, endDay: endDay,
    renderBoard: renderBoard, reserveBoard: reserveBoard, orderRows: orderRows,
    syncHud: syncHud, resize: resize,
    chopCurve: chopCurve, drawPrepBoard: drawPrepBoard, drawCarried: drawCarried,
    drawPlates: drawPlates, drawGrill: drawGrill, drawSet: drawSet, setExtras: setExtras,
    dispenserView: dispenserView, freezerPose: freezerPose, drawFryStation: drawFryStation,
    tapColRect: tapColRect, tapColAt: tapColAt, freezerRect: freezerRect,
    drawFountain: drawFountain,
    showLeaderboard: showLeaderboard, showAccount: showAccount, lbMap: lbMap,
    paintAccount: paintAccount, accountNote: function () { return acct.note; },
    drawTraySet: drawTraySet,
    sendChef: sendChef, arrive: arrive, deliver: deliver,
    stationAt: stationAt, standPoint: standPoint,
    setPaused: setPaused, quitToTitle: quitToTitle,
    snapshot: snapshot, applySnapshot: applySnapshot,
    packHold: packHold, unpackHold: unpackHold, onCoopMessage: onCoopMessage,
    leaveCoop: endCoop, endCoop: endCoop, chefAt: chefAt,
    _setClock: function (fn) { clockFn = fn; },
    enterRoom: enterRoom, connectRoom: connectRoom,
    crateRect: crateRect, slotRect: slotRect, plateRect: plateRect,
    hatchRect: hatchRect, binRect: binRect,
    fryerRect: fryerRect, fryWellRect: fryWellRect, tapRect: tapRect,
    boardRect: boardRect,
    nextDrinkWanted: nextDrinkWanted,
    buyUpgrade: buyUpgrade, ticketOf: ticketOf
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();









