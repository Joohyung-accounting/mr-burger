/*
 * Rules + economy tests. No dependencies: `node test/core.test.js`.
 *
 * The interesting ones are at the bottom: full-day simulations at three skill
 * levels, so the rent curve is verified instead of guessed at.
 */
'use strict';

var assert = require('assert');
var Core = require('../www/js/core.js');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plate(ids, cook) {
  return ids.map(function (id) { return { id: id, cook: cook === undefined ? 1 : cook }; });
}

console.log('\nMr. Burger - rules & economy\n');

/* ------------------------------------------------------------- pantry */
test('every ingredient has a sane definition', function () {
  var kinds = { bun: 1, patty: 1, topping: 1, sauce: 1 };
  var groups = {};
  Core.GROUPS.forEach(function (g) { groups[g.id] = 1; });
  Core.INGREDIENTS.forEach(function (i) {
    assert.ok(i.id && i.name, 'missing id/name');
    assert.ok(kinds[i.kind], i.id + ' has an unknown kind: ' + i.kind);
    assert.ok(groups[i.group], i.id + ' is in no section of the line: ' + i.group);
    assert.ok(i.price >= 0, i.id + ' has a negative price');
    assert.ok(i.day >= 1, i.id + ' unlocks before day 1');
    assert.strictEqual(Core.byId(i.id), i, i.id + ' not indexed');
  });
});

test('the line has a bun, a patty, veggies and sauces to work with', function () {
  var late = Core.unlockedAt(20);
  function count(g) { return late.filter(function (i) { return i.group === g; }).length; }
  assert.ok(late.some(function (i) { return i.id === 'bun'; }), 'no bun to build on');
  assert.ok(late.some(function (i) { return i.id === 'patty'; }), 'no patty');
  assert.ok(count('topping') >= 6, 'only ' + count('topping') + ' toppings on the whole menu');
  assert.ok(count('sauce') >= 3, 'only ' + count('sauce') + ' sauces on the whole menu');
});

/* --------------------------------------------------------- day menu */
test('the day menu always stocks a bun and a patty, and never overflows', function () {
  for (var d = 1; d <= 30; d++) {
    var menu = Core.dayMenu(d);
    assert.ok(menu.indexOf('bun') >= 0, 'day ' + d + ' has no bun crate');
    assert.ok(menu.indexOf('patty') >= 0, 'day ' + d + ' has no patty crate');
    assert.ok(menu.length <= Core.MENU_MAX, 'day ' + d + ' put out ' + menu.length + ' crates');
    assert.strictEqual(new Set(menu).size, menu.length, 'day ' + d + ' has duplicate crates');
  }
});

test('the line puts out sauces as well as toppings once they exist', function () {
  var sawSauce = false, sawTopping = false;
  for (var d = 6; d <= 20; d++) {
    Core.dayMenu(d).forEach(function (id) {
      if (Core.byId(id).group === 'sauce') sawSauce = true;
      if (Core.byId(id).group === 'topping') sawTopping = true;
    });
  }
  assert.ok(sawTopping, 'no toppings ever reach the line');
  assert.ok(sawSauce, 'no sauces ever reach the line');
  // and by the back half of a run the line should be carrying both at once
  var late = Core.dayMenu(14).map(Core.byId);
  assert.ok(late.some(function (i) { return i.group === 'sauce'; }), 'day 14 has no sauce out');
  assert.ok(late.filter(function (i) { return i.group === 'topping'; }).length >= 3,
    'day 14 is short on toppings');
});

test('menuSections splits the line into non-empty labelled shelves', function () {
  for (var d = 1; d <= 20; d++) {
    var secs = Core.menuSections(d);
    var flat = [];
    secs.forEach(function (s) {
      assert.ok(s.label && s.ids.length, 'day ' + d + ' has an empty shelf: ' + s.id);
      flat = flat.concat(s.ids);
    });
    assert.deepStrictEqual(flat, Core.dayMenu(d),
      'day ' + d + ': the shelves must cover the menu in menu order');
  }
  assert.strictEqual(Core.menuSections(1).length, 1, 'day 1 is one shelf');
  assert.ok(Core.menuSections(14).length >= 2, 'a late kitchen should have several shelves');
});

test('the day menu only stocks ingredients that are unlocked', function () {
  for (var d = 1; d <= 20; d++) {
    var allowed = {};
    Core.unlockedAt(d).forEach(function (i) { allowed[i.id] = true; });
    Core.dayMenu(d).forEach(function (id) {
      assert.ok(allowed[id], 'day ' + d + ' stocked a locked crate: ' + id);
    });
  }
});

test('the day menu is deterministic and grows with the days', function () {
  assert.deepStrictEqual(Core.dayMenu(7), Core.dayMenu(7), 'day 7 menu is not stable');
  assert.ok(Core.dayMenu(12).length > Core.dayMenu(1).length, 'the line never gets busier');
  assert.deepStrictEqual(Core.dayMenu(1), ['bun', 'patty'],
    'day 1 should be a bun and a patty and nothing else');
});

