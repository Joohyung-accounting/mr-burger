'use strict';
var H = require('./_tmp_harness.js');
var MB = H.MB, S = H.S, L = H.L, pump = H.pump;

function segHitsRect(p, q, r, n) {
  n = n || 400;
  var hits = 0, first = null, last = null;
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    var x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      hits++;
      if (first === null) first = t;
      last = t;
    }
  }
  return hits ? { frac: hits / (n + 1), t0: first, t1: last } : null;
}

var days = [4, 5, 6, 7, 8, 10, 14, 20];
days.forEach(function (d) {
  MB.startDay(d);
  pump(0.05);
  if (!S.board) { console.log('day ' + d + ': no board (menu has no chop item)'); return; }
  var f = L.floor, b = L.board;
  var fw = f.x1 - f.x0;
  var counterTop = b.y + b.h * 0.56, counterBot = b.y + b.h;
  console.log('--- day ' + d + ' | canvas ' + L.W + 'x' + L.H + ' k=' + L.k.toFixed(3) +
    ' chefS=' + L.chefS.toFixed(1) + ' (body w~' + (L.chefS * 0.6).toFixed(1) + ')');
  console.log('  floor x ' + f.x0.toFixed(1) + '..' + f.x1.toFixed(1) + ' (w ' + fw.toFixed(1) + ')' +
    ' y ' + f.y0.toFixed(1) + '..' + f.y1.toFixed(1) + ' (h ' + (f.y1 - f.y0).toFixed(1) + ')');
  console.log('  board x ' + b.x.toFixed(1) + '..' + (b.x + b.w).toFixed(1) + ' (w ' + b.w.toFixed(1) +
    ', gutters ' + (b.x - f.x0).toFixed(1) + '/' + (f.x1 - b.x - b.w).toFixed(1) + ')' +
    ' y ' + b.y.toFixed(1) + '..' + (b.y + b.h).toFixed(1) + ' h=' + b.h.toFixed(1));
  console.log('  drawn counter slab y ' + counterTop.toFixed(1) + '..' + counterBot.toFixed(1));

  var pts = {};
  pts['grill0'] = MB.standPoint({ kind: 'grill', i: 0 });
  pts['grillN'] = MB.standPoint({ kind: 'grill', i: S.grill.length - 1 });
  pts['plate0'] = MB.standPoint({ kind: 'plate', i: 0 });
  pts['plateN'] = MB.standPoint({ kind: 'plate', i: S.plates.length - 1 });
  pts['crate0'] = MB.standPoint({ kind: 'crate', i: 0 });
  pts['crateN'] = MB.standPoint({ kind: 'crate', i: S.menu.length - 1 });
  pts['hatch'] = MB.standPoint({ kind: 'hatch' });
  pts['board'] = MB.standPoint({ kind: 'board' });
  Object.keys(pts).forEach(function (k) {
    console.log('    stand ' + k + ' = ' + pts[k].x.toFixed(1) + ',' + pts[k].y.toFixed(1));
  });

  var names = Object.keys(pts);
  for (var i = 0; i < names.length; i++) {
    for (var j = i + 1; j < names.length; j++) {
      var a = names[i], c = names[j];
      if (a === 'board' || c === 'board') continue;
      var hit = segHitsRect(pts[a], pts[c], b);
      var hitSlab = segHitsRect(pts[a], pts[c], { x: b.x, y: counterTop, w: b.w, h: b.h * 0.44 });
      if (hit) {
        console.log('    CROSS ' + a + '<->' + c + '  rect ' + (hit.frac * 100).toFixed(0) + '% of path' +
          (hitSlab ? ('  SLAB ' + (hitSlab.frac * 100).toFixed(0) + '%') : '  slab no'));
      }
    }
  }
});
