/* =====================================================================
   THE SUPREME CHEETO v2
   Everything below runs client-side. Live figures come from
   /.netlify/functions/data (refreshed every 15 min by a scheduled job).
   If that endpoint is unreachable, the snapshot baked into SEED is used
   and the page says so — it never shows a number it can't source.
   ===================================================================== */

/* ---------- baked-in fallback snapshot (August 31, 2026) ---------- */
const SEED = {
  updatedAt: "2026-08-31T16:00:00Z",
  seeded: true,
  debt: { amount: 40077529831942.94, asOf: "2026-08-27", perSecond: 89380, ok: true },
  approval: { approve: 36.2, disapprove: 59.5, ok: true },
  gas: { v: 4.081, prev: 3.1885, ok: true },
  eggs: { v: 2.189, asOf: "July 2026", ok: true, manual: true },
  cpi: { v: 3.4, asOf: "July 2026", ok: true, manual: true },
  tariff: { v: 7.1, prev: 2.3, asOf: "June 2026", ok: true, manual: true },
  eo: { orders: 275, latestEO: 14421, signed: "2026-08-26",
        title: "Declaring a National Emergency To Secure the United States Bulk-Power System", ok: true },
  golf: { days: 129, pct: 21.9, ok: true },
  cheeto: 60.9,
  history: [],
  posts: {
    ok: true, via: "snapshot",
    list: [
      { id: "41408", at: "2026-08-30T22:18:00Z", text: "Kharg Island being blown to smithereens!!! President DJT" },
      { id: "41406", at: "2026-08-30T21:18:00Z", text: "Being interviewed by Trey Gowdy, NOW!" },
      { id: "41405", at: "2026-08-30T20:26:00Z", text: "For many years, the USA has been losing more than 60 Billion Dollars a year with Canada. Why??? Our long ago stolen businesses are now coming back to America in order to avoid paying tariffs. They are lining up, just like the rest of the World!!! President DJT" },
      { id: "41404", at: "2026-08-30T20:18:00Z", text: "Governor Kathy Hochul just released 7000 hard core criminals onto the streets on New York. What is wrong with her? She is grossly incompetent and must be voted out of office! President DJT" },
      { id: "41403", at: "2026-08-30T19:56:00Z", text: "A wonderful new book by Ted Cruz, about a Great Supreme Court Justice, Clarence Thomas, is just out!" },
      { id: "41402", at: "2026-08-30T19:03:00Z", text: "Kennedy Center is an old and decrepit building..." },
      { id: "41400", at: "2026-08-30T17:36:00Z", text: null, note: "link post" }
    ]
  }
};

const INAUGURATION = Date.parse("2025-01-20T17:00:00Z");
const TERM_END = Date.parse("2029-01-20T17:00:00Z");
const DEBT_AT_INAUG = 36206593315575.15;
const POPULATION = 342500000;

let D = structuredClone(SEED);

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));

function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24,
        m = Math.floor(s / 60) % 60, sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/* =====================================================================
   WINDOW MANAGER
   ===================================================================== */