/* ------------------------------------------------------------- orders */
test('every order is a burger: a bun and at least one patty', function () {
  var rng = mulberry32(11);
  for (var day = 1; day <= 30; day++) {
    for (var n = 0; n < 40; n++) {
      var o = Core.makeOrder(day, rng);
      assert.ok(o.items.indexOf('bun') >= 0, 'day ' + day + ': no bun');
      assert.ok(o.items.indexOf('patty') >= 0, 'day ' + day + ': no patty');
      assert.strictEqual(o.items.filter(function (i) { return i === 'bun'; }).length, 1,
        'day ' + day + ': a burger takes exactly one bun');
    }
  }
});

test('displayStack wraps a burger in buns, and leaves a bunless pile naked', function () {
  assert.deepStrictEqual(Core.displayStack(['bun', 'patty', 'cheese']),
    ['bunBottom', 'patty', 'cheese', 'bunTop']);
  assert.deepStrictEqual(Core.displayStack(['patty', 'cheese']), ['patty', 'cheese'],
    'forgetting the bun should be visible on the plate');
  assert.deepStrictEqual(Core.displayStack([]), []);
  // built plates carry objects, not ids
  var built = Core.displayStack([{ id: 'bun' }, { id: 'patty', cook: 0.5 }]);
  assert.strictEqual(built[0], 'bunBottom');
  assert.strictEqual(built[1].cook, 0.5, 'the cook value has to survive');
  assert.strictEqual(built[2], 'bunTop');
});

test('orders only ask for what is on the line today', function () {
  var rng = mulberry32(22);
  for (var day = 1; day <= 20; day++) {
    var menu = Core.dayMenu(day);
    for (var n = 0; n < 60; n++) {
      Core.makeOrder(day, rng).items.forEach(function (id) {
        assert.ok(menu.indexOf(id) >= 0,
          'day ' + day + ' ordered ' + id + ', which is not on the line');
      });
    }
  }
});

test('day 1 is a plain-burger tutorial and orders grow from there', function () {
  var rng = mulberry32(33);
  for (var n = 0; n < 60; n++) {
    assert.deepStrictEqual(Core.makeOrder(1, rng).items, ['bun', 'patty'],
      'day 1 should only ever ask for a plain burger');
  }
  function avg(day) {
    var t = 0;
    for (var i = 0; i < 300; i++) t += Core.makeOrder(day, rng).items.length;
    return t / 300;
  }
  assert.ok(avg(12) > avg(4), 'day 12 orders should be bigger than day 4');
  assert.ok(avg(20) <= 6.2, 'orders should stay readable at a glance');
});

test('kids order simple burgers', function () {
  var rng = mulberry32(44);
  var kid = Core.CUSTOMERS.filter(function (c) { return c.id === 'kid'; })[0];
  for (var i = 0; i < 120; i++) {
    assert.ok(Core.makeOrder(15, rng, kid).items.length <= 4, 'kid order too complex');
  }
});

test('menuPrice charges for every ingredient, bun included', function () {
  assert.strictEqual(Core.menuPrice([]), 0);
  assert.strictEqual(Core.menuPrice(['bun']), 90);
  assert.strictEqual(Core.menuPrice(['bun', 'patty', 'cheese']), 90 + 220 + 70);
  assert.strictEqual(Core.menuPrice(['bun', 'patty', 'patty']), 90 + 440);
});

/* -------------------------------------------------------------- grill */
test('cook quality peaks inside the perfect window and falls off both sides', function () {
  var w = Core.BASE_WINDOW;
  var raw = Core.cookQuality(1.0, w);
  var perfect = Core.cookQuality(Core.COOK_TIME, w);
  var over = Core.cookQuality(Core.COOK_TIME + 3, w);
  assert.strictEqual(perfect, 1);
  assert.ok(raw < perfect && over < perfect);
  assert.ok(raw >= 0.3 && over >= 0.3, 'a mistimed patty should still be sellable');
});

test('cook quality never exceeds 1 at any time', function () {
  for (var t = 0; t < 30; t += 0.05) {
    var q = Core.cookQuality(t, 3.5);
    assert.ok(q <= 1 && q > 0, 't=' + t.toFixed(2) + ' gave ' + q);
  }
});

test('a wider perfect window makes the grill more forgiving', function () {
  var t = Core.COOK_TIME + 1.2;
  assert.ok(Core.cookQuality(t, 3.5) > Core.cookQuality(t, Core.BASE_WINDOW));
});

test('doneness only ever climbs, and charring starts only after the window', function () {
  var w = Core.BASE_WINDOW;
  assert.strictEqual(Core.cookLook(0, w).done, 0, 'beef out of the crate is raw');
  assert.strictEqual(Core.cookLook(0, w).char, 0);

  var prev = -1;
  for (var t = 0; t <= 25; t += 0.1) {
    var look = Core.cookLook(t, w);
    assert.ok(look.done >= prev - 1e-9,
      'doneness went backwards at t=' + t.toFixed(1) + ' - a burnt patty would look raw again');
    assert.ok(look.done >= 0 && look.done <= 1, 'done out of range at t=' + t.toFixed(1));
    assert.ok(look.char >= 0 && look.char <= 1, 'char out of range at t=' + t.toFixed(1));
    prev = look.done;
  }

  assert.strictEqual(Core.cookLook(Core.COOK_TIME, w).done, 1, 'seared by the perfect window');
  assert.strictEqual(Core.cookLook(Core.COOK_TIME, w).char, 0, 'nothing burns inside the window');
  assert.ok(Core.cookLook(Core.COOK_TIME + Core.BURN_TIME * 2, w).char > 0.5, 'left on, it should char');
});

