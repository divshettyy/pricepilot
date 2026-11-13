// PricePilot popup script (plain script, no modules)

var state = {
  items: [],
  weights: Object.assign({}, window.PricePilotScoring.DEFAULT_WEIGHTS),
  selected: new Set()
};

var SITE_LABELS = {
  amazon: 'Amazon',
  flipkart: 'Flipkart',
  zomato: 'Zomato',
  swiggy: 'Swiggy'
};

var FOOD_SITES = { zomato: true, swiggy: true };

// ---------- Helpers ----------

function formatMoney(n) {
  if (n === null || n === undefined) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  var then = new Date(isoString).getTime();
  var now = Date.now();
  var diffMs = now - then;
  if (isNaN(diffMs)) return '—';
  var diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'just now';
  var diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  var diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  var diffDay = Math.floor(diffHr / 24);
  return diffDay + 'd ago';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function currentWeightsFromSliders() {
  return {
    price: Number(document.getElementById('wPrice').value) / 100,
    rating: Number(document.getElementById('wRating').value) / 100,
    discount: Number(document.getElementById('wDiscount').value) / 100,
    delivery: Number(document.getElementById('wDelivery').value) / 100
  };
}

function setSlidersFromWeights(weights) {
  document.getElementById('wPrice').value = Math.round(weights.price * 100);
  document.getElementById('wRating').value = Math.round(weights.rating * 100);
  document.getElementById('wDiscount').value = Math.round(weights.discount * 100);
  document.getElementById('wDelivery').value = Math.round(weights.delivery * 100);
  updateSliderLabels();
}

function updateSliderLabels() {
  document.getElementById('wPriceVal').textContent = document.getElementById('wPrice').value;
  document.getElementById('wRatingVal').textContent = document.getElementById('wRating').value;
  document.getElementById('wDiscountVal').textContent = document.getElementById('wDiscount').value;
  document.getElementById('wDeliveryVal').textContent = document.getElementById('wDelivery').value;
}

// ---------- Data loading ----------

function loadData(callback) {
  chrome.storage.local.get('trackedItems', function (localRes) {
    chrome.storage.sync.get('weights', function (syncRes) {
      state.items = Array.isArray(localRes.trackedItems) ? localRes.trackedItems : [];
      state.weights = (syncRes && syncRes.weights) || Object.assign({}, window.PricePilotScoring.DEFAULT_WEIGHTS);
      if (typeof callback === 'function') callback();
    });
  });
}

function sortedItems() {
  return state.items.slice().sort(function (a, b) {
    return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
  });
}

// ---------- Rendering ----------

function renderAll() {
  setSlidersFromWeights(state.weights);
  renderItemList();
  updateCompareButton();
}

function renderItemList() {
  var listEl = document.getElementById('itemList');
  var items = sortedItems();

  document.getElementById('itemCount').textContent = items.length + ' item' + (items.length === 1 ? '' : 's') + ' tracked';

  if (items.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No items tracked yet.</p>';
    return;
  }

  var html = items.map(function (item) {
    var isFood = FOOD_SITES[item.site] === true;
    var siteLabel = SITE_LABELS[item.site] || item.site;
    var checked = state.selected.has(item.url) ? 'checked' : '';
    var deliveryText = isFood ? formatMoney(item.deliveryFee) : '';
    var ratingText = item.rating === null || item.rating === undefined ? '—' : item.rating.toFixed(1) + '★';
    var discountText = item.discountPct === null || item.discountPct === undefined ? '—' : Math.round(item.discountPct) + '% off';

    return (
      '<div class="item-row" data-url="' + escapeHtml(item.url) + '">' +
        '<input type="checkbox" class="item-checkbox" data-url="' + escapeHtml(item.url) + '" ' + checked + ' />' +
        '<span class="site-badge site-' + escapeHtml(item.site) + '">' + escapeHtml(siteLabel) + '</span>' +
        '<a class="item-title" href="' + escapeHtml(item.url) + '" target="_blank" title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</a>' +
        '<span class="item-price">' + formatMoney(item.price) + '</span>' +
        '<span class="item-rating">' + ratingText + '</span>' +
        '<span class="item-discount">' + discountText + '</span>' +
        '<span class="item-delivery">' + deliveryText + '</span>' +
        '<span class="item-time">' + formatRelativeTime(item.capturedAt) + '</span>' +
        '<button class="item-delete" data-url="' + escapeHtml(item.url) + '" title="Remove">✕</button>' +
      '</div>'
    );
  }).join('');

  listEl.innerHTML = html;

  Array.prototype.forEach.call(listEl.querySelectorAll('.item-checkbox'), function (cb) {
    cb.addEventListener('change', onCheckboxChange);
  });
  Array.prototype.forEach.call(listEl.querySelectorAll('.item-delete'), function (btn) {
    btn.addEventListener('click', onDeleteClick);
  });
}

function updateCompareButton() {
  document.getElementById('compareBtn').disabled = state.selected.size < 2;
}

function renderResultPanel(scoredItems) {
  var panel = document.getElementById('resultPanel');
  var content = document.getElementById('resultContent');

  function breakdownBars(breakdown) {
    var keys = [
      { key: 'price', label: 'Price' },
      { key: 'rating', label: 'Rating' },
      { key: 'discount', label: 'Discount' },
      { key: 'delivery', label: 'Delivery' }
    ];
    return keys.map(function (k) {
      var raw = breakdown && breakdown[k.key] !== undefined ? breakdown[k.key] : 0;
      var pct = Math.max(0, Math.min(100, Math.round(raw)));
      return (
        '<div class="bar-row">' +
          '<span class="bar-label">' + k.label + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="bar-pct">' + pct + '%</span>' +
        '</div>'
      );
    }).join('');
  }

  var html = scoredItems.map(function (item, idx) {
    var isBest = idx === 0 || item.isBestPick;
    var cardClass = isBest ? 'result-card best-pick' : 'result-card';
    var badge = isBest ? '<span class="best-badge">🏆 Best Pick</span>' : '';
    return (
      '<div class="' + cardClass + '">' +
        '<div class="result-title-row">' +
          badge +
          '<a class="item-title" href="' + escapeHtml(item.url) + '" target="_blank">' + escapeHtml(item.title) + '</a>' +
          '<span class="result-score">' + Math.round(item.score) + '/100</span>' +
        '</div>' +
        '<div class="bars">' + breakdownBars(item.scoreBreakdown) + '</div>' +
      '</div>'
    );
  }).join('');

  content.innerHTML = html;
  panel.hidden = false;
}

// ---------- Event handlers ----------

function onCheckboxChange(e) {
  var url = e.target.getAttribute('data-url');
  if (e.target.checked) {
    state.selected.add(url);
  } else {
    state.selected.delete(url);
  }
  updateCompareButton();
}

function onDeleteClick(e) {
  var url = e.target.getAttribute('data-url');
  state.items = state.items.filter(function (it) { return it.url !== url; });
  state.selected.delete(url);
  chrome.storage.local.set({ trackedItems: state.items }, function () {
    renderItemList();
    updateCompareButton();
  });
}

function onClearAllClick() {
  if (!confirm('Clear all tracked items?')) return;
  state.items = [];
  state.selected.clear();
  chrome.storage.local.set({ trackedItems: [] }, function () {
    document.getElementById('resultPanel').hidden = true;
    renderItemList();
    updateCompareButton();
  });
}

function onSliderInput() {
  updateSliderLabels();
}

function onSliderChange() {
  var weights = currentWeightsFromSliders();
  state.weights = weights;
  chrome.storage.sync.set({ weights: weights });
}

function onResetWeightsClick() {
  var defaults = window.PricePilotScoring.DEFAULT_WEIGHTS;
  state.weights = Object.assign({}, defaults);
  setSlidersFromWeights(state.weights);
  chrome.storage.sync.set({ weights: state.weights });
}

function onCompareClick() {
  var selectedItems = state.items.filter(function (it) { return state.selected.has(it.url); });
  if (selectedItems.length < 2) return;
  var weights = currentWeightsFromSliders();
  var scored = window.PricePilotScoring.computeScores(selectedItems, weights);
  renderResultPanel(scored);
}

// ---------- Init ----------

function wireEvents() {
  document.getElementById('clearAllBtn').addEventListener('click', onClearAllClick);
  document.getElementById('compareBtn').addEventListener('click', onCompareClick);
  document.getElementById('resetWeightsBtn').addEventListener('click', onResetWeightsClick);

  ['wPrice', 'wRating', 'wDiscount', 'wDelivery'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('input', onSliderInput);
    el.addEventListener('change', onSliderChange);
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' && changes.trackedItems) {
      state.items = changes.trackedItems.newValue || [];
      renderItemList();
      updateCompareButton();
    }
    if (areaName === 'sync' && changes.weights) {
      state.weights = changes.weights.newValue || Object.assign({}, window.PricePilotScoring.DEFAULT_WEIGHTS);
      setSlidersFromWeights(state.weights);
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  wireEvents();
  loadData(renderAll);
});
