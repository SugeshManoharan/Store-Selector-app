(function () {
  var STORAGE_ID_KEY = "storeLocator.selectedLocationId";
  var STORAGE_NAME_KEY = "storeLocator.selectedLocationName";
  var COOKIE_KEY = "storeLocatorLocation";

  var root = document.getElementById("store-locator-root");
  if (!root) return;

  var forceSelect = root.getAttribute("data-force-select") === "true";

  // Pre-computed data injected by the theme block from the shop metafield.
  var data = window.__STORE_SELECTOR__ || {};
  var stores = data.locations || [];
  var availability = data.availability || {};

  var modal = document.getElementById("store-locator-modal");
  var list = document.getElementById("store-locator-list");
  var empty = document.getElementById("store-locator-empty");
  var trigger = document.getElementById("store-locator-trigger");
  var triggerLabel = document.getElementById("store-locator-trigger-label");
  var closeBtn = document.getElementById("store-locator-modal-close");

  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name + "=([^;]*)"),
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value) {
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; path=/; max-age=" +
      60 * 60 * 24 * 365;
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function getSelectedId() {
    return safeGet(STORAGE_ID_KEY) || getCookie(COOKIE_KEY);
  }

  function normalize(s) {
    return String(s || "")
      .trim()
      .toLowerCase();
  }

  function findLocationByName(name) {
    var n = normalize(name);
    for (var i = 0; i < stores.length; i++) {
      if (normalize(stores[i].name) === n) return stores[i];
    }
    return null;
  }

  function setSelectedStore(id, name) {
    try {
      localStorage.setItem(STORAGE_ID_KEY, id);
      localStorage.setItem(STORAGE_NAME_KEY, name);
    } catch (e) {
      /* cookie fallback below */
    }
    setCookie(COOKIE_KEY, id);
    updateTriggerLabel(name);
    applyFilter(id);
  }

  function updateTriggerLabel(name) {
    if (triggerLabel) triggerLabel.textContent = name || "Select store";
  }

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  function renderStores() {
    list.innerHTML = "";
    if (!stores.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    var currentId = getSelectedId();

    stores.forEach(function (store) {
      var li = document.createElement("li");
      li.className = "store-locator-list__item";

      var button = document.createElement("button");
      button.type = "button";
      button.className = "store-locator-list__button";
      if (store.id === currentId) button.classList.add("is-selected");

      var name = document.createElement("span");
      name.className = "store-locator-list__name";
      name.textContent = store.name;
      button.appendChild(name);

      if (store.address) {
        var address = document.createElement("span");
        address.className = "store-locator-list__address";
        address.textContent = store.address;
        button.appendChild(address);
      }

      button.addEventListener("click", function () {
        setSelectedStore(store.id, store.name);
        closeModal();
      });

      li.appendChild(button);
      list.appendChild(li);
    });
  }

  // Show/hide product cards based on the selected location's availability list.
  function applyFilter(locationId) {
    var cards = document.querySelectorAll("[data-product-id]");
    if (!cards.length) return;

    var allowedIds = availability[locationId] || [];
    var allowed = {};
    allowedIds.forEach(function (id) {
      allowed[String(id)] = true;
    });

    cards.forEach(function (card) {
      var pid = String(card.getAttribute("data-product-id"));
      var visible = !!allowed[pid];
      var target = card.closest("li") || card;
      target.style.display = visible ? "" : "none";
    });

    document.dispatchEvent(
      new CustomEvent("storeLocator:filtered", {
        detail: { locationId: locationId, count: allowedIds.length },
      }),
    );
  }

  // ---- Pocco theme integration -------------------------------------------
  // The Pocco theme ships its own store selector in the header. It stores the
  // chosen store NAME in localStorage['selected-store'] and shows it in a
  // ".get_storename" element. When that theme is present we hide our own
  // button and simply mirror its selection into our product filter, matching
  // by store name (Pocco's store Name must equal the Shopify location name).
  var POCCO_LS_KEY = "selected-store";

  function poccoPresent() {
    return !!(
      document.querySelector("store-selector, .get_storename") ||
      safeGet(POCCO_LS_KEY)
    );
  }

  function poccoSelectedName() {
    var el = document.querySelector(".get_storename");
    if (el && el.textContent.trim()) return el.textContent.trim();
    return safeGet(POCCO_LS_KEY);
  }

  function syncFromPocco() {
    var name = poccoSelectedName();
    if (!name) return;
    var loc = findLocationByName(name);
    if (!loc) return; // Pocco store with no matching location — leave unfiltered
    // Persist so other pages filter instantly on load.
    try {
      localStorage.setItem(STORAGE_ID_KEY, loc.id);
      localStorage.setItem(STORAGE_NAME_KEY, loc.name);
    } catch (e) {
      /* ignore */
    }
    setCookie(COOKIE_KEY, loc.id);
    applyFilter(loc.id);
  }

  function watchPocco() {
    var lastName = poccoSelectedName();

    // Observe the header store-name element; its text changes on switch.
    var nameEl = document.querySelector(".get_storename");
    if (nameEl && window.MutationObserver) {
      new MutationObserver(function () {
        var n = poccoSelectedName();
        if (n && n !== lastName) {
          lastName = n;
          syncFromPocco();
        }
      }).observe(nameEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // Fallback poll (localStorage writes in the same tab don't fire "storage").
    setInterval(function () {
      var n = poccoSelectedName();
      if (n && n !== lastName) {
        lastName = n;
        syncFromPocco();
      }
    }, 800);

    // Cross-tab changes.
    window.addEventListener("storage", function (e) {
      if (e.key === POCCO_LS_KEY) syncFromPocco();
    });
  }

  function hideOwnButton() {
    if (trigger) trigger.style.display = "none";
  }
  // ------------------------------------------------------------------------

  function initStandalone() {
    renderStores();

    var selectedId = getSelectedId();
    updateTriggerLabel(safeGet(STORAGE_NAME_KEY));

    if (!selectedId && (forceSelect || stores.length)) {
      openModal();
    } else if (selectedId) {
      applyFilter(selectedId);
    }

    trigger.addEventListener("click", openModal);
    closeBtn.addEventListener("click", function () {
      if (!forceSelect || getSelectedId()) closeModal();
    });
    modal
      .querySelector(".store-locator-modal__backdrop")
      .addEventListener("click", function () {
        if (!forceSelect || getSelectedId()) closeModal();
      });
  }

  function init() {
    var showFloating = !!(data.settings && data.settings.showFloatingButton);

    // If the theme has its own store selector (e.g. Pocco) and the merchant
    // hasn't explicitly enabled our floating button, follow the theme's
    // selection instead of showing a duplicate control.
    if (poccoPresent() && !showFloating) {
      hideOwnButton();
      syncFromPocco();
      watchPocco();
      return;
    }
    initStandalone();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
