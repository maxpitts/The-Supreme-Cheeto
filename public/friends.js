/* =====================================================================
   BUDDY LIST — friends, away messages, statuses, Top 8, nudges
   MySpace and AIM, as far as a satirical debt tracker can reasonably go.
   Loads after chat.js and live.js; shares their client, session and presence.

   Every rule that matters lives in Postgres: you cannot accept a request that
   wasn't sent to you, read a non-friend's status, nudge a stranger, or put a
   non-friend in your Top 8. This file draws the database's answers. Someone
   skipping it and talking to PostgREST directly gets the same refusals — I
   tested each of those paths as a hostile third user.

   The sounds are SYNTHESISED here with the Web Audio API, not sampled. AOL's
   actual door and buzz recordings are their property; these are original tones
   that evoke them. It also means no audio files to download and it works
   offline in the PWA.
   ===================================================================== */

const Buddies = {
  list: [],
  reqs: [],
  feed: [],
  top8: [],
  loaded: 0,
  loading: false,
  wasOnline: new Set(),
  lastNudgeSeen: 0,
  nudgeChannel: null,
  tab: "buddies",

  /* ---------------- data ---------------- */
  async load(force) {
    if (!sb || !me) { this.paint(); return; }
    // A load requested while another is in flight used to return silently —
    // taking its repaint with it. Presence syncs trigger loads constantly, so
    // an accept landing during one would update the database and leave the
    // window showing the old state: "I clicked accept and nothing happened".
    if (this.loading) { this.again = true; return; }
    if (!force && Date.now() - this.loaded < 10000) { this.paint(); return; }
    this.loading = true;
    try {
      const [bl, rq, fd, t8] = await Promise.all([
        sb.rpc("cheeto_buddy_list"),
        sb.rpc("cheeto_friend_requests"),
        sb.rpc("cheeto_status_feed", { lim: 40 }),
        sb.rpc("cheeto_get_top8", { who: me.id }),
      ]);
      // These must be arrays or paint() throws "this.list.filter is not a
      // function" and takes the whole buddy list down. An RPC that errors, or
      // returns a scalar because something upstream changed, should degrade to
      // an empty list rather than a broken window.
      const arr = (r) => (!r || r.error || !Array.isArray(r.data)) ? [] : r.data;
      this.list = arr(bl);
      this.reqs = arr(rq);
      this.feed = arr(fd);
      this.top8 = arr(t8);
      this.loaded = Date.now();
      this.chime();
    } catch {}
    this.loading = false;
    if (this.again) { this.again = false; return this.load(true); }
    this.paint();
  },

  online() { return (typeof Live === "object" && Live.onlineUids) ? Live.onlineUids() : new Set(); },

  isOn(id) { return this.online().has(id); },

  /* Door open when a buddy arrives, door close when they go. Only after the
     first roster is known, or signing in would slam every door at once. */
  chime() {
    const on = this.online();
    if (this.wasOnline.size || this.loaded) {
      this.list.forEach((b) => {
        const now = on.has(b.id), before = this.wasOnline.has(b.id);
        if (now && !before) Snd.doorOpen();
        else if (!now && before) Snd.doorShut();
      });
    }
    this.wasOnline = new Set(this.list.filter((b) => on.has(b.id)).map((b) => b.id));
  },

  /* ---------------- rendering ---------------- */
  paint() {
    const box = $("#buddyBody");
    if (!box) return;

    if (!me) {
      box.innerHTML = `<div class="bl-out">
        <b>Sign in to build a buddy list.</b>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="b95 tiny" data-bl-in="google">Google</button>
          <button class="b95 tiny" data-bl-in="discord">Discord</button>
        </div>
        <div class="note" style="margin-top:7px">Statuses are visible to friends only,
        so there's nothing to show until you have some.</div>
      </div>`;
      box.querySelectorAll("[data-bl-in]").forEach((b) =>
        b.addEventListener("click", () => signIn(b.dataset.blIn)));
      return;
    }

    const on = this.online();
    const online = this.list.filter((b) => on.has(b.id));
    const offline = this.list.filter((b) => !on.has(b.id));
    const incoming = this.reqs.filter((r) => r.direction === "incoming");

    box.innerHTML = `
      ${this.awayHTML()}
      <div class="bl-tabs">
        ${[["buddies", `Buddies (${this.list.length})`], ["feed", "Statuses"],
           ["reqs", `Requests${incoming.length ? " (" + incoming.length + ")" : ""}`],
           ["top8", "Top 8"], ["find", "Add"]]
          .map(([k, l]) => `<button class="bl-tab${this.tab === k ? " on" : ""}" data-tab="${k}">${esc(l)}</button>`).join("")}
      </div>
      <div class="bl-pane">${
        this.tab === "buddies" ? this.buddiesHTML(online, offline)
        : this.tab === "feed" ? this.feedHTML()
        : this.tab === "reqs" ? this.reqsHTML()
        : this.tab === "top8" ? this.top8HTML()
        : this.findHTML()}</div>`;

    this.wire();
  },

  awayHTML() {
    const st = myProfile?.aim_state || "available";
    const txt = myProfile?.aim_text || "";
    return `<div class="bl-me">
      <div class="bl-me-top">
        <span class="dot ${esc(st)}"></span>
        <b>${esc(myProfile?.display_name || myProfile?.handle || "you")}</b>
        <select id="blState" aria-label="Your status">
          ${["available", "away", "busy", "invisible"].map((s) =>
            `<option value="${s}"${s === st ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}
        </select>
      </div>
      <input type="text" id="blAway" maxlength="140" placeholder="Away message…" value="${esc(txt)}">
      ${st === "invisible" ? `<div class="note" style="margin-top:4px">Invisible: you're hidden
        from the buddy list and from the live visitor count. Genuinely hidden, not just dimmed.</div>` : ""}
    </div>`;
  },

  buddyRow(b, isOn) {
    const state = isOn ? (b.aim_state === "offline" ? "available" : b.aim_state || "available") : "offline";
    return `<div class="bl-row">
      <span class="dot ${esc(state)}"></span>
      ${b.avatar_url ? `<img class="bl-av" src="${esc(b.avatar_url)}" alt="" width="18" height="18" loading="lazy">` : ""}
      <span class="bl-name" data-open-user="${esc(b.id)}" title="View profile">${esc(b.display_name || b.handle)}</span>
      ${isOn ? `<button class="bl-mini" data-nudge="${esc(b.id)}" title="Nudge">&#9889;</button>` : ""}
      <button class="bl-mini" data-drop="${esc(b.id)}" data-name="${esc(b.display_name || b.handle)}" title="Remove friend">&times;</button>
      ${b.aim_text && isOn ? `<div class="bl-away">${esc(b.aim_text)}</div>` : ""}
      ${b.status_body ? `<div class="bl-st">&ldquo;${esc(b.status_body)}&rdquo;</div>` : ""}
    </div>`;
  },

  buddiesHTML(online, offline) {
    if (!this.list.length) return `<div class="note">No buddies yet. Use <b>Add</b> to find people
      by handle &mdash; statuses only show up once someone accepts.</div>`;
    return `
      <div class="bl-grp">Online &mdash; ${online.length}</div>
      ${online.length ? online.map((b) => this.buddyRow(b, true)).join("")
        : `<div class="note" style="padding:4px 6px">Nobody's on right now.</div>`}
      <div class="bl-grp">Offline &mdash; ${offline.length}</div>
      ${offline.map((b) => this.buddyRow(b, false)).join("")}`;
  },

  feedHTML() {
    return `
      <div class="bl-post">
        <input type="text" id="stBody" maxlength="280" placeholder="What are you up to?">
        <button class="b95 tiny" id="stGo">Post</button>
      </div>
      ${this.feed.length ? this.feed.map((s) => `
        <div class="bl-fs${s.mine ? " mine" : ""}">
          <div class="bl-fs-top">
            ${s.avatar_url ? `<img class="bl-av" src="${esc(s.avatar_url)}" alt="" width="16" height="16" loading="lazy">` : ""}
            <b>${esc(s.display_name || s.handle)}</b>
            <span class="bl-fs-t">${esc(ago(Date.now() - Date.parse(s.created_at)))} ago</span>
            ${s.mine ? `<button class="bl-mini" data-delst="${s.id}" title="Delete">&times;</button>` : ""}
          </div>
          <div class="bl-fs-b">${esc(s.body)}</div>
        </div>`).join("")
        : `<div class="note">No statuses yet &mdash; yours or your friends'.</div>`}`;
  },

  reqsHTML() {
    if (!this.reqs.length) return `<div class="note">No pending requests.</div>`;
    return this.reqs.map((r) => `
      <div class="bl-req">
        ${r.avatar_url ? `<img class="bl-av" src="${esc(r.avatar_url)}" alt="" width="18" height="18" loading="lazy">` : ""}
        <span class="bl-name" data-open-user="${esc(r.handle || "")}" title="View profile">${esc(r.display_name || r.handle)}</span>
        ${r.direction === "incoming"
          ? `<button class="b95 tiny" data-acc="${r.id}">Accept</button>
             <button class="b95 tiny" data-dec="${r.id}">Decline</button>`
          : `<span class="bl-pend">request sent</span>`}
      </div>`).join("");
  },

  top8HTML() {
    const inTop = new Set(this.top8.map((t) => t.id));
    const rest = this.list.filter((b) => !inTop.has(b.id));
    return `
      <div class="note" style="margin-bottom:7px">Your Top 8 is <b>public</b> &mdash; anyone can
      see who you ranked and in what order. That was the entire point, and the entire problem.</div>
      <div class="t8">
        ${Array.from({ length: 8 }, (_, i) => {
          const t = this.top8[i];
          return `<div class="t8-slot${t ? "" : " empty"}">
            <div class="t8-n">${i + 1}</div>
            ${t ? `${t.avatar_url ? `<img src="${esc(t.avatar_url)}" alt="" width="26" height="26" loading="lazy">` : `<div class="t8-ph">&#128100;</div>`}
                   <div class="t8-name">${esc(t.display_name || t.handle)}</div>
                   <button class="bl-mini" data-t8out="${esc(t.id)}" title="Remove">&times;</button>`
                : `<div class="t8-ph">&mdash;</div>`}
          </div>`;
        }).join("")}
      </div>
      ${this.top8.length ? `<div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="b95 tiny" id="t8Up">Promote last</button>
        <button class="b95 tiny" id="t8Clear">Clear all</button></div>` : ""}
      <div class="bl-grp" style="margin-top:9px">Add from your buddies</div>
      ${rest.length ? rest.map((b) => `
        <div class="bl-row">
          <span class="dot ${this.isOn(b.id) ? "available" : "offline"}"></span>
          <span class="bl-name" data-open-user="${esc(b.id)}" title="View profile">${esc(b.display_name || b.handle)}</span>
          <button class="bl-mini" data-t8in="${esc(b.id)}" title="Add to Top 8"
            ${this.top8.length >= 8 ? "disabled" : ""}>+</button>
        </div>`).join("")
        : `<div class="note">${this.list.length ? "Everyone's already in it." : "Add some friends first."}</div>`}`;
  },

  findHTML() {
    return `
      <div class="bl-post">
        <input type="text" id="blFind" maxlength="40" placeholder="Search by handle or name…" autocomplete="off">
        <button class="b95 tiny" id="blFindGo">Find</button>
      </div>
      <div id="blFindOut"><div class="note">Type at least two characters.</div></div>`;
  },

  /* ---------------- interaction ---------------- */
  wire() {
    const box = $("#buddyBody");
    if (!box) return;

    box.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => { this.tab = b.dataset.tab; this.paint(); }));

    $("#blState")?.addEventListener("change", () => this.saveAway());
    $("#blAway")?.addEventListener("change", () => this.saveAway());

    box.querySelectorAll("[data-acc]").forEach((b) =>
      b.addEventListener("click", () => this.respond(+b.dataset.acc, true)));
    box.querySelectorAll("[data-dec]").forEach((b) =>
      b.addEventListener("click", () => this.respond(+b.dataset.dec, false)));
    box.querySelectorAll("[data-nudge]").forEach((b) =>
      b.addEventListener("click", () => this.nudge(b.dataset.nudge)));
    box.querySelectorAll("[data-drop]").forEach((b) =>
      b.addEventListener("click", () => this.drop(b.dataset.drop, b.dataset.name)));
    box.querySelectorAll("[data-delst]").forEach((b) =>
      b.addEventListener("click", () => this.delStatus(+b.dataset.delst)));

    box.querySelectorAll("[data-t8in]").forEach((b) =>
      b.addEventListener("click", () => this.setTop8([...this.top8.map((t) => t.id), b.dataset.t8in])));
    box.querySelectorAll("[data-t8out]").forEach((b) =>
      b.addEventListener("click", () => this.setTop8(this.top8.map((t) => t.id).filter((i) => i !== b.dataset.t8out))));
    $("#t8Clear")?.addEventListener("click", () => this.setTop8([]));
    $("#t8Up")?.addEventListener("click", () => {
      const ids = this.top8.map((t) => t.id);
      if (ids.length > 1) ids.unshift(ids.pop());
      this.setTop8(ids);
    });

    const post = () => this.postStatus();
    $("#stGo")?.addEventListener("click", post);
    $("#stBody")?.addEventListener("keydown", (e) => { if (e.key === "Enter") post(); });

    const find = () => this.find();
    $("#blFindGo")?.addEventListener("click", find);
    $("#blFind")?.addEventListener("keydown", (e) => { if (e.key === "Enter") find(); });
  },

  async rpc(fn, args, okMsg) {
    try {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw error;
      if (data && data.ok === false) {
        showModal("Not allowed", "&#9888;", esc(data.error || "The database refused that."));
        return null;
      }
      if (okMsg) Cheetip?.say?.(okMsg, 5000);
      return data;
    } catch (err) {
      showModal("Didn't work", "&#9888;",
        `<span style="font-size:11px;color:#555">${esc(err?.message || "unknown error")}</span>`);
      return null;
    }
  },

  async saveAway() {
    const state = $("#blState")?.value || "available";
    const msg = $("#blAway")?.value || "";
    const r = await this.rpc("cheeto_set_away", { state, msg });
    if (!r) return;
    if (myProfile) { myProfile.aim_state = state; myProfile.aim_text = msg || null; }
    // Invisible has to actually leave the presence roster, not just look away.
    // Invisible changes what the heartbeat publishes about you, so push it now.
    if (typeof Live === "object" && Live.beat) Live.beat();
    Cheetip?.react?.("away", { state });
    this.load(true);
  },

  async respond(id, accept) {
    const who = this.reqs.find((x) => x.id === id);
    const r = await this.rpc("cheeto_friend_respond", { req_id: id, accept });
    if (!r) return;

    // The database has already said yes. Reflect that immediately rather than
    // depending on a refetch that can be skipped, slow, or fail — the same
    // mistake that made a sent chat message look like it hadn't sent.
    this.reqs = this.reqs.filter((x) => x.id !== id);
    if (accept && who) {
      if (!this.list.some((b) => b.id === who.other_id)) {
        this.list.push({
          id: who.other_id, handle: who.handle, display_name: who.display_name,
          avatar_url: who.avatar_url, aim_state: "available", aim_text: null,
          status_body: null, status_at: null, friends_since: new Date().toISOString(),
        });
      }
      Snd.doorOpen();
      Cheetip?.react?.("friend", { name: who.display_name || who.handle });
      this.tab = "buddies";          // show them the thing that just happened
    }
    this.paint();
    this.loaded = 0;                 // and reconcile with the server
    this.load(true);
  },

  async request(target) {
    const r = await this.rpc("cheeto_friend_request", { target });
    if (r) {
      showModal(r.state === "accepted" ? "You're friends" : "Request sent", "&#128100;",
        r.state === "accepted"
          ? "They'd already asked you, so that's a yes from both sides."
          : "They'll see it in their buddy list. Statuses unlock once they accept.");
      this.load(true); this.find();
    }
  },

  async drop(id, name) {
    showModal("Remove friend?", "&#9888;",
      `Remove <b>${esc(name || "them")}</b>? You'll both stop seeing each other's statuses,
       and they'll drop out of your Top 8.<br><br>
       <button class="b95" id="blDrop2">Remove</button>`);
    setTimeout(() => $("#blDrop2")?.addEventListener("click", async () => {
      $("#modal").hidden = true;
      const r = await this.rpc("cheeto_friend_remove", { other: id });
      if (r) this.load(true);
    }), 0);
  },

  async nudge(id) {
    const r = await this.rpc("cheeto_nudge", { target: id });
    if (r) { Snd.buzz(); Cheetip?.say?.("Nudge sent. They'll feel that.", 4500); }
  },

  async setTop8(ids) {
    const r = await this.rpc("cheeto_set_top8", { ids: ids.slice(0, 8) });
    if (r) this.load(true);
  },

  async postStatus() {
    const el = $("#stBody");
    const body = (el?.value || "").trim();
    if (!body) return;
    try {
      const { error } = await sb.from("cheeto_statuses").insert({ user_id: me.id, body });
      if (error) throw error;
      el.value = "";
      this.load(true);
    } catch (err) {
      showModal("Status not posted", "&#9888;",
        `<span style="font-size:11px;color:#555">${esc(err?.message || "")}</span><br><br>
         Usually that means your account is too new, or you're rate limited.`);
    }
  },

  async delStatus(id) {
    try {
      await sb.from("cheeto_statuses").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      this.load(true);
    } catch {}
  },

  async find() {
    const q = ($("#blFind")?.value || "").trim();
    const out = $("#blFindOut");
    if (!out) return;
    if (q.length < 2) { out.innerHTML = `<div class="note">Type at least two characters.</div>`; return; }
    out.innerHTML = `<div class="note">Searching&hellip;</div>`;
    try {
      const { data, error } = await sb.rpc("cheeto_find_users", { q });
      if (error) throw error;
      const rows = data || [];
      out.innerHTML = rows.length ? rows.map((u) => `
        <div class="bl-row">
          ${u.avatar_url ? `<img class="bl-av" src="${esc(u.avatar_url)}" alt="" width="18" height="18" loading="lazy">` : ""}
          <span class="bl-name" data-open-user="${esc(u.id)}" title="View profile">${esc(u.display_name || u.handle)}</span>
          ${u.rel === "none" ? `<button class="b95 tiny" data-add="${esc(u.id)}">Add</button>`
            : `<span class="bl-pend">${esc({ you: "that's you", friends: "friends", sent: "request sent", incoming: "wants to add you" }[u.rel] || u.rel)}</span>`}
        </div>`).join("")
        : `<div class="note">Nobody found.</div>`;
      out.querySelectorAll("[data-add]").forEach((b) =>
        b.addEventListener("click", () => this.request(b.dataset.add)));
    } catch (err) {
      out.innerHTML = `<div class="note" style="color:#900">Search failed. ${esc(err?.message || "")}</div>`;
    }
  },

  /* ---------------- incoming nudges ---------------- */
  watchNudges() {
    if (!sb || !me || this.nudgeChannel) return;
    this.nudgeChannel = sb.channel("cheeto-nudge-" + me.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "cheeto_nudges", filter: `to_user=eq.${me.id}` },
        async (payload) => {
          const from = this.list.find((b) => b.id === payload.new?.from_user);
          Snd.buzz();
          document.body.classList.add("buzzing");
          setTimeout(() => document.body.classList.remove("buzzing"), 900);
          Cheetip?.react?.("nudge", { from: from ? (from.display_name || from.handle) : null });
        })
      .subscribe();
  },
};

