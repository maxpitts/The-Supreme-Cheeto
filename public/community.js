/* =====================================================================
   COMMUNITY — profile editor, bulletin board, admin panel
   Loads after chat.js and shares its `sb` / `me` / `myProfile` state.

   Same rule as chat.js: this file is presentation only. Link validation,
   rate limits, ban enforcement, admin authority and the word filter all live
   in Postgres. Anything here is a convenience, not a control.
   ===================================================================== */

/* ---------------------------------------------------------------- PROFILE */
async function openProfile() {
  if (!me) { WM.open("w-chat"); return; }
  WM.open("w-profile");
  await renderProfileEditor();
}

async function renderProfileEditor() {
  const box = $("#profileBody");
  if (!box || !sb) return;
  if (!me) {
    box.innerHTML = `<div class="sunken">Sign in to set up a profile.</div>`;
    return;
  }
  const { data: p } = await sb.from("cheeto_profiles").select("*").eq("id", me.id).maybeSingle();
  myProfile = p || myProfile;
  const links = Array.isArray(p?.links) ? p.links : [];

  box.innerHTML = `
    <div class="prof-head">
      <img class="prof-pfp" id="profPfp" src="${esc(p?.avatar_url || "/logo.svg")}" alt="" width="64" height="64">
      <div>
        <div class="prof-handle">@${esc(p?.handle || "…")}</div>
        <div class="note" style="margin:2px 0 0">Joined ${p ? new Date(p.created_at).toLocaleDateString() : "—"}
          ${p?.is_admin ? '· <span class="adm">ADMIN</span>' : ""}</div>
      </div>
    </div>

    <fieldset><legend>Display name</legend>
      <input class="i95" id="pfName" maxlength="40" value="${esc(p?.display_name || "")}" placeholder="Shown instead of your handle">
    </fieldset>

    <fieldset><legend>Profile picture (URL)</legend>
      <input class="i95" id="pfAvatar" maxlength="300" value="${esc(p?.avatar_url || "")}" placeholder="https://…">
      <p class="note">Must be a direct https link to an image. Left blank, you get the Cheeto.</p>
    </fieldset>

    <fieldset><legend>Bio</legend>
      <textarea class="i95" id="pfBio" rows="3" maxlength="300" placeholder="300 characters. Be interesting.">${esc(p?.bio || "")}</textarea>
      <div class="note" id="pfBioCount"></div>
    </fieldset>

    <fieldset><legend>Links (up to 5)</legend>
      <div id="pfLinks"></div>
      <button class="b95 tiny" id="pfAddLink" style="margin-top:6px">+ Add link</button>
      <p class="note">http/https only. The database rejects anything else, so don't bother trying.</p>
    </fieldset>

    <div style="display:flex;gap:8px;align-items:center">
      <button class="b95" id="pfSave">Save profile</button>
      <span id="pfMsg" class="note" style="margin:0"></span>
    </div>`;

  const linkBox = $("#pfLinks");
  const addRow = (l = { label: "", url: "" }) => {
    if (linkBox.children.length >= 5) return;
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `<input class="i95 lk-label" maxlength="30" placeholder="Label" value="${esc(l.label || "")}">
      <input class="i95 lk-url" maxlength="300" placeholder="https://…" value="${esc(l.url || "")}">
      <button class="b95 tiny lk-del" title="Remove">&times;</button>`;
    row.querySelector(".lk-del").addEventListener("click", () => row.remove());
    linkBox.appendChild(row);
  };
  links.slice(0, 5).forEach(addRow);
  if (!links.length) addRow();
  $("#pfAddLink").addEventListener("click", () => addRow());

  const counter = () => {
    const n = ($("#pfBio").value || "").length;
    $("#pfBioCount").textContent = `${n}/300`;
  };
  $("#pfBio").addEventListener("input", counter); counter();

  $("#pfAvatar").addEventListener("input", () => {
    const v = $("#pfAvatar").value.trim();
    $("#profPfp").src = /^https?:\/\//i.test(v) ? v : "/logo.svg";
  });
  $("#profPfp").addEventListener("error", () => { $("#profPfp").src = "/logo.svg"; });

  $("#pfSave").addEventListener("click", saveProfile);
}

