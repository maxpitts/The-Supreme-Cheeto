/* =====================================================================
   SINCE YOU STARTED — the personal running tally
   Loads after app.js. Everything here is on-device; nothing is sent anywhere.

   The point: a number that only exists because YOU keep coming back, and that
   gets more interesting the longer you do. "The debt is $38T" is the same
   sentence for everyone alive. "It has gone up $340B since you started
   checking twelve days ago, and your household's slice of that is $89" is a
   sentence that is only true for you.

   Every figure is a subtraction between two readings this site actually took,
   divided where relevant by a household size you typed in yourself. Nothing is
   modelled, projected or invented, and a figure missing from either end is
   omitted rather than guessed at.
   ===================================================================== */

const Tally = {
  KEY: "cheeto_since_v1",
  PROFILE: "cheeto_me_v1",

  read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },

  profile() { return this.read(this.PROFILE) || {}; },
  household() {
    const h = Number(this.profile().household);
    return Number.isFinite(h) && h >= 1 && h <= 20 ? h : null;
  },

  snapshot() {
    return {
      debt: D.debt?.amount ?? null,
      gas: D.gas?.v ?? null,
      approve: D.approval?.approve ?? null,
      disapprove: D.approval?.disapprove ?? null,
      eo: D.eo?.orders ?? null,
      golf: D.golf?.days ?? null,
      cheeto: D.cheeto ?? null,
    };
  },

  /* The origin reading, written once and then never overwritten — that's the
     whole point. Visits and seen-post ids accumulate on top of it. */
  begin() {
    if (D.seeded) return null;
    const ids = (D.posts?.list || []).map((p) => p.id).filter(Boolean);
    let s = this.read(this.KEY);

    if (!s || !s.t) {
      // The posts already on the feed when you arrive are NOT posts you watched
      // land. Recording them as the origin set is what stops day one claiming
      // you witnessed twenty posts you actually just scrolled past.
      s = { t: Date.now(), first: this.snapshot(), visits: 1,
            origin: ids, seen: [], lastVisit: Date.now() };
      this.save(this.KEY, s);
      return s;
    }

    // A "visit" is a session, not a page load.
    if (Date.now() - (s.lastVisit || 0) > 30 * 60e3) s.visits = (s.visits || 1) + 1;
    s.lastVisit = Date.now();

    const origin = new Set(s.origin || []);
    const seen = new Set(s.seen || []);
    ids.forEach((i) => { if (!origin.has(i)) seen.add(i); });
    // Keep the ledger bounded; it only needs to be long enough to spot repeats.
    s.seen = [...seen].slice(-600);
    this.save(this.KEY, s);
    return s;
  },

  lines(s) {
    const out = [];
    const f = s.first || {};
    const now = this.snapshot();
    const hh = this.household();

    if (f.debt != null && now.debt != null) {
      const d = now.debt - f.debt;
      if (Math.abs(d) > 1e6) {
        const perPerson = d / POPULATION;
        out.push({
          i: "&#128181;", k: "debt",
          big: (d > 0 ? "+" : "−") + money(Math.abs(d), 0),
          cap: "national debt",
          sub: hh
            ? `Your household of ${hh}: <b>${money(Math.abs(perPerson * hh), 2)}</b> ${d > 0 ? "added" : "removed"}`
            : `Per person: <b>${money(Math.abs(perPerson), 2)}</b>`,
        });
      }
    }

    const seenN = (s.seen || []).length;
    if (seenN) out.push({ i: "&#128226;", k: "posts", big: String(seenN), cap: "posts you've watched land",
      sub: "New posts since your first visit. The ones already on the feed when you arrived don't count." });

    if (f.gas != null && now.gas != null) {
      const d = now.gas - f.gas;
      if (Math.abs(d) >= 0.005) out.push({ i: "&#9981;", k: "gas",
        big: (d > 0 ? "+" : "−") + Math.abs(d * 100).toFixed(1) + "¢",
        cap: "a gallon", sub: `Now $${now.gas.toFixed(3)}, was $${f.gas.toFixed(3)} when you started.` });
    }

    if (f.eo != null && now.eo != null && now.eo - f.eo > 0)
      out.push({ i: "&#9998;", k: "eo", big: "+" + (now.eo - f.eo), cap: "executive orders",
        sub: `${now.eo} signed this term.` });

    if (f.golf != null && now.golf != null && now.golf - f.golf > 0)
      out.push({ i: "&#9971;", k: "golf", big: "+" + (now.golf - f.golf), cap: "golf days",
        sub: `${now.golf} total.` });

    if (f.approve != null && now.approve != null) {
      const net0 = f.approve - f.disapprove, net1 = now.approve - now.disapprove;
      const d = net1 - net0;
      if (Math.abs(d) >= 0.2) out.push({ i: "&#128499;", k: "net",
        big: (d > 0 ? "+" : "") + d.toFixed(1), cap: "net approval, points",
        sub: `${net1.toFixed(1)} today, ${net0.toFixed(1)} when you started.` });
    }

    return out;
  },

  render() {
    const box = $("#tallyBody");
    if (!box) return;
    const s = this.read(this.KEY);

    if (!s || !s.t) {
      box.innerHTML = `<div class="note">Nothing to compare yet &mdash; this panel starts
        keeping score from your first visit with live data loaded. Come back tomorrow.</div>`;
      return;
    }

    const days = Math.max(0, Math.floor((Date.now() - s.t) / 864e5));
    const lines = this.lines(s);
    const hh = this.household();

    box.innerHTML = `
      <div class="ty-head">
        <div class="ty-since">SINCE YOU STARTED WATCHING</div>
        <div class="ty-days">${days === 0 ? "today" : days === 1 ? "1 day ago" : days + " days ago"}</div>
        <div class="ty-visits">${s.visits || 1} visit${(s.visits || 1) === 1 ? "" : "s"}
          &middot; first reading ${esc(new Date(s.t).toLocaleDateString())}</div>
      </div>

      ${lines.length ? `<div class="ty-grid">${lines.map((l) => `
        <div class="ty-cell">
          <div class="ty-i">${l.i}</div>
          <div class="ty-big">${l.big}</div>
          <div class="ty-cap">${esc(l.cap)}</div>
          <div class="ty-sub">${l.sub}</div>
        </div>`).join("")}</div>`
        : `<div class="note">Nothing has moved enough to report yet. Give it a day.</div>`}

      <div class="ty-foot">
        ${hh
          ? `Figures split for a household of <b>${hh}</b>.
             <button class="b95 tiny" id="tyEdit">Change</button>`
          : `<button class="b95 tiny" id="tyEdit">Tell me your household size</button>
             &mdash; then the debt figures become your household's, not a per-capita abstraction.`}
        <button class="b95 tiny" id="tyReset">Reset my counter</button>
      </div>
      <p class="note">All of this lives in this browser and is never sent anywhere. Clearing
      your site data resets it. The debt split is arithmetic on a US population of
      ${fmtCount(POPULATION)} &mdash; a real division of a real number, not an estimate of
      what you personally owe.</p>`;

    $("#tyEdit")?.addEventListener("click", () => Setup.open(true));
    $("#tyReset")?.addEventListener("click", () => {
      showModal("Reset your counter?", "&#129704;",
        `This clears your start date and everything counted since.<br><br>
         <button class="b95" id="tyReset2">Yes, start over</button>`);
      setTimeout(() => $("#tyReset2")?.addEventListener("click", () => {
        try { localStorage.removeItem(Tally.KEY); } catch {}
        Tally.begin(); Tally.render();
        $("#modal").hidden = true;
      }), 0);
    });
  },
};

/* =====================================================================
   FIRST-RUN SETUP
   One question, asked once, skippable, and the site is fully usable if you
   never answer it. It exists so "your share" can mean something rather than
   being the national number divided by everybody.
   ===================================================================== */
const Setup = {
  KEY: "cheeto_setup_done",

  done() { try { return localStorage.getItem(this.KEY) === "1"; } catch { return true; } },

  maybeOffer() {
    if (this.done()) return;
    setTimeout(() => {
      if (this.done()) return;

      /* Never over the landing page. This modal fired on a timer from the
         first data load, which on a cold visit lands while somebody is still
         reading what the site IS — so the first thing a stranger saw was a
         box asking how many people live in their house, sitting on top of the
         ENTER button. Wait until they're actually on the desktop. */
      const landing = document.getElementById("landing");
      if (landing && !landing.hidden) { this.pending = true; return; }

      this.open(false);
    }, 2600);
  },

  /* Called when the landing page is dismissed, so the offer someone deferred
     by not having entered yet still reaches them. */
  offerAfterEntry() {
    if (!this.pending || this.done()) return;
    this.pending = false;
    setTimeout(() => { if (!this.done()) this.open(false); }, 2200);
  },

  open(manual) {
    const cur = Tally.profile().household || "";
    showModal("Make the numbers yours", "&#127968;", `
      <div class="setup">
        <p style="margin:0 0 10px">The debt figures on this site are the national number
        divided by everyone in the country. Tell me your household size and they become
        <b>your household's</b> share instead.</p>
        <label class="setup-l">People in your household
          <input type="number" id="suHh" min="1" max="20" step="1" value="${esc(String(cur))}"
                 placeholder="e.g. 3" inputmode="numeric">
        </label>
        <p class="note" style="margin:9px 0 0">Stored in this browser only. Never sent
        anywhere, never tied to an account, and the site works the same if you skip it.</p>
      </div>
      <div style="display:flex;gap:7px;justify-content:flex-end;margin-top:13px;flex-wrap:wrap">
        <button class="b95" id="suSkip">${manual ? "Cancel" : "Skip"}</button>
        <button class="b95" id="suSave" style="font-weight:bold">Save</button>
      </div>`);

    // showModal renders its own OK button; this flow supplies its own pair.
    setTimeout(() => {
      const ok = document.getElementById("modalOk");
      if (ok) ok.style.display = "none";
      document.getElementById("suSkip")?.addEventListener("click", () => this.finish(null));
      document.getElementById("suSave")?.addEventListener("click", () => {
        const v = parseInt(document.getElementById("suHh")?.value, 10);
        this.finish(Number.isFinite(v) && v >= 1 && v <= 20 ? v : null);
      });
      document.getElementById("suHh")?.focus();
    }, 0);
  },

  finish(household) {
    try { localStorage.setItem(this.KEY, "1"); } catch {}
    if (household != null) {
      const p = Tally.profile(); p.household = household;
      Tally.save(Tally.PROFILE, p);
    }
    const ok = document.getElementById("modalOk");
    if (ok) ok.style.display = "";
    $("#modal").hidden = true;
    Tally.render();
    if (typeof renderDebtPanel === "function") renderDebtPanel();
  },
};

/* Runs on the first real payload of the session: start (or advance) the
   counter, draw it, and only then consider offering setup. */
let tallyStarted = false;
document.addEventListener("cheeto:data", () => {
  if (D.seeded) return;
  Tally.begin();
  Tally.render();
  if (!tallyStarted) { tallyStarted = true; Setup.maybeOffer(); }
});
