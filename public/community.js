/* =====================================================================
   COMMUNITY — profile editor, bulletin board, admin panel
   Loads after chat.js and shares its `sb` / `me` / `myProfile` state.

   Same rule as chat.js: this file is presentation only. Link validation,
   rate limits, ban enforcement, admin authority and the word filter all live
   in Postgres. Anything here is a convenience, not a control.
   ===================================================================== */

/* =====================================================================
   THE PROFILE PICTURE
   Same principle as the feed's image handling and for the same reason: the
   file is decoded and re-encoded through a canvas before it leaves the
   browser, which strips the EXIF block. A profile picture is very often a
   photo straight off a phone, and those carry GPS coordinates.

   Avatars get a centre square crop as well, because every place one is
   displayed — chat, the wall, the Top 8 — is a square, and a browser
   letterboxing a panorama into 24 pixels looks like a bug.

   `pendingAvatar` has three states, which the save handler depends on:
     undefined  nothing touched, keep whatever is already there
     {blob,url} a new picture waiting to be uploaded
     null       explicitly cleared back to the Cheeto
   ===================================================================== */
const AV_DIM = 256;                       // displayed at 72px at the very largest
const AV_QUALITY = 0.85;
let pendingAvatar;                        // deliberately undefined to start

async function prepAvatar(file) {
  if (!file) throw new Error("No file.");
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
    throw new Error("That's not an image I can use. JPEG, PNG or WebP.");
  }
  if (file.size > 25 * 1024 * 1024) throw new Error("That image is enormous. Under 25MB, please.");

  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Couldn't read that image."); });
  // Centre square crop, then scale. Cropping first keeps the maths simple and
  // means a tall photo loses its edges rather than its subject.
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.round((bitmap.width - side) / 2);
  const sy = Math.round((bitmap.height - side) / 2);
  const out = Math.min(AV_DIM, side);

  const canvas = document.createElement("canvas");
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";               // so a transparent PNG isn't flattened to black
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close?.();

  const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", AV_QUALITY))
    || await new Promise((r) => canvas.toBlob(r, "image/jpeg", AV_QUALITY));
  if (!blob) throw new Error("Couldn't process that image.");
  if (blob.size > 512 * 1024) throw new Error("Still too big after compression — try a simpler image.");
  return blob;
}

async function attachAvatar(file) {
  const note = $("#pfPfpNote");
  try {
    if (note) note.textContent = "Processing…";
    const blob = await prepAvatar(file);
    if (pendingAvatar?.url) URL.revokeObjectURL(pendingAvatar.url);
    pendingAvatar = { blob, url: URL.createObjectURL(blob) };
    [$("#pfPrev"), $("#profPfp")].forEach((img) => { if (img) img.src = pendingAvatar.url; });
    if (note) note.textContent = `Ready — ${(blob.size / 1024).toFixed(0)}KB, cropped square, metadata removed. Press Save.`;
  } catch (err) {
    if (note) note.innerHTML = `<span style="color:#900">${esc(err.message)}</span>`;
  }
}

function wireAvatar() {
  const zone = $("#pfDrop"), input = $("#pfFile");
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => { if (input.files?.[0]) attachAvatar(input.files[0]); });

  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) attachAvatar(f);
  });

  // Paste anywhere in the profile window, so a copied image doesn't need the
  // file dialog at all.
  $("#profileBody")?.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); attachAvatar(f); }
  });

  $("#pfPfpClear")?.addEventListener("click", () => {
    if (pendingAvatar?.url) URL.revokeObjectURL(pendingAvatar.url);
    pendingAvatar = null;
    [$("#pfPrev"), $("#profPfp")].forEach((img) => { if (img) img.src = "/logo.svg"; });
    const note = $("#pfPfpNote");
    if (note) note.textContent = "Back to the Cheeto when you press Save.";
  });
}

/* If the URL points at our own avatars bucket this returns the storage path,
   so the old file can be deleted when a new one replaces it. A Google or
   Discord picture returns null: not ours, not our business. */
function ownAvatarPath(url) {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/public\/avatars\/(.+)$/);
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

/* =====================================================================
   PAGE THEMES
   The list is duplicated in a CHECK constraint in Postgres. That is the
   point: this array decides what the picker OFFERS, the constraint decides
   what the database ACCEPTS, and a client that skips this file entirely still
   cannot store a theme that doesn't exist.
   ===================================================================== */
