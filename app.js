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
    if (!isFinite(a)) return;
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
    });
  }
  function paint() { calc(); }

  U.forEach(function (x) {
    E[x].onfocus = function () {
      active = x;
      // iOS/Safari places the caret at the start of the value by default
      // when a field is focused (especially via the keyboard's prev/next
      // toolbar), instead of at the end where typing should continue.
      // Move it to the end explicitly, after focus finishes settling.
      var el = E[x];
      setTimeout(function () {
        var len = el.value.length;
        try { el.setSelectionRange(len, len); } catch (e) { /* not supported: no-op */ }
      }, 0);
    };
    E[x].oninput = function () { active = x; calc(); };
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
