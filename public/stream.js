/* =====================================================================
   THE STREAMS — one window per channel
   Kick's documented embed is https://player.kick.com/<channel>.

   Each channel gets its OWN window rather than sharing one with tabs, so both
   can be open at once and dragged side by side — which is the point when two
   people stream together.

   Autoplay is off. A site that starts making noise the moment a window opens
   is the one genuinely unfunny thing about 1997, and with two windows there
   are two possible audio sources, so it matters more here, not less.

   Each window tears its player down when hidden — which covers closing AND
   minimising — so nothing keeps playing under a panel you can't see.
   ===================================================================== */

/* Channels are bound to windows by the data-ch attribute in index.html.
   To add a third: copy one of the <section class="win"> blocks, give it a new
   id and data-ch, and add its label here. */
const KICK_LABELS = {
  bobbyjayyy: "BOBBYjayyy",
  benp90: "benp90",
};

/* =====================================================================
   LIVE STATUS
   Polled from our own /.netlify/functions/kick, which relays Kick's public
   channel endpoint. Everything shown here — live or not, the title, the viewer
   count — comes from Kick. Nothing is inferred, and when the poll fails the
   badges disappear rather than freezing on the last thing we saw, because a
   stale LIVE is exactly the badge that would embarrass someone.
   ===================================================================== */
const KickLive = {
  state: {},           // slug -> { live, title, viewers }
  timer: null,
  failures: 0,

  async poll() {
    try {
      const res = await fetch("/.netlify/functions/kick", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const next = {};
      (j.channels || []).forEach((c) => { if (c.ok) next[c.name] = c; });

      // Announce a channel that has just come on air, once.
      Object.keys(next).forEach((k) => {
        if (next[k].live && this.state[k] && !this.state[k].live) {
          Cheetip?.react?.("live", { name: KICK_LABELS[k] || k, title: next[k].title });
        }
      });

      this.state = next;
      this.failures = 0;
    } catch {
      // Two consecutive failures and we stop claiming to know anything.
      if (++this.failures >= 2) this.state = {};
    }
    this.paint();
  },

  isLive(slug) { return Boolean(this.state[slug]?.live); },
  info(slug) { return this.state[slug] || null; },

  paint() {
    const anyone = Object.values(this.state).filter((c) => c.live);
    const tray = document.getElementById("trayLive");
    if (tray) {
      tray.hidden = anyone.length === 0;
      if (anyone.length) {
        const who = anyone.map((c) => KICK_LABELS[c.name] || c.name).join(" & ");
        tray.innerHTML = `<span class="lv-dot"></span>LIVE`;
        tray.title = anyone.length === 1
          ? `${who} is live${anyone[0].title ? ": " + anyone[0].title : ""}`
          : `${who} are both live`;
      }
    }
    StreamWindow.all.forEach((c) => c.paintLive());
    // The landing page shows a LIVE banner too, and it is the most compelling
    // thing on it — it has to update when the poll lands, not only when the
    // dashboard data does.
    if (typeof Landing === "object" && Landing.el) Landing.paint();
  },

  start() {
    if (this.timer) return;
    this.poll();
    // 60s is well inside the function's 30s cache, so most polls are free.
    this.timer = setInterval(() => this.poll(), 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.poll();
    });
  },
};

const StreamWindow = {
  all: [],

  /* One controller per window, so play states stay independent. */
  make(root) {
    const name = root.dataset.ch;
    if (!name || !/^[A-Za-z0-9_-]{1,30}$/.test(name)) {
      root.innerHTML = `<div class="note">This window has no valid Kick channel set
        &mdash; its <code>data-ch</code> attribute is missing or malformed.</div>`;
      return null;
    }
    const win = root.closest(".win");

    const ctl = {
      root, name, win,
      label: KICK_LABELS[name] || name,
      playing: false,

      render() {
        this.root.innerHTML = `
          <div class="st-stage">
            ${this.playing
              ? `<iframe class="st-frame" src="https://player.kick.com/${encodeURIComponent(this.name)}?autoplay=true"
                   title="${esc(this.label)} on Kick"
                   allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
                   referrerpolicy="no-referrer"></iframe>`
              : `<button class="st-play" data-play>
                   <span class="st-play-i">&#9654;</span>
                   <span class="st-play-t">Watch ${esc(this.label)}</span>
                   <span class="st-play-s">loads the Kick player &mdash; nothing plays until you press this</span>
                 </button>`}
          </div>
          <div class="st-live" data-live></div>
          <div class="st-bar">
            <span class="st-name">&#128250; ${esc(this.label)}</span>
            ${this.playing ? `<button class="b95 tiny" data-stop>Stop</button>` : ""}
            <a class="b95 tiny" href="https://kick.com/${encodeURIComponent(this.name)}"
               target="_blank" rel="noopener">Open on Kick</a>
          </div>
          <p class="note">Live status comes from Kick's own public channel data,
          refreshed about once a minute. If it can't be reached the badge disappears
          rather than showing you something stale.</p>`;

        this.root.querySelector("[data-play]")?.addEventListener("click",
          () => { this.playing = true; this.render(); });
        this.root.querySelector("[data-stop]")?.addEventListener("click",
          () => { this.playing = false; this.render(); });
        this.paintLive();
      },

      /* Drawn separately from render() so a poll can update the badge without
         rebuilding the iframe and restarting the stream underneath someone. */
      paintLive() {
        const box = this.root.querySelector("[data-live]");
        if (!box) return;
        const i = KickLive.info(this.name);
        // Empty it as well as hiding it, so there is no stale "LIVE" text left
        // in the node to flash on the next re-show.
        if (!i) { box.hidden = true; box.innerHTML = ""; return; }
        box.hidden = false;
        box.className = "st-live" + (i.live ? " on" : "");
        box.innerHTML = i.live
          ? `<span class="lv-dot"></span><b>LIVE</b>
             ${i.title ? `<span class="st-title">${esc(i.title)}</span>` : ""}
             ${i.viewers != null ? `<span class="st-v">${i.viewers} watching</span>` : ""}`
          : `<span class="st-off">Offline right now</span>`;
      },

      stop() { if (this.playing) { this.playing = false; this.render(); } },
    };

    ctl.render();

    if (win) {
      new MutationObserver(() => { if (win.hidden) ctl.stop(); })
        .observe(win, { attributes: true, attributeFilter: ["hidden"] });
    }
    return ctl;
  },

  init() {
    document.querySelectorAll(".st-root[data-ch]").forEach((root) => {
      if (root.dataset.ready) return;
      root.dataset.ready = "1";
      const c = this.make(root);
      if (c) this.all.push(c);
    });
  },
};

function bootStreams() {
  StreamWindow.init();
  KickLive.start();
  document.getElementById("trayLive")?.addEventListener("click", () => {
    const live = Object.values(KickLive.state).find((c) => c.live);
    if (!live) return;
    WM.open(live.name === "bobbyjayyy" ? "w-st-bobby" : "w-st-benp");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootStreams);
} else {
  bootStreams();
}
