// PricePilot popup v0.2 (plain script, no modules)
(function () {
  'use strict';

  var g = window;
  var DEFAULT_WEIGHTS = (g.PricePilotScoring && g.PricePilotScoring.DEFAULT_WEIGHTS) || { price: 0.45, rating: 0.25, discount: 0.2, delivery: 0.1 };
  var DEFAULT_SETTINGS = { cards: [], alertsEnabled: true, checkIntervalHours: 6, overlayEnabled: true };
  var BANKS = ['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'IDFC First', 'Yes', 'IndusInd', 'AU', 'RBL', 'Bank of Baroda', 'HSBC', 'Standard Chartered', 'Amex', 'OneCard', 'Federal', 'Flipkart Axis', 'Amazon Pay ICICI'];
  var VERDICTS = {
    'great': ['Great', '#15803d'], 'good': ['Good', '#16a34a'], 'fair': ['Fair', '#ca8a04'],
    'wait': ['Wait', '#dc2626'], 'fake-discount': ['Fake discount', '#b91c1c'], 'insufficient-data': ['New', '#64748b']
  };

  var state = {
    items: [], history: {}, watchlist: {},
    weights: Object.assign({}, DEFAULT_WEIGHTS),
    settings: Object.assign({}, DEFAULT_SETTINGS),
    selected: new Set()
  };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (e) { return '#'; } }
  function money(n) { return n == null || isNaN(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'); }
  function ago(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function siteBadge(site) { return '<span class="site s-' + esc(site) + '">' + esc(site) + '</span>'; }
  function get(area, keys) {
    return new Promise(function (res) { try { chrome.storage[area].get(keys, function (r) { res(r || {}); }); } catch (e) { res({}); } });
  }
  function set(area, obj) {
    return new Promise(function (res) { try { chrome.storage[area].set(obj, function () { res(); }); } catch (e) { res(); } });
  }
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { if (chrome.runtime.lastError) res(null); else res(r); }); } catch (e) { res(null); }
    });
  }

  function analyzeItem(item) {
    if (!g.PricePilotHistory) return null;
    try { return g.PricePilotHistory.analyze(state.history[item.url] || [], item.price, item.mrp); } catch (e) { return null; }
  }
  function verdictChip(a) {
    var v = VERDICTS[(a && a.verdict) || 'insufficient-data'] || VERDICTS['insufficient-data'];
    return '<span class="chip" style="background:' + v[1] + '">' + v[0] + '</span>';
  }
  function sparkline(points, w, h) {
    if (!points || points.length < 2) return '';
    var ps = points.map(function (p) { return p.p; });
    var min = Math.min.apply(null, ps), max = Math.max.apply(null, ps), span = max - min || 1;
    var step = (w - 2) / (ps.length - 1);
    var d = ps.map(function (p, i) {
      return (i ? 'L' : 'M') + (1 + i * step).toFixed(1) + ' ' + (1 + (h - 2) * (1 - (p - min) / span)).toFixed(1);
    }).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="1.4"/></svg>';
  }
  function netPrice(item) {
    if (!g.PricePilotOffers || item.price == null || !state.settings.cards.length) return null;
    try { return g.PricePilotOffers.bestNetPrice(item.price, item.offers || [], state.settings.cards); } catch (e) { return null; }
  }
  function adjustedRating(item) {
    if (!g.PricePilotReviews || item.rating == null) return null;
    try { var a = g.PricePilotReviews.assess(item); return a && a.adjustedRating != null ? a.adjustedRating : null; } catch (e) { return null; }
  }

  // ---------- load ----------
  async function load() {
    var local = await get('local', ['trackedItems', 'priceHistory', 'watchlist']);
    var sync = await get('sync', ['weights', 'settings']);
    state.items = Array.isArray(local.trackedItems) ? local.trackedItems : [];
    state.history = local.priceHistory || {};
    state.watchlist = local.watchlist || {};
    if (sync.weights) state.weights = Object.assign({}, DEFAULT_WEIGHTS, sync.weights);
    state.settings = Object.assign({}, DEFAULT_SETTINGS, sync.settings || {});
    if (!Array.isArray(state.settings.cards)) state.settings.cards = [];
    var urls = new Set(state.items.map(function (i) { return i.url; }));
    state.selected.forEach(function (u) { if (!urls.has(u)) state.selected.delete(u); });
    renderAll();
  }

  function renderAll() {
    $('itemCount').textContent = state.items.length + ' tracked';
    renderCompare();
    renderWatch();
    renderFood();
    renderSettings();
  }

  // ---------- compare ----------
  function renderCompare() {
    var list = $('itemList');
    var items = state.items.slice().sort(function (a, b) { return Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0); });
    if (!items.length) {
      list.innerHTML = '<div class="empty">Nothing tracked yet. Open a product on Amazon or Flipkart, or a restaurant on Zomato or Swiggy, and it appears here.</div>';
    } else {
      list.innerHTML = items.map(function (item) {
        var a = analyzeItem(item);
        var np = netPrice(item);
        var ar = adjustedRating(item);
        var checked = state.selected.has(item.url) ? ' checked' : '';
        var priceHtml = '<b>' + money(item.price) + '</b>' + (np && np.savings > 0 ? ' <span class="good">→ ' + money(np.netPrice) + ' w/ card</span>' : '');
        var ratingHtml = item.rating != null ? item.rating + '★' + (ar != null ? ' <span title="Adjusted for review count">(' + Number(ar).toFixed(1) + ' adj)</span>' : '') : '';
        return '<div class="row" data-url="' + esc(item.url) + '">' +
          '<input type="checkbox" class="sel" aria-label="Select for comparison"' + checked + '>' +
          '<div class="main">' +
            '<a class="title" href="' + esc(safeUrl(item.url)) + '" target="_blank" rel="noopener noreferrer" title="' + esc(item.title) + '">' + esc(item.title || 'Untitled') + '</a>' +
            '<div class="meta">' + siteBadge(item.site) + priceHtml + (ratingHtml ? '<span>' + ratingHtml + '</span>' : '') +
              (item.discountPct != null ? '<span>' + item.discountPct + '% off</span>' : '') +
              (item.deliveryFee != null ? '<span>Delivery ' + money(item.deliveryFee) + '</span>' : '') +
              '<span>' + esc(ago(item.capturedAt)) + '</span></div>' +
          '</div>' +
          '<div class="side">' + verdictChip(a) + sparkline(state.history[item.url], 56, 18) +
            '<button class="x del" title="Remove" aria-label="Remove">✕</button></div>' +
        '</div>';
      }).join('');
    }
    var n = state.selected.size;
    $('compareBtn').disabled = n < 2;
    $('selHint').textContent = n < 2 ? 'Tick 2 or more items' : n + ' selected';
  }

  function bar(label, v) {
    v = Math.max(0, Math.min(100, Number(v) || 0));
    return '<div class="bar"><label><span>' + label + '</span><span>' + Math.round(v) + '</span></label><div class="track"><div class="fill" style="width:' + v + '%"></div></div></div>';
  }

  function runCompare() {
    var picked = state.items.filter(function (i) { return state.selected.has(i.url); });
    if (picked.length < 2 || !g.PricePilotScoring) return;
    var ranked;
    try { ranked = g.PricePilotScoring.computeScores(picked, state.weights, { cards: state.settings.cards }); } catch (e) { console.warn(e); return; }
    if (!ranked || !ranked.length) return;
    var top = ranked[0], b = top.scoreBreakdown || {};
    var eff = top.effectivePrice != null ? top.effectivePrice : top.price;
    var adj = top.adjustedRating != null ? top.adjustedRating : adjustedRating(top);
    var html = '<div class="best"><div class="tag">🏆 Best pick</div>' +
      '<div style="margin:4px 0;font-weight:700">' + siteBadge(top.site) + ' ' + esc(top.title) + '</div>' +
      '<div class="meta">Pay <b>' + money(eff) + '</b>' + (eff !== top.price ? ' (list ' + money(top.price) + ')' : '') +
        (adj != null ? '<span>Rating ' + Number(adj).toFixed(2) + '★ adj</span>' : '') + '<span>Score ' + Math.round(top.score) + '</span></div>' +
      '<div class="bars">' + bar('Price', b.priceScore) + bar('Rating', b.ratingScore) + bar('Discount', b.discountScore) + bar('Delivery', b.deliveryScore) + '</div></div>';
    html += ranked.map(function (r, i) {
      var e = r.effectivePrice != null ? r.effectivePrice : r.price;
      return '<div class="rank"><span class="n">#' + (i + 1) + '</span>' + siteBadge(r.site) + '<span class="t" title="' + esc(r.title) + '">' + esc(r.title) + '</span><span>' + money(e) + '</span><span class="s">' + Math.round(r.score) + '</span></div>';
    }).join('');
    var panel = $('resultPanel');
    panel.innerHTML = html;
    panel.hidden = false;
    panel.scrollIntoView({ block: 'nearest' });
  }

  // ---------- watchlist ----------
  function renderWatch() {
    var urls = Object.keys(state.watchlist);
    var box = $('watchList');
    if (!urls.length) {
      box.innerHTML = '<div class="empty">No price alerts yet. Use “Watch price” on the PricePilot panel on any product page.</div>';
      return;
    }
    var byUrl = {};
    state.items.forEach(function (i) { byUrl[i.url] = i; });
    box.innerHTML = urls.map(function (url) {
      var w = state.watchlist[url] || {};
      var item = byUrl[url];
      var pts = state.history[url] || [];
      var cur = pts.length ? pts[pts.length - 1].p : (item ? item.price : null);
      var low = pts.length ? Math.min.apply(null, pts.map(function (p) { return p.p; })) : cur;
      var hit = w.targetPrice != null && cur != null && cur <= w.targetPrice;
      return '<div class="row" data-url="' + esc(url) + '"><span>' + siteBadge(w.site || (item && item.site) || '') + '</span>' +
        '<div class="main"><a class="title" href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + esc(w.title || (item && item.title) || url) + '</a>' +
        '<div class="meta"><span>Now <b class="' + (hit ? 'good' : '') + '">' + money(cur) + '</b></span><span>Target ' + money(w.targetPrice) + '</span><span>Lowest ' + money(low) + '</span></div></div>' +
        '<div class="side">' + sparkline(pts, 56, 18) + '<button class="x unwatch" title="Stop watching" aria-label="Stop watching">✕</button></div></div>';
    }).join('');
  }

  // ---------- food ----------
  function renderFood() {
    var food = state.items.filter(function (i) { return i.site === 'zomato' || i.site === 'swiggy'; });
    var pairs = [];
    if (g.PricePilotFood) { try { pairs = g.PricePilotFood.matchAcrossApps(state.items) || []; } catch (e) { pairs = []; } }
    var total = function (it) { return it ? (it.cart && it.cart.grandTotal != null ? it.cart.grandTotal : it.price) : null; };
    var pairBox = $('foodPairs');
    if (!pairs.length) {
      pairBox.innerHTML = '<div class="empty">Open the same restaurant on both Zomato and Swiggy (ideally at the cart page) and PricePilot lines them up here.</div>';
    } else {
      pairBox.innerHTML = '<table><thead><tr><th>Restaurant</th><th class="num">Zomato</th><th class="num">Swiggy</th><th>Cheaper</th></tr></thead><tbody>' +
        pairs.map(function (p) {
          var name = (p.zomato && p.zomato.title) || (p.swiggy && p.swiggy.title) || p.key;
          var ch = p.cheaper === 'same' ? '<span>Same</span>' : '<span class="good">' + (p.cheaper === 'zomato' ? 'Zomato' : 'Swiggy') + ' by ' + money(Math.abs(p.diff)) + '</span>';
          return '<tr><td>' + esc(name) + '</td><td class="num">' + money(total(p.zomato)) + '</td><td class="num">' + money(total(p.swiggy)) + '</td><td>' + ch + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    var matched = new Set();
    pairs.forEach(function (p) { if (p.zomato) matched.add(p.zomato.url); if (p.swiggy) matched.add(p.swiggy.url); });
    var un = food.filter(function (i) { return !matched.has(i.url); });
    $('foodUnmatched').innerHTML = un.length ? '<h2 style="margin-top:12px">Not matched yet</h2>' + un.map(function (i) {
      var other = i.site === 'zomato' ? 'Swiggy' : 'Zomato';
      return '<div class="row"><span>' + siteBadge(i.site) + '</span><div class="main"><a class="title" href="' + esc(safeUrl(i.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(i.title) + '</a>' +
        '<div class="meta"><b>' + money(total(i)) + '</b><span>Open it on ' + other + ' to compare</span></div></div><span></span></div>';
    }).join('') : '';
  }

  // ---------- settings ----------
  var settingsWired = false;
  function renderSettings() {
    ['price', 'rating', 'discount', 'delivery'].forEach(function (k) {
      var v = Math.round((state.weights[k] || 0) * 100);
      $('w-' + k).value = v; $('v-' + k).textContent = v;
    });
    if (!$('cardBank').options.length) {
      $('cardBank').innerHTML = BANKS.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + '</option>'; }).join('');
    }
    $('cardList').innerHTML = state.settings.cards.length ? state.settings.cards.map(function (c, i) {
      return '<span class="cardchip">' + esc(c.bank) + ' ' + esc(c.cardType) + '<button class="x rmcard" data-i="' + i + '" aria-label="Remove card">✕</button></span>';
    }).join('') : '<span class="hint">No cards saved.</span>';
    $('alertsEnabled').checked = state.settings.alertsEnabled !== false;
    $('overlayEnabled').checked = state.settings.overlayEnabled !== false;
    $('checkInterval').value = String(state.settings.checkIntervalHours || 6);
    if (!settingsWired) wireSettings();
  }

  function saveSettings() { return set('sync', { settings: state.settings }); }

  function wireSettings() {
    settingsWired = true;
    ['price', 'rating', 'discount', 'delivery'].forEach(function (k) {
      var el = $('w-' + k);
      el.addEventListener('input', function () { $('v-' + k).textContent = el.value; });
      el.addEventListener('change', function () {
        state.weights[k] = Number(el.value) / 100;
        set('sync', { weights: state.weights });
      });
    });
    $('resetWeights').addEventListener('click', function () {
      state.weights = Object.assign({}, DEFAULT_WEIGHTS);
      set('sync', { weights: state.weights });
      renderSettings();
    });
    $('addCard').addEventListener('click', function () {
      var c = { bank: $('cardBank').value, cardType: $('cardType').value };
      var dup = state.settings.cards.some(function (x) { return x.bank === c.bank && x.cardType === c.cardType; });
      if (!dup) { state.settings.cards.push(c); saveSettings(); renderAll(); }
    });
    $('cardList').addEventListener('click', function (e) {
      var b = e.target.closest('.rmcard'); if (!b) return;
      state.settings.cards.splice(Number(b.getAttribute('data-i')), 1);
      saveSettings(); renderAll();
    });
    $('alertsEnabled').addEventListener('change', function (e) { state.settings.alertsEnabled = e.target.checked; saveSettings(); });
    $('overlayEnabled').addEventListener('change', function (e) { state.settings.overlayEnabled = e.target.checked; saveSettings(); });
    $('checkInterval').addEventListener('change', function (e) { state.settings.checkIntervalHours = Number(e.target.value); saveSettings(); });

    $('exportData').addEventListener('click', async function () {
      var local = await get('local', null);
      var sync = await get('sync', null);
      var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), local: local, sync: sync }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pricepilot-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });

    var clearBtn = $('clearData'), armTimer = null;
    clearBtn.addEventListener('click', async function () {
      if (!clearBtn.classList.contains('armed')) {
        clearBtn.classList.add('armed');
        clearBtn.textContent = 'Click again to erase everything';
        armTimer = setTimeout(function () { clearBtn.classList.remove('armed'); clearBtn.textContent = 'Clear all data'; }, 4000);
        return;
      }
      clearTimeout(armTimer);
      clearBtn.classList.remove('armed');
      clearBtn.textContent = 'Clear all data';
      await set('local', { trackedItems: [], priceHistory: {}, watchlist: {}, crossCache: {} });
      state.selected.clear();
      $('resultPanel').hidden = true;
      load();
    });
  }

  // ---------- events ----------
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab'); if (!t) return;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === t); });
    document.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.id !== 'pane-' + t.getAttribute('data-tab'); });
  });

  $('itemList').addEventListener('click', async function (e) {
    var row = e.target.closest('.row'); if (!row) return;
    var url = row.getAttribute('data-url');
    if (e.target.classList.contains('sel')) {
      if (e.target.checked) state.selected.add(url); else state.selected.delete(url);
      renderCompare();
    } else if (e.target.classList.contains('del')) {
      state.items = state.items.filter(function (i) { return i.url !== url; });
      state.selected.delete(url);
      await set('local', { trackedItems: state.items });
    }
  });

  $('watchList').addEventListener('click', async function (e) {
    if (!e.target.classList.contains('unwatch')) return;
    var url = e.target.closest('.row').getAttribute('data-url');
    var r = await send({ type: 'PP_UNWATCH', url: url });
    if (!r) { delete state.watchlist[url]; await set('local', { watchlist: state.watchlist }); }
  });

  $('compareBtn').addEventListener('click', runCompare);

  try {
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.trackedItems || changes.priceHistory || changes.watchlist || changes.settings || changes.weights) load();
    });
  } catch (e) {}

  load();
})();