const WM = {
  z: 20,
  wins: [],
  mobile: false,
  KEY: "cheeto_wm_v2",

  init() {
    this.wins = $$(".win[id^='w-']").map((el) => {
      const d = el.dataset;
      return {
        el, id: el.id, title: d.title, icon: d.icon,
        def: { x: +d.x, y: +d.y, w: +d.w, h: +d.h },
        open: true, min: false, max: false, rolled: false,
      };
    });
    this.mq = matchMedia("(max-width: 820px)");
    this.mobile = this.mq.matches;
    document.body.classList.toggle("mobile", this.mobile);
    this.mq.addEventListener("change", (e) => {
      this.mobile = e.matches;
      document.body.classList.toggle("mobile", this.mobile);
      this.layout();
    });

    this.wins.forEach((w) => this.wire(w));
    this.buildIcons();
    this.buildStart();
    this.restore();
    this.layout();

    // Something should always look focused on arrival, or every title bar reads dead.
    // On mobile the feed is the reason people are here, so open on that.
    const first = this.mobile
      ? (this.byId("w-truth") || this.wins[0])
      : (this.wins.find((w) => w.open && !w.min) || this.wins[0]);
    if (first) this.focus(first, true);
    this.renderTasks();

    // clicking bare desktop blurs
    $("#desktop").addEventListener("pointerdown", (e) => {
      if (e.target.id === "desktop" || e.target.closest("#wallpaper")) this.blurAll();
    });

    // Resizing the browser (or rotating a phone) used to leave windows wider
    // than the desktop or stranded past its edge, with no way back short of
    // resetting the layout. Re-clamp everything on resize, debounced.
    let rt;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (this.mobile) return;
        this.wins.forEach((w) => {
          if (w.el.hidden) return;
          if (w.max) { Object.assign(w.el.style, { left: "0px", top: "0px", width: "100%", height: "100%" }); return; }
          this.clampIntoView(w);
          this.remember(w);
        });
        this.save();
      }, 140);
    });
    window.addEventListener("orientationchange", () => setTimeout(() => this.layout(), 260));
  },

  byId(id) { return this.wins.find((w) => w.id === id); },

  layout() {
    // Which windows are open by default: on desktop, a curated set; on mobile, one.
    const DEFAULT_OPEN = ["w-debt", "w-truth", "w-polls", "w-meter"];
    this.wins.forEach((w) => {
      // Transient windows (the visit digest) have an empty body until something
      // fills them. Mobile unhides everything by design, which would otherwise
      // leave an empty panel sitting in the stack forever.
      if (w.el.dataset.transient !== undefined) {
        w.el.style.left = w.el.style.top = w.el.style.width = w.el.style.height = "";
        w.open = false; w.el.hidden = true;
        return;
      }
      if (this.mobile) {
        w.el.style.left = w.el.style.top = w.el.style.width = w.el.style.height = "";
        w.el.hidden = false;
      } else {
        w.el.hidden = !w.open;
        if (!w.saved) {
          w.el.style.left = w.def.x + "px";
          w.el.style.top = w.def.y + "px";
          w.el.style.width = w.def.w + "px";
          w.el.style.height = w.def.h + "px";
        }
        if (!DEFAULT_OPEN.includes(w.id) && !w.touched) { w.open = false; w.el.hidden = true; }
        this.clampIntoView(w);
      }
    });
    if (this.mobile) {
      const act = this.wins.find((w) => w.el.classList.contains("active")) || this.byId("w-truth");
      this.focus(act, true);
    }
    this.renderTasks();
  },

  clampIntoView(w) {
    const desk = $("#desktop");
    const deskW = desk.clientWidth, deskH = desk.clientHeight;

    // Fit to the viewport, but never below the window's own design size and
    // never above the size the user chose. Growing the browser back should
    // give the window its space back rather than leaving it squashed.
    const want = this.goodSize(w);
    const targetW = Math.max(230, Math.min(want.w, deskW - 16));
    const targetH = Math.max(110, Math.min(want.h, deskH - 16));
    w.el.style.width = targetW + "px";
    w.el.style.height = w.rolled ? "" : targetH + "px";

    let x = parseInt(w.el.style.left) || 0, y = parseInt(w.el.style.top) || 0;
    // keep at least a grab-able strip of title bar on screen
    x = Math.min(Math.max(0, x), Math.max(0, deskW - Math.min(targetW, 120)));
    y = Math.min(Math.max(0, y), Math.max(0, deskH - 30));
    w.el.style.left = x + "px";
    w.el.style.top = y + "px";
  },

  wire(w) {
    const el = w.el, tb = $(".tb", el);

    el.addEventListener("pointerdown", () => this.focus(w), true);

    // Not every window carries all three buttons — a transient panel has no
    // maximise, for instance. Wiring them unconditionally threw on the first
    // window that omitted one and aborted the whole init loop partway through,
    // leaving every window after it dead. Wire what's actually there.
    const btn = (sel, fn) => {
      const b = $(sel, el);
      if (b) b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    };
    btn("[data-min]", () => this.minimize(w));
    btn("[data-max]", () => this.toggleMax(w));
    btn("[data-close]", () => this.close(w));

    tb.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      w.rolled = !w.rolled;
      el.classList.toggle("rolled", w.rolled);
      if (!w.rolled) el.style.height = (w.lastH || w.def.h) + "px";
      else { w.lastH = el.offsetHeight; }
      this.save();
    });

    /* ---- drag ---- */
    let pid = null, sx = 0, sy = 0, ox = 0, oy = 0;
    tb.addEventListener("pointerdown", (e) => {
      if (this.mobile || w.max || e.target.closest("button")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      ox = parseInt(el.style.left) || 0; oy = parseInt(el.style.top) || 0;
      el.classList.add("dragging"); this.focus(w);
      try { tb.setPointerCapture(pid); } catch {}
      e.preventDefault();
    });
    tb.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pid) return;
      const deskW = $("#desktop").clientWidth, deskH = $("#desktop").clientHeight;
      el.style.left = clamp(ox + e.clientX - sx, -el.offsetWidth + 90, deskW - 60) + "px";
      el.style.top = clamp(oy + e.clientY - sy, 0, deskH - 26) + "px";
    });
    const endDrag = (e) => {
      if (e.pointerId !== pid) return;
      pid = null; el.classList.remove("dragging"); this.save();
      try { tb.releasePointerCapture(e.pointerId); } catch {}
    };
    tb.addEventListener("pointerup", endDrag);
    tb.addEventListener("pointercancel", endDrag);

    /* ---- keyboard move ---- */
    tb.tabIndex = 0;
    tb.setAttribute("role", "button");
    tb.setAttribute("aria-label", w.title + " — drag to move, arrows to nudge");
    tb.addEventListener("keydown", (e) => {
      if (this.mobile) return;
      const step = e.shiftKey ? 40 : 12;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        el.style.left = (parseInt(el.style.left) || 0) + map[e.key][0] + "px";
        el.style.top = Math.max(0, (parseInt(el.style.top) || 0) + map[e.key][1]) + "px";
        this.focus(w); this.clampIntoView(w); this.save(); e.preventDefault();
      }
      if (e.key === "Enter" || e.key === " ") { this.focus(w); e.preventDefault(); }
    });

    /* ---- resize ---- */
    const grip = $(".grip", el);
    if (grip) {
      let rp = null, rx = 0, ry = 0, rw = 0, rh = 0;
      grip.addEventListener("pointerdown", (e) => {
        if (this.mobile || w.max) return;
        rp = e.pointerId; rx = e.clientX; ry = e.clientY;
        rw = el.offsetWidth; rh = el.offsetHeight;
        el.classList.add("resizing"); this.focus(w);
        try { grip.setPointerCapture(rp); } catch {}
        e.preventDefault(); e.stopPropagation();
      });
      grip.addEventListener("pointermove", (e) => {
        if (e.pointerId !== rp) return;
        el.style.width = Math.max(230, rw + e.clientX - rx) + "px";
        el.style.height = Math.max(110, rh + e.clientY - ry) + "px";
      });
      const endR = (e) => {
        if (e.pointerId !== rp) return;
        rp = null; el.classList.remove("resizing"); this.remember(w); this.save();
        try { grip.releasePointerCapture(e.pointerId); } catch {}
      };
      grip.addEventListener("pointerup", endR);
      grip.addEventListener("pointercancel", endR);
    }
  },

  focus(w, silent) {
    if (!w) return;
    if (this.mobile) {
      this.wins.forEach((x) => x.el.classList.toggle("active", x === w));
      w.open = true; w.min = false;
      if (!silent) w.el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      if (w.min || !w.open) { w.min = false; w.open = true; w.el.hidden = false; }
      this.wins.forEach((x) => x.el.classList.toggle("active", x === w));
      w.el.style.zIndex = ++this.z;
    }
    w.touched = true;
    this.renderTasks();
  },

  blurAll() { this.wins.forEach((w) => w.el.classList.remove("active")); this.renderTasks(); },

  open(id) {
    const w = this.byId(id); if (!w) return;
    const wasClosed = !w.open;
    w.open = true; w.min = false; w.touched = true; w.el.hidden = false;
    // Cheetip reacts to what you actually opened — that is the whole joke.
    if (wasClosed) setTimeout(() => Cheetip?.react?.("window", { id: w.id }), 450);
    w.rolled = false; w.el.classList.remove("rolled");
    if (!this.mobile) {
      // Force a real size on open. A window that was hidden has no measurable
      // box, so without this it appears at the CSS minimum.
      const g = this.goodSize(w);
      const cw = parseInt(w.el.style.width) || 0, ch = parseInt(w.el.style.height) || 0;
      if (cw < 200) w.el.style.width = g.w + "px";
      if (ch < 90)  w.el.style.height = g.h + "px";
    }
    this.focus(w); this.clampIntoView(w); this.save();
    // windows that fetch their own data populate on first open
    if (id === "w-board" && typeof loadBoard === "function") loadBoard();
    if (id === "w-people" && typeof People === "object") People.load();
    if (id === "w-profile" && typeof renderProfileEditor === "function") renderProfileEditor();
    if (id === "w-admin" && typeof loadHealth === "function") { loadHealth(); loadUsers(); }
  },

  close(w) {
    if (this.mobile) return;
    w.open = false; w.touched = true; w.el.hidden = true;
    w.el.classList.remove("active");
    this.renderTasks(); this.save();
  },

  minimize(w) {
    if (this.mobile) { w.rolled = !w.rolled; w.el.classList.toggle("rolled", w.rolled); return; }
    w.min = true; w.el.hidden = true; w.el.classList.remove("active");
    this.renderTasks(); this.save();
  },

  toggleMax(w) {
    if (this.mobile) return;
    const el = w.el;
    if (w.max) {
      Object.assign(el.style, w.pre);
      w.max = false;
    } else {
      w.pre = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      Object.assign(el.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
      w.max = true;
    }
    this.focus(w); this.save();
  },

  buildIcons() {
    const box = $("#icons");
    box.innerHTML = "";
    const SHORT = { "w-truth": "Truth Feed", "w-debt": "Debt Clock", "w-chat": "CheetoChat",
                    "w-board": "FYP", "w-meter": "Cheeto-Meter", "w-sol": "Solitaire",
                    "w-mine": "Minesweeper", "w-about": "About", "w-predict": "Call It", "w-tally": "Since You", "w-buddies": "Buddy List", "w-st-bobby": "BOBBYjayyy", "w-st-benp": "benp90" };
    ["w-truth", "w-st-bobby", "w-st-benp", "w-buddies", "w-predict", "w-tally", "w-chat", "w-debt", "w-about"].forEach((id) => {
      const w = this.byId(id); if (!w) return;
      const b = document.createElement("button");
      b.className = "dicon"; b.type = "button";
      b.innerHTML = `<span class="g">${w.icon}</span><span class="l">${esc(SHORT[id] || w.title)}</span>`;
      b.addEventListener("dblclick", () => this.open(id));
      b.addEventListener("click", (e) => { if (e.detail === 0) this.open(id); });
      b.addEventListener("keydown", (e) => { if (e.key === "Enter") this.open(id); });
      box.appendChild(b);
    });
  },

  buildStart() {
    const ul = $("#startList");
    const win = (id) => { const w = this.byId(id); return w ? { label: w.title, icon: w.icon, act: () => this.open(id) } : null; };

    // Grouped rather than one flat list of everything. The old build listed
    // every window AND repeated some of them again below, which is the
    // duplication you spotted.
    const groups = [
      { head: "Trackers", items: ["w-debt", "w-truth", "w-polls", "w-meter", "w-econ", "w-tally", "w-count", "w-golf", "w-eo"] },
      { head: "Internet",  items: ["w-st-bobby", "w-st-benp"] },
      { head: "Games",    items: ["w-predict", "w-sol", "w-bj", "w-mine", "w-ball"] },
      { head: "Community",items: ["w-buddies", "w-people", "w-chat", "w-board", "w-profile", "w-live"] },
    ];

    const rows = [];
    groups.forEach((g) => {
      rows.push({ head: g.head });
      g.items.map(win).filter(Boolean).forEach((r) => rows.push(r));
      // "My Page" isn't a window in its own right — it's the shared profile
      // window pointed at you — so it can't come from the id list above.
      if (g.head === "Community") {
        rows.push({ label: "My Page", icon: "&#128100;",
                    act: () => { if (typeof Profile === "object") Profile.openMine(); } });
        rows.push({ label: "Notifications", icon: "&#128172;",
                    act: () => { if (typeof Notify === "object") Notify.open(); } });
        rows.push({ label: "Getting started", icon: "&#128075;",
                    act: () => { if (typeof Welcome === "object") { WM.open("w-welcome"); Welcome.refresh(); } } });
      }
    });

    rows.push({ head: "Settings" });
    rows.push({ label: "Light / dark mode", icon: "&#127761;", id: "themeItem", act: () => Theme.toggle() });
    rows.push({ label: "Install to home screen", icon: "&#128229;", id: "installItem", act: () => promptInstall() });
    rows.push({ label: "Refresh data now", icon: "&#128260;", act: () => loadLive(true) });
    rows.push({ label: "Show Cheetip", icon: "&#129472;", act: () => Cheetip.show() });
    rows.push({ label: "Buddy sounds: off", icon: "&#128266;", id: "soundItem",
                act: () => Snd.setOn(!Snd.on()) });
    rows.push({ label: "Block pop-ups", icon: "&#128683;", id: "popupItem",
                act: () => Popups.setBlocked(!Popups.blocked()) });
    rows.push({ label: "Reset window layout", icon: "&#129704;",
                act: () => { localStorage.removeItem(this.KEY); location.reload(); } });
    rows.push({ label: "Admin panel", icon: "&#128737;", id: "adminItem", act: () => openAdmin() });
    rows.push({ head: "" });
    rows.push({ label: "About", icon: "&#8505;", act: () => this.open("w-about") });
    rows.push({ label: "Shut Down…", icon: "&#9211;", act: () => showModal("Shut Down", "&#9211;",
        "It is now safe to turn off your computer.<br><br><span style='color:#555;font-size:11px'>(It is not. This is a webpage.)</span>") });

    ul.innerHTML = "";
    rows.forEach((it) => {
      if (it.head !== undefined) {
        if (it.head === "") { ul.appendChild(document.createElement("hr")); return; }
        const h = document.createElement("li");
        h.className = "menu-head";
        h.textContent = it.head;
        ul.appendChild(h);
        return;
      }
      const li = document.createElement("li");
      if (it.id) li.id = it.id;
      if (it.id === "installItem") li.hidden = !deferredInstall;
      if (it.id === "adminItem") li.hidden = true;         // revealed for admins only
      li.innerHTML = `<span>${it.icon}</span><span class="lbl">${esc(it.label)}</span>`;
      li.addEventListener("click", () => {
        $("#startMenu").hidden = true; $("#startBtn").classList.remove("on"); it.act();
      });
      ul.appendChild(li);
    });
  },

  renderTasks() {
    const box = $("#tasks");
    const want = this.wins.filter((w) => this.mobile || (w.open && !w.min) || w.min);
    box.innerHTML = "";
    want.forEach((w) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `${w.icon} ${esc(w.title)}`;
      b.className = w.el.classList.contains("active") && !w.min ? "on" : "";
      b.addEventListener("click", () => {
        if (!this.mobile && w.el.classList.contains("active") && !w.min) this.minimize(w);
        else this.open(w.id);
      });
      box.appendChild(b);
    });
  },

  // Record the last geometry a window had while it was actually visible and
  // un-rolled. offsetWidth/offsetHeight are 0 when hidden and tiny when rolled,
  // so reading them blindly is what made reopened windows collapse.
  remember(w) {
    if (this.mobile || w.el.hidden || w.rolled || w.max) return;
    const ow = w.el.offsetWidth, oh = w.el.offsetHeight;
    if (ow > 40 && oh > 40) { w.lastW = ow; w.lastH = oh; }
  },

  goodSize(w) {
    return {
      w: w.lastW || w.def.w,
      h: w.lastH || w.def.h,
    };
  },

  save() {
    if (this.mobile) return;
    try {
      const state = {};
      this.wins.forEach((x) => {
        this.remember(x);
        const g = this.goodSize(x);
        state[x.id] = {
          x: parseInt(x.el.style.left) || 0, y: parseInt(x.el.style.top) || 0,
          w: g.w, h: g.h,
          open: x.open, min: x.min, rolled: x.rolled, touched: !!x.touched,
        };
      });
      localStorage.setItem(this.KEY, JSON.stringify(state));
    } catch {}
  },

  restore() {
    if (this.mobile) return;
    let state; try { state = JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch { return; }
    if (!state) return;
    this.wins.forEach((w) => {
      const s = state[w.id]; if (!s) return;
      // Saves written before the sizing fix can contain 0x0 or a rolled-up
      // height. Anything implausible falls back to the window's design size.
      const width  = (s.w && s.w >= 200) ? s.w : w.def.w;
      const height = (s.h && s.h >= 90)  ? s.h : w.def.h;
      // A transient window has an empty body until something fills it, so
      // restoring it "open" would reopen a blank window every visit.
      const openState = w.el.dataset.transient !== undefined ? false : s.open;
      w.saved = true; w.open = openState; w.min = s.min; w.rolled = s.rolled; w.touched = s.touched;
      w.lastW = width; w.lastH = height;
      Object.assign(w.el.style, { left: s.x + "px", top: s.y + "px", width: width + "px", height: height + "px" });
      w.el.classList.toggle("rolled", !!s.rolled);
      w.el.hidden = !openState || s.min;
    });
  },
};

/* =====================================================================
   RENDERERS
   ===================================================================== */
