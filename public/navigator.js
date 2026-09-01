/* =====================================================================
   CHEETO NAVIGATOR 4.0 — the browser
   Netscape's chrome, and Netscape's honesty about failing.

   THE CONSTRAINT, stated plainly because it shapes everything here:
   a web page cannot force another site into an iframe. Sites send
   `X-Frame-Options: DENY` or a CSP `frame-ancestors` rule precisely to stop
   it, and the browser enforces that refusal — there is no flag, header or
   trick on our side that overrides it. Google, X, Reddit, Facebook and most
   banks all refuse. The only way around it is proxying pages through our own
   server, which breaks most modern sites anyway, costs bandwidth, strains the
   terms of service of everyone involved, and turns this domain into a host
   for arbitrary third-party content. Not worth it for a joke browser.

   So this does the honest thing: it tries, detects the refusal, and says so
   in a period-accurate error page with a button to open the site properly.
   In 1997 browsers failed constantly and told you about it. That's the bit.
   ===================================================================== */

const NAV_HOME = "cheeto:home";

/* Seeded directory. Everything here is a guess until it's tried — the browser
   reports what actually happened rather than pretending this list is truth. */
const NAV_LINKS = [
  { g: "Bookmarks", items: [
    { t: "This site", u: "https://supremecheeto.club/" },
    { t: "STAX AI", u: "https://staxai.app/" },
    { t: "Trades & Gains", u: "https://tradesandgains.io/" },
  ]},
  { g: "Things built to embed", items: [
    { t: "OpenStreetMap", u: "https://www.openstreetmap.org/export/embed.html?bbox=-125,24,-66,50&layer=mapnik" },
    { t: "TradingView chart", u: "https://s.tradingview.com/widgetembed/?symbol=SPY&theme=dark" },
    { t: "Internet Archive", u: "https://archive.org/" },
    { t: "Wikipedia", u: "https://en.wikipedia.org/wiki/Cheese_puffs" },
  ]},
  { g: "Sources this site uses", items: [
    { t: "Treasury: the debt", u: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny" },
    { t: "Federal Register: EOs", u: "https://www.federalregister.gov/presidential-documents/executive-orders" },
    { t: "AAA gas prices", u: "https://gasprices.aaa.com/" },
  ]},
];

const Nav = {
  frame: null, bar: null, status: null,
  history: [], pos: -1,
  timer: null, loading: false, current: NAV_HOME,

  init() {
    const root = document.getElementById("navRoot");
    if (!root) return;
    root.innerHTML = `
      <div class="nv-chrome">
        <div class="nv-row1">
          <button class="nv-b" id="nvBack"    title="Back">&#9664;</button>
          <button class="nv-b" id="nvFwd"     title="Forward">&#9654;</button>
          <button class="nv-b" id="nvStop"    title="Stop">&#10006;</button>
          <button class="nv-b" id="nvReload"  title="Reload">&#8635;</button>
          <button class="nv-b" id="nvHome"    title="Home">&#8962;</button>
          <div class="nv-throb" id="nvThrob" title="Cheeto Navigator"><img src="/logo.svg" alt="" width="26" height="26"></div>
        </div>
        <div class="nv-row2">
          <label for="nvUrl">Location:</label>
          <input type="text" id="nvUrl" spellcheck="false" autocomplete="off" value="${esc(NAV_HOME)}">
          <button class="b95 tiny" id="nvGo">Go</button>
        </div>
      </div>
      <div class="nv-notice" id="nvNotice" hidden></div>
      <div class="nv-view"><iframe id="nvFrame" title="Cheeto Navigator content"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"></iframe>
        <div class="nv-page" id="nvPage"></div>
      </div>
      <div class="nv-status" id="nvStatus">Document: Done</div>`;

    this.frame = document.getElementById("nvFrame");
    this.bar = document.getElementById("nvUrl");
    this.status = document.getElementById("nvStatus");

    document.getElementById("nvGo").addEventListener("click", () => this.go(this.bar.value));
    this.bar.addEventListener("keydown", (e) => { if (e.key === "Enter") this.go(this.bar.value); });
    document.getElementById("nvBack").addEventListener("click", () => this.step(-1));
    document.getElementById("nvFwd").addEventListener("click", () => this.step(1));
    document.getElementById("nvHome").addEventListener("click", () => this.go(NAV_HOME));
    document.getElementById("nvReload").addEventListener("click", () => this.go(this.current, true));
    document.getElementById("nvStop").addEventListener("click", () => this.stop());

    this.go(NAV_HOME);
  },

  normalise(raw) {
    let u = (raw || "").trim();
    if (!u) return null;
    if (u === NAV_HOME) return u;
    // A bare domain is a URL; anything with a space is a search we can't do,
    // so say so rather than silently sending it somewhere.
    // A URL never contains a space. Without this, "not a url at all" gets a
    // scheme bolted on and percent-encodes into something that "works".
    if (/\s/.test(u)) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
    try {
      const parsed = new URL(u);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      return parsed.href;
    } catch { return null; }
  },

  go(raw, force) {
    const url = this.normalise(raw);
    if (!url) { this.errorPage(raw, "bad-url"); return; }

    if (!force && url === this.current && this.pos >= 0) return;
    if (url !== this.history[this.pos]) {
      this.history = this.history.slice(0, this.pos + 1);
      this.history.push(url);
      this.pos = this.history.length - 1;
    }
    this.current = url;
    this.bar.value = url;
    this.render(url);
    this.syncButtons();
  },

  step(d) {
    const i = this.pos + d;
    if (i < 0 || i >= this.history.length) return;
    this.pos = i;
    this.current = this.history[i];
    this.bar.value = this.current;
    this.render(this.current);
    this.syncButtons();
  },

  syncButtons() {
    document.getElementById("nvBack").disabled = this.pos <= 0;
    document.getElementById("nvFwd").disabled = this.pos >= this.history.length - 1;
  },

  setLoading(on, msg) {
    this.loading = on;
    document.getElementById("nvThrob")?.classList.toggle("spin", on);
    this.status.textContent = msg || (on ? "Connecting…" : "Document: Done");
  },

  stop() {
    clearTimeout(this.timer);
    this.setLoading(false, "Transfer interrupted.");
  },

  render(url) {
    const page = document.getElementById("nvPage");
    clearTimeout(this.timer);

    const notice0 = document.getElementById("nvNotice");
    if (url === NAV_HOME) {
      if (notice0) notice0.hidden = true;
      this.frame.hidden = true; page.hidden = false;
      page.innerHTML = this.homeHTML();
      page.querySelectorAll("[data-nav]").forEach((a) =>
        a.addEventListener("click", (e) => { e.preventDefault(); this.go(a.dataset.nav); }));
      this.setLoading(false, "Document: Done");
      return;
    }

    page.hidden = true;
    this.frame.hidden = false;
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    this.setLoading(true, "Connecting to " + host + "…");

    /* Why there is no "this site refused" detection here:
       I tested a site that allows framing, one sending X-Frame-Options: DENY,
       and one sending CSP frame-ancestors 'none'. At the moment `load` fires,
       all three are IDENTICAL from JavaScript — same about:blank location, same
       zero child count, same accessible origin. The browser deliberately gives
       the embedding page no way to tell, because that information would itself
       be a cross-origin leak.

       So this does not guess. It shows the escape hatch permanently instead:
       every framed page carries a bar saying that a blank view means the site
       refused, with a button to open it properly. A guess that was wrong half
       the time would be worse than an honest standing notice. */
    const notice = document.getElementById("nvNotice");
    if (notice) {
      notice.hidden = false;
      notice.innerHTML = `<span>&#9432; If this stays blank, <b>${esc(host)}</b> refuses to be
        embedded &mdash; that's the site's choice and no browser setting changes it.</span>
        <a class="b95 tiny" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open in a real window</a>`;
    }

    let settled = false;
    const done = (ok) => {
      if (settled) return; settled = true;
      clearTimeout(this.timer);
      if (ok) this.setLoading(false, "Document: Done");
      else { this.frame.hidden = true; this.errorPage(url, "timeout"); }
    };
    this.frame.onload = () => done(true);
    this.frame.src = url;
    this.timer = setTimeout(() => done(false), 12000);
  },

  errorPage(url, why) {
    const page = document.getElementById("nvPage");
    const nb = document.getElementById("nvNotice");
    if (nb) nb.hidden = true;
    this.frame.hidden = true; page.hidden = false;
    this.setLoading(false, why === "bad-url" ? "Invalid address." : "No response from host.");

    const safe = esc(String(url || ""));
    const body = {
      "bad-url": `<p><b>${safe}</b> isn't an address I can open.</p>
        <p>Type a full web address, like <code>example.com</code>. This browser
        can't search &mdash; it only goes where you point it.</p>`,
      timeout: `<p><b>${safe}</b> did not respond.</p>
        <p class="nv-why">The site is slow, unreachable, or you're offline. If it's a
        site that simply refuses to be embedded, it usually loads a blank frame instead
        of timing out &mdash; a page can't tell the difference, so this window doesn't
        pretend to.</p>`,
    }[why] || `<p>Something went wrong loading <b>${safe}</b>.</p>`;

    page.innerHTML = `
      <div class="nv-err">
        <div class="nv-err-h"><span>&#9888;</span> Cheeto Navigator</div>
        ${body}
        <div class="nv-err-acts">
          ${why !== "bad-url" ? `<a class="b95" href="${safe}" target="_blank" rel="noopener noreferrer">Open in a real window</a>` : ""}
          <button class="b95" data-nav="${esc(NAV_HOME)}">Back to start page</button>
        </div>
      </div>`;
    page.querySelectorAll("[data-nav]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); this.go(a.dataset.nav); }));
  },

  homeHTML() {
    return `
      <div class="nv-home">
        <div class="nv-hero">
          <div class="nv-hero-t">CHEETO&nbsp;NAVIGATOR</div>
          <div class="nv-hero-s">Version 4.0 &middot; Best viewed at 800&times;600</div>
        </div>
        <p class="nv-intro">Type an address above and it will try. Some sites load;
        many refuse to be shown inside another page and you'll get an error &mdash;
        that refusal is the site's decision, not a fault here.</p>
        ${NAV_LINKS.map((g) => `
          <div class="nv-grp">${esc(g.g)}</div>
          <ul class="nv-list">${g.items.map((i) =>
            `<li><a href="${esc(i.u)}" data-nav="${esc(i.u)}">${esc(i.t)}</a>
             <span class="nv-u">${esc(i.u.replace(/^https?:\/\//, "").slice(0, 46))}</span></li>`).join("")}</ul>`).join("")}
        <div class="nv-foot">This page is under construction. It always will be.</div>
      </div>`;
  },
};

function initNavigator() {
  const w = document.getElementById("w-web");
  if (!w) return;
  let started = false;
  const start = () => { if (!started && !w.hidden) { started = true; Nav.init(); } };
  new MutationObserver(start).observe(w, { attributes: true, attributeFilter: ["hidden"] });
  start();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNavigator);
} else { initNavigator(); }
