/* =====================================================================
   SOMEBODY ELSE'S PAGE
   The MySpace half of the site: a profile you visit rather than one you edit.
   Picture, bio, links, Top 8, their recent posts, and a wall you can write on.

   One window, reused. Clicking a name anywhere — chat, the FYP feed, the buddy
   list, either leaderboard — opens this and replaces whatever was in it,
   because two identical windows stacked on each other is how a fake desktop
   stops being funny.

   Everything visible here comes from cheeto_public_profile(), which decides
   what a given viewer may see. This file asks for a profile and draws the
   answer; it does not decide that friends-only statuses are friends-only, and
   it can't be talked into showing them.
   ===================================================================== */

const Profile = {
  who: null,          // uuid currently displayed
  data: null,
  wall: [],
  busy: false,

  /* ------------------------------------------------------------- open */
  /* Accepts a uuid or a handle, because half the render sites on this site
     have one and half have the other. */
  async open(idOrHandle) {
    if (!idOrHandle) return;
    WM.open("w-user");
    const box = document.getElementById("userBody");
    if (box) box.innerHTML = `<div class="note" style="padding:10px">Loading…</div>`;

    if (!sb) {
      if (box) box.innerHTML = `<div class="note" style="padding:10px">
        Profiles need the database, which didn't load.</div>`;
      return;
    }

    let uid = idOrHandle;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(idOrHandle))) {
      try {
        const { data } = await sb.rpc("cheeto_profile_id", { h: String(idOrHandle) });
        uid = data || null;
      } catch { uid = null; }
      if (!uid) {
        if (box) box.innerHTML = `<div class="note" style="padding:10px">
          No account called <b>@${esc(String(idOrHandle))}</b>.</div>`;
        return;
      }
    }

    this.who = uid;
    await this.load();
  },

  /* Your own page, as everyone else sees it. Signed out there is nothing to
     show, so this sends you to the one window that has the sign-in buttons
     rather than opening an empty profile. */
  openMine() {
    if (!me) { WM.open("w-chat"); return; }
    this.open(me.id);
  },

  async load() {
    if (!this.who || !sb) return;
    try {
      const [prof, wall] = await Promise.all([
        sb.rpc("cheeto_public_profile", { who: this.who }),
        sb.rpc("cheeto_wall_list", { who: this.who, lim: 30 }),
      ]);
      if (prof.error) throw prof.error;
      this.data = prof.data;
      // Counted server-side: your own page doesn't count, refreshing doesn't
      // inflate it, and signed-out visitors aren't counted at all.
      if (this.data?.ok !== false && !this.data?.suspended) {
        sb.rpc("cheeto_view_profile", { who: this.who })
          .then(({ data }) => {
            if (data == null || this.data?.views == null) return;
            this.data.views = data;
          })
          .catch(() => {});
      }
      this.wall = (wall.error || !Array.isArray(wall.data)) ? [] : wall.data;
    } catch (err) {
      const box = document.getElementById("userBody");
      if (box) box.innerHTML = `<div class="note" style="padding:10px;color:#900">
        Couldn't load that profile.<br>
        <span style="font-size:11px;color:#555">${esc(err?.message || "unknown error")}</span></div>`;
      return;
    }
    this.paint();
  },

  /* ------------------------------------------------------------ paint */
  paint() {
    const box = document.getElementById("userBody");
    const p = this.data;
    if (!box || !p) return;

    const name = p.display_name || p.handle || "someone";
    // WM caches titles at init, so the taskbar button and the title bar are
    // two separate updates. Both, or the window says USER_PROFILE while the
    // taskbar says something else.
    const title = "C:\\USERS\\" + String(p.handle || "?").toUpperCase();
    const rec = WM.byId?.("w-user");
    if (rec) { rec.title = title; WM.renderTasks?.(); }
    const bar = document.querySelector("#w-user .tb .t");
    if (bar) bar.textContent = title;

    if (p.ok === false) {
      box.innerHTML = `<div class="note" style="padding:10px">That account doesn't exist.</div>`;
      return;
    }

    if (p.suspended) {
      box.innerHTML = `<div class="up-head">
          <img class="up-pfp" src="/logo.svg" alt="" width="72" height="72">
          <div><div class="up-name">${esc(name)}</div>
          <div class="up-handle">@${esc(p.handle)}</div></div>
        </div>
        <div class="sunken" style="margin-top:10px">This account is suspended.
        Its posts and comments have been removed from public view.</div>`;
      return;
    }

    const AIM = { available: ["&#128994;", "Available"], away: ["&#127761;", "Away"],
                  busy: ["&#128308;", "Busy"] };
    const aim = AIM[p.aim_state] || null;
    const joined = p.created_at ? new Date(p.created_at).toLocaleDateString("en-US",
      { year: "numeric", month: "long", day: "numeric" }) : "—";
    const s = p.stats || {};
    const links = Array.isArray(p.links) ? p.links : [];

    // The theme name is whitelisted in Postgres, so this can only ever be one
    // of ten known strings — it is a class selector, never injected CSS.
    box.dataset.utheme = /^[a-z]+$/.test(p.theme || "") ? p.theme : "classic";

    box.innerHTML = `
      <div class="up-head">
        <img class="up-pfp" src="${esc(p.avatar_url || "/logo.svg")}" alt=""
             width="72" height="72" onerror="this.src='/logo.svg'">
        <div class="up-id">
          <div class="up-name">${esc(name)}${p.is_admin ? ' <span class="adm">ADMIN</span>' : ""}</div>
          <div class="up-handle">@${esc(p.handle)}</div>
          ${aim ? `<div class="up-aim">${aim[0]} ${aim[1]}${
            p.aim_text ? ` &mdash; <i>${esc(p.aim_text)}</i>` : ""}</div>` : ""}
          ${p.mood ? `<div class="up-mood">&#128173; currently ${esc(p.mood)}</div>` : ""}
          <div class="up-meta">Member since ${esc(joined)} &middot;
            ${p.friend_count} friend${p.friend_count === 1 ? "" : "s"}${
            p.views != null ? ` &middot; <span class="up-views">${p.views} profile view${p.views === 1 ? "" : "s"}</span>` : ""}</div>
        </div>
      </div>

      <div class="up-acts">${this.actionsHTML()}</div>

      ${p.bio ? `<fieldset><legend>About me</legend>
        <div class="up-bio">${esc(p.bio)}</div></fieldset>` : ""}

      ${links.length ? `<fieldset><legend>Links</legend>
        <div class="up-links">${links.map((l) => `<a href="${esc(l.url)}" target="_blank"
          rel="noopener nofollow ugc">${esc(l.label || l.url)}</a>`).join("")}</div>
        <p class="note">Links are typed by the account holder. We don't check where they go.</p>
        </fieldset>` : ""}

      <fieldset><legend>&#11088; Top 8</legend>${this.top8HTML()}</fieldset>

      <fieldset><legend>&#128202; Record</legend>
        <div class="up-stats">
          <div><b>${s.posts ?? 0}</b><span>posts</span></div>
          <div><b>${s.guesses ?? 0}</b><span>debt guesses</span></div>
          <div><b>${s.best_guess == null ? "&mdash;" : this.pct(s.best_guess)}</b><span>best guess</span></div>
          <div><b>${s.picks_total ? `${s.picks_right}/${s.picks_total}` : "&mdash;"}</b><span>calls right</span></div>
        </div>
      </fieldset>

      ${this.statusesHTML()}
      ${this.postsHTML()}

      <fieldset><legend>&#128172; Wall${this.wall.length ? ` (${this.wall.length})` : ""}</legend>
        ${this.wallHTML()}</fieldset>`;

    this.wire();
    WM.fit?.("w-user");
  },

  pct(v) {
    const n = Number(v);
    if (!isFinite(n)) return "&mdash;";
    return (n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(1)) + "%";
  },

  actionsHTML() {
    const p = this.data;
    if (!me) {
      return `<span class="note" style="margin:0">Sign in to add friends, nudge and write on walls.</span>
        <button class="b95 tiny" data-up-in="google">Google</button>
        <button class="b95 tiny" data-up-in="discord">Discord</button>
        ${EMAIL_SIGNIN ? `<button class="b95 tiny" data-up-email>Email</button>` : ""}`;
    }
    if (p.friendship === "self") {
      return `<button class="b95" data-up-edit>Edit my profile</button>
        <button class="b95" data-up-share>&#128247; Share my page</button>
        <span class="note" style="margin:0">This is how everyone else sees you.</span>`;
    }
    const bits = [];
    if (p.friendship === "friends") {
      bits.push(`<span class="up-fr">&#10003; Friends</span>`);
      bits.push(`<button class="b95 tiny" data-up-nudge>Nudge</button>`);
      bits.push(`<button class="b95 tiny" data-up-unfriend>Remove friend</button>`);
    } else if (p.friendship === "pending_out") {
      bits.push(`<span class="note" style="margin:0">Friend request sent &mdash; waiting on them.</span>`);
    } else if (p.friendship === "pending_in") {
      bits.push(`<span class="note" style="margin:0">They've asked to be friends.</span>`);
      bits.push(`<button class="b95 tiny" data-up-buddies>Open buddy list</button>`);
    } else {
      bits.push(`<button class="b95" data-up-add>Add as friend</button>`);
    }
    if (myProfile?.is_admin) bits.push(`<button class="b95 tiny" data-up-clearpfp>Clear picture</button>`);
    return bits.join("");
  },

  top8HTML() {
    const t = Array.isArray(this.data.top8) ? this.data.top8 : [];
    if (!t.length) {
      return `<div class="note">No Top 8 yet.${
        this.data.friendship === "self" ? " Pick yours in the buddy list." : ""}</div>`;
    }
    return `<div class="up-t8">${t.map((f) => `
      <button class="up-t8i" data-open-user="${esc(f.id)}" title="${esc(f.handle)}">
        <img src="${esc(f.avatar_url || "/logo.svg")}" alt="" width="40" height="40"
             loading="lazy" onerror="this.src='/logo.svg'">
        <span>${esc(f.display_name || f.handle)}</span>
      </button>`).join("")}</div>`;
  },

  statusesHTML() {
    const p = this.data;
    const list = Array.isArray(p.statuses) ? p.statuses : [];
    if (!p.can_see_statuses) {
      // Statuses are friends-only everywhere else on the site, so saying why
      // they're absent beats an empty box that looks broken.
      return `<fieldset><legend>Status updates</legend>
        <div class="note">${p.friendship === "pending_out"
          ? "Friends-only. Your request is still pending."
          : "Friends-only &mdash; add them and their statuses show up here and in your buddy list."}</div>
        </fieldset>`;
    }
    if (!list.length) return `<fieldset><legend>Status updates</legend>
      <div class="note">Nothing posted yet.</div></fieldset>`;
    return `<fieldset><legend>Status updates</legend>
      ${list.map((s) => `<div class="up-st">
        <span class="up-when">${esc(this.when(s.created_at))}</span>
        <div>${esc(s.body)}</div></div>`).join("")}</fieldset>`;
  },

  postsHTML() {
    const list = Array.isArray(this.data.posts) ? this.data.posts : [];
    if (!list.length) return "";
    return `<fieldset><legend>Recent posts</legend>
      ${list.map((q) => {
        const url = typeof imgUrl === "function" ? imgUrl(q.image_path) : null;
        return `<div class="up-post" data-up-post="${q.id}">
          <span class="up-when">${esc(this.when(q.created_at))}</span>
          ${q.title ? `<b>${esc(q.title)}</b>` : ""}
          <div>${esc((q.body || "").slice(0, 220))}${(q.body || "").length > 220 ? "…" : ""}</div>
          ${url ? `<img class="up-pimg" src="${esc(url)}" alt="" loading="lazy">` : ""}
        </div>`;
      }).join("")}</fieldset>`;
  },

  wallHTML() {
    const p = this.data;
    const mine = p.friendship === "self";
    const composer = !me
      ? `<div class="note">Sign in to leave a comment.</div>`
      : p.wall_closed
        ? `<div class="note">${mine ? "Your wall is closed. Reopen it in your profile editor."
                                    : "This wall is closed to comments."}</div>`
        : `<div class="up-wc">
             <textarea class="i95" id="upWallBody" rows="2" maxlength="500"
               placeholder="Leave a comment on ${esc(p.display_name || p.handle)}'s wall"></textarea>
             <div class="up-wc-b">
               <button class="b95" id="upWallPost">Post comment</button>
               <span class="note" id="upWallMsg" style="margin:0"></span>
             </div>
           </div>`;

    const rows = this.wall.length
      ? this.wall.map((c) => `<div class="up-wr">
          <img class="up-wav" src="${esc(c.avatar_url || "/logo.svg")}" alt="" width="24" height="24"
               loading="lazy" onerror="this.src='/logo.svg'">
          <div class="up-wb">
            <div class="up-wh">
              <button class="linky" data-open-user="${esc(c.author_id)}">${esc(c.display_name || c.handle)}</button>
              <span class="up-when">${esc(this.when(c.created_at))}</span>
              ${c.can_delete ? `<button class="b95 tiny" data-wdel="${c.id}">Delete</button>` : ""}
            </div>
            <div class="up-wt">${esc(c.body)}</div>
          </div>
        </div>`).join("")
      : `<div class="note">No comments yet.${me && !p.wall_closed ? " Say something." : ""}</div>`;

    return composer + `<div class="up-wall">${rows}</div>`;
  },

  when(ts) {
    const d = new Date(ts);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  },

  /* ------------------------------------------------------------- wire */
  wire() {
    const box = document.getElementById("userBody");
    if (!box) return;
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((b) => b.addEventListener("click", fn));

    on("[data-up-in]", (e) => { if (typeof signIn === "function") signIn(e.currentTarget.dataset.upIn); });
    on("[data-up-email]", () => promptSignIn("Sign in to add friends, nudge and write on walls."));
    on("[data-up-edit]", () => { if (typeof openProfile === "function") openProfile(); });
    on("[data-up-share]", () => Share.open("profile", {
      handle: this.data.handle, bio: this.data.bio, friends: this.data.friend_count,
      since: this.data.created_at ? new Date(this.data.created_at).toLocaleDateString("en-US",
        { month: "long", year: "numeric" }) : null,
    }));
    on("[data-up-buddies]", () => WM.open("w-buddies"));
    on("[data-up-post]", (e) => { WM.open("w-board"); });

    on("[data-up-add]", (e) => this.act(e.currentTarget, "cheeto_friend_request", { target: this.who },
      "Friend request sent."));
    on("[data-up-unfriend]", (e) => this.act(e.currentTarget, "cheeto_friend_remove", { other: this.who },
      "Removed."));
    on("[data-up-nudge]", (e) => this.act(e.currentTarget, "cheeto_nudge", { target: this.who },
      "Nudge sent.", true));

    on("[data-up-clearpfp]", (e) => this.clearAvatar(e.currentTarget));

    box.querySelector("#upWallPost")?.addEventListener("click", () => this.postComment());
    on("[data-wdel]", (e) => this.deleteComment(+e.currentTarget.dataset.wdel, e.currentTarget));
  },

  /* One helper for the three RPCs that just do a thing and reload, so a
     failure is reported the same way each time instead of three ways. */
  async act(btn, fn, args, okMsg, noReload) {
    if (!sb || !me || this.busy) return;
    this.busy = true;
    const was = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || "refused");
      if (noReload) { btn.textContent = okMsg; setTimeout(() => { btn.textContent = was; btn.disabled = false; }, 1600); }
      else await this.load();
    } catch (err) {
      btn.disabled = false; btn.textContent = was;
      showModal("That didn't work", "&#9888;",
        `<span style="font-size:12px">${esc(err?.message || "The database refused it.")}</span>`);
    } finally {
      this.busy = false;
    }
  },

  async postComment() {
    const ta = document.getElementById("upWallBody");
    const msg = document.getElementById("upWallMsg");
    const btn = document.getElementById("upWallPost");
    const body = (ta?.value || "").trim();
    if (!body) { if (msg) msg.innerHTML = `<span style="color:#900">Write something first.</span>`; return; }
    if (!sb || !me) return;

    btn.disabled = true; if (msg) msg.textContent = "Posting…";
    try {
      const { error } = await sb.from("cheeto_wall")
        .insert({ owner_id: this.who, author_id: me.id, body });
      if (error) throw error;
      ta.value = "";
      if (msg) msg.textContent = "";
      await this.load();
    } catch (err) {
      btn.disabled = false;
      const m = String(err?.message || "");
      const why = /blocked_word|check_violation/i.test(m)
        ? "That comment contains a blocked word."
        : /row-level security/i.test(m)
          ? "You can't comment right now — new accounts wait ten minutes, and there's a five-per-wall-per-hour limit."
          : m || "The database refused that.";
      if (msg) msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    }
  },

  async deleteComment(id, btn) {
    if (!sb || !me) return;
    btn.disabled = true; btn.textContent = "…";
    try {
      const { data, error } = await sb.rpc("cheeto_wall_delete", { comment_id: id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error);
      await this.load();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Delete";
      showModal("Not deleted", "&#9888;", esc(err?.message || "Refused."));
    }
  },

  /* Admin: clear the picture AND remove the file, in that order. If the file
     removal fails the profile is already clean, which is the half that matters. */
  async clearAvatar(btn) {
    if (!sb || !myProfile?.is_admin) return;
    const old = this.data?.avatar_url;
    btn.disabled = true; btn.textContent = "…";
    try {
      const { data, error } = await sb.rpc("cheeto_admin_clear_avatar", { target: this.who });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error);
      const path = avatarPathFromUrl(old);
      if (path) { try { await sb.storage.from("avatars").remove([path]); } catch {} }
      await this.load();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Clear picture";
      showModal("Not cleared", "&#9888;", esc(err?.message || "Refused."));
    }
  },
};