/* =====================================================================
   SOUNDS — synthesised, not sampled.
   AOL's actual recordings are their property. These are original tones built
   from oscillators and filtered noise that land in the same emotional place.
   Off by default: nobody wants a website making noise unasked.
   ===================================================================== */
const Snd = {
  KEY: "cheeto_sound_on",
  ctx: null,

  on() { try { return localStorage.getItem(this.KEY) === "1"; } catch { return false; } },
  setOn(v) {
    try { v ? localStorage.setItem(this.KEY, "1") : localStorage.removeItem(this.KEY); } catch {}
    const it = document.getElementById("soundItem");
    if (it) it.querySelector(".lbl").textContent = v ? "Buddy sounds: on" : "Buddy sounds: off";
    if (v) this.doorOpen();
  },

  ac() {
    if (!this.on()) return null;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      // Browsers suspend audio until a gesture; resume is a no-op if running.
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  },

  /* A creak: a swept low tone with a touch of noise, opening upward. */
  doorOpen() { this.creak(180, 420, 0.34); },
  /* And closing: the same shape, downward, shorter and blunter. */
  doorShut() { this.creak(400, 140, 0.26); },

  creak(f0, f1, dur) {
    const ac = this.ac(); if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    lp.type = "lowpass"; lp.frequency.setValueAtTime(1100, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* The buzz: two short square-wave bursts, deliberately annoying. */
  buzz() {
    const ac = this.ac(); if (!ac) return;
    [0, 0.19].forEach((off) => {
      const t = ac.currentTime + off;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.setValueAtTime(110, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.16);
    });
  },
};

/* ---------------- wiring ---------------- */
document.addEventListener("cheeto:auth", () => {
  Buddies.loaded = 0;
  Buddies.load(true);
  Buddies.watchNudges();
});
document.addEventListener("cheeto:presence", () => {
  if (!document.getElementById("w-buddies")?.hidden) { Buddies.chime(); Buddies.paint(); }
});

function initBuddies() {
  // The Start-menu item is built by app.js with a fixed label; sync it to what
  // the setting actually is, or it reads "off" to someone who turned it on.
  const it = document.getElementById("soundItem");
  if (it) it.querySelector(".lbl").textContent = Snd.on() ? "Buddy sounds: on" : "Buddy sounds: off";

  const w = document.getElementById("w-buddies");
  if (w) {
    new MutationObserver(() => { if (!w.hidden) Buddies.load(); })
      .observe(w, { attributes: true, attributeFilter: ["hidden"] });
    if (!w.hidden) Buddies.load();
  }
  Buddies.paint();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBuddies);
} else { initBuddies(); }
