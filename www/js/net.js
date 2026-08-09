/*
 * Mr. Burger - everything that leaves the device.
 *
 * Three jobs: who you are (an anonymous id, no passwords), your save in the
 * cloud, and the co-op socket. All of it is optional - if the network is gone
 * the game runs exactly as before off localStorage, so nothing here may throw
 * into the game loop.
 */
(function (root) {
  'use strict';

  var ID_KEY = 'mb_player_v1';
  var NAME_KEY = 'mb_name_v1';
  var PUSH_DEBOUNCE = 1200;

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* private mode */ }
    return null;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (opts.body) opts.headers['Content-Type'] = 'application/json';
    return fetch('/api/' + path, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        return { status: r.status, ok: r.ok, body: body };
      });
    });
  }

  var Net = {
    online: false,
    id: null,
    name: null,
    _pushTimer: null,
    _pending: null,

    /* ---------------------------------------------------------- identity */
    /** Resolves once we know who we are. Never rejects. */
    init: function () {
      var self = this;
      self.id = store(ID_KEY);
      self.name = store(NAME_KEY) || null;
      return api('player', {
        method: 'POST',
        body: JSON.stringify({ id: self.id || undefined, name: self.name || undefined })
      }).then(function (r) {
        if (!r.ok || !r.body || !r.body.id) throw new Error('no id');
        self.id = r.body.id;
        self.name = r.body.name;
        store(ID_KEY, self.id);
        store(NAME_KEY, self.name);
        self.online = true;
        return self;
      }).catch(function () {
        self.online = false;      // offline is a normal state, not an error
        return self;
      });
    },

    setName: function (name) {
      var self = this;
      self.name = name;
      store(NAME_KEY, name);
      if (!self.online || !self.id) return Promise.resolve(false);
      return api('player', {
        method: 'POST', body: JSON.stringify({ id: self.id, name: name })
      }).then(function (r) { return !!r.ok; }).catch(function () { return false; });
    },

    /* ------------------------------------------------------------- saves */
    pull: function () {
      if (!this.online || !this.id) return Promise.resolve(null);
      return api('save?id=' + encodeURIComponent(this.id))
        .then(function (r) { return r.ok && r.body ? r.body.save : null; })
        .catch(function () { return null; });
    },

    /**
     * Coalesced: the game calls this on every save, which during a shift can be
     * several times a minute. Only the last one in a window actually goes out.
     */
    push: function (save, bestDay, bestEarned) {
      var self = this;
      if (!self.online || !self.id) return;
      self._pending = {
        id: self.id, save: save, name: self.name,
        bestDay: bestDay || 0, bestEarned: bestEarned || 0
      };
      if (self._pushTimer) return;
      self._pushTimer = setTimeout(function () {
        var payload = self._pending;
        self._pending = null;
        self._pushTimer = null;
        if (!payload) return;
        api('save', { method: 'PUT', body: JSON.stringify(payload) })
          .catch(function () { self.online = false; });
      }, PUSH_DEBOUNCE);
    },

    /* ------------------------------------------------------- leaderboard */
    leaderboard: function (limit) {
      if (!this.online) return Promise.resolve(null);
      return api('leaderboard?limit=' + (limit || 20) + '&id=' + encodeURIComponent(this.id || ''))
        .then(function (r) { return r.ok ? r.body : null; })
        .catch(function () { return null; });
    },

    /* --------------------------------------------------- device transfer */
    makeCode: function () {
      if (!this.online || !this.id) return Promise.resolve(null);
      return api('link', { method: 'POST', body: JSON.stringify({ id: this.id }) })
        .then(function (r) { return r.ok && r.body ? r.body.code : null; })
        .catch(function () { return null; });
    },

    /** Takes over the identity behind a transfer code. Returns the save. */
    claim: function (code) {
      var self = this;
      return api('claim', { method: 'POST', body: JSON.stringify({ code: code }) })
        .then(function (r) {
          if (!r.ok || !r.body || !r.body.id) {
            return { error: (r.body && r.body.error) || 'that code did not work' };
          }
          self.id = r.body.id;
          self.name = r.body.name;
          store(ID_KEY, self.id);
          store(NAME_KEY, self.name);
          return { id: self.id, name: self.name, save: r.body.save };
        })
        .catch(function () { return { error: 'could not reach the server' }; });
    },

    /* --------------------------------------------------------- co-op room */
    room: null,
    role: null,

    /**
     * handlers: { onRole(role), onPeer(joined), onMessage(msg), onClose(reason) }
     * The socket is a dumb relay; whoever joins first is the host and keeps
     * simulating, so nothing about the game engine has to move to the server.
     */
    connect: function (code, handlers) {
      var self = this;
      self.leave();
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      var ws;
      try {
        ws = new WebSocket(proto + location.host + '/api/room/' + encodeURIComponent(code));
      } catch (e) {
        handlers.onClose && handlers.onClose('could not open a room');
        return;
      }
      self.room = ws;
      self.role = null;

      ws.onmessage = function (evt) {
        var msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }
        if (msg.type === 'joined') {
          self.role = msg.role;
          handlers.onRole && handlers.onRole(msg.role);
          return;
        }
        if (msg.type === 'peer') {
          handlers.onPeer && handlers.onPeer(!!msg.joined, !!msg.hostLeft);
          return;
        }
        handlers.onMessage && handlers.onMessage(msg);
      };
      ws.onclose = function () {
        if (self.room === ws) { self.room = null; self.role = null; }
        handlers.onClose && handlers.onClose('the room closed');
      };
      ws.onerror = function () {
        handlers.onClose && handlers.onClose('the room could not be reached');
      };
    },

    send: function (obj) {
      if (!this.room || this.room.readyState !== 1) return false;
      try { this.room.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    },

    leave: function () {
      if (this.room) {
        try { this.room.onclose = null; this.room.close(); } catch (e) { /* gone */ }
      }
      this.room = null;
      this.role = null;
    },

    /** A room code the player can read out loud. */
    newRoomCode: function () {
      var A = 'BCDFGHJKLMNPQRSTVWXZ23456789';
      var out = '';
      for (var i = 0; i < 5; i++) out += A[Math.floor(Math.random() * A.length)];
      return out;
    }
  };

  root.Net = Net;
})(typeof self !== 'undefined' ? self : this);
