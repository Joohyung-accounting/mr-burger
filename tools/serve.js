/*
 * Zero-dependency static server for local testing.
 *   node tools/serve.js [port] [--shots]
 *
 * --shots opens POST /__shot, which writes a data-URL body to www/__shot.png.
 * That is the whole screenshot harness: the page renders whatever it wants to
 * a canvas - a slice of the kitchen, the shell through an SVG foreignObject -
 * posts the data URL, and the file lands on disk where anything can open it.
 * Off by default and never in the app, so nothing shipped can write into the
 * directory being served. www/__shot.* is gitignored.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'www');
var args = process.argv.slice(2);
var SHOTS = args.indexOf('--shots') >= 0;
var PORT = parseInt(args.filter(function (a) { return a.charAt(0) !== '-'; })[0], 10) || 5173;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/*
 * GET /__shot.html - index.html with one shim in front of it.
 *
 * A tab nobody is looking at is never composited, so requestAnimationFrame
 * never fires and the kitchen canvas stays empty however long you wait. That
 * is exactly the tab a screenshot harness runs in. Drive the loop off a timer
 * instead and the game paints for real - same code, same layout, same art.
 * Only reachable under --shots, and it rewrites nothing on disk.
 */
/*
 * It also hands the page a __shot() that photographs the whole screen.
 *
 * The shell is DOM, so it goes through an SVG <foreignObject> - which means
 * stripping the comments this project writes with ---- rules (illegal in XML),
 * inlining the stylesheet, and pinning animations, because a snapshot samples
 * every one of them at t=0 and .sheet/.ticket start at opacity 0. The canvas
 * does not survive that trip, so the real one is pasted back over its own rect
 * afterwards. Result goes to POST /__shot.
 */
var RAF_SHIM = '<script>(function(){' +
  // A MessageChannel hop, not setTimeout: a hidden tab clamps timers to one a
  // second, which ran the shift twenty times slow because the loop clamps dt
  // per frame. Port messages are not throttled.
  'var ch=new MessageChannel(),q=[];' +
  'ch.port1.onmessage=function(){var c=q;q=[];for(var i=0;i<c.length;i++){try{c[i](performance.now())}catch(e){}}};' +
  'window.requestAnimationFrame=function(cb){q.push(cb);if(q.length===1)ch.port2.postMessage(0);return q.length;};' +
  'window.cancelAnimationFrame=function(){};' +
  'window.__shot=async function(extra){' +
  // Two things make the live DOM and the snapshot disagree about where
  // anything is, and canvases are pasted at their LIVE rects.
  //
  // 1. The SVG cannot load the webfonts, so it lays out in the fallback
  // face while the live DOM is still in Caprasimo/Figtree - and canvases,
  // which are pasted at their LIVE rects, then land a dozen pixels off what
  // the snapshot drew. Put the live page on the fallback stack for the
  // duration so both sides agree, then put it back.
  'var fb=document.createElement("style");' +
  'fb.textContent=":root{--font-heading:Trebuchet MS,sans-serif!important;--font-body:Trebuchet MS,sans-serif!important}*,*::before,*::after{animation:none!important;transition:none!important}";' +
  'document.head.appendChild(fb);document.body.offsetHeight;' +
  'var css=await (await fetch("css/style.css")).text();' +
  'var W=innerWidth,H=innerHeight,c=document.documentElement.cloneNode(true);' +
  'c.querySelectorAll("link,script").forEach(function(n){n.remove()});' +
  'var w=document.createTreeWalker(c,NodeFilter.SHOW_COMMENT),k=[];while(w.nextNode())k.push(w.currentNode);' +
  'k.forEach(function(n){n.remove()});' +
  'var st=document.createElement("style");' +
  'st.textContent=css+"*,*::before,*::after{animation:none!important}.modal{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}html,body{background:transparent!important}#stage{background:transparent!important}"+(extra||"");' +
  'c.querySelector("head").appendChild(st);c.setAttribute("xmlns","http://www.w3.org/1999/xhtml");' +
  'var svg=\'<svg xmlns="http://www.w3.org/2000/svg" width="\'+W+\'" height="\'+H+\'"><foreignObject width="100%" height="100%">\'+new XMLSerializer().serializeToString(c)+"</foreignObject></svg>";' +
  'var img=new Image(),done=new Promise(function(ok,no){img.onload=ok;img.onerror=function(){no(new Error("svg failed"))}});' +
  'img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);await done;' +
  'var cv=document.createElement("canvas");cv.width=W;cv.height=H;var g=cv.getContext("2d");' +
  // The app's real stacking order, rebuilt by hand: ground, then the kitchen
  // (bottom of #app, so a modal has to be able to cover it), then the whole DOM
  // with canvas backgrounds knocked out, then every other canvas - tickets and
  // shop previews are leaves that sit on top of their own opaque cards.
  'var paste=function(cn){var r=cn.getBoundingClientRect();if(!r.width||!cn.width)return;' +
  'g.save();g.beginPath();var rad=cn.id==="stage"?28:0;' +
  'if(g.roundRect)g.roundRect(r.x,r.y,r.width,r.height,rad);else g.rect(r.x,r.y,r.width,r.height);' +
  'g.clip();g.drawImage(cn,r.x,r.y,r.width,r.height);g.restore();};' +
  'var bg=getComputedStyle(document.body).backgroundColor;' +
  // A body painted with the background shorthand and gradients reports a
  // transparent background-color, which used to fill the ground white and
  // make every dark chrome element look washed out in the snapshot.
  'if(!bg||bg==="rgba(0, 0, 0, 0)"||bg==="transparent")bg=(getComputedStyle(document.documentElement).getPropertyValue("--bg-0")||"#150e0c").trim();' +
  'g.fillStyle=bg;g.fillRect(0,0,W,H);' +
  'var stage=document.getElementById("stage");if(stage)paste(stage);' +
  'g.drawImage(img,0,0);' +
  'var ms=document.querySelectorAll(".modal.show"),top=ms.length?ms[ms.length-1]:null;' +
  // A ticket canvas behind an open sheet is not on top of anything - only the
  // canvases inside the sheet are.
  'document.querySelectorAll("canvas").forEach(function(cn){' +
  'if(cn===stage)return;if(top&&!top.contains(cn))return;paste(cn);});' +
  'var done=await (await fetch("/__shot",{method:"POST",body:cv.toDataURL("image/png")})).text();' +
  'fb.remove();return done;};' +
  '})();<\/script>';

