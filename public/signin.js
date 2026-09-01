/* =====================================================================
   SIGN IN
   Three doors into the same account system: Google, Discord, and an emailed
   six-digit code.

   The code is typed back into this page rather than being a link you click in
   your inbox, and that is deliberate. A magic link opened from the Gmail app
   on a phone lands in Gmail's in-app browser — a different browser from the
   one you started in — so you end up signed in somewhere you weren't, staring
   at a fake desktop whose window layout, theme and open windows all live in
   the tab you just left. Typing six digits keeps you in the tab you're in.

   The link still works if someone clicks it; Supabase accepts either. This
   just makes the reliable path the obvious one.

   Nothing here is a security boundary. Supabase issues the code, Supabase
   verifies it, and the ten-minute account-age gate and the confirmed-email
   requirement in cheeto_can_post() apply to email accounts exactly as they do
   to the other two.
   ===================================================================== */

/* Emailed codes are switched OFF until the sending domain is verified with
   the mail provider. Supabase accepts the request and then fails to send, so
   the button would be visibly broken for every visitor who tried it — worse
   than offering two doors instead of three.

   Flip this to true once the DNS records are live and the send works. It is
   the only thing that needs changing: every sign-in surface reads it. */
let EMAIL_SIGNIN = false;   // let, not const: flipping it is the whole point