let debtAtLoad = 0, seedMs = 0;
const pageLoadedAt = Date.now();

function liveDebt() {
  return D.debt.amount + ((Date.now() - seedMs) / 1000) * (D.debt.perSecond || 89380);
}

function tickDebt() {
  if (!D.debt?.amount) return;
  renderDebtPanel();
}

/* =====================================================================
   DEBT PANEL
   The Treasury publishes once per business day, so polling harder buys
   nothing. What makes this legible isn't more data — it's showing the same
   number four ways: a mechanical odometer for the speed, real-world
   conversions for the scale, your own slice for the personal bit, and a rate
   table for the arithmetic. Everything below derives from one seeded figure
   plus the trailing-average rate; nothing here is invented.
   ===================================================================== */

/* Rough, deliberately round reference prices. These are order-of-magnitude
   comparisons, labelled as estimates in the UI — not claims to the dollar. */
const BUYS = [
  { n: "Big Macs",                    v: 5.99,        e: "🍔" },
  { n: "iPhones",                     v: 999,         e: "📱" },
  { n: "median US homes",             v: 420000,      e: "🏠" },
  { n: "Rivian gigafactories",        v: 5e9,         e: "🏭" },
  { n: "years of NASA",               v: 25.4e9,      e: "🚀" },
  { n: "Nimitz-class carriers",       v: 13e9,        e: "🚢" },
  { n: "entire NFLs (all 32 teams)",  v: 163e9,       e: "🏈" },
];

function fmtCount(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " trillion";
  if (n >= 1e9)  return (n / 1e9).toFixed(1)  + " billion";
  if (n >= 1e6)  return (n / 1e6).toFixed(1)  + " million";
  if (n >= 1e3)  return Math.round(n).toLocaleString();
  return n.toFixed(n < 10 ? 1 : 0);
}

/* ---------- mechanical odometer ---------- */
const Odo = {
  el: null, chars: [],

  mount(el) {
    this.el = el;
    this.chars = [];
    el.classList.add("odo-mech");
    el.innerHTML = "";
  },

  /* Build only when the character layout changes (e.g. the number gains a
     digit); otherwise just move existing strips, which is what makes it roll. */
  render(str) {
    if (!this.el) return;
    if (this.chars.length !== str.length) {
      this.el.innerHTML = "";
      this.chars = [...str].map((ch) => {
        if (/\d/.test(ch)) {
          const d = document.createElement("span");
          d.className = "odo-d";
          const strip = document.createElement("span");
          strip.className = "odo-strip";
          strip.innerHTML = "0123456789".split("").map((n) => `<i>${n}</i>`).join("");
          d.appendChild(strip);
          this.el.appendChild(d);
          return { type: "d", strip, last: -1 };
        }
        const s = document.createElement("span");
        s.className = "odo-sep";
        s.textContent = ch;
        this.el.appendChild(s);
        return { type: "s", el: s, ch };
      });
    }
    [...str].forEach((ch, i) => {
      const c = this.chars[i];
      if (!c) return;
      if (c.type === "d") {
        const v = +ch;
        if (v !== c.last) { c.strip.style.transform = `translateY(${-v * 10}%)`; c.last = v; }
      } else if (c.ch !== ch) { c.el.textContent = ch; c.ch = ch; }
    });
  },
};

function renderDebtPanel() {
  const now = liveDebt();
  const perSec = D.debt?.perSecond || 89380;

  Odo.render("$" + Math.floor(now).toLocaleString("en-US"));

  // If the visitor told us their household size, "your share" stops being the
  // national number divided by everybody — which is identical for every reader
  // and so isn't really "yours" at all — and becomes their household's slice.
  const hh = (typeof Tally === "object" && Tally.household && Tally.household()) || null;
  const share = (now / POPULATION) * (hh || 1);
  const el = (id, v) => { const n = $(id); if (n) n.textContent = v; };

  el("#shareLegend", hh ? `Your household's share of it` : "Your share of it");
  el("#shareWho", hh ? `Household of ${hh}` : `Per person, all ${fmtCount(POPULATION)} of us`);
  const edit = $("#shareEdit");
  if (edit) edit.textContent = hh ? "Change" : "Make it mine";

  el("#perCitizen", money(share, 2));
  el("#shareSince", money((Date.now() - pageLoadedAt) / 1000 * (perSec / POPULATION) * (hh || 1), 4));
  el("#debtSince", money((now - DEBT_AT_INAUG) / 1e12, 3) + "T");
  el("#sessionDebt", money(now - debtAtLoad, 0));

  el("#rateSec",  money(perSec, 0));
  el("#rateMin",  money(perSec * 60, 0));
  el("#rateHour", money(perSec * 3600, 0));
  el("#rateDay",  money(perSec * 86400, 0));
  el("#rateYear", money(perSec * 31557600 / 1e12, 2) + "T");

  const buysEl = $("#debtBuys");
  if (buysEl) {
    buysEl.innerHTML = BUYS.map((b) => `
      <div class="buy">
        <span class="buy-e" aria-hidden="true">${b.e}</span>
        <b>${esc(fmtCount(now / b.v))}</b>
        <span class="buy-n">${esc(b.n)}</span>
      </div>`).join("");
  }
}

function renderApproval() {
  const a = D.approval?.approve, d = D.approval?.disapprove;
  if (a == null || d == null) return;
  $("#barApp").style.width = a + "%"; $("#lblApp").innerHTML = `<span>${a.toFixed(1)}%</span>`;
  $("#barDis").style.width = d + "%"; $("#lblDis").innerHTML = `<span>${d.toFixed(1)}%</span>`;
  const net = a - d;
  $("#netApp").textContent = `NET ${net > 0 ? "+" : ""}${net.toFixed(1)} PTS`;
}

function renderEcon() {
  const rows = [
    { label: "Gas, regular (nat'l avg)", v: D.gas?.v, prev: D.gas?.prev, fmt: "$", suf: "/gal", cmp: "vs. year ago", mode: "pct" },
    { label: "Eggs, Grade A large", v: D.eggs?.v, fmt: "$", suf: "/doz", cmp: "BLS, " + (D.eggs?.asOf || "—") },
    { label: "CPI inflation, YoY", v: D.cpi?.v, prev: 2, suf: "%", cmp: "vs. 2% target · " + (D.cpi?.asOf || "—"), mode: "pts" },
    { label: "Effective tariff rate", v: D.tariff?.v, prev: D.tariff?.prev, suf: "%", cmp: "vs. Jan 2025", mode: "pts" },
  ];
  $("#econ").innerHTML = rows.filter((r) => r.v != null).map((r) => {
    const val = (r.fmt || "") + r.v.toLocaleString("en-US", { minimumFractionDigits: r.v < 10 ? 3 : 2, maximumFractionDigits: r.v < 10 ? 3 : 2 }) + (r.suf || "");
    let delta = `<span style="color:#666;font-size:10px">${esc(r.cmp)}</span>`;
    if (r.prev != null) {
      const raw = r.mode === "pts" ? r.v - r.prev : ((r.v - r.prev) / r.prev) * 100;
      const unit = r.mode === "pts" ? " pts" : "%";
      delta = `<span class="${raw >= 0 ? "up" : "down"}">${raw >= 0 ? "▲" : "▼"} ${Math.abs(raw).toFixed(1)}${unit}</span> <span style="color:#666;font-size:10px">${esc(r.cmp)}</span>`;
    }
    return `<div class="kv"><span>${esc(r.label)}</span><span><b>${val}</b> ${delta}</span></div>`;
  }).join("");
}

function renderMeter() {
  // If the visitor has set their own component weights, the gauge follows
  // THEIR reading. The site's own equal-weight figure is still shown beside it
  // in the breakdown, so the published number is never hidden or overwritten.
  const custom = typeof MyMeter === "object" ? MyMeter.weights?.() : null;
  const s = custom ? MyMeter.score(custom) : (D.cheeto ?? 0);
  $("#cheetoVal").textContent = s.toFixed(1) + " / 100" + (custom ? " (yours)" : "");
  $("#needle").setAttribute("transform", `rotate(${-90 + (s / 100) * 180} 100 100)`);
  const labels = [[20, "MILD SALSA 🟢"], [40, "MEDIUM 🟡"], [60, "FLAMIN' HOT 🟠"], [80, "XXTRA FLAMIN' 🔴"], [101, "MELTING THE BAG 🔥"]];
  $("#cheetoLabel").textContent = (labels.find((l) => s < l[0]) || labels[4])[1];

  const pets = [[20, "😌", "All quiet. Suspiciously quiet."],
                [40, "🙂", "Normal amount of chaos today."],
                [60, "😬", "Things are getting spicy."],
                [80, "🥵", "I am sweating cheese dust."],
                [101, "🔥", "THE BAG IS ON FIRE. THIS IS FINE."]];
  const p = pets.find((x) => s < x[0]) || pets[4];
  $("#pet").textContent = p[1];
  $("#petsay").textContent = p[2];
}

function renderGolfEO() {
  if (D.golf?.days != null) {
    $("#golfDays").textContent = D.golf.days;
    const pct = D.golf.pct ?? (D.golf.days / ((Date.now() - INAUGURATION) / 864e5)) * 100;
    $("#barGolf").style.width = pct + "%";
    $("#lblGolf").innerHTML = `<span>${pct.toFixed(1)}% OF DAYS IN OFFICE</span>`;
  }
  if (D.eo?.orders != null) {
    $("#eoCount").textContent = D.eo.orders;
    const weeks = (Date.parse(D.eo.signed || Date.now()) - INAUGURATION) / 6048e5;
    $("#eoRate").textContent = weeks > 0 ? (D.eo.orders / weeks).toFixed(1) : "—";
    $("#eoLatest").textContent = "EO " + (D.eo.latestEO ?? "—");
    $("#eoTitle").textContent = D.eo.title ? `“${D.eo.title}”` : "";
  }
}

