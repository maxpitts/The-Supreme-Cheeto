/* =====================================================================
   CHEETOCHAT — auth + realtime chat + moderation
   Loads after app.js, so $, esc, showModal, WM etc. are already defined.

   Nothing here is a security boundary. Every rule that matters — rate limits,
   bans, the word filter, the account-age gate, admin powers — is enforced by
   Postgres RLS and SECURITY DEFINER functions. This file only makes the
   database's answers legible to a human. A hostile user skips it entirely and
   talks to the REST API, and gets exactly the same refusals.
   ===================================================================== */
const SB_URL = "https://omtnzapftxdtynqwoitc.supabase.co";
const SB_KEY = "sb_publishable_h8IJNtbwrSABwwx5v30M5Q_E7kahAeT";

let sb = null, me = null, myProfile = null, chatChannel = null, postStatus = null;

/* ---------- boot the client ---------- */
async function initChat() {
  if (!window.supabase) { chatUnavailable("The auth library didn't load."); return; }

  try {
    sb = window.supabase.createClient(SB_URL, SB_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (err) { chatUnavailable(err.message); return; }

  // Paint the signed-out UI immediately. Everything below needs the network,
  // and if Supabase is unreachable the page must still offer sign-in rather
  // than sitting on "Connecting…" forever.
  renderAuthBar();
  renderTrayAccount();

  try {
    const { data } = await sb.auth.getSession();
    me = data?.session?.user || null;
  } catch { me = null; }

  sb.auth.onAuthStateChange(async (_evt, session) => {
    me = session?.user || null;
    await afterAuthChange();
  });

  try {
    await afterAuthChange();
    await loadMessages();
    subscribeRealtime();
  } catch (err) {
    chatUnavailable("Couldn't reach the chat server. " + (err?.message || ""));
    renderAuthBar();
  }
}

// Only ever replace the message log. An earlier version rewrote the whole
// panel, which meant one failed fetch destroyed the sign-in buttons along with
// it — leaving people with no way to log in until they reloaded.
function chatUnavailable(why) {
  const box = $("#chatLog");
  if (box) box.innerHTML = `<div style="color:#900;padding:10px">
    Couldn't load the chat.<br>
    <span style="font-size:11px;color:#555">${esc(why)}</span><br>
    <button class="b95 tiny" id="chatRetry" style="margin-top:8px">Retry</button></div>`;
  const r = $("#chatRetry");
  if (r) r.addEventListener("click", async () => {
    if ($("#chatLog")) $("#chatLog").textContent = "Connecting…";
    try { await loadMessages(); subscribeRealtime(); } catch (e) { chatUnavailable(e?.message || "still unreachable"); }
  });
}

async function afterAuthChange() {
  if (me) {
    try {
      const { data } = await sb.from("cheeto_profiles").select("*").eq("id", me.id).maybeSingle();
      myProfile = data || null;
    } catch { myProfile = null; }
  } else {
    myProfile = null;
  }
  await refreshPostStatus();
  renderAuthBar();
  renderComposer();
  renderAdminTools();
  renderTrayAccount();
  const ai = document.getElementById("adminItem");
  if (ai) ai.hidden = !myProfile?.is_admin;
  if (typeof renderProfileEditor === "function" && !document.getElementById("w-profile")?.hidden) {
    renderProfileEditor();
  }
  // Modules that load after this one listen for this rather than being called
  // by name — the same pattern as cheeto:data, and for the same reason.
  document.dispatchEvent(new CustomEvent("cheeto:auth"));
}

async function refreshPostStatus() {
  if (!sb) return;
  try {
    const { data, error } = await sb.rpc("cheeto_post_status");
    postStatus = error ? null : data;
  } catch { postStatus = null; }
}

/* ---------- auth UI ---------- */
async function signIn(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: location.origin + "/?open=w-chat" },
  });
  if (error) {
    showModal("Sign-in unavailable", "&#9888;",
      `${esc(provider)} sign-in isn't switched on for this site yet.<br><br>
       <span style="color:#555;font-size:11px">${esc(error.message)}</span>`);
  }
}

async function signOut() { await sb.auth.signOut(); }

function renderAuthBar() {
  const bar = $("#chatAuth");
  if (!bar) return;
  if (!me) {
    bar.innerHTML = `
      <div class="login-box">
        <div class="login-title">Sign in to post</div>
        <p style="font-size:11px;margin:0 0 9px;color:#333">
          Reading is open to everyone. An account is only needed to post.</p>
        <div class="login-btns">
          <button class="b95 oauth google" data-p="google"><span>G</span> Sign in with Google</button>
          <button class="b95 oauth discord" data-p="discord"><span>&#9679;</span> Sign in with Discord</button>
        </div>
      </div>`;
    $$(".oauth", bar).forEach((b) => b.addEventListener("click", () => signIn(b.dataset.p)));
  } else {
    const h = myProfile?.handle || me.email || "…";
    bar.innerHTML = `<div class="who">
      <span>Signed in as <b>${esc(h)}</b>${myProfile?.is_admin ? ' <span class="adm">ADMIN</span>' : ""}</span>
      <button class="b95" id="chatOut" style="padding:2px 9px">Sign out</button></div>`;
    $("#chatOut").addEventListener("click", signOut);
  }
}