/* If the URL is one of ours, this returns the storage path so the file can be
   deleted. A Google or Discord avatar returns null and is left alone — it
   isn't ours to remove, and trying would just fail quietly forever. */
function avatarPathFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/public\/avatars\/(.+)$/);
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

/* =====================================================================
   ONE DELEGATED LISTENER FOR THE WHOLE SITE
   Every name rendered anywhere carries data-uid or data-uname. Nothing needs
   rebinding when a feed repaints, and adding a name somewhere new is one
   attribute rather than another event listener.
   ===================================================================== */
/* The attribute is data-open-user, NOT data-uid: chat.js already puts data-uid
   on the whole message row, and reusing it would make every click on a message
   body — including the report and delete buttons — open a profile. */
document.addEventListener("click", (ev) => {
  const el = ev.target.closest?.("[data-open-user]");
  if (!el) return;
  const id = el.dataset.openUser;
  if (!id) return;
  ev.preventDefault();
  ev.stopPropagation();
  Profile.open(id);
});

/* A deep link straight to somebody's page: /?open=w-user&u=handle */
function initProfileDeepLink() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("open") === "w-user" && q.get("u")) {
      setTimeout(() => Profile.open(q.get("u")), 900);
    }
  } catch {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProfileDeepLink);
} else {
  initProfileDeepLink();
}
