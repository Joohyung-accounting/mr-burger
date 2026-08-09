/*
 * Generates every image asset the app and the Play Store listing need,
 * straight from code - no design tool, no binary blobs in the repo.
 *
 *   node tools/make-icons.js
 *
 * The burger mark is rendered at 3x and box-downsampled, which gives clean
 * antialiasing on the dome and the wavy lettuce without any path machinery.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

/* ------------------------------------------------------------ PNG writer */
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(img) {
  var w = img.w, h = img.h, stride = w * 4;
  var raw = Buffer.alloc((stride + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* -------------------------------------------------------------- drawing */
function canvas(w, h) { return { w: w, h: h, data: Buffer.alloc(w * h * 4) }; }

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

/** Warm diner backdrop, matching the app's CSS background. */
function paintBackground(img) {
  var w = img.w, h = img.h;
  var top = [74, 42, 28], bottom = [15, 9, 8], glow = [122, 58, 30];
  var gx = w * 0.5, gy = h * 0.30, gr = w * 0.72;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var c = mix(top, bottom, clamp01(x / w * 0.25 + y / h * 0.85));
      var dx = x - gx, dy = y - gy;
      var d = Math.sqrt(dx * dx + dy * dy) / gr;
      if (d < 1) c = mix(c, glow, Math.pow(1 - d, 2.0) * 0.5);
      var i = (y * w + x) * 4;
      img.data[i] = Math.round(c[0]);
      img.data[i + 1] = Math.round(c[1]);
      img.data[i + 2] = Math.round(c[2]);
      img.data[i + 3] = 255;
    }
  }
}

/* --------------------------------------------------------- the burger --- */
// Everything below works in normalized mark space: x and y both run 0..1.

function inRoundRect(px, py, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  var qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  var qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  var ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r <= 0;
}

function inDome(px, py, cx, baseY, rx, ry) {
  if (py > baseY) return false;
  var dx = (px - cx) / rx, dy = (py - baseY) / ry;
  return dx * dx + dy * dy <= 1;
}

function inWavyBand(px, py, x, y, w, h, amp, waves, phase) {
  if (px < x || px > x + w) return false;
  var mid = y + h / 2 + amp * Math.sin((px - x) / w * waves * Math.PI * 2 + phase);
  return Math.abs(py - mid) <= h / 2;
}

var BUN_TOP = [[240, 192, 129], [201, 133, 69]];
var BUN_BOT = [[233, 181, 113], [192, 127, 61]];
var CHEESE = [[255, 210, 74], [240, 169, 31]];
var PATTY = [[124, 69, 39], [74, 39, 22]];
var LETTUCE = [[142, 215, 101], [79, 158, 52]];
var SEED = [255, 246, 223];

/**
 * Colour of the burger at normalized (px, py), or null for transparent.
 * Tested top-down so higher layers win the overlap.
 */
function burgerAt(px, py) {
  function shade(pair, y0, y1) { return mix(pair[0], pair[1], clamp01((py - y0) / (y1 - y0))); }

  // sesame seeds sit on top of the crown
  var seeds = [[0.36, 0.11], [0.50, 0.07], [0.64, 0.11], [0.43, 0.19], [0.57, 0.19]];
  for (var s = 0; s < seeds.length; s++) {
    var dx = (px - seeds[s][0]) / 0.045, dy = (py - seeds[s][1]) / 0.026;
    if (dx * dx + dy * dy <= 1) return SEED;
  }

  if (inDome(px, py, 0.5, 0.32, 0.46, 0.30)) return shade(BUN_TOP, 0.02, 0.32);
  if (inWavyBand(px, py, 0.00, 0.32, 1.00, 0.11, 0.018, 3.5, 0.5)) return shade(LETTUCE, 0.32, 0.43);
  if (inRoundRect(px, py, 0.03, 0.42, 0.94, 0.085, 0.03)) return shade(CHEESE, 0.42, 0.51);
  // cheese melting over the edges of the patty
  if (inRoundRect(px, py, 0.09, 0.46, 0.15, 0.075, 0.035)) return shade(CHEESE, 0.42, 0.54);
  if (inRoundRect(px, py, 0.43, 0.46, 0.14, 0.070, 0.033)) return shade(CHEESE, 0.42, 0.54);
  if (inRoundRect(px, py, 0.76, 0.46, 0.15, 0.075, 0.035)) return shade(CHEESE, 0.42, 0.54);
  if (inRoundRect(px, py, 0.04, 0.52, 0.92, 0.15, 0.07)) return shade(PATTY, 0.52, 0.67);
  if (inRoundRect(px, py, 0.06, 0.67, 0.88, 0.20, 0.09)) return shade(BUN_BOT, 0.67, 0.87);
  return null;
}

/** Render the mark at 3x and box-downsample for free antialiasing. */
function renderMark(size) {
  var SS = 3, big = size * SS;
  var acc = new Float64Array(size * size * 4);
  for (var by = 0; by < big; by++) {
    var py = (by + 0.5) / big;
    for (var bx = 0; bx < big; bx++) {
      var c = burgerAt((bx + 0.5) / big, py);
      if (!c) continue;
      var i = (Math.floor(by / SS) * size + Math.floor(bx / SS)) * 4;
      acc[i] += c[0]; acc[i + 1] += c[1]; acc[i + 2] += c[2]; acc[i + 3] += 255;
    }
  }
  var out = canvas(size, size);
  var per = SS * SS;
  for (var p = 0; p < size * size; p++) {
    var a = acc[p * 4 + 3] / 255;      // covered subsamples
    if (a <= 0) continue;
    out.data[p * 4] = Math.round(acc[p * 4] / a);
    out.data[p * 4 + 1] = Math.round(acc[p * 4 + 1] / a);
    out.data[p * 4 + 2] = Math.round(acc[p * 4 + 2] / a);
    out.data[p * 4 + 3] = Math.round(255 * Math.min(1, a / per));
  }
  return out;
}

/** Composite `mark` onto `dst` with its top-left at (ox, oy). */
function composite(dst, mark, ox, oy) {
  for (var y = 0; y < mark.h; y++) {
    var dy = oy + y;
    if (dy < 0 || dy >= dst.h) continue;
    for (var x = 0; x < mark.w; x++) {
      var dx = ox + x;
      if (dx < 0 || dx >= dst.w) continue;
      var si = (y * mark.w + x) * 4;
      var a = mark.data[si + 3] / 255;
      if (a <= 0) continue;
      var di = (dy * dst.w + dx) * 4;
      for (var k = 0; k < 3; k++) {
        dst.data[di + k] = Math.round(mark.data[si + k] * a + dst.data[di + k] * (1 - a));
      }
      dst.data[di + 3] = 255;
    }
  }
}

function makeIcon(size) {
  var img = canvas(size, size);
  paintBackground(img);
  var m = Math.round(size * 0.76);
  composite(img, renderMark(m), Math.round((size - m) / 2), Math.round((size - m) / 2));
  return img;
}

function makeSplash(size) {
  var img = canvas(size, size);
  paintBackground(img);
  var m = Math.round(size * 0.26);
  composite(img, renderMark(m), Math.round((size - m) / 2), Math.round((size - m) / 2));
  return img;
}

/* ----------------------------------------------------------------- main */
var root = path.join(__dirname, '..');

function write(rel, img) {
  var file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var png = encodePNG(img);
  fs.writeFileSync(file, png);
  console.log('  ' + rel + '  (' + img.w + 'x' + img.h + ', ' + (png.length / 1024).toFixed(1) + ' KB)');
}

console.log('\nGenerating assets...');
write('resources/icon.png', makeIcon(1024));
write('resources/splash.png', makeSplash(2732));
write('resources/splash-dark.png', makeSplash(2732));
write('www/icons/icon-512.png', makeIcon(512));
write('www/icons/icon-192.png', makeIcon(192));
write('www/icons/icon-180.png', makeIcon(180));
console.log('Done.\n');
