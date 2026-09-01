/* =====================================================================
   POPUPS — sponsor slots and "breaking news" alerts
   Loads last, so D / WM / esc / money / ago all exist.

   Two kinds share one popup engine:
     ADS    — house creatives, and the slot system for selling inventory later.
     ALERTS — 90s-style breaking-news popups whose content is pulled from the
              SAME live data the dashboard shows. Nothing is invented: a post
              alert quotes verbatim text from the feed, a debt alert reads the
              live counter. The joke is the framing, not made-up facts.
   ===================================================================== */

/* =====================================================================
   AD INVENTORY — add a slot here to run a new advertiser.
   `weight` controls how often it comes up relative to the others.
   ===================================================================== */
const AD_SLOTS = [
  {
    id: "stax",
    weight: 3,
    advertiser: "STAX AI",
    url: "https://staxai.app/",
    headline: "STAX&nbsp;AI",
    sub: "Follow the smart money in real time.",
    body: "Options flow, dark pool prints and congressional trades — the institutional tape, on one screen.",
    cta: "START FREE TRIAL",
    // Any slot can carry a flashing badge; it's part of the ad format, not a
    // one-off, so a future advertiser gets it by adding this one field.
    flash: "5-DAY FREE TRIAL",
    skin: "stax",
  },
  {
    id: "tg",
    weight: 3,
    advertiser: "Trades &amp; Gains",
    url: "https://tradesandgains.io",
    headline: "T&amp;G&nbsp;TERMINAL",
    sub: "The quant desk, for retail.",
    body: "Live gamma exposure, dealer positioning and market-structure alerts, with a publicly graded track record.",
    cta: "VISIT NOW",
    skin: "tg",
  },
  {
    id: "house",
    weight: 1,
    advertiser: "This site",
    url: null,
    headline: "YOUR&nbsp;AD&nbsp;HERE",
    sub: "468 × 60 of prime 1997 real estate.",
    body: "This banner slot is available. Reach dozens of people who miss Windows 95.",
    cta: "GET IN TOUCH",
    skin: "house",
  },
];

