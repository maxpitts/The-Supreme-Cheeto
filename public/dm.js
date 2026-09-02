/* =====================================================================
   INSTANT MESSAGES

   Friends only, and that is enforced in Postgres — an RLS policy on the table
   plus the check inside cheeto_dm_send, so someone talking to PostgREST
   directly gets refused exactly the same way someone using this window does.
   This file draws the database's answers; it is not a security boundary.

   One window with a list and a thread, rather than AIM's window-per-buddy.
   Tempting, and more period-accurate, but a phone cannot show six overlapping
   windows and the whole site has to work on one.

   Polling, not realtime. Realtime Presence on this project was proven broken
   earlier — channels subscribed and then delivered nothing — and a chat that
   silently stops arriving is worse than one that takes a few seconds. Ten
   seconds while the window is open, on focus, and nothing at all while it is
   closed except the unread count the taskbar already asks for.
   ===================================================================== */

const DM = {
  threads: [],
  open_with: null,      // uuid of the person whose thread is showing, or null
  msgs: [],
  timer: null,
  loading: false,
  unread: 0,
  sending: false,
  everLoaded: false,

  /* ---------------------------------------------------------- lifecycle */
  init() {
    document.getElementById("trayIm")?.addEventListener("click", () => this.open());
    document.addEventListener("cheeto:auth", () => {
      this.threads = []; this.msgs = []; this.open_with = null;
      this.unread = 0; this.paintBadge(); this.pollUnread();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.pollUnread();
    });
    // Anywhere a person is named, there is now a way to message them.
    document.addEventListener("click", (ev) => {
      const el = ev.target.closest?.("[data-im-user]");
      if (!el) return;
      ev.preventDefault(); ev.stopPropagation();
      this.open(el.dataset.imUser);
    });
    clearInterval(this.unreadTimer);
    this.unreadTimer = setInterval(() => this.pollUnread(), 45000);
    this.pollUnread();
  },

  async pollUnread() {
    if (!sb || !me) { this.unread = 0; this.paintBadge(); return; }
    try {
      const { data, error } = await sb.rpc("cheeto_dm_unread");
      if (error) throw error;
      const n = Number(data) || 0;
      const grew = n > this.unread;
      this.unread = n;
      this.paintBadge();
      // A message arriving is the one thing on this site worth a noise.
      if (grew && typeof Sfx === "object") Sfx.play("message");
      // If the window is already open on a thread, new mail should just appear.
      if (grew && !document.getElementById("w-im")?.hidden) this.load(true);
    } catch { /* a badge must never break the desktop */ }
  },

  paintBadge() {
    const el = document.getElementById("trayIm");
    if (!el) return;
    el.hidden = !me;
    el.classList.toggle("has", this.unread > 0);
    el.innerHTML = this.unread
      ? `&#9993;<span class="tn-n">${this.unread > 99 ? "99+" : this.unread}</span>`
      : `&#9993;`;
    el.title = this.unread ? `${this.unread} unread message${this.unread === 1 ? "" : "s"}` : "Messages";
  },

  /* --------------------------------------------------------------- open */
  LAST_KEY: "cheeto_dm_last",

  async open(withWho) {
    if (!me) { promptSignIn("Sign in to send a message."); return; }
    if (withWho !== undefined) this.open_with = withWho || null;
    // A refresh used to drop you back on the list with no idea which
    // conversation you had been reading. Remember the last one, the way a
    // messaging app does.
    else if (!this.open_with) {
      try { this.open_with = localStorage.getItem(this.LAST_KEY) || null; } catch {}
    }
    try {
      if (this.open_with) localStorage.setItem(this.LAST_KEY, this.open_with);
    } catch {}
    WM.open("w-im");
    this.render();
    await this.load(true);
    this.startPolling();
  },

  startPolling() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      // Stop as soon as the window is gone, rather than polling forever.
      if (document.getElementById("w-im")?.hidden) { clearInterval(this.timer); return; }
      this.load(false);
    }, 10000);
  },

  async load(force) {
    if (!sb || !me || this.loading) return;
    this.loading = true;
    try {
      const [t, m] = await Promise.all([
        sb.rpc("cheeto_dm_threads", { lim: 40 }),
        this.open_with ? sb.rpc("cheeto_dm_thread", { other: this.open_with, lim: 100 })
                       : Promise.resolve({ data: [] }),
      ]);
      // Only treat a load as "done" when it actually returned something
      // usable; a thrown request must not flip the empty state on.
      if (Array.isArray(t?.data)) { this.threads = t.data; this.everLoaded = true; }
      const next = Array.isArray(m?.data) ? m.data : [];
      const grew = next.length !== this.msgs.length;
      this.msgs = next;
      if (this.open_with) await this.markRead();
      this.render(force || grew);
    } catch { /* leave what's on screen */ }
    this.loading = false;
  },

  async markRead() {
    try {
      await sb.rpc("cheeto_dm_mark_read", { other: this.open_with });
      this.threads = this.threads.map((t) => t.other_id === this.open_with ? { ...t, unread: 0 } : t);
      this.unread = this.threads.reduce((s, t) => s + (t.unread || 0), 0);
      this.paintBadge();
    } catch {}
  },

  /* ------------------------------------------------------------- render */
  render(scroll) {
    const box = document.getElementById("imBody");
    if (!box) return;
    if (!me) { box.innerHTML = `<div class="note">Sign in to send a message.</div>`; return; }

    box.innerHTML = this.open_with ? this.threadHTML() : this.listHTML();
    this.wire();
    if (this.open_with && scroll !== false) {
      const log = document.getElementById("imLog");
      if (log) log.scrollTop = log.scrollHeight;
    }
    if (!this.open_with) WM.fit?.("w-im");
  },

  listHTML() {
    /* Until the first fetch lands there is nothing to say yet, and saying
       "No messages yet" is a lie that reads as data loss — which is exactly
       how it was reported: refresh, open Messages, and every conversation
       appears to be gone for the half-second before the list arrives. */
    if (!this.everLoaded) {
      return `<div class="im-empty"><div class="im-empty-i">&#9993;</div>
        <b>Loading&hellip;</b></div>`;
    }
    if (!this.threads.length) {
      return `<div class="im-empty">
        <div class="im-empty-i">&#9993;</div>
        <b>No messages yet.</b>
        <p class="note">You can message anyone on your buddy list &mdash; and only
        people on your buddy list, which is the point. Add someone first and the
        conversation opens from their row or their profile.</p>
        <button class="b95 tiny" id="imFind">Open buddy list</button>
      </div>`;
    }
    return `<div class="im-list">${this.threads.map((t) => `
      <button class="im-t${t.unread ? " unread" : ""}" data-im-open="${esc(t.other_id)}">
        <img class="im-av" src="${esc(t.avatar_url || "/logo.svg")}" alt="" width="28" height="28"
             loading="lazy" onerror="this.src='/logo.svg'">
        <span class="im-tb">
          <span class="im-tn">${esc(t.display_name || t.handle)}
            ${t.unread ? `<span class="im-n">${t.unread}</span>` : ""}</span>
          <span class="im-tl">${t.last_from_me ? "You: " : ""}${esc(t.last_body || "")}</span>
        </span>
        <span class="im-tw">${esc(this.when(t.last_at))}</span>
      </button>`).join("")}</div>`;
  },

  threadHTML() {
    const t = this.threads.find((x) => x.other_id === this.open_with);
    const name = t ? (t.display_name || t.handle) : "…";
    // A thread survives an unfriending — the words were really said — but it
    // stops accepting new ones, and saying so beats a send that fails.
    const gone = t && t.still_friends === false;
    return `
      <div class="im-head">
        <button class="b95 tiny" id="imBack">&larr; All</button>
        <b class="im-hn" data-open-user="${esc(this.open_with)}" title="View profile">${esc(name)}</b>
      </div>
      <div class="im-log" id="imLog">${
        this.msgs.length
          ? this.msgs.map((m) => `<div class="im-m${m.from_me ? " me" : ""}">
              <span class="im-bub">${esc(m.body)}</span>
              <span class="im-when">${esc(this.when(m.created_at))}</span>
            </div>`).join("")
          : `<div class="note" style="padding:8px">No messages yet. Say something.</div>`
      }</div>
      ${gone
        ? `<div class="note im-gone">You're not on each other's buddy lists any more, so
           this conversation is read-only. Add them again to carry on.</div>`
        : `<form class="im-compose" id="imForm" autocomplete="off">
             <input id="imInput" maxlength="2000" placeholder="Message ${esc(name)}…"
                    aria-label="Message ${esc(name)}">
             <button class="b95" type="submit" id="imSend">Send</button>
           </form>`}`;
  },

  wire() {
    const box = document.getElementById("imBody");
    if (!box) return;
    box.querySelectorAll("[data-im-open]").forEach((b) =>
      b.addEventListener("click", () => {
        this.open_with = b.dataset.imOpen;
        try { localStorage.setItem(this.LAST_KEY, this.open_with); } catch {}
        this.render(); this.load(true);
      }));
    document.getElementById("imBack")?.addEventListener("click", () => {
      this.open_with = null; this.msgs = [];
      try { localStorage.removeItem(this.LAST_KEY); } catch {}
      this.render();
    });
    document.getElementById("imFind")?.addEventListener("click", () => WM.open("w-buddies"));
    document.getElementById("imForm")?.addEventListener("submit", (e) => { e.preventDefault(); this.send(); });
  },

  async send() {
    const el = document.getElementById("imInput");
    const body = (el?.value || "").trim();
    if (!body || this.sending) return;
    this.sending = true;
    // Show it immediately. A message that sits in the box while the network
    // thinks about it reads as a failure, and people press send again.
    const optimistic = { id: "tmp", body, created_at: new Date().toISOString(), from_me: true };
    this.msgs = [...this.msgs, optimistic];
    if (el) el.value = "";
    this.render();

    try {
      const { data, error } = await sb.rpc("cheeto_dm_send", { target: this.open_with, body });
      if (error) throw error;
      if (data && data.ok === false) {
        this.restore(optimistic, body);
        showModal("Not sent", "&#9888;", this.explain(data.error));
        return;
      }
      await this.load(true);
    } catch (err) {
      this.restore(optimistic, body);
      showModal("Not sent", "&#9888;",
        `<span style="font-size:11px;color:#555">${esc(err?.message || "unknown error")}</span>`);
    } finally {
      this.sending = false;
    }
  },

  /* Take the failed message back out of the log and put the words back in the
     box. The order matters and it is not obvious: render() replaces the whole
     panel, so writing to the OLD input first — which is what this did — hands
     the text to an element that is about to be thrown away. Losing what
     somebody typed because a rate limit fired is the rudest failure this
     window has, so it gets its own function and its own test. */
  restore(optimistic, body) {
    this.msgs = this.msgs.filter((m) => m !== optimistic);
    this.render();
    const fresh = document.getElementById("imInput");
    if (fresh) { fresh.value = body; fresh.focus(); }
  },

  explain(code) {
    if (code === "not_friends") {
      return `You're not on each other's buddy lists any more, so this conversation
        is read-only. Messages here only go between friends &mdash; that's deliberate,
        and it's why nobody can message you out of the blue.`;
    }
    if (code === "rate_limited") {
      return `You're sending faster than the site allows, or the account is too new.
        Wait a moment and try again.`;
    }
    return `<span style="font-size:11px;color:#555">${esc(code || "unknown error")}</span>`;
  },

  when(ts) {
    if (!ts) return "";
    const ms = Date.now() - Date.parse(ts);
    if (ms < 60000) return "now";
    if (ms < 3600e3) return Math.round(ms / 60000) + "m";
    if (ms < 864e5) return Math.round(ms / 3600e3) + "h";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => DM.init());
} else {
  DM.init();
}
