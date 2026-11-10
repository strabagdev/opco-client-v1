/* Presentation only. Generated bootstrap supplies the approved palette roles before this script. */
(function () {
  "use strict";
  if (window.__opcoTheme) return;
  const key = "opco.appearance.v1";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set();
  let snapshot;
  function valid(value) { return value === "auto" || value === "light" || value === "dark"; }
  function apply(preference, persistence) {
    const resolved = preference === "auto" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.opcoTheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && window.__opcoThemeCanvases) meta.content = window.__opcoThemeCanvases[resolved];
    snapshot = Object.freeze({ preference: preference, resolved: resolved, persistence: persistence });
    listeners.forEach(function (listener) { listener(); });
  }
  let initial = "auto", persistence = "available";
  try { const stored = localStorage.getItem(key); if (valid(stored)) initial = stored; }
  catch (_) { persistence = "unavailable"; }
  apply(initial, persistence);
  window.__opcoTheme = Object.freeze({
    getSnapshot: function () { return snapshot; },
    subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
    setPreference: function (preference) {
      if (!valid(preference)) return false;
      let result = "persisted";
      try { localStorage.setItem(key, preference); }
      catch (_) { result = "unavailable"; }
      apply(preference, result);
      return result === "persisted";
    }
  });
  media.addEventListener("change", function () {
    if (snapshot.preference === "auto") apply("auto", snapshot.persistence);
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null) apply(valid(event.newValue) ? event.newValue : "auto", "available");
  });
})();