test('a half-cooked patty looks half-cooked, not raw and not seared', function () {
  var w = Core.BASE_WINDOW;
  var mid = Core.cookLook((Core.COOK_TIME - w / 2) / 2, w).done;
  assert.ok(mid > 0.2 && mid < 0.8, 'mid-grill doneness reads as ' + mid.toFixed(2));
});

test('cook stages run raw -> perfect -> over -> burnt in order', function () {
  var w = Core.BASE_WINDOW;
  assert.strictEqual(Core.cookStage(1, w), 'raw');
  assert.strictEqual(Core.cookStage(Core.COOK_TIME, w), 'perfect');
  assert.strictEqual(Core.cookStage(Core.COOK_TIME + 2, w), 'over');
  assert.strictEqual(Core.cookStage(Core.COOK_TIME + 20, w), 'burnt');
});

/* --------------------------------------------------------- evaluation */
test('the right fillings score a perfect', function () {
  var order = ['patty', 'cheese', 'lettuce'];
  var ev = Core.evaluate(order, plate(order));
  assert.strictEqual(ev.exact, true);
  assert.strictEqual(ev.accuracy, 1);
  assert.strictEqual(ev.quality, 1);
  assert.strictEqual(Core.verdictOf(ev), 'perfect');
});

test('stacking order does not matter', function () {
  var order = ['patty', 'cheese', 'lettuce'];
  var jumbled = Core.evaluate(order, plate(['lettuce', 'patty', 'cheese']));
  assert.strictEqual(jumbled.accuracy, 1, 'a reordered burger is the same burger');
  assert.strictEqual(jumbled.exact, true);
});

test('duplicates are counted, not collapsed', function () {
  var order = ['patty', 'patty', 'cheese'];
  assert.strictEqual(Core.evaluate(order, plate(['patty', 'patty', 'cheese'])).accuracy, 1);
  var single = Core.evaluate(order, plate(['patty', 'cheese']));
  assert.ok(single.accuracy < 1, 'one patty is not two');
  assert.strictEqual(single.matched, 2);
});

test('missing and extra fillings both cost accuracy', function () {
  var order = ['patty', 'cheese', 'lettuce'];
  var missing = Core.evaluate(order, plate(['patty', 'cheese']));
  var extra = Core.evaluate(order, plate(['patty', 'cheese', 'lettuce', 'onion']));
  assert.ok(missing.accuracy > 0.6 && missing.accuracy < 1);
  assert.ok(extra.accuracy > 0.6 && extra.accuracy < 1);
});

test('a completely wrong burger is rejected', function () {
  var res = Core.payout({
    orderItems: ['patty', 'cheese', 'lettuce', 'tomato'],
    built: plate(['onion']),
    patienceRatio: 1,
    customer: Core.CUSTOMERS[0]
  });
  assert.strictEqual(res.verdict, 'bad');
  assert.strictEqual(res.total, 0);
  assert.strictEqual(res.heartLoss, 1);
});

/* ------------------------------------------------------------- faults */
test('a slightly mistimed patty costs money but does not void the sale', function () {
  var order = ['bun', 'patty'];
  var good = Core.payout({ orderItems: order, built: plate(order, 1), patienceRatio: 1, customer: Core.CUSTOMERS[0] });
  var soft = Core.payout({ orderItems: order, built: plate(order, 0.7), patienceRatio: 1, customer: Core.CUSTOMERS[0] });
  assert.ok(soft.total > 0 && soft.total < good.total, 'undercooked should sell for less');
  assert.strictEqual(soft.exact, true, 'the fillings were still right');
  assert.strictEqual(soft.faults[0].code, 'underdone');
});

test('a burnt patty gets the burger sent back, however good the toppings', function () {
  var order = ['bun', 'patty', 'cheese', 'lettuce'];
  var built = plate(order, 1);
  built[1].char = 0.6;                       // the patty came off charred
  built[1].cook = 0.4;
  var res = Core.payout({ orderItems: order, built: built, patienceRatio: 1, customer: Core.CUSTOMERS[0] });
  assert.strictEqual(res.verdict, 'bad', 'burnt meat has to be a rejection');
  assert.strictEqual(res.total, 0, 'and must not pay');
  assert.strictEqual(res.heartLoss, 1);
  assert.strictEqual(res.faults[0].code, 'burnt', 'the top fault should be the burnt patty');
  assert.ok(/BURNT/.test(res.faults[0].label));
});

test('a raw patty gets the burger sent back too', function () {
  var order = ['bun', 'patty', 'cheese'];
  var built = plate(order, 1);
  built[1].cook = 0.32;                      // pulled almost straight off
  built[1].char = 0;
  var res = Core.payout({ orderItems: order, built: built, patienceRatio: 1, customer: Core.CUSTOMERS[0] });
  assert.strictEqual(res.verdict, 'bad');
  assert.strictEqual(res.faults[0].code, 'raw');
});

test('two burnt patties are worse than one', function () {
  var order = ['bun', 'patty', 'patty'];
  function build(charred) {
    var b = plate(order, 1);
    for (var i = 1; i <= charred; i++) { b[i].char = 0.6; b[i].cook = 0.4; }
    return Core.evaluate(order, b);
  }
  assert.ok(build(2).quality < build(1).quality, 'a second burnt patty must cost more');
  assert.ok(build(1).quality < build(0).quality);
});

