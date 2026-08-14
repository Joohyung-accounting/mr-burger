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
var sizes = [[375,400,'phone375'],[412,400,'phone412'],[390,420,'phone390'],[900,620,'desktop900'],[1280,700,'desk1280']];
sizes.forEach(function (sz) {
  for (var day = 4; day <= 20; day += 2) {
    MB.startDay(day);
    setSize(sz[0], sz[1]);
    if (!L.board) { console.log(sz[2], 'd'+day, 'no board'); continue; }
    var r = L.board;
    var cb = L.counters[0].y + L.counters[0].h;
    var prepTop = r.y - r.h * 0.02;
    var prepH = r.h * 0.64;
    var seatTop = prepTop + prepH * 0.30;
    console.log(sz[2], 'd'+day,
      'k=' + L.k.toFixed(2),
      'crB=' + L.cratesBottom.toFixed(1),
      'ctrBot=' + cb.toFixed(1),
      'fy0=' + L.floor.y0.toFixed(1),
      'fy1=' + L.floor.y1.toFixed(1),
      'b.y=' + r.y.toFixed(1),
      'b.h=' + r.h.toFixed(1),
      'prepTop=' + prepTop.toFixed(2),
      'clr(prepTop-ctrBot)=' + (prepTop - cb).toFixed(2),
      'aboveFloor=' + (L.floor.y0 - r.y).toFixed(2),
      'seatTop=' + seatTop.toFixed(1),
      'floorLeftBelow=' + (L.floor.y1 - (r.y + r.h)).toFixed(1));
  }
});