function renderComposer() {
  const box = $("#chatCompose");
  if (!box) return;
  if (!me) { box.innerHTML = ""; return; }

  const can = postStatus?.can;
  box.innerHTML = `
    <div class="compose">
      <input class="i95" id="chatInput" maxlength="500" placeholder="${can ? "Say something…" : "You can't post right now"}"${can ? "" : " disabled"}>
      <button class="b95" id="chatSend"${can ? "" : " disabled"}>Send</button>
    </div>
    <div class="compose-note" id="chatNote">${can
      ? '<span style="color:#555">500 characters max. Be recognisably a person.</span>'
      : `<span style="color:#900">${esc(postStatus?.reason || "Posting is disabled for your account.")}</span>`}</div>`;

  if (can) {
    const send = () => sendMessage();
    $("#chatSend").addEventListener("click", send);
    $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  }
}

/* ---------- messages ---------- */
async function loadMessages() {
  if (!sb) return;
  const { data, error } = await sb
    .from("cheeto_messages")
    .select("id, body, created_at, user_id, author:cheeto_profiles!cheeto_messages_user_id_fkey ( handle, is_admin )")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { chatUnavailable(error.message); return; }
  renderMessages((data || []).reverse());
}

function renderMessages(rows) {
  const box = $("#chatLog");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div style="color:var(--field-dim);padding:10px">Nobody has said anything yet. The silence is deafening.</div>`;
    return;
  }
  box.innerHTML = rows.map(msgHTML).join("");
  wireMessageActions();
  box.scrollTop = box.scrollHeight;
}

function msgHTML(m) {
  const handle = m.author?.handle || "someone";
  const admin = m.author?.is_admin;
  const t = new Date(m.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const mine = me && m.user_id === me.id;
  const canModerate = myProfile?.is_admin;
  return `<div class="msg" data-mid="${m.id}" data-uid="${esc(m.user_id)}">
    <div class="msg-head">
      <b class="${admin ? "admin" : ""}">${esc(handle)}</b>
      <span class="msg-t">${esc(t)}</span>
      <span class="msg-acts">
        ${me && !mine ? `<button data-report="${m.id}" title="Report">&#9873;</button>` : ""}
        ${canModerate ? `<button data-del="${m.id}" title="Delete">&#128465;</button>
                         <button data-ban="${esc(m.user_id)}" title="Ban user">&#9940;</button>` : ""}
      </span>
    </div>
    <div class="msg-body">${esc(m.body)}</div>
  </div>`;
}

function appendMessage(m) {
  const box = $("#chatLog");
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (box.querySelector("div[style]") && !box.querySelector(".msg")) box.innerHTML = "";
  box.insertAdjacentHTML("beforeend", msgHTML(m));
  wireMessageActions();
  if (atBottom) box.scrollTop = box.scrollHeight;   // don't yank people out of scrollback
}

async function sendMessage() {
  const input = $("#chatInput");
  const body = (input.value || "").trim();
  if (!body) return;
  input.value = "";

  const { error } = await sb.from("cheeto_messages").insert({ user_id: me.id, body });
  if (error) {
    // Translate the database's refusal into something a human can act on.
    await refreshPostStatus();
    const note = $("#chatNote");
    const why = /blocked_word|check_violation/i.test(error.message)
      ? "That message contains a blocked word."
      : postStatus?.reason || error.message;
    if (note) note.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    input.value = body;                       // never silently eat what they typed
    renderComposer();
    return;
  }
  await refreshPostStatus();
  renderComposer();
  setTimeout(() => $("#chatInput")?.focus(), 0);
}

function subscribeRealtime() {
  if (!sb || chatChannel) return;
  chatChannel = sb
    .channel("cheeto-chat")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "cheeto_messages" },
      async (payload) => {
        const row = payload.new;
        if (row.deleted_at) return;
        const { data } = await sb.from("cheeto_profiles")
          .select("handle, is_admin").eq("id", row.user_id).maybeSingle();
        appendMessage({ ...row, author: data || null });
      })
    .subscribe();
}

/* ---------- reporting + moderation ---------- */
function wireMessageActions() {
  $$("[data-report]").forEach((b) => b.onclick = () => reportMessage(+b.dataset.report));
  $$("[data-del]").forEach((b) => b.onclick = () => adminDelete(+b.dataset.del));
  $$("[data-ban]").forEach((b) => b.onclick = () => adminBan(b.dataset.ban));
}

async function reportMessage(id) {
  const reason = prompt("What's wrong with this message?");
  if (!reason) return;
  const { error } = await sb.from("cheeto_reports")
    .insert({ message_id: id, reporter_id: me.id, reason: reason.slice(0, 300) });
  showModal(error ? "Report failed" : "Reported", error ? "&#9888;" : "&#9873;",
    error
      ? (/duplicate|unique/i.test(error.message)
          ? "You've already reported this message."
          : esc(error.message))
      : "Thanks — it's in the moderation queue.");
}

async function adminDelete(id) {
  const { error } = await sb.rpc("cheeto_admin_delete", { msg_id: id });
  if (error) return showModal("Couldn't delete", "&#9888;", esc(error.message));
  const el = document.querySelector(`.msg[data-mid="${id}"]`);
  if (el) el.remove();
}

async function adminBan(uid) {
  const why = prompt("Ban reason (shown to the user):");
  if (why === null) return;
  const hrs = prompt("Ban for how many hours? Leave blank for permanent.");
  const hours = hrs && hrs.trim() ? parseInt(hrs, 10) : null;
  const { error } = await sb.rpc("cheeto_admin_ban",
    { target: uid, why: why || "No reason given", hours: isFinite(hours) ? hours : null });
  showModal(error ? "Ban failed" : "Banned", error ? "&#9888;" : "&#9940;",
    error ? esc(error.message) : "That account can no longer post.");
}

/* ---------- admin: report queue ---------- */
function renderAdminTools() {
  const box = $("#chatAdmin");
  if (!box) return;
  if (!myProfile?.is_admin) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<fieldset><legend>&#128737; Moderation</legend>
      <button class="b95" id="chatQueue" style="padding:3px 10px">Open report queue</button>
      <div id="chatQueueOut" style="margin-top:8px"></div></fieldset>`;
  $("#chatQueue").addEventListener("click", loadQueue);
}

