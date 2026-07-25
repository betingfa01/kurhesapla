/*
 * FA01 Canli Kur Hesaplayici
 * Same calculation logic, same API endpoints, same UI/workflow as before.
 * Refactor only: readability, defensive error handling, small reliability
 * improvements (see accompanying CHANGES document).
 */
(function () {
  "use strict";

  var U = ["USD", "EUR", "TRY", "USDT", "TRX"];
  var E = Object.fromEntries(U.map(function (x) { return [x, document.getElementById(x)]; }));
  var active = "USD";
  var R = { USD: 1, EUR: 0.9, TRY: 40, USDT: 1, TRX: 0.3 };
  var STORE_KEY = "fa01";

  var refresh = document.getElementById("refresh");
  var dot = document.getElementById("dot");
  var state = document.getElementById("state");
  var timeEl = document.getElementById("time");

  // --- currency-input UX (caret always at end, fixed symbol, clear-on-first-backspace) --
  // Only USD/EUR/TRY show a fixed symbol prefix (wrapped in .amt in the HTML);
  // USDT/TRX inputs are untouched plain inputs, same as before.
  var SYM = { USD: "$", EUR: "€", TRY: "₺" };
  var freshFocus = {};

  function caretToEnd(x) {
    var el = E[x];
    var end = el.value.length;
    try { el.setSelectionRange(end, end); } catch (e) { /* not all input states support this */ }
  }

  // Keeps the symbol snug against the number (no leftover browser default
  // input width) without altering the outer box size/position at all.
  function sizeInput(x) {
    if (!SYM[x]) return;
    var el = E[x];
    el.style.width = Math.max(1, el.value.length) + "ch";
  }

  // --- helpers -------------------------------------------------------
  // Fix: replace ALL commas (was only the first one) so decimal parsing
  // never silently drops a stray comma; normal single-comma Turkish input
  // ("12,50") parses to the exact same number as before.
  function n(v) {
    return parseFloat(String(v).replace(/,/g, "."));
  }

  function f(v, d) {
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: d == null ? 2 : d,
      maximumFractionDigits: d == null ? 2 : d
    }).format(v);
  }

  // Safari private-browsing (and some locked-down webviews) can throw on
  // localStorage access. Wrap so a storage error never breaks the app.
  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  function saveCache(rates) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ R: rates, t: Date.now() }));
    } catch (e) {
      /* ignore quota/privacy-mode errors, non-fatal */
    }
  }

  // --- calculation (unchanged) ---------------------------------------
  function calc() {
    var a = n(E[active].value);
    if (!isFinite(a)) {
      // Active field is empty/invalid (e.g. just cleared) - clear every
      // other field too instead of leaving stale converted amounts.
      U.forEach(function (x) {
        if (x !== active) E[x].value = "";
        sizeInput(x);
      });
      return;
    }
    var usd =
      active === "USD" ? a :
      active === "EUR" ? a / R.EUR :
      active === "TRY" ? a / R.TRY :
      active === "USDT" ? a * R.USDT :
      a * R.TRX;
    var o = {
      USD: usd,
      EUR: usd * R.EUR,
      TRY: usd * R.TRY,
      USDT: usd / R.USDT,
      TRX: usd / R.TRX
    };
    U.forEach(function (x) {
      if (x !== active) E[x].value = o[x].toFixed(x === "TRX" ? 4 : 2);
      sizeInput(x);
    });
  }
  function paint() { calc(); }

  U.forEach(function (x) {
    var el = E[x];
    el.onfocus = function () {
      active = x;
      freshFocus[x] = true;
      // Covers focus gained via Tab/programmatically (no mousedown/touch).
      caretToEnd(x);
      setTimeout(function () { caretToEnd(x); }, 0);
    };
    el.oninput = function () {
      active = x;
      calc();
      caretToEnd(x);
      setTimeout(function () { caretToEnd(x); }, 0);
    };
    // Stop the browser from placing the caret at the tapped/clicked
    // position: take over the click entirely and force focus + caret to
    // the end instead. This is what previously let the caret land at the
    // start of the value on some browsers.
    el.addEventListener("mousedown", function (e) {
      e.preventDefault();
      el.focus();
      caretToEnd(x);
      setTimeout(function () { caretToEnd(x); }, 0);
    });
    el.addEventListener("touchend", function () {
      setTimeout(function () {
        el.focus();
        caretToEnd(x);
      }, 0);
    });
    // beforeinput (not keydown) so this works reliably with virtual/mobile
    // keyboards too. First Backspace/Delete right after focusing clears the
    // whole value in one press; afterwards, deletion behaves normally.
    el.addEventListener("beforeinput", function (e) {
      var wasFresh = freshFocus[x];
      freshFocus[x] = false;
      if (wasFresh && (e.inputType === "deleteContentBackward" || e.inputType === "deleteContentForward")) {
        e.preventDefault();
        el.value = "";
        active = x;
        calc();
      }
    });
    sizeInput(x);
  });

  // --- networking ------------------------------------------------------
  function get(url, timeoutMs) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, timeoutMs || 9000);
    return fetch(url, { cache: "no-store", signal: c.signal })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .finally(function () { clearTimeout(t); });
  }

  // FX rates: same primary provider as before (open.er-api.com). Adds one
  // silent fallback provider (frankfurter.app) that only kicks in if the
  // primary is unreachable, so normal-path numbers are byte-for-byte the
  // same as before; only the failure case gets more resilient.
  function getFx() {
    return get("https://open.er-api.com/v6/latest/USD")
      .then(function (fx) {
        if (!fx || !fx.rates || !fx.rates.TRY || !fx.rates.EUR) throw new Error("Döviz yok");
        return { EUR: Number(fx.rates.EUR), TRY: Number(fx.rates.TRY) };
      })
      .catch(function () {
        return get("https://api.frankfurter.app/latest?from=USD&to=EUR,TRY").then(function (fx2) {
          if (!fx2 || !fx2.rates || !fx2.rates.TRY || !fx2.rates.EUR) throw new Error("Döviz yok");
          return { EUR: Number(fx2.rates.EUR), TRY: Number(fx2.rates.TRY) };
        });
      });
  }

  // Crypto rates: identical OKX -> CoinGecko fallback chain as before.
  function getCrypto() {
    return get("https://www.okx.com/api/v5/market/ticker?instId=TRX-USDT")
      .then(function (o) {
        var trx = Number(o && o.data && o.data[0] && o.data[0].last);
        if (!(trx > 0)) throw new Error("OKX yok");
        return { trx: trx, usdt: 1, source: "OKX" };
      })
      .catch(function () {
        return get("https://api.coingecko.com/api/v3/simple/price?ids=tether,tron&vs_currencies=usd").then(function (c) {
          var trx = Number(c && c.tron && c.tron.usd);
          var usdt = Number((c && c.tether && c.tether.usd) || 1);
          if (!(trx > 0)) throw new Error("Kripto yok");
          return { trx: trx, usdt: usdt, source: "CoinGecko yedek" };
        });
      });
  }

  var isUpdating = false;
  var lastAttempt = 0;

  async function update() {
    if (isUpdating) return; // guards against overlapping timer/manual/reconnect refreshes
    isUpdating = true;
    lastAttempt = Date.now();
    refresh.disabled = true;
    refresh.textContent = "GÜNCELLENİYOR…";
    try {
      // FX and crypto are independent, so fetch them in parallel (was
      // sequential before) — same requirement that BOTH must succeed,
      // just faster.
      var results = await Promise.all([getFx(), getCrypto()]);
      var fx = results[0], crypto = results[1];
      R = { USD: 1, EUR: fx.EUR, TRY: fx.TRY, USDT: crypto.usdt, TRX: crypto.trx };
      saveCache(R);
      paint();
      dot.className = "dot ok";
      state.textContent = "CANLI VERİ • " + crypto.source;
      timeEl.textContent = "Son güncelleme: " + new Date().toLocaleString("tr-TR");
    } catch (e) {
      var c = loadCache();
      if (c) {
        R = c.R;
        paint();
        state.textContent = "Bağlantı yok • Son kayıtlı kurlar";
        timeEl.textContent = "Kayıt: " + new Date(c.t).toLocaleString("tr-TR");
      } else {
        state.textContent = "Veriler alınamadı. Tekrar deneyin.";
      }
      dot.className = "dot err";
    } finally {
      refresh.disabled = false;
      refresh.textContent = "KURLARI YENİLE";
      isUpdating = false;
    }
  }

  refresh.onclick = update;

  var cached = loadCache();
  if (cached) {
    R = cached.R;
    paint();
  }
  update();
  setInterval(update, 300000);

  // Reliability extras (no UI/workflow change): retry promptly if the
  // device just came back online, or if the app was reopened long after
  // the last attempt. Debounced so it never fires more often than the
  // regular 5-minute cycle would.
  window.addEventListener("online", function () {
    if (Date.now() - lastAttempt > 15000) update();
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && Date.now() - lastAttempt > 60000) update();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {
        /* non-fatal: app still works fully online without SW */
      });
    });
  }
})();