test('cook faults are classified from what the patty actually looks like', function () {
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 1, char: 0 }), null);
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 0.9, char: 0 }), null, 'close enough is fine');
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 0.7, char: 0 }), 'underdone');
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 0.3, char: 0 }), 'raw');
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 0.7, char: 0.1 }), 'overdone');
  assert.strictEqual(Core.cookFault({ id: 'patty', cook: 0.4, char: 0.6 }), 'burnt');
  assert.strictEqual(Core.cookFault({ id: 'cheese', cook: 0.1 }), null, 'cheese does not get grilled');
});

test('every fault is named, and the worst one is listed first', function () {
  var order = ['bun', 'patty', 'cheese', 'lettuce'];
  var built = plate(['bun', 'patty', 'onion'], 1);
  built[1].char = 0.6; built[1].cook = 0.4;
  var ev = Core.evaluate(order, built);
  var codes = ev.faults.map(function (f) { return f.code; });
  assert.ok(codes.indexOf('burnt') >= 0, 'burnt patty not reported');
  assert.ok(codes.indexOf('missing') >= 0, 'missing fillings not reported');
  assert.ok(codes.indexOf('extra') >= 0, 'the onion nobody asked for not reported');
  ev.faults.forEach(function (f) {
    assert.ok(f.label && f.label.length > 3, f.code + ' has no readable label');
    assert.ok(f.count >= 1 && f.cost > 0, f.code + ' has a nonsense cost');
  });
  for (var i = 1; i < ev.faults.length; i++) {
    assert.ok(ev.faults[i - 1].cost >= ev.faults[i].cost, 'faults are not sorted worst-first');
  }
});

test('a flawless burger reports no faults at all', function () {
  var order = ['bun', 'patty', 'cheese'];
  assert.deepStrictEqual(Core.evaluate(order, plate(order, 1)).faults, []);
});

test('cook quality only counts for things that go on the grill', function () {
  var order = ['cheese', 'lettuce'];
  var ev = Core.evaluate(order, plate(order, 0.1));
  assert.strictEqual(ev.cookScore, 1, 'lettuce cannot be undercooked');
  assert.strictEqual(ev.quality, 1);
});

/* ------------------------------------------------------- serving hatch */
test('the hatch delivers a plate to the ticket it actually matches', function () {
  var tickets = [
    { uid: 1, items: ['patty', 'cheese', 'lettuce', 'onion'] },
    { uid: 2, items: ['patty', 'cheese'] },
    { uid: 3, items: ['patty', 'tomato', 'bacon'] }
  ];
  assert.strictEqual(Core.bestMatch(tickets, plate(['patty', 'cheese'])).uid, 2);
  assert.strictEqual(Core.bestMatch(tickets, plate(['patty', 'tomato', 'bacon'])).uid, 3);
  assert.strictEqual(Core.bestMatch(tickets, plate(['patty', 'cheese', 'lettuce', 'onion'])).uid, 1);
});

test('the hatch still picks a nearest ticket for a burger nobody ordered', function () {
  var tickets = [{ uid: 1, items: ['patty', 'cheese'] }];
  var m = Core.bestMatch(tickets, plate(['jalapeno']));
  assert.strictEqual(m.uid, 1, 'it has to go somewhere - and it will be rejected');
  assert.strictEqual(Core.bestMatch([], plate(['patty'])), null, 'nothing to match against');
});

/* ------------------------------------------------------------ payouts */
test('serving fast pays a bigger tip than serving slow', function () {
  var order = ['patty', 'cheese'];
  var fast = Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.9, customer: Core.CUSTOMERS[0] });
  var slow = Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.1, customer: Core.CUSTOMERS[0] });
  assert.strictEqual(fast.pay, slow.pay, 'the food costs the same either way');
  assert.ok(fast.tip > slow.tip);
});

test('customer archetypes tip differently', function () {
  var order = ['patty', 'cheese'];
  function tipFor(id) {
    var c = Core.CUSTOMERS.filter(function (x) { return x.id === id; })[0];
    return Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.8, customer: c }).tip;
  }
  assert.ok(tipFor('rush') > tipFor('regular'));
  assert.ok(tipFor('chill') < tipFor('regular'));
  assert.ok(tipFor('foodie') > tipFor('rush'));
});

test('a foodie slashes the tip for anything less than exact', function () {
  var foodie = Core.CUSTOMERS.filter(function (c) { return c.id === 'foodie'; })[0];
  var order = ['patty', 'cheese', 'lettuce'];
  var exact = Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.8, customer: foodie });
  var near = Core.payout({ orderItems: order, built: plate(['patty', 'cheese']), patienceRatio: 0.8, customer: foodie });
  assert.ok(near.tip < exact.tip * 0.5);
});

test('the Neon Sign upgrade raises tips but not the food price', function () {
  var order = ['patty', 'cheese'];
  var base = Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.8, customer: Core.CUSTOMERS[0], tipMult: 1 });
  var maxed = Core.payout({ orderItems: order, built: plate(order), patienceRatio: 0.8, customer: Core.CUSTOMERS[0], tipMult: Core.effects({ sign: 3 }).tipMult });
  assert.strictEqual(base.pay, maxed.pay);
  assert.ok(maxed.tip > base.tip * 1.4);
});

