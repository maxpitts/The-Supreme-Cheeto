/* =====================================================================
   WHO'S ONLINE — live visitor count, all-time record, and a hit counter
   Loads after chat.js and shares its Supabase client.

   The live number is real: every open tab joins a Supabase Realtime presence
   channel and the roster size IS the count. Nobody is estimated, nothing is
   simulated, and when the connection drops the panel says so rather than
   freezing on a stale figure and pretending.

   Accuracy notes, because a counter that lies is worse than no counter:
     - A backgrounded phone keeps its socket open for a while, so it would
       linger in everyone else's roster as a ghost. We untrack on hide and
       re-track on show, which is the single biggest source of over-counting.
     - If the socket is not actually open we report "not connected" instead of
       showing the last number we happened to see.
     - The record is written only when the current count EXCEEDS it. Everything
       else is a wasted round trip — with N people in the room, the old guard
       fired N writes on every join and leave and changed nothing.

   The all-time record can only ever be raised, never lowered, and implausible
   values are refused server-side. It's still a novelty counter on a joke site
   rather than an analytics source of truth, and the panel says as much.
   ===================================================================== */

const Live = {
  channel: null,
  count: 0,
  peak: null,
  peakAt: null,
  visitNo: null,
  connected: false,
  tracked: false,
  brokeRecord: false,      // only true if the record moved while you watched
  reportTimer: null,
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

  /* ---------------- presence ---------------- */
  join() {
    if (this.channel) return;
    // A random key per tab: two tabs from one person legitimately count as two
    // open windows, which is what a 90s "users online" counter always meant.
    const key = "v_" + Math.random().toString(36).slice(2, 11);

    this.channel = sb.channel("cheeto-online", { config: { presence: { key } } });

    const sync = () => {
      this.count = Object.keys(this.channel.presenceState() || {}).length;
      this.connected = true;
      this.lastSync = Date.now();
      this.paint();
      this.reportSoon();
      // The buddy list keys its online dots off this.
      document.dispatchEvent(new CustomEvent("cheeto:presence"));
    };

    this.channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          // Fires again after an automatic reconnect, which is what re-adds us
          // to the roster — without this a dropped socket removes you from
          // everyone else's count while you still see them.
          await this.trackSelf();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.connected = false;
          this.tracked = false;
          this.paint();
        }
      });
  },

  async trackSelf() {
    if (!this.channel) return;
    try {
      // The buddy list needs to know WHICH friends are on, so a signed-in tab
      // publishes its user id. Presence state is readable by everyone on the
      // channel, so this is genuinely public — which is exactly why Invisible
      // withholds it rather than merely hiding a dot in the interface.
      const invisible = typeof myProfile === "object" && myProfile?.aim_state === "invisible";
      const uid = (typeof me !== "undefined" && me && !invisible) ? me.id : null;
      await this.channel.track({ at: Date.now(), signed_in: Boolean(uid), uid });
      this.tracked = true;
    } catch {}
  },

  /* Which signed-in, non-invisible users are on the site right now. */
  onlineUids() {
    const out = new Set();
    if (!this.channel || !this.connected) return out;
    try {
      Object.values(this.channel.presenceState() || {}).forEach((arr) => {
        (arr || []).forEach((p) => { if (p?.uid) out.add(p.uid); });
      });
    } catch {}
    return out;
  },

  async untrackSelf() {
    if (!this.channel || !this.tracked) return;
    try { await this.channel.untrack(); this.tracked = false; } catch {}
  },

  /* A backgrounded tab keeps its socket alive long enough to sit in everyone
     else's roster as a phantom visitor. Leaving on hide and rejoining on show
     is what keeps the number honest. */
  watch() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.untrackSelf();
      else if (this.connected) this.trackSelf();
    });
    window.addEventListener("pagehide", () => { this.untrackSelf(); });

    // If the socket quietly dies, no status callback necessarily fires. Say
    // "not connected" rather than showing a number that stopped being true.
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      const sock = sb?.realtime?.isConnected?.();
      const alive = sock === undefined ? this.connected : sock;
      if (this.connected && !alive) { this.connected = false; this.paint(); }
    }, 15000);
  },

  /* Debounced, jittered, and only when it can actually change something.
     A busy room fires sync repeatedly and every client sees the same roster,
     so without the exceeds-check they all write the same no-op simultaneously. */
  reportSoon() {
    if (this.peak != null && this.count <= this.peak) return;
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(async () => {
      if (!sb || this.count <= 0) return;
      if (this.peak != null && this.count <= this.peak) return;
      try {
        const { data, error } = await sb.rpc("cheeto_report_online", { n: this.count });
        if (!error && data) {
          if (this.peak != null && data.peak_online > this.peak) this.brokeRecord = true;
          this.peak = data.peak_online; this.peakAt = data.peak_at;
          this.paint();
        }
      } catch {}
    }, 2500 + Math.random() * 2500);
  },

  /* ---------------- rendering ---------------- */
  paint() {
    const n = this.connected ? this.count : null;

    const tray = document.getElementById("trayOnline");
    if (tray) {
      tray.hidden = false;
      tray.innerHTML = n == null ? `&#128100; &mdash;` : `<span class="live-dot"></span>${n}`;
      tray.title = n == null
        ? "Live count unavailable — not connected"
        : `${n} ${n === 1 ? "person" : "people"} on the site right now`;
      tray.classList.toggle("busy", n != null && n >= 5);
    }

    const box = document.getElementById("liveBody");
    if (!box) return;

    if (n == null) {
      box.innerHTML = `<div class="note">Not connected to the live counter right now.
        The number will come back on its own when the connection does &mdash; it's
        deliberately blank rather than showing you the last number we saw.</div>
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

/* Presence carries whether the tab is signed in, so re-track on sign-in and
   sign-out to keep the roster honest. */
document.addEventListener("cheeto:auth", () => {
  if (Live.connected && Live.tracked) Live.trackSelf();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Live.init());
} else {
  Live.init();
}
