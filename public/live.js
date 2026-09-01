/* =====================================================================
   WHO'S ONLINE — live visitor count, all-time record, and a hit counter
   Loads after chat.js and shares its Supabase client.

   The live number is real: every open tab pings the database every 30 seconds
   and the count is the number of tabs that pinged in the last 75. Nobody is
   estimated, nothing is simulated, and when the pings stop landing the panel
   says so rather than freezing on a stale figure and pretending.

   This used to use Supabase Realtime Presence, which does not work on this
   project — see the note above join(). The rewrite is not a downgrade: the
   heartbeat is queryable, so the buddy list and the people directory can ask
   "who is online" directly instead of inferring it from a socket roster.

   Accuracy notes, because a counter that lies is worse than no counter:
     - A backgrounded phone is not a visitor. We stop pinging on hide and
       resume on show, which is the single biggest source of over-counting.
     - A closing tab sends one last keepalive request to remove itself, so the
       number drops immediately instead of at the end of the window.
     - If the pings stop landing we report "not connected" instead of showing
       the last number we happened to see.

   The all-time record can only ever be raised, never lowered, and implausible
   values are refused server-side. It's still a novelty counter on a joke site
   rather than an analytics source of truth, and the panel says as much.
   ===================================================================== */

const Live = {
  count: 0,
  peak: null,
  peakAt: null,
  visitNo: null,
  connected: false,
  tracked: false,
  brokeRecord: false,      // only true if the record moved while you watched
  timer: null,
  watchdog: null,
  lastSync: 0,

  async init() {
    // chat.js creates the client asynchronously. Wait for it briefly rather
    // than racing it, and give up quietly if it never appears.
    for (let i = 0; i < 40 && !sb; i++) await new Promise((r) => setTimeout(r, 250));
    if (!sb) { this.paint(); return; }

    await this.loadStats();
    this.join();
    this.watch();
    this.paint();
  },

  async loadStats() {
    // Count the visit once per tab, not once per reconnect or re-render.
    try {
      let counted = null;
      try { counted = sessionStorage.getItem("cheeto_counted"); } catch {}

      if (!counted) {
        const { data, error } = await sb.rpc("cheeto_visit");
        if (!error && data) {
          this.visitNo = data.visit_no; this.peak = data.peak_online; this.peakAt = data.peak_at;
          try { sessionStorage.setItem("cheeto_counted", String(data.visit_no)); } catch {}
        }
      } else {
        this.visitNo = Number(counted) || null;
        const { data } = await sb.from("cheeto_stats")
          .select("peak_online, peak_at, total_visits").maybeSingle();
        if (data) { this.peak = data.peak_online; this.peakAt = data.peak_at; }
      }
    } catch {}
  },

  /* ---------------- who's here ----------------
     Not Realtime Presence. Presence is broken on this project — a channel
     reports SUBSCRIBED, track() returns "ok", and presenceState() stays empty
     forever, on public and private channels alike. Because the failure is
     indistinguishable from success from the client's side, this counter showed
     nothing to anyone from launch until it was finally caught.

     A heartbeat has none of that ambiguity: the ping either returns a number
     or it throws. It costs one small request every 30 seconds per open tab. */

  KEY: "cheeto_tab",

  tabKey() {
    // Per tab, not per person: two windows are two visitors, which is what a
    // 90s "users online" counter always meant. sessionStorage is per-tab, so
    // this survives a refresh but not a new window — exactly right.
    try {
      let k = sessionStorage.getItem(this.KEY);
      if (!k) {
        k = "t" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        sessionStorage.setItem(this.KEY, k);
      }
      return k;
    } catch {
      // Private mode with storage blocked: fall back to a per-load key. The
      // count runs slightly high for these visitors rather than breaking.
      if (!this._k) this._k = "t" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      return this._k;
    }
  },

  join() {
    this.beat();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.beat(), 30000);
  },

  async beat() {
    // A hidden tab is not a visitor. Stop counting it rather than leaving a
    // phantom in everyone else's number.
    if (document.visibilityState === "hidden") return;
    if (!sb) return;
    try {
      const { data, error } = await sb.rpc("cheeto_heartbeat", { tab: this.tabKey() });
      if (error) throw error;
      this.count = Number(data?.online) || 0;
      if (data?.peak_online != null) {
        if (this.peak != null && data.peak_online > this.peak) {
          this.brokeRecord = true;
          Cheetip?.react?.("record", { n: data.peak_online });
        }
        this.peak = data.peak_online;
        this.peakAt = data.peak_at;
      }
      this.connected = true;
      this.tracked = true;
      this.lastSync = Date.now();
      this.paint();
      this.refreshUids();
    } catch {
      // One failed ping is a blip; a run of them means say so rather than
      // leaving a number on screen that stopped being true.
      if (Date.now() - this.lastSync > 95000) { this.connected = false; this.paint(); }
    }
  },

  /* Which signed-in users are on the site right now, for the buddy dots and
     the people directory. Cached between beats so nothing queries per-row. */
  _uids: new Set(),

  async refreshUids() {
    if (!sb) return;
    try {
      const { data, error } = await sb.rpc("cheeto_online_uids");
      if (error) throw error;
      this._uids = new Set(Array.isArray(data) ? data : []);
      document.dispatchEvent(new CustomEvent("cheeto:presence"));
    } catch {}
  },

  onlineUids() { return this._uids; },

  async untrackSelf() {
    this.tracked = false;
    if (!sb) return;
    try { await sb.rpc("cheeto_heartbeat_stop", { tab: this.tabKey() }); } catch {}
  },

  watch() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.untrackSelf();
      else this.beat();
    });
    /* A closing tab gets one last word so the count drops now rather than in
       seventy-five seconds. keepalive is what lets the request outlive the
       page; a plain fetch here is cancelled before it leaves. */
    window.addEventListener("pagehide", () => {
      try {
        const body = JSON.stringify({ tab: this.tabKey() });
        fetch(SB_URL + "/rest/v1/rpc/cheeto_heartbeat_stop", {
          method: "POST", keepalive: true,
          headers: { "content-type": "application/json", apikey: SB_KEY, authorization: "Bearer " + SB_KEY },
          body,
        });
      } catch {}
    });

    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.connected && Date.now() - this.lastSync > 95000) {
        this.connected = false;
        this.paint();
      }
    }, 15000);
  },

  /* reportSoon() is gone: cheeto_heartbeat maintains the record itself, in
     the same statement that counts the room. */

  /* ---------------- rendering ---------------- */
  paint() {
    const n = this.connected ? this.count : null;

    const tray = document.getElementById("trayOnline");
    if (tray) {
      tray.hidden = false;
      tray.innerHTML = n == null ? `&#128100; &mdash;` : `<span class="live-dot"></span>${n}`;
      tray.title = n != null
        ? `${n} ${n === 1 ? "person" : "people"} on the site right now`
        : (this.lastSync === 0 && document.visibilityState === "hidden"
            ? "This tab opened in the background, so it hasn't been counted yet"
            : "Live count unavailable — not connected");
      tray.classList.toggle("busy", n != null && n >= 5);
    }

    const box = document.getElementById("liveBody");
    if (!box) return;

    if (n == null) {
      /* Two different reasons for a blank number, and they deserve different
         sentences. A tab restored in the background has never pinged — that is
         the counter working as designed, not a fault, and telling someone
         "not connected" sends them looking for a problem that isn't there. */
      const napping = this.lastSync === 0 && document.visibilityState === "hidden";
      box.innerHTML = `<div class="note">${napping
        ? `This tab hasn't been counted yet &mdash; it opened in the background, and a
           tab nobody is looking at isn't a visitor. Click into it and the number appears.`
        : `Not connected to the live counter right now. The number will come back on its
           own when the connection does &mdash; it's deliberately blank rather than
           showing you the last number we saw.`}</div>
        ${this.counterHTML()}`;
      return;
    }

    box.innerHTML = `
      <div class="live-now">
        <div class="live-big"><span class="live-dot big"></span>${n}</div>
        <div class="live-cap">${n === 1 ? "person" : "people"} here right now</div>
      </div>
      <div class="live-rows">
        <div class="live-row"><span>All-time record</span>
          <b>${this.peak != null ? this.peak : "&mdash;"}</b></div>
        ${this.peakAt ? `<div class="live-row"><span>Set</span>
          <b>${esc(new Date(this.peakAt).toLocaleString())}</b></div>` : ""}
      </div>
      ${this.brokeRecord
        ? `<div class="live-record">&#127881; The record just broke while you were here.</div>` : ""}
      ${this.counterHTML()}
      <p class="note">This is a live count of open tabs connected to the site &mdash; it
      goes up and down as people arrive and leave. A tab you switch away from drops
      out until you come back, so nobody is counted twice for wandering off. The
      record only ever goes up. It's a novelty counter, not analytics.</p>`;
  },

  /* The obligatory GeoCities odometer. */
  counterHTML() {
    if (this.visitNo == null) return "";
    const digits = String(this.visitNo).padStart(6, "0").split("");
    return `<div class="hitc">
      <div class="hitc-lbl">YOU ARE VISITOR NUMBER</div>
      <div class="hitc-box">${digits.map((d) => `<span>${d}</span>`).join("")}</div>
    </div>`;
  },
};

/* The heartbeat carries who you are, so a sign-in or sign-out has to be
   reported immediately — otherwise your buddies' dots lag by up to 30 seconds
   behind you actually arriving. */
document.addEventListener("cheeto:auth", () => { Live.beat(); });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Live.init());
} else {
  Live.init();
}
