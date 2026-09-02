/* =====================================================================
   THE DESKTOP, TAKEN SERIOUSLY
   Everything here exists because the site's whole premise is that it IS a
   1997 desktop, and a fake desktop that ignores right-click is a picture of
   a desktop rather than a working one. These are the interactions people try
   without being told to, which is exactly why they're worth having.

   Right-click menus, a Recycle Bin that won't empty, and a keyboard shortcut
   sheet. Window snapping lives in app.js next to the drag handler it hooks.

   Deliberately NOT bound: Alt+Tab and Ctrl+W. The operating system and the
   browser own those, and a page that tries to intercept them either fails
   silently or breaks something the person actually needed.
   ===================================================================== */

const Ctx = {
  el: null,

  /* One menu element, reused. Rebuilding the DOM per open leaks listeners and
     makes the "click anywhere to dismiss" handler fight itself. */
  ensure() {
    if (this.el) return this.el;
    const d = document.createElement("div");
    d.id = "ctxMenu";
    d.hidden = true;
    d.setAttribute("role", "menu");
    document.body.appendChild(d);
    this.el = d;
    return d;
  },

  open(x, y, items) {
    const el = this.ensure();
    el.innerHTML = items.map((it, i) => it.sep
      ? `<div class="ctx-sep"></div>`
      : `<button class="ctx-i${it.disabled ? " off" : ""}" data-ctx="${i}"
           ${it.disabled ? "disabled" : ""} role="menuitem">
           <span class="ctx-l">${it.label}</span>
           ${it.key ? `<span class="ctx-k">${it.key}</span>` : ""}</button>`).join("");

    el.hidden = false;
    // Position after unhiding so the measurement is real, then pull it back
    // inside the viewport rather than letting it hang off the edge.
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(x, window.innerWidth - r.width - 4) + "px";
    el.style.top = Math.min(y, window.innerHeight - r.height - 4) + "px";

    el.querySelectorAll("[data-ctx]").forEach((b) =>
      b.addEventListener("click", () => {
        const it = items[+b.dataset.ctx];
        this.close();
        it?.act?.();
      }));
    el.querySelector(".ctx-i:not([disabled])")?.focus();
  },

  close() { if (this.el) this.el.hidden = true; },
};

document.addEventListener("click", () => Ctx.close());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") Ctx.close(); });
window.addEventListener("blur", () => Ctx.close());


/* ---------------------------------------------------------- the menus */
function desktopMenu(e) {
  Ctx.open(e.clientX, e.clientY, [
    { label: "&#128260; Refresh data", key: "F5",
      act: () => { if (typeof loadLive === "function") loadLive(true); } },
    { label: "&#129704; Arrange windows", act: () => arrangeWindows() },
    { sep: true },
    { label: "&#128101; People", act: () => WM.open("w-people") },
    { label: "&#128172; Notifications", act: () => { if (typeof Notify === "object") Notify.open(); } },
    { sep: true },
    { label: "&#127912; New", disabled: true },
    // Was opening the About box — the one thing "Properties" has never meant
    // on any desktop anyone has actually used.
    { label: "&#128421; Properties", act: () => Skin.open("appearance") },
  ]);
}

function windowMenu(e, w) {
  Ctx.open(e.clientX, e.clientY, [
    { label: w.rolled ? "Roll down" : "Roll up", act: () => rollToggle(w) },
    { label: w.max ? "Restore" : "Maximise", act: () => WM.toggleMax(w) },
    { label: "Minimise", act: () => WM.minimize(w) },
    { sep: true },
    { label: "Snap left", act: () => WM.applySnap(w, "left") },
    { label: "Snap right", act: () => WM.applySnap(w, "right") },
    { sep: true },
    { label: "Close", key: "×", act: () => WM.close(w) },
  ]);
}

function rollToggle(w) {
  w.rolled = !w.rolled;
  w.el.classList.toggle("rolled", w.rolled);
  if (!w.rolled) w.el.style.height = (w.lastH || w.def.h) + "px";
  else w.lastH = w.el.offsetHeight;
  WM.save();
}

