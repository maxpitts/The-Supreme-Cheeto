/* =====================================================================
   NOTIFICATIONS
   Until now every social feature on this site was write-only. Somebody could
   add you, write on your wall, reply to your post or nudge you, and unless you
   happened to open the right window you would never know. That is the whole
   MySpace loop missing: the reason anyone went back was "you have 3 new
   comments".

   Three layers, deliberately in this order:
     1. a badge on the taskbar          — always there, costs nothing
     2. a window listing what happened  — with a way to act on each item
     3. an optional desktop alert       — off unless you ask for it

   Layer 3 is the Notification API, not Web Push: it fires while a tab is
   open, needs no server and no keys, and covers "I'm in another tab and
   someone nudged me", which is the AIM behaviour worth having. Real push —
   alerts with the site closed — needs VAPID keys, a subscription store and a
   sender, and on iOS only works once the site is installed to the home
   screen. That is a separate build, not a checkbox.
   ===================================================================== */

const Notify = {
  items: [],
  unseen: 0,
  timer: null,
  loading: false,
  opened: false,
  announced: new Set(),     // ref keys already toasted, so a poll can't repeat one

  KEY: "cheeto_desktop_alerts",

  /* ------------------------------------------------------------ setup */
  init() {
    this.paint();
    document.addEventListener("cheeto:auth", () => {
      this.items = []; this.unseen = 0; this.announced.clear();
      this.paint(); this.poll();
    });
    // A tab coming back to the foreground is the most likely moment for the
    // count to be stale, so check then rather than waiting out the interval.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.poll();
    });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), 45000);
    this.poll();
  },

  /* --------------------------------------------------------- fetching */
  async poll() {
    if (!sb || !me || this.loading) return;
    if (document.visibilityState === "hidden" && !this.wantsDesktop()) return;
    // This flag was declared and checked but never actually set, so the guard
    // did nothing: a slow request meant the 45s timer, the visibility handler
    // and the auth handler all stacked more requests on top of it. When auth
    // stalled, that is what turned one wedged call into a queue of thirty-nine.
    this.loading = true;
    try {
      // The full list, not just the count: the desktop alert needs to know
      // WHAT happened, and one request is cheaper than a count plus a fetch.
      const { data, error } = await sb.rpc("cheeto_notifications", { lim: 30 });
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      const fresh = list.filter((n) => !n.seen);

      this.maybeToast(fresh);
      this.items = list;
      this.unseen = fresh.length;
      this.paint();
      if (this.opened && !document.getElementById("w-notif")?.hidden) this.render();
    } catch { /* a missing badge must never break the desktop */ }
    finally { this.loading = false; }
  },

  /* ------------------------------------------------------------ paint */
  paint() {
    const el = document.getElementById("trayNotif");
    if (!el) return;
    if (!me) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle("has", this.unseen > 0);
    el.innerHTML = this.unseen > 0
      ? `&#128172;<span class="tn-n">${this.unseen > 99 ? "99+" : this.unseen}</span>`
      : `&#128172;`;
    el.title = this.unseen
      ? `${this.unseen} new ${this.unseen === 1 ? "notification" : "notifications"}`
      : "Nothing new";
  },

  /* ------------------------------------------------------------- open */
  async open() {
    if (!me) { promptSignIn("Sign in to see who's been talking to you."); return; }
    this.opened = true;
    WM.open("w-notif");
    this.render();
    await this.poll();
    this.render();
    // Marking read is deliberate and immediate: you opened the window, you
    // saw them. Leaving the badge lit after that is the thing everyone hates.
    await this.markSeen();
  },

  async markSeen() {
    if (!sb || !me || !this.unseen) return;
    try {
      await sb.rpc("cheeto_mark_notifications_seen");
      this.items = this.items.map((n) => ({ ...n, seen: true }));
      this.unseen = 0;
      this.paint();
      this.render();
    } catch {}
  },

  /* ----------------------------------------------------------- render */
  TEXT: {
    wall:           ["&#128172;", "wrote on your wall"],
    reply:          ["&#128221;", "replied to your post"],
    friend_request: ["&#128100;", "wants to be friends"],
    friend_accept:  ["&#10003;",  "accepted your friend request"],
    nudge:          ["&#9889;",   "nudged you"],
  },

  render() {
    const box = document.getElementById("notifBody");
    if (!box) return;

    if (!me) {
      box.innerHTML = `<div class="note">Sign in to see notifications.</div>`;
      return;
    }
    if (!this.items.length) {
      box.innerHTML = `<div class="nt-empty">
        <div class="nt-empty-i">&#128172;</div>
        <b>Nothing yet.</b>
        <p class="note">When someone adds you, writes on your wall, replies to a post
        or nudges you, it shows up here &mdash; and the taskbar lights up.</p>
        <p class="note">Quiet? Go and be the first to write on somebody else's wall.
        <button class="b95 tiny" data-nt-people>Find people</button></p>
      </div>${this.alertsHTML()}`;
      this.wire();
      WM.fit?.("w-notif");
      return;
    }

    // measured after the rows exist, at the end of this method
    box.innerHTML = `<div class="nt-list">${this.items.map((n) => {
      const t = this.TEXT[n.kind] || ["&#8226;", n.kind];
      const who = esc(n.display_name || n.handle || "someone");
      return `<div class="nt${n.seen ? "" : " new"}">
        <span class="nt-i">${t[0]}</span>
        <img class="nt-av" src="${esc(n.avatar_url || "/logo.svg")}" alt="" width="22" height="22"
             loading="lazy" onerror="this.src='/logo.svg'">
        <div class="nt-b">
          <div><button class="linky" data-open-user="${esc(n.actor_id)}">${who}</button>
            <span>${t[1]}</span></div>
          ${n.preview ? `<div class="nt-p">&ldquo;${esc(n.preview)}&rdquo;</div>` : ""}
          <div class="nt-w">${esc(this.when(n.created_at))}</div>
        </div>
        <div class="nt-a">${this.actionHTML(n)}</div>
      </div>`;
    }).join("")}</div>${this.alertsHTML()}`;

    this.wire();
    WM.fit?.("w-notif");
  },

  /* Every notification should be one click from the thing it is about. A list
     you can only read is a list you stop opening. */
  actionHTML(n) {
    if (n.kind === "friend_request") return `<button class="b95 tiny" data-nt-go="buddies">Respond</button>`;
    if (n.kind === "reply") return `<button class="b95 tiny" data-nt-go="board">Open</button>`;
    if (n.kind === "wall") return `<button class="b95 tiny" data-nt-go="mywall">My wall</button>`;
    return `<button class="b95 tiny" data-open-user="${esc(n.actor_id)}">Profile</button>`;
  },

  alertsHTML() {
    const perm = (typeof Notification === "undefined") ? "unsupported" : Notification.permission;
    if (perm === "unsupported") return "";
    if (perm === "granted" && this.wantsDesktop()) {
      return `<div class="nt-alerts"><b>&#128266; Desktop alerts are on.</b>
        <span class="note">You'll get a system notification when something arrives while
        this tab is in the background.</span>
        <button class="b95 tiny" data-nt-alerts="off">Turn off</button></div>`;
    }
    if (perm === "denied") {
      return `<div class="nt-alerts"><span class="note">Desktop alerts are blocked for this
        site in your browser settings. Nothing here can undo that &mdash; it has to be changed
        in the padlock menu next to the address bar.</span></div>`;
    }
    return `<div class="nt-alerts"><b>Want a desktop alert?</b>
      <span class="note">A system notification when something lands while you're in another
      tab. Only while the site is open &mdash; nothing follows you around after you close it.</span>
      <button class="b95 tiny" data-nt-alerts="on">Turn on</button></div>`;
  },

  wire() {
    const box = document.getElementById("notifBody");
    if (!box) return;
    box.querySelectorAll("[data-nt-go]").forEach((b) => b.addEventListener("click", () => {
      const w = b.dataset.ntGo;
      if (w === "buddies") WM.open("w-buddies");
      else if (w === "board") WM.open("w-board");
      else if (w === "mywall" && typeof Profile === "object") Profile.openMine();
    }));
    box.querySelector("[data-nt-people]")?.addEventListener("click", () => WM.open("w-people"));
    box.querySelectorAll("[data-nt-alerts]").forEach((b) =>
      b.addEventListener("click", () => this.setDesktop(b.dataset.ntAlerts === "on")));
  },

  when(ts) {
    const ms = Date.now() - Date.parse(ts);
    if (ms < 60000) return "just now";
    if (ms < 3600e3) return Math.round(ms / 60000) + "m ago";
    if (ms < 864e5) return Math.round(ms / 3600e3) + "h ago";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  },

  /* -------------------------------------------------- desktop alerts */
  wantsDesktop() {
    try { return localStorage.getItem(this.KEY) === "1"; } catch { return false; }
  },

  async setDesktop(on) {
    if (typeof Notification === "undefined") return;
    if (!on) {
      try { localStorage.setItem(this.KEY, "0"); } catch {}
      this.render();
      return;
    }
    // Asked for from a click, never on page load. A permission prompt that
    // appears unbidden is the reason most people block them forever.
    let perm = Notification.permission;
    if (perm === "default") { try { perm = await Notification.requestPermission(); } catch {} }
    try { localStorage.setItem(this.KEY, perm === "granted" ? "1" : "0"); } catch {}
    this.render();
  },

  maybeToast(fresh) {
    if (!this.wantsDesktop() || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    // Only when they're not looking. Toasting the tab someone is staring at is
    // just a second copy of the badge they can already see.
    if (document.visibilityState === "visible") return;

    fresh.slice(0, 3).forEach((n) => {
      const key = n.kind + ":" + n.ref_id;
      if (this.announced.has(key)) return;
      this.announced.add(key);
      const t = this.TEXT[n.kind] || ["", n.kind];
      const who = n.display_name || n.handle || "Someone";
      try {
        const note = new Notification("The Supreme Cheeto", {
          body: `${who} ${t[1]}${n.preview ? ": " + n.preview : ""}`,
          icon: "/icon-192.png",
          tag: key,                 // collapses duplicates rather than stacking
        });
        note.onclick = () => { window.focus(); this.open(); note.close(); };
      } catch {}
    });
    // Unbounded growth over a long session is a slow leak; the set only needs
    // to cover what's currently unseen.
    if (this.announced.size > 200) this.announced = new Set([...this.announced].slice(-100));
  },
};

function initNotify() {
  document.getElementById("trayNotif")?.addEventListener("click", () => Notify.open());
  Notify.init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNotify);
} else {
  initNotify();
}
