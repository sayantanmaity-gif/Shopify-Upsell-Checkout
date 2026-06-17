// Storefront upsell block: fetch Shopify product recommendations for the
// current product, render cards, and add to cart while stamping the same
// "Upsell products" cart attribute the checkout block uses (variantGid -> title)
// so the discount function + analytics apply at checkout.
(function () {
  var UPSELL_ATTR = "Upsell products";

  function money(cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || (window.Shopify && Shopify.currency && Shopify.currency.active) || "USD",
      }).format((cents || 0) / 100);
    } catch (e) {
      return ((cents || 0) / 100).toFixed(2);
    }
  }

  function gid(variantId) {
    return "gid://shopify/ProductVariant/" + variantId;
  }

  async function getJSON(url, opts) {
    var res = await fetch(url, opts);
    if (!res.ok) throw new Error(url + " -> " + res.status);
    return res.json();
  }

  // Merge the added variant into the cart's "Upsell products" attribute.
  async function markUpsell(variantId, title) {
    var cart = await getJSON("/cart.js");
    var map = {};
    var raw = cart.attributes && cart.attributes[UPSELL_ATTR];
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") map = parsed;
      } catch (e) {}
    }
    map[gid(variantId)] = title;
    var attrs = {};
    attrs[UPSELL_ATTR] = JSON.stringify(map);
    await fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs }),
    });
  }

  async function addToCart(variantId, title, btn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
      });
      await markUpsell(variantId, title);
      btn.textContent = "✓ Added";
      document.dispatchEvent(new CustomEvent("upsell:added", { detail: { variantId } }));
    } catch (e) {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  function card(p, root) {
    var showPrice = root.getAttribute("data-show-price") === "true";
    var label = root.getAttribute("data-button-label") || "Add to cart";
    var variant =
      (p.variants || []).find(function (v) {
        return v.available;
      }) || p.variants[0];
    if (!variant) return null;

    var el = document.createElement("div");
    el.className = "upsell-card";
    var img = p.featured_image || (p.images && p.images[0]) || "";
    el.innerHTML =
      (img ? '<img class="upsell-card__img" src="' + img + '" alt="" loading="lazy">' : "") +
      '<div class="upsell-card__title">' + p.title + "</div>" +
      (showPrice ? '<div class="upsell-card__price">' + money(variant.price, p.currency) + "</div>" : "") +
      '<button class="upsell-card__btn" type="button">' + label + "</button>";

    var btn = el.querySelector("button");
    btn.addEventListener("click", function () {
      addToCart(variant.id, p.title, btn);
    });
    return el;
  }

  async function init(root) {
    var productId = root.getAttribute("data-product-id");
    var limit = root.getAttribute("data-limit") || 4;
    var intent = root.getAttribute("data-intent") || "related";
    var grid = root.querySelector("[data-upsell-grid]");
    if (!productId || !grid) return;

    try {
      var data = await getJSON(
        "/recommendations/products.json?product_id=" +
          encodeURIComponent(productId) +
          "&limit=" +
          encodeURIComponent(limit) +
          "&intent=" +
          encodeURIComponent(intent),
      );
      var products = (data && data.products) || [];
      if (products.length === 0) {
        root.style.display = "none";
        return;
      }
      products.forEach(function (p) {
        var c = card(p, root);
        if (c) grid.appendChild(c);
      });
    } catch (e) {
      root.style.display = "none";
    }
  }

  function boot() {
    document.querySelectorAll("[data-upsell]").forEach(init);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