const THEMES = [
  ["classic",   "Classic"],
  ["tiled",     "Tiled"],
  ["starfield", "Starfield"],
  ["glitter",   "Glitter"],
  ["vaporwave", "Vaporwave"],
  ["matrix",    "Matrix"],
  ["sunset",    "Sunset"],
  ["cheeto",    "Cheeto"],
  ["notepad",   "Notepad"],
  ["bsod",      "Blue screen"],
];

let pickedTheme = "classic";

function renderThemePicker(current) {
  const box = $("#pfThemes");
  if (!box) return;
  pickedTheme = THEMES.some((t) => t[0] === current) ? current : "classic";

  box.innerHTML = THEMES.map(([id, label]) => `
    <button type="button" class="th-sw${pickedTheme === id ? " on" : ""}" data-theme="${id}"
            title="${esc(label)}" aria-pressed="${pickedTheme === id}">
      <i data-utheme-swatch="${id}"></i><span>${esc(label)}</span>
    </button>`).join("");

  // The swatch shows the actual theme background rather than a guess at it,
  // by borrowing the same rules the profile window uses.
  box.querySelectorAll("[data-utheme-swatch]").forEach((el) => {
    const probe = document.createElement("div");
    probe.className = "body";
    probe.dataset.utheme = el.dataset.utheme_swatch || el.getAttribute("data-utheme-swatch");
    probe.style.cssText = "position:absolute;left:-9999px;width:10px;height:10px";
    const host = document.getElementById("w-user") || document.body;
    host.appendChild(probe);
    const cs = getComputedStyle(probe);
    el.style.background = cs.backgroundColor;
    el.style.backgroundImage = cs.backgroundImage;
    el.style.backgroundSize = cs.backgroundSize;
    probe.remove();
  });

  box.querySelectorAll("[data-theme]").forEach((b) =>
    b.addEventListener("click", () => {
      pickedTheme = b.dataset.theme;
      renderThemePicker(pickedTheme);
      const m = $("#pfMsg");
      if (m) m.textContent = "Press Save to keep it.";
    }));
}

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
  // A redraw discards any unsaved picture, so the preview and the pending
  // state can never disagree about what pressing Save would do.
  if (pendingAvatar?.url) URL.revokeObjectURL(pendingAvatar.url);
  pendingAvatar = undefined;
  const links = Array.isArray(p?.links) ? p.links : [];

  box.innerHTML = `
    <div class="prof-head">
      <img class="prof-pfp" id="profPfp" src="${esc(p?.avatar_url || "/logo.svg")}" alt=""
           width="64" height="64" data-open-user="${esc(me.id)}" title="View my page">
      <div>
        <div class="prof-handle" data-open-user="${esc(me.id)}" title="View my page">@${esc(p?.handle || "…")}</div>
        <div class="note" style="margin:2px 0 0">Joined ${p ? new Date(p.created_at).toLocaleDateString() : "—"}
          ${p?.is_admin ? '· <span class="adm">ADMIN</span>' : ""}</div>
      </div>
    </div>

    <fieldset><legend>Username (@handle)</legend>
      <input class="i95" id="pfHandle" maxlength="20" value="${esc(p?.handle || "")}" placeholder="3-20 chars: letters, numbers, underscore">
      <p class="note">This is your unique @name. Letters, numbers and underscores only.</p>
    </fieldset>

    <fieldset><legend>Display name</legend>
      <input class="i95" id="pfName" maxlength="40" value="${esc(p?.display_name || "")}" placeholder="Optional — shown instead of your @handle">
    </fieldset>

    <fieldset><legend>Profile picture</legend>
      <div class="av-row">
        <img class="av-prev" id="pfPrev" src="${esc(p?.avatar_url || "/logo.svg")}" alt="Your profile picture"
             width="64" height="64" onerror="this.src='/logo.svg'">
        <div class="av-col">
          <div class="av-drop" id="pfDrop" tabindex="0" role="button"
               aria-label="Change your picture: drop an image here, paste one, or click to choose a file">
            <span>&#128247; Drop an image here, paste it, or <u>choose a file</u></span>
            <input type="file" id="pfFile" accept="image/*" hidden>
          </div>
          <div class="av-btns">
            <button class="b95 tiny" id="pfPfpClear" type="button">Use the Cheeto</button>
          </div>
          <div class="note" id="pfPfpNote" style="margin:5px 0 0"></div>
        </div>
      </div>
      <p class="note">Cropped to a square and shrunk to 256 pixels in your browser,
      which also strips the location and camera data most photos carry.
      Nothing is uploaded until you press Save.</p>
    </fieldset>

    <fieldset><legend>&#127912; Page theme</legend>
      <div class="th-grid" id="pfThemes"></div>
      <p class="note">Ten presets. There's no box for your own CSS on purpose &mdash;
      a stylesheet somebody else writes runs on the page every visitor loads,
      which is a way to fake a login box, not a way to decorate.</p>
    </fieldset>

    <fieldset><legend>Mood</legend>
      <input class="i95" id="pfMood" maxlength="40" value="${esc(p?.mood || "")}"
             placeholder="cranky, caffeinated, doomscrolling…">
      <p class="note">Shown under your name. 40 characters.</p>
    </fieldset>

    <fieldset><legend>Your wall</legend>
      <label class="chk"><input type="checkbox" id="pfWall" ${p?.wall_closed ? "" : "checked"}>
        Let people leave comments on my profile</label>
      <p class="note">Unticking this hides the comment box on your page. Comments already
      there stay, and you can delete any of them whenever you like.</p>
      <label class="chk" style="margin-top:7px"><input type="checkbox" id="pfHideViews"
        ${p?.views_hidden ? "checked" : ""}> Hide my profile view count from other people</label>
      <button class="b95 tiny" id="pfViewWall" type="button" style="margin-top:6px">Read my wall</button>
      <span class="note" id="pfWallCount" style="margin-left:7px"></span>
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
      <button class="b95" id="pfViewPage" type="button">View my page</button>
      <span id="pfMsg" class="note" style="margin:0"></span>
    </div>

    <fieldset class="danger" style="margin-top:14px">
      <legend>&#9888; Delete account</legend>
      <p class="note" style="margin-top:0">This removes your profile, chat messages,
      statuses, bulletin posts, friendships, predictions and reactions. It happens
      immediately and can't be undone &mdash; there's no grace period and no backup
      you can ask us to restore from.</p>
      <button class="b95" id="pfDelete">Delete my account</button>
    </fieldset>`;

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

  // The URL box this used to watch is gone. Anything left listening to it
  // throws on a null element and takes every listener BELOW it with it —
  // which is how the Save button quietly stopped working.
  $("#profPfp")?.addEventListener("error", () => { $("#profPfp").src = "/logo.svg"; });

  renderThemePicker(p?.theme || "classic");
  WM.fit?.("w-profile");
  wireAvatar();
  // Both go to the same place. Two buttons because "how does my page look"
  // and "what has anyone written on it" are two different questions, and
  // the second one is the reason people used to check MySpace hourly.
  $("#pfViewPage")?.addEventListener("click", () => Profile.openMine());
  $("#pfViewWall")?.addEventListener("click", () => Profile.openMine());

  /* A head-only count, so the button says whether there is anything to read
     without pulling every comment into a window that isn't showing them.
     Silent on failure: a missing number must not break the editor. */
  sb.from("cheeto_wall")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", me.id).is("deleted_at", null)
    .then(({ count, error }) => {
      const el = $("#pfWallCount");
      if (!el || error) return;
      el.textContent = count ? `${count} comment${count === 1 ? "" : "s"}` : "No comments yet.";
    }, () => {});
  $("#pfSave").addEventListener("click", saveProfile);
  $("#pfDelete").addEventListener("click", confirmDelete);
}

