/* =====================================================================
   CALL IT — the prediction game
   Loads after chat.js, so it reuses that file's Supabase client (`sb`) and
   session (`me`, `myProfile`) rather than opening a second connection.

   The client cannot decide anything that matters. Questions are opened and
   scored by the scheduled Netlify job against figures IT fetched; picks are
   insertable only by their owner, only before closes_at, and only if
   cheeto_can_post() passes — all enforced in Postgres. This file draws the
   database's answers. A hostile user who skips it gets the same refusals.
   ===================================================================== */

let PG = {
  open: [],          // questions still taking picks
  recent: [],        // last few resolved, so the game has a memory
  picks: {},         // prediction_id -> choice, for the signed-in user
  record: null,      // { correct, resolved, pending }
  board: [],
  loading: false,
  loadedAt: 0,
};

/* ---------------------------------------------------------------- load */
async function loadPredictions(force) {
  if (!sb) { paintPredict("The database client didn't load."); return; }
  if (PG.loading) return;
  if (!force && Date.now() - PG.loadedAt < 20000) { paintPredict(); return; }

  PG.loading = true;
  try {
    const nowISO = new Date().toISOString();

    const [openRes, recentRes] = await Promise.all([
      sb.from("cheeto_predictions")
        .select("id, kind, prompt, option_a, option_b, closes_at")
        .is("resolved_at", null).gt("closes_at", nowISO)
        .order("closes_at", { ascending: true }),
      sb.from("cheeto_predictions")
        .select("id, prompt, option_a, option_b, outcome, outcome_note, resolved_at")
        .not("resolved_at", "is", null)
        .order("resolved_at", { ascending: false }).limit(4),
    ]);
    if (openRes.error) throw openRes.error;
    PG.open = openRes.data || [];
    PG.recent = recentRes.error ? [] : (recentRes.data || []);

    PG.picks = {};
    PG.record = null;
    if (me) {
      const ids = [...PG.open, ...PG.recent].map((q) => q.id);
      const [mine, rec] = await Promise.all([
        ids.length
          ? sb.from("cheeto_picks").select("prediction_id, choice").eq("user_id", me.id).in("prediction_id", ids)
          : Promise.resolve({ data: [] }),
        sb.rpc("cheeto_my_record"),
      ]);
      (mine.data || []).forEach((p) => { PG.picks[p.prediction_id] = p.choice; });
      if (!rec.error) PG.record = rec.data;
    }

    const lb = await sb.rpc("cheeto_leaderboard", { lim: 10 });
    PG.board = lb.error ? [] : (lb.data || []);

    PG.loadedAt = Date.now();
    paintPredict();
  } catch (err) {
    paintPredict(err?.message || "couldn't reach the server");
  } finally {
    PG.loading = false;
  }
}

/* ---------------------------------------------------------------- paint */
function paintPredict(errMsg) {
  const box = $("#predictBody");
  if (!box) return;

  if (errMsg) {
    box.innerHTML = `<div style="padding:10px;color:#900;font-size:12px">
      Couldn't load the game.<br>
      <span style="font-size:11px;color:#555">${esc(errMsg)}</span><br>
      <button class="b95 tiny" id="pgRetry" style="margin-top:8px">Retry</button></div>`;
    $("#pgRetry")?.addEventListener("click", () => loadPredictions(true));
    return;
  }

  box.innerHTML = `
    ${recordHTML()}
    <div class="pg-sec">TODAY'S CALLS</div>
    ${PG.open.length ? PG.open.map(openHTML).join("") : `<div class="note">
       No questions open right now. New ones are posted automatically when the
       tracker refreshes &mdash; check back within the hour.</div>`}
    ${PG.recent.length ? `<div class="pg-sec">HOW IT TURNED OUT</div>${PG.recent.map(resolvedHTML).join("")}` : ""}
    <div class="pg-sec">LEADERBOARD</div>
    ${boardHTML()}
    <p class="note">Questions are written and scored by the server against the same public
    figures shown on this site &mdash; gas from AAA, post counts from the live feed.
    Picks lock at midnight Eastern and can't be changed after the question closes.
    No money, no stakes, no prizes. Just bragging rights and a permanent record of
    being wrong.</p>`;

  wirePredict();
}

