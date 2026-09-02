/* =====================================================================
   DISPLAY PROPERTIES

   Right-click the desktop, Properties. It is the one bit of Windows 95 that
   everybody poked at as a kid, and the site already had a Properties item in
   its desktop menu that opened the About box instead — a promise it didn't
   keep.

   Two things are separate here, because they were separate in 1995 and
   because they fail differently: the SCHEME repaints the chrome (windows,
   title bars, buttons, fields), the WALLPAPER only changes what's behind it.
   Somebody who wants a green desktop and normal windows should not have to
   accept Matrix-green buttons to get it.

   A scheme is a complete palette declared in the stylesheet. This file only
   decides which one is on, so there is no colour arithmetic in JS to drift
   out of sync with the CSS.
   ===================================================================== */

const SCHEMES = [
  ["",         "Windows Standard", "The site's own colours. This is the only scheme that follows the light/dark switch."],
  ["win95",    "Windows Classic",  "Grey chrome, navy title bars, teal desktop. The real thing."],
  ["rainy",    "Rainy Day",        "Muted blue-greys. The calm one."],
  ["eggplant", "Eggplant",         "Aubergine chrome on deep green."],
  ["hotdog",   "Hot Dog Stand",    "Yellow and red. Microsoft really shipped this."],
  ["matrix",   "Matrix",           "Black and phosphor green."],
  ["bsod",     "Blue Screen",      "The whole desktop as the error you feared."],
  ["vapor",    "Vaporwave",        "Pink, purple, and a sunset that never sets."],
];

const WALLS = [
  ["",         "Scheme default", null],
  ["teal",     "Teal",            ["#0aa", "#066", "#044"]],
  ["storm",    "Storm",           ["#3b4d63", "#232f3e", "#141c26"]],
  ["sunrise",  "Sunrise",         ["#ffb04a", "#ff6a5e", "#7b2d8e"]],
  ["moss",     "Moss",            ["#4a7a3d", "#2c4a25", "#182c14"]],
  ["ash",      "Ash",             ["#6b6b6b", "#3d3d3d", "#1f1f1f"]],
  ["plum",     "Plum",            ["#7a4b9c", "#452a5c", "#241432"]],
];

const PATTERNS = [
  ["",       "Hatch",  "repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 8px,transparent 8px 16px)"],
  ["none",   "None",   "none"],
  ["scan",   "Scanlines", "repeating-linear-gradient(0deg,rgba(0,0,0,.10) 0 2px,transparent 2px 4px)"],
  ["grid",   "Grid",   "repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 32px),repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 32px)"],
  ["dots",   "Dots",   "radial-gradient(rgba(255,255,255,.10) 1px,transparent 1px)"],
];