/* Two steps on purpose: an irreversible action shouldn't be one stray tap away,
   and typing the word is the cheapest way to make sure the person meant it. */
function confirmDelete() {
  showModal("Delete your account?", "&#9888;", `
    <div style="font-size:12px;line-height:1.6">
      This deletes everything you've made here, permanently and immediately.
      Other people's messages that replied to yours will stay, but yours will be gone.
      <br><br>Type <b>DELETE</b> to confirm:
      <input class="i95" id="delWord" style="width:100%;margin-top:7px" autocomplete="off">
      <div style="display:flex;gap:7px;justify-content:flex-end;margin-top:11px;flex-wrap:wrap">
        <button class="b95" id="delCancel">Keep my account</button>
        <button class="b95" id="delGo" disabled>Delete permanently</button>
      </div>
    </div>`);
  setTimeout(() => {
    const ok = document.getElementById("modalOk");
    if (ok) ok.style.display = "none";
    const word = document.getElementById("delWord");
    const go = document.getElementById("delGo");
    word?.addEventListener("input", () => { go.disabled = word.value.trim().toUpperCase() !== "DELETE"; });
    word?.focus();
    document.getElementById("delCancel")?.addEventListener("click", () => {
      if (ok) ok.style.display = "";
      $("#modal").hidden = true;
    });
    go?.addEventListener("click", () => doDelete(go));
  }, 0);
}