function serveShotPage(res) {
  fs.readFile(path.join(ROOT, 'index.html'), 'utf8', function (err, html) {
    if (err) { res.writeHead(500).end(String(err)); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html.replace('<head>', '<head>' + RAF_SHIM));
  });
}

// POST /__shot - body is a `data:image/...;base64,...` URL. Writes the decoded
// bytes to www/__shot.<ext> and answers with the filename it used.
function takeShot(req, res) {
  var body = '';
  req.on('data', function (c) {
    body += c;
    if (body.length > 24e6) { req.destroy(); }     // a phone screenshot is ~1MB
  });
  req.on('end', function () {
    var m = /^data:image\/(png|jpeg|webp);base64,/.exec(body);
    if (!m) { res.writeHead(400).end('expected a data:image/... URL'); return; }
    var name = '__shot.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFile(path.join(ROOT, name), Buffer.from(body.slice(m[0].length), 'base64'), function (err) {
      if (err) { res.writeHead(500).end(String(err)); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(name);
    });
  });
}

http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  if (rel === '/__shot' || rel === '/__shot.html') {
    if (!SHOTS) { res.writeHead(403).end('start with --shots'); return; }
    if (rel === '/__shot.html') { serveShotPage(res); return; }
    if (req.method === 'POST') { takeShot(req, res); return; }
    res.writeHead(405).end('POST a data URL');
    return;
  }

  var file = path.join(ROOT, rel);
  // Never serve outside www/, whatever the request path claims.
  if (path.relative(ROOT, file).startsWith('..')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('\n  Mr. Burger dev server');
  console.log('  http://localhost:' + PORT + '\n');
  if (SHOTS) console.log('  POST /__shot is open - data URLs land in www/__shot.*\n');
  console.log('  Tip: DevTools > Toggle device toolbar (Ctrl+Shift+M) to test touch.\n');
});