function tickCountdown() {
  const now = Date.now();
  const ms = Math.max(0, TERM_END - now);
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24,
        m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  $("#cd").textContent = `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  const pct = ((now - INAUGURATION) / (TERM_END - INAUGURATION)) * 100;
  $("#served").textContent = Math.floor((now - INAUGURATION) / 864e5).toLocaleString() + " days";
  $("#remain").textContent = d.toLocaleString() + " days";
  $("#barTerm").style.width = pct.toFixed(1) + "%";
  $("#lblTerm").innerHTML = `<span>${pct.toFixed(1)}% COMPLETE</span>`;
}

/* ---------- Truth feed + post watch ---------- */
let seenIds = new Set();
try { seenIds = new Set(JSON.parse(localStorage.getItem("cheeto_seen") || "[]")); } catch {}

function postTime(p) {
  const t = Date.parse(p.at);
  return isFinite(t) ? t : null;
}

function renderFeed() {
  const list = D.posts?.list || [];
  const withText = list.filter((p) => p.text);

  $("#feed").innerHTML = list.map((p) => {
    const isNew = p.id && !seenIds.has(p.id) && !D.seeded;
    const when = postTime(p);
    const stamp = when ? new Date(when).toLocaleString("en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : (p.at || "—");
    const body = p.text
      ? `<div class="txt">${esc(p.text)}</div>`
      : `<div class="txt img-only">[ ${esc(p.note || "no text")} ]</div>`;
    return `<div class="post${isNew ? " isnew" : ""}" data-pid="${esc(p.id || "")}">
      <div class="meta">${esc(stamp)}${isNew ? ' <span class="newbadge">NEW</span>' : ""}
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</div>
      ${body}
      ${p.id ? `<div class="rx" data-rx="${esc(p.id)}"></div>` : ""}
      ${p.text ? `<div class="acts"><button data-share="${esc(p.id)}">🖼 Save as error dialog</button>
                   <button data-copy="${esc(p.id)}">📋 Copy</button></div>` : ""}
    </div>`;
  }).join("") || '<div style="color:var(--field-dim)">No posts available.</div>';

  // shout analysis
  const all = withText.map((p) => p.text).join(" ");
  const words = all.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  const caps = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 2 && w === w.toUpperCase());
  const bangs = (all.match(/!/g) || []).length;
  $("#capsN").textContent = withText.length;
  $("#capsPct").textContent = words.length ? ((caps.length / words.length) * 100).toFixed(1) + "%" : "—";
  $("#bangs").textContent = bangs;
  $("#bangsAvg").textContent = withText.length ? (bangs / withText.length).toFixed(1) : "—";

  // counts
  const now = Date.now();
  const times = list.map(postTime).filter(Boolean);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  $("#postsToday").textContent = times.filter((t) => t >= today.getTime()).length;
  $("#posts24").textContent = times.filter((t) => now - t < 864e5).length;

  // remember what we've shown
  try {
    list.forEach((p) => p.id && seenIds.add(p.id));
    localStorage.setItem("cheeto_seen", JSON.stringify([...seenIds].slice(-300)));
  } catch {}

  $$("[data-share]").forEach((b) => b.addEventListener("click", () => shareCard(b.dataset.share)));
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const p = (D.posts?.list || []).find((x) => x.id === b.dataset.copy);
    if (!p) return;
    try { await navigator.clipboard.writeText(p.text); b.textContent = "✓ Copied"; setTimeout(() => (b.textContent = "📋 Copy"), 1400); }
    catch { showModal("Copy failed", "⚠", "Your browser blocked clipboard access. Select the text manually."); }
  }));
}

function tickWatch() {
  const times = (D.posts?.list || []).map(postTime).filter(Boolean);
  if (!times.length) { $("#sinceLast").textContent = "—"; return; }
  const last = Math.max(...times);
  const delta = Date.now() - last;
  $("#sinceLast").textContent = ago(delta) + " SINCE LAST POST";
  const tw = $("#trayWatch");
  tw.textContent = "👁 " + ago(delta).replace(/\s\d+s$/, "");
  tw.classList.toggle("hot", delta < 15 * 60000);
}

/* ---------- sparklines ---------- */
function spark(svgEl, values, color) {
  if (!svgEl) return;
  const pts = values.filter((v) => v != null && isFinite(v));
  if (pts.length < 2) {
    svgEl.innerHTML = `<text x="150" y="22" text-anchor="middle" font-size="9" fill="currentColor" opacity=".55">collecting history…</text>`;
    return;
  }
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const W = 300, H = 38, pad = 3;
  const d = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - pad - ((v - min) / span) * (H - pad * 2);
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const lastX = W, lastY = H - pad - ((pts[pts.length - 1] - min) / span) * (H - pad * 2);
  svgEl.innerHTML =
    `<path d="${d} L${W} ${H} L0 ${H} Z" fill="${color}" opacity=".16"/>
     <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
     <circle cx="${lastX - 2}" cy="${lastY.toFixed(1)}" r="2.5" fill="${color}"/>`;
}

function renderSparks() {
  const h = D.history || [];
  // An empty chart that says "collecting history…" reads as broken. Show
  // nothing until there are enough points for the shape to mean something.
  const enough = h.length >= 12;
  [["#fsSparkDebt"], ["#fsSparkApp"], ["#fsSparkGas"]].forEach(([id]) => {
    const el = $(id); if (el) el.hidden = !enough;
  });
  const ch = $("#sparkCheeto"); if (ch) ch.hidden = !enough;
  if (!enough) return;
  spark($("#sparkDebt"), h.map((x) => x.debt), "#0a7d0a");
  spark($("#sparkApp"), h.map((x) => x.approve), "#000080");
  spark($("#sparkGas"), h.map((x) => x.gas), "#a33f00");
  spark($("#sparkCheeto"), h.map((x) => x.cheeto), "#c00");
}

/* ---------- freshness ---------- */
function freshClass(node) {
  if (!node) return ["fresh-bad", "unavailable"];
  if (node.ok === false) return ["fresh-bad", "stale — last good: " + (node.at ? new Date(node.at).toLocaleString() : "unknown")];
  if (!node.at) return ["fresh-old", "from the built-in snapshot"];
  const age = Date.now() - Date.parse(node.at);
  if (age < 40 * 60000) return ["fresh-ok", "live · " + ago(age) + " ago"];
  if (age < 6 * 3600000) return ["fresh-old", ago(age) + " ago"];
  return ["fresh-bad", "stale · " + ago(age) + " ago"];
}

function renderFreshness() {
  const map = { "#stDebt": D.debt, "#stTruth": D.posts, "#stPolls": D.approval,
                "#stEcon": D.gas, "#stGolf": D.golf, "#stEo": D.eo };
  Object.entries(map).forEach(([sel, node]) => {
    const el = $(sel); if (!el) return;
    const [cls, txt] = freshClass(node);
    el.className = "freshness " + cls;
    el.textContent = txt;
  });
  $("#freshAll").innerHTML = Object.entries({
    "National debt": D.debt, "Truth Social": D.posts, "Approval": D.approval,
    "Gas": D.gas, "Golf": D.golf, "Executive orders": D.eo,
  }).map(([k, v]) => {
    const [cls, txt] = freshClass(v);
    return `<div class="kv"><span>${k}</span><span class="freshness ${cls}">${esc(txt)}</span></div>`;
  }).join("");

  $("#srcList").innerHTML = [
    ["U.S. Treasury — Debt to the Penny", "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny"],
    ["Truth Social / trumpstruth.org mirror", "https://trumpstruth.org/"],
    ["FiftyPlusOne approval average", "https://fiftyplusone.news/polls/approval/president"],
    ["AAA Fuel Prices", "https://gasprices.aaa.com/"],
    ["BLS Consumer Price Index", "https://www.bls.gov/news.release/cpi.nr0.htm"],
    ["Penn Wharton effective tariff rate", "https://budgetmodel.wharton.upenn.edu/"],
    ["Federal Register — executive orders", "https://www.federalregister.gov/presidential-documents/executive-orders"],
    ["donaldtrump.golf", "https://donaldtrump.golf/"],
  ].map(([n, u]) => `<div>· <a href="${u}" target="_blank" rel="noopener">${esc(n)}</a></div>`).join("");
}

function renderAll() {
  seedMs = Date.parse((D.debt?.asOf || "2026-08-27") + "T00:00:00Z");
  if (!debtAtLoad) debtAtLoad = liveDebt();
  tickDebt(); renderApproval(); renderEcon(); renderMeter();
  renderGolfEO(); renderFeed(); renderSparks(); renderFreshness(); tickWatch();
  // modules that load after this file listen for this instead of being called
  document.dispatchEvent(new CustomEvent("cheeto:data"));
}

/* =====================================================================
   LIVE DATA
   ===================================================================== */
let lastGood = 0;
async function loadLive(manual) {
  try {
    const res = await fetch("/.netlify/functions/data", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    if (j.empty) throw new Error("no data stored yet");

    const prevNewest = (D.posts?.list || [])[0]?.id;
    D = { ...D, ...j, seeded: false };
    debtAtLoad = 0;
    renderAll();
    lastGood = Date.now();

    const newest = (D.posts?.list || [])[0];
    if (newest && prevNewest && newest.id !== prevNewest) flashNewPost(newest);
    if (manual) showModal("Refreshed", "✅",
      `Pulled at ${new Date(j.updatedAt).toLocaleTimeString()}.<br>Feed source: <b>${esc(j.posts?.via || "unknown")}</b>.`);
  } catch (err) {
    if (manual) showModal("Couldn't refresh", "⚠",
      `The data endpoint didn't answer.<br><span style="color:#555;font-size:11px">${esc(err.message)}</span><br><br>Showing the last good numbers, labeled with their age.`);
  }
}

function flashNewPost(p) {
  const w = WM.byId("w-truth");
  if (w) { WM.open("w-truth"); }
  document.title = "🔴 NEW POST — The Supreme Cheeto";
  Cheetip.react("newpost");
  setTimeout(() => (document.title = "The Supreme Cheeto"), 30000);
}

/* =====================================================================
   NOVELTY
   ===================================================================== */
const BALL = ["It is certain", "Without a doubt", "Signs point to yes", "Ask again after the next rally",
  "Reply hazy, try again", "Don't count on it", "My sources say no", "Outlook not so good",
  "Absolutely, and loudly", "Only in ALL CAPS", "Very likely, sadly", "The tariff says no",
  "Concentrate and ask again", "Yes — and there will be an exclamation point"];