async function doDelete(btn) {
  btn.disabled = true; btn.textContent = "Deleting…";
  try {
    const { data, error } = await sb.rpc("cheeto_delete_me");
    if (error) throw error;
    if (data && data.ok === false) throw new Error(data.error || "refused");
    // Sign out locally too, or the browser keeps a token for an account that
    // no longer exists and every later request fails confusingly.
    try { await sb.auth.signOut(); } catch {}
    try { localStorage.removeItem("cheeto_since_v1"); } catch {}
    const ok = document.getElementById("modalOk");
    if (ok) ok.style.display = "";
    showModal("Account deleted", "&#128465;",
      "Your account and everything in it is gone.<br><br>" +
      "<span style='color:#555;font-size:11px'>The site still works &mdash; reading was never gated. " +
      "Sign in again any time and you'll start fresh.</span>");
    setTimeout(() => location.reload(), 2200);
  } catch (err) {
    btn.disabled = false; btn.textContent = "Delete permanently";
    showModal("Couldn't delete", "&#9888;",
      `<span style="font-size:11px;color:#555">${esc(err?.message || "unknown error")}</span>`);
  }
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


  const handle = ($("#pfHandle").value || "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) {
    msg.innerHTML = `<span style="color:#900">Username must be 3-20 characters: letters, numbers or underscore.</span>`;
    return;
  }

  /* The picture is uploaded BEFORE the profile row is written, so a failed
     upload can't leave the row pointing at a file that doesn't exist. The
     reverse order is the one that produces broken images. */
  const previous = myProfile?.avatar_url || null;
  // undefined = untouched, null = cleared, object = a new file to upload.
  let avatar = pendingAvatar === undefined ? previous : null;

  if (pendingAvatar) {
    msg.textContent = "Uploading picture…";
    try {
      const id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2));
      const path = `${me.id}/${id}.webp`;
      const { error: upErr } = await sb.storage.from("avatars")
        .upload(path, pendingAvatar.blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (upErr) throw upErr;
      avatar = sb.storage.from("avatars").getPublicUrl(path).data?.publicUrl || null;
      if (!avatar) throw new Error("Uploaded, but the public URL came back empty.");
    } catch (err) {
      const why = /row-level security|Unauthorized/i.test(err.message || "")
        ? "Picture upload refused — new accounts wait ten minutes, and there's a ten-changes-a-day limit."
        : (err.message || "Picture upload failed.");
      msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
      return;
    }
  }

  msg.textContent = "Saving…";
  const { data, error } = await sb.from("cheeto_profiles").update({
    handle,
    display_name: $("#pfName").value.trim() || null,
    bio: $("#pfBio").value.trim() || null,
    avatar_url: avatar,
    theme: pickedTheme,
    mood: $("#pfMood")?.value.trim() || null,
    views_hidden: Boolean($("#pfHideViews")?.checked),
    wall_closed: !$("#pfWall")?.checked,
    links,
  }).eq("id", me.id).select().maybeSingle();

  if (error) {
    // The most likely failure by far is someone already having that @name,
    // and "duplicate key value violates unique constraint" helps nobody.
    const why = /duplicate key|unique/i.test(error.message)
      ? `That username is taken. Try another.`
      : /violates check constraint|handle_check/i.test(error.message)
        ? `Username must be 3-20 characters: letters, numbers or underscore.`
        : /row-level security/i.test(error.message)
          ? `You can only edit your own profile.`
          : error.message;
    msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    return;
  }
  if (!data) {
    // update matched nothing — almost always a missing profile row
    msg.innerHTML = `<span style="color:#900">Couldn't find your profile to update. Try signing out and back in.</span>`;
    return;
  }

  myProfile = data;

  /* The old picture is only removed once the new one is safely referenced.
     Deleting first would mean a failed save leaves the profile pointing at a
     file that no longer exists. Failure here is silent on purpose: the user's
     change worked, and an orphaned 30KB file is not their problem. */
  const stale = ownAvatarPath(previous);
  if (stale && previous !== data.avatar_url) {
    try { await sb.storage.from("avatars").remove([stale]); } catch {}
  }

  msg.innerHTML = `<span style="color:#060">Saved.</span>`;
  await afterAuthChange();
  await renderProfileEditor();
  setTimeout(() => { const m = $("#pfMsg"); if (m) m.textContent = ""; }, 2500);
}

