
/* ---------------- skeptic checks on the board take path ---------------- */
function vegOf() {
  return S.menu.filter(function (id) { var g = Core.byId(id); return g && g.chop; })[0];
}
function loadAndChop(id, ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'crate', i: S.menu.indexOf(id) }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
  MB.sendChef({ kind: 'board' }, ci);
  for (i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
  for (i = 0; i < 400 && !S.board.portions; i++) pump(0.05);
}
function tapBoard(ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'board' }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
}
function bin(ci) {
  ci = ci || 0;
  MB.sendChef({ kind: 'bin' }, ci);
  for (var i = 0; i < 400 && MB.chefAt(ci).target; i++) pump(0.05);
}

startShift(14);
var VEG = vegOf();
console.log('== A: conservation, take+bin x6 ==  veg=' + VEG);
loadAndChop(VEG);
var got = 0;
for (var k = 1; k <= 6; k++) {
  if (MB.chefAt(0).holding) bin(0);
  tapBoard(0);
  var h = MB.chefAt(0).holding;
  if (h) got++;
  console.log('  take ' + k + ': held=' + (h ? h.id + ' prepped=' + h.prepped : 'null') +
    ' | id=' + S.board.id + ' portions=' + S.board.portions + ' cut=' + S.board.cut.toFixed(2) +
    ' wet=' + S.board.wet);
}
console.log('  RESULT A: took ' + got + ' (expected 4)');

console.log('== C: 10 taps in ONE frame before arrival ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var before = S.board.portions;
for (var t = 0; t < 10; t++) MB.sendChef({ kind: 'board' }, 0);
for (var i = 0; i < 400 && MB.chefAt(0).target; i++) pump(0.05);
console.log('  RESULT C: portions ' + before + ' -> ' + S.board.portions +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));

console.log('== C2: arrive() called directly 10x on a standing cook ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
if (MB.chefAt(0).holding) bin(0);
var b2 = S.board.portions, taken2 = 0;
for (var q = 0; q < 10; q++) {
  MB.arrive({ kind: 'board' }, 0);
  if (MB.chefAt(0).holding) { taken2++; MB.chefAt(0).holding = null; }
}
console.log('  RESULT C2: 10 forced arrives took ' + taken2 + ' portions, portions=' +
  S.board.portions + ' id=' + S.board.id + ' wet=' + S.board.wet);

console.log('== D: tap the board every frame during the walk ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
if (MB.chefAt(0).holding) bin(0);
MB.sendChef({ kind: 'crate', i: S.menu.indexOf('bun') }, 0);
for (i = 0; i < 400 && MB.chefAt(0).target; i++) pump(0.05);
if (MB.chefAt(0).holding) bin(0);
var taps = 0;
MB.sendChef({ kind: 'board' }, 0);
for (i = 0; i < 200 && MB.chefAt(0).target; i++) { MB.sendChef({ kind: 'board' }, 0); taps++; pump(1 / 60); }
console.log('  RESULT D: ' + taps + ' taps -> portions=' + S.board.portions +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));

console.log('== F: day restart clears the board ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var old = S.board;
console.log('  before: id=' + S.board.id + ' portions=' + S.board.portions);
MB.startDay(14); pump(0.05);
console.log('  after:  id=' + S.board.id + ' portions=' + S.board.portions +
  ' same object? ' + (old === S.board));

console.log('== G: applySnapshot round trip ==');
MB.startDay(14); pump(0.05);
loadAndChop(VEG);
var snap = MB.snapshot();
console.log('  snapshot board: ' + JSON.stringify(snap.board));
var keep = S.board;
MB.applySnapshot(snap);
console.log('  after apply: ' + JSON.stringify(S.board) + ' rebuilt=' + (keep !== S.board));

console.log('== N: 200 load/chop/drain cycles ==');
MB.startDay(14); pump(0.05);
var vegIn = 0, portionsOut = 0, bad = 0;
for (var n = 0; n < 200; n++) {
  if (MB.chefAt(0).holding) bin(0);
  loadAndChop(VEG);
  vegIn++;
  var c2 = 0;
  while (S.board.portions) {
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c2++; portionsOut++; }
    if (c2 > 20) { bad++; break; }
  }
  if (c2 !== 4) bad++;
}
console.log('  RESULT N: ' + vegIn + ' vegetables in, ' + portionsOut + ' portions out, anomalies=' + bad);

console.log('== W: wet saturation over many vegetables ==');
console.log('  wet=' + S.board.wet + ' juice=' + S.board.juice + ' id=' + S.board.id +
  ' portions=' + S.board.portions + ' cut=' + S.board.cut);

console.log('== N2: 200 cycles with the clock held open ==');
MB.startDay(14); pump(0.05);
var vegIn2 = 0, out2 = 0, bad2 = 0, log2 = [];
for (var n2 = 0; n2 < 200; n2++) {
  S.timeLeft = 9999;
  if (MB.chefAt(0).holding) bin(0);
  if (MB.chefAt(0).holding) { log2.push('cycle ' + n2 + ': bin failed, screen=' + S.screen); break; }
  loadAndChop(VEG);
  if (!S.board.portions) { log2.push('cycle ' + n2 + ': never chopped, board=' + JSON.stringify(S.board)); break; }
  vegIn2++;
  var c3 = 0;
  while (S.board.portions && c3 < 20) {
    S.timeLeft = 9999;
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c3++; out2++; }
    else { log2.push('cycle ' + n2 + ': empty take with portions=' + S.board.portions); break; }
  }
  if (c3 !== 4) { bad2++; log2.push('cycle ' + n2 + ': got ' + c3 + ' portions, board=' + JSON.stringify(S.board)); }
}
console.log('  RESULT N2: ' + vegIn2 + ' in, ' + out2 + ' out, anomalies=' + bad2 + ' screen=' + S.screen);
log2.slice(0, 6).forEach(function (l) { console.log('    ' + l); });
console.log('  board now: ' + JSON.stringify(S.board));