const SignIn = {
  step: "choose",     // choose | code
  email: "",
  busy: false,
  why: "",

  /* `why` is the one line explaining what the person was trying to do when
     they hit the wall — "Reactions need an account", say. Sign-in prompts
     that don't say why they appeared feel like the site is nagging. */
  open(why) {
    if (typeof sb === "undefined" || !sb) {
      showModal("Sign-in unavailable", "&#9888;",
        "The auth library didn't load, so signing in isn't possible right now. A refresh usually fixes it.");
      return;
    }
    this.why = why || "";
    this.step = "choose";
    this.busy = false;
    this.render();
  },

  render() {
    showModal(this.step === "code" ? "Check your email" : "Sign in", "&#128100;", this.html());
    this.wire();
  },

  html() {
    if (this.step === "code") {
      return `
        <div class="si">
          <p class="si-lead">A six-digit code is on its way to <b>${esc(this.email)}</b>.
          Type it in below &mdash; it's good for about an hour.</p>
          <div class="si-row">
            <input class="i95 si-code" id="siCode" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="6" placeholder="000000" aria-label="Six-digit code from your email">
            <button class="b95" id="siVerify">Verify</button>
          </div>
          <div class="si-msg" id="siMsg"></div>
          <p class="note" style="margin-top:9px">Nothing arrived? Check spam first &mdash; a new
            sender always lands there once. <button class="linky" id="siResend">Send another</button>
            &middot; <button class="linky" id="siBack">Use a different address</button></p>
        </div>`;
    }

    return `
      <div class="si">
        ${this.why ? `<p class="si-lead">${esc(this.why)}</p>` : ""}
        <div class="si-oauth">
          <button class="b95 oauth google" data-si-p="google"><span>G</span> Continue with Google</button>
          <button class="b95 oauth discord" data-si-p="discord"><span>&#9679;</span> Continue with Discord</button>
        </div>
        ${EMAIL_SIGNIN ? `
        <div class="si-or"><span>or use your email</span></div>
        <div class="si-row">
          <input class="i95" id="siEmail" type="email" inputmode="email" autocomplete="email"
                 maxlength="120" placeholder="you@example.com" aria-label="Your email address"
                 value="${esc(this.email)}">
          <button class="b95" id="siSend">Email me a code</button>
        </div>
        <div class="si-msg" id="siMsg"></div>
        <p class="note" style="margin-top:9px">No password to invent or forget. We email you a
          six-digit code, you type it in, that's the whole account.
          Your address is only ever used to sign you in &mdash; it is never shown on your profile.</p>`
        : `<p class="note" style="margin-top:11px">Signing in with an email address is coming
          shortly. Both of these create a normal account &mdash; nothing is posted anywhere on
          your behalf, and your address is never shown on your profile.</p>`}
      </div>`;
  },

  wire() {
    const body = document.getElementById("modalBody");
    if (!body) return;

    body.querySelectorAll("[data-si-p]").forEach((b) =>
      b.addEventListener("click", () => {
        if (typeof signIn === "function") signIn(b.dataset.siP);
      }));

    const email = body.querySelector("#siEmail");
    if (email) {
      // showModal focuses its OK button; take it back, because the thing the
      // person came here to do is type.
      setTimeout(() => email.focus(), 30);
      email.addEventListener("keydown", (e) => { if (e.key === "Enter") this.send(); });
    }
    body.querySelector("#siSend")?.addEventListener("click", () => this.send());

    const code = body.querySelector("#siCode");
    if (code) {
      setTimeout(() => code.focus(), 30);
      code.addEventListener("input", () => {
        code.value = code.value.replace(/[^0-9]/g, "").slice(0, 6);
        // Six digits is the whole code, so there's nothing to press.
        if (code.value.length === 6) this.verify();
      });
      code.addEventListener("keydown", (e) => { if (e.key === "Enter") this.verify(); });
    }
    body.querySelector("#siVerify")?.addEventListener("click", () => this.verify());
    body.querySelector("#siResend")?.addEventListener("click", () => this.send(true));
    body.querySelector("#siBack")?.addEventListener("click", () => {
      this.step = "choose"; this.render();
    });
  },

  msg(html, bad) {
    const el = document.getElementById("siMsg");
    // A class, not an inline colour: #900 on the dark theme's grey is almost
    // unreadable, and an inline style can't be themed.
    if (el) el.innerHTML = bad ? `<span class="si-bad">${html}</span>` : html;
  },

  /* ------------------------------------------------------------- send */
  async send(again) {
    if (this.busy) return;
    const input = document.getElementById("siEmail");
    const addr = (input ? input.value : this.email).trim();

    // Deliberately loose. Strict email regexes reject valid addresses, and the
    // real check is whether the code arrives.
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(addr)) {
      this.msg("That doesn't look like an email address.", true);
      input?.focus();
      return;
    }

    this.email = addr;
    this.busy = true;
    const btn = document.getElementById(again ? "siResend" : "siSend");
    const was = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    this.msg("Sending…");

    try {
      const { error } = await sb.auth.signInWithOtp({
        email: addr,
        options: {
          shouldCreateUser: true,
          // If someone clicks the link in the email instead of typing the
          // code, this is where they land. It has to be on the allow-list in
          // the Supabase dashboard or the link bounces to localhost.
          emailRedirectTo: location.origin + "/?open=w-chat",
        },
      });
      if (error) throw error;
      this.busy = false;
      if (this.step === "code") { this.msg("Sent another one."); if (btn) { btn.disabled = false; btn.textContent = was; } }
      else { this.step = "code"; this.render(); }
    } catch (err) {
      this.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = was; }
      this.msg(this.explain(err), true);
    }
  },

  /* ----------------------------------------------------------- verify */
  async verify() {
    if (this.busy) return;
    const input = document.getElementById("siCode");
    const token = (input?.value || "").replace(/[^0-9]/g, "");
    if (token.length !== 6) { this.msg("The code is six digits.", true); return; }

    this.busy = true;
    const btn = document.getElementById("siVerify");
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    this.msg("Checking…");

    // A code from signInWithOtp verifies as type "email" for an existing
    // account and "signup" for a brand new one, and the client can't tell
    // which it is — the whole point is that the person doesn't have to know
    // whether they have an account. So: try one, then the other, and only on
    // a token error, so a wrong code doesn't quietly burn two attempts.
    let err = null;
    for (const type of ["email", "signup"]) {
      try {
        const { error } = await sb.auth.verifyOtp({ email: this.email, token, type });
        if (!error) { err = null; break; }
        err = error;
        if (!/token|expired|invalid/i.test(error.message || "")) break;
      } catch (e) { err = e; break; }
    }

    this.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = "Verify"; }

    if (err) {
      this.msg(this.explain(err), true);
      if (input) { input.value = ""; input.focus(); }
      return;
    }

    document.getElementById("modal").hidden = true;
    this.onSignedIn();
  },

  /* A brand new email account has a generated handle like "cheeto7" and no
     picture, so it goes straight to the editor. An account that already
     exists doesn't need to be sent anywhere. */
  async onSignedIn() {
    try {
      const fresh = !myProfile || /^cheeto\d*$/i.test(myProfile.handle || "");
      if (fresh) {
        if (typeof openProfile === "function") await openProfile();
        showModal("You're in", "&#127881;",
          `Your account is ready.<br><br>Pick a username and a picture and you're set &mdash;
           right now you're <b>@${esc(myProfile?.handle || "cheeto")}</b>, which nobody will recognise.
           <br><br><span style="color:#555;font-size:11px">There's a ten-minute wait before a
           brand new account can post. It stops drive-by spam, and it applies to everyone.</span>`);
      } else {
        WM.open("w-chat");
      }
    } catch { /* being signed in is the part that mattered */ }
  },

  /* Supabase's auth errors are written for developers. These are the four
     that real people actually hit. */
  explain(err) {
    const m = String(err?.message || err || "");

    // Supabase's own rate-limit text is "For security purposes, you can only
    // request this after N seconds" — no "rate", no "429" in the body. Match
    // it, and pass the number on, because "try again shortly" when the answer
    // is nine seconds is worse than saying nine seconds.
    const wait = m.match(/after (\d+) seconds?/i);
    if (wait) return `Hold on ${wait[1]} seconds before asking for another one — that's a limit on our email sender, not on you.`;
    if (/rate|too many|429/i.test(m)) {
      return "Too many attempts for now — that limit is per email address and per hour. Try again shortly.";
    }
    // "Token has expired or is invalid" is one message covering both cases,
    // so it can't be reported as either one on its own.
    if (/expired or is invalid/i.test(m)) {
      return "That code isn't right, or it's gone stale. Check it, or send another one.";
    }
    if (/expired/i.test(m)) return "That code has expired. Send another one.";
    if (/token|invalid|incorrect/i.test(m)) return "That code isn't right. Check it and try again.";
    if (/signups? not allowed|disabled/i.test(m)) return "New accounts are switched off at the moment.";
    if (/smtp|email|send/i.test(m) && /error|fail/i.test(m)) {
      return "The site couldn't send that email. This is our problem, not yours — try Google or Discord for now.";
    }
    return esc(m || "Something went wrong. Try again.");
  },
};

/* Every sign-in prompt on the site routes through here, so adding a provider
   or changing the copy is one edit rather than six. */
function promptSignIn(why) { SignIn.open(why); }