const Popups = {
  KEY_BLOCK: "cheeto_popups_off",
  shown: 0,
  MAX_PER_SESSION: 7,
  live: null,
  timer: null,
  lastKind: null,
  seenPostIds: new Set(),

  blocked() { try { return localStorage.getItem(this.KEY_BLOCK) === "1"; } catch { return false; } },
  setBlocked(v) {
    try { v ? localStorage.setItem(this.KEY_BLOCK, "1") : localStorage.removeItem(this.KEY_BLOCK); } catch {}
    if (v) { this.close(); clearTimeout(this.timer); }
    else this.schedule(38000);
    const item = document.getElementById("popupItem");
    if (item) item.querySelector(".lbl").textContent = v ? "Allow pop-ups" : "Block pop-ups";
  },

  init() {
    const item = document.getElementById("popupItem");
    if (item) item.querySelector(".lbl").textContent = this.blocked() ? "Allow pop-ups" : "Block pop-ups";
    if (!this.blocked()) this.schedule(38000);
  },

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.blocked() || this.shown >= this.MAX_PER_SESSION) return;
    this.timer = setTimeout(() => this.fire(), ms ?? (85000 + Math.random() * 95000));
  },

  /* alternate ads and alerts so it never feels like pure advertising */
  fire() {
    if (this.blocked() || this.live) { this.schedule(); return; }
    const alert = this.buildAlert();
    const wantAlert = alert && this.lastKind !== "alert";
    if (wantAlert) { this.open(alert); this.lastKind = "alert"; }
    else { this.open(this.buildAd()); this.lastKind = "ad"; }
    this.shown++;
    this.schedule();
  },

  /* ---------------- ads ---------------- */
  pickSlot() {
    const pool = [];
    AD_SLOTS.forEach((s) => { for (let i = 0; i < s.weight; i++) pool.push(s); });
    return pool[Math.floor(Math.random() * pool.length)];
  },

  buildAd() {
    const s = this.pickSlot();
    const link = s.url
      ? `<a class="ad-cta" href="${esc(s.url)}" target="_blank" rel="noopener sponsored">${s.cta} &raquo;</a>`
      : `<span class="ad-cta">${s.cta} &raquo;</span>`;
    // The blink is the single most 1997 thing on this website. It honours
    // prefers-reduced-motion in CSS — a badge that strobes at someone who has
    // asked their OS for less motion is a genuine accessibility problem, not
    // a stylistic one.
    const flash = s.flash
      ? `<span class="ad-flash" role="note">${s.flash}</span>` : "";
    return {
      title: "Advertisement",
      navy: false,
      body: `
        <div class="ad ad-${s.skin}">
          <div class="ad-banner">
            ${flash}
            <div class="ad-head">${s.headline}</div>
            <div class="ad-sub">${s.sub}</div>
            <span class="ad-shine" aria-hidden="true"></span>
          </div>
          <p class="ad-body">${s.body}</p>
          <div class="ad-foot">${link}
            <span class="ad-tag">SPONSORED &middot; ${s.advertiser}</span></div>
        </div>`,
    };
  },

  /* ---------------- alerts (real data only) ---------------- */
  buildAlert() {
    const opts = [];
    const posts = (D.posts?.list || []).filter((p) => p.text && p.text.length > 12);

    // A verbatim quote from the feed, never a paraphrase and never invented.
    const fresh = posts.find((p) => p.id && !this.seenPostIds.has(p.id));
    if (fresh) {
      const t = Date.parse(fresh.at);
      opts.push({
        kind: "post",
        id: fresh.id,
        title: "TruthSocial.exe — incoming",
        navy: true,
        body: `<div class="alert">
            <div class="alert-top"><span class="alert-glyph">&#128226;</span>
              <b>NEW TRANSMISSION</b></div>
            <div class="alert-quote">${esc(fresh.text.slice(0, 260))}${fresh.text.length > 260 ? "…" : ""}</div>
            <div class="alert-meta">${isFinite(t) ? esc(ago(Date.now() - t)) + " ago" : "recently"}
              &middot; verbatim, from the public feed
              ${fresh.url ? `&middot; <a href="${esc(fresh.url)}" target="_blank" rel="noopener">source</a>` : ""}</div>
          </div>`,
      });
    }

    if (D.debt?.amount) {
      const now = liveDebt();
      opts.push({
        kind: "debt",
        title: "SYSTEM ALERT — debt.dll",
        body: `<div class="alert">
            <div class="alert-top"><span class="alert-glyph">&#128176;</span><b>DEBT MILESTONE</b></div>
            <div class="alert-big">${esc(money(now, 0))}</div>
            <div class="alert-meta">Up ${esc(money((D.debt.perSecond || 0) * 60, 0))} in the last minute.
              Your share: ${esc(money(now / POPULATION, 0))}.</div>
          </div>`,
      });
    }

    if (D.approval?.approve != null) {
      const net = D.approval.approve - D.approval.disapprove;
      opts.push({
        kind: "poll",
        title: "POLLS.EXE has stopped responding",
        body: `<div class="alert">
            <div class="alert-top"><span class="alert-glyph">&#128499;</span><b>APPROVAL UPDATE</b></div>
            <div class="alert-big">${D.approval.approve}% / ${D.approval.disapprove}%</div>
            <div class="alert-meta">Net ${net > 0 ? "+" : ""}${net.toFixed(1)} points.
              Polling average, not a single poll.</div>
          </div>`,
      });
    }

    if (D.gas?.v && D.gas?.prev) {
      const pc = ((D.gas.v / D.gas.prev - 1) * 100).toFixed(0);
      opts.push({
        kind: "gas",
        title: "kitchen_table.exe",
        body: `<div class="alert">
            <div class="alert-top"><span class="alert-glyph">&#9981;</span><b>PUMP WATCH</b></div>
            <div class="alert-big">$${D.gas.v.toFixed(3)}<span style="font-size:14px">/gal</span></div>
            <div class="alert-meta">${pc >= 0 ? "Up" : "Down"} ${Math.abs(pc)}% on a year ago. AAA national average.</div>
          </div>`,
      });
    }

    if (D.cheeto != null) {
      opts.push({
        kind: "meter",
        title: "CHEETO-METER.EXE",
        body: `<div class="alert">
            <div class="alert-top"><span class="alert-glyph">&#129472;</span><b>METER READING</b></div>
            <div class="alert-big">${D.cheeto.toFixed(1)}<span style="font-size:14px"> / 100</span></div>
            <div class="alert-meta">${esc($("#cheetoLabel")?.textContent || "")}
              — a joke composite of real figures. Not an economic indicator.</div>
          </div>`,
      });
    }

    if (!opts.length) return null;
    const pick = opts[Math.floor(Math.random() * opts.length)];
    if (pick.kind === "post" && pick.id) this.seenPostIds.add(pick.id);
    return pick;
  },

  /* ---------------- the popup window itself ---------------- */
  open(spec) {
    if (!spec) return;
    this.close();

    const el = document.createElement("div");
    el.className = "win popup active";
    el.innerHTML = `
      <div class="tb ${spec.navy ? "navy" : ""}">
        <span class="ico">&#128231;</span>
        <span class="t">${esc(spec.title)}</span>
        <span class="btns"><button data-x title="Close">&times;</button></span>
      </div>
      <div class="body">${spec.body}
        <div class="popup-foot">
          <button class="b95 tiny" data-ok>Close</button>
          <button class="b95 tiny" data-never>Don't show these</button>
        </div>
      </div>`;

    // land somewhere plausible but never under the taskbar or off-screen
    const deskW = window.innerWidth, deskH = window.innerHeight;
    const w = Math.min(340, deskW - 24);
    el.style.width = w + "px";
    const x = Math.max(12, Math.min(deskW - w - 12, deskW - w - 24 - Math.random() * 90));
    const y = Math.max(12, Math.min(deskH - 260, 90 + Math.random() * 140));
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";

    document.body.appendChild(el);
    this.live = el;

    el.querySelector("[data-x]").addEventListener("click", () => this.close());
    el.querySelector("[data-ok]").addEventListener("click", () => this.close());
    el.querySelector("[data-never]").addEventListener("click", () => {
      this.setBlocked(true);
      showModal("Pop-ups blocked", "&#128683;",
        "No more pop-ups this session or next.<br><br><span style='color:#555;font-size:11px'>Turn them back on from the Start menu if you miss them.</span>");
    });

    // auto-dismiss so an ignored popup doesn't sit there forever
    this.autoClose = setTimeout(() => this.close(), 22000);
  },

  close() {
    clearTimeout(this.autoClose);
    if (this.live) { this.live.remove(); this.live = null; }
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Popups.init());
} else {
  Popups.init();
}