function initBall() {
  const go = () => {
    const q = $("#ballQ").value.trim();
    if (!q) { $("#ballOut").textContent = "…ask it something first"; return; }
    const out = $("#ballOut");
    out.textContent = "shaking…";
    setTimeout(() => {
      out.innerHTML = `<div>“${esc(BALL[Math.floor(Math.random() * BALL.length)])}”
        <div style="font-size:9px;color:#888;font-weight:normal;margin-top:5px">RANDOM · NOT A PREDICTION</div></div>`;
    }, 550);
  };
  $("#ballGo").addEventListener("click", go);
  $("#ballQ").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

/* ---------- share card: a post rendered as a Win95 error dialog ---------- */
function shareCard(id) {
  const p = (D.posts?.list || []).find((x) => x.id === id);
  if (!p || !p.text) return;
  const W = 900, H = 500, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");

  x.fillStyle = "#008080"; x.fillRect(0, 0, W, H);
  const bx = 60, by = 90, bw = W - 120, bh = H - 180;
  x.fillStyle = "#c0c0c0"; x.fillRect(bx, by, bw, bh);
  x.strokeStyle = "#fff"; x.lineWidth = 3;
  x.beginPath(); x.moveTo(bx, by + bh); x.lineTo(bx, by); x.lineTo(bx + bw, by); x.stroke();
  x.strokeStyle = "#404040";
  x.beginPath(); x.moveTo(bx + bw, by); x.lineTo(bx + bw, by + bh); x.lineTo(bx, by + bh); x.stroke();

  const g = x.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, "#a33f00"); g.addColorStop(1, "#ff7a00");
  x.fillStyle = g; x.fillRect(bx + 5, by + 5, bw - 10, 34);
  x.fillStyle = "#fff"; x.font = "bold 19px Tahoma, sans-serif";
  x.fillText("TruthSocial.exe — Unhandled Statement", bx + 14, by + 30);

  x.fillStyle = "#000"; x.font = "54px Georgia, serif";
  x.fillText("⚠", bx + 26, by + 108);

  x.font = "19px Tahoma, sans-serif"; x.fillStyle = "#000";
  const words = p.text.split(/\s+/);
  let line = "", ly = by + 84;
  const maxW = bw - 130;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (x.measureText(test).width > maxW) { x.fillText(line, bx + 100, ly); line = w; ly += 27; if (ly > by + bh - 90) { line += "…"; break; } }
    else line = test;
  }
  x.fillText(line, bx + 100, ly);

  const bxw = 130, bxh = 34, bbx = bx + bw / 2 - bxw / 2, bby = by + bh - 52;
  x.fillStyle = "#c0c0c0"; x.fillRect(bbx, bby, bxw, bxh);
  x.strokeStyle = "#fff"; x.beginPath(); x.moveTo(bbx, bby + bxh); x.lineTo(bbx, bby); x.lineTo(bbx + bxw, bby); x.stroke();
  x.strokeStyle = "#404040"; x.beginPath(); x.moveTo(bbx + bxw, bby); x.lineTo(bbx + bxw, bby + bxh); x.lineTo(bbx, bby + bxh); x.stroke();
  x.fillStyle = "#000"; x.font = "bold 16px Tahoma, sans-serif"; x.textAlign = "center";
  x.fillText("OK", bbx + bxw / 2, bby + 23);

  x.textAlign = "center"; x.font = "16px Tahoma, sans-serif"; x.fillStyle = "#cfeaea";
  x.fillText("thesupremecheeto  ·  verbatim, from the public record", W / 2, H - 42);

  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cheeto-${id}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

/* ---------- minesweeper ---------- */
function initMines() {
  const N = 9, MINES = 10;
  const grid = $("#msGrid");
  let board, revealed, flagged, over, started, t0, timer;
  grid.style.gridTemplateColumns = `repeat(${N}, 20px)`;

  function reset() {
    board = Array.from({ length: N }, () => Array(N).fill(0));
    revealed = Array.from({ length: N }, () => Array(N).fill(false));
    flagged = Array.from({ length: N }, () => Array(N).fill(false));
    over = false; started = false; clearInterval(timer);
    $("#msTime").textContent = "000"; $("#msFace").textContent = "😀";
    $("#msMines").textContent = String(MINES).padStart(3, "0");
    let placed = 0;
    while (placed < MINES) {
      const r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N);
      if (board[r][c] !== -1) { board[r][c] = -1; placed++; }
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (board[r][c] === -1) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === -1) n++;
      }
      board[r][c] = n;
    }
    draw();
  }

  function open(r, c) {
    if (over || revealed[r][c] || flagged[r][c]) return;
    if (!started) { started = true; t0 = Date.now();
      timer = setInterval(() => { $("#msTime").textContent = String(Math.min(999, Math.floor((Date.now() - t0) / 1000))).padStart(3, "0"); }, 500); }
    revealed[r][c] = true;
    if (board[r][c] === -1) { over = true; clearInterval(timer); $("#msFace").textContent = "💀";
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (board[i][j] === -1) revealed[i][j] = true;
      draw(); return; }
    if (board[r][c] === 0) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && !revealed[rr][cc]) open(rr, cc);
      }
    }
    const left = revealed.flat().filter((v) => !v).length;
    if (left === MINES) { over = true; clearInterval(timer); $("#msFace").textContent = "😎"; }
    draw();
  }

  function draw() {
    grid.innerHTML = "";
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const b = document.createElement("button");
      b.className = "cell" + (revealed[r][c] ? " open" : "") + (revealed[r][c] && board[r][c] === -1 ? " mine" : "");
      b.type = "button";
      if (revealed[r][c]) b.textContent = board[r][c] === -1 ? "💣" : board[r][c] || "";
      else if (flagged[r][c]) b.textContent = "🚩";
      if (revealed[r][c] && board[r][c] > 0) b.classList.add("c" + board[r][c]);
      b.addEventListener("click", () => open(r, c));
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!revealed[r][c] && !over) { flagged[r][c] = !flagged[r][c]; draw(); } });
      let lp; b.addEventListener("pointerdown", () => { lp = setTimeout(() => { if (!revealed[r][c] && !over) { flagged[r][c] = !flagged[r][c]; draw(); } }, 450); });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, () => clearTimeout(lp)));
      grid.appendChild(b);
    }
    const flags = flagged.flat().filter(Boolean).length;
    $("#msMines").textContent = String(Math.max(0, MINES - flags)).padStart(3, "0");
  }

  $("#msFace").addEventListener("click", reset);
  reset();
}

/* =====================================================================
   CHROME: modal, start menu, clock, boot
   ===================================================================== */
function showModal(title, glyph, html) {
  $("#modalTitle").textContent = title;
  $("#modalGlyph").innerHTML = glyph;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
  $("#modalOk").focus();
}
function initChrome() {
  const close = () => ($("#modal").hidden = true);
  $("#modalOk").addEventListener("click", close);
  $("#modalX").addEventListener("click", close);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  const menu = $("#startMenu"), btn = $("#startBtn");
  const toggle = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.classList.toggle("on", !menu.hidden); };
  $("#trayOnline")?.addEventListener("click", (e) => { e.stopPropagation(); WM.open("w-live"); });
  $("#shareEdit")?.addEventListener("click", () => Setup.open(true));
  btn.addEventListener("click", toggle);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggle(e); });
  document.addEventListener("click", () => { menu.hidden = true; btn.classList.remove("on"); });
  menu.addEventListener("click", (e) => e.stopPropagation());

  $("#trayWatch").addEventListener("click", () => WM.open("w-truth"));
  $("#trayTheme")?.addEventListener("click", () => Theme.toggle());

  const clock = () => { $("#trayClock").textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  clock(); setInterval(clock, 15000);
}

const BOOT_LINES = [
  "Cheeto BIOS v4.7  ·  Copyright (C) 1997",
  "",
  "Detecting primary master ......... TRUTH_SOCIAL",
  "Detecting primary slave  ......... DEBT_CLOCK",
  "Detecting secondary ............. GOLF_CART",
  "",
  "Memory Test : 640K OK  (should be enough)",
  "Mounting /gov ................... [ OK ]",
  "Loading approval ratings ........ [ OK ]",
  "Checking egg prices ............. [ OK ]",
  "Calibrating CHEETO-METER ........ [ OK ]",
  "",
  "Starting The Supreme Cheeto 95...",
];

function boot() {
  const el = $("#boot"), log = $("#bootlog");
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    el.style.transition = "opacity .35s"; el.style.opacity = "0";
    setTimeout(() => el.remove(), 380);
    try { sessionStorage.setItem("cheeto_booted", "1"); } catch {}
    splash().then(() => Cheetip.init());
  };
  el.addEventListener("click", finish);
  document.addEventListener("keydown", finish, { once: true });

  let i = 0;
  const step = () => {
    if (done) return;
    if (i >= BOOT_LINES.length) { setTimeout(finish, 420); return; }
    log.innerHTML += esc(BOOT_LINES[i]) + "\n";
    i++;
    setTimeout(step, BOOT_LINES[i - 1] === "" ? 60 : 115);
  };
  step();
}


/* =====================================================================
   CARD GAMES — Klondike Solitaire and Blackjack
   Shared deck helpers, then the two games. Click-to-select rather than
   drag-and-drop throughout: it's the same interaction on desktop and touch,
   and it can't strand a card mid-drag on a phone.
   ===================================================================== */
const SUITS = [
  { s: "♠", red: false }, { s: "♥", red: true },
  { s: "♦", red: true },  { s: "♣", red: false },
];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function freshDeck() {
  const d = [];
  SUITS.forEach((su, si) => RANKS.forEach((r, ri) =>
    d.push({ r, ri, s: su.s, si, red: su.red, up: false })));
  return d;
}
function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
/* A real playing card reads at a glance from its CORNER — rank over suit,
   repeated upside down bottom-right — because that is what you can see when
   cards are fanned or overlapped in a tableau. The old single centred
   rank+suit was unreadable the moment cards stacked. */
function cardHTML(c, extra = "") {
  if (!c) return `<div class="card empty ${extra}"></div>`;
  if (!c.up) return `<div class="card back ${extra}"></div>`;
  const idx = `<span class="c-i"><b>${c.r}</b><i>${c.s}</i></span>`;
  return `<div class="card ${c.red ? "red" : "blk"} ${extra}" data-r="${esc(c.r)}" data-s="${esc(c.s)}">
    ${idx}<span class="c-mid">${c.s}</span><span class="c-i c-br"><b>${c.r}</b><i>${c.s}</i></span>
  </div>`;
}

