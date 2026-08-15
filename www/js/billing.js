/*
 * Mr. Burger - the seam between the game and whatever is actually taking money.
 *
 * The game never talks to a payment provider. It asks this file for a price and
 * tells it to start a purchase; everything platform-shaped lives behind that.
 * There are three reasons it is a separate file rather than a few lines in the
 * store screen:
 *
 *   1. The web build and the Play build buy things completely differently, and
 *      neither of them should be a branch inside the UI.
 *   2. This project has no build step, so the adapter has to be swappable by
 *      dropping in a different implementation of the same five functions.
 *   3. Prices are not ours. The store owns them per territory, per tax rule,
 *      per promotion - so nothing in the catalogue hard-codes "$2.99". Prices
 *      arrive from the platform already formatted, or they do not arrive and
 *      the product is not offered.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS RUNNING TODAY: the sandbox.
 *
 * There is no billing provider wired up. `buy()` resolves as if the purchase
 * went through, and the store screen says so on its face - it is for building
 * and testing the flow, not for taking money, and it must never ship enabled.
 * `Billing.sandbox` is true so the UI can label itself honestly.
 *
 * ---------------------------------------------------------------------------
 * WHAT SHIPPING LOOKS LIKE (see DEPLOY.md for the store paperwork):
 *
 *   - Android: @capacitor-community/in-app-purchases or the Play Billing
 *     Library through a small plugin. Products are created in Play Console
 *     with the SKUs in Core.STORE - skins and gear as one-time non-consumables,
 *     the two till top-ups as consumables so they can be bought again.
 *   - Web: this stays a sandbox, or the store screen is hidden entirely
 *     (`Billing.available()` returning false already does that).
 *
 * ---------------------------------------------------------------------------
 * THE PART THAT IS NOT OPTIONAL: a purchase is not proof of a purchase.
 *
 * Everything below runs on the player's device, and the save it writes to is
 * the player's file. Entitlements kept only here are a convenience, not a
 * fact - anyone can edit them, and Core.sanitiseSave deliberately does not
 * pretend otherwise. What makes a purchase real is the receipt: the token from
 * the platform goes to the server, the server verifies it against Google's API,
 * and the server is what says what this account owns.
 *
 * `verify()` is where that call goes. It currently resolves true, because there
 * is nothing to verify a sandbox against. Until it is wired to worker/index.js
 * and the Play Developer API, treat local entitlements as cosmetic trust: fine
 * for skins, wrong for anything that would matter if forged.
 */
(function (root) {
  'use strict';

  var SANDBOX_DELAY = 420;         // long enough to see the button go busy

  var listeners = [];
  function emit(evt) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](evt); } catch (e) { /* a listener must not break a sale */ }
    }
  }

  /*
   * The sandbox adapter. Every real adapter implements these four methods and
   * nothing else, so swapping one in is a file change and not a refactor.
   */
  var sandbox = {
    id: 'sandbox',
    start: function () { return Promise.resolve(true); },
    // No prices from a platform, so the catalogue shows its tier instead.
    priceOf: function () { return null; },
    purchase: function (sku) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ ok: true, sku: sku, receipt: null, sandbox: true });
        }, SANDBOX_DELAY);
      });
    },
    restore: function () { return Promise.resolve([]); }
  };

  var adapter = sandbox;
  var started = false;
  var startPromise = null;

  function start() {
    if (!startPromise) {
      started = false;
      startPromise = Promise.resolve(adapter.start()).then(function (ok) {
        started = !!ok;
        return started;
      }, function () { started = false; return false; });
    }
    return startPromise;
  }

  var Billing = {
    /** True while no real provider is wired up. The store screen says so. */
    get sandbox() { return adapter === sandbox; },

    /**
     * Swap in a real adapter. Call before the store screen is opened; the
     * shape is { id, start, priceOf, purchase, restore } exactly as above.
     */
    use: function (impl) {
      adapter = impl || sandbox;
      startPromise = null;
      return start();
    },

    ready: start,

    /**
     * Whether to offer the store at all. A build with no provider and no
     * sandbox should not show a shop it cannot serve.
     */
    available: function () { return started; },

    /**
     * The platform's formatted price for a SKU, or null if it has not arrived.
     * Never formatted here: the store already did it, in the right currency
     * with the right tax, and guessing produces the wrong number somewhere.
     */
    priceOf: function (sku) {
      try { return adapter.priceOf(sku) || null; } catch (e) { return null; }
    },

    /**
     * Start a purchase. Resolves { ok: true, sku, receipt } or
     * { ok: false, reason } - 'cancelled' when the player backed out, which is
     * a normal outcome and not an error to report.
     */
    buy: function (sku) {
      if (!sku) return Promise.resolve({ ok: false, reason: 'no-sku' });
      return start().then(function (ready) {
        if (!ready) return { ok: false, reason: 'unavailable' };
        return adapter.purchase(sku);
      }).then(function (res) {
        res = res || { ok: false, reason: 'unknown' };
        if (res.ok) emit({ type: 'bought', sku: sku, receipt: res.receipt || null });
        return res;
      }, function (err) {
        return { ok: false, reason: (err && err.message) || 'failed' };
      });
    },

    /**
     * What this account already owns according to the platform - the answer to
     * "I bought this on my old phone". Returns SKUs, not product ids.
     */
    restore: function () {
      return start().then(function (ready) {
        return ready ? adapter.restore() : [];
      }).then(function (list) {
        return Array.isArray(list) ? list : [];
      }, function () { return []; });
    },

    /**
     * Where server-side receipt validation goes. Until this actually calls the
     * worker, a local entitlement is trust rather than proof - which is why
     * nothing sold moves a number the difficulty simulation reads.
     */
    verify: function (receipt) {
      if (!receipt) return Promise.resolve(true);   // sandbox has none
      return Promise.resolve(true);
    },

    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };

  if (typeof module === 'object' && module.exports) module.exports = Billing;
  else root.Billing = Billing;
})(typeof self !== 'undefined' ? self : this);
