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
          <div class="st-bar">
            <span class="st-name">&#128250; ${esc(this.label)}</span>
            ${this.playing ? `<button class="b95 tiny" data-stop>Stop</button>` : ""}
            <a class="b95 tiny" href="https://kick.com/${encodeURIComponent(this.name)}"
               target="_blank" rel="noopener">Open on Kick</a>
          </div>
          <p class="note">If the stream is offline the player says so. This window
          doesn't poll Kick for live status, so there's no badge here that could be
          telling you the wrong thing.</p>`;

        this.root.querySelector("[data-play]")?.addEventListener("click",
          () => { this.playing = true; this.render(); });
        this.root.querySelector("[data-stop]")?.addEventListener("click",
          () => { this.playing = false; this.render(); });
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => StreamWindow.init());
} else {
  StreamWindow.init();
}
