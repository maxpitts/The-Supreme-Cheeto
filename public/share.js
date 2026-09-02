/* =====================================================================
   SHARE CARDS
   The site generates perfect share material every day — a debt guess that
   was 0.002% off, a nine-day streak, a Call It record — and until now all of
   it died inside the tab it happened in.

   Everything is drawn on a canvas here in the browser. No server, no image
   service, no per-user OG endpoint to keep warm: the card is made from
   numbers the page already has, at the moment somebody asks for it.

   Three ways out, because platform support for each is patchy and none of
   them works everywhere:
     - Share sheet (navigator.share with a file) — phones, and by far the best
     - Copy image to clipboard — desktop Chrome and Edge, straight into a post
     - Download — the one that always works, so it is always offered
   The buttons that can't work on a given browser aren't shown at all, rather
   than being shown and failing.

   The card carries the URL as text rather than a QR code or a bare link
   preview: it has to survive being screenshotted, re-cropped and reposted,
   which is what actually happens to images like this.
   ===================================================================== */

const Share = {
  W: 1200,
  H: 630,
  blob: null,
  url: "",

  /* ------------------------------------------------------------- open */
  async open(kind, data) {
    const card = this.CARDS[kind];
    if (!card) return;
    const spec = card(data || {});
    this.url = spec.link || "https://supremecheeto.club";

    showModal("Share this", "&#128247;", `
      <div class="sh">
        <div class="sh-prev" id="shPrev"><div class="note">Drawing…</div></div>
        <div class="sh-btns" id="shBtns"></div>
        <div class="sh-msg note" id="shMsg"></div>
        <p class="note" style="margin-top:8px">The picture is made in your browser from
          what's on screen. Nothing is uploaded, and no link is created that points back
          at you.</p>
      </div>`);

    try {
      this.blob = await this.draw(spec);
    } catch {
      const p = document.getElementById("shPrev");
      if (p) p.innerHTML = `<div class="note" style="color:#900">Couldn't draw the card.</div>`;
      return;
    }

    const prev = document.getElementById("shPrev");
    if (prev) {
      const img = new Image();
      img.src = URL.createObjectURL(this.blob);
      img.alt = spec.alt || "Share card";
      prev.innerHTML = "";
      prev.appendChild(img);
    }
    this.buttons(spec);
  },

  buttons(spec) {
    const box = document.getElementById("shBtns");
    if (!box) return;
    const file = new File([this.blob], "supreme-cheeto.png", { type: "image/png" });

    const canShare = typeof navigator.canShare === "function" &&
                     navigator.canShare({ files: [file] }) &&
                     typeof navigator.share === "function";
    const canCopy = typeof ClipboardItem !== "undefined" &&
                    !!navigator.clipboard?.write;

    box.innerHTML = [
      canShare ? `<button class="b95" data-sh="share">Share…</button>` : "",
      canCopy  ? `<button class="b95" data-sh="copy">Copy image</button>` : "",
      `<button class="b95" data-sh="save">Download</button>`,
      `<button class="b95 tiny" data-sh="link">Copy link</button>`,
    ].join("");

    box.querySelectorAll("[data-sh]").forEach((b) =>
      b.addEventListener("click", () => this.act(b.dataset.sh, file, spec)));
  },

  async act(what, file, spec) {
    const say = (m, bad) => {
      const el = document.getElementById("shMsg");
      if (el) el.innerHTML = bad ? `<span style="color:#900">${esc(m)}</span>` : esc(m);
    };
    try {
      if (what === "share") {
        await navigator.share({ files: [file], text: spec.text, title: "The Supreme Cheeto" });
        say("Shared.");
      } else if (what === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": this.blob })]);
        say("Image copied — paste it straight into a post.");
      } else if (what === "save") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(this.blob);
        a.download = "supreme-cheeto.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        say("Saved to your downloads.");
      } else if (what === "link") {
        await navigator.clipboard.writeText(spec.text ? spec.text + " " + this.url : this.url);
        say("Link copied.");
      }
    } catch (err) {
      // A cancelled share sheet throws AbortError; that is a user choosing not
      // to, not a failure worth shouting about.
      if (err?.name === "AbortError") return;
      say("Your browser refused that. Try Download instead.", true);
    }
  },

  /* ------------------------------------------------------------- draw */
  async draw(spec) {
    const c = document.createElement("canvas");
    c.width = this.W; c.height = this.H;
    const x = c.getContext("2d");

    // desktop
    x.fillStyle = "#0a6f6f";
    x.fillRect(0, 0, this.W, this.H);
    x.strokeStyle = "rgba(255,255,255,.045)";
    x.lineWidth = 2;
    for (let i = -this.H; i < this.W; i += 26) {
      x.beginPath(); x.moveTo(i, this.H); x.lineTo(i + this.H, 0); x.stroke();
    }

    /* Measure before drawing. The window used to be a fixed height, which
       left a slab of empty grey under every short card.

       SIZED FOR A FEED, NOT FOR A DESKTOP. A share card is almost never seen
       at 1200px — it is seen at three or four hundred, in a timeline, on a
       phone, while somebody scrolls past it. At that scale the old 20px
       kicker and 24px supporting lines rendered around eight pixels tall and
       were simply not readable, which makes the card decorative rather than
       informative. Everything below is sized so that at 0.35x — a typical
       feed thumbnail — no text falls under about 12 effective pixels.

       The window also fills the canvas now instead of floating in the middle
       of a pool of teal: wasted space on a card is wasted legibility. */
    const wx = 54, ww = this.W - 108;
    const bwMeasure = ww - 44;
    const big = spec.big || "";
    let size = 132;
    x.font = `bold ${size}px 'Courier New', monospace`;
    while (x.measureText(big).width > bwMeasure && size > 44) {
      size -= 4;
      x.font = `bold ${size}px 'Courier New', monospace`;
    }
    const rh = size + 44;

    const KICK = 32, LINE = 36, LGAP = 46;
    const lines = (spec.lines || []).slice(0, 2);
    const wy = 34;
    const wh = this.H - wy - 96;      // down to just above the footer
    this.bevel(x, wx, wy, ww, wh, "#c3c3c3");

    // title bar
    const g = x.createLinearGradient(wx + 4, 0, wx + ww - 4, 0);
    g.addColorStop(0, "#0a1e6e"); g.addColorStop(1, "#3a7ad4");
    x.fillStyle = g;
    x.fillRect(wx + 4, wy + 4, ww - 8, 54);
    x.fillStyle = "#fff";
    // 34, not 30: at a 0.35x feed thumbnail this is the difference between
    // 10.5 and 11.9 effective pixels, and the title is what tells somebody
    // scrolling past what they are looking at.
    x.font = "bold 34px 'Courier New', monospace";
    x.textBaseline = "middle";
    x.fillText(spec.title, wx + 20, wy + 32);

    // the three chrome buttons, because the joke is the chrome
    ["_", "\u25a1", "\u00d7"].forEach((ch, i) => {
      const bx2 = wx + ww - 26 - (3 - i) * 42;
      this.bevel(x, bx2, wy + 13, 36, 34, "#c3c3c3");
      x.fillStyle = "#000";
      x.font = "bold 21px 'Courier New', monospace";
      x.textAlign = "center";
      x.fillText(ch, bx2 + 18, wy + 30);
      x.textAlign = "left";
    });

    // body
    const bx = wx + 22, bw = ww - 44;
    let cy = wy + 58 + 30;
    x.fillStyle = "#1a1a1a";
    x.font = `${KICK}px system-ui, sans-serif`;
    x.fillText(spec.kicker, bx, cy);

    // a sunken readout, like every other number on the site
    const ry = cy + 26;
    this.sunken(x, bx, ry, bw, rh);
    x.fillStyle = spec.color || "#0b7a0b";
    x.font = `bold ${size}px 'Courier New', monospace`;
    x.textAlign = "center";
    x.fillText(big, bx + bw / 2, ry + rh / 2);
    x.textAlign = "left";

    /* Supporting lines, wrapped rather than run off the edge. A long figure
       like "$40,185,105,246,526" used to push the sentence past the window
       border on any card with two numbers in it. */
    x.fillStyle = "#1a1a1a";
    x.font = `${LINE}px system-ui, sans-serif`;
    let ly = ry + rh + LGAP;
    const bottom = wy + wh - 18;
    for (const l of lines) {
      for (const part of this.wrap(x, l, bw)) {
        if (ly > bottom) break;
        x.fillText(part, bx, ly);
        ly += LGAP;
      }
    }

    // footer
    x.fillStyle = "#ffffff";
    x.font = "bold 34px 'Courier New', monospace";
    x.fillText("supremecheeto.club", wx, this.H - 40);
    // Right-aligned rather than offset by a magic number, so it cannot ever
    // run into the wordmark on a narrower render.
    /* The strapline was 24px, which is 8px in a feed — present but unreadable,
       which is the worst of both: it costs space and says nothing. Bigger and
       shorter, so it survives the scale-down or does not earn its place. */
    x.fillStyle = "rgba(255,255,255,.9)";
    x.font = "32px system-ui, sans-serif";
    x.textAlign = "right";
    x.fillText("tracked from public sources", wx + ww, this.H - 40);
    x.textAlign = "left";

    return await new Promise((res) => c.toBlob(res, "image/png"));
  },

  /* Greedy wrap against the measured width. Without it a long sentence is
     drawn straight through the window border, which is the single most common
     way a generated card looks broken. */
  wrap(x, text, maxW) {
    const words = String(text).split(/\s+/);
    const out = []; let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (x.measureText(test).width > maxW && line) { out.push(line); line = w; }
      else line = test;
    }
    if (line) out.push(line);
    return out.slice(0, 3);
  },

  bevel(x, X, Y, W, H, fill) {
    x.fillStyle = fill; x.fillRect(X, Y, W, H);
    x.fillStyle = "#fff"; x.fillRect(X, Y, W, 3); x.fillRect(X, Y, 3, H);
    x.fillStyle = "#5a5a5a"; x.fillRect(X, Y + H - 3, W, 3); x.fillRect(X + W - 3, Y, 3, H);
  },

  sunken(x, X, Y, W, H) {
    x.fillStyle = "#000"; x.fillRect(X, Y, W, H);
    x.fillStyle = "#5a5a5a"; x.fillRect(X, Y, W, 2); x.fillRect(X, Y, 2, H);
    x.fillStyle = "#fff"; x.fillRect(X, Y + H - 2, W, 2); x.fillRect(X + W - 2, Y, 2, H);
    x.fillStyle = "#000"; x.fillRect(X + 2, Y + 2, W - 4, H - 4);
  },

  /* ------------------------------------------------------------ cards */
  CARDS: {
    guess: (d) => ({
      title: "C:\\GOV\\NATIONAL_DEBT.EXE",
      kicker: "I guessed the national debt to within",
      big: (Number(d.pct) < 0.01 ? Number(d.pct).toFixed(4)
           : Number(d.pct) < 1 ? Number(d.pct).toFixed(3)
           : Number(d.pct).toFixed(2)) + "%",
      color: Number(d.pct) < 1 ? "#19c819" : "#ffb020",
      lines: [
        `I said ${d.guessText} \u2014 it was ${d.actualText}.`,
        d.rank ? `#${d.rank} of ${d.field} today${d.streak > 1 ? ` \u00b7 ${d.streak}-day streak` : ""}`
               : (d.streak > 1 ? `${d.streak}-day streak` : "One guess a day. Come and beat it."),
      ],
      text: `I guessed the US national debt to within ${Number(d.pct).toFixed(2)}%.`,
      link: "https://supremecheeto.club/?open=w-debt",
      alt: "A share card showing how close a debt guess was",
    }),

    record: (d) => ({
      title: "C:\\GAMES\\CALL_IT.EXE",
      kicker: "My record calling what he does next",
      big: `${d.correct}/${d.resolved}`,
      color: "#19c819",
      lines: [
        d.pct != null ? `${d.pct}% hit rate across ${d.resolved} scored calls.` : "Scored by the server, not by me.",
        "Daily predictions on real figures. No stakes, just a permanent record of being wrong.",
      ],
      text: `I'm ${d.correct}/${d.resolved} calling what he does next.`,
      link: "https://supremecheeto.club/?open=w-predict",
      alt: "A share card showing a prediction record",
    }),

    profile: (d) => ({
      title: "C:\\USERS\\" + String(d.handle || "").toUpperCase(),
      kicker: "Find me on the Cheeto desktop",
      big: "@" + (d.handle || "someone"),
      color: "#ffb020",
      lines: [
        d.bio ? String(d.bio).slice(0, 70) : "A 1997 Windows desktop that tracks the president.",
        `${d.friends || 0} friends \u00b7 member since ${d.since || "recently"}`,
      ],
      text: `My profile on The Supreme Cheeto:`,
      link: `https://supremecheeto.club/?open=w-user&u=${encodeURIComponent(d.handle || "")}`,
      alt: "A share card for a user profile",
    }),

    meter: (d) => ({
      title: "C:\\GOV\\CHEETO-METER.EXE",
      kicker: "The Cheeto-meter reads",
      big: Number(d.value).toFixed(1),
      color: Number(d.value) > 66 ? "#ff5a5a" : Number(d.value) > 33 ? "#ffb020" : "#19c819",
      lines: [
        "Five public indicators, equally weighted, updated every fifteen minutes.",
        "Every input is linked and checkable.",
      ],
      text: `The Cheeto-meter is at ${Number(d.value).toFixed(1)}/100.`,
      link: "https://supremecheeto.club/?open=w-meter",
      alt: "A share card showing the Cheeto-meter reading",
    }),
  },
};