/* ===================================================================== */
/*  KLONDIKE SOLITAIRE                                                    */
/*  Rewritten: drag-and-drop (mouse + touch), click-to-move that lets you  */
/*  change your mind, undo, auto-complete, and valid-target highlighting.  */
/* ===================================================================== */
function initSolitaire() {
  const root = $("#solRoot");
  if (!root) return;

  let stock, waste, found, tab, sel, moves, history, won;

  /* ---------- state ---------- */
  const snapshot = () => JSON.stringify({ stock, waste, found, tab, moves });
  const pushHistory = () => {
    history.push(snapshot());
    if (history.length > 120) history.shift();
  };
  const undo = () => {
    if (history.length < 2) return;
    history.pop();
    const prev = JSON.parse(history[history.length - 1]);
    ({ stock, waste, found, tab, moves } = prev);
    sel = null; won = false;
    draw();
  };

  function deal() {
    const d = shuffle(freshDeck());
    tab = Array.from({ length: 7 }, (_, i) => {
      const pile = d.splice(0, i + 1);
      pile[pile.length - 1].up = true;
      return pile;
    });
    stock = d; waste = []; found = [[], [], [], []];
    sel = null; moves = 0; won = false; history = [];
    pushHistory();
    draw();
  }

  /* ---------- rules ---------- */
  const topOf = (p) => p[p.length - 1] || null;
  const canStack = (c, onto) => onto ? (c.red !== onto.red && c.ri === onto.ri - 1) : c.ri === 12;
  const canFound = (c, f) => { const t = topOf(f); return t ? (t.si === c.si && c.ri === t.ri + 1) : c.ri === 0; };

  const pileOf = (where, i) => where === "t" ? tab[i] : where === "w" ? waste : found[i];

  /* A run being dragged must itself be a valid descending alternating sequence. */
  function runIsValid(pile, from) {
    for (let i = from; i < pile.length - 1; i++) {
      if (!pile[i].up || !canStack(pile[i + 1], pile[i])) return false;
    }
    return pile[from]?.up === true;
  }

  function legalMove(src, dst) {
    const sp = pileOf(src.where, src.pileIdx);
    const moving = sp.slice(src.cardIdx);
    if (!moving.length) return false;
    if (src.where === "f" && moving.length > 1) return false;
    if (!runIsValid(sp, src.cardIdx)) return false;

    if (dst.where === "f") {
      return moving.length === 1 && canFound(moving[0], found[dst.pileIdx]);
    }
    if (dst.where === "t") {
      if (src.where === "t" && src.pileIdx === dst.pileIdx) return false;
      return canStack(moving[0], topOf(tab[dst.pileIdx]));
    }
    return false;
  }

  function doMove(src, dst) {
    if (!legalMove(src, dst)) return false;
    const sp = pileOf(src.where, src.pileIdx);
    const moving = sp.splice(src.cardIdx);
    (dst.where === "f" ? found[dst.pileIdx] : tab[dst.pileIdx]).push(...moving);
    const t = topOf(sp);
    if (t && !t.up) t.up = true;
    moves++;
    pushHistory();
    checkWin();
    return true;
  }

  function autoToFoundation(src) {
    const sp = pileOf(src.where, src.pileIdx);
    if (src.cardIdx !== sp.length - 1) return false;      // only the top card
    for (let i = 0; i < 4; i++) {
      if (legalMove(src, { where: "f", pileIdx: i })) return doMove(src, { where: "f", pileIdx: i });
    }
    return false;
  }

  const allFaceUp = () => tab.every((p) => p.every((c) => c.up)) && !stock.length && !waste.length;

  function autoComplete() {
    let moved = true, guard = 0;
    while (moved && guard++ < 300) {
      moved = false;
      for (let i = 0; i < 7; i++) {
        const p = tab[i];
        if (!p.length) continue;
        if (autoToFoundation({ where: "t", pileIdx: i, cardIdx: p.length - 1 })) { moved = true; }
      }
    }
    draw();
  }

  function checkWin() {
    if (found.every((f) => f.length === 13)) {
      won = true;
      showModal("You win", "&#127942;",
        `Solitaire solved in <b>${moves}</b> moves.<br><br>
         <span style="color:#555;font-size:11px">The cards do not cascade. I'm sorry.</span>`);
    }
  }

  function clickStock() {
    if (stock.length) { const c = stock.pop(); c.up = true; waste.push(c); }
    else { stock = waste.reverse().map((c) => (c.up = false, c)); waste = []; }
    sel = null; moves++; pushHistory(); draw();
  }

  /* ---------- interaction ---------- */
  const sameSel = (a, b) => a && b && a.where === b.where && a.pileIdx === b.pileIdx && a.cardIdx === b.cardIdx;

  function onPick(src) {
    if (won) return;
    const pile = pileOf(src.where, src.pileIdx);
    const card = pile[src.cardIdx];
    if (!card || !card.up) return;

    if (sameSel(sel, src)) { sel = null; draw(); return; }        // click again to deselect

    if (sel) {
      if (doMove(sel, { where: src.where, pileIdx: src.pileIdx })) { sel = null; draw(); return; }
      // Not a legal destination? Then they're picking a different card.
      // The old build silently dropped the selection here, which is what made
      // this unplayable — you had to start the whole move again.
      sel = runIsValid(pile, src.cardIdx) ? src : null;
      draw();
      return;
    }
    if (!runIsValid(pile, src.cardIdx)) return;
    sel = src;
    draw();
  }

  function onDrop(dst) {
    if (!sel || won) return;
    doMove(sel, dst);
    sel = null;
    draw();
  }

  /* ---------- drag ---------- */
  let drag = null;

  function startDrag(e, src) {
    if (won) return;
    const pile = pileOf(src.where, src.pileIdx);
    if (!pile[src.cardIdx]?.up || !runIsValid(pile, src.cardIdx)) return;

    const cards = pile.slice(src.cardIdx);
    const ghost = document.createElement("div");
    ghost.className = "sol-ghost";
    ghost.innerHTML = cards.map((c, i) =>
      `<div class="ghost-card" style="top:${i * 22}px">${cardHTML(c)}</div>`).join("");
    document.body.appendChild(ghost);

    drag = { src, ghost, moved: false, x0: e.clientX, y0: e.clientY, pid: e.pointerId };
    positionGhost(e.clientX, e.clientY);
    root.classList.add("dragging-card");
    markTargets(src);
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function positionGhost(x, y) {
    if (!drag) return;
    drag.ghost.style.left = (x - 26) + "px";
    drag.ghost.style.top = (y - 22) + "px";
  }

  function markTargets(src) {
    $$(".sol-col", root).forEach((el, i) => {
      el.classList.toggle("ok", legalMove(src, { where: "t", pileIdx: i }));
    });
    $$("[data-f]", root).forEach((el) => {
      el.classList.toggle("ok", legalMove(src, { where: "f", pileIdx: +el.dataset.f }));
    });
  }
  const clearTargets = () => $$(".ok", root).forEach((el) => el.classList.remove("ok"));

  function endDrag(e) {
    if (!drag) return;
    const { src, ghost, moved } = drag;
    ghost.remove();
    root.classList.remove("dragging-card");
    clearTargets();
    const d = drag; drag = null;

    if (!moved) { onPick(src); return; }                  // a tap, not a drag

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under?.closest?.(".sol-col");
    const fnd = under?.closest?.("[data-f]");
    if (fnd) { doMove(src, { where: "f", pileIdx: +fnd.dataset.f }); }
    else if (col) { doMove(src, { where: "t", pileIdx: +col.dataset.t }); }
    sel = null;
    draw();
  }

  /* ---------- render ---------- */
  function draw() {
    const isSel = (w, p, c) => sel && sel.where === w && sel.pileIdx === p && sel.cardIdx === c;

    let h = `<div class="sol-top">
      <div class="sol-stock" id="solStock" title="Draw">${stock.length
        ? '<div class="card back"></div>'
        : '<div class="card empty recycle">&#8635;</div>'}</div>
      <div class="sol-waste" id="solWaste">${waste.length
        ? cardHTML(topOf(waste), isSel("w", 0, waste.length - 1) ? "sel" : "")
        : '<div class="card empty"></div>'}</div>
      <div class="sol-spacer"></div>`;
    found.forEach((f, i) => {
      h += `<div class="sol-found" data-f="${i}">${f.length
        ? cardHTML(topOf(f))
        : `<div class="card empty"><span class="fs">${SUITS[i].s}</span></div>`}</div>`;
    });
    h += `</div><div class="sol-tab">`;
    tab.forEach((p, i) => {
      h += `<div class="sol-col" data-t="${i}">`;
      if (!p.length) h += `<div class="card empty"></div>`;
      p.forEach((c, ci) => {
        h += `<div class="sol-slot" data-t="${i}" data-c="${ci}">${cardHTML(c, isSel("t", i, ci) ? "sel" : "")}</div>`;
      });
      h += `</div>`;
    });
    h += `</div>
      <div class="sol-bar">
        <span>Moves: <b>${moves}</b>${sel ? ' &middot; <i>card picked up</i>' : ""}</span>
        <span class="sol-btns">
          <button class="b95 tiny" id="solUndo"${history.length < 2 ? " disabled" : ""}>Undo</button>
          ${allFaceUp() && !won ? '<button class="b95 tiny" id="solAuto">Auto-finish</button>' : ""}
          <button class="b95 tiny" id="solNew">New game</button>
        </span>
      </div>`;
    root.innerHTML = h;
    wire();
  }

  function wire() {
    $("#solStock").addEventListener("click", clickStock);
    $("#solNew").addEventListener("click", deal);
    $("#solUndo").addEventListener("click", undo);
    $("#solAuto")?.addEventListener("click", autoComplete);

    const attach = (el, src) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        startDrag(e, src);
      });
      el.addEventListener("dblclick", (e) => { e.stopPropagation(); autoToFoundation(src); draw(); });
    };

    $$(".sol-slot", root).forEach((el) =>
      attach(el, { where: "t", pileIdx: +el.dataset.t, cardIdx: +el.dataset.c }));

    const wasteEl = $("#solWaste");
    if (waste.length) attach(wasteEl, { where: "w", pileIdx: 0, cardIdx: waste.length - 1 });

    // dropping onto an empty column or a foundation
    $$(".sol-col", root).forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest(".sol-slot")) return;
        onDrop({ where: "t", pileIdx: +el.dataset.t });
      }));
    $$("[data-f]", root).forEach((el) =>
      el.addEventListener("click", () => onDrop({ where: "f", pileIdx: +el.dataset.f })));
  }

  /* pointer move/up live on the window so a drag survives leaving the card */
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.moved && (Math.abs(e.clientX - drag.x0) > 5 || Math.abs(e.clientY - drag.y0) > 5)) drag.moved = true;
    if (drag.moved) positionGhost(e.clientX, e.clientY);
  });
  window.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pid) endDrag(e); });
  window.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.pid) endDrag(e); });

  deal();
}