/* ----------------------------------------------------------- upgrades */
test('upgrade costs rise and stop at max level', function () {
  Core.UPGRADES.forEach(function (u) {
    var prev = 0;
    for (var l = 0; l < u.max; l++) {
      var c = Core.upgradeCost(u.id, l);
      assert.ok(c > prev, u.id + ' level ' + l + ' is not more expensive than the last');
      prev = c;
    }
    assert.strictEqual(Core.upgradeCost(u.id, u.max), null, u.id + ' should be maxed out');
  });
  assert.strictEqual(Core.upgradeCost('nonsense', 0), null);
});

test('effects scale from the right defaults', function () {
  var base = Core.effects({});
  assert.strictEqual(base.plates, 2);
  assert.strictEqual(base.grillSlots, 2);
  assert.strictEqual(base.tipMult, 1);
  assert.ok(base.speed > 0, 'the chef has to be able to walk');
  var maxed = Core.effects({ shoes: 3, plate: 2, burner: 2, grill: 3, sign: 3 });
  assert.strictEqual(maxed.plates, 4);
  assert.strictEqual(maxed.grillSlots, 4);
  assert.ok(maxed.speed > base.speed * 1.5, 'Running Shoes should be felt');
  assert.ok(maxed.perfectWindow > base.perfectWindow);
  assert.strictEqual(Core.effects().grillSlots, 2, 'effects() must tolerate no argument');
});

/*
 * The whole escalation curve in one place. Every axis the player can feel has
 * to (a) never go backwards and (b) actually move across a run. Plates and
 * burners used to be flat at 2 unless you bought upgrades, so a player who
 * never shopped saw the same kitchen on day 1 and day 20.
 */
test('every difficulty axis grows across a run and never goes backwards', function () {
  var AXES = [
    { name: 'crates on the line', at: function (d) { return Core.dayMenu(d).length; } },
    { name: 'biggest order', at: function (d) { return 2 + Core.dayConfig(d).maxExtras; } },
    { name: 'smallest order', at: function (d) { return 2 + Core.dayConfig(d).minExtras; } },
    { name: 'tickets on the board', at: function (d) { return Core.dayConfig(d).concurrent; } },
    { name: 'plates', at: function (d) { return Core.effects({}, d).plates; } },
    { name: 'burners', at: function (d) { return Core.effects({}, d).grillSlots; } },
    { name: 'customers', at: function (d) { return Core.dayConfig(d).customers; } },
    { name: 'rent', at: function (d) { return Core.dayGoal(d); } }
  ];

  AXES.forEach(function (a) {
    var prev = a.at(1);
    for (var d = 2; d <= 25; d++) {
      var now = a.at(d);
      assert.ok(now >= prev, a.name + ' went backwards on day ' + d + ' (' + prev + ' -> ' + now + ')');
      prev = now;
    }
    assert.ok(a.at(20) > a.at(1),
      a.name + ' never grows: still ' + a.at(1) + ' on day 20');
  });

  // patience is the one axis that must shrink
  var p1 = Core.dayConfig(1).patience;
  for (var d = 2; d <= 25; d++) {
    var p = Core.dayConfig(d).patience;
    assert.ok(p <= p1 + 0.001, 'patience grew on day ' + d);
    p1 = p;
  }
  assert.ok(Core.dayConfig(20).patience < Core.dayConfig(1).patience * 0.7,
    'the clock barely tightens over a run');
});

test('the kitchen grows on its own, and upgrades stack on top of that', function () {
  var free1 = Core.effects({}, 1);
  var free20 = Core.effects({}, 20);
  assert.strictEqual(free1.plates, 2);
  assert.strictEqual(free1.grillSlots, 2);
  assert.ok(free20.plates > free1.plates, 'a player who never shops gets no extra plates');
  assert.ok(free20.grillSlots > free1.grillSlots, 'a player who never shops gets no extra burners');

  // buying should get you there years early
  var bought = Core.effects({ plate: 2, burner: 2 }, 1);
  assert.ok(bought.plates >= free20.plates, 'upgrades should beat waiting');
  assert.ok(bought.grillSlots >= free20.grillSlots);

  // and nothing may exceed what a phone screen can show
  for (var d = 1; d <= 40; d++) {
    var maxed = Core.effects({ plate: 9, burner: 9 }, d);
    assert.ok(maxed.plates <= Core.STATION_CAP, 'day ' + d + ': ' + maxed.plates + ' plates');
    assert.ok(maxed.grillSlots <= Core.STATION_CAP, 'day ' + d + ': ' + maxed.grillSlots + ' burners');
  }
});

test('the board always shows more tickets than there are plates to build on', function () {
  for (var d = 3; d <= 25; d++) {
    var cfg = Core.dayConfig(d);
    assert.ok(cfg.concurrent >= Core.effects({}).plates,
      'day ' + d + ': only ' + cfg.concurrent + ' tickets for 2 plates');
    assert.ok(cfg.concurrent <= 5, 'day ' + d + ': ' + cfg.concurrent + ' tickets will not fit the board');
  }
});