/* ----------------------------------------------------------------- THE FEED
   Formerly the bulletin board. Same table, different shape: reverse
   chronological by ACTIVITY, titles optional, images allowed, reactions reused
   from the Truth feed.

   IMAGES: every upload is re-encoded through a canvas before it leaves the
   browser. That does three useful things at once — it caps the dimensions, it
   cuts the file size, and it strips EXIF. That last one matters most: photos
   off a phone carry GPS coordinates, and someone posting a screenshot has no
   idea their camera roll image would publish where they live. Re-encoding
   produces fresh bytes with none of that metadata.

   Every limit is ALSO enforced in Postgres — folder ownership, 20 uploads a
   day, MIME type, file size. What follows is convenience, not security.
   =========================================================================== */
const IMG_MAX_DIM = 1600;          // plenty for a chart screenshot
const IMG_QUALITY = 0.82;
const IMG_MAX_INPUT = 25 * 1024 * 1024;   // refuse absurd files before decoding

let boardOpenPost = null;
let pendingImage = null;           // { blob, url } waiting to be posted

function imgUrl(path) {
  if (!path || !sb) return null;
  const { data } = sb.storage.from("post-images").getPublicUrl(path);
  return data?.publicUrl || null;
}

/* Decode, downscale, re-encode. Returns a Blob or throws with a human reason. */
async function prepImage(file) {
  if (!file) throw new Error("No file.");
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
    throw new Error("That's not an image I can post. JPEG, PNG or WebP.");
  }
  if (file.size > IMG_MAX_INPUT) throw new Error("That image is enormous. Under 25MB, please.");

  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Couldn't read that image."); });
  const scale = Math.min(1, IMG_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  // A white base, so a transparent PNG doesn't become black once flattened.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", IMG_QUALITY))
    || await new Promise((res) => canvas.toBlob(res, "image/jpeg", IMG_QUALITY));
  if (!blob) throw new Error("Couldn't process that image.");
  if (blob.size > 3 * 1024 * 1024) throw new Error("Still too big after compression — try a smaller image.");
  return blob;
}

async function attachImage(file) {
  const note = $("#bpImgNote");
  try {
    if (note) note.textContent = "Processing…";
    const blob = await prepImage(file);
    if (pendingImage?.url) URL.revokeObjectURL(pendingImage.url);
    pendingImage = { blob, url: URL.createObjectURL(blob) };
    renderImagePreview();
    if (note) note.textContent = `Ready — ${(blob.size / 1024).toFixed(0)}KB, metadata removed.`;
  } catch (err) {
    if (note) note.innerHTML = `<span style="color:#900">${esc(err.message)}</span>`;
  }
}

function renderImagePreview() {
  const box = $("#bpImgPreview");
  if (!box) return;
  box.innerHTML = pendingImage
    ? `<div class="bp-thumb"><img src="${pendingImage.url}" alt="attached image preview">
         <button class="b95 tiny" id="bpImgClear">Remove</button></div>`
    : "";
  $("#bpImgClear")?.addEventListener("click", () => {
    if (pendingImage?.url) URL.revokeObjectURL(pendingImage.url);
    pendingImage = null;
    renderImagePreview();
    const n = $("#bpImgNote"); if (n) n.textContent = "";
  });
}