/* Cascade, because tiling twenty windows makes each one useless. */
function arrangeWindows() {
  if (WM.mobile) return;
  let i = 0;
  WM.wins.filter((w) => w.open && !w.min).forEach((w) => {
    w.el.style.left = (24 + i * 26) + "px";
    w.el.style.top = (16 + i * 24) + "px";
    w.max = false; w.el.classList.remove("max");
    i++;
  });
  WM.save();
}


/* ------------------------------------------------------- recycle bin */
const Bin = {
  render() {
    const box = document.getElementById("binBody");
    if (!box) return;
    box.innerHTML = `
      <div class="bin-top">
        <div class="bin-i">&#128465;</div>
        <div>
          <b>Recycle Bin</b>
          <div class="note">0 objects &middot; 0 bytes</div>
        </div>
      </div>
      <div class="sunken bin-empty">This folder is empty.</div>
      <div style="margin-top:10px;display:flex;gap:7px;flex-wrap:wrap">
        <button class="b95" id="binEmpty">Empty Recycle Bin</button>
        <button class="b95" id="binRestore" disabled>Restore all items</button>
      </div>
      <p class="note" style="margin-top:9px">Nothing you do on this site is ever
      actually deleted from here, because nothing is ever put in here. It's a bin
      on a website. It's decorative.</p>`;

    document.getElementById("binEmpty")?.addEventListener("click", () => {
      showModal("Confirm Multiple File Delete", "&#128465;",
        `Are you sure you want to delete these 0 items?<br><br>
         <span style="color:#555;font-size:11px">There are no items. There have never been
         any items. You are being asked to confirm the deletion of nothing, which is the
         most 1997 thing this site does.</span>`);
      Cheetip?.react?.("bin");
    });
  },
};


/* --------------------------------------------------- keyboard sheet */
function shortcutsSheet() {
  showModal("Keyboard shortcuts", "&#9000;", `
    <table class="ks">
      <tr><td><kbd>F5</kbd></td><td>Refresh the tracked data</td></tr>
      <tr><td><kbd>?</kbd></td><td>This list</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close a menu or dialog</td></tr>
      <tr><td colspan="2" class="ks-h">With a title bar focused</td></tr>
      <tr><td><kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd></td><td>Nudge the window</td></tr>
      <tr><td><kbd>Shift</kbd> + arrows</td><td>Nudge it further</td></tr>
      <tr><td colspan="2" class="ks-h">With the mouse</td></tr>
      <tr><td>Double-click a title bar</td><td>Roll the window up</td></tr>
      <tr><td>Drag to an edge</td><td>Snap to half the screen</td></tr>
      <tr><td>Drag to the top</td><td>Maximise</td></tr>
      <tr><td>Right-click</td><td>Menus, on the desktop and on windows</td></tr>
    </table>
    <p class="note" style="margin-top:9px">Alt+Tab and Ctrl+W belong to your computer
    and your browser. A web page that tries to steal those either fails quietly or
    breaks something you needed, so this one doesn't try.</p>`);
}


/* -------------------------------------------------------------- wire */
function initDesktop() {
  // The desktop itself, but never over a window, a menu or the taskbar.
  document.addEventListener("contextmenu", (e) => {
    if (WM.mobile) return;                       // long-press is the OS's job on touch
    const win = e.target.closest?.(".win");
    const tb = e.target.closest?.(".tb");
    if (tb && win) {
      const w = WM.byId(win.id);
      if (w) { e.preventDefault(); windowMenu(e, w); }
      return;
    }
    if (win || e.target.closest?.("#taskbar, #startMenu, .modal, #ctxMenu")) return;
    // Inputs keep their native menu — spellcheck and paste matter more than a joke.
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    desktopMenu(e);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    if (e.key === "?" ) { e.preventDefault(); shortcutsSheet(); }
    if (e.key === "F5" && !e.ctrlKey && !e.metaKey) {
      // The page is a single document; a real reload throws away every open
      // window and the whole point of F5 here is refreshing the DATA.
      e.preventDefault();
      if (typeof loadLive === "function") loadLive(true);
    }
  });

  Bin.render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDesktop);
} else {
  initDesktop();
}
