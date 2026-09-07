// AccountPanel — identity for Solar Odyssey.
//
// Three states, all playable:
//   GUEST      — the default. A random commander name + everything stored in
//                this browser (localStorage). No account, no connection, no
//                nag screens. Guests can still export/import their career.
//   CONNECTED  — a Supabase project URL + anon key have been pasted in, so the
//                server list and public rocket designs become readable.
//   SIGNED IN  — email + password account: cloud saves, settings sync, friends,
//                publishing rockets.
import { el, clearChildren, makeModal } from '../utils/UI.js';

const ADJ = ['Iron', 'Solar', 'Void', 'Nova', 'Orbit', 'Comet', 'Vesper', 'Aurora', 'Titan', 'Halo'];
const NOUN = ['Pilot', 'Ranger', 'Drifter', 'Scout', 'Nomad', 'Wanderer', 'Falcon', 'Vector', 'Rook', 'Lark'];

export function randomGuestName() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}${Math.floor(Math.random() * 900 + 100)}`;
}

export class AccountPanel {
  /**
   * @param hooks {backend, identity(), setIdentity(patch), onChanged(),
   *               toast(title, msg, kind)}
   */
  constructor(root, hooks) {
    this.hooks = hooks;
    this.modal = makeModal('account-modal', 'COMMANDER ACCOUNT');
    root.appendChild(this.modal.root);
    this.mode = 'menu'; // menu | signin | signup | connect | forgot | newpass
  }

  show() { this.mode = 'menu'; this.render(); this.modal.root.classList.remove('hidden'); }
  /** Opened by the password-recovery email link: the player is signed in and must pick a new password. */
  showPasswordReset() { this.mode = 'newpass'; this.render(); this.modal.root.classList.remove('hidden'); }
  hide() { this.modal.root.classList.add('hidden'); }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  _row(label, input) {
    const r = el('div', 'form-row');
    r.appendChild(el('label', 'form-label', label));
    r.appendChild(input);
    return r;
  }
  _input(type, placeholder, value) {
    const i = el('input', 'input');
    i.type = type; i.placeholder = placeholder || '';
    if (value) i.value = value;
    return i;
  }
  _status(msg, kind) {
    const s = el('div', 'form-status ' + (kind || ''), msg);
    this.body.appendChild(s);
    return s;
  }

  render() {
    const b = this.modal.body;
    this.body = b;
    clearChildren(b);
    const be = this.hooks.backend;
    const id = this.hooks.identity();

    if (this.mode === 'signin') return this._renderAuth(false);
    if (this.mode === 'signup') return this._renderAuth(true);
    if (this.mode === 'connect') return this._renderConnect();
    if (this.mode === 'forgot') return this._renderForgot();
    if (this.mode === 'newpass') return this._renderNewPassword();

    // ---- overview ----
    const card = el('div', 'account-card');
    const signed = be.signedIn;
    card.innerHTML = `
      <div class="ac-avatar">${(signed ? be.handle : id.name).slice(0, 2).toUpperCase()}</div>
      <div class="ac-info">
        <div class="ac-name">${signed ? be.handle : id.name}</div>
        <div class="ac-mode dim">${signed ? 'Signed in — cloud save enabled'
          : be.configured ? 'Guest on a connected server — data stored in this browser'
          : 'Guest — data stored in this browser only'}</div>
      </div>`;
    b.appendChild(card);

    if (!signed) {
      const rename = el('div', 'form-row');
      const nameIn = this._input('text', 'Commander name', id.name);
      nameIn.maxLength = 20;
      const saveName = el('button', 'btn btn-small', 'RENAME');
      saveName.addEventListener('click', () => {
        const v = nameIn.value.trim().slice(0, 20);
        if (!v) return;
        this.hooks.setIdentity({ name: v });
        this.hooks.toast?.('COMMANDER', 'You are now ' + v + '.', 'success');
        this.render();
        this.hooks.onChanged?.();
      });
      rename.append(el('label', 'form-label', 'Guest name'), nameIn, saveName);
      b.appendChild(rename);

      b.appendChild(el('p', 'dim',
        'Guest mode is fully playable: careers, rockets and settings live in this browser. ' +
        'Create an account only if you want cloud saves, friends and rocket sharing across devices.'));
    }

    const acts = el('div', 'btn-row wrap');
    if (!be.configured) {
      const connect = el('button', 'btn btn-primary', 'CONNECT SERVER');
      connect.addEventListener('click', () => { this.mode = 'connect'; this.render(); });
      acts.appendChild(connect);
    } else if (!signed) {
      const inBtn = el('button', 'btn btn-primary', 'SIGN IN');
      inBtn.addEventListener('click', () => { this.mode = 'signin'; this.render(); });
      const upBtn = el('button', 'btn', 'CREATE ACCOUNT');
      upBtn.addEventListener('click', () => { this.mode = 'signup'; this.render(); });
      acts.append(inBtn, upBtn);
    } else {
      const out = el('button', 'btn', 'SIGN OUT');
      out.addEventListener('click', async () => {
        await be.signOut();
        this.hooks.toast?.('SIGNED OUT', 'Back to guest mode — local saves are untouched.', 'info');
        this.render();
        this.hooks.onChanged?.();
      });
      const push = el('button', 'btn btn-primary', '☁ UPLOAD SAVES');
      push.addEventListener('click', () => this.hooks.syncAll?.());
      acts.append(push, out);
    }
    if (be.configured) {
      const disc = el('button', 'btn btn-danger', 'DISCONNECT SERVER');
      disc.addEventListener('click', () => {
        be.disconnect();
        this.hooks.toast?.('DISCONNECTED', 'Server credentials removed from this browser.', 'info');
        this.render();
        this.hooks.onChanged?.();
      });
      acts.appendChild(disc);
    }
    b.appendChild(acts);

    if (be.configured) {
      b.appendChild(el('p', 'dim tiny', 'Connected to ' + be.url));
    }
  }

  _renderConnect() {
    const b = this.body;
    b.appendChild(el('h3', 'form-heading', 'CONNECT A GAME SERVER'));
    b.appendChild(el('p', 'dim',
      'Solar Odyssey stores online data in a Supabase project. Paste your project URL and anon public key ' +
      '(Supabase dashboard → Project Settings → API). Run <code>supabase/schema.sql</code> once in the SQL editor first. ' +
      'The keys stay in this browser.'));
    const url = this._input('text', 'https://yourproject.supabase.co', this.hooks.backend.url || '');
    const key = this._input('password', 'anon public key', '');
    b.appendChild(this._row('Project URL', url));
    b.appendChild(this._row('Anon key', key));
    const row = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', 'CONNECT');
    const back = el('button', 'btn', 'BACK');
    back.addEventListener('click', () => { this.mode = 'menu'; this.render(); });
    go.addEventListener('click', async () => {
      try {
        this.hooks.backend.configure(url.value, key.value);
        // Prove the connection works before celebrating.
        await this.hooks.backend.listServers('all');
        this.hooks.toast?.('SERVER CONNECTED', 'Online features are live.', 'success');
        this.mode = 'menu';
        this.render();
        this.hooks.onChanged?.();
      } catch (e) {
        this._status(e?.message || String(e), 'error');
      }
    });
    row.append(go, back);
    b.appendChild(row);
  }

  _renderAuth(isSignUp) {
    const b = this.body;
    b.appendChild(el('h3', 'form-heading', isSignUp ? 'CREATE COMMANDER ACCOUNT' : 'SIGN IN'));
    const email = this._input('email', 'commander@example.com');
    const pass = this._input('password', 'password');
    let handle = null;
    if (isSignUp) {
      handle = this._input('text', 'Callsign', this.hooks.identity().name);
      b.appendChild(this._row('Callsign', handle));
    }
    b.appendChild(this._row('Email', email));
    b.appendChild(this._row('Password', pass));

    const row = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN');
    const alt = el('button', 'btn', isSignUp ? 'I HAVE AN ACCOUNT' : 'CREATE ONE');
    const back = el('button', 'btn', 'BACK');
    alt.addEventListener('click', () => { this.mode = isSignUp ? 'signin' : 'signup'; this.render(); });
    back.addEventListener('click', () => { this.mode = 'menu'; this.render(); });
    const submit = async () => {
      go.disabled = true;
      const status = this._status('Contacting the relay…');
      try {
        if (isSignUp) {
          const res = await this.hooks.backend.signUp(email.value.trim(), pass.value, handle.value.trim());
          if (!res.confirmed) {
            this._renderCheckEmail(email.value.trim(), status);
            return;
          }
        } else {
          await this.hooks.backend.signIn(email.value.trim(), pass.value);
        }
        this.hooks.toast?.('WELCOME', 'Signed in as ' + this.hooks.backend.handle + '.', 'success');
        this.mode = 'menu';
        this.render();
        this.hooks.onChanged?.();
      } catch (e) {
        status.textContent = this._friendlyAuthError(e);
        status.className = 'form-status error';
        go.disabled = false;
      }
    };
    go.addEventListener('click', submit);
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    row.append(go, alt, back);
    b.appendChild(row);

    if (!isSignUp) {
      const forgot = el('button', 'btn btn-link', 'Forgot password?');
      forgot.addEventListener('click', () => { this.prefillEmail = email.value.trim(); this.mode = 'forgot'; this.render(); });
      b.appendChild(forgot);
    }
  }

  /** Turn GoTrue's terse errors into something a player can act on. */
  _friendlyAuthError(e) {
    const msg = e?.message || String(e);
    if (/email not confirmed/i.test(msg)) {
      return 'This email is not confirmed yet — open the "Confirm your email" link we sent you (it brings you straight back here), or create the account again to get a new one.';
    }
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/already registered|already been registered/i.test(msg)) return 'That email already has an account — use SIGN IN.';
    if (/password should be at least|weak password/i.test(msg)) return 'Password too short — use at least 6 characters.';
    if (/rate limit|too many requests/i.test(msg)) return 'Too many attempts — wait a minute and try again.';
    return msg;
  }

  /**
   * Post-sign-up state: the account exists but Supabase wants the email
   * confirmed first. The link in that mail brings the player back to THIS
   * page already signed in (see Backend.redirectTo), so the copy must not
   * tell them to "sign in" afterwards — they won't need to.
   */
  _renderCheckEmail(email, status) {
    const b = this.body;
    if (status) status.remove();
    clearChildren(b);
    b.appendChild(el('h3', 'form-heading', 'CHECK YOUR EMAIL'));
    const intro = el('p', '');
    intro.append('We sent a confirmation link to ');
    intro.appendChild(el('b', '', '')).textContent = email;   // textContent: never render user input as HTML
    intro.append('. Open it and you will land back in Solar Odyssey, already signed in — no second sign-in needed.');
    b.appendChild(intro);
    b.appendChild(el('p', 'dim tiny',
      'Nothing there after a minute? Check the spam folder, or send it again. ' +
      'The link is only valid for a limited time and works once.'));
    const row = el('div', 'btn-row wrap');
    const resend = el('button', 'btn', 'RESEND EMAIL');
    const back = el('button', 'btn', 'BACK');
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      const st = this._status('Sending…');
      try {
        await this.hooks.backend.resendConfirmation(email);
        st.textContent = 'Sent again — check your inbox.';
        st.className = 'form-status ok';
      } catch (e) {
        st.textContent = e?.message || String(e);
        st.className = 'form-status error';
      }
      setTimeout(() => { resend.disabled = false; }, 15000);
    });
    back.addEventListener('click', () => { this.mode = 'menu'; this.render(); });
    row.append(resend, back);
    b.appendChild(row);
  }

  _renderForgot() {
    const b = this.body;
    b.appendChild(el('h3', 'form-heading', 'RESET PASSWORD'));
    b.appendChild(el('p', 'dim', 'We will email you a link. Opening it brings you back here, signed in, so you can choose a new password.'));
    const email = this._input('email', 'commander@example.com', this.prefillEmail || '');
    b.appendChild(this._row('Email', email));
    const row = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', 'SEND LINK');
    const back = el('button', 'btn', 'BACK');
    back.addEventListener('click', () => { this.mode = 'signin'; this.render(); });
    go.addEventListener('click', async () => {
      go.disabled = true;
      const status = this._status('Contacting the relay…');
      try {
        await this.hooks.backend.requestPasswordReset(email.value.trim());
        status.textContent = 'Sent — open the link in the email to continue.';
        status.className = 'form-status ok';
      } catch (e) {
        status.textContent = e?.message || String(e);
        status.className = 'form-status error';
        go.disabled = false;
      }
    });
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    row.append(go, back);
    b.appendChild(row);
  }

  _renderNewPassword() {
    const b = this.body;
    b.appendChild(el('h3', 'form-heading', 'CHOOSE A NEW PASSWORD'));
    b.appendChild(el('p', 'dim', 'You are signed in through the reset link. Pick a new password to finish.'));
    const pass = this._input('password', 'new password (6+ characters)');
    const again = this._input('password', 'repeat it');
    b.appendChild(this._row('New password', pass));
    b.appendChild(this._row('Repeat', again));
    const row = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', 'SAVE PASSWORD');
    const skip = el('button', 'btn', 'LATER');
    skip.addEventListener('click', () => { this.mode = 'menu'; this.render(); });
    const submit = async () => {
      if (pass.value !== again.value) { this._status('The two passwords do not match.', 'error'); return; }
      go.disabled = true;
      const status = this._status('Saving…');
      try {
        await this.hooks.backend.updatePassword(pass.value);
        this.hooks.toast?.('PASSWORD UPDATED', 'Use it next time you sign in.', 'success');
        this.mode = 'menu';
        this.render();
      } catch (e) {
        status.textContent = e?.message || String(e);
        status.className = 'form-status error';
        go.disabled = false;
      }
    };
    go.addEventListener('click', submit);
    again.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    row.append(go, skip);
    b.appendChild(row);
  }
}