test('the opening days are gentle, without being a wait', function () {
  var d1 = Core.dayConfig(1);
  assert.ok(d1.patience >= 55, 'day 1 gives ' + d1.patience.toFixed(0) + 's - too tight to learn in');
  assert.ok(d1.customers <= 6, 'day 1 sends ' + d1.customers + ' customers');
  assert.ok(d1.concurrent <= 2, 'day 1 should never have more than two tickets up');
  // A band, not a floor. This used to demand a gap of at least 8 seconds, which
  // is a long time to stand in an empty kitchen with nothing to do - the board
  // was setting the pace rather than the cooking.
  assert.ok(d1.spawnMin >= 4, 'day 1 queues up too fast to learn in');
  assert.ok(d1.spawnMin <= 7, 'day 1 leaves you waiting ' + d1.spawnMin.toFixed(1) + 's for something to do');
  assert.ok(Core.dayConfig(12).patience < d1.patience, 'the clock should tighten over time');
});

/* ------------------------------------------------------------- the clock */
test('the shift clock is long enough to actually work the shift', function () {
  // measured: a sharp player's shift runs about 40s + 7.5s a day, levelling off
  // near two minutes once the customer count caps
  for (var day = 1; day <= 30; day++) {
    var sharp = Math.min(40 + day * 7.5, 120);
    var limit = Core.dayLength(day);
    assert.ok(limit >= sharp * 1.25,
      'day ' + day + ' gives ' + limit + 's for a shift that takes about ' + sharp.toFixed(0) + 's');
    assert.ok(limit <= sharp * 2.0,
      'day ' + day + ' gives ' + limit + 's, which is not a limit at all against ' + sharp.toFixed(0) + 's');
  }
});

test('the clock never shortens as the days get heavier', function () {
  for (var day = 2; day <= 30; day++) {
    assert.ok(Core.dayLength(day) >= Core.dayLength(day - 1),
      'day ' + day + ' gives less time than day ' + (day - 1) +
      ' (' + Core.dayLength(day) + 's vs ' + Core.dayLength(day - 1) + 's)');
  }
  assert.ok(Core.dayLength(1) >= 60, 'day 1 is the tutorial and should not be a sprint');
});

test('the clock reads as a clock', function () {
  assert.strictEqual(Core.clockText(0), '0:00');
  assert.strictEqual(Core.clockText(9), '0:09');
  assert.strictEqual(Core.clockText(60), '1:00');
  assert.strictEqual(Core.clockText(125), '2:05');
  assert.strictEqual(Core.clockText(-4), '0:00', 'a negative clock should read empty, not broken');
  assert.strictEqual(Core.clockText(30.2), '0:31', 'part of a second left is still a second on the display');
});

test('the line keeps coming faster as the days go on', function () {
  var gaps = [1, 5, 10, 15, 20].map(function (d) {
    var c = Core.dayConfig(d);
    return (c.spawnMin + c.spawnMax) / 2;
  });
  for (var i = 1; i < gaps.length; i++) {
    assert.ok(gaps[i] <= gaps[i - 1],
      'the gap between customers grew: ' + gaps.map(function (g) { return g.toFixed(1); }).join(', '));
  }
  assert.ok(gaps[0] / gaps[gaps.length - 1] >= 1.8,
    'the pace barely changes across a run: ' + gaps[0].toFixed(1) + 's down to ' +
    gaps[gaps.length - 1].toFixed(1) + 's');
});

/* ------------------------------------------------------------- format */
test('money formats as US dollars', function () {
  assert.strictEqual(Core.money(0), '$0.00');
  assert.strictEqual(Core.money(1234), '$12.34');
  assert.strictEqual(Core.money(123456), '$1,234.56');
  assert.strictEqual(Core.money(-250), '-$2.50');
});

/* ================================================================== */
/*  Day simulations - is the rent curve actually fair?                */
/* ================================================================== */

/**
 * The two ways a real player botches a ticket now that order does not matter:
 * a forgotten filling, or one they grabbed from the wrong crate.
 */
function missOf(items, day, rng) {
  var out = items.slice();
  if (rng() < 0.5 && out.length > 1) {
    out.splice(Math.floor(rng() * out.length), 1);
  } else {
    var menu = Core.dayMenu(day);
    out.push(menu[Math.floor(rng() * menu.length)]);
  }
  return out;
}

function simulateDay(day, skill, rng, levels) {
  var cfg = Core.dayConfig(day);
  var fx = Core.effects(levels || {});
  var earned = 0, hearts = Core.START_HEARTS;

  for (var i = 0; i < cfg.customers; i++) {
    var customer = Core.pickCustomer(day, rng);
    var order = Core.makeOrder(day, rng, customer);

    if (rng() < skill.walkout) { hearts--; continue; }

    var items = rng() < skill.accuracy ? order.items : missOf(order.items, day, rng);
    var res = Core.payout({
      orderItems: order.items,
      built: plate(items, skill.cook),
      patienceRatio: skill.speed,
      customer: customer,
      tipMult: fx.tipMult
    });
    earned += res.total;
    hearts -= res.heartLoss;
  }
  return { earned: earned, hearts: hearts, goal: Core.dayGoal(day) };
}

var PRO = { accuracy: 0.97, cook: 1.00, speed: 0.70, walkout: 0.00 };
var DECENT = { accuracy: 0.84, cook: 0.88, speed: 0.45, walkout: 0.05 };
var SLOPPY = { accuracy: 0.45, cook: 0.55, speed: 0.15, walkout: 0.25 };

