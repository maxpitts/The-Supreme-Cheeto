/* =====================================================================
   PEOPLE — a directory, and the first sixty seconds
   Two features in one file because they are the same problem seen twice:
   a new account has nowhere to start.

   DIRECTORY. cheeto_find_users() already existed but only answered "is there
   someone called X", so you had to know a name before you could use it. With
   profiles, walls and Top 8s live, there was no front door to any of it.

   GETTING STARTED. A new account lands as @cheeto7 with no picture, an empty
   buddy list, an empty wall and nothing on the board — every surface an empty
   state, none of them suggesting what to do. That is the moment people leave.

   The checklist is a checklist rather than a wizard on purpose: nothing is
   forced, nothing is modal, each item opens the real window that does the
   real thing, and it ticks itself off from actual state rather than from
   "did the user click through this step". Someone who set a username last
   week sees it already done.
   ===================================================================== */

const People = {
  mode: "online",
  rows: [],
  loading: false,

  async open(mode) {
    // Set the mode BEFORE opening. WM.open's hook calls load() immediately,
    // so setting it afterwards meant that first load ran with the old mode —
    // and the loading guard then swallowed the correct one. Asking for
    // "Most active" quietly showed you whoever happened to be online.
    if (mode) this.mode = mode;
    WM.open("w-people");
    await this.load();
  },

  async load() {
    const box = document.getElementById("peopleBody");
    if (!sb) { if (box) box.innerHTML = `<div class="note">The directory needs the database, which didn't load.</div>`; return; }
    // A request arriving mid-flight is queued rather than dropped, so the last
    // mode asked for is always the one on screen.
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    if (box && !this.rows.length) box.innerHTML = `<div class="note">Loading…</div>`;
    try {
      const { data, error } = await sb.rpc("cheeto_directory", { mode: this.mode, lim: 30 });
      this.rows = (error || !Array.isArray(data)) ? [] : data;
    } catch { this.rows = []; }
    this.loading = false;
    if (this.again) { this.again = false; return this.load(); }
    this.render();
  },

  render() {
    const box = document.getElementById("peopleBody");
    if (!box) return;
    const TABS = [["online", "Here now"], ["active", "Most active"], ["new", "Newest"]];

    box.innerHTML = `
      <div class="pp-tabs">${TABS.map(([k, l]) =>
        `<button class="b95 tiny pp-tab${this.mode === k ? " on" : ""}" data-pp="${k}">${l}</button>`).join("")}</div>
      ${this.rows.length ? `<div class="pp-list">${this.rows.map((r) => this.row(r)).join("")}</div>`
        : `<div class="note">${this.mode === "online"
            ? "Nobody else is here this second. Try <b>Most active</b> or <b>Newest</b> — and the count in the taskbar tells you when that changes."
            : "Nobody to show yet."}</div>`}
      <p class="note">Anyone with an account appears here. Being listed isn't optional,
      but nothing here is private &mdash; it's the same handle and bio your profile already shows.</p>`;

    box.querySelectorAll("[data-pp]").forEach((b) =>
      b.addEventListener("click", async () => { this.mode = b.dataset.pp; this.rows = []; await this.load(); }));
    box.querySelectorAll("[data-pp-add]").forEach((b) =>
      b.addEventListener("click", () => this.add(b.dataset.ppAdd, b)));
    WM.fit?.("w-people");
  },

  row(r) {
    const name = r.display_name || r.handle;
    const btn = r.friendship === "self" ? `<span class="note" style="margin:0">you</span>`
      : r.friendship === "friends" ? `<span class="pp-fr">&#10003;</span>`
      : r.friendship === "pending" ? `<span class="note" style="margin:0">pending</span>`
      : me ? `<button class="b95 tiny" data-pp-add="${esc(r.id)}">Add</button>` : "";

    return `<div class="pp-row">
      <span class="dot ${r.is_online ? "available" : "offline"}"></span>
      <img class="pp-av" src="${esc(r.avatar_url || "/logo.svg")}" alt="" width="26" height="26"
           loading="lazy" onerror="this.src='/logo.svg'">
      <div class="pp-b">
        <button class="linky" data-open-user="${esc(r.id)}">${esc(name)}</button>
        <div class="pp-m">${r.friends} friend${r.friends === 1 ? "" : "s"}${
          r.posts ? ` &middot; ${r.posts} post${r.posts === 1 ? "" : "s"}` : ""}</div>
        ${r.bio ? `<div class="pp-bio">${esc(String(r.bio).slice(0, 70))}</div>` : ""}
      </div>
      ${btn}
    </div>`;
  },

  async add(id, btn) {
    if (!me) { promptSignIn("Sign in to add friends."); return; }
    btn.disabled = true; btn.textContent = "…";
    try {
      const { data, error } = await sb.rpc("cheeto_friend_request", { target: id });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || "refused");
      btn.outerHTML = `<span class="note" style="margin:0">pending</span>`;
      Welcome.refresh();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Add";
      showModal("Couldn't add them", "&#9888;", esc(err?.message || "The database refused it."));
    }
  },
};


/* =====================================================================
   GETTING STARTED
   ===================================================================== */
