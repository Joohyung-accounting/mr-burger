/*
 * Mr. Burger - synthesized diner sounds. Every cue is generated with WebAudio
 * at runtime, so the app ships no audio files and starts instantly.
 */
(function (root) {
  'use strict';

  var Sfx = {
    ctx: null,
    master: null,
    muted: false,

    init: function () {
      if (!this.ctx) {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted: function (m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.45;
    },

    tone: function (o) {
      if (!this.ctx || this.muted) return;
      var t0 = this.ctx.currentTime + (o.delay || 0);
      var dur = o.dur || 0.12;
      var osc = this.ctx.createOscillator();
      var gain = this.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t0);
      if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(o.vol || 0.16, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    noise: function (o) {
      if (!this.ctx || this.muted) return;
      var t0 = this.ctx.currentTime + (o.delay || 0);
      var dur = o.dur || 0.2;
      var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var data = buf.getChannelData(0);
      var decay = o.sustain ? 0.35 : 1;
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      var filter = this.ctx.createBiquadFilter();
      filter.type = o.filterType || 'bandpass';
      filter.frequency.setValueAtTime(o.freq || 1200, t0);
      if (o.toFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.toFreq), t0 + dur);
      filter.Q.value = o.q || 1.0;
      var gain = this.ctx.createGain();
      gain.gain.setValueAtTime(o.vol || 0.18, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    /* ----------------------------------------------------------- cues */
    tap: function () {
      this.tone({ freq: 620, toFreq: 780, dur: 0.05, type: 'triangle', vol: 0.09 });
    },

    // Picking something up off the counter.
    lift: function () {
      this.tone({ freq: 440, toFreq: 660, dur: 0.06, type: 'sine', vol: 0.08 });
    },

    // Pinning a ticket to a plate.
    link: function () {
      this.tone({ freq: 700, dur: 0.08, type: 'triangle', vol: 0.12 });
      this.tone({ freq: 1050, dur: 0.12, type: 'triangle', vol: 0.10, delay: 0.06 });
    },

    // Bounced off an invalid drop target.
    reject: function () {
      this.tone({ freq: 260, toFreq: 170, dur: 0.11, type: 'square', vol: 0.08 });
    },

    // Wet slap of a topping landing on the stack.
    stack: function (n) {
      this.tone({ freq: 240 + Math.min(n, 8) * 22, toFreq: 150, dur: 0.08, type: 'sine', vol: 0.13 });
      this.noise({ freq: 700, toFreq: 260, dur: 0.07, vol: 0.09 });
    },

    squirt: function () {
      this.noise({ freq: 500, toFreq: 2200, dur: 0.16, vol: 0.12, filterType: 'bandpass', q: 3 });
    },

    sizzle: function () {
      this.noise({ freq: 3200, toFreq: 1800, dur: 0.55, vol: 0.16, filterType: 'highpass', q: 0.6, sustain: true });
    },

    perfect: function () {
      [784, 988, 1319].forEach(function (f, i) {
        Sfx.tone({ freq: f, dur: 0.20, type: 'triangle', vol: 0.15, delay: i * 0.055 });
      });
    },

    thud: function () {
      this.tone({ freq: 180, toFreq: 90, dur: 0.16, type: 'sine', vol: 0.14 });
    },

    burnt: function () {
      this.noise({ freq: 320, toFreq: 120, dur: 0.32, vol: 0.16, filterType: 'lowpass' });
      this.tone({ freq: 140, toFreq: 70, dur: 0.3, type: 'sawtooth', vol: 0.10 });
    },

    // Old-school register: a bright ding, then the drawer.
    register: function () {
      this.tone({ freq: 1480, dur: 0.13, type: 'triangle', vol: 0.16 });
      this.tone({ freq: 1970, dur: 0.20, type: 'triangle', vol: 0.11, delay: 0.03 });
      this.noise({ freq: 900, toFreq: 300, dur: 0.22, vol: 0.11, delay: 0.10 });
    },

    fanfare: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        Sfx.tone({ freq: f, dur: 0.34, type: 'triangle', vol: 0.16, delay: i * 0.10 });
      });
    },

    buzzer: function () {
      this.tone({ freq: 190, dur: 0.30, type: 'square', vol: 0.13 });
      this.tone({ freq: 148, dur: 0.36, type: 'square', vol: 0.13, delay: 0.10 });
    },

    // Shop door chime when a customer walks in.
    doorbell: function () {
      this.tone({ freq: 1318, dur: 0.22, type: 'sine', vol: 0.13 });
      this.tone({ freq: 1046, dur: 0.30, type: 'sine', vol: 0.12, delay: 0.10 });
    },

    walkout: function () {
      [440, 349, 262].forEach(function (f, i) {
        Sfx.tone({ freq: f, dur: 0.26, type: 'triangle', vol: 0.13, delay: i * 0.11 });
      });
    },

    warn: function () {
      this.tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.07 });
    },

    trash: function () {
      this.noise({ freq: 1600, toFreq: 400, dur: 0.24, vol: 0.13 });
    },

    upgrade: function () {
      [659, 880, 1175].forEach(function (f, i) {
        Sfx.tone({ freq: f, dur: 0.26, type: 'sine', vol: 0.15, delay: i * 0.07 });
      });
    },

    fail: function () {
      [392, 330, 262, 196].forEach(function (f, i) {
        Sfx.tone({ freq: f, dur: 0.40, type: 'triangle', vol: 0.15, delay: i * 0.15 });
      });
    }
  };

  root.Sfx = Sfx;

  /* ======================================================================
   * Bgm - the diner's backing track.
   *
   * Composed here rather than shipped as a file: the project carries zero
   * assets, and a generated loop has no licence attached to it, which matters
   * for a store release. It is a ii-V-I turnaround (Dm7 - G7 - Cmaj7 - A7)
   * with a walking bass, swung hats and light comping.
   *
   * Scheduled with a lookahead clock rather than timers-per-note: setTimeout
   * is far too jittery to keep a groove.
   * ==================================================================== */
  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // per bar: walking bass line (4 quarter notes) + a comping voicing
  var CHART = [
    { bass: [38, 45, 41, 42], comp: [53, 57, 60], lead: [69, 72, 74, 72] }, // Dm7
    { bass: [43, 50, 47, 48], comp: [53, 59, 62], lead: [71, 74, 77, 74] }, // G7
    { bass: [36, 43, 40, 44], comp: [52, 55, 59], lead: [76, 79, 76, 72] }, // Cmaj7
    { bass: [45, 52, 48, 37], comp: [52, 55, 61], lead: [73, 76, 73, 69] }  // A7
  ];

  var STEPS_PER_BAR = 16;
  var TOTAL_STEPS = STEPS_PER_BAR * CHART.length;

  var Bgm = {
    bpm: 100,
    gain: null,
    timer: null,
    step: 0,
    nextTime: 0,
    playing: false,
    intensity: 0,

    start: function () {
      Sfx.init();
      if (!Sfx.ctx || this.playing) return;
      if (!this.gain) {
        this.gain = Sfx.ctx.createGain();
        this.gain.gain.value = 0.11;      // well under the effects
        this.gain.connect(Sfx.master);
      }
      this.playing = true;
      this.step = 0;
      this.nextTime = Sfx.ctx.currentTime + 0.1;
      var self = this;
      this.timer = setInterval(function () { self._tick(); }, 30);
    },

    stop: function () {
      this.playing = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },

    /** 0 = quiet shift, 1 = everyone is about to walk out. */
    setIntensity: function (v) {
      this.intensity = v < 0 ? 0 : (v > 1 ? 1 : v);
    },

    _stepDur: function () { return 60 / this.bpm / 4; },

    _tick: function () {
      if (!this.playing || !Sfx.ctx) return;
      var dur = this._stepDur();
      while (this.nextTime < Sfx.ctx.currentTime + 0.14) {
        this._play(this.step, this.nextTime, dur);
        this.step = (this.step + 1) % TOTAL_STEPS;
        this.nextTime += dur;
      }
    },

    _voice: function (freq, time, dur, type, vol, glide) {
      var ctx = Sfx.ctx;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), time + dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(vol, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(g).connect(this.gain);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    },

    _hit: function (time, dur, vol, hp) {
      var ctx = Sfx.ctx;
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(f).connect(g).connect(this.gain);
      src.start(time);
      src.stop(time + dur + 0.02);
    },

    _play: function (step, time, dur) {
      var bar = Math.floor(step / STEPS_PER_BAR);
      var pos = step % STEPS_PER_BAR;          // 0..15 sixteenths
      var chart = CHART[bar];
      var beat = pos / 4;
      var onBeat = pos % 4 === 0;
      var I = this.intensity;

      // swung off-beat eighths
      var swing = (pos % 4 === 2) ? dur * 0.32 : 0;
      var t = time + swing;

      if (onBeat) {
        this._voice(midi(chart.bass[beat]), t, dur * 3.2, 'triangle', 0.30);
      }
      if (pos === 0 || pos === 8) {
        this._voice(70, t, 0.16, 'sine', 0.42, 40);              // kick
      }
      if ((pos === 4 || pos === 12) && I > 0.30) {
        this._hit(t, 0.11, 0.16 + 0.10 * I, 1400);               // snare
      }
      if (pos % 2 === 0) {
        this._hit(t, 0.035, pos % 4 === 0 ? 0.075 : 0.045, 7000); // hats
      }
      // comping stabs land off the beat, and thicken as the shift heats up
      if (pos === 6 || pos === 14 || (I > 0.55 && pos === 10)) {
        for (var i = 0; i < chart.comp.length; i++) {
          this._voice(midi(chart.comp[i]), t, dur * 1.5, 'triangle', 0.055 + 0.02 * I);
        }
      }
      // a melody line only shows up when the board is under pressure
      if (I > 0.5 && onBeat) {
        this._voice(midi(chart.lead[beat]), t, dur * 2.4, 'sine', 0.035 * (I - 0.5) * 2);
      }
    }
  };

  root.Bgm = Bgm;
})(typeof self !== 'undefined' ? self : this);