/* ===================================================================== */
/*  BLACKJACK                                                             */
/* ===================================================================== */
function initBlackjack() {
  const root = $("#bjRoot");
  if (!root) return;
  let deck, player, dealer, state, msg, bet, chips;

  const CHIPS_KEY = "cheeto_bj_chips";
  try { chips = parseInt(localStorage.getItem(CHIPS_KEY) || "500", 10); } catch { chips = 500; }
  if (!isFinite(chips) || chips < 0) chips = 500;
  bet = 25;

  const saveChips = () => { try { localStorage.setItem(CHIPS_KEY, String(chips)); } catch {} };

  function value(hand) {
    let total = 0, aces = 0;
    hand.forEach((c) => {
      if (c.ri === 0) { aces++; total += 11; }
      else total += Math.min(10, c.ri + 1);
    });
    while (total > 21 && aces) { total -= 10; aces--; }
    return total;
  }
  const isBJ = (h) => h.length === 2 && value(h) === 21;

  function drawCard(up = true) {
    if (deck.length < 15) deck = shuffle(freshDeck());
    const c = deck.pop(); c.up = up; return c;
  }

  function newRound() {
    if (chips < bet) { msg = "Not enough chips. Reset to play again."; state = "over"; return render(); }
    if (!deck || deck.length < 15) deck = shuffle(freshDeck());
    chips -= bet; saveChips();
    player = [drawCard(), drawCard()];
    dealer = [drawCard(), drawCard(false)];
    state = "play"; msg = "";
    if (isBJ(player)) {
      dealer[1].up = true;
      if (isBJ(dealer)) { chips += bet; msg = "Push — you both have blackjack."; }
      else { chips += Math.floor(bet * 2.5); msg = "Blackjack! Pays 3:2."; }
      saveChips(); state = "over";
    }
    render();
  }

  function hit() {
    if (state !== "play") return;
    player.push(drawCard());
    if (value(player) > 21) { msg = `Bust with ${value(player)}.`; state = "over"; dealer[1].up = true; }
    render();
  }

  function stand() {
    if (state !== "play") return;
    dealer[1].up = true;
    while (value(dealer) < 17) dealer.push(drawCard());
    const p = value(player), d = value(dealer);
    if (d > 21) { chips += bet * 2; msg = `Dealer busts with ${d}. You win.`; }
    else if (d > p) { msg = `Dealer ${d}, you ${p}. Dealer wins.`; }
    else if (p > d) { chips += bet * 2; msg = `You ${p}, dealer ${d}. You win.`; }
    else { chips += bet; msg = `Push at ${p}.`; }
    saveChips(); state = "over"; render();
  }

  function doubleDown() {
    if (state !== "play" || player.length !== 2 || chips < bet) return;
    chips -= bet; bet *= 2; saveChips();
    player.push(drawCard());
    if (value(player) > 21) { msg = `Bust with ${value(player)}.`; state = "over"; dealer[1].up = true; render(); }
    else stand();
    bet = Math.floor(bet / 2);
  }

  function render() {
    const dShown = dealer ? (state === "play" ? value([dealer[0]]) + " + ?" : value(dealer)) : "—";
    root.innerHTML = `
      <div class="bj-row"><span>Dealer</span><b>${dShown}</b></div>
      <div class="hand">${(dealer || []).map((c) => cardHTML(c)).join("") || '<div class="card empty"></div>'}</div>
      <div class="bj-row"><span>You</span><b>${player ? value(player) : "—"}</b></div>
      <div class="hand">${(player || []).map((c) => cardHTML(c)).join("") || '<div class="card empty"></div>'}</div>
      <div class="bj-msg">${esc(msg || (state === "play" ? "Hit or stand." : "Place a bet and deal."))}</div>
      <div class="bj-bar">
        <span>Chips <b id="bjChips">${chips}</b></span>
        <span>Bet <button class="b95 tiny" id="bjMinus">−</button>
          <b id="bjBet">${bet}</b>
          <button class="b95 tiny" id="bjPlus">+</button></span>
      </div>
      <div class="bj-actions">
        ${state === "play"
          ? `<button class="b95" id="bjHit">Hit</button>
             <button class="b95" id="bjStand">Stand</button>
             <button class="b95" id="bjDouble"${player.length !== 2 || chips < bet ? " disabled" : ""}>Double</button>`
          : `<button class="b95" id="bjDeal">Deal</button>
             <button class="b95" id="bjReset" style="float:right">Reset chips</button>`}
      </div>
      <p class="note">Dealer stands on 17. Blackjack pays 3:2. Chips are fake, stored only in your browser,
      and worth exactly nothing.</p>`;

    const on = (id, fn) => { const el = $("#" + id); if (el) el.addEventListener("click", fn); };
    on("bjHit", hit); on("bjStand", stand); on("bjDouble", doubleDown); on("bjDeal", newRound);
    on("bjPlus", () => { bet = Math.min(500, bet + 25); render(); });
    on("bjMinus", () => { bet = Math.max(25, bet - 25); render(); });
    on("bjReset", () => { chips = 500; bet = 25; saveChips(); msg = "Chips reset to 500."; render(); });
  }

  state = "over"; msg = ""; render();
}

/* =====================================================================
   CHEETIP — the assistant. Clippy's whole personality was interrupting you
   with advice you didn't ask for, so this one does that too, but it only
   ever says things that are true about the data on screen.
   ===================================================================== */
/* =====================================================================
   CHEETIP — the assistant
   Clippy's whole joke is "It looks like you're trying to ___", and it only
   lands if you actually are. The old version fired on a blind timer, so it
   told you that you were doomscrolling while you played Blackjack. This one
   is event-driven: he speaks BECAUSE something happened, and the idle timer
   is a rare fallback rather than the main event.

   Every line is still derived from data actually on the page. He has no
   opinions the site doesn't already show you, and he never invents a figure.
   ===================================================================== */
const Cheetip = {
  el: null, bubble: null, char: null, svg: null,
  hidden: false, timer: null, idleAt: 0, idleFired: false,
  lastSaid: "", moodTimer: null,

  KEY: "cheeto_tip_hidden",

  async init() {
    try { this.hidden = localStorage.getItem(this.KEY) === "1"; } catch {}
    this.el = $("#cheetip");
    this.bubble = $("#cheetipSay");
    this.char = $("#cheetipChar");
    if (!this.el) return;
    this.el.hidden = this.hidden;

    $("#cheetipClose").addEventListener("click", (e) => { e.stopPropagation(); this.dismiss(); });
    this.char.addEventListener("click", () => this.say(this.pick(), 9000));

    await this.inlineArt();
    this.watchIdle();

    if (!this.hidden) {
      setTimeout(() => this.say("It looks like you're trying to follow the news. Would you like help with that?", 8000, "smug"), 2600);
      this.schedule();
    }
  },

  /* The mood styles live inside logo.svg and key off data-mood on its root,
     which only works if the SVG is part of the document. Fetch and inline it;
     if that fails for any reason the existing <img> stays exactly as it was
     and he simply keeps one face. */
  async inlineArt() {
    try {
      const res = await fetch("/logo.svg", { cache: "force-cache" });
      if (!res.ok) return;
      const txt = await res.text();
      const doc = new DOMParser().parseFromString(txt, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg || doc.querySelector("parsererror")) return;
      svg.setAttribute("width", "62");
      svg.setAttribute("height", "62");
      svg.setAttribute("aria-hidden", "true");
      svg.style.display = "block";
      const img = this.char.querySelector("img");
      if (img) img.replaceWith(svg);
      this.svg = svg;
      this.setMood(this.restingMood());
    } catch {}
  },

  /* What his face does when nothing in particular is happening: the meter. */
  restingMood() {
    const s = D.cheeto ?? 0;
    if (s >= 78) return "panic";
    if (s >= 55) return "alarmed";
    return "smug";
  },

  setMood(m, ms) {
    if (!this.svg) return;
    this.svg.setAttribute("data-mood", m || "");
    clearTimeout(this.moodTimer);
    if (ms) this.moodTimer = setTimeout(() => {
      if (this.svg) this.svg.setAttribute("data-mood", this.restingMood());
    }, ms);
  },

  dismiss() {
    this.hidden = true;
    this.el.hidden = true;
    clearTimeout(this.timer);
    try { localStorage.setItem(this.KEY, "1"); } catch {}
  },

  show() {
    this.hidden = false;
    this.el.hidden = false;
    try { localStorage.removeItem(this.KEY); } catch {}
    this.say("I'm back. You can't get rid of me that easily.", 6000, "delighted");
    this.schedule();
  },

  /* Unprompted chatter is now the exception, not the rule — long, irregular
     gaps, because the reactions below are what should be carrying him. */
  schedule() {
    clearTimeout(this.timer);
    if (this.hidden) return;
    this.timer = setTimeout(() => { this.say(this.pick(), 9000); this.schedule(); },
      150000 + Math.random() * 210000);
  },

  say(text, ms = 7000, mood) {
    if (this.hidden || !this.bubble) return;
    this.lastSaid = text;
    this.bubble.innerHTML = esc(text);
    this.bubble.hidden = false;
    this.el.classList.add("talking");
    if (mood) this.setMood(mood, ms + 600);
    clearTimeout(this._hide);
    this._hide = setTimeout(() => {
      this.bubble.hidden = true;
      this.el.classList.remove("talking");
    }, ms);
  },

  /* =====================================================================
     REACTIONS — he speaks because you did something
     Each entry returns [text, mood] or null to stay quiet. Keeping them in
     one table makes it obvious what he can and can't react to.
     ===================================================================== */
  react(kind, p = {}) {
    if (this.hidden) return;
    this.wake();
    const r = this.REACTIONS[kind];
    if (!r) return;
    const out = r.call(this, p);
    if (!out) return;
    const [text, mood, ms] = Array.isArray(out) ? out : [out, null, null];
    this.say(text, ms || 8000, mood);
    this.schedule();                       // reset idle chatter after a reaction
  },

  REACTIONS: {
    window(p) {
      const games = { "w-sol": "Solitaire", "w-bj": "Blackjack", "w-mine": "Minesweeper", "w-ball": "the 8-ball" };
      if (games[p.id]) return [`It looks like you're trying to avoid the news by playing ${games[p.id]}. I respect it.`, "smug"];
      if (p.id === "w-debt") return ["It looks like you're trying to watch a number get bigger. It will.", "smug"];
      if (p.id === "w-truth") return ["It looks like you're trying to read every one of these. Pace yourself.", "smug"];
      if (p.id === "w-predict") return ["It looks like you're trying to be right about something. Bold.", "delighted"];
      if (p.id === "w-buddies") return ["It looks like you're trying to make friends on a debt tracker. Somehow that's working.", "delighted"];
      if (p.id === "w-chat") return ["It looks like you're trying to talk to strangers. Be nice, they can see you.", "smug"];
      if (p.id === "w-tally") return ["It looks like you're trying to see what all this has cost you. Brave.", "alarmed"];
      if (p.id === "w-meter") return ["It looks like you're trying to audit my gauge. Go ahead, the formula's right there.", "smug"];
      return null;
    },

    guess(p) {
      if (p.pct == null) return null;
      if (p.pct < 0.25) return ["That was within a quarter of a percent. I'm genuinely unsettled.", "alarmed"];
      if (p.pct < 1)    return ["Within one percent. You've been paying attention.", "delighted"];
      if (p.pct < 25)   return ["Not your finest guess, but the debt is a hard number to hold in your head.", "smug"];
      return ["That wasn't the right neighbourhood. Or the right city.", "smug"];
    },

    pick()      { return ["Locked in. No takebacks after midnight.", "delighted"]; },
    friend(p)   { return [`${p.name ? p.name + " is" : "That's"} on your buddy list now. It's 2003 in here.`, "delighted"]; },
    nudge(p)    { return [`${p.from || "Someone"} nudged you. I felt that too.`, "panic", 6500]; },
    record(p)   { return [`${p.n} people here at once — that's a new record. Everyone act natural.`, "delighted"]; },
    live(p)     { return [`${p.name} just went live${p.title ? ` — "${p.title}"` : ""}.`, "delighted", 10000]; },
    newpost()   { return ["A new post just landed. I thought you should know immediately.", "panic", 9000]; },

    away(p) {
      const m = {
        away: "Away message set. Very 2004 of you.",
        busy: "Busy doing what, exactly? You're on a debt tracker.",
        invisible: "Invisible. You're off the buddy list AND the visitor count. Genuinely gone.",
        available: "Back to available. The buddy list rejoices.",
      };
      const face = { away: "smug", busy: "smug", invisible: "smug", available: "delighted" };
      return m[p.state] ? [m[p.state], face[p.state]] : null;
    },

    meter()  { return ["Building your own meter, are we? The published number is still right there next to yours.", "smug"]; },
    theme(p) { return p.dark
      ? ["Dark mode. Easier on the eyes, same terrible numbers.", "smug"]
      : ["Light mode. Bold choice at this hour.", "smug"]; },

    idle() {
      const s = D.cheeto ?? 0;
      return [s >= 60
        ? "You've gone quiet. The numbers haven't."
        : "It looks like you're trying to stare into the middle distance. Understandable.", "asleep", 9000];
    },
  },

  /* ---------------- idle ---------------- */
  watchIdle() {
    const bump = () => this.wake();
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((e) =>
      window.addEventListener(e, bump, { passive: true }));
    this.idleAt = Date.now();
    setInterval(() => {
      if (this.hidden || this.idleFired) return;
      if (Date.now() - this.idleAt > 4 * 60e3) {
        this.idleFired = true;
        this.react("idle");
        this.setMood("asleep");           // stays asleep until you move
      }
    }, 15000);
  },

  wake() {
    this.idleAt = Date.now();
    if (this.idleFired) {
      this.idleFired = false;
      this.setMood(this.restingMood());
    }
  },

  /* ---------------- unprompted lines ---------------- */
  pick() {
    const lines = [];
    const debt = liveDebt();
    lines.push(`The national debt has gone up about ${money(D.debt.perSecond * 60, 0)} since I started this sentence.`);

    const hh = (typeof Tally === "object" && Tally.household && Tally.household()) || null;
    lines.push(hh
      ? `Your household's share of the debt is ${money((debt / POPULATION) * hh, 0)}. No, you can't pay it off.`
      : `Your share of the debt is ${money(debt / POPULATION, 0)}. No, you can't pay it off.`);

    if (D.approval?.approve != null) {
      const net = D.approval.approve - D.approval.disapprove;
      lines.push(`Approval is ${D.approval.approve}%, disapproval ${D.approval.disapprove}%. Net ${net > 0 ? "+" : ""}${net.toFixed(1)}.`);
    }
    if (D.gas?.v && D.gas?.prev) {
      const pc = ((D.gas.v / D.gas.prev - 1) * 100).toFixed(0);
      lines.push(`Gas is $${D.gas.v.toFixed(3)}. That's ${pc}% ${pc >= 0 ? "more" : "less"} than a year ago.`);
    }
    if (D.golf?.days) lines.push(`${D.golf.days} days at a golf course this term. It looks like you're trying to lower your handicap.`);
    if (D.eo?.orders) lines.push(`${D.eo.orders} executive orders signed. That's a lot of pens.`);
    if (D.eggs?.v) lines.push(`Eggs are $${D.eggs.v.toFixed(2)} a dozen. I remain a snack food, so I'm fine.`);
    if (typeof PG === "object" && PG.open?.length) {
      lines.push(`There ${PG.open.length === 1 ? "is 1 open question" : `are ${PG.open.length} open questions`} in Call It, and you haven't been wrong yet today.`);
    }
    if (typeof Guess === "object" && Guess.due && Guess.due()) {
      lines.push("You haven't guessed the debt today. It's in the debt window, and I won't tell you the answer first.");
    }

    const times = (D.posts?.list || []).map(postTime).filter(Boolean);
    if (times.length) {
      const since = Date.now() - Math.max(...times);
      lines.push(since < 36e5
        ? `A post landed ${ago(since)} ago. It looks like you're trying to have a quiet day.`
        : `${ago(since)} since the last post. Suspiciously calm.`);
    }
    if (D.cheeto != null) lines.push(`Cheeto-meter reads ${D.cheeto.toFixed(1)} out of 100. I don't make the rules, I just have a gauge.`);

    // He can't open windows for you, so he no longer offers to — he just says
    // where the thing is. An assistant that offers help it can't give is worse
    // than one that stays quiet.
    lines.push("It looks like you're trying to doomscroll. Solitaire is in the Start menu, for whatever that's worth.");
    lines.push("Did you know? Every number on this page links to where it came from. Wild concept.");

    const fresh = lines.filter((l) => l !== this.lastSaid);
    return fresh[Math.floor(Math.random() * fresh.length)] || lines[0];
  },
};


