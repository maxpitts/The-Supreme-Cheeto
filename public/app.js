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
  },

  byId(id) { return this.wins.find((w) => w.id === id); },

  layout() {
    // Which windows are open by default: on desktop, a curated set; on mobile, one.
    const DEFAULT_OPEN = ["w-debt", "w-truth", "w-polls", "w-meter"];
    this.wins.forEach((w) => {
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
    const deskW = $("#desktop").clientWidth, deskH = $("#desktop").clientHeight;
    let x = parseInt(w.el.style.left) || 0, y = parseInt(w.el.style.top) || 0;
    const ww = w.el.offsetWidth || w.def.w, wh = w.el.offsetHeight || w.def.h;
    if (ww > deskW - 8) w.el.style.width = Math.max(230, deskW - 16) + "px";
    if (wh > deskH - 8) w.el.style.height = Math.max(120, deskH - 16) + "px";
    x = Math.min(Math.max(0, x), Math.max(0, deskW - 120));
    y = Math.min(Math.max(0, y), Math.max(0, deskH - 30));
    w.el.style.left = x + "px";
    w.el.style.top = y + "px";
  },

  wire(w) {
    const el = w.el, tb = $(".tb", el);

    el.addEventListener("pointerdown", () => this.focus(w), true);

    $("[data-min]", el).addEventListener("click", (e) => { e.stopPropagation(); this.minimize(w); });
    $("[data-max]", el).addEventListener("click", (e) => { e.stopPropagation(); this.toggleMax(w); });
    $("[data-close]", el).addEventListener("click", (e) => { e.stopPropagation(); this.close(w); });

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
        rp = null; el.classList.remove("resizing"); this.save();
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
    w.open = true; w.min = false; w.touched = true; w.el.hidden = false;
    this.focus(w); this.clampIntoView(w); this.save();
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
    const SHORT = { "w-truth": "Truth Feed", "w-debt": "Debt Clock", "w-meter": "Cheeto-Meter",
                    "w-mine": "Minesweeper", "w-about": "About" };
    ["w-truth", "w-debt", "w-meter", "w-mine", "w-about"].forEach((id) => {
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
    const items = this.wins.map((w) => ({ label: w.title, icon: w.icon, act: () => this.open(w.id) }));
    const extras = [
      { sep: true },
      { label: "Install to home screen", icon: "&#128229;", id: "installItem", act: () => promptInstall() },
      { label: "Refresh data now", icon: "&#128260;", act: () => loadLive(true) },
      { label: "Reset window layout", icon: "&#129704;", act: () => { localStorage.removeItem(this.KEY); location.reload(); } },
      { sep: true },
      { label: "Shut Down…", icon: "&#9211;", act: () => showModal("Shut Down", "&#9211;",
          "It is now safe to turn off your computer.<br><br><span style='color:#555;font-size:11px'>(It is not. This is a webpage.)</span>") },
    ];
    ul.innerHTML = "";
    [...items, ...extras].forEach((it) => {
      if (it.sep) { ul.appendChild(document.createElement("hr")); return; }
      const li = document.createElement("li");
      if (it.id) { li.id = it.id; li.hidden = !deferredInstall; }
      li.innerHTML = `<span>${it.icon}</span><span>${esc(it.label)}</span>`;
      li.addEventListener("click", () => { $("#startMenu").hidden = true; $("#startBtn").classList.remove("on"); it.act(); });
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

  save() {
    if (this.mobile) return;
    try {
      const state = {};
      this.wins.forEach((w) => {
        state[w.id] = {
          x: parseInt(w.el.style.left) || 0, y: parseInt(w.el.style.top) || 0,
          w: w.el.offsetWidth, h: w.el.offsetHeight,
          open: w.open, min: w.min, rolled: w.rolled, touched: !!w.touched,
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
      w.saved = true; w.open = s.open; w.min = s.min; w.rolled = s.rolled; w.touched = s.touched;
      Object.assign(w.el.style, { left: s.x + "px", top: s.y + "px", width: s.w + "px", height: s.h + "px" });
      w.el.classList.toggle("rolled", !!s.rolled);
      w.el.hidden = !s.open || s.min;
    });
  },
};

/* =====================================================================
   RENDERERS
   ===================================================================== */
let debtAtLoad = 0, seedMs = 0;

function liveDebt() {
  return D.debt.amount + ((Date.now() - seedMs) / 1000) * (D.debt.perSecond || 89380);
}

function tickDebt() {
  if (!D.debt?.amount) return;
  const now = liveDebt();
  $("#debtClock").textContent = money(now);
  $("#perCitizen").textContent = money(now / POPULATION, 0);
  $("#debtSince").textContent = money((now - DEBT_AT_INAUG) / 1e12, 3) + "T";
  $("#perSec").textContent = money(D.debt.perSecond || 0, 0);
  $("#sessionDebt").textContent = money(now - debtAtLoad, 0);
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
  const s = D.cheeto ?? 0;
  $("#cheetoVal").textContent = s.toFixed(1) + " / 100";
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
      ${p.text ? `<div class="acts"><button data-share="${esc(p.id)}">🖼 Save as error dialog</button>
                   <button data-copy="${esc(p.id)}">📋 Copy</button></div>` : ""}
    </div>`;
  }).join("") || '<div style="color:#777">No posts available.</div>';

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
    svgEl.innerHTML = `<text x="150" y="22" text-anchor="middle" font-size="9" fill="#888">collecting history…</text>`;
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
  btn.addEventListener("click", toggle);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggle(e); });
  document.addEventListener("click", () => { menu.hidden = true; btn.classList.remove("on"); });
  menu.addEventListener("click", (e) => e.stopPropagation());

  $("#trayWatch").addEventListener("click", () => WM.open("w-truth"));

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
  // file:// and localhost-without-https will reject registration; ignore quietly.
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller) {
          // A new build is ready. Don't reload under them mid-read — offer it.
          showModal("Update available", "&#128260;",
            "A newer version of the site is ready.<br><br>" +
            "<button class='b95' id='swReload'>Reload now</button>");
          setTimeout(() => {
            const btn = $("#swReload");
            if (btn) btn.addEventListener("click", () => { sw.postMessage("skip-waiting"); location.reload(); });
          }, 0);
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
  WM.init();
  initChrome();
  initBall();
  initMines();
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
if (booted) { $("#boot")?.remove(); } else { boot(); }
start();
