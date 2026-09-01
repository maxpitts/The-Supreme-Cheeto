/* =====================================================================
   WHO'S ONLINE — live visitor count, all-time record, and a hit counter
   Loads after chat.js and shares its Supabase client.

   The live number is real: every open tab joins a Supabase Realtime presence
   channel and the roster size IS the count. Nobody is estimated, nothing is
   simulated, and when the connection drops the panel says "offline" rather
   than freezing on a stale figure and pretending.

   The all-time record is stored server-side and can only ever be raised, never
   lowered, and implausible values are refused. It is still a novelty counter on
   a joke site rather than an analytics source of truth — the About text says as
   much — but nobody can quietly zero it or forge a direct write.
   ===================================================================== */

const Live = {
  channel: null,
  count: 0,
  peak: null,
  peakAt: null,
  visitNo: null,
  connected: false,
  reportTimer: null,
  lastReported: 0,

  async init() {
    // chat.js creates the client asynchronously. Wait for it briefly rather
    // than racing it, and give up quietly if it never appears.
    for (let i = 0; i < 40 && !sb; i++) await new Promise((r) => setTimeout(r, 250));
    if (!sb) { this.paint(); return; }

    // Count the visit once per tab, not once per reconnect.
    try {
      if (!sessionStorage.getItem("cheeto_counted")) {
        const { data, error } = await sb.rpc("cheeto_visit");
        if (!error && data) {
          this.visitNo = data.visit_no; this.peak = data.peak_online; this.peakAt = data.peak_at;
          sessionStorage.setItem("cheeto_counted", String(data.visit_no));
        }
      } else {
        this.visitNo = Number(sessionStorage.getItem("cheeto_counted")) || null;
        const { data } = await sb.from("cheeto_stats").select("peak_online, peak_at, total_visits").maybeSingle();
        if (data) { this.peak = data.peak_online; this.peakAt = data.peak_at; }
      }
    } catch {}

    this.join();
    this.paint();
  },

  join() {
    if (this.channel) return;
    // A random key per tab: two tabs from one person legitimately count as two
    // open windows, which is what a 90s "users online" counter always meant.
    const key = "v_" + Math.random().toString(36).slice(2, 11);

    this.channel = sb.channel("cheeto-online", { config: { presence: { key } } });

    const sync = () => {
      const state = this.channel.presenceState();
      this.count = Object.keys(state).length;
      this.connected = true;
      this.paint();
      this.reportSoon();
    };

    this.channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          await this.channel.track({ at: Date.now(), signed_in: Boolean(me) });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.connected = false;
          this.paint();
        }
      });
  },

  /* Debounced: a busy room fires sync repeatedly, and the record only needs
     the high-water mark, not every intermediate value. */
  reportSoon() {
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(async () => {
      if (!sb || this.count <= 0) return;
      if (this.count <= this.lastReported && this.peak != null && this.count <= this.peak) return;
      this.lastReported = this.count;
      try {
        const { data, error } = await sb.rpc("cheeto_report_online", { n: this.count });
        if (!error && data) { this.peak = data.peak_online; this.peakAt = data.peak_at; this.paint(); }
      } catch {}
    }, 3000);
  },

  /* ---------------- rendering ---------------- */
  paint() {
    const n = this.connected ? this.count : null;

    const tray = document.getElementById("trayOnline");
    if (tray) {
      tray.hidden = false;
      tray.innerHTML = n == null
        ? `&#128100; &mdash;`
        : `<span class="live-dot"></span>${n}`;
      tray.title = n == null
        ? "Live count unavailable — not connected"
        : `${n} ${n === 1 ? "person" : "people"} on the site right now`;
      tray.classList.toggle("busy", n != null && n >= 5);
    }

    const box = document.getElementById("liveBody");
    if (!box) return;

    if (n == null) {
      box.innerHTML = `<div class="note">Not connected to the live counter right now.
        The number will come back on its own when the connection does.</div>
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
      ${n >= 1 && this.peak != null && n >= this.peak && this.peak > 0
        ? `<div class="live-record">&#127881; That's a new record. You were here for it.</div>` : ""}
      ${this.counterHTML()}
      <p class="note">The live number is the actual count of open tabs connected to the
      site &mdash; it goes up and down as people arrive and leave, and it says so
      when the connection drops rather than showing you a stale figure. The record
      can only ever go up. It's a novelty counter, not analytics.</p>`;
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

/* Presence tracking carries whether the tab is signed in, so re-track on
   sign-in / sign-out to keep the roster honest. */
document.addEventListener("cheeto:auth", () => {
  if (Live.channel && Live.connected) {
    Live.channel.track({ at: Date.now(), signed_in: Boolean(me) }).catch(() => {});
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Live.init());
} else {
  Live.init();
}
