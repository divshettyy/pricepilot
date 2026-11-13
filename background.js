// PricePilot background service worker — storage init + badge count only.

function updateBadge(items) {
  var count = (items || []).length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

function refreshBadgeFromStorage() {
  chrome.storage.local.get('trackedItems', function (res) {
    updateBadge(res.trackedItems || []);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get('trackedItems', function (res) {
    if (!res.trackedItems) {
      chrome.storage.local.set({ trackedItems: [] });
    }
  });
});

chrome.runtime.onStartup.addListener(refreshBadgeFromStorage);

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.trackedItems) {
    updateBadge(changes.trackedItems.newValue || []);
  }
});

// Service worker may wake cold — set badge correctly right away too.
refreshBadgeFromStorage();
