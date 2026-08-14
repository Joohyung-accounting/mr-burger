'use strict';
// Real walk: drive the game's own movement code and sample the cook each frame.
var H = require('./_tmp_harness.js');
var MB = H.MB, S = H.S, L = H.L, pump = H.pump;

var day = +process.env.DAY || 14;
MB.startDay(day);
pump(0.05);
if (!S.board) { console.log('day ' + day + ': no board'); process.exit(0); }

var b = L.board;
var counter = { x: b.x, y: b.y + b.h * 0.56, w: b.w, h: b.h * 0.44 };  // the drawn slab
var frontEdge = b.y + b.h;
console.log('canvas ' + L.W + 'x' + L.H + ' day ' + day +
  ' | board rect y ' + b.y.toFixed(1) + '..' + frontEdge.toFixed(1) +
  ' x ' + b.x.toFixed(1) + '..' + (b.x + b.w).toFixed(1) +
  ' | chefS ' + L.chefS.toFixed(1));

function run(label, target) {
  var c = S.chefs[0];
  MB.sendChef(target, 0);
  var frames = 0, bodyOver = 0, feetIn = 0, behindButDrawnInFront = 0;
  var halfW = L.chefS * 0.30, bodyH = L.chefS * 0.87;
  while (c.target && frames < 2000) {
    pump(0.025);
    frames++;
    var bx0 = c.x - halfW, bx1 = c.x + halfW, by0 = c.y - bodyH, by1 = c.y;
    var xo = bx1 > b.x && bx0 < b.x + b.w;
    if (xo && by1 > b.y && by0 < frontEdge) bodyOver++;
    if (c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= frontEdge) feetIn++;
    // z-order error: feet above the table's front edge (cook is BEHIND it)
    // yet drawChefs runs after drawPrepBoard, so he is painted over it.
    if (xo && c.y < frontEdge && by1 > counter.y - bodyH) behindButDrawnInFront++;
  }
  console.log('  ' + label + ': ' + frames + ' frames, feet inside board rect ' + feetIn +
    ', body overlapping board ' + bodyOver + ', painted-in-front-while-behind ' + behindButDrawnInFront +
    ' | end ' + c.x.toFixed(1) + ',' + c.y.toFixed(1));
}

run('crate0 -> crateN', { kind: 'crate', i: 0 });
run('crateN', { kind: 'crate', i: S.menu.length - 1 });
run('-> grill0', { kind: 'grill', i: 0 });
run('-> plate0', { kind: 'plate', i: 0 });
run('-> grill0', { kind: 'grill', i: 0 });
run('-> crate0', { kind: 'crate', i: 0 });