async function loadBoard() {
  const box = $("#boardBody");
  if (!box || !sb) return;
  box.innerHTML = `<div class="note">Loading…</div>`;

  const { data, error } = await sb.rpc("cheeto_feed", { lim: 40 });
  if (error) {
    box.innerHTML = `<div class="sunken" style="color:#900">Couldn't load the feed.<br>
      <span class="note">${esc(error.message)}</span></div>`;
    return;
  }

  const composer = me
    ? `<fieldset><legend>New post</legend>
         <textarea class="i95" id="bpBody" rows="3" maxlength="4000" placeholder="What are you looking at?"></textarea>
         <input class="i95" id="bpTitle" maxlength="120" placeholder="Title (optional)" style="margin-top:6px">
         <div class="bp-drop" id="bpDrop" tabindex="0" role="button"
              aria-label="Add an image: drop one here, paste, or click to choose">
           <span>&#128247; Drop an image here, paste it, or <u>choose a file</u></span>
           <input type="file" id="bpFile" accept="image/*" hidden>
         </div>
         <div id="bpImgPreview"></div>
         <div class="note" id="bpImgNote" style="margin:4px 0 0"></div>
         <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
           <button class="b95" id="bpPost">Post</button>
           <span class="note" id="bpMsg" style="margin:0"></span>
         </div>
       </fieldset>`
    : `<div class="sunken" style="margin-bottom:9px">Sign in to post. Reading is open to everyone.
         <button class="b95 tiny" id="bpSignin" style="margin-left:6px">Sign in</button></div>`;

  box.innerHTML = composer + (data && data.length
    ? `<div id="boardList">${data.map(boardRow).join("")}</div>`
    : `<div class="note">Nothing here yet. Be the first.</div>`);

  if (me) {
    $("#bpPost").addEventListener("click", submitBoardPost);
    wireDropZone();
    renderImagePreview();
  } else {
    $("#bpSignin").addEventListener("click", () => WM.open("w-chat"));
  }

  $$("[data-open-post]").forEach((b) =>
    b.addEventListener("click", () => openThread(+b.dataset.openPost)));
  $$("[data-del-post]").forEach((b) =>
    b.addEventListener("click", () => adminDeletePost(+b.dataset.delPost)));

  // Reactions are the same component the Truth feed uses; board ids are
  // namespaced so the two can never collide.
  if (typeof Rx === "object") Rx.load(true);
}

function wireDropZone() {
  const zone = $("#bpDrop"), input = $("#bpFile");
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => { if (input.files?.[0]) attachImage(input.files[0]); });

  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) attachImage(f);
  });

  // Paste straight from a screenshot tool, which is how most of these will arrive.
  const body = $("#bpBody");
  body?.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const f = item.getAsFile();
    if (f) { e.preventDefault(); attachImage(f); }
  });
}

function boardRow(p) {
  const who = p.display_name || p.handle || "someone";
  const when = new Date(p.created_at).toLocaleString("en-US",
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const url = imgUrl(p.image_path);
  const body = p.body.length > 600 ? p.body.slice(0, 600) + "…" : p.body;
  return `<div class="bpost">
    <div class="bpost-top">
      ${p.avatar_url ? `<img class="bp-av" src="${esc(p.avatar_url)}" alt="" width="22" height="22" loading="lazy"
           data-open-user="${esc(p.user_id)}">` : ""}
      <b data-open-user="${esc(p.user_id)}" title="View profile">${esc(who)}</b>${p.is_admin ? ' <span class="adm">ADMIN</span>' : ""}
      <span class="bp-when">${esc(when)}</span>
      ${p.pinned ? '<span class="pin">PINNED</span>' : ""}
    </div>
    ${p.title ? `<div class="bpost-head"><b>${esc(p.title)}</b></div>` : ""}
    <div class="bpost-body">${esc(body)}</div>
    ${url ? `<a class="bp-img" href="${esc(url)}" target="_blank" rel="noopener">
       <img src="${esc(url)}" alt="Image posted by ${esc(who)}" loading="lazy"></a>` : ""}
    <div class="rx" data-rx="board:${p.id}"></div>
    <div class="bpost-acts">
      <button class="b95 tiny" data-open-post="${p.id}">
        ${p.reply_count > 0 ? `${p.reply_count} repl${p.reply_count === 1 ? "y" : "ies"}` : "Reply"}</button>
      ${myProfile?.is_admin ? `<button class="b95 tiny" data-del-post="${p.id}">Delete</button>` : ""}
    </div>
  </div>`;
}

async function submitBoardPost() {
  const t = $("#bpTitle").value.trim(), b = $("#bpBody").value.trim();
  const msg = $("#bpMsg");
  if (!b && !pendingImage) { msg.innerHTML = '<span style="color:#900">Write something, or add an image.</span>'; return; }

  const btn = $("#bpPost");
  btn.disabled = true;
  msg.textContent = pendingImage ? "Uploading image…" : "Posting…";

  let image_path = null;
  try {
    if (pendingImage) {
      const id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2));
      image_path = `${me.id}/${id}.webp`;
      const { error: upErr } = await sb.storage
        .from("post-images")
        .upload(image_path, pendingImage.blob, { contentType: "image/webp", cacheControl: "31536000" });
      if (upErr) throw upErr;
    }
  } catch (err) {
    btn.disabled = false;
    const why = /row-level security|Unauthorized/i.test(err.message || "")
      ? "Upload refused — new accounts wait 10 minutes, and there's a 20-image daily limit."
      : (err.message || "Upload failed.");
    msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    return;
  }

  msg.textContent = "Posting…";
  const { error } = await sb.from("cheeto_posts")
    .insert({ user_id: me.id, title: t || null, body: b || "", image_path });

  if (error) {
    btn.disabled = false;
    // The post failed but the image is already uploaded — clean it up rather
    // than leaving an orphan sitting in storage costing money forever.
    if (image_path) { try { await sb.storage.from("post-images").remove([image_path]); } catch {} }
    const why = /blocked_word|check_violation/i.test(error.message)
      ? "That post contains a blocked word."
      : /row-level security/i.test(error.message)
        ? "You can't post right now — new accounts wait 10 minutes, and there's a 5-per-hour limit."
        : error.message;
    msg.innerHTML = `<span style="color:#900">${esc(why)}</span>`;
    return;
  }

  if (pendingImage?.url) URL.revokeObjectURL(pendingImage.url);
  pendingImage = null;
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
  await loadImages();
  await loadUsers();
}

