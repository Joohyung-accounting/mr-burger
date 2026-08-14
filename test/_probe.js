require('./_probe_harness.js');
var MB = global.MrBurger, S = MB.state, L = MB.layout;
var stage = global.document.getElementById('stage');

function setSize(w, h) {
  stage.clientWidth = w; stage.clientHeight = h;
  stage.getBoundingClientRect = function () {
    return { left: 0, top: 190, width: w, height: h, right: w, bottom: 190 + h };
  };
  MB.resize();
}

function inside(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

[[412, 400, 'phone'], [900, 620, 'desktop']].forEach(function (sz) {
  for (var day = 4; day <= 20; day += 2) {
    MB.startDay(day);
    setSize(sz[0], sz[1]);
    if (!L.board) { console.log(sz[2], 'day', day, 'NO BOARD'); continue; }
    var b = MB.boardRect(), f = L.floor;
    var hits = [];
    for (var i = 0; i < S.menu.length; i++) {
      var p = MB.standPoint({ kind: 'crate', i: i });
      if (inside(p, b)) hits.push(S.menu[i] + '@' + p.x.toFixed(1) + ',' + p.y.toFixed(1));
    }
    console.log(sz[2], 'day', day, 'crates', S.menu.length, 'hits', hits.length + '/' + S.menu.length,
      '| board y', b.y.toFixed(2), 'h', b.h.toFixed(2), 'x', b.x.toFixed(1), 'w', b.w.toFixed(1),
      '| floor y0', f.y0.toFixed(2), 'x0', f.x0.toFixed(1), 'x1', f.x1.toFixed(1),
      hits.length ? '\n       ' + hits.join(' ') : '');
  }
});