async function loadQueue() {
  const out = $("#chatQueueOut");
  out.innerHTML = "Loading…";
  const { data, error } = await sb.from("cheeto_reports")
    .select("id, reason, created_at, message_id, cheeto_messages!cheeto_reports_message_id_fkey ( body, user_id )")
    .is("resolved_at", null).order("created_at", { ascending: false }).limit(40);
  if (error) { out.innerHTML = `<span style="color:#900">${esc(error.message)}</span>`; return; }
  if (!data.length) { out.innerHTML = '<span style="color:#060">Queue is empty.</span>'; return; }
  out.innerHTML = data.map((r) => `
    <div class="qrow">
      <div style="font-size:11px;color:#555">${esc(new Date(r.created_at).toLocaleString())}</div>
      <div class="qbody">${esc(r.cheeto_messages?.body || "(message gone)")}</div>
      <div style="font-size:11px"><b>Reason:</b> ${esc(r.reason)}</div>
      <div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">
        <button class="b95 tiny" data-qdel="${r.message_id}">Delete message</button>
        <button class="b95 tiny" data-qban="${esc(r.cheeto_messages?.user_id || "")}">Ban author</button>
        <button class="b95 tiny" data-qok="${r.id}">Dismiss</button>
      </div>
    </div>`).join("");
  $$("[data-qdel]", out).forEach((b) => b.onclick = () => adminDelete(+b.dataset.qdel));
  $$("[data-qban]", out).forEach((b) => b.onclick = () => adminBan(b.dataset.qban));
  $$("[data-qok]", out).forEach((b) => b.onclick = async () => {
    await sb.from("cheeto_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: me.id })
      .eq("id", +b.dataset.qok);
    loadQueue();
  });
}

/* chat.js is loaded after app.js, so everything it depends on already exists.
   Self-initialise here rather than being called from app.js's start(). */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initChat());
} else {
  initChat();
}

/* =====================================================================
   TASKBAR ACCOUNT CHIP
   The sign-in buttons live inside the CheetoChat window, which is closed by
   default — so there was no visible way to log in at all. This chip is always
   on screen and reflects auth state.
   ===================================================================== */
function renderTrayAccount() {
  const chip = $("#trayAccount");
  if (!chip) return;
  if (me) {
    const h = myProfile?.handle || "account";
    chip.textContent = "\u{1F464} " + h;
    chip.title = "Signed in as " + h + " — click to open CheetoChat";
    chip.classList.add("in");
  } else {
    chip.textContent = "\u{1F464} Sign in";
    chip.title = "Sign in to post in CheetoChat";
    chip.classList.remove("in");
  }
}

(function wireTrayAccount() {
  const chip = document.getElementById("trayAccount");
  if (!chip) return;
  chip.addEventListener("click", () => {
    WM.open("w-chat");
    // nudge focus to the sign-in buttons for people arriving cold
    setTimeout(() => document.querySelector("#chatAuth .oauth")?.focus(), 260);
  });
})();