function ratioOverDays(skill, days, seed) {
  var rng = mulberry32(seed);
  var out = [];
  for (var d = 1; d <= days; d++) {
    var runs = [];
    for (var k = 0; k < 40; k++) runs.push(simulateDay(d, skill, rng));
    var avg = runs.reduce(function (s, r) { return s + r.earned; }, 0) / runs.length;
    out.push({ day: d, ratio: avg / Core.dayGoal(d), earned: avg, goal: Core.dayGoal(d) });
  }
  return out;
}

test('a competent player clears rent every day for 20 days', function () {
  ratioOverDays(DECENT, 20, 777).forEach(function (r) {
    assert.ok(r.ratio >= 1.05,
      'day ' + r.day + ': earned ' + Core.money(r.earned) + ' vs rent ' + Core.money(r.goal) +
      ' (x' + r.ratio.toFixed(2) + ') - rent is too steep');
  });
});

test('rent is not free money for a competent player', function () {
  ratioOverDays(DECENT, 20, 778).forEach(function (r) {
    assert.ok(r.ratio <= 2.1, 'day ' + r.day + ': x' + r.ratio.toFixed(2) + ' of rent - too easy to be tense');
  });
});

test('sloppy play never clears rent on revenue alone', function () {
  ratioOverDays(SLOPPY, 25, 3131).forEach(function (r) {
    assert.ok(r.ratio < 1, 'day ' + r.day + ': sloppy play earned x' + r.ratio.toFixed(2) + ' of rent');
  });
});

test('skill is rewarded - a pro out-earns a competent player by a clear margin', function () {
  var pro = ratioOverDays(PRO, 12, 555);
  var dec = ratioOverDays(DECENT, 12, 555);
  for (var i = 0; i < pro.length; i++) {
    assert.ok(pro[i].earned > dec[i].earned * 1.2,
      'day ' + pro[i].day + ': pro earned only x' + (pro[i].earned / dec[i].earned).toFixed(2) + ' of competent');
  }
});

/*
 * Regression guard. An earlier rent formula estimated ticket value with a linear
 * guess, so as late-game ingredients pushed real orders past the estimate, rent
 * fell behind and the game got *easier* the longer you played. Rent is now
 * sampled from real orders; this pins that it stays sampled.
 */
/*
 * Regression: a save is JSON off a device, so it can be truncated, hand-edited
 * or synced down from another install. The check used to be "day is a number
 * and at least 1" - which Infinity satisfies, and a day of Infinity walked
 * dayGoal's forward fill off the end of the world and hung the tab.
 */
/*
 * Regression: the shelf stocked floor(day/2) extras but orders allowed
 * floor(day/2.2) of them, and on day 2 those disagree - so lettuce turned up in
 * a crate that no ticket could ever ask for. A new ingredient that does nothing
 * is worse than no new ingredient.
 */
test('every crate on the line can actually be ordered', function () {
  for (var day = 1; day <= 24; day++) {
    var menu = Core.dayMenu(day);
    var seen = {};
    for (var n = 0; n < 2500; n++) {
      Core.makeOrder(day, Math.random, Core.pickCustomer(day)).items
        .forEach(function (id) { seen[id] = true; });
    }
    var dead = menu.filter(function (id) { return !seen[id]; });
    assert.strictEqual(dead.length, 0,
      'day ' + day + ' stocks ' + dead.join(', ') + ' but no order ever asks for it');
  }
});

/*
 * Day 1 is the tutorial and stocks nothing but a bun and a patty, so a day-1
 * unlock has to queue - but nothing should sit in the back for long. Cheese
 * used to unlock with the tutorial and not reach the line until day 8.
 */
test('a new ingredient reaches the line while it is still news', function () {
  var firstSeen = {};
  for (var day = 1; day <= 30; day++) {
    Core.dayMenu(day).forEach(function (id) {
      if (firstSeen[id] === undefined) firstSeen[id] = day;
    });
  }
  Core.INGREDIENTS.forEach(function (ing) {
    var seen = firstSeen[ing.id];
    assert.ok(seen !== undefined, ing.name + ' never reaches the line at all');
    assert.ok(seen - ing.day <= 4,
      ing.name + ' unlocks on day ' + ing.day + ' but does not reach the line until day ' + seen);
  });
});

/*
 * The line splits its crates between toppings and sauces, and a single spare
 * crate always goes to a topping - so a sauce unlocking on a one-crate day has
 * to wait for the second. But once the line does carry that group, whatever
 * unlocked today should be in it: the shop announced it the evening before.
 */
test('an ingredient that unlocks today goes out today once its group is stocked', function () {
  for (var day = 2; day <= 24; day++) {
    var menu = Core.dayMenu(day);
    Core.unlockedOn(day).forEach(function (ing) {
      var sameGroup = menu.filter(function (id) {
        var other = Core.byId(id);
        return other.group === ing.group && id !== 'bun' && id !== 'patty';
      });
      if (!sameGroup.length) return;          // no crate of that kind today
      assert.ok(sameGroup.indexOf(ing.id) >= 0,
        'day ' + day + ' unlocks ' + ing.name + ' and stocks ' + sameGroup.join(', ') +
        ' - the new one should be among them');
    });
  }
});

test('a save with an impossible day cannot hang the game', function () {
  var t0 = Date.now();
  assert.ok(Core.dayGoal(Infinity) > 0, 'an infinite day should still answer');
  assert.ok(Core.dayGoal(1e12) > 0, 'an absurd day should still answer');
  assert.ok(Core.dayGoal(-5) > 0, 'a negative day should still answer');
  assert.ok(Core.dayGoal(NaN) > 0, 'a day that is not a number should still answer');
  assert.ok(Date.now() - t0 < 3000, 'the rent took ' + (Date.now() - t0) + 'ms to work out');
});

