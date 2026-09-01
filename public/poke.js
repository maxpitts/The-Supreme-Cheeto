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
   Once a day the clock asks before it tells, and now the answers are ranked.

   Two modes, because the game predates the accounts:
     - signed out, it runs on localStorage exactly as it always did. You get
       your verdict and your streak, and nothing leaves the browser.
     - signed in, Postgres is the record. The browser sends ONE number — the
       guess. The day, the live figure it was scored against, the error and
       the percentage are all stamped server-side by a trigger, from a
       baseline only the refresh job can write.

   That split is the whole reason the board is worth looking at. A score kept
   in localStorage is a score its owner can edit; anyone could have opened
   devtools and been permanently first. The client cannot claim an accuracy
   here — it can only claim a guess, and the server does the arithmetic.

   The board is still an honour system in one respect, and the note under it
   says so: the debt is on screen a few pixels above the input. Nothing can
   stop someone reading it and typing it in. What's been removed is the
   silent, effortless cheat — the one that doesn't even require looking.
   ===================================================================== */
const Guess = {
  KEY: "cheeto_guess_v1",

  /* Server state, when signed in: { signed_in, today, field, plays, best, avg, streak } */
  srv: null,
  board: [],
  mode: "today",
  loading: false,
  loadedAt: 0,

  state() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch { return {}; } },
  put(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch {} },

  /* Eastern days, so the deadline matches the server's and the rest of the
     site. Using the browser's own date would let someone in Sydney get two
     turns on the local game and then be refused by the database for the
     second, which reads as a bug rather than a rule. */
  today() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  },
  yesterday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(Date.now() - 864e5));
  },

  online() { return Boolean(typeof sb !== "undefined" && sb && typeof me !== "undefined" && me); },

  /* Once per day. A guess you can retake instantly isn't a guess. */
  due() {
    if (this.online()) return this.srv ? !this.srv.today : true;
    return this.state().day !== this.today();
  },

  /* ------------------------------------------------------------ load */
  async load(force) {
    if (!this.online()) { this.srv = null; await this.loadBoard(force); return; }
    if (this.loading) return;
    if (!force && Date.now() - this.loadedAt < 15000) return;
    this.loading = true;
    try {
      const { data, error } = await sb.rpc("cheeto_my_guess_stats");
      if (!error && data && typeof data === "object") this.srv = data;
      this.loadedAt = Date.now();
    } catch { /* the local game still works; leave srv alone */ }
    finally { this.loading = false; }
    await this.loadBoard(force);
    this.mount();
  },

  async loadBoard() {
    if (typeof sb === "undefined" || !sb) { this.board = []; return; }
    try {
      const { data, error } = await sb.rpc("cheeto_guess_board", { mode: this.mode, lim: 8 });
      this.board = (error || !Array.isArray(data)) ? [] : data;
    } catch { this.board = []; }
  },

  /* ------------------------------------------------------------ paint */
  mount() {
    this.paintGuess();
    this.paintBoard();
  },

  paintGuess() {
    const box = document.getElementById("guessBox");
    if (!box) return;

    if (!this.due()) {
      const t = this.online() && this.srv?.today ? {
        guess: Number(this.srv.today.guess),
        offBy: Number(this.srv.today.off_by),
        pct: Number(this.srv.today.pct),
        rank: this.srv.today.rank,
        field: this.srv.field,
        streak: this.srv.streak,
      } : (() => {
        const s = this.state();
        return { guess: s.guess, offBy: s.offBy, pct: s.pct, rank: null, field: null, streak: s.streak };
      })();

      box.innerHTML = `<div class="gs-done">
        <span class="gs-k">Today's guess</span>
        <b>${esc(money(t.guess || 0, 0))}</b>
        <span class="gs-off ${t.pct != null && t.pct < 1 ? "good" : ""}">${
          t.offBy == null ? "" : `off by ${esc(money(Math.abs(t.offBy), 0))} (${Number(t.pct).toFixed(2)}%)`}</span>
        ${t.rank ? `<span class="gs-rank">#${t.rank} of ${t.field} today</span>` : ""}
        ${t.streak > 1 ? `<span class="gs-streak">&#128293; ${t.streak}-day streak</span>` : ""}
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
      <div class="gs-hint">Trillions. No pressure.${
        this.online() ? " Your guess goes on the board below." :
        (typeof sb !== "undefined" && sb ? " Sign in and it goes on the board below." : "")}</div>
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

  /* ------------------------------------------------------------ board */
  paintBoard() {
    const box = document.getElementById("guessBoard");
    if (!box) return;

    const TABS = [
      ["today", "Today"],
      ["best", "Best ever"],
      ["avg", "Most consistent"],
    ];

    const tabs = TABS.map(([k, label]) =>
      `<button class="b95 tiny gb-tab${this.mode === k ? " on" : ""}" data-gb="${k}">${label}</button>`).join("");

    box.innerHTML = `
      <div class="gb-tabs">${tabs}</div>
      ${this.boardRowsHTML()}
      ${this.myLineHTML()}
      <p class="note">${this.boardNote()}</p>`;

    box.querySelectorAll("[data-gb]").forEach((b) =>
      b.addEventListener("click", async () => {
        this.mode = b.dataset.gb;
        await this.loadBoard();
        this.paintBoard();
      }));
    box.querySelectorAll("[data-gb-in]").forEach((b) =>
      b.addEventListener("click", () => { if (typeof signIn === "function") signIn(b.dataset.gbIn); }));
    box.querySelector("[data-gb-email]")?.addEventListener("click",
      () => promptSignIn("Sign in to put your guesses on the board."));
  },

  boardRowsHTML() {
    if (typeof sb === "undefined" || !sb) {
      return `<div class="note">The board needs the database, which didn't load.</div>`;
    }
    if (!this.board.length) {
      return `<div class="note">${
        this.mode === "avg"
          ? "Nobody has three days in yet. The averages fill in as people keep playing."
          : this.mode === "today"
            ? "No guesses today yet. Be the first and you're top of the board until someone beats you."
            : "No guesses on record yet."}</div>`;
    }

    return `<table class="gb-board"><thead><tr>
        <th>#</th><th>Who</th><th>${this.mode === "avg" ? "Average off" : "Off by"}</th>
        <th>${this.mode === "avg" ? "Days" : "Streak"}</th>
      </tr></thead><tbody>
      ${this.board.map((r) => `<tr${r.is_me ? ' class="me"' : ""}>
        <td>${r.rank}</td>
        <td class="gb-who" data-open-user="${esc(r.handle || "")}" title="View profile">${
          r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="" width="16" height="16" loading="lazy">` : ""}
          ${esc(r.display_name || r.handle || "anon")}</td>
        <td class="gb-pct">${r.masked
            ? `<span class="gb-hid" title="Hidden until you've guessed today">&#128274; hidden</span>`
            : this.pctText(r.pct)}</td>
        <td>${this.mode === "avg"
            ? r.plays
            : (r.streak > 1 ? `&#128293; ${r.streak}` : (r.streak || 0))}</td>
      </tr>`).join("")}
    </tbody></table>`;
  },

  /* Percentages here span six orders of magnitude — a good guess is 0.002%
     and a joke one is 100% — so a fixed number of decimals is either noise
     or a row of zeroes. */
  pctText(pct) {
    const p = Number(pct);
    if (!isFinite(p)) return "&mdash;";
    if (p < 0.01) return p.toFixed(4) + "%";
    if (p < 1) return p.toFixed(3) + "%";
    if (p < 10) return p.toFixed(2) + "%";
    return p.toFixed(1) + "%";
  },

  myLineHTML() {
    if (typeof sb === "undefined" || !sb) return "";
    if (!this.online()) {
      return `<div class="gb-you gb-out">
        <b>Sign in to get on the board.</b>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="b95 tiny" data-gb-in="google">Google</button>
          <button class="b95 tiny" data-gb-in="discord">Discord</button>
          ${EMAIL_SIGNIN ? `<button class="b95 tiny" data-gb-email>Email</button>` : ""}
        </div>
        <div class="note" style="margin-top:5px">Your guesses on this device still work and still keep a streak
        &mdash; they just can't be ranked against anyone, because nothing about them ever leaves this browser.</div>
      </div>`;
    }
    const s = this.srv;
    if (!s || !s.plays) {
      return `<div class="gb-you"><span class="gs-k">Your record</span>
        <span class="note" style="margin:0">Nothing yet &mdash; today's guess is your first.</span></div>`;
    }
    // Shown whether or not you made the top eight, so the board is never just
    // other people's names.
    const onBoard = this.board.some((r) => r.is_me);
    return `<div class="gb-you">
      <span class="gs-k">Your record</span>
      <div class="gb-mine">
        <div><b>${s.plays}</b><span>played</span></div>
        <div><b>${s.best == null ? "&mdash;" : this.pctText(s.best)}</b><span>best</span></div>
        <div><b>${s.avg == null ? "&mdash;" : this.pctText(s.avg)}</b><span>average</span></div>
        <div><b>${s.streak > 1 ? "&#128293; " + s.streak : (s.streak || 0)}</b><span>streak</span></div>
      </div>
      ${onBoard ? "" : `<div class="note" style="margin-top:5px">Not in the top eight on this board yet.</div>`}
    </div>`;
  },

  boardNote() {
    const scoring = "Scored in the database against the same Treasury figure the clock above runs on "
      + "&mdash; your browser sends the guess and nothing else, so an accuracy can't be faked.";
    const masked = this.mode === "today"
      ? " Today's numbers stay hidden until you've had your own go."
      : "";
    const honour = " The clock is right there, though, so like every good bar game this one runs on the honour system.";
    return scoring + masked + honour;
  },

  /* ------------------------------------------------------------ submit */
  async submit() {
    const btn = document.getElementById("gsGo");
    const raw = (document.getElementById("gsVal")?.value || "").replace(/[^0-9]/g, "");
    const g = Number(raw);
    if (!raw || !isFinite(g) || g <= 0) {
      showModal("Need a number", "&#9888;", "Type your guess at the debt first &mdash; digits only.");
      return;
    }

    if (this.online()) {
      if (btn) { btn.disabled = true; btn.textContent = "Locking in…"; }
      try {
        // The insert returns the row the TRIGGER wrote, so the verdict shown
        // is the server's arithmetic and not a second, local calculation that
        // could quietly disagree with the board.
        const { data, error } = await sb.from("cheeto_guesses")
          .insert({ guess: g })
          .select("day, guess, actual, off_by, pct")
          .single();
        if (error) throw error;

        await this.load(true);
        this.verdict(Number(data.guess), Number(data.actual), Number(data.off_by), Number(data.pct),
                     this.srv?.streak || 1, this.srv?.best, this.srv?.today?.rank, this.srv?.field);
        this.mount();
        return;
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = "Lock it in"; }
        const msg = String(err?.message || "");
        // A duplicate means another tab already played today, not a failure.
        if (/duplicate key|cheeto_guesses_user_id_day_key/i.test(msg)) {
          await this.load(true);
          this.mount();
          showModal("Already guessed today", "&#128337;",
            "You've had your go for today &mdash; there's one guess per day. Come back tomorrow.");
          return;
        }
        showModal("Guess not saved", "&#9888;",
          `The database refused that.<br><br><span style="color:#555;font-size:11px">${esc(msg || "unknown error")}</span>
           <br><br>Usually that means your account is under ten minutes old, or you're rate limited.
           Your guess wasn't scored, so you can try again.`);
        return;
      }
    }

    /* Signed out: exactly the old local game. */
    const actual = liveDebt();
    const off = g - actual;
    const pct = Math.abs(off / actual) * 100;

    const prev = this.state();
    const streak = prev.day === this.yesterday() ? (prev.streak || 1) + 1 : 1;
    let best = prev.best;
    if (best == null || pct < best) best = pct;

    this.put({ day: this.today(), guess: g, offBy: off, pct, streak, best });
    this.verdict(g, actual, off, pct, streak, best, null, null);
    this.mount();
  },

  verdict(g, actual, off, pct, streak, best, rank, field) {
    Cheetip?.react?.("guess", { pct });

    const v =
      pct < 0.25 ? ["&#127942;", "Extremely close", "That's within a quarter of a percent. Genuinely impressive."]
      : pct < 1  ? ["&#127919;", "Close", "Within one percent. You've been paying attention."]
      : pct < 5  ? ["&#128077;", "Not bad", "The right order of magnitude, anyway."]
      : pct < 25 ? ["&#128533;", "Off", "Out by more than a rounding error."]
      :            ["&#128169;", "Way off", "Not the right neighbourhood."];

    showModal(v[1], v[0], `
      <div style="font-size:12px;line-height:1.6">
        You said <b>${esc(money(g, 0))}</b>.<br>
        It's actually <b>${esc(money(actual, 0))}</b>.<br><br>
        You were ${off > 0 ? "over" : "under"} by <b>${esc(money(Math.abs(off), 0))}</b>
        &mdash; ${pct.toFixed(2)}%.<br>
        <span style="color:#555;font-size:11px">${v[2]}</span><br><br>
        ${rank ? `<b>#${rank}</b> of ${field} ${field === 1 ? "guess" : "guesses"} today. ` : ""}
        ${streak > 1 ? `&#128293; <b>${streak}-day streak.</b> ` : ""}
        Best ever: ${best != null ? this.pctText(best) : "—"}.
        Come back tomorrow for another.
        <br><br><button class="b95" id="gsShare">&#128247; Share this</button>
      </div>`);

    document.getElementById("gsShare")?.addEventListener("click", () => Share.open("guess", {
      pct, guessText: money(g, 0), actualText: money(actual, 0), rank, field, streak,
    }));
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
        <button class="b95 tiny" id="mmShare">&#128247; Share</button>
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
        Cheetip?.react?.("meter");
        if (typeof renderMeter === "function") renderMeter();
      });
    });
    document.getElementById("mmReset")?.addEventListener("click", () => {
      this.clear(); this.mount();
      if (typeof renderMeter === "function") renderMeter();
    });
    document.getElementById("mmShare")?.addEventListener("click", () =>
      Share.open("meter", { value: mine }));
    document.getElementById("mmCopy")?.addEventListener("click", async () => {
      const txt = `My Cheeto-meter reads ${mine.toFixed(1)}/100 (the site's own reading is ${official.toFixed(1)}). `
        + this.NAMES.map((n, i) => p[i] == null ? null : `${n} ${p[i].toFixed(0)}×${w[i]}`)
            .filter(Boolean).join(", ") + ` — supremecheeto.club`;
      try { await navigator.clipboard.writeText(txt); showModal("Copied", "&#128203;", "Your reading is on the clipboard."); }
      catch { showModal("Couldn't copy", "&#9888;", "Your browser refused clipboard access."); }
    });
  },
};

document.addEventListener("cheeto:data", () => { Guess.mount(); Guess.load(); MyMeter.mount(); });
/* Signing in or out changes which half of the game is authoritative, so the
   whole widget is rebuilt rather than just repainted. */
document.addEventListener("cheeto:auth", () => { Guess.srv = null; Guess.mount(); Guess.load(true); });

function bootPoke() { Guess.mount(); Guess.load(); MyMeter.mount(); }
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPoke);
} else { bootPoke(); }
