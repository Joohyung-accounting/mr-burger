var H = require('./_harness_tmp.js');
var MB = H.MB, S = H.S, L = H.L;
function r2(n){return Math.round(n*10)/10;}
console.log('\nSTAGE ' + H.VIEW_W + 'x' + H.VIEW_H);
[2,6,10,14].forEach(function(day){
  MB.startDay(day); H.pump(0.05);
  if (!L.board) return;
  var f=L.floor, r=MB.boardRect(), cs=L.chefS;
  var sp=MB.standPoint({kind:'board'});
  var wanted = r.x - 54*(L.k||1)*0.42;
  // drawPrepBoard geometry
  var bx = r.x + r.w*0.07, bw2 = r.w*0.86;
  // boardSeat: x0 = x + w*0.085 (handleSide default right, so no hx on left)
  var seatx0 = bx + bw2*0.085;
  var seatx1 = bx + bw2*0.915 - bw2*0.115;
  var seatw = seatx1-seatx0;
  var pileW = seatw*0.44*1.0;            // cut = 1 (fully chopped: worst case, widest pile)
  var pileLeft = seatx0 + seatw*0.015;   // pileX - pileW/2
  var bodyR = 0.297*cs, handR = 0.30*cs;
  console.log('day '+day+' cs='+r2(cs)
    +' | standX clamped='+r2(sp.x)+' wanted='+r2(wanted)
    +' | chef bodyRight='+r2(sp.x+bodyR)+' handRight='+r2(sp.x+handR)
    +' | boardRect.x='+r2(r.x)+' drawnSlabLeft='+r2(bx)+' seatLeft='+r2(seatx0)+' pileLeft='+r2(pileLeft));
  console.log('   overlap: slab='+r2(sp.x+handR-bx)+'  seat='+r2(sp.x+handR-seatx0)+'  pile='+r2(sp.x+handR-pileLeft)
    +'   (unclamped would be slab='+r2(wanted+handR-bx)+')');
});
