var H = require('./_harness_tmp.js');
var MB = H.MB, S = H.S, L = H.L, stage = H.stage;
var STAGE_TOP = 190;
function tap(r){ stage._fire('pointerdown', {clientX:r.x+r.w/2, clientY:r.y+r.h/2+STAGE_TOP, pointerId:1, preventDefault:function(){}}); }
function work(r){ tap(r); for(var i=0;i<400 && S.chef.target;i++) H.pump(0.05); return S.chef.target===null; }
MB.startDay(10); H.pump(0.05);
var sp=MB.standPoint({kind:'board'}), g=MB.standPoint({kind:'grill',i:0});
console.log('board sp', sp, 'grill0 sp', g, 'dist', Math.hypot(sp.x-g.x,sp.y-g.y).toFixed(2));
// stand at grill0 first
console.log('walk to grill0 ok:', work(MB.slotRect(0)), 'chef at', S.chef.x.toFixed(1), S.chef.y.toFixed(1));
// pick up a veg then tap the board while already standing on that pixel
var vi = S.menu.indexOf('tomato'); console.log('menu', S.menu.join(','));
var veg = null;
for (var i=0;i<S.menu.length;i++){ var ing=H.Core.ING[S.menu[i]]; if(ing && ing.chop){veg=i;break;} }
console.log('veg crate idx', veg, S.menu[veg]);
console.log('grab veg ok:', work(MB.crateRect(veg)), 'holding', JSON.stringify(S.chef.holding));
console.log('chef now at', S.chef.x.toFixed(1), S.chef.y.toFixed(1));
// walk back to grill0 to sit exactly on the shared pixel
work(MB.slotRect(0));
console.log('at grill0 pixel:', S.chef.x.toFixed(1), S.chef.y.toFixed(1), 'holding', JSON.stringify(S.chef.holding));
console.log('board before', JSON.stringify(S.board));
console.log('tap board reached:', work(MB.boardRect()));
console.log('board after ', JSON.stringify(S.board));