async function saveProfile() {
  const msg = $("#pfMsg");
  const rows = [...document.querySelectorAll("#pfLinks .link-row")];
  const links = rows.map((r) => ({
    label: r.querySelector(".lk-label").value.trim().slice(0, 30),
    url: r.querySelector(".lk-url").value.trim(),
  })).filter((l) => l.url);

  const bad = links.find((l) => !/^https?:\/\//i.test(l.url));
  if (bad) { msg.innerHTML = `<span style="color:#900">Links must start with http:// or https://</span>`; return; }

  const avatar = $("#pfAvatar").value.trim();
  if (avatar && !/^https?:\/\//i.test(avatar)) {
    msg.innerHTML = `<span style="color:#900">Profile picture must be an http(s) URL.</span>`; return;
  }

  msg.textContent = "Saving…";
  const { error } = await sb.from("cheeto_profiles").update({
    display_name: $("#pfName").value.trim() || null,
    bio: $("#pfBio").value.trim() || null,
    avatar_url: avatar || null,
    links,
  }).eq("id", me.id);

  if (error) {
    msg.innerHTML = `<span style="color:#900">${esc(error.message)}</span>`;
    return;
  }
  msg.innerHTML = `<span style="color:#060">Saved.</span>`;
  await afterAuthChange();
  setTimeout(() => { if (msg) msg.textContent = ""; }, 2500);
}

/* ------------------------------------------------------------- BULLETIN */
let boardOpenPost = null;

async function loadBoard() {
  const box = $("#boardBody");
  if (!box || !sb) return;
  box.innerHTML = `<div class="note">Loading…</div>`;

  const { data, error } = await sb
    .from("cheeto_posts")
    .select("id, title, body, created_at, pinned, user_id, author:cheeto_profiles!cheeto_posts_user_id_fkey ( handle, display_name, avatar_url, is_admin )")
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    box.innerHTML = `<div class="sunken" style="color:#900">Couldn't load the board.<br>
      <span class="note">${esc(error.message)}</span></div>`;
    return;
  }

  const composer = me
    ? `<fieldset><legend>New post</legend>
         <input class="i95" id="bpTitle" maxlength="120" placeholder="Title">
         <textarea class="i95" id="bpBody" rows="3" maxlength="4000" placeholder="Say your piece…" style="margin-top:6px"></textarea>
         <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
           <button class="b95" id="bpPost">Post to board</button>
           <span class="note" id="bpMsg" style="margin:0"></span>
         </div>
       </fieldset>`
    : `<div class="sunken" style="margin-bottom:9px">Sign in to post. Reading is open to everyone.
         <button class="b95 tiny" id="bpSignin" style="margin-left:6px">Sign in</button></div>`;

  box.innerHTML = composer + (data.length
    ? `<div id="boardList">${data.map(boardRow).join("")}</div>`
    : `<div class="note">Nothing on the board yet. Be the first.</div>`);

  if (me) $("#bpPost").addEventListener("click", submitBoardPost);
  else $("#bpSignin").addEventListener("click", () => WM.open("w-chat"));

  $$("[data-open-post]").forEach((b) =>
    b.addEventListener("click", () => openThread(+b.dataset.openPost)));
  $$("[data-del-post]").forEach((b) =>
    b.addEventListener("click", () => adminDeletePost(+b.dataset.delPost)));
}

