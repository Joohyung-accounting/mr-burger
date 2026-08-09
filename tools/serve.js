/*
 * Zero-dependency static server for local testing.
 *   node tools/serve.js [port]
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', 'www');
var PORT = parseInt(process.argv[2], 10) || 5173;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

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
  console.log('  Tip: DevTools > Toggle device toolbar (Ctrl+Shift+M) to test touch.\n');
});
