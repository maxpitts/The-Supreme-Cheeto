/* =====================================================================
   THE FRONT DOOR
   A landing page for people arriving cold from a link, who otherwise get
   dropped into a fake Windows desktop with no idea what they're looking at.

   It is skipped in the cases where showing it would actively break something:
     - returning from an OAuth sign-in (?open= / auth tokens in the URL), where
       an interstitial would interrupt the redirect back into chat
     - a deep link to a specific window, which someone shared on purpose
     - later loads in the same session, so a refresh doesn't re-greet you

   The numbers on it are the real ones from the live feed, not a screenshot.
   A landing page bragging about a debt clock should show the debt clock.
   ===================================================================== */

const Landing = {
  KEY: "cheeto_entered",
  el: null,
  tick: null,

  shouldSkip() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get("open")) return true;                    // deep link or OAuth return
      if (/access_token|refresh_token|error=/.test(location.hash)) return true;
      if (sessionStorage.getItem(this.KEY) === "1") return true;
    } catch {}
    return false;
  },

  mount() {
    this.el = document.getElementById("landing");
    if (!this.el) return false;
    if (this.shouldSkip()) { this.el.remove(); this.el = null; return false; }

    this.el.hidden = false;
    document.body.classList.add("landing-on");
    this.el.innerHTML = `
      <div class="ld-wrap">
        <div class="ld-card">
          <div class="ld-logo"><img src="/logo.svg" alt="" width="120" height="120"></div>
          <h1 class="ld-title">THE SUPREME CHEETO</h1>
          <p class="ld-sub">A 1997 Windows desktop that tracks the president in real time.
            The national debt, every Truth Social post, approval, gas, eggs &mdash;
            all from public sources, all linked, none of it invented.</p>

          <div class="ld-stats" id="ldStats"></div>

          <button class="ld-enter" id="ldEnter">
            <span class="ld-enter-t">ENTER</span>
            <span class="ld-enter-s">boot the desktop</span>
          </button>

          <div class="ld-auth">
            <div class="ld-auth-h">&#128100; Sign in to chat, post statuses and play</div>
            <div class="ld-auth-b">
              <button class="b95" data-ld-in="google">Sign in with Google</button>
              <button class="b95" data-ld-in="discord">Sign in with Discord</button>
            </div>
            <div class="ld-auth-n">Optional &mdash; everything is readable without an account.</div>
          </div>

          <div class="ld-grid">
            <div><b>&#128181; Debt clock</b><span>Ticking to the penny, from the Treasury</span></div>
            <div><b>&#128226; Truth feed</b><span>Every post, verbatim, with a source link</span></div>
            <div><b>&#127919; Call It</b><span>Daily predictions, scored by the server</span></div>
            <div><b>&#128172; CheetoChat</b><span>A room, a buddy list, and a Top 8</span></div>
            <div><b>&#127183; Games</b><span>Solitaire, Blackjack, Minesweeper</span></div>
            <div><b>&#128250; The streams</b><span>BOBBYjayyy and benp90, live on Kick</span></div>
          </div>

          <p class="ld-foot">Satire and commentary on a public figure, built on public data.
            Not affiliated with anyone. Best viewed at 800&times;600.</p>
        </div>
      </div>`;

    document.getElementById("ldEnter").addEventListener("click", () => this.enter());
    this.el.querySelectorAll("[data-ld-in]").forEach((b) =>
      b.addEventListener("click", () => this.signIn(b.dataset.ldIn, b)));

    this.paint();
    document.addEventListener("cheeto:data", () => this.paint());
    // The debt is the whole pitch; let it move while they read.
    this.tick = setInterval(() => this.paintDebt(), 120);
    return true;
  },

  paint() {
    const box = document.getElementById("ldStats");
    if (!box) return;
    const online = (typeof Live === "object" && Live.connected) ? Live.count : null;
    const live = (typeof KickLive === "object")
      ? Object.values(KickLive.state || {}).filter((c) => c.live) : [];

    box.innerHTML = `
      <div class="ld-stat wide"><span class="ld-k">NATIONAL DEBT, RIGHT NOW</span>
        <b id="ldDebt">&mdash;</b></div>
      <div class="ld-stat"><span class="ld-k">Cheeto-meter</span>
        <b>${D.cheeto != null ? D.cheeto.toFixed(1) : "—"}</b></div>
      <div class="ld-stat"><span class="ld-k">Gas</span>
        <b>${D.gas?.v != null ? "$" + D.gas.v.toFixed(3) : "—"}</b></div>
      <div class="ld-stat"><span class="ld-k">Here now</span>
        <b>${online != null ? online : "—"}</b></div>
      ${live.length ? `<div class="ld-stat wide ld-live"><span class="lv-dot"></span>
        <b>${esc(live.map((c) => (typeof KICK_LABELS === "object" ? KICK_LABELS[c.name] : null) || c.name).join(" & "))}
        ${live.length > 1 ? "are" : "is"} live right now</b></div>` : ""}`;
    this.paintDebt();
  },

  paintDebt() {
    const el = document.getElementById("ldDebt");
    if (!el) return;
    try { el.textContent = D.seeded ? "—" : money(liveDebt(), 0); } catch {}
  },

  /* chat.js owns the Supabase client and may still be starting up when someone
     hits a sign-in button within the first second. Wait briefly rather than
     failing silently on a button that looks like it should work. */
  async signIn(provider, btn) {
    const was = btn.textContent;
    btn.disabled = true; btn.textContent = "Connecting…";
    for (let i = 0; i < 24 && typeof sb === "undefined"; i++) await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 24 && !sb; i++) await new Promise((r) => setTimeout(r, 250));
    if (!sb || typeof signIn !== "function") {
      btn.disabled = false; btn.textContent = was;
      alert("Sign-in isn't ready yet — give it a second and try again.");
      return;
    }
    try { await signIn(provider); } catch {}
    btn.disabled = false; btn.textContent = was;
  },

  enter() {
    try { sessionStorage.setItem(this.KEY, "1"); } catch {}
    clearInterval(this.tick);
    document.body.classList.remove("landing-on");
    if (this.el) {
      this.el.style.transition = "opacity .35s";
      this.el.style.opacity = "0";
      setTimeout(() => { this.el?.remove(); this.el = null; }, 380);
    }
    if (typeof afterLanding === "function") afterLanding();
  },
};

function initLanding() {
  // Either way afterLanding() gets called: immediately when the landing is
  // skipped, or from the ENTER button when it isn't.
  if (!Landing.mount()) afterLanding();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanding);
} else {
  initLanding();
}