const Welcome = {
  KEY: "cheeto_welcome_done",
  suggestions: [],

  dismissed() {
    try { return localStorage.getItem(this.KEY) === (me?.id || "-"); } catch { return false; }
  },
  dismiss() {
    try { localStorage.setItem(this.KEY, me?.id || "-"); } catch {}
    // WM.close takes a window RECORD, not an id — passing a string throws and
    // leaves the window sitting there, which is the opposite of dismissing it.
    const rec = WM.byId?.("w-welcome");
    if (rec) WM.close(rec);
    const el = document.getElementById("w-welcome");
    if (el) el.hidden = true;
  },

  /* A generated handle, or a bare account made in the last day, is what
     "new" means here — not a flag we set, so it stays true after a reload
     and false the moment they actually fill something in. */
  isNew() {
    if (!me || !myProfile) return false;
    if (/^cheeto\d*$/i.test(myProfile.handle || "")) return true;
    const fresh = Date.now() - Date.parse(myProfile.created_at || 0) < 864e5;
    return fresh && !myProfile.avatar_url && !myProfile.bio;
  },

  steps() {
    const p = myProfile || {};
    return [
      { id: "name", done: !/^cheeto\d*$/i.test(p.handle || "x"),
        label: "Pick a username", why: `You're <b>@${esc(p.handle || "cheeto")}</b> right now, which nobody will recognise.`,
        act: () => openProfile(), btn: "Choose one" },
      { id: "pic", done: Boolean(p.avatar_url),
        label: "Add a picture", why: "Drop any image on the profile editor &mdash; it gets cropped square for you.",
        act: () => openProfile(), btn: "Add one" },
      { id: "friend", done: this.friendCount > 0,
        label: "Add someone", why: "Statuses and the buddy list only do anything once you have a friend.",
        act: () => People.open("active"), btn: "Find people" },
      { id: "guess", done: this.guessed,
        label: "Guess the debt", why: "One guess a day, scored against the Treasury. It's the fastest way onto a leaderboard.",
        act: () => WM.open("w-debt"), btn: "Have a go" },
      { id: "say", done: this.posted,
        label: "Say something", why: "The chat room, or a post on the feed. Either counts.",
        act: () => WM.open("w-chat"), btn: "Open chat" },
    ];
  },

  friendCount: 0,
  guessed: false,
  posted: false,

  async refresh() {
    if (!sb || !me) return;
    try {
      const [f, g, s] = await Promise.all([
        sb.rpc("cheeto_buddy_list"),
        sb.rpc("cheeto_my_guess_stats"),
        sb.rpc("cheeto_directory", { mode: "active", lim: 6 }),
      ]);
      this.friendCount = Array.isArray(f.data) ? f.data.length : 0;
      this.guessed = Boolean(g.data?.plays);
      this.suggestions = (Array.isArray(s.data) ? s.data : [])
        .filter((r) => r.friendship === "none").slice(0, 3);
      // "posted" is cheap to approximate and not worth a round trip of its own.
      this.posted = Boolean(myProfile?.bio) || this.friendCount > 0;
    } catch {}
    this.render();
  },

  async maybeOpen() {
    if (!me || this.dismissed() || !this.isNew()) return;
    await this.refresh();
    WM.open("w-welcome");
    this.render();
  },

  render() {
    const box = document.getElementById("welcomeBody");
    if (!box) return;
    const steps = this.steps();
    const done = steps.filter((s) => s.done).length;

    box.innerHTML = `
      <div class="wc-head">
        <div class="wc-bar"><span style="width:${Math.round((done / steps.length) * 100)}%"></span></div>
        <div class="note" style="margin:4px 0 0">${done} of ${steps.length} done</div>
      </div>
      <div class="wc-steps">${steps.map((s) => `
        <div class="wc-step${s.done ? " done" : ""}">
          <span class="wc-tick">${s.done ? "&#10003;" : "&#9633;"}</span>
          <div class="wc-t"><b>${s.label}</b>${s.done ? "" : `<div class="note">${s.why}</div>`}</div>
          ${s.done ? "" : `<button class="b95 tiny" data-wc="${s.id}">${s.btn}</button>`}
        </div>`).join("")}</div>

      ${this.suggestions.length ? `<fieldset style="margin-top:10px"><legend>People to add</legend>
        ${this.suggestions.map((r) => `<div class="pp-row">
          <span class="dot ${r.is_online ? "available" : "offline"}"></span>
          <img class="pp-av" src="${esc(r.avatar_url || "/logo.svg")}" alt="" width="26" height="26"
               loading="lazy" onerror="this.src='/logo.svg'">
          <div class="pp-b"><button class="linky" data-open-user="${esc(r.id)}">${esc(r.display_name || r.handle)}</button>
            <div class="pp-m">${r.friends} friend${r.friends === 1 ? "" : "s"}</div></div>
          <button class="b95 tiny" data-pp-add="${esc(r.id)}">Add</button>
        </div>`).join("")}</fieldset>` : ""}

      <div style="margin-top:11px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">
        <button class="b95" id="wcDone">${done === steps.length ? "All done" : "Hide this"}</button>
        <span class="note" style="margin:0">You can reopen it from the Start menu.</span>
      </div>`;

    box.querySelectorAll("[data-wc]").forEach((b) => b.addEventListener("click", () => {
      const s = steps.find((x) => x.id === b.dataset.wc);
      if (s) s.act();
    }));
    box.querySelectorAll("[data-pp-add]").forEach((b) =>
      b.addEventListener("click", () => People.add(b.dataset.ppAdd, b)));
    box.querySelector("#wcDone")?.addEventListener("click", () => this.dismiss());
    WM.fit?.("w-welcome");
  },
};

/* The checklist reads real state, so anything that changes that state should
   make it recount rather than sit there showing a stale tick. */
document.addEventListener("cheeto:auth", () => {
  Welcome.friendCount = 0; Welcome.guessed = false;
  setTimeout(() => Welcome.maybeOpen(), 1200);
});

function initPeople() {
  setTimeout(() => Welcome.maybeOpen(), 2500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPeople);
} else {
  initPeople();
}