function recordHTML() {
  if (!me) {
    return `<div class="pg-you pg-signed-out">
      <b>Sign in to play.</b>
      <div style="margin-top:7px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="b95 tiny" data-pg-in="google">Google</button>
        <button class="b95 tiny" data-pg-in="discord">Discord</button>
        <button class="b95 tiny" data-pg-email>Email</button>
      </div>
      <div class="note" style="margin-top:6px">Anyone can read the questions. An account is only needed to lock a pick.</div>
    </div>`;
  }
  const r = PG.record || { correct: 0, resolved: 0, pending: 0 };
  const pct = r.resolved ? Math.round((r.correct / r.resolved) * 100) : null;
  return `<div class="pg-you">
    <div class="pg-stat"><b>${r.correct}</b><span>right</span></div>
    <div class="pg-stat"><b>${r.resolved}</b><span>scored</span></div>
    <div class="pg-stat"><b>${pct == null ? "&mdash;" : pct + "%"}</b><span>hit rate</span></div>
    <div class="pg-stat"><b>${r.pending}</b><span>pending</span></div>
    ${r.resolved > 0 ? `<button class="b95 tiny" id="pgShare" title="Share your record">&#128247;</button>` : ""}
  </div>`;
}

/* A countdown that shows seconds but only repaints on data load looks frozen,
   so this deliberately stops at minutes. */
function untilText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function openHTML(q) {
  const mine = PG.picks[q.id];
  const closes = Date.parse(q.closes_at);
  const left = closes - Date.now();
  const btn = (key, label) => {
    const on = mine === key;
    return `<button class="b95 pg-opt${on ? " on" : ""}" data-pick="${q.id}" data-choice="${key}"
      ${left <= 0 ? "disabled" : ""}>${on ? "&#10003; " : ""}${esc(label)}</button>`;
  };
  return `<div class="pg-q${mine ? " picked" : ""}">
    <div class="pg-prompt">${esc(q.prompt)}</div>
    <div class="pg-opts">${btn("a", q.option_a)}${btn("b", q.option_b)}</div>
    <div class="pg-meta">
      ${left > 0 ? `Locks in <b>${esc(untilText(left))}</b>` : "Locked"}
      ${mine ? ` &middot; <span class="pg-locked">your pick is in</span>` : (me ? " &middot; no pick yet" : "")}
    </div>
  </div>`;
}

function resolvedHTML(q) {
  const mine = PG.picks[q.id];
  const won = mine && q.outcome === mine;
  const winner = q.outcome === "a" ? q.option_a : q.outcome === "b" ? q.option_b : "Voided";
  return `<div class="pg-r ${mine ? (won ? "win" : "lose") : ""}">
    <div class="pg-r-top">
      <span class="pg-r-badge">${mine ? (won ? "YOU WERE RIGHT" : "YOU WERE WRONG") : "RESULT"}</span>
      <b>${esc(winner)}</b>
    </div>
    <div class="pg-r-q">${esc(q.prompt)}</div>
    ${q.outcome_note ? `<div class="pg-meta">${esc(q.outcome_note)}</div>` : ""}
  </div>`;
}

function boardHTML() {
  if (!PG.board.length) return `<div class="note">Nobody has a scored pick yet. Be the first.</div>`;
  return `<table class="pg-board"><thead><tr><th>#</th><th>Who</th><th>Right</th><th>Rate</th><th>Streak</th></tr></thead><tbody>
    ${PG.board.map((r, i) => `<tr${myProfile && r.handle === myProfile.handle ? ' class="me"' : ""}>
      <td>${i + 1}</td>
      <td class="pg-who" data-open-user="${esc(r.handle || "")}" title="View profile">${
        r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="" width="16" height="16" loading="lazy">` : ""}
        ${esc(r.display_name || r.handle || "anon")}</td>
      <td>${r.correct}/${r.total}</td>
      <td>${r.pct == null ? "&mdash;" : Math.round(r.pct) + "%"}</td>
      <td>${r.streak > 1 ? "&#128293; " + r.streak : r.streak || 0}</td>
    </tr>`).join("")}
  </tbody></table>`;
}

/* ---------------------------------------------------------------- act */
function wirePredict() {
  document.querySelectorAll("#predictBody [data-pg-in]").forEach((b) =>
    b.addEventListener("click", () => signIn(b.dataset.pgIn)));
  document.querySelector("#predictBody [data-pg-email]")?.addEventListener("click",
    () => promptSignIn("Sign in to lock a pick. Reading the questions is open to everyone."));

  document.querySelectorAll("#predictBody [data-pick]").forEach((b) =>
    b.addEventListener("click", () => makePick(+b.dataset.pick, b.dataset.choice, b)));

  document.getElementById("pgShare")?.addEventListener("click", () => {
    const r = PG.record || {};
    Share.open("record", { correct: r.correct, resolved: r.resolved,
      pct: r.resolved ? Math.round((r.correct / r.resolved) * 100) : null });
  });
}

async function makePick(id, choice, btn) {
  if (!me) {
    promptSignIn("You need an account to lock a pick. Reading the questions is open to everyone.");
    return;
  }
  const wasLabel = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = "…";

  // Upsert on (prediction_id, user_id): changing your mind before the question
  // closes is allowed, and the RLS update policy re-checks closes_at itself.
  const { error } = await sb.from("cheeto_picks")
    .upsert({ prediction_id: id, user_id: me.id, choice }, { onConflict: "prediction_id,user_id" });

  if (error) {
    btn.disabled = false; btn.innerHTML = wasLabel;
    showModal("Pick not accepted", "&#9888;",
      `The database refused that.<br><br><span style="color:#555;font-size:11px">${esc(error.message)}</span>
       <br><br>Usually that means the question just closed, or your account is too new to post yet.`);
    return;
  }

  PG.picks[id] = choice;
  paintPredict();
  Cheetip?.react?.("pick");
  loadPredictions(true);
}

/* --------------------------------------------------------------- wiring */
function initPredict() {
  // Load when the window is opened rather than on page load — it's several
  // queries, and most visitors never open it.
  const w = document.getElementById("w-predict");
  if (w) {
    const obs = new MutationObserver(() => { if (!w.hidden) loadPredictions(); });
    obs.observe(w, { attributes: true, attributeFilter: ["hidden"] });
    if (!w.hidden) loadPredictions();
  }
  $("#predictRefresh")?.addEventListener("click", () => loadPredictions(true));
  // chat.js fires this whenever the session changes, so the panel switches
  // between "sign in to play" and your record without a reload.
  document.addEventListener("cheeto:auth", () => { PG.loadedAt = 0; if (!document.getElementById("w-predict")?.hidden) loadPredictions(true); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPredict);
} else {
  initPredict();
}
