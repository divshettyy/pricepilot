// PricePilot on-page panel. Renders in a Shadow DOM so host page styles never leak in or out.
(function () {
  'use strict';
  if (window.__pricePilotOverlay) return;
  window.__pricePilotOverlay = true;

  var g = window;
  var FOOD = { zomato: true, swiggy: true };
  var VERDICTS = {
    'great': { label: 'Great price', color: '#15803d' },
    'good': { label: 'Good price', color: '#16a34a' },
    'fair': { label: 'Fair price', color: '#ca8a04' },
    'wait': { label: 'Wait for a drop', color: '#dc2626' },
    'fake-discount': { label: 'Fake discount', color: '#b91c1c' },
    'insufficient-data': { label: 'Tracking started', color: '#64748b' }
  };
  var STOP_WORDS = { 'with': 1, 'for': 1, 'and': 1, 'the': 1, 'of': 1, 'in': 1, 'by': 1, 'to': 1, 'a': 1, 'an': 1, 'from': 1, 'pack': 1, 'combo': 1 };

  var host = null, root = null, current = null, renderTimer = null, crossState = {}, renderSeq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return n == null || isNaN(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'); }
  function safeUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (e) { return '#'; } }

  function storageGet(area, keys) {
    return new Promise(function (resolve) {
      try { chrome.storage[area].get(keys, function (r) { resolve(r || {}); }); } catch (e) { resolve({}); }
    });
  }
  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function crossQuery(title) {
    var words = String(title || '').replace(/[()\[\],|:;\/\-–—+]/g, ' ').split(/\s+/).filter(function (w) {
      return w && !STOP_WORDS[w.toLowerCase()];
    });
    return words.slice(0, 8).join(' ');
  }

  function sparkline(points, w, h) {
    if (!points || points.length < 2) return '';
    var ps = points.map(function (p) { return p.p; });
    var min = Math.min.apply(null, ps), max = Math.max.apply(null, ps);
    var span = max - min || 1;
    var step = (w - 4) / (ps.length - 1);
    var coords = ps.map(function (p, i) {
      return [2 + i * step, 2 + (h - 4) * (1 - (p - min) / span)];
    });
    var d = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
    var last = coords[coords.length - 1];
    var area = d + ' L' + last[0].toFixed(1) + ' ' + (h - 1) + ' L2 ' + (h - 1) + ' Z';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true">' +
      '<path d="' + area + '" fill="var(--accent-soft)"/>' +
      '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="var(--accent)"/></svg>';
  }

  var CSS = [
    ':host{all:initial}',
    '.pp{--bg:#ffffff;--fg:#0f172a;--dim:#64748b;--line:#e2e8f0;--soft:#f1f5f9;--accent:#2563eb;--accent-soft:rgba(37,99,235,.12);--good:#15803d;--bad:#b91c1c;',
    'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);position:fixed;right:16px;bottom:16px;z-index:2147483647;}',
    '@media (prefers-color-scheme:dark){.pp{--bg:#0f172a;--fg:#e2e8f0;--dim:#94a3b8;--line:#1e293b;--soft:#1e293b;--accent:#60a5fa;--accent-soft:rgba(96,165,250,.16);--good:#4ade80;--bad:#f87171}}',
    '.panel{width:320px;max-height:70vh;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18)}',
    '.head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg)}',
    '.brand{font-weight:700;font-size:13px;flex:1}',
    '.iconbtn{background:none;border:0;color:var(--dim);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}',
    '.iconbtn:hover,.iconbtn:focus-visible{background:var(--soft);color:var(--fg);outline:none}',
    '.pill{display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:7px 12px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.15);font:inherit;color:var(--fg)}',
    '.dot{width:9px;height:9px;border-radius:50%;flex:none}',
    '.sec{padding:10px 12px;border-bottom:1px solid var(--line)}',
    '.sec:last-of-type{border-bottom:0}',
    '.label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:4px;font-weight:600}',
    '.chip{display:inline-block;color:#fff;font-weight:700;font-size:12px;padding:3px 9px;border-radius:999px}',
    '.reasons{margin:6px 0 0;padding-left:16px;color:var(--dim);font-size:12px}',
    '.row{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}',
    '.row span:first-child{color:var(--dim)}',
    '.big{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}',
    '.good{color:var(--good)}.bad{color:var(--bad)}.dim{color:var(--dim)}',
    '.spark{display:block;margin:4px 0}',
    '.flags{margin:4px 0 0;padding-left:16px;font-size:12px;color:var(--bad)}',
    '.cross a{display:flex;justify-content:space-between;gap:8px;padding:6px 0;color:var(--fg);text-decoration:none;border-top:1px dashed var(--line)}',
    '.cross a:first-child{border-top:0}',
    '.cross a:hover .t{color:var(--accent)}',
    '.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.site{font-size:10px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px;color:#fff;margin-right:6px}',
    '.s-amazon{background:#c77700}.s-flipkart{background:#2874f0}.s-zomato{background:#e23744}.s-swiggy{background:#fc8019}',
    '.watch{display:flex;gap:6px;align-items:center}',
    '.watch input{width:96px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:var(--soft);color:var(--fg);font:inherit}',
    '.btn{background:var(--accent);color:#fff;border:0;border-radius:7px;padding:7px 12px;font:inherit;font-weight:600;cursor:pointer}',
    '.btn.ghost{background:none;color:var(--fg);border:1px solid var(--line)}',
    '.btn:focus-visible,.pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.foot{padding:8px 12px;font-size:11px;color:var(--dim);text-align:center}',
    '.fee{color:var(--bad);font-weight:600}',
    '@media (prefers-reduced-motion:no-preference){.panel{animation:pp-in .18s ease-out}@keyframes pp-in{from{opacity:.4;transform:translateY(6px)}to{opacity:1;transform:none}}}'
  ].join('\n');

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = 'pricepilot-host';
    root = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    var wrap = document.createElement('div');
    wrap.className = 'pp';
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    root.addEventListener('click', onClick);
  }
  function container() { return root.querySelector('.pp'); }

  async function onClick(ev) {
    var t = ev.target.closest('[data-act]');
    if (!t || !current) return;
    var act = t.getAttribute('data-act');
    if (act === 'collapse' || act === 'expand') {
      try { chrome.storage.local.set({ overlayCollapsed: act === 'collapse' }); } catch (e) {}
      schedule(0);
    } else if (act === 'close') {
      host.remove(); host = null;
    } else if (act === 'watch') {
      var inp = root.querySelector('#pp-target');
      var tp = inp && inp.value !== '' ? Number(inp.value) : null;
      await send({ type: 'PP_WATCH', url: current.url, targetPrice: isNaN(tp) ? null : tp, notifyOnAnyDrop: true, site: current.site, title: current.title });
      schedule(0);
    } else if (act === 'unwatch') {
      await send({ type: 'PP_UNWATCH', url: current.url });
      schedule(0);
    }
  }

  function schedule(ms) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { render().catch(function (e) { console.warn('[PricePilot] overlay render failed', e); }); }, ms == null ? 300 : ms);
  }

  function requestCross(item) {
    if (FOOD[item.site] || !item.title) return;
    var q = crossQuery(item.title);
    if (!q || crossState[q]) return;
    crossState[q] = { loading: true, results: [] };
    send({ type: 'PP_CROSS_SEARCH', query: q, excludeSite: item.site }).then(function (r) {
      crossState[q] = { loading: false, results: (r && Array.isArray(r.results)) ? r.results : [], failed: !r };
      schedule(0);
    });
  }

  function verdictChip(a) {
    var v = VERDICTS[(a && a.verdict) || 'insufficient-data'] || VERDICTS['insufficient-data'];
    return { html: '<span class="chip" style="background:' + v.color + '">' + v.label + '</span>', v: v };
  }

  async function render() {
    if (!current) return;
    var seq = ++renderSeq;
    var sync = await storageGet('sync', ['settings']);
    var settings = sync.settings || {};
    if (settings.overlayEnabled === false) { if (host) { host.remove(); host = null; } return; }
    var local = await storageGet('local', ['overlayCollapsed', 'watchlist', 'trackedItems']);
    var item = current;
    var points = [], analysis = null;
    if (typeof g.PricePilotHistory !== 'undefined') {
      try {
        points = await g.PricePilotHistory.getHistory(item.url) || [];
        analysis = g.PricePilotHistory.analyze(points, item.price, item.mrp);
      } catch (e) { console.warn('[PricePilot] history failed', e); }
    }
    if (seq !== renderSeq) return;
    ensureHost();
    var chip = verdictChip(analysis);
    var box = container();

    if (local.overlayCollapsed) {
      box.innerHTML = '<button class="pill" data-act="expand" title="Open PricePilot"><span class="dot" style="background:' + chip.v.color + '"></span>' +
        '<b>' + money(item.price) + '</b><span class="dim">' + chip.v.label + '</span></button>';
      return;
    }

    var parts = [];
    var isFood = !!FOOD[item.site];

    // Verdict + history
    var hist = '<div class="sec"><div class="label">Verdict</div>' + chip.html;
    if (analysis && analysis.reasons && analysis.reasons.length) {
      hist += '<ul class="reasons">' + analysis.reasons.slice(0, 3).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    }
    if (points.length >= 2) {
      hist += sparkline(points, 294, 44);
      hist += '<div class="row"><span>Lowest seen</span><span>' + money(analysis && analysis.lowest) + '</span></div>';
      hist += '<div class="row"><span>Typical (median)</span><span>' + money(analysis && analysis.median) + '</span></div>';
      if (analysis && analysis.daysCovered != null) hist += '<div class="row"><span>History</span><span>' + analysis.pointCount + ' points · ' + analysis.daysCovered + ' days</span></div>';
    } else {
      hist += '<div class="dim" style="margin-top:6px;font-size:12px">History builds each time you or the price alert checks this page.</div>';
    }
    if (item.discountPct != null || (analysis && analysis.trueDiscountPct != null)) {
      hist += '<div class="row" style="margin-top:4px"><span>Site claims</span><span>' + (item.discountPct != null ? item.discountPct + '% off' : '—') + '</span></div>';
      if (analysis && analysis.trueDiscountPct != null) {
        var td = Math.round(analysis.trueDiscountPct);
        hist += '<div class="row"><span>Vs typical price</span><span class="' + (td > 0 ? 'good' : 'bad') + '">' + (td > 0 ? td + '% below' : Math.abs(td) + '% above') + '</span></div>';
      }
    }
    hist += '</div>';
    parts.push(hist);

    // Card offers
    if (!isFood && item.price != null && typeof g.PricePilotOffers !== 'undefined') {
      var cards = settings.cards || [];
      var sec = '<div class="sec"><div class="label">Your net price</div>';
      if (!cards.length) {
        sec += '<div class="dim" style="font-size:12px">Add your cards in PricePilot settings to see your net price' + ((item.offers && item.offers.length) ? ' (' + item.offers.length + ' bank offers on this page).' : '.') + '</div>';
      } else {
        var best = null;
        try { best = g.PricePilotOffers.bestNetPrice(item.price, item.offers || [], cards); } catch (e) {}
        if (best && best.savings > 0) {
          sec += '<div class="big good">' + money(best.netPrice) + '</div><div class="dim" style="font-size:12px">Save ' + money(best.savings) + ' · ' + esc(best.offer && best.offer.raw ? best.offer.raw.slice(0, 110) : '') + '</div>';
        } else {
          sec += '<div class="dim" style="font-size:12px">No offer on this page matches your saved cards.</div>';
        }
      }
      parts.push(sec + '</div>');
    }

    // Reviews
    if (item.rating != null && typeof g.PricePilotReviews !== 'undefined') {
      try {
        var rv = g.PricePilotReviews.assess(item);
        if (rv) {
          var tc = { high: 'good', medium: '', low: 'bad', unknown: 'dim' }[rv.trust] || 'dim';
          var r = '<div class="sec"><div class="label">Reviews</div><div class="row"><span>Shown</span><span>' + item.rating + '★' + (item.ratingCount ? ' (' + Number(item.ratingCount).toLocaleString('en-IN') + ')' : '') + '</span></div>' +
            '<div class="row"><span>Adjusted for review count</span><span><b>' + (rv.adjustedRating != null ? Number(rv.adjustedRating).toFixed(2) + '★' : '—') + '</b></span></div>' +
            '<div class="row"><span>Trust</span><span class="' + tc + '">' + esc(rv.trust) + '</span></div>';
          if (rv.flags && rv.flags.length) r += '<ul class="flags">' + rv.flags.slice(0, 3).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
          parts.push(r + '</div>');
        }
      } catch (e) {}
    }

    // Unit price
    if (item.price != null && typeof g.PricePilotUnit !== 'undefined') {
      try {
        var unit = item.unit || g.PricePilotUnit.parseUnit(item.title);
        var pu = unit ? g.PricePilotUnit.perUnit(item.price, unit) : null;
        if (pu) parts.push('<div class="sec"><div class="label">Unit price</div><div class="row"><span>' + esc(unit.qty + ' ' + unit.unit) + '</span><span><b>₹' + Number(pu.value).toFixed(2) + '</b> ' + esc(pu.label.replace(/^₹/, '')) + '</span></div></div>');
      } catch (e) {}
    }

    // Cross-store
    if (!isFood) {
      var q = crossQuery(item.title);
      var cs = crossState[q];
      var c = '<div class="sec"><div class="label">Other stores</div>';
      if (!cs || cs.loading) c += '<div class="dim" style="font-size:12px">Checking other stores…</div>';
      else if (cs.failed) c += '<div class="dim" style="font-size:12px">Could not reach other stores right now.</div>';
      else if (!cs.results.length) c += '<div class="dim" style="font-size:12px">No close match found on other stores.</div>';
      else {
        c += '<div class="cross">' + cs.results.slice(0, 3).map(function (r) {
          var diff = item.price != null && r.price != null ? item.price - r.price : null;
          var tag = diff == null ? '' : diff > 0 ? '<span class="good">save ' + money(diff) + '</span>' : diff < 0 ? '<span class="bad">+' + money(-diff) + '</span>' : '<span class="dim">same</span>';
          return '<a href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener noreferrer"><span class="t"><span class="site s-' + esc(r.site) + '">' + esc(r.site) + '</span>' + esc(r.title) + '</span><span>' + money(r.price) + ' ' + tag + '</span></a>';
        }).join('') + '</div>';
      }
      parts.push(c + '</div>');
    }

    // Food: cart + cross-app
    if (isFood) {
      if (item.cart) {
        var ct = item.cart, rows = [['Item total', ct.itemTotal, 0], ['Packaging', ct.packaging, 1], ['Platform fee', ct.platformFee, 1], ['Delivery', ct.deliveryFee, 1], ['GST & charges', ct.gst, 1], ['Discount', ct.discount != null ? -Math.abs(ct.discount) : null, 0]];
        var fees = [ct.packaging, ct.platformFee, ct.deliveryFee, ct.gst].reduce(function (s, v) { return s + (v || 0); }, 0);
        var cart = '<div class="sec"><div class="label">Cart breakdown</div>' + rows.filter(function (r) { return r[1] != null; }).map(function (r) {
          return '<div class="row"><span>' + r[0] + '</span><span class="' + (r[2] && r[1] > 0 ? 'fee' : '') + '">' + (r[1] < 0 ? '−' + money(-r[1]) : money(r[1])) + '</span></div>';
        }).join('');
        cart += '<div class="row" style="margin-top:4px"><span><b>Grand total</b></span><span class="big">' + money(ct.grandTotal) + '</span></div>';
        if (fees > 0) cart += '<div class="dim" style="font-size:12px">Fees add ' + money(fees) + (ct.itemTotal ? ' (' + Math.round(fees / ct.itemTotal * 100) + '% on top of food)' : '') + '.</div>';
        parts.push(cart + '</div>');
      }
      var other = item.site === 'zomato' ? 'swiggy' : 'zomato';
      var otherName = other === 'zomato' ? 'Zomato' : 'Swiggy';
      var f = '<div class="sec"><div class="label">' + otherName + ' vs this app</div>';
      var pair = null;
      if (typeof g.PricePilotFood !== 'undefined') {
        try {
          var key = item.restaurantKey || g.PricePilotFood.restaurantKey(item.title, item.locality);
          var pairs = g.PricePilotFood.matchAcrossApps(local.trackedItems || []) || [];
          pair = pairs.filter(function (p) { return p.key === key || (p[item.site] && p[item.site].url === item.url); })[0] || null;
        } catch (e) {}
      }
      if (pair && pair[other]) {
        var cheaper = pair.cheaper;
        f += '<div class="row"><span>' + otherName + '</span><span>' + money(pair[other].cart && pair[other].cart.grandTotal != null ? pair[other].cart.grandTotal : pair[other].price) + '</span></div>';
        if (cheaper === 'same') f += '<div class="dim">Same price on both apps.</div>';
        else f += '<div class="' + (cheaper === item.site ? 'good' : 'bad') + '" style="font-weight:600">Cheaper on ' + (cheaper === 'zomato' ? 'Zomato' : 'Swiggy') + ' by ' + money(Math.abs(pair.diff)) + '</div>';
      } else {
        f += '<div class="dim" style="font-size:12px">Open this restaurant on ' + otherName + ' to compare.</div>';
      }
      parts.push(f + '</div>');
    }

    // Watch
    var watching = local.watchlist && local.watchlist[item.url];
    var w = '<div class="sec"><div class="label">Price alert</div>';
    if (watching) {
      w += '<div class="watch"><span class="good" style="flex:1">Watching ✓' + (watching.targetPrice != null ? ' · target ' + money(watching.targetPrice) : '') + '</span><button class="btn ghost" data-act="unwatch">Stop</button></div>';
    } else {
      w += '<div class="watch"><input id="pp-target" type="number" min="0" inputmode="numeric" placeholder="Target ₹" aria-label="Target price"><button class="btn" data-act="watch">Watch price</button></div>';
    }
    parts.push(w + '</div>');

    var prevTarget = root.querySelector('#pp-target');
    var keepVal = prevTarget ? prevTarget.value : '';
    box.innerHTML = '<div class="panel" role="complementary" aria-label="PricePilot">' +
      '<div class="head"><span class="dot" style="background:' + chip.v.color + '"></span><span class="brand">PricePilot · ' + money(item.price) + '</span>' +
      '<button class="iconbtn" data-act="collapse" title="Minimize" aria-label="Minimize">–</button>' +
      '<button class="iconbtn" data-act="close" title="Hide on this page" aria-label="Close">×</button></div>' +
      parts.join('') +
      '<div class="foot">Local-only · no tracking · no affiliate links</div></div>';
    var nt = root.querySelector('#pp-target');
    if (nt && keepVal) nt.value = keepVal;

    requestCross(item);
  }

  window.addEventListener('pricepilot:item', function (ev) {
    try {
      var item = ev && ev.detail;
      if (!item || !item.url) return;
      if (current && current.url !== item.url) crossState = {};
      current = item;
      schedule(300);
    } catch (e) { console.warn('[PricePilot] overlay event failed', e); }
  });

  try {
    chrome.storage.onChanged.addListener(function (changes) {
      if (current && (changes.watchlist || changes.priceHistory || changes.settings)) schedule(300);
    });
  } catch (e) {}
})();