const Skin = {
  K_SCHEME: "cheeto_skin",
  K_WALL: "cheeto_wall",
  K_PATTERN: "cheeto_pattern",

  read(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  write(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },

  scheme() { return this.read(this.K_SCHEME); },
  wall() { return this.read(this.K_WALL); },
  pattern() { return this.read(this.K_PATTERN); },

  apply() {
    const s = this.scheme();
    if (s && SCHEMES.some((x) => x[0] === s)) document.body.dataset.skin = s;
    else delete document.body.dataset.skin;

    // Wallpaper and pattern are inline overrides, so they survive on top of
    // whichever scheme is active rather than being baked into it.
    const w = WALLS.find((x) => x[0] === this.wall());
    const st = document.body.style;
    if (w && w[2]) { st.setProperty("--deskA", w[2][0]); st.setProperty("--deskB", w[2][1]); st.setProperty("--deskC", w[2][2]); }
    else { st.removeProperty("--deskA"); st.removeProperty("--deskB"); st.removeProperty("--deskC"); }

    const p = PATTERNS.find((x) => x[0] === this.pattern());
    if (p && p[0]) st.setProperty("--deskPattern", p[2]);
    else st.removeProperty("--deskPattern");

    // The browser UI colour should track the desktop, or the phone's status
    // bar ends up teal on a Hot Dog Stand desktop.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const c = getComputedStyle(document.body).getPropertyValue("--deskB").trim();
      if (c) meta.setAttribute("content", c);
    }
    this.paintPicker();
  },

  set(kind, value) {
    this.write(kind === "scheme" ? this.K_SCHEME : kind === "wall" ? this.K_WALL : this.K_PATTERN, value);
    this.apply();
    // `Sfx?.play?.()` does NOT protect against Sfx being undeclared — optional
    // chaining guards null and undefined VALUES, not missing bindings, so it
    // threw a ReferenceError on every click until the sound module exists.
    if (typeof Sfx === "object") Sfx.play?.("click");
  },

  /* ------------------------------------------------------------ window */
  open(tab) {
    WM.open("w-display");
    if (tab) this.tab = tab;
    this.render();
  },

  tab: "appearance",

  render() {
    const box = document.getElementById("displayBody");
    if (!box) return;
    const t = this.tab;
    box.innerHTML = `
      <div class="dp-tabs" role="tablist">
        <button class="dp-tab${t === "background" ? " on" : ""}" data-dp-tab="background" role="tab">Background</button>
        <button class="dp-tab${t === "appearance" ? " on" : ""}" data-dp-tab="appearance" role="tab">Appearance</button>
      </div>
      <div class="dp-pane">${t === "background" ? this.bgPane() : this.apPane()}</div>`;
    this.wire();
    this.paintPicker();
    WM.fit?.("w-display");
  },

  /* A preview that is drawn with the real tokens, not an approximation of
     them. Anything else drifts the first time a palette is edited. */
  monitor(schemeId) {
    return `<div class="dp-mon"><div class="dp-screen"${schemeId !== null ? ` data-skin-preview="${esc(schemeId)}"` : ""}>
        <div class="dp-win"><div class="dp-wtb"></div><div class="dp-wbody"></div></div>
        <div class="dp-task"></div>
      </div><div class="dp-stand"></div></div>`;
  },

  apPane() {
    const cur = this.scheme();
    return `${this.monitor(cur)}
      <label class="dp-l" for="dpScheme">Scheme</label>
      <div class="dp-list" id="dpScheme">
        ${SCHEMES.map(([id, label, blurb]) => `
          <button class="dp-row${cur === id ? " on" : ""}" data-scheme="${esc(id)}"
                  aria-pressed="${cur === id}">
            <span class="dp-sw" data-skin-preview="${esc(id)}"><i></i><b></b></span>
            <span class="dp-rt"><b>${esc(label)}</b><span class="note">${esc(blurb)}</span></span>
          </button>`).join("")}
      </div>
      <p class="note">A scheme repaints the windows. It doesn't touch your profile's
      theme &mdash; that's yours, and other people see it.</p>`;
  },

  bgPane() {
    const cw = this.wall(), cp = this.pattern();
    return `${this.monitor(this.scheme())}
      <label class="dp-l">Wallpaper</label>
      <div class="dp-grid">
        ${WALLS.map(([id, label, cols]) => `
          <button class="dp-wall${cw === id ? " on" : ""}" data-wall="${esc(id)}" title="${esc(label)}"
                  aria-pressed="${cw === id}">
            <i style="${cols ? `background:radial-gradient(circle at 30% 20%,${cols[0]},${cols[1]} 60%,${cols[2]})` : ""}"></i>
            <span>${esc(label)}</span></button>`).join("")}
      </div>
      <label class="dp-l">Pattern</label>
      <div class="dp-grid">
        ${PATTERNS.map(([id, label]) => `
          <button class="dp-wall${cp === id ? " on" : ""}" data-pattern="${esc(id)}" title="${esc(label)}"
                  aria-pressed="${cp === id}">
            <i class="dp-pat" data-pat="${esc(id || "hatch")}"></i>
            <span>${esc(label)}</span></button>`).join("")}
      </div>`;
  },

  /* The swatches borrow the live tokens by rendering a real element under the
     skin attribute and reading back what the browser computed. Same trick the
     profile theme picker uses, and for the same reason: a hand-written swatch
     is a second copy of the palette that goes stale. */
  paintPicker() {
    document.querySelectorAll("[data-skin-preview]").forEach((el) => {
      const id = el.getAttribute("data-skin-preview");
      const probe = document.createElement("div");
      if (id) probe.dataset.skin = id;
      probe.style.cssText = "position:absolute;left:-9999px;width:4px;height:4px";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const g = (n) => cs.getPropertyValue(n).trim();
      // An empty id means "site default", which also has to honour dark mode.
      const face = id ? g("--gray") : (document.body.classList.contains("dark") ? "#3c3c3c" : "#c0c0c0");
      el.style.setProperty("--pv-face", face);
      el.style.setProperty("--pv-tb", `linear-gradient(90deg,${g("--tbA") || "#a33f00"},${g("--tbB") || "#ff7a00"})`);
      el.style.setProperty("--pv-desk",
        `radial-gradient(circle at 30% 20%,${g("--deskA")},${g("--deskB")} 60%,${g("--deskC")})`);
      el.style.setProperty("--pv-ink", id ? g("--ink") : (document.body.classList.contains("dark") ? "#ececec" : "#0a0a0a"));
      probe.remove();
    });
  },

  wire() {
    const box = document.getElementById("displayBody");
    if (!box) return;
    box.querySelectorAll("[data-dp-tab]").forEach((b) =>
      b.addEventListener("click", () => { this.tab = b.dataset.dpTab; this.render(); }));
    box.querySelectorAll("[data-scheme]").forEach((b) =>
      b.addEventListener("click", () => { this.set("scheme", b.dataset.scheme); this.render(); }));
    box.querySelectorAll("[data-wall]").forEach((b) =>
      b.addEventListener("click", () => { this.set("wall", b.dataset.wall); this.render(); }));
    box.querySelectorAll("[data-pattern]").forEach((b) =>
      b.addEventListener("click", () => { this.set("pattern", b.dataset.pattern); this.render(); }));
  },

  init() { this.apply(); },
};

/* Applied before first paint where possible, so nobody watches the desktop
   change colour a beat after it loads. */
Skin.apply();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Skin.init());
} else {
  Skin.init();
}
