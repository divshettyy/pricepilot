// PricePilot unit price — parse pack size from a title and compute price per standard unit.
(function (g) {
  "use strict";

  var UNITS = {
    g: { base: "g", f: 1 }, gm: { base: "g", f: 1 }, gms: { base: "g", f: 1 }, gram: { base: "g", f: 1 }, grams: { base: "g", f: 1 },
    kg: { base: "g", f: 1000 }, kgs: { base: "g", f: 1000 },
    ml: { base: "ml", f: 1 }, l: { base: "ml", f: 1000 }, ltr: { base: "ml", f: 1000 }, litre: { base: "ml", f: 1000 }, liter: { base: "ml", f: 1000 }, litres: { base: "ml", f: 1000 },
    gb: { base: "GB", f: 1 }, tb: { base: "GB", f: 1024 }
  };

  var QTY_RE = /(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|g|ml|ltr|litres?|liter|l|gb|tb)\b/i;
  var MULTI_RE = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|g|ml|ltr|litres?|liter|l|gb|tb)\b/i;
  var PACK_RE = /(?:pack|set|combo)\s*of\s*(\d+)|\b(\d+)\s*(?:pcs|pieces|pack|count|units|n)\b/i;

  function parseUnit(title) {
    if (!title) return null;
    var t = String(title);
    var m = MULTI_RE.exec(t);
    var packM = PACK_RE.exec(t);
    var pack = packM ? Number(packM[1] || packM[2]) : 1;

    if (m) {
      var u = UNITS[m[3].toLowerCase()];
      if (u) return { qty: Number(m[1]) * Number(m[2]) * u.f, unit: u.base };
    }
    // Phones list RAM before storage ("8 GB RAM, 128 GB ROM"): for storage take the largest GB value.
    var gbAll = t.match(/(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi);
    if (gbAll && gbAll.length > 1) {
      var maxGb = 0;
      gbAll.forEach(function (s) {
        var mm = /(\d+(?:\.\d+)?)\s*(gb|tb)/i.exec(s);
        var v = Number(mm[1]) * UNITS[mm[2].toLowerCase()].f;
        if (v > maxGb) maxGb = v;
      });
      return { qty: maxGb, unit: "GB" };
    }
    m = QTY_RE.exec(t);
    if (m) {
      var u2 = UNITS[m[2].toLowerCase()];
      if (u2) {
        var qty = Number(m[1]) * u2.f;
        // storage sizes are per device, not multiplied by pack count
        if (u2.base !== "GB") qty *= pack;
        return { qty: qty, unit: u2.base };
      }
    }
    if (packM && pack > 1) return { qty: pack, unit: "pc" };
    return null;
  }

  function perUnit(price, unit) {
    if (price == null || !unit || !unit.qty) return null;
    var value, label;
    if (unit.unit === "g") { value = price / unit.qty * 100; label = "₹/100g"; }
    else if (unit.unit === "ml") { value = price / unit.qty * 100; label = "₹/100ml"; }
    else if (unit.unit === "pc") { value = price / unit.qty; label = "₹/pc"; }
    else if (unit.unit === "GB") { value = price / unit.qty; label = "₹/GB"; }
    else return null;
    return { value: Math.round(value * 100) / 100, label: label };
  }

  g.PricePilotUnit = { parseUnit: parseUnit, perUnit: perUnit };
})(typeof self !== "undefined" ? self : window);