test('a nonsense save is cleaned up rather than trusted', function () {
  assert.strictEqual(Core.sanitiseSave(null), null);
  assert.strictEqual(Core.sanitiseSave('hello'), null);
  assert.strictEqual(Core.sanitiseSave([1, 2, 3]), null, 'an array is not a save');
  assert.strictEqual(Core.sanitiseSave({}), null, 'no day means nothing to restore');
  assert.strictEqual(Core.sanitiseSave({ day: 'nine' }), null);
  assert.strictEqual(Core.sanitiseSave({ day: 0 }), null);

  // rejected, not clamped: clamping a claimed day of Infinity to 999 would hand
  // whoever wrote it the top of the leaderboard
  assert.strictEqual(Core.sanitiseSave({ day: Infinity }), null, 'an infinite day is not a save');
  assert.strictEqual(Core.sanitiseSave({ day: 1e12 }), null, 'an absurd day is not a save');
  assert.ok(Core.sanitiseSave({ day: Core.MAX_DAY }), 'the cap itself should still be playable');

  var wild = Core.sanitiseSave({
    day: 12, bestDay: -5, money: -99999, lifetime: NaN,
    levels: { grill: 999, nonsense: 4, plate: 'lots' }, muted: 'yes'
  });
  assert.strictEqual(wild.day, 12);
  assert.ok(wild.bestDay >= 0, 'best day went negative');
  assert.strictEqual(wild.money, 0, 'money went negative');
  assert.strictEqual(wild.lifetime, 0);
  assert.strictEqual(wild.levels.grill, 3, 'an upgrade above its maximum should be clipped');
  assert.strictEqual(wild.levels.nonsense, undefined, 'an upgrade that does not exist should be dropped');
  assert.strictEqual(wild.levels.plate, undefined, 'a level that is not a number should be dropped');
  assert.strictEqual(wild.muted, true);

  var good = Core.sanitiseSave({ day: 12, bestDay: 14, money: 5000, lifetime: 90000,
    levels: { grill: 2, shoes: 1 }, muted: false });
  assert.deepStrictEqual(good, { day: 12, bestDay: 14, money: 5000, lifetime: 90000,
    levels: { grill: 2, shoes: 1 }, muted: false }, 'a good save should come through untouched');
});

test('the difficulty ramp does not drift across a full run', function () {
  [{ name: 'competent', skill: DECENT }, { name: 'sloppy', skill: SLOPPY }].forEach(function (c) {
    var ratios = ratioOverDays(c.skill, 25, 8080).map(function (r) { return r.ratio; });
    var lo = Math.min.apply(null, ratios), hi = Math.max.apply(null, ratios);
    assert.ok(hi - lo <= 0.28,
      c.name + ' play swings from x' + lo.toFixed(2) + ' to x' + hi.toFixed(2) +
      ' of rent across 25 days - the ramp is drifting');

    var front = ratios.slice(0, 8).reduce(function (s, v) { return s + v; }, 0) / 8;
    var back = ratios.slice(-8).reduce(function (s, v) { return s + v; }, 0) / 8;
    assert.ok(back <= front + 0.14,
      c.name + ' play gets easier over time (early x' + front.toFixed(2) + ' -> late x' + back.toFixed(2) + ')');
  });
});

test('upgrades are a real spending decision, not a formality', function () {
  var tree = 0;
  Core.UPGRADES.forEach(function (u) {
    for (var l = 0; l < u.max; l++) tree += Core.upgradeCost(u.id, l);
  });
  // Rent is deducted nightly, so the wallet only grows by the surplus.
  var surplus = ratioOverDays(DECENT, 14, 4242)
    .reduce(function (s, r) { return s + (r.earned - r.goal); }, 0);
  assert.ok(surplus > tree * 0.25,
    'two weeks of surplus (' + Core.money(surplus) + ') barely dents the ' +
    Core.money(tree) + ' upgrade tree - progression will feel dead');
  assert.ok(surplus < tree * 1.3,
    'two weeks of surplus (' + Core.money(surplus) + ') buys the whole ' +
    Core.money(tree) + ' tree - nothing left to choose between');
});

test('the first upgrade of each branch is reachable in the first few days', function () {
  var surplus = ratioOverDays(DECENT, 4, 6161)
    .reduce(function (s, r) { return s + (r.earned - r.goal); }, 0);
  var cheapest = Math.min.apply(null, Core.UPGRADES.map(function (u) {
    return Core.upgradeCost(u.id, 0);
  }));
  assert.ok(surplus >= cheapest,
    'four days of surplus (' + Core.money(surplus) + ') cannot afford the cheapest upgrade (' +
    Core.money(cheapest) + ')');
});

test('rent is deterministic and rises with the days', function () {
  for (var d = 1; d <= 15; d++) {
    assert.strictEqual(Core.dayGoal(d), Core.dayGoal(d), 'day ' + d + ' rent is not stable');
    assert.ok(Core.dayGoal(d) > 0);
  }
  assert.ok(Core.dayGoal(10) > Core.dayGoal(1));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : '') + '\n');