/* The image review queue. Hosting user images means a word filter protects
   nothing — this is the tool that does. Deleting takes two calls because
   Supabase blocks SQL deletes on storage.objects: the function clears the
   reference (so it leaves the feed at once) and the Storage API removes the
   file itself. */
async function loadImages() {
  const box = $("#admImages");
  if (!box || !sb) return;
  const { data, error } = await sb.rpc("cheeto_recent_images", { lim: 60 });
  if (error) { box.innerHTML = `<span style="color:#900">${esc(error.message)}</span>`; return; }
  if (!data || !data.length) { box.innerHTML = `<div class="note">No images uploaded yet.</div>`; return; }

  box.innerHTML = `<div class="admimgs">${data.map((i) => {
    const url = imgUrl(i.path);
    const when = new Date(i.uploaded_at).toLocaleString("en-US",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    /* An upload interrupted partway leaves a storage row with no file behind
       it. Rendering that as an <img> produces a broken-image icon and no
       explanation — it looks like the site lost somebody's picture, when in
       fact the picture never arrived. Say what it is and offer to clear it. */
    const thumb = i.complete
      ? `<a href="${esc(url || "#")}" target="_blank" rel="noopener">
           <img src="${esc(url || "")}" alt="Image uploaded by ${esc(i.handle || "a user")}" loading="lazy"></a>`
      : `<div class="admimg-bad" title="No file was stored for this row">
           &#9888;<span>incomplete upload</span></div>`;

    return `<div class="admimg${i.complete ? "" : " bad"}">
      ${thumb}
      <div class="admimg-m">
        <b>${esc(i.handle || "unknown")}</b><br>
        <span class="note">${esc(when)}</span>
        ${i.complete
          ? (i.bytes ? `<div class="note">${(i.bytes / 1024).toFixed(0)}KB</div>` : "")
          : `<div class="note">The upload didn't finish, so there's no image here &mdash;
             usually a dropped connection mid-send. Safe to delete.</div>`}
        ${i.post_body ? `<div class="note">${esc(i.post_body.slice(0, 60))}</div>` : ""}
        ${i.complete && !i.post_id ? `<div class="note">Not attached to any post.</div>` : ""}
      </div>
      <button class="b95 tiny" data-nukeimg="${esc(i.path)}">Delete</button>
    </div>`;
  }).join("")}</div>`;

  $$("[data-nukeimg]", box).forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "…";
    const path = b.dataset.nukeimg;
    try {
      const { data: r, error: e1 } = await sb.rpc("cheeto_admin_delete_image", { p_path: path });
      if (e1) throw e1;
      if (r && r.ok === false) throw new Error(r.error || "refused");
      const { error: e2 } = await sb.storage.from("post-images").remove([path]);
      if (e2) throw e2;
      await loadImages();
      if (!$("#w-board")?.hidden) await loadBoard();
    } catch (err) {
      b.disabled = false; b.textContent = "Delete";
      showModal("Couldn't delete", "&#9888;",
        `<span style="font-size:11px;color:#555">${esc(err?.message || "unknown")}</span>`);
    }
  }));
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