console.log('== N3: 300 cycles, day restarted whenever service ends ==');
var vegIn3 = 0, out3 = 0, bad3 = 0, log3 = [];
MB.startDay(14); pump(0.05);
for (var n3 = 0; n3 < 300; n3++) {
  if (S.screen !== 'service') { MB.startDay(14); pump(0.05); }
  S.timeLeft = 9999; S.hearts = 3;
  if (MB.chefAt(0).holding) bin(0);
  if (MB.chefAt(0).holding) { log3.push('n=' + n3 + ' bin failed'); MB.chefAt(0).holding = null; }
  loadAndChop(VEG);
  if (!S.board.portions) { log3.push('n=' + n3 + ' not chopped ' + JSON.stringify(S.board)); continue; }
  vegIn3++;
  var c4 = 0;
  while (S.board.portions && c4 < 20) {
    S.timeLeft = 9999; S.hearts = 3;
    if (MB.chefAt(0).holding) bin(0);
    tapBoard(0);
    if (MB.chefAt(0).holding) { c4++; out3++; } else break;
  }
  if (c4 !== 4) { bad3++; log3.push('n=' + n3 + ' got ' + c4 + ' board=' + JSON.stringify(S.board)); }
}
console.log('  RESULT N3: ' + vegIn3 + ' in, ' + out3 + ' out (expect ' + (vegIn3 * 4) + '), anomalies=' + bad3);
log3.slice(0, 5).forEach(function (l) { console.log('    ' + l); });

console.log('== E: co-op host, two cooks both drawing off one vegetable ==');
S.coop = true;
if (typeof MB.enterRoom === 'function') { try { MB.enterRoom(); } catch (e) { console.log('  enterRoom threw: ' + e.message); } }
MB.startDay(14); pump(0.05);
console.log('  chefs=' + S.chefs.length + ' role=' + S.role);
if (S.chefs.length > 1) {
  S.timeLeft = 9999;
  loadAndChop(VEG, 0);
  var tot = 0;
  for (var r = 0; r < 6; r++) {
    S.timeLeft = 9999;
    var ci = r % 2;
    if (MB.chefAt(ci).holding) bin(ci);
    tapBoard(ci);
    if (MB.chefAt(ci).holding) tot++;
    console.log('   cook' + ci + ' -> total=' + tot + ' id=' + S.board.id + ' portions=' + S.board.portions);
  }
  console.log('  RESULT E: two cooks took ' + tot + ' (expected 4)');
} else {
  console.log('  RESULT E: could not force two cooks in the harness');
}

console.log('== H: guest never mutates the board locally ==');
MB.startDay(14); pump(0.05);
S.role = 'guest';
var g0 = JSON.stringify(S.board);
MB.chefAt(0).target = { kind: 'board' };
MB.chefAt(0).tx = MB.chefAt(0).x; MB.chefAt(0).ty = MB.chefAt(0).y;
for (var z = 0; z < 60; z++) pump(1 / 60);
console.log('  guest board before=' + g0 + ' after=' + JSON.stringify(S.board) +
  ' holding=' + (MB.chefAt(0).holding ? MB.chefAt(0).holding.id : 'null'));
S.role = null;
