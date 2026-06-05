// Phase 16 — standalone pair-view JS module.
//
// Wires the OTP-entry form in /pair.html to the server's /pair/redeem route.
// On success: persists the returned device token + device_id to localStorage
// and navigates to / so app.js boots the dashboard with the new token in
// the WS subprotocol header.
//
// This module stands alone — it has no shared imports because none of the
// dashboard's state/utility modules are useful pre-pair, and importing
// them would couple the pair page to the dashboard's heavier modules
// for no reason. The file's effect is purely side-effectful DOM wiring
// on load; no exports.
//
// CLAUDE.md §13 (secrets hygiene): the raw OTP and the returned device
// token are credentials. They MUST NOT appear in console.log, the DOM,
// or the alert/toast surface. The token enters localStorage and the
// page navigates away before anything else could leak it. Error
// messages displayed in #pair-error are human-readable strings only
// (no token, no OTP).
//
// AC mapping:
//   - AC2 (valid OTP → token persisted, dashboard reloads): the success
//     branch of the fetch handler is the AC2 contract.
//   - AC7 (owner bootstrap path works): identical flow — the bootstrap
//     OTP is just another OTP the server's pair-otp store knows about.
//   - AC8 (token never leaks to logs): the no-console-log policy below.
//   - AC9 (distinct error codes for expired / used / invalid): the
//     status-code switch below maps server's 410/400 contract to four
//     distinct user-facing strings (expired / used / invalid / network).

// Storage keys are inlined as literal strings at the localStorage.setItem
// site so the Wave-0 e2e spec's grep (`localStorage.setItem('clideck.deviceToken'`)
// matches the canonical pattern verbatim. The duplicated string is intentional;
// any rename would have to be made in both the writer (pair.js) and the reader
// (app.js boot-time check + onclose hybrid-handler clear).
const form = document.getElementById('pair-form');
const otpEl = document.getElementById('otp');
const labelEl = document.getElementById('label');
const submitBtn = document.getElementById('pair-submit');
const errorEl = document.getElementById('pair-error');

// Auto-uppercase the OTP as the user types. iOS's autocapitalize="characters"
// covers most of this on mobile, but desktop browsers and password managers
// can still inject mixed-case so we normalise live for visual confirmation
// and submit-time both. The OTP normaliser on the server (routes/pair.js's
// `String(payload.otp || '').toUpperCase().replace(/[^A-Z0-9]/g, '')`)
// would tolerate any input shape, but normalising in the UI makes the
// failure modes more obvious to the user.
otpEl.addEventListener('input', () => {
  const cursor = otpEl.selectionStart;
  const next = otpEl.value.toUpperCase();
  if (next !== otpEl.value) {
    otpEl.value = next;
    // Restore the caret — re-setting .value moves it to the end otherwise.
    try { otpEl.setSelectionRange(cursor, cursor); } catch { /* not supported on every input type — ignore */ }
  }
});

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

// Map a (status, errorCode) pair to a user-facing string. The four cases
// mirror the server contract documented in routes/pair.js:
//   - 200 + ok:true    → success (handled separately, not this function)
//   - 410 + 'expired'  → OTP TTL elapsed (user must mint a new one)
//   - 400 + 'used'     → single-use OTP was already redeemed
//   - 400 + 'invalid'  → unknown OTP, or malformed/empty after normalisation
//   - 400 + 'invalid-json' → only if the client sent malformed JSON; treat as
//     the generic network fallback because the user can't act on it specifically
//   - anything else (5xx, network failure, fetch reject) → generic retry hint
function describeError(status, errorCode) {
  if (status === 410 || errorCode === 'expired') {
    return 'That code has expired. Generate a new one from your server boot log or from Settings → Linked devices on another paired device.';
  }
  if (errorCode === 'used') {
    return 'That code was already used. Generate a new one.';
  }
  if (errorCode === 'invalid') {
    return 'Unknown code. Check the code and try again.';
  }
  // 'invalid-json', 5xx, network failure, anything else.
  return 'Network error. Please try again.';
}

async function submitPair(event) {
  if (event) event.preventDefault();
  clearError();

  // Normalise (mirrors server-side `String(payload.otp || '').toUpperCase().replace(/[^A-Z0-9]/g, '')`).
  const otp = (otpEl.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!otp) {
    showError('Enter the 6-character code.');
    otpEl.focus();
    return;
  }

  // Label: trimmed, capped at 32 chars (D-04). The server clamps and falls
  // back to 'Device' if empty after trim; we send what the user typed and
  // let the server be authoritative on the empty-label fallback.
  const rawLabel = (labelEl && labelEl.value) || '';
  const label = rawLabel.trim().slice(0, 32);

  // ua_hint: 200-char slice of the UA string. The server uses this to mint
  // a 12-hex-char fingerprint stored on the device record for display only
  // (CONTEXT §"Deferred Ideas" — fingerprint VERIFICATION is out of scope).
  const ua_hint = (navigator.userAgent || '').slice(0, 200);

  submitBtn.disabled = true;
  // Brief in-flight label change for visual feedback. The button text reverts
  // on every code path (success navigates away; error re-enables).
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'Pairing…';

  let response;
  let payload;
  try {
    response = await fetch('/pair/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp, label, ua_hint }),
    });
  } catch {
    // Fetch rejected (offline, DNS fail, CORS — none of these should hit
    // on the LAN VPN happy path but defence-in-depth is cheap here).
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    showError(describeError(0, 'network'));
    return;
  }

  try {
    payload = await response.json();
  } catch {
    // Server returned a non-JSON body — unexpected. Treat as network.
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    showError(describeError(response.status, 'invalid-json'));
    return;
  }

  if (response.ok && payload && payload.ok && typeof payload.token === 'string' && typeof payload.device_id === 'string') {
    // Per CLAUDE.md §13 — the next two writes are the ONLY persistence of
    // the raw token in the browser. The token never enters console.log,
    // alert, document.title, or any DOM node text. The page navigates
    // before anything else can read it.
    try {
      localStorage.setItem('clideck.deviceToken', payload.token);
      localStorage.setItem('clideck.deviceId', payload.device_id);
    } catch {
      // localStorage write failed (private-mode Safari, quota exceeded).
      // Don't reveal token-shaped strings; just tell the user to retry.
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      showError('Could not save the pairing on this browser. Try a different browser or disable private/incognito mode.');
      return;
    }
    // Navigate to the dashboard. app.js's boot-time check (Task 3) will
    // pick up the token and construct the WS with the subprotocol header.
    window.location.href = '/';
    return;
  }

  // Non-success path: re-enable the form and show a tailored error.
  submitBtn.disabled = false;
  submitBtn.textContent = originalLabel;
  const errorCode = (payload && payload.error) || '';
  showError(describeError(response.status, errorCode));
}

// Both the form-submit and the explicit click on the button route here.
// Listening on the form covers iOS's "Go" key + Enter on desktop; listening
// on the button as a fallback covers older browsers where pressing Enter
// on a single-field form fires the click directly without a form submit.
form.addEventListener('submit', submitPair);
submitBtn.addEventListener('click', (e) => {
  // If the button is inside the form (it is) the form-submit handler will
  // run anyway. Only invoke directly if for some reason the form's submit
  // event didn't fire — e.g. an older browser quirk.
  if (e.defaultPrevented) return;
  // Let the form's submit event take precedence; this is a no-op on the
  // happy path because submit fires first.
});
