/* =====================================================================
   CLUBS

   Public rooms anyone can start. The opposite posture to the messages window:
   DMs are private and therefore friends-only, clubs are public and therefore
   filtered — every post goes through the same blocklist, ban gate and rate
   limit as the main chat, enforced in Postgres by an RLS policy rather than
   by this file.

   Two views in one window, list and room, with a back button. Same reasoning
   as the messages window: a phone cannot show a sidebar and a room at once,
   and the whole site has to work on one.

   Whoever starts a club owns it and can hide posts in it. That is the entire
   moderation model, and it is deliberate — a public room with no one
   responsible for it is a room that becomes somebody else's problem.
   ===================================================================== */

const Clubs = {
  list: [],
  club: null,          // the open club's payload, or null on the browse view
  openId: null,
  loading: false,
  everLoaded: false,
  q: "",
  creating: false,
  timer: null,

  /* ---------------------------------------------------------- lifecycle */
  init() {
    document.addEventListener("cheeto:auth", () => {
      this.everLoaded = false;
      if (!document.getElementById("w-clubs")?.hidden) this.load(true);
    });
    // Anywhere a club is named, it can be opened.
    document.addEventListener("click", (ev) => {
      const el = ev.target.closest?.("[data-club-open]");
      if (!el) return;
      ev.preventDefault(); ev.stopPropagation();
      this.open(Number(el.dataset.clubOpen));
    });
  },

  async open(id) {
    this.openId = id != null ? Number(id) : null;
    WM.open("w-clubs");
    this.render();
    await this.load(true);
    this.startPolling();
  },

  startPolling() {
    clearInterval(this.timer);
    // Only while a room is on screen, and only while the window is open. The
    // browse list does not need to move under someone reading it.
    this.timer = setInterval(() => {
      if (document.getElementById("w-clubs")?.hidden) { clearInterval(this.timer); return; }
      if (this.openId) this.load(false);
    }, 12000);
  },

  async load(force) {
    if (!sb || this.loading) return;
    this.loading = true;
    try {
      if (this.openId) {
        const { data, error } = await sb.rpc("cheeto_club", { club: this.openId, lim: 60 });
        if (error) throw error;
        if (data && data.ok) { this.club = data; this.everLoaded = true; }
        else { this.club = null; this.openId = null; }
      } else {
        const { data, error } = await sb.rpc("cheeto_clubs_list", { q: this.q || null, lim: 40 });
        if (error) throw error;
        if (Array.isArray(data)) { this.list = data; this.everLoaded = true; }
      }
      this.render(force);
    } catch { /* leave what is on screen rather than blanking it */ }
    this.loading = false;
  },

  /* ------------------------------------------------------------- render */
  render(scroll) {
    const box = document.getElementById("clubsBody");
    if (!box) return;
    box.innerHTML = this.openId ? this.roomHTML() : this.browseHTML();
    this.wire();
    if (this.openId && scroll !== false) {
      const log = document.getElementById("clubLog");
      if (log) log.scrollTop = log.scrollHeight;
    } else {
      WM.fit?.("w-clubs");
    }
  },

  browseHTML() {
    const mk = me
      ? `<form class="cl-new" id="clubNewForm" autocomplete="off">
           <input id="clubName" maxlength="40" placeholder="Start a club&hellip;" aria-label="Club name">
           <button class="b95 tiny" type="submit">Create</button>
         </form>`
      : `<p class="note">Sign in to start a club or join one.</p>`;

    if (!this.everLoaded) {
      return `<div class="cl-search"><input id="clubQ" placeholder="Search clubs"
                value="${esc(this.q)}" aria-label="Search clubs"></div>${mk}
              <div class="note">Loading&hellip;</div>`;
    }

    const rows = this.list.length
      ? `<div class="cl-list">${this.list.map((c) => `
          <div class="cl-row">
            <button class="cl-main" data-club-open="${c.id}">
              <span class="cl-nm">${esc(c.name)}${c.joined ? ` <span class="cl-in">joined</span>` : ""}</span>
              ${c.description ? `<span class="cl-ds">${esc(c.description)}</span>` : ""}
              <span class="cl-meta">${c.members} member${c.members === 1 ? "" : "s"}
                &middot; ${c.posts} post${c.posts === 1 ? "" : "s"}
                &middot; run by @${esc(c.owner_handle)}</span>
            </button>
            ${me && !c.joined ? `<button class="b95 tiny" data-club-join="${c.id}">Join</button>` : ""}
          </div>`).join("")}</div>`
      : `<div class="note">${this.q
          ? `Nothing matches &ldquo;${esc(this.q)}&rdquo;.`
          : `No clubs yet. Start the first one &mdash; it takes a name.`}</div>`;

    return `<div class="cl-search"><input id="clubQ" placeholder="Search clubs"
              value="${esc(this.q)}" aria-label="Search clubs"></div>
            ${mk}${rows}`;
  },

  roomHTML() {
    const c = this.club;
    if (!c) return `<div class="note">That club is gone.</div>`;
    const posts = Array.isArray(c.posts) ? c.posts : [];
    return `
      <div class="cl-head">
        <button class="b95 tiny" id="clubBack">&larr; All clubs</button>
        <b class="cl-title">${esc(c.name)}</b>
      </div>
      ${c.description ? `<p class="note cl-about">${esc(c.description)}</p>` : ""}
      <div class="cl-bar">
        <span class="note">${c.members} member${c.members === 1 ? "" : "s"}</span>
        ${me && !c.joined ? `<button class="b95 tiny" data-club-join="${c.id}">Join</button>` : ""}
        ${me && c.joined && !c.is_owner ? `<button class="b95 tiny" id="clubLeave">Leave</button>` : ""}
        ${c.is_owner ? `<span class="cl-owner">You run this club</span>` : ""}
      </div>

      <div class="cl-log" id="clubLog">${
        posts.length
          ? posts.map((o) => `<div class="cl-p">
              <img class="cl-av" src="${esc(o.avatar_url || "/logo.svg")}" alt="" width="22" height="22"
                   loading="lazy" onerror="this.src='/logo.svg'">
              <div class="cl-pb">
                <div class="cl-pw">
                  <button class="linky" data-open-user="${esc(o.user_id)}">${esc(o.display_name || o.handle)}</button>
                  <span class="cl-when">${esc(this.when(o.created_at))}</span>
                  ${(o.mine || c.is_owner)
                    ? `<button class="cl-x" data-club-hide="${o.id}" title="Remove this post">&times;</button>` : ""}
                </div>
                <div class="cl-pt">${esc(o.body)}</div>
              </div>
            </div>`).join("")
          : `<div class="note" style="padding:8px">Nothing posted yet.</div>`
      }</div>

      ${!me
        ? `<p class="note">Sign in to post here.</p>`
        : c.joined
          ? `<form class="cl-compose" id="clubForm" autocomplete="off">
               <input id="clubInput" maxlength="2000" placeholder="Say something in ${esc(c.name)}&hellip;"
                      aria-label="Post to this club">
               <button class="b95" type="submit">Post</button>
             </form>`
          : `<p class="note">Join the club to post in it.</p>`}`;
  },

  wire() {
    const box = document.getElementById("clubsBody");
    if (!box) return;

    const q = document.getElementById("clubQ");
    if (q) {
      let t = null;
      q.addEventListener("input", () => {
        clearTimeout(t);
        // Debounced, or every keystroke is a query.
        t = setTimeout(() => { this.q = q.value.trim(); this.load(true); }, 280);
      });
    }

    box.querySelectorAll("[data-club-join]").forEach((b) =>
      b.addEventListener("click", () => this.join(Number(b.dataset.clubJoin))));
    document.getElementById("clubBack")?.addEventListener("click", () => {
      this.openId = null; this.club = null; this.render(); this.load(true);
    });
    document.getElementById("clubLeave")?.addEventListener("click", () => this.leave());
    document.getElementById("clubForm")?.addEventListener("submit", (e) => { e.preventDefault(); this.post(); });
    document.getElementById("clubNewForm")?.addEventListener("submit", (e) => { e.preventDefault(); this.create(); });
    box.querySelectorAll("[data-club-hide]").forEach((b) =>
      b.addEventListener("click", () => this.hide(Number(b.dataset.clubHide))));
  },

  /* -------------------------------------------------------------- acts */
  async rpc(fn, args) {
    try {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw error;
      if (data && data.ok === false) {
        showModal("Not allowed", "&#9888;", this.explain(data.error));
        return null;
      }
      return data || { ok: true };
    } catch (err) {
      showModal("Didn't work", "&#9888;",
        `<span style="font-size:11px;color:#555">${esc(err?.message || "unknown error")}</span>`);
      return null;
    }
  },

  explain(code) {
    if (code === "not_member") return `You have to join a club before you can post in it.`;
    if (code === "rate_limited") return `You're posting faster than the site allows, or the account is too new.`;
    if (code === "blocked_word") return `That post contains a word the site filters. Same list as the chat.`;
    if (code === "not_allowed") return `That isn't yours to remove.`;
    return `<span style="font-size:11px;color:#555">${esc(code || "unknown error")}</span>`;
  },

  async join(id) {
    if (!me) { promptSignIn("Sign in to join a club."); return; }
    if (await this.rpc("cheeto_club_join", { club: id })) {
      if (!this.openId) this.openId = id;
      await this.load(true);
    }
  },

  async leave() {
    if (!this.openId) return;
    if (await this.rpc("cheeto_club_leave", { club: this.openId })) await this.load(true);
  },

  async create() {
    if (!me || this.creating) return;
    const el = document.getElementById("clubName");
    const name = (el?.value || "").trim();
    if (!name) return;
    this.creating = true;
    const r = await this.rpc("cheeto_club_create", { name, description: null });
    this.creating = false;
    if (!r) return;
    if (el) el.value = "";
    // Straight into the room you just made — there is nothing to look at on
    // the list that you don't already know.
    this.openId = Number(r.id);
    await this.load(true);
  },

  async post() {
    const el = document.getElementById("clubInput");
    const body = (el?.value || "").trim();
    if (!body || this.sending) return;
    this.sending = true;
    const r = await this.rpc("cheeto_club_post", { club: this.openId, body });
    this.sending = false;
    if (!r) {
      // Keep what they typed. Same rule as the messages window: a refusal must
      // never cost somebody their words.
      const again = document.getElementById("clubInput");
      if (again) { again.value = body; again.focus(); }
      return;
    }
    if (el) el.value = "";
    await this.load(true);
  },

  async hide(postId) {
    if (await this.rpc("cheeto_club_hide_post", { post_id: postId })) await this.load(true);
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
  document.addEventListener("DOMContentLoaded", () => Clubs.init());
} else {
  Clubs.init();
}