function boardRow(p) {
  const who = p.author?.display_name || p.author?.handle || "someone";
  const when = new Date(p.created_at).toLocaleString("en-US",
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const snippet = p.body.length > 150 ? p.body.slice(0, 150) + "…" : p.body;
  return `<div class="bpost">
    <div class="bpost-head">
      ${p.pinned ? '<span class="pin">PINNED</span>' : ""}
      <b>${esc(p.title)}</b>
    </div>
    <div class="note" style="margin:2px 0">
      by <b>${esc(who)}</b>${p.author?.is_admin ? ' <span class="adm">ADMIN</span>' : ""} · ${esc(when)}
    </div>
    <div class="bpost-body">${esc(snippet)}</div>
    <div style="margin-top:5px;display:flex;gap:6px">
      <button class="b95 tiny" data-open-post="${p.id}">Open</button>
      ${myProfile?.is_admin ? `<button class="b95 tiny" data-del-post="${p.id}">Delete</button>` : ""}
    </div>
  </div>`;
}

async function submitBoardPost() {
  const t = $("#bpTitle").value.trim(), b = $("#bpBody").value.trim();
  const msg = $("#bpMsg");
  if (t.length < 3) { msg.innerHTML = '<span style="color:#900">Title needs 3+ characters.</span>'; return; }
  if (!b) { msg.innerHTML = '<span style="color:#900">Write something.</span>'; return; }
  msg.textContent = "Posting…";
  const { error } = await sb.from("cheeto_posts").insert({ user_id: me.id, title: t, body: b });
  if (error) {
    const why = /blocked_word|check_violation/i.test(error.message)
      ? "That post contains a blocked word."
      : /row-level security/i.test(error.message)
        ? "You can't post to the board right now — new accounts wait 10 minutes, and there's a 5-per-hour limit."
        : error.message;
    msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    return;
  }
  await loadBoard();
}

async function openThread(id) {
  boardOpenPost = id;
  const box = $("#boardBody");
  box.innerHTML = `<div class="note">Loading…</div>`;
  const { data: post } = await sb.from("cheeto_posts")
    .select("id, title, body, created_at, user_id, author:cheeto_profiles!cheeto_posts_user_id_fkey ( handle, display_name, is_admin )")
    .eq("id", id).maybeSingle();
  const { data: replies } = await sb.from("cheeto_post_replies")
    .select("id, body, created_at, user_id, author:cheeto_profiles!cheeto_post_replies_user_id_fkey ( handle, display_name, is_admin )")
    .eq("post_id", id).is("deleted_at", null).order("created_at");

  if (!post) { loadBoard(); return; }
  const who = post.author?.display_name || post.author?.handle || "someone";

  box.innerHTML = `
    <button class="b95 tiny" id="bpBack">&larr; Back to board</button>
    <div class="bpost" style="margin-top:9px">
      <div class="bpost-head"><b>${esc(post.title)}</b></div>
      <div class="note" style="margin:2px 0">by <b>${esc(who)}</b> · ${esc(new Date(post.created_at).toLocaleString())}</div>
      <div class="bpost-body" style="white-space:pre-wrap">${esc(post.body)}</div>
    </div>
    <div style="margin-top:9px">${(replies || []).map(replyRow).join("") ||
      '<div class="note">No replies yet.</div>'}</div>
    ${me ? `<fieldset style="margin-top:9px"><legend>Reply</legend>
       <textarea class="i95" id="brBody" rows="2" maxlength="2000" placeholder="Reply…"></textarea>
       <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
         <button class="b95" id="brSend">Reply</button><span class="note" id="brMsg" style="margin:0"></span>
       </div></fieldset>` : ""}`;

  $("#bpBack").addEventListener("click", loadBoard);
  if (me) $("#brSend").addEventListener("click", async () => {
    const body = $("#brBody").value.trim();
    const m = $("#brMsg");
    if (!body) return;
    m.textContent = "Sending…";
    const { error } = await sb.from("cheeto_post_replies")
      .insert({ post_id: id, user_id: me.id, body });
    if (error) {
      m.innerHTML = `<span style="color:#900">${esc(
        /blocked_word|check_violation/i.test(error.message) ? "Blocked word." : error.message)}</span>`;
      return;
    }
    openThread(id);
  });
}

function replyRow(r) {
  const who = r.author?.display_name || r.author?.handle || "someone";
  return `<div class="breply">
    <div class="note" style="margin:0"><b>${esc(who)}</b>${r.author?.is_admin ? ' <span class="adm">ADMIN</span>' : ""}
      · ${esc(new Date(r.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</div>
    <div style="white-space:pre-wrap;font-size:12px;margin-top:2px">${esc(r.body)}</div>
  </div>`;
}

async function adminDeletePost(id) {
  const { error } = await sb.rpc("cheeto_admin_delete_post", { post_id: id });
  if (error) return showModal("Couldn't delete", "&#9888;", esc(error.message));
  loadBoard();
}

/* ---------------------------------------------------------------- ADMIN */
async function openAdmin() {
  if (!myProfile?.is_admin) {
    showModal("Admins only", "&#128274;", "This panel is only visible to administrators.");
    return;
  }
  WM.open("w-admin");
  await loadHealth();
  await loadUsers();
}

async function loadHealth() {
  const box = $("#admHealth");
  if (!box) return;
  box.innerHTML = `<div class="note">Loading…</div>`;
  const { data, error } = await sb.rpc("cheeto_site_health");
  if (error) { box.innerHTML = `<span style="color:#900">${esc(error.message)}</span>`; return; }
  const cell = (label, val, warn) =>
    `<div class="stat${warn ? " warn" : ""}"><span>${esc(label)}</span><b>${esc(String(val ?? "—"))}</b></div>`;
  box.innerHTML = `<div class="statgrid">
    ${cell("Users", data.users_total)}
    ${cell("New (24h)", data.users_24h)}
    ${cell("Banned", data.users_banned, data.users_banned > 0)}
    ${cell("Admins", data.admins)}
    ${cell("Messages", data.messages_total)}
    ${cell("Msgs (24h)", data.messages_24h)}
    ${cell("Msgs (1h)", data.messages_1h)}
    ${cell("Deleted", data.messages_deleted)}
    ${cell("Board posts", data.posts_total)}
    ${cell("Replies", data.replies_total)}
    ${cell("Open reports", data.reports_open, data.reports_open > 0)}
    ${cell("DB size", data.db_size)}
  </div>
  <div class="note">Last message ${data.last_message_at
    ? new Date(data.last_message_at).toLocaleString() : "never"} ·
    server time ${new Date(data.server_time).toLocaleTimeString()}</div>`;
}

async function loadUsers(q = "") {
  const box = $("#admUsers");
  if (!box) return;
  box.innerHTML = `<div class="note">Loading…</div>`;
  const { data, error } = await sb.rpc("cheeto_admin_users", { q, lim: 100 });
  if (error) { box.innerHTML = `<span style="color:#900">${esc(error.message)}</span>`; return; }
  if (!data.length) { box.innerHTML = `<div class="note">No users match.</div>`; return; }

  box.innerHTML = data.map((u) => `
    <div class="urow${u.is_banned ? " banned" : ""}">
      <div class="urow-main">
        <b>@${esc(u.handle)}</b>
        ${u.is_admin ? '<span class="adm">ADMIN</span>' : ""}
        ${u.is_banned ? '<span class="ban">BANNED</span>' : ""}
        ${u.muted_until && new Date(u.muted_until) > new Date() ? '<span class="mute">MUTED</span>' : ""}
        <div class="note" style="margin:2px 0 0">${esc(u.email || "")} ·
          ${u.msg_count} msgs · ${u.post_count} posts · joined ${new Date(u.created_at).toLocaleDateString()}</div>
        ${u.ban_reason ? `<div class="note" style="color:#900;margin:1px 0 0">${esc(u.ban_reason)}</div>` : ""}
      </div>
      <div class="urow-acts">
        ${u.is_banned
          ? `<button class="b95 tiny" data-unban="${esc(u.id)}">Unban</button>`
          : `<button class="b95 tiny" data-ban2="${esc(u.id)}">Ban</button>
             <button class="b95 tiny" data-mute="${esc(u.id)}">Mute</button>`}
        <button class="b95 tiny" data-admin="${esc(u.id)}" data-is="${u.is_admin}">
          ${u.is_admin ? "Demote" : "Promote"}</button>
      </div>
    </div>`).join("");

  const refresh = () => loadUsers($("#admSearch")?.value || "");
  $$("[data-ban2]", box).forEach((b) => b.onclick = async () => { await adminBan(b.dataset.ban2); refresh(); });
  $$("[data-unban]", box).forEach((b) => b.onclick = async () => {
    const { error } = await sb.rpc("cheeto_admin_unban", { target: b.dataset.unban });
    if (error) showModal("Failed", "&#9888;", esc(error.message)); else refresh();
  });
  $$("[data-mute]", box).forEach((b) => b.onclick = async () => {
    const m = prompt("Mute for how many minutes? (blank or 0 to unmute)");
    if (m === null) return;
    const { error } = await sb.rpc("cheeto_admin_mute",
      { target: b.dataset.mute, minutes: parseInt(m, 10) || 0 });
    if (error) showModal("Failed", "&#9888;", esc(error.message)); else refresh();
  });
  $$("[data-admin]", box).forEach((b) => b.onclick = async () => {
    const makeAdmin = b.dataset.is !== "true";
    if (!confirm(makeAdmin ? "Promote this user to admin?" : "Remove admin from this user?")) return;
    const { error } = await sb.rpc("cheeto_admin_set_admin",
      { target: b.dataset.admin, make_admin: makeAdmin });
    if (error) showModal("Failed", "&#9888;", esc(error.message)); else refresh();
  });
}

function initCommunity() {
  const s = $("#admSearch");
  if (s) {
    let t;
    s.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => loadUsers(s.value), 280); });
  }
  $("#admRefresh")?.addEventListener("click", () => { loadHealth(); loadUsers($("#admSearch")?.value || ""); });
  $("#admQueue")?.addEventListener("click", () => { WM.open("w-chat"); setTimeout(() => $("#chatQueue")?.click(), 400); });
  $("#boardRefresh")?.addEventListener("click", loadBoard);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCommunity);
} else {
  initCommunity();
}
