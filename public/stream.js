/* =====================================================================
   THE STREAM — Kick player in a 90s window
   Kick's documented embed is https://player.kick.com/<channel>, with optional
   autoplay / muted / allowfullscreen parameters.

   Autoplay is deliberately OFF. A site that starts making noise the moment a
   window opens is the thing everyone hated about 1997, and unlike the blinking
   badge it isn't funny — it's just loud. You press play.

   Whether a channel is LIVE is not something this file can know: reading that
   needs Kick's API, which needs a key and a server-side call. Rather than
   guess, the window says plainly that it shows the player and the player
   itself will say if nobody's on air.
   ===================================================================== */

/* ---------------------------------------------------------------------
   CHANNELS — put the Kick usernames here, exactly as they appear in the
   channel URL (kick.com/THIS_BIT). Add or remove freely; the tab strip
   only appears when there's more than one.
   --------------------------------------------------------------------- */
const KICK_CHANNELS = [
  { name: "bobbyjayyy", label: "BOBBYjayyy" },
  { name: "benp90",     label: "benp90" },
];

const Stream = {
  idx: 0,
  playing: false,

  channels() {
    return KICK_CHANNELS.filter((c) => c && typeof c.name === "string" && /^[A-Za-z0-9_-]{1,30}$/.test(c.name));
  },

  init() {
    const root = document.getElementById("streamRoot");
    if (!root) return;
    this.render();
  },

  render() {
    const root = document.getElementById("streamRoot");
    if (!root) return;
    const chans = this.channels();

    if (!chans.length) {
      root.innerHTML = `<div class="st-empty">
        <div class="st-empty-h">&#128250; No channel configured yet</div>
        <p>Add a Kick username to <code>KICK_CHANNELS</code> at the top of
        <code>stream.js</code> and this window turns into the player.</p>
        <pre class="st-code">const KICK_CHANNELS = [
  { name: "your-kick-name", label: "Your Show" },
];</pre>
        <p class="note">The name is the part after the slash in your channel URL:
        kick.com/<b>your-kick-name</b></p>
      </div>`;
      return;
    }

    const c = chans[Math.min(this.idx, chans.length - 1)];
    root.innerHTML = `
      ${chans.length > 1 ? `<div class="st-tabs">${chans.map((x, i) =>
        `<button class="st-tab${i === this.idx ? " on" : ""}" data-ch="${i}">${esc(x.label || x.name)}</button>`).join("")}</div>` : ""}
      <div class="st-stage">
        ${this.playing
          ? `<iframe class="st-frame" src="https://player.kick.com/${encodeURIComponent(c.name)}?autoplay=true"
               title="${esc(c.label || c.name)} on Kick"
               allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
               referrerpolicy="no-referrer"></iframe>`
          : `<button class="st-play" id="stPlay">
               <span class="st-play-i">&#9654;</span>
               <span class="st-play-t">Watch ${esc(c.label || c.name)}</span>
               <span class="st-play-s">loads the Kick player &mdash; nothing plays until you press this</span>
             </button>`}
      </div>
      <div class="st-bar">
        <span class="st-name">&#128250; ${esc(c.label || c.name)}</span>
        <a class="b95 tiny" href="https://kick.com/${encodeURIComponent(c.name)}"
           target="_blank" rel="noopener">Open on Kick</a>
      </div>
      <p class="note">If the stream is offline the player will say so. This window
      doesn't poll Kick for live status &mdash; that needs an API key, and a badge
      that guesses would be worse than no badge.</p>`;

    document.getElementById("stPlay")?.addEventListener("click", () => { this.playing = true; this.render(); });
    root.querySelectorAll("[data-ch]").forEach((b) =>
      b.addEventListener("click", () => { this.idx = +b.dataset.ch; this.playing = false; this.render(); }));
  },
};

function initStream() {
  const w = document.getElementById("w-stream");
  if (!w) return;
  const start = () => { if (!w.hidden) Stream.init(); };
  new MutationObserver(start).observe(w, { attributes: true, attributeFilter: ["hidden"] });
  start();
  // Closing the window should stop the stream, not leave audio playing under
  // a hidden panel.
  new MutationObserver(() => { if (w.hidden && Stream.playing) { Stream.playing = false; Stream.render(); } })
    .observe(w, { attributes: true, attributeFilter: ["hidden"] });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initStream);
} else { initStream(); }