/* ---------- Win95-style splash after the BIOS text ---------- */
function splash() {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.id = "splash";
    el.innerHTML = `
      <div class="sp-box">
        <div class="sp-pop">BOOTING!</div>
        <div class="sp-logo"><img src="/logo.svg" alt="" width="160" height="160"></div>
        <div class="sp-txt"><b>The Supreme Cheeto</b><span>95</span></div>
        <div class="sp-bar"><i></i></div>
        <div class="sp-note" id="spNote">Starting The Supreme Cheeto&hellip;</div>
      </div>`;
    document.body.appendChild(el);

    // the loading lines are the joke; they scroll while the bar fills
    const notes = [
      "Starting The Supreme Cheeto\u2026",
      "Loading cheese dust drivers\u2026",
      "Reticulating combover\u2026",
      "Counting the national debt\u2026",
      "Asking the pollsters nicely\u2026",
      "Warming up the CHEETO-METER\u2026",
      "Buffing the tie\u2026",
      "Almost there\u2026",
    ];
    const pops = ["BOOTING!", "POW!", "ZING!", "LOADING!", "KABLAM!"];
    let pi = 0;
    const popEl = el.querySelector(".sp-pop");
    const popper = setInterval(() => {
      pi = (pi + 1) % pops.length;
      if (popEl) popEl.textContent = pops[pi];
    }, 620);

    let n = 0;
    const noteEl = el.querySelector("#spNote");
    const cycle = setInterval(() => {
      n = (n + 1) % notes.length;
      if (noteEl) noteEl.textContent = notes[n];
    }, 420);

    const done = () => {
      clearInterval(cycle); clearInterval(popper);
      el.style.transition = "opacity .4s";
      el.style.opacity = "0";
      setTimeout(() => { el.remove(); resolve(); }, 420);
    };
    el.addEventListener("click", done);
    setTimeout(done, 2700);
  });
}


/* =====================================================================
   THEME
   Remembers the choice, and follows the OS only until the user overrides it.
   ===================================================================== */
const Theme = {
  KEY: "cheeto_theme",
  get() { try { return localStorage.getItem(this.KEY); } catch { return null; } },
  set(v) {
    try { v ? localStorage.setItem(this.KEY, v) : localStorage.removeItem(this.KEY); } catch {}
    this.apply();
  },
  isDark() {
    const saved = this.get();
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;   // no choice made yet
  },
  apply() {
    const dark = this.isDark();
    document.body.classList.toggle("dark", dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#062626" : "#008080");
    const item = $("#themeItem");
    if (item) item.querySelector(".lbl").textContent = dark ? "Switch to light mode" : "Switch to dark mode";
    const tray = $("#trayTheme");
    if (tray) {
      tray.textContent = dark ? "\u2600\uFE0F" : "\u{1F319}";
      tray.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
  },
  toggle() { this.set(this.isDark() ? "light" : "dark"); Cheetip?.react?.("theme", { dark: this.isDark() }); },
  init() {
    this.apply();
    // follow the OS only while the user hasn't picked for themselves
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!this.get()) this.apply();
    });
  },
};

/* =====================================================================
   PWA
   ===================================================================== */
let deferredInstall = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();               // we surface it from the Start menu instead
  deferredInstall = e;
  const item = $("#installItem");
  if (item) item.hidden = false;
});

async function promptInstall() {
  if (!deferredInstall) {
    // iOS Safari never fires beforeinstallprompt — tell people what to do there.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showModal("Install", "&#128229;", ios
      ? "On iPhone: tap the <b>Share</b> button, then <b>Add to Home Screen</b>.<br><br><span style='color:#555;font-size:11px'>iOS doesn't let a site trigger this itself.</span>"
      : "Your browser hasn't offered an install prompt.<br><br><span style='color:#555;font-size:11px'>Look for an install icon in the address bar, or use the browser menu. Already installed? Then there's nothing to do.</span>");
    return;
  }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  const item = $("#installItem");
  if (item) item.hidden = true;
  if (outcome === "accepted") showModal("Installed", "&#127881;", "The Supreme Cheeto is on your home screen.");
}

window.addEventListener("appinstalled", () => { deferredInstall = null; });

function initSW() {
  if (!("serviceWorker" in navigator)) return;

  // When a new worker takes over, this page is running code that no longer
  // matches the cache — reload once so they line up. Two guards matter here:
  // `reloading` stops the classic loop where each reload triggers another
  // controllerchange, and `hadController` skips the reload on a visitor's very
  // first load, where the worker is arriving for the first time and there is
  // nothing stale to replace.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  // file:// and localhost-without-https will reject registration; ignore quietly.
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          // The worker now skips waiting on its own, so this is a courtesy
          // notice rather than a required action — the reload is coming either
          // way. Kept short so it doesn't look like something to decide about.
          const note = $("#chatNote");
          if (note) note.innerHTML = '<span style="color:#555">A new version just landed — reloading…</span>';
        }
      });
    });
  }).catch(() => {});
}

/* deep links from the manifest shortcuts: /?open=w-truth */
function openFromQuery() {
  try {
    const want = new URLSearchParams(location.search).get("open");
    if (want && WM.byId(want)) WM.open(want);
  } catch {}
}

/* =====================================================================
   GO
   ===================================================================== */
function start() {
  Theme.init();
  WM.init();
  Odo.mount($("#debtClock"));
  initChrome();
  initBall();
  initMines();
  initSolitaire();
  initBlackjack();
  // chat.js self-initialises; it loads after this file so initChat isn't
  // defined yet at this point in execution.
  renderAll();

  setInterval(tickDebt, 100);
  setInterval(tickCountdown, 1000);
  setInterval(tickWatch, 1000);
  tickCountdown();

  initSW();
  openFromQuery();

  loadLive();
  setInterval(loadLive, 5 * 60000);        // page re-checks every 5 min
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - lastGood > 120000) loadLive(); });
}

let booted = false;
try { booted = sessionStorage.getItem("cheeto_booted") === "1"; } catch {}

/* The landing page sits in front of all this. landing.js decides whether to
   show it and calls afterLanding() either way — on mount-skip immediately, or
   when someone presses ENTER. */
let launched = false;
function afterLanding() {
  if (launched) return;
  launched = true;
  if (booted) { $("#boot")?.remove(); setTimeout(() => Cheetip.init(), 500); }
  else boot();
}

start();

/* Safety net: if landing.js failed to load or threw, nobody would ever call
   afterLanding() and the visitor would stare at a boot screen forever. If the
   landing element is absent or still hidden shortly after load, go anyway. */
setTimeout(() => {
  const l = document.getElementById("landing");
  if (!l || l.hidden) afterLanding();
}, 1200);
