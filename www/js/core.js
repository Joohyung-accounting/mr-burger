/*
 * Mr. Burger - core rules engine.
 * Pure logic, zero DOM. Runs in the browser (window.Core) and in Node (require),
 * so the whole economy can be simulated and balance-tested offline.
 *
 * Money is stored in cents everywhere. Format at the edges, never in here.
 *
 * An order is a MULTISET of fillings - what goes in the burger, not what order
 * it is stacked in. The buns are implied. The difficulty lives in the kitchen
 * (walking, grill timing, juggling tickets), not in memorising a sequence.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function seeded(s) {
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ------------------------------------------------------------ pantry */
  /*
   * group  - which section of the line the crate stands in
   * kind   - what it is on the burger (drives sauce sounds, cook scoring, ...)
   * grill  - has to be cooked before it can go on a plate
   *
   * 'bun' is a real ingredient with a real crate: a burger served without one
   * is a naked pile of fillings, and it looks like one on the plate.
   */
  // `short` is what fits on the front of a box when the whole line is one row.
  /*
   * `swatch` is the one colour that stands for an ingredient away from the
   * burger - the chip beside its name on a ticket, and its tint in the crate
   * label. A cross-section two pixels tall cannot carry identity, so the
   * ticket names what it wants and the swatch is what you scan for; these are
   * deliberately pushed apart from each other rather than being the average
   * colour of the artwork.
   */
  var INGREDIENTS = [
    { id: 'bun', name: 'Bun', short: 'Bun', group: 'base', kind: 'bun', price: 90, day: 1, swatch: '#e1af88' },
    { id: 'patty', name: 'Beef Patty', short: 'Patty', group: 'base', kind: 'patty', price: 220, day: 1, grill: true, swatch: '#8c5a3e' },

    // The line has one spare crate on day 2, and ties on unlock day are broken
    // by this order - so lettuce is the first thing the player learns to add.
    { id: 'lettuce', name: 'Lettuce', short: 'Lettuce', group: 'topping', kind: 'topping', chop: true, price: 40, day: 1, swatch: '#93d33d' },
    { id: 'cheese', name: 'Cheese', short: 'Cheese', group: 'topping', kind: 'topping', price: 70, day: 1, swatch: '#ff8e1d' },
    { id: 'tomato', name: 'Tomato', short: 'Tomato', group: 'topping', kind: 'topping', chop: true, price: 50, day: 3, swatch: '#ff3e51' },
    { id: 'onion', name: 'Onion', short: 'Onion', group: 'topping', kind: 'topping', chop: true, price: 40, day: 4, swatch: '#bc9acd' },
    { id: 'pickle', name: 'Pickles', short: 'Pickle', group: 'topping', kind: 'topping', chop: true, price: 45, day: 6, swatch: '#6b7e21' },
    { id: 'bacon', name: 'Bacon', short: 'Bacon', group: 'topping', kind: 'topping', price: 130, day: 7, swatch: '#df6e73' },
    { id: 'jalapeno', name: 'Jalapeño', short: 'Chilli', group: 'topping', kind: 'topping', chop: true, price: 55, day: 9, swatch: '#37a954' },
    { id: 'egg', name: 'Fried Egg', short: 'Egg', group: 'topping', kind: 'topping', price: 90, day: 11, swatch: '#f6c158' },
    { id: 'avocado', name: 'Avocado', short: 'Avo', group: 'topping', kind: 'topping', price: 110, day: 12, swatch: '#e0e89b' },

    { id: 'ketchup', name: 'Ketchup', short: 'Ketchup', group: 'sauce', kind: 'sauce', price: 25, day: 2, swatch: '#9b200f' },
    { id: 'mustard', name: 'Mustard', short: 'Mustard', group: 'sauce', kind: 'sauce', price: 25, day: 5, swatch: '#d7cf00' },
    { id: 'mayo', name: 'Mayo', short: 'Mayo', group: 'sauce', kind: 'sauce', price: 30, day: 8, swatch: '#eeece9' },
    { id: 'bbq', name: 'BBQ Sauce', short: 'BBQ', group: 'sauce', kind: 'sauce', price: 35, day: 10, swatch: '#341e11' }
  ];

  /** The sections the kitchen line is divided into, in display order. */
  var GROUPS = [
    { id: 'base', label: 'BUNS & PATTIES' },
    { id: 'topping', label: 'TOPPINGS' },
    { id: 'sauce', label: 'SAUCES' }
  ];

  var BY_ID = {};
  INGREDIENTS.forEach(function (i) { BY_ID[i.id] = i; });
  function byId(id) { return BY_ID[id]; }

  function unlockedAt(day) {
    return INGREDIENTS.filter(function (i) { return i.day <= day; });
  }

  function unlockedOn(day) {
    return INGREDIENTS.filter(function (i) { return i.day === day; });
  }

  /* --------------------------------------------------------- day setup */
  function dayConfig(day) {
    var shelf = extrasOnShelf(day);
    return {
      day: day,
      /*
       * Fewer, richer tickets. A tray with fries and a drink on it is three
       * more station visits than a burger alone, and the shift clock did not
       * move - at the old count day 15 needed 207s of walking against a 175s
       * clock. Twenty-five per cent fewer customers, each worth about half
       * again as much, lands the rent within a few dollars of where it was
       * and hands the walking budget back.
       */
      customers: Math.min(4 + Math.floor(day * 0.7), 12),
      patience: Math.max(30, 62 - day * 1.4),          // seconds, before upgrades
      /*
       * The first days used to open at six to ten seconds between customers,
       * which on a seventy-second clock is half the shift spent watching an
       * empty hatch. The curve starts about a third tighter now and lands in
       * the same place from day 8 on, so learning the job is done by cooking
       * rather than by waiting for something to cook.
       */
      spawnMin: Math.max(2.3, 5.0 - day * 0.26),
      spawnMax: Math.max(4.0, 7.6 - day * 0.44),
      // Extras are everything past the bun and the first patty. Never fewer
      // than one once the line stocks anything, or the new crate is decoration.
      minExtras: Math.min(Math.floor(day / 5), 3, shelf),
      maxExtras: Math.min(Math.max(1, Math.floor(day / 2.2)), shelf, 4),
      concurrent: Math.min(2 + Math.floor(day / 3), 4)   // tickets on the board
    };
  }

  /**
   * The crates that are out on the line today. A kitchen with sixteen crates is
   * unreadable, so each day runs a rotating subset - the patty plus a handful of
   * whatever is unlocked. Deterministic per day.
   */
  // 2 base crates + up to 6 rotating. Past this the line needs a fourth shelf
  // and the stations start losing the height they need on a small phone.
  var MENU_MAX = 8;
  var menuCache = {};

  /*
   * The highest day the game will reckon with. Everything above day 24 is
   * identical anyway, and the server clamps a claimed best day to the same
   * number - so this is a bound on nonsense, not on play.
   */
  var MAX_DAY = 999;

  /**
   * How many crates past the bun and the patty the line stocks on a given day.
   * dayConfig reads this too, so the shelf and the order book cannot disagree -
   * they used to, and day 2 stocked lettuce that no order could ever ask for.
   */
  function extrasOnShelf(day) {
    return clamp(Math.floor(day / 2), 0, MENU_MAX - 2);
  }

  /**
   * Everything that has been stocked on any day before this one.
   *
   * Built forward and cached, so the walk is done once per day across a whole
   * run rather than recursively per lookup - dayGoal already asks for every day
   * in order, and this rides along with it.
   */
  var seenCache = { 0: {} };
  function stockedBefore(day) {
    if (day < 1) return {};
    if (seenCache[day]) return seenCache[day];
    var from = day;
    while (from > 1 && !seenCache[from - 1]) from--;
    for (var d = from; d <= day; d++) {
      if (seenCache[d]) continue;
      var acc = {}, prev = seenCache[d - 1] || {};
      for (var k in prev) acc[k] = true;
      dayMenu(d - 1).forEach(function (id) { acc[id] = true; });
      seenCache[d] = acc;
    }
    return seenCache[day];
  }

  function dayMenu(day, seed) {
    var run = (day >= 2) ? (Math.floor(Number(seed) || 0) | 0) : 0;
    var key = day + (run ? ":" + run : "");
    if (menuCache[key]) return menuCache[key];
    var rng = seeded(day * 2654435761 + 7 + Math.imul(run, 2654435761));
    var pool = unlockedAt(day);
    var toppings = pool.filter(function (i) { return i.group === 'topping'; });
    var sauces = pool.filter(function (i) { return i.group === 'sauce'; });

    var size = extrasOnShelf(day);
    var wantSauce = (size >= 2 && sauces.length) ? clamp(Math.round(size * 0.35), 1, sauces.length) : 0;
    var wantTop = Math.min(size - wantSauce, toppings.length);
    wantSauce = Math.min(size - wantTop, sauces.length);

    /*
     * Three tiers, then shuffle what is left.
     *
     * Whatever unlocked today goes out today - the shop announces it the
     * evening before under "NEW ON THE MENU", and it read as a lie when the
     * shuffle left it in the back for another day. Then anything that has never
     * been on the line at all: the shelf has no room on day 1, so cheese used
     * to unlock with the tutorial and not turn up until day 8. Everything the
     * player has already met rotates as before, which is what keeps a run from
     * looking the same every night.
     */
    var everSeen = stockedBefore(day);
    function take(list, n) {
      var fresh = [], unseen = [], rest = [];
      list.forEach(function (i) {
        if (i.day === day) fresh.push(i);
        else if (!everSeen[i.id]) unseen.push(i);
        else rest.push(i);
      });
      unseen.sort(function (a, b) { return a.day - b.day; });
      return fresh.concat(unseen, shuffle(rest, rng)).slice(0, n)
        .sort(function (a, b) { return a.day - b.day; })
        .map(function (i) { return i.id; });
    }

    var menu = ['bun', 'patty'].concat(take(toppings, wantTop), take(sauces, wantSauce));
    menuCache[key] = menu;
    return menu;
  }

  /** The day's crates split into the sections the kitchen line is drawn in. */
  function menuSections(day, seed) {
    var menu = dayMenu(day, seed);
    return GROUPS.map(function (g) {
      return {
        id: g.id,
        label: g.label,
        ids: menu.filter(function (id) { return BY_ID[id].group === g.id; })
      };
    }).filter(function (s) { return s.ids.length > 0; });
  }

  /* ------------------------------------------------------------ orders */
  /** A ticket: a multiset of ingredient ids. Every burger is a bun and a patty. */
  /* ------------------------------------------------------ the other half
   * Fries and a drink ride on the tray beside the burger. They are NOT in
   * `items`: that array is the multiset evaluate() scores the built stack
   * against, and anything in it that never lands on the plate counts as a
   * missing ingredient. They get their own fields, and their own check.
   */
  // TRAY_SIDES, not SIDES: the room already has  for
  // which wall the grill is on, and var hoists to function scope - so naming
  // this SIDES silently replaced it with an array and every fries lookup
  // became undefined. Nothing threw; the side just stopped existing.
  var TRAY_SIDES = {
    fries: { id: 'fries', name: 'Fries', short: 'FRIES', swatch: '#e8a021', price: 150, day: 5 }
  };

  // The six the fountain pours, in the order Art.FLAVOR_IDS draws them.
  var DRINKS = [
    { id: 'cola', name: 'Cola', short: 'COLA', swatch: '#4a2c1e', price: 110, day: 3 },
    { id: 'cider', name: 'Cider', short: 'CIDER', swatch: '#d9a441', price: 110, day: 3 },
    { id: 'orange', name: 'Orange', short: 'ORANGE', swatch: '#e2711d', price: 110, day: 3 },
    { id: 'lemon', name: 'Lemon', short: 'LEMON', swatch: '#e8d44d', price: 110, day: 3 },
    { id: 'root', name: 'Root Beer', short: 'ROOT', swatch: '#5b3a2b', price: 110, day: 3 },
    { id: 'tea', name: 'Iced Tea', short: 'ICE TEA', swatch: '#a8622a', price: 110, day: 3 }
  ];
  var DRINK_BY_ID = {};
  DRINKS.forEach(function (d) { DRINK_BY_ID[d.id] = d; });

  var SIDE_DAY = 5, DRINK_DAY = 3;

  /**
   * How often an order asks for each, by day. It ramps rather than switching
   * on: the shift that introduces fries should not be the shift where every
   * ticket needs them.
   */
  function attachRates(day) {
    return {
      side: day < SIDE_DAY ? 0 : Math.min(0.70, 0.25 + (day - SIDE_DAY) * 0.045),
      drink: day < DRINK_DAY ? 0 : Math.min(0.75, 0.30 + (day - DRINK_DAY) * 0.040)
    };
  }

  /** Which drinks the fountain is plumbed for today - two, then all six. */
  function drinkMenu(day) {
    if (day < DRINK_DAY) return [];
    return DRINKS.slice(0, clamp(2 + Math.floor((day - DRINK_DAY) / 3), 2, DRINKS.length))
      .map(function (d) { return d.id; });
  }

  /*
   *  is the run, and it only reaches the SHELF - sampleGoal deliberately
   * calls this without one. Rent is a published curve that a player can learn
   * and a leaderboard can compare; pricing it off a basket that rerolls every
   * run would make the same day cost different money on different attempts.
   * The run varies which crates are out, not what the landlord wants.
   */
  function makeOrder(day, rng, customer, seed) {
    rng = rng || Math.random;
    var cfg = dayConfig(day);
    var extras = dayMenu(day, seed).filter(function (id) {
      return id !== 'bun' && id !== 'patty';
    });

    var maxExtras = cfg.maxExtras;
    var minExtras = cfg.minExtras;
    if (customer && customer.simple) {               // kids keep it easy
      maxExtras = Math.min(maxExtras, 1);
      minExtras = Math.min(minExtras, maxExtras);
    }
    var count = minExtras + Math.floor(rng() * (maxExtras - minExtras + 1));

    var items = ['bun', 'patty'];
    if (day >= 8 && count >= 2 && rng() < 0.25) items.push('patty');

    var pool = shuffle(extras.slice(), rng);
    for (var i = 0; i < count && i < pool.length; i++) items.push(pool[i]);

    var rates = attachRates(day);
    var side = rng() < rates.side ? 'fries' : null;
    var taps = drinkMenu(day);
    var drink = (taps.length && rng() < rates.drink)
      ? taps[Math.floor(rng() * taps.length)] : null;

    return { items: items, side: side, drink: drink };
  }

  /**
   * What an order is worth. sampleGoal() runs this over real orders to set the
   * rent, so the tray's other half has to be priced here or every day's rent
   * would be set as though nobody ever ordered fries.
   */
  function menuPrice(items, side, drink) {
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var ing = BY_ID[items[i]];
      if (ing) sum += ing.price;
    }
    if (side && TRAY_SIDES[side]) sum += TRAY_SIDES[side].price;
    if (drink && DRINK_BY_ID[drink]) sum += DRINK_BY_ID[drink].price;
    return sum;
  }

  /**
   * The tray's other half, checked. evaluate() owns the burger and never sees
   * these; this owns these and never sees the burger.
   *   checkExtras({side, drink}, {side, drink}) -> { faults, ok, asked }
   */
  function checkExtras(want, got) {
    want = want || {}; got = got || {};
    var faults = [], asked = 0, ok = 0;
    // Total by construction: a ticket carrying an id this build has never heard
    // of must score as "no side asked for", not throw inside the delivery.
    var wantSide = TRAY_SIDES[want.side] ? want.side : null;
    var wantDrink = DRINK_BY_ID[want.drink] ? want.drink : null;

    if (wantSide) {
      asked++;
      if (got.side === wantSide) ok++;
      else faults.push({ kind: 'side', label: 'NO ' + TRAY_SIDES[wantSide].short });
    } else if (got.side) {
      faults.push({ kind: 'side', label: 'FRIES NOBODY ORDERED' });
    }
    if (wantDrink) {
      asked++;
      if (got.drink === wantDrink) ok++;
      else if (got.drink) {
        faults.push({ kind: 'drink', label: 'WRONG DRINK' });
      } else {
        faults.push({ kind: 'drink', label: 'NO ' + DRINK_BY_ID[wantDrink].short });
      }
    } else if (got.drink) {
      faults.push({ kind: 'drink', label: 'A DRINK NOBODY ORDERED' });
    }
    return { faults: faults, ok: ok, asked: asked };
  }

  /**
   * Turn a ticket or a plate into the layer list the art code draws.
   * No bun on it means no bun around it - a naked pile is exactly what the
   * player should see when they forgot one.
   */
  function displayStack(items) {
    var hasBun = false, fillings = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var id = typeof it === 'string' ? it : it.id;
      if (id === 'bun') { hasBun = true; continue; }
      fillings.push(it);
    }
    return hasBun ? ['bunBottom'].concat(fillings, ['bunTop']) : fillings;
  }

  /* --------------------------------------------------------- customers */
  var CUSTOMERS = [
    { id: 'regular', name: 'Regular', patience: 1.00, tip: 1.0, weight: 5 },
    { id: 'rush', name: 'Rush', patience: 0.75, tip: 1.6, weight: 3 },
    { id: 'chill', name: 'Chill', patience: 1.45, tip: 0.8, weight: 3 },
    { id: 'foodie', name: 'Foodie', patience: 1.05, tip: 2.2, weight: 2, strict: true },
    { id: 'kid', name: 'Kid', patience: 1.25, tip: 0.6, weight: 3, simple: true }
  ];

  function pickCustomer(day, rng) {
    rng = rng || Math.random;
    var pool = CUSTOMERS.filter(function (c) {
      if (c.id === 'rush' && day < 4) return false;
      if (c.id === 'foodie' && day < 6) return false;
      return true;
    });
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].weight;
    var t = rng() * total;
    for (i = 0; i < pool.length; i++) {
      t -= pool[i].weight;
      if (t <= 0) return pool[i];
    }
    return pool[0];
  }

  /* --------------------------------------------------------- the grill */
  /*
   * Where the sweet spot sits along a patty's life.
   *
   * A patty runs raw -> perfect -> ruined, and the thing a player feels is not
   * either number below but the RATIO between them: how far into the cook the
   * window opens. It used to open at 36% and close at 49%, so the perfect
   * moment was a little under halfway and most of a patty's life was spent
   * slowly turning to charcoal - you learned to grab it early and the back
   * half of the timeline taught you nothing.
   *
   * Now the window is three quarters of the way along. Same total life, same
   * 1.6s of window, so the precision the game asks for has not changed: what
   * changed is that waiting is the skill and being late is punished quickly,
   * rather than the reverse.
   *
   *   raw ............................ perfect .... ruined
   *   0s                          8.0s   8.8s  9.6s      11.8s
   *   0%                           68%    75%   81%       100%
   */
  /*
   * The grill's clock, and the one constraint that is not obvious: the perfect
   * moment has to sit about three quarters of the way through the patty's
   * whole life, or the sweet spot arrives while the player is still walking
   * over and the rest of the cook is dead time.
   *
   * Pushing the burnt verdict later therefore cannot be done on BURN_TIME
   * alone - that stretches only the tail and drags the sweet spot back to the
   * halfway point this was moved away from. The cook lengthens with it, and
   * the pair is solved rather than guessed: with the verdict at
   * COOK_TIME + w/2 + BURN_TIME/2 and the sweet spot pinned at 75% of
   * COOK_TIME + w/2 + BURN_TIME, asking for a verdict at time T gives
   * COOK_TIME = (T - w/4) * 6/7 and BURN_TIME = COOK_TIME/3 - w/2.
   *
   * The verdict has moved twice by request: 10.7s -> 13.7s -> 16.7s, and the
   * green has now been pulled forward on top of that, from 14.0s to 12.5s.
   * Those two pull in opposite directions, so the 75% rule has given way: the
   * sweet spot sits at 62% of a 20.1s life, with the green at 11.7-13.3s and
   * the verdict still at 16.7s. That is a 3.4s band of overcooked-but-servable
   * after the green closes, which is where the forgiveness now lives.
   *
   * The rule that remains is the one the 75% was protecting: the sweet spot
   * must not land in the first half of the cook, or it arrives while the
   * player is still walking over and the rest of the patty's life is dead.
   *
   * The fry wells read the same curve, so a basket gets the same grace.
   */
  var COOK_TIME = 12.5;  // seconds to the middle of the perfect zone
  var BURN_TIME = 6.8;   // seconds from leaving the zone to fully ruined
  var TIP_RATE = 0.70;   // tip ceiling as a fraction of the ticket
  var BASE_WINDOW = 1.6; // seconds of perfect zone before upgrades
  var EXTRA_PENALTY = 0.20; // accuracy lost per unwanted filling on the plate

  function cookQuality(t, window) {
    window = window || BASE_WINDOW;
    var start = COOK_TIME - window / 2;
    var end = COOK_TIME + window / 2;
    if (t <= 0) return 0.3;
    if (t < start) return 0.3 + 0.7 * (t / start);
    if (t <= end) return 1;
    return Math.max(0.3, 1 - ((t - end) / BURN_TIME) * 0.7);
  }

  /**
   * How a patty should LOOK, as opposed to what it scores.
   *
   * `cookQuality` dips again once a patty passes the window, so driving colour
   * from it would make a burnt patty fade back to raw. Doneness here only ever
   * climbs, and charring is tracked separately.
   *
   *   done: 0 = raw beef, 1 = properly seared
   *   char: 0 = none,     1 = written off
   */
  function cookLook(t, window) {
    window = window || BASE_WINDOW;
    var searedAt = Math.max(0.1, COOK_TIME - window / 2);
    var end = COOK_TIME + window / 2;
    return {
      done: clamp(t / searedAt, 0, 1),
      char: t <= end ? 0 : clamp((t - end) / BURN_TIME, 0, 1)
    };
  }

  function cookStage(t, window) {
    window = window || BASE_WINDOW;
    var start = COOK_TIME - window / 2;
    var end = COOK_TIME + window / 2;
    if (t < start) return 'raw';
    if (t <= end) return 'perfect';
    if (t <= end + BURN_TIME * 0.5) return 'over';
    return 'burnt';
  }

  /* -------------------------------------------------------- evaluation */
  function countOf(ids) {
    var m = {};
    for (var i = 0; i < ids.length; i++) m[ids[i]] = (m[ids[i]] || 0) + 1;
    return m;
  }

  /* ------------------------------------------------------------- faults */
  /*
   * Every way a plate can be wrong, priced in quality. Serving raw or burnt
   * meat costs enough on its own to drop a burger under the reject line -
   * a customer sends those back no matter how good the toppings were.
   */
  var FAULT = {
    missing: { label: 'MISSING SOMETHING', cost: null },   // proportional
    extra: { label: 'STUFF I DIDN\'T ORDER', cost: EXTRA_PENALTY },
    underdone: { label: 'UNDERCOOKED', cost: 0.18 },
    overdone: { label: 'OVERCOOKED', cost: 0.18 },
    raw: { label: 'THAT PATTY IS RAW', cost: 0.55 },
    burnt: { label: 'THAT PATTY IS BURNT', cost: 0.55 },
    // the vegetables' version of `raw`: it skipped the board
    whole: { label: 'THAT ISN\'T CHOPPED', cost: 0.55 }
  };

  function faultLabel(code) {
    return (FAULT[code] && FAULT[code].label) || code;
  }

  /** What is wrong with one grilled item, if anything. */
  function cookFault(item) {
    var ing = BY_ID[item.id];
    if (!ing || !ing.grill) return null;
    var char = item.char || 0;
    var cook = typeof item.cook === 'number' ? item.cook : 1;
    if (char >= 0.35) return 'burnt';
    if (cook >= 0.85) return null;
    if (char > 0) return 'overdone';
    if (cook < 0.5) return 'raw';
    return 'underdone';
  }

  /**
   * Compare a built burger against a ticket, ignoring stacking order.
   * `built` is [{id, cook, char}] - cook is 0..1 scoring quality, char is how
   * far past the window it went.
   *
   * Returns an itemised fault list rather than one opaque number, so the game
   * can tell the player exactly what came back at them.
   */
  function evaluate(orderItems, built) {
    var builtIds = built.map(function (b) { return b.id; });
    var need = countOf(orderItems), have = countOf(builtIds);

    var matched = 0;
    for (var id in need) {
      if (Object.prototype.hasOwnProperty.call(need, id)) {
        matched += Math.min(need[id], have[id] || 0);
      }
    }
    /*
     * Score what the customer asked for, then dock a flat penalty per piece of
     * junk on the plate. Dividing by max(order, built) instead made one stray
     * ingredient fatal on a one-item ticket but survivable on a five-item one,
     * so day 1 punished mistakes harder than day 20 did.
     */
    var missing = Math.max(0, orderItems.length - matched);
    var extras = Math.max(0, builtIds.length - matched);
    var base = orderItems.length === 0 ? 0 : matched / orderItems.length;
    var accuracy = clamp(base - extras * FAULT.extra.cost, 0, 1);
    var exact = matched === orderItems.length && builtIds.length === orderItems.length;

    var faults = [];
    if (missing) {
      faults.push({
        code: 'missing', label: FAULT.missing.label, count: missing,
        cost: missing / orderItems.length
      });
    }
    if (extras) {
      faults.push({
        code: 'extra', label: FAULT.extra.label, count: extras,
        cost: extras * FAULT.extra.cost
      });
    }

    var cookPenalty = 0, tally = {}, i, f;
    var cooked = [];
    for (i = 0; i < built.length; i++) {
      var ing = BY_ID[built[i].id];
      if (!ing) continue;
      /*
       * The backstop the patty has always had, finally given to the
       * vegetables. The plate refuses an unchopped one, so in ordinary play
       * this never fires - it is here so that a hole in that gate costs the
       * player a score rather than passing silently.
       *
       * Explicitly false, not falsy: a stack saved before plates carried the
       * flag has `undefined`, and old saves should not be punished for it.
       */
      if (ing.chop && built[i].prepped === false) {
        tally.whole = (tally.whole || 0) + 1;
        cookPenalty += FAULT.whole.cost;
      }
      if (!ing.grill) continue;
      cooked.push(built[i]);
      f = cookFault(built[i]);
      if (f) {
        tally[f] = (tally[f] || 0) + 1;
        cookPenalty += FAULT[f].cost;
      }
    }
    Object.keys(tally).forEach(function (code) {
      faults.push({ code: code, label: FAULT[code].label, count: tally[code], cost: tally[code] * FAULT[code].cost });
    });

    var cookScore = 1;
    if (cooked.length) {
      cookScore = cooked.reduce(function (s, b) {
        return s + (typeof b.cook === 'number' ? b.cook : 1);
      }, 0) / cooked.length;
    }

    // Fillings set the ceiling; a badly cooked patty comes straight off the top.
    var quality = clamp(accuracy - cookPenalty, 0, 1);
    faults.sort(function (a, b) { return b.cost - a.cost; });

    return {
      exact: exact, accuracy: accuracy, cookScore: cookScore,
      quality: quality, matched: matched, faults: faults
    };
  }

  function verdictOf(ev) {
    if (ev.exact && ev.cookScore >= 0.995) return 'perfect';
    if (ev.quality >= 0.85) return 'great';
    if (ev.quality >= 0.65) return 'good';
    if (ev.quality >= 0.48) return 'meh';
    return 'bad';
  }

  /**
   * Which waiting ticket does this plate belong to? The serving hatch matches
   * automatically, the way Overcooked does - no pinning ceremony.
   */
  function bestMatch(tickets, built) {
    var best = null, bestQ = -1;
    for (var i = 0; i < tickets.length; i++) {
      var ev = evaluate(tickets[i].items, built);
      if (ev.quality > bestQ) { bestQ = ev.quality; best = tickets[i]; }
    }
    return best;
  }

  /** opts: { orderItems, built, patienceRatio, customer, tipMult } */
  function payout(opts) {
    var price = menuPrice(opts.orderItems);
    var ev = evaluate(opts.orderItems, opts.built);
    var verdict = verdictOf(ev);

    if (verdict === 'bad') {
      return {
        verdict: verdict, pay: 0, tip: 0, total: 0, heartLoss: 1,
        accuracy: ev.accuracy, cookScore: ev.cookScore, quality: ev.quality,
        exact: ev.exact, faults: ev.faults
      };
    }

    var patience = clamp(opts.patienceRatio === undefined ? 1 : opts.patienceRatio, 0, 1);
    var pay = Math.round(price * ev.quality);
    var tip = price * TIP_RATE * ev.quality * ev.quality * patience;
    tip *= (opts.customer && opts.customer.tip) || 1;
    tip *= opts.tipMult || 1;
    if (opts.customer && opts.customer.strict && !ev.exact) tip *= 0.3;
    if (verdict === 'perfect') tip *= 1.25;
    tip = Math.round(tip);

    return {
      verdict: verdict, pay: pay, tip: tip, total: pay + tip, heartLoss: 0,
      accuracy: ev.accuracy, cookScore: ev.cookScore, quality: ev.quality,
      exact: ev.exact, faults: ev.faults
    };
  }

  /* ---------------------------------------------------------- the rent */
  var RENT_RATIO = 0.78;
  var goalCache = {};

  /**
   * Rent for the night. Sampled from the orders the day actually generates
   * rather than estimated from a formula - so it tracks ingredient prices,
   * order length and the double-patty rule automatically. Cached.
   */
  function sampleGoal(day) {
    var cfg = dayConfig(day);
    var rng = seeded(day * 7919 + 13);
    var sum = 0, N = 240;
    for (var i = 0; i < N; i++) {
      var c = pickCustomer(day, rng);
      var o = makeOrder(day, rng, c);
      // The tray, not just the burger: rent is sampled from what orders really
      // cost, so leaving the fries out here would price every day as though
      // nobody ever asked for them.
      sum += menuPrice(o.items, o.side, o.drink);
    }
    return Math.round(cfg.customers * (sum / N) * RENT_RATIO / 50) * 50;
  }

  function dayGoal(day) {
    /*
     * This walks forward from day 1, so the argument decides how long it runs.
     * A save holding day: 1e400 parses to Infinity, which is a number and is
     * greater than 1, so it used to sail past the caller's checks and hang the
     * tab in this loop. Nothing legitimate is above the cap, and no day should
     * be able to cost more than a few tens of milliseconds here.
     */
    day = Math.floor(Number(day));
    if (!isFinite(day) || day < 1) day = 1;
    if (day > MAX_DAY) day = MAX_DAY;

    if (goalCache[day] !== undefined) return goalCache[day];
    // Filled forward from day 1 so the ratchet below has a previous value.
    var prev = 0;
    for (var d = 1; d <= day; d++) {
      if (goalCache[d] === undefined) {
        // The landlord never lowers the rent. A day whose rotating menu happens
        // to be cheap must not read to the player as the game getting easier.
        goalCache[d] = Math.max(sampleGoal(d), prev);
      }
      prev = goalCache[d];
    }
    return goalCache[day];
  }

  /* ---------------------------------------------------------- upgrades */
  var UPGRADES = [
    { id: 'shoes', name: 'Running Shoes', desc: 'The chef moves faster', max: 3, base: 1600, mult: 2.0 },
    { id: 'plate', name: 'Plating Station', desc: '+1 plate to build on', max: 2, base: 3000, mult: 2.25 },
    { id: 'grill', name: 'Pro Grill', desc: 'Wider perfect window', max: 3, base: 1900, mult: 2.0 },
    { id: 'burner', name: 'Extra Burner', desc: '+1 grill slot', max: 2, base: 3200, mult: 2.3 },
    { id: 'sign', name: 'Neon Sign', desc: 'Bigger tips', max: 3, base: 2200, mult: 2.0 }
  ];

  var UPGRADE_BY_ID = {};
  UPGRADES.forEach(function (u) { UPGRADE_BY_ID[u.id] = u; });

  function upgradeCost(id, level) {
    var u = UPGRADE_BY_ID[id];
    if (!u || level >= u.max) return null;
    return Math.round(u.base * Math.pow(u.mult, level) / 50) * 50;
  }

  var STATION_CAP = 5;
  var MAX_MONEY = 1e12;      // a bound on a tampered save, not on a good run

  /* --------------------------------------------------------------- store */
  /*
   * What real money can buy, and - more importantly - what it deliberately
   * cannot.
   *
   * The 25-day curve in this file was not guessed; it was simulated, and there
   * are tests that fail if it drifts. So nothing sold here invents a new
   * ability or raises a ceiling. There are exactly three shapes:
   *
   *   skin   pure cosmetic. The cook is drawn from an eleven-colour palette,
   *          so an outfit costs a palette rather than a sprite sheet. No
   *          effect on anything the simulation measures.
   *
   *   gear   grants a level in an upgrade track that already exists, and stops
   *          at that track's existing `max`. Buying Non-slip Clogs is buying
   *          the Running Shoes level you would have earned - sooner, not
   *          bigger. `effects()` is unchanged, so the ceiling the tests assert
   *          is the same ceiling. A player who bought everything reaches the
   *          top of a track a few days early and then the game is the game.
   *
   *   till   in-game cash. Same argument: the shop's total is fixed and the
   *          station cap is five, so money buys pace and nothing else.
   *
   * That is the line. If something ever needs to be sold that moves a number
   * the simulation reads, it has to be simulated first - see the fryer note in
   * the README for what that costs.
   *
   * `sku` is what the platform store knows the product as. Nothing in here is
   * a price: prices come from the billing layer, because the store owns them
   * per territory and a hard-coded "$2.99" is wrong somewhere on day one.
   */
  var STORE = [
    { id: 'skin_garden', kind: 'skin', skin: 'garden', name: 'Garden Line',
      desc: 'Sage whites and an olive apron', sku: 'mrb.skin.garden', tier: 1 },
    { id: 'skin_berry', kind: 'skin', skin: 'berry', name: 'Milkshake',
      desc: 'For the counter, not the grill', sku: 'mrb.skin.berry', tier: 1 },
    { id: 'skin_head', kind: 'skin', skin: 'head', name: 'Head Chef',
      desc: 'Cocoa and brass. You run this line', sku: 'mrb.skin.head', tier: 2 },
    { id: 'skin_night', kind: 'skin', skin: 'night', name: 'Night Shift',
      desc: 'Charcoal blacks, one warm scarf', sku: 'mrb.skin.night', tier: 2 },
    { id: 'skin_gold', kind: 'skin', skin: 'gold', name: 'Golden Toque',
      desc: 'The top of the menu', sku: 'mrb.skin.gold', tier: 3 },

    { id: 'gear_clogs', kind: 'gear', track: 'shoes', name: 'Non-slip Clogs',
      desc: 'Skips you a Running Shoes level', sku: 'mrb.gear.clogs', tier: 2 },
    { id: 'gear_thermo', kind: 'gear', track: 'grill', name: 'Probe Thermometer',
      desc: 'Skips you a Pro Grill level', sku: 'mrb.gear.thermo', tier: 2 },
    { id: 'gear_awning', kind: 'gear', track: 'sign', name: 'Striped Awning',
      desc: 'Skips you a Neon Sign level', sku: 'mrb.gear.awning', tier: 2 },

    { id: 'till_small', kind: 'till', cents: 15000, name: 'Float',
      desc: 'Puts $150.00 in the till', sku: 'mrb.till.small', tier: 1, repeat: true },
    { id: 'till_big', kind: 'till', cents: 60000, name: "Week's Takings",
      desc: 'Puts $600.00 in the till', sku: 'mrb.till.big', tier: 3, repeat: true }
  ];

  var STORE_BY_ID = {};
  STORE.forEach(function (p) { STORE_BY_ID[p.id] = p; });

  /**
   * The upgrade levels a set of purchases is worth, folded into whatever the
   * player has earned. Capped by the track's own max, which is the whole point:
   * paid levels and earned levels land in the same bucket and that bucket does
   * not get bigger.
   */
  function levelsWithGear(levels, owned) {
    var out = {};
    Object.keys(levels || {}).forEach(function (k) { out[k] = levels[k]; });
    (owned || []).forEach(function (id) {
      var p = STORE_BY_ID[id];
      if (!p || p.kind !== 'gear') return;
      var u = UPGRADE_BY_ID[p.track];
      if (!u) return;
      out[p.track] = Math.min((out[p.track] || 0) + 1, u.max);
    });
    return out;
  }

  /** Every skin the player may wear, free one first. */
  function skinsOwned(owned) {
    var list = ['classic'];
    (owned || []).forEach(function (id) {
      var p = STORE_BY_ID[id];
      if (p && p.kind === 'skin') list.push(p.skin);
    });
    return list;
  }

  /**
   * How long the shift runs, in seconds.
   *
   * Measured rather than guessed. Simulating a sharp player - right order,
   * sear inside the window, no dawdling, holding the upgrades they would
   * plausibly own by then - a shift runs about forty seconds plus seven and a
   * half a day, levelling off around two minutes once the customer count caps
   * and the kitchen is fully kitted out.
   *
   * The clock is that with roughly half again on top. Tight enough that a
   * scrappy shift ends on the buzzer, loose enough that a clean one never
   * does - the hearts are what should beat you when you are playing badly, not
   * a stopwatch.
   *
   * Rounded to five seconds, because a countdown starting on an odd number
   * reads as arbitrary.
   */
  var CLOCK_SLACK = 1.45;

  function dayLength(day) {
    // The ceiling went up with the tray: 120 -> 130 is 175s -> 190s at day 25,
    // which is the 34s of headroom the burger-only shift used to have.
    // Steeper early, same ceiling. Days 1-3 lose the dead tail; day 12 on is
    // untouched. The floor is what the first shift is really worth: below it a
    // player cannot finish four orders however fast they walk.
    var sharp = clamp(33 + Math.max(1, Math.floor(day)) * 8.6, 45, 130);
    return Math.round(sharp * CLOCK_SLACK / 5) * 5;
  }

  /** mm:ss, for the clock in the corner. */
  function clockText(secs) {
    var s = Math.max(0, Math.ceil(Number(secs) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* ------------------------------------------------------------- the room */
  /**
   * Which kitchen you are working in tonight.
   *
   * Every shift moves the furniture: which wall the grill is on, which wall the
   * plates are on, where the bin sits, how the line is arranged, and the colour
   * of the place. Routes you learned yesterday are worth re-reading today,
   * which is the thing that makes a shift feel like a new shift.
   *
   * Purely a function of the day, and it lives here rather than in the layout
   * code for one reason: co-op. Both machines work it out for themselves and
   * have to arrive at the same room, and the guest only ever knows the day.
   *
   * Deliberately NOT random per run - a player who retries a day gets the same
   * kitchen back, so a failed night is a fair rematch rather than a reroll.
   */
  var SIDES = ['left', 'right'];
  var LINES = ['centre', 'left', 'right', 'split'];
  var PALETTES = 6;

  /**
   * How much of the room a given day is allowed to move.
   *
   * A player who has run the game five times should not be able to walk into
   * day 9 already knowing the grill is on the left. But re-reading a whole
   * floor plan while you are still learning to time a patty is not difficulty,
   * it is noise - so the room opens up a piece at a time:
   *
   *   day 1      nothing moves. The tutorial kitchen.
   *   day 2-3    the paint and the crate order.
   *   day 4-6    ...and which wall the burners are on.
   *   day 7+     ...and which end the bin is at. Everything is in play.
   */
  function roomChurn(d) {
    return {
      palette: d >= 2,
      line: d >= 2,
      walls: d >= 4,
      bin: d >= 7
    };
  }

  /**
   * The kitchen for a day of a given run.
   *
   * `seed` is the RUN, not the day: it changes when somebody starts over from
   * day 1 and never within a run. So a failed night is still a fair rematch in
   * the same room, and the layout you learned on your last run is worth
   * nothing on this one - which is the point. It travels in the co-op
   * snapshot, because a guest only knows the day and both machines have to
   * arrive at the same room.
   */
  function dayRoom(day, seed) {
    var d = Math.max(1, Math.floor(Number(day) || 1));
    var run = Math.floor(Number(seed) || 0) | 0;
    var rng = seeded(d * 2246822519 + 3266489917 + Math.imul(run, 40503));
    // burn one so neighbouring days do not share a first draw
    rng();
    var churn = roomChurn(d);
    var grill = SIDES[Math.floor(rng() * SIDES.length) % SIDES.length];
    var line = LINES[Math.floor(rng() * LINES.length) % LINES.length];
    var binSide = SIDES[Math.floor(rng() * SIDES.length) % SIDES.length];
    var palette = Math.floor(rng() * PALETTES) % PALETTES;
    if (!churn.walls) grill = 'left';
    if (!churn.line) line = 'centre';
    if (!churn.bin) binSide = 'right';
    if (!churn.palette) palette = 0;
    return {
      day: d,
      grill: grill,                                  // which wall the burners are on
      plates: grill === 'left' ? 'right' : 'left',   // plates always face them
      line: line,                                    // how the crate row is arranged
      bin: binSide,                                  // which end of the hatch the bin is
      palette: palette,
      // Day 1 is the tutorial: leave it in the plainest room so the first
      // shift is about learning the job, not reading a new floor plan.
      plain: d === 1
    };
  }

  /** A fresh run's seed. Kept small and integral so it survives a save. */
  function newRunSeed(rnd) {
    return Math.floor((rnd || Math.random)() * 0x7ffffffe) + 1;
  }

  /**
   * Beat a stored save into something the rules can be run against.
   *
   * A save is JSON from a device: it can be truncated, hand-edited, or synced
   * down from another install. The old check was "day is a number and at least
   * 1", which Infinity satisfies - and a day of Infinity walked dayGoal's
   * forward fill off the end of the world and hung the tab. Anything that
   * cannot be made sense of goes back to its starting value; a save that has no
   * usable day at all is no save.
   *
   * Returns null if there is nothing worth restoring.
   */
  function sanitiseSave(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    function num(v, dflt, lo, hi) {
      var n = Number(v);
      if (!isFinite(n)) return dflt;
      return Math.max(lo, Math.min(hi, n));
    }

    /*
     * A day outside the playable range is rejected rather than pulled into it.
     * Clamping would hand whoever wrote it exactly what they were after - a
     * best day of 999 goes straight to the top of the board - and no genuine
     * save degrades into Infinity. Better to lose one bad save than to trust it.
     */
    var day = Number(raw.day);
    if (!isFinite(day) || day < 1 || day > MAX_DAY) return null;
    day = Math.floor(day);

    var levels = {};
    if (raw.levels && typeof raw.levels === 'object' && !Array.isArray(raw.levels)) {
      UPGRADES.forEach(function (u) {
        var lv = Number(raw.levels[u.id]);
        if (isFinite(lv) && lv >= 1) levels[u.id] = Math.min(Math.floor(lv), u.max);
      });
    }

    /*
     * Entitlements go through the same door as everything else: only ids this
     * build actually sells, deduplicated, and a chosen skin only if it is one
     * the player owns. This is tidiness, not security - a local save is the
     * player's file. What stops a forged purchase mattering is the receipt
     * check on the server; see billing.js.
     */
    var owned = [];
    if (Array.isArray(raw.owned)) {
      raw.owned.forEach(function (id) {
        if (STORE_BY_ID[id] && owned.indexOf(id) < 0) owned.push(id);
      });
    }
    var skins = skinsOwned(owned);
    var skin = skins.indexOf(raw.skin) >= 0 ? raw.skin : 'classic';

    return {
      day: day,
      bestDay: Math.floor(num(raw.bestDay, day, 0, MAX_DAY)),
      money: Math.floor(num(raw.money, 0, 0, MAX_MONEY)),
      lifetime: Math.floor(num(raw.lifetime, 0, 0, MAX_MONEY)),
      // 0 means "a save from before runs had seeds": the base kitchen, which is
      // exactly the room those players already know.
      runSeed: Math.floor(num(raw.runSeed, 0, 0, 0x7fffffff)),
      levels: levels,
      owned: owned,
      skin: skin,
      muted: !!raw.muted
    };
  }

  /**
   * How big the kitchen is on a given day.
   *
   * The shop is not the only thing that grows the room: the day itself hands
   * out a plate and a burner as the shifts get heavier, so a player who never
   * upgrades still sees the kitchen expand. Upgrades stack on top of that and
   * get you there years early, up to a hard cap of five - past that a phone
   * screen cannot show a station big enough to work.
   */
  function stationsAt(day, levels) {
    levels = levels || {};
    var dayPlates = day >= 17 ? 2 : (day >= 9 ? 1 : 0);
    var dayGrill = day >= 19 ? 2 : (day >= 11 ? 1 : 0);
    return {
      plates: clamp(2 + dayPlates + (levels.plate || 0), 2, STATION_CAP),
      grillSlots: clamp(2 + dayGrill + (levels.burner || 0), 2, STATION_CAP)
    };
  }

  function effects(levels, day) {
    levels = levels || {};
    var st = stationsAt(day || 1, levels);
    return {
      speed: 165 + 45 * (levels.shoes || 0),          // px per second
      plates: st.plates,
      grillSlots: st.grillSlots,
      perfectWindow: BASE_WINDOW + 0.55 * (levels.grill || 0),
      tipMult: 1 + 0.18 * (levels.sign || 0)
    };
  }

  /**
   * Would the next level of this upgrade actually change anything on `day`?
   *
   * It is not always yes, and the shop used to charge as if it were. The
   * kitchen grows on its own as the shifts get heavier and the whole room is
   * capped at STATION_CAP, so from day 19 the line already runs four burners
   * and a second Extra Burner is a burner that can never be installed -
   * 2 + 2 + 2 clamped back down to 5. The button was still lit and still took
   * the money, and the burner never appeared. Same for the second Plating
   * Station from day 17.
   *
   * Asked of the whole effects object rather than of one field, so a cap added
   * to some future upgrade cannot reintroduce this quietly. Once an upgrade is
   * blocked it stays blocked: the day term only ever grows.
   */
  function upgradeGains(id, day, levels) {
    var u = UPGRADE_BY_ID[id];
    if (!u) return false;
    levels = levels || {};
    var lv = levels[id] || 0;
    if (lv >= u.max) return false;

    var next = {};
    Object.keys(levels).forEach(function (k) { next[k] = levels[k]; });
    next[id] = lv + 1;

    var a = effects(levels, day), b = effects(next, day);
    return a.speed !== b.speed || a.plates !== b.plates ||
      a.grillSlots !== b.grillSlots || a.perfectWindow !== b.perfectWindow ||
      a.tipMult !== b.tipMult;
  }

  /* ------------------------------------------------------------ format */
  function money(cents) {
    var neg = cents < 0;
    var v = Math.abs(Math.round(cents));
    var s = '$' + Math.floor(v / 100).toLocaleString('en-US') + '.' + String(v % 100).padStart(2, '0');
    return neg ? '-' + s : s;
  }

  return {
    INGREDIENTS: INGREDIENTS,
    GROUPS: GROUPS,
    CUSTOMERS: CUSTOMERS,
    UPGRADES: UPGRADES,
    STORE: STORE,
    storeItem: function (id) { return STORE_BY_ID[id] || null; },
    levelsWithGear: levelsWithGear,
    upgradeGains: upgradeGains,
    skinsOwned: skinsOwned,
    COOK_TIME: COOK_TIME,
    BURN_TIME: BURN_TIME,
    BASE_WINDOW: BASE_WINDOW,
    MENU_MAX: MENU_MAX,
    STATION_CAP: STATION_CAP,
    START_HEARTS: 5,
    stationsAt: stationsAt,
    byId: byId,
    MAX_DAY: MAX_DAY,
    sanitiseSave: sanitiseSave,
    dayRoom: dayRoom, roomChurn: roomChurn, newRunSeed: newRunSeed,
    PALETTES: PALETTES,
    dayLength: dayLength,
    clockText: clockText,
    unlockedAt: unlockedAt,
    unlockedOn: unlockedOn,
    dayConfig: dayConfig,
    dayMenu: dayMenu,
    menuSections: menuSections,
    displayStack: displayStack,
    dayGoal: dayGoal,
    makeOrder: makeOrder,
    menuPrice: menuPrice,
    SIDES: TRAY_SIDES, DRINKS: DRINKS, drinkById: function (id) { return DRINK_BY_ID[id]; },
    drinkMenu: drinkMenu, attachRates: attachRates, checkExtras: checkExtras,
    SIDE_DAY: SIDE_DAY, DRINK_DAY: DRINK_DAY,
    pickCustomer: pickCustomer,
    cookQuality: cookQuality,
    cookStage: cookStage,
    cookLook: cookLook,
    evaluate: evaluate,
    cookFault: cookFault,
    faultLabel: faultLabel,
    FAULT: FAULT,
    verdictOf: verdictOf,
    bestMatch: bestMatch,
    payout: payout,
    upgradeCost: upgradeCost,
    effects: effects,
    money: money,
    clamp: clamp
  };
});
