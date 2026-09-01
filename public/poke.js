/* =====================================================================
   POKEABLE READOUTS
   Two things you can do TO the numbers rather than just read off them.

   1. GUESS THE DEBT — once a day, the clock asks before it tells. Turns the
      headline figure from something you skim into something you committed to.
   2. YOUR OWN METER — the Cheeto-meter's five components, with sliders. The
      published reading is the equal-weight average; yours is whatever you
      think matters. Saved on-device.

   Both operate on the same real figures the rest of the site shows. Nothing
   here invents data — the guess game scores you against the live Treasury
   number, and reweighting changes only how the components are averaged, with
   every input still shown and sourced.
   ===================================================================== */

/* =====================================================================
   1. GUESS THE DEBT
   ===================================================================== */
const Guess = {
  KEY: "cheeto_guess_v1",

  state() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch { return {}; } },
  put(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch {} },
  today() { return new Date().toISOString().slice(0, 10); },

  /* Once per day. A guess you can retake instantly isn't a guess. */
  due() { return this.state().day !== this.today(); },

  mount() {
    const box = document.getElementById("guessBox");
    if (!box) return;
    const s = this.state();

    if (!this.due()) {
      const off = s.offBy;
      box.innerHTML = `<div class="gs-done">
        <span class="gs-k">Today's guess</span>
        <b>${esc(money(s.guess || 0, 0))}</b>
        <span class="gs-off ${s.pct != null && s.pct < 1 ? "good" : ""}">${
          off == null ? "" : `off by ${esc(money(Math.abs(off), 0))} (${s.pct?.toFixed(2)}%)`}</span>
        ${s.streak > 1 ? `<span class="gs-streak">&#128293; ${s.streak}-day streak</span>` : ""}
      </div>`;
      return;
    }

    box.innerHTML = `<div class="gs">
      <div class="gs-q">Before you look &mdash; what's the national debt right now?</div>
      <div class="gs-in">
        <span>$</span>
        <input type="text" id="gsVal" inputmode="numeric" autocomplete="off"
               placeholder="38,100,000,000,000" aria-label="Your guess at the national debt">
        <button class="b95" id="gsGo">Lock it in</button>
      </div>
      <div class="gs-hint">Trillions. No pressure.</div>
    </div>`;

    const input = document.getElementById("gsVal");
    // Commas as you type, because typing fourteen digits unformatted is cruel.
    input?.addEventListener("input", () => {
      const raw = input.value.replace(/[^0-9]/g, "").slice(0, 15);
      input.value = raw ? Number(raw).toLocaleString("en-US") : "";
    });
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
    document.getElementById("gsGo")?.addEventListener("click", () => this.submit());
  },

  submit() {
    const raw = (document.getElementById("gsVal")?.value || "").replace(/[^0-9]/g, "");
    const g = Number(raw);
    if (!raw || !isFinite(g) || g <= 0) {
      showModal("Need a number", "&#9888;", "Type your guess at the debt first &mdash; digits only.");
      return;
    }

    const actual = liveDebt();
    const off = g - actual;
    const pct = Math.abs(off / actual) * 100;

    const prev = this.state();
    const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const streak = prev.day === yday ? (prev.streak || 1) + 1 : 1;

    let best = prev.best;
    if (best == null || pct < best) best = pct;

    this.put({ day: this.today(), guess: g, offBy: off, pct, streak, best });

    const verdict =
      pct < 0.25 ? ["&#127942;", "Extremely close", "That's within a quarter of a percent. Genuinely impressive."]
      : pct < 1  ? ["&#127919;", "Close", "Within one percent. You've been paying attention."]
      : pct < 5  ? ["&#128077;", "Not bad", "The right order of magnitude, anyway."]
      : pct < 25 ? ["&#128533;", "Off", "Out by more than a rounding error."]
      :            ["&#128169;", "Way off", "Not the right neighbourhood."];

    showModal(verdict[1], verdict[0], `
      <div style="font-size:12px;line-height:1.6">
        You said <b>${esc(money(g, 0))}</b>.<br>
        It's actually <b>${esc(money(actual, 0))}</b>.<br><br>
        You were ${off > 0 ? "over" : "under"} by <b>${esc(money(Math.abs(off), 0))}</b>
        &mdash; ${pct.toFixed(2)}%.<br>
        <span style="color:#555;font-size:11px">${verdict[2]}</span><br><br>
        ${streak > 1 ? `&#128293; <b>${streak}-day streak.</b> ` : ""}
        Best ever: ${best != null ? best.toFixed(2) + "%" : "—"}.
        Come back tomorrow for another.
      </div>`);

    this.mount();
  },
};

/* =====================================================================
   2. YOUR OWN CHEETO-METER
   The five components are the same ones the server averages. Reweighting
   changes the average only — each component's own value and the formula that
   produced it stay exactly as published, and are shown next to the slider.
   ===================================================================== */
const MyMeter = {
  KEY: "cheeto_weights_v1",
  NAMES: ["Disapproval", "Gas vs 1yr", "CPI vs target", "Tariff rate", "Debt growth"],

  weights() {
    try {
      const w = JSON.parse(localStorage.getItem(this.KEY) || "null");
      if (Array.isArray(w) && w.length === 5 && w.every((x) => typeof x === "number")) return w;
    } catch {}
    return null;
  },
  save(w) { try { localStorage.setItem(this.KEY, JSON.stringify(w)); } catch {} },
  clear() { try { localStorage.removeItem(this.KEY); } catch {} },

  /* Same five component scores charts.js draws, recomputed here so the panel
     doesn't depend on that file having rendered first. */
  parts() {
    const c = (x) => Math.max(0, Math.min(100, x));
    return [
      c((((D.approval?.disapprove ?? 50) - 35) / 30) * 100),
      D.gas?.prev ? c(((D.gas.v / D.gas.prev - 1) / 0.4) * 100) : null,
      c((((D.cpi?.v ?? 2) - 2) / 4) * 100),
      c(((D.tariff?.v ?? 0) / 15) * 100),
      c(((((D.debt?.perSecond ?? 0) * 31557600) / 1e12) / 4) * 100),
    ];
  },

  score(weights) {
    const p = this.parts();
    let sum = 0, tot = 0;
    p.forEach((v, i) => { if (v == null) return; const w = weights[i] ?? 1; sum += v * w; tot += w; });
    return tot ? sum / tot : 0;
  },

  mount() {
    const box = document.getElementById("myMeter");
    if (!box) return;
    const w = this.weights() || [1, 1, 1, 1, 1];
    const p = this.parts();
    const custom = Boolean(this.weights());
    const mine = this.score(w);
    const official = this.score([1, 1, 1, 1, 1]);

    box.innerHTML = `
      <div class="mm-top">
        <div><span class="mm-k">Published</span><b>${official.toFixed(1)}</b></div>
        <div class="mm-arrow">&rarr;</div>
        <div><span class="mm-k">Yours</span><b class="mm-mine">${mine.toFixed(1)}</b></div>
      </div>
      ${this.NAMES.map((n, i) => p[i] == null
        ? `<div class="mm-row off"><span>${esc(n)}</span><i>no data today</i></div>`
        : `<div class="mm-row">
             <div class="mm-lbl"><span>${esc(n)}</span><b>${p[i].toFixed(0)}</b></div>
             <input type="range" min="0" max="3" step="0.5" value="${w[i]}" data-wi="${i}"
                    aria-label="Weight for ${esc(n)}">
             <div class="mm-w">&times;${(w[i]).toFixed(1)}</div>
           </div>`).join("")}
      <div class="mm-foot">
        <button class="b95 tiny" id="mmReset">Back to equal weights</button>
        <button class="b95 tiny" id="mmCopy">Copy my reading</button>
      </div>
      <p class="note">Sliders change only how the five are averaged. Each component's own
      value and formula are unchanged and shown above &mdash; ${custom
        ? "the gauge at the top of this window follows your weights."
        : "set any slider away from &times;1.0 and the gauge follows yours instead."}</p>`;

    box.querySelectorAll("[data-wi]").forEach((sl) => {
      sl.addEventListener("input", () => {
        const nw = this.weights() || [1, 1, 1, 1, 1];
        nw[+sl.dataset.wi] = parseFloat(sl.value);
        this.save(nw);
        this.mount();
        if (typeof renderMeter === "function") renderMeter();
      });
    });
    document.getElementById("mmReset")?.addEventListener("click", () => {
      this.clear(); this.mount();
      if (typeof renderMeter === "function") renderMeter();
    });
    document.getElementById("mmCopy")?.addEventListener("click", async () => {
      const txt = `My Cheeto-meter reads ${mine.toFixed(1)}/100 (the site's own reading is ${official.toFixed(1)}). `
        + this.NAMES.map((n, i) => p[i] == null ? null : `${n} ${p[i].toFixed(0)}×${w[i]}`)
            .filter(Boolean).join(", ") + ` — supremecheeto.club`;
      try { await navigator.clipboard.writeText(txt); showModal("Copied", "&#128203;", "Your reading is on the clipboard."); }
      catch { showModal("Couldn't copy", "&#9888;", "Your browser refused clipboard access."); }
    });
  },
};

document.addEventListener("cheeto:data", () => { Guess.mount(); MyMeter.mount(); });
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { Guess.mount(); MyMeter.mount(); });
} else { Guess.mount(); MyMeter.mount(); }
