/* =====================================================================
   SUPREME.EXE — the site's own joke coin, tracked like any other number.

   The editorial posture here is deliberate and it is the whole point of the
   file. Every other window on this desktop tracks something absurd from a
   public source and lets the framing carry the joke. This one does exactly
   the same thing to a token that happens to be ours, which means:

     - the price is read live from Dexscreener's public API, same as the debt
       comes from Treasury. Nothing here is asserted by us.
     - the window never says buy, never says soon, never says utility, and
       never implies the coin is backed by, funded by, or entitled to
       anything on this site. It isn't.
     - the running commentary makes fun of the coin. A site that roasts its
       own token is both funnier and safer than one that shills it, and the
       roast is computed from real numbers rather than written by hand.

   If a future edit adds a price target, a roadmap, a holder benefit worth
   money, or the words "to the moon" in earnest, it has broken the thing
   this file exists to protect. Don't.
   ===================================================================== */

const Supreme = {
  /* ---- the one line to change at launch --------------------------------
     Paste the pump.fun mint address between the quotes and everything else
     in this file wakes up. Left empty on purpose so the window ships in its
     honest pre-launch state rather than pointing at a coin that isn't real
     yet. */
  MINT: "",

  TICKER: "SUPREME",
  ACK_KEY: "cheeto_supreme_ack",
  API: "https://api.dexscreener.com/latest/dex/tokens/",

  data: null,        // best pair we've seen, or null
  err: null,
  everLoaded: false,
  timer: null,

  /* ---------------------------------------------------------- lifecycle */
  init() {
    document.addEventListener("click", (ev) => {
      const el = ev.target.closest?.("[data-open-supreme]");
      if (!el) return;
      ev.preventDefault(); ev.stopPropagation();
      this.open();
    });
  },

  /* Two ways in — a desktop icon (which calls WM.open directly) and the Start
     menu. Everything past the window appearing lives in boot(), and WM.open
     calls it, so neither route can skip the disclaimer. open() must therefore
     do nothing but open the window, or boot runs twice. */
  open() {
    WM.open("w-supreme");
  },

  async boot() {
    this.render();
    this.disclaimerOnce();
    this.startPolling();
    await this.load();
  },

  /* The dialog is shown once per browser and the banner in the window is
     permanent, so dismissing this never removes the disclosure — it only
     stops it interrupting. If localStorage is unavailable the dialog simply
     shows every time, which is the failure direction we want. */
  disclaimerOnce() {
    let seen = false;
    try { seen = localStorage.getItem(this.ACK_KEY) === "1"; } catch {}
    if (seen) return;
    try { localStorage.setItem(this.ACK_KEY, "1"); } catch {}
    showModal("Read this first", "&#9888;", `
      <b>This is a joke coin.</b><br><br>
      It is not an investment. It does not fund this website. This website is
      free, and stays free, whether or not you own a single one.<br><br>
      Nobody here can make it go up, and nobody here is going to try.
      Fewer than 2% of coins launched this way ever leave the bonding curve.
      This one probably won't either.<br><br>
      <span style="color:#555;font-size:11px">If you buy it, buy it because the
      joke was worth a few dollars to you. There is no other reason, and anyone
      telling you otherwise &mdash; here or anywhere &mdash; is selling
      something.</span>`);
  },

  startPolling() {
    clearInterval(this.timer);
    // Only while the window is open. A token chart nobody is looking at is
    // not worth a request every thirty seconds.
    this.timer = setInterval(() => {
      if (document.getElementById("w-supreme")?.hidden) { clearInterval(this.timer); return; }
      this.load();
    }, 30000);
  },

  async load() {
    if (!this.MINT) { this.everLoaded = true; this.render(); return; }
    try {
      const res = await fetch(this.API + encodeURIComponent(this.MINT), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
      // Deepest liquidity wins. A token can show up in several pools and the
      // thin ones carry nonsense prices.
      this.data = pairs.sort((a, b) =>
        (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0] || null;
      this.err = null;
    } catch (e) {
      // Keep the last good reading rather than blanking the window, and say
      // that's what we're doing. Same rule as every other tracker here.
      this.err = String(e?.message || e);
    }
    this.everLoaded = true;
    this.render();
  },

  /* ------------------------------------------------------------ helpers */
  usd(n) {
    if (!isFinite(n)) return "—";
    if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    // Sub-dollar prices need real precision or every joke coin reads $0.00.
    return "$" + n.toFixed(n < 0.000001 ? 10 : n < 0.01 ? 8 : 4);
  },

  big(n) {
    if (!isFinite(n)) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + n.toFixed(0);
  },

  /* The roast. Every line is computed from a real number — the coin's own
     market cap against the national debt this site already tracks — so the
     joke stays inside the house rule: real data, framing does the work. */
  roast(mcap) {
    /* D is a top-level `let` in app.js, so it is a lexical global and NOT a
       property of window — reading window.D returns undefined and silently
       kills the roast. Reach it by name, guarded in case load order changes. */
    const per = typeof D === "object" && D ? Number(D?.debt?.perSecond) : NaN;
    if (!isFinite(mcap) || mcap <= 0 || !isFinite(per) || per <= 0) return "";
    const secs = mcap / per;
    let howLong;
    if (secs < 1) howLong = `${secs.toFixed(2)} seconds`;
    else if (secs < 90) howLong = `${secs.toFixed(1)} seconds`;
    else if (secs < 5400) howLong = `${(secs / 60).toFixed(1)} minutes`;
    else howLong = `${(secs / 3600).toFixed(1)} hours`;
    return `Every $SUPREME in existence, added together, is worth
            <b>${howLong}</b> of new national debt.`;
  },

  /* ------------------------------------------------------------- render */
  render() {
    const box = document.getElementById("supremeBody");
    if (!box) return;
    box.innerHTML = this.bannerHTML() + this.stateHTML();
    WM.fit?.("w-supreme");
  },

  /* Permanent, not dismissible, first thing in the window. */
  bannerHTML() {
    return `<div class="sp-banner">THE SUPREME CHEETO DOES NOT ENDORSE THIS COIN</div>`;
  },

  stateHTML() {
    if (!this.MINT) {
      return `<div class="sp-pre">
        <div class="sp-glyph">:(</div>
        <b>Not launched.</b>
        <p class="note">There is no $SUPREME contract yet. If you find a coin
        calling itself $SUPREME right now, it is not this one and it is not
        ours &mdash; this window will show the real address the moment there
        is one to show.</p>
      </div>`;
    }

    if (!this.everLoaded) return `<div class="note sp-pad">Loading&hellip;</div>`;

    const addr = `<div class="sp-addr">
        <span class="sp-lbl">Contract</span>
        <code id="spMint">${esc(this.MINT)}</code>
        <button class="b95 tiny" id="spCopy" type="button">Copy</button>
      </div>`;

    if (!this.data) {
      return `<div class="sp-pre">
          <div class="sp-glyph">&#8987;</div>
          <b>No trading pair yet.</b>
          <p class="note">${this.err
            ? `Couldn't reach the price source just now &mdash; showing nothing
               rather than guessing. <span class="sp-err">${esc(this.err)}</span>`
            : `Still on the bonding curve, or too new for the price feed to have
               noticed. Either way there is no market to report.`}</p>
        </div>${addr}`;
    }

    const d = this.data;
    const price = parseFloat(d.priceUsd);
    const mcap = Number(d.marketCap ?? d.fdv);
    const ch = Number(d?.priceChange?.h24);
    const liq = Number(d?.liquidity?.usd);
    const vol = Number(d?.volume?.h24);
    const dir = !isFinite(ch) ? "" : ch > 0 ? " up" : ch < 0 ? " down" : "";

    return `
      <div class="sp-grid">
        <div class="sp-cell"><span class="sp-lbl">Price</span>
          <b class="sp-v">${esc(this.usd(price))}</b></div>
        <div class="sp-cell"><span class="sp-lbl">Market cap</span>
          <b class="sp-v">${esc(this.big(mcap))}</b></div>
        <div class="sp-cell"><span class="sp-lbl">24h</span>
          <b class="sp-v${dir}">${isFinite(ch) ? (ch > 0 ? "+" : "") + ch.toFixed(1) + "%" : "—"}</b></div>
        <div class="sp-cell"><span class="sp-lbl">Liquidity</span>
          <b class="sp-v">${esc(this.big(liq))}</b></div>
        <div class="sp-cell"><span class="sp-lbl">24h volume</span>
          <b class="sp-v">${esc(this.big(vol))}</b></div>
        <div class="sp-cell"><span class="sp-lbl">Source</span>
          <b class="sp-v sp-small">${esc(d.dexId || "dexscreener")}</b></div>
      </div>

      ${this.roast(mcap) ? `<p class="sp-roast">${this.roast(mcap)}</p>` : ""}

      ${addr}

      <p class="note sp-foot">Price read live from Dexscreener's public API.
        Not our number, not our claim, and not a recommendation.
        ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">Chart</a>` : ""}
      </p>
      ${this.err ? `<p class="note sp-err">Last refresh failed (${esc(this.err)}) &mdash;
        showing the previous reading.</p>` : ""}`;
  },

  wireCopy() {
    document.getElementById("spCopy")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.MINT);
        const b = document.getElementById("spCopy");
        if (b) { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1400); }
      } catch {
        showModal("Couldn't copy", "&#9888;",
          `Your browser wouldn't let the page use the clipboard. The address is
           in the window &mdash; select it and copy it by hand.`);
      }
    });
  },
};

/* render() rebuilds the panel, so the copy button has to be re-wired after
   every paint rather than once at startup. Wrapping render keeps that pairing
   impossible to forget. */
const _supremeRender = Supreme.render.bind(Supreme);
Supreme.render = function () { _supremeRender(); this.wireCopy(); };

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Supreme.init());
} else {
  Supreme.init();
}
