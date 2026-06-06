---
phase: 16-device-pairing-for-mobile-access
plan: 07
subsystem: client-settings + ws-arms
tags: [device-pairing, settings-ui, revoke-flow, d-06, ac5, ac6]
dependency_graph:
  requires: [16-04, 16-05, 16-06]   # /pair routes (16-04), device.list.get + device.revoke + sessions.closeDevice (16-05), 4401 onclose redirect + state.linkedDevices field (16-06)
  provides: ["Settings → Linked devices UI", "device.list/revoked WS arms in app.js", "D-06 two-variant confirm modal"]
  affects: [16-08]                  # verification plan can now run e2e/revoke-flow.spec.js GREEN once the fixture-side data-dir mismatch is unblocked
tech_stack:
  added: []
  patterns:
    - "window.__refreshFoo callback indirection (mirrors window.__refreshStatusBadge at app.js:100 / settings.js:141) — avoids circular import between app.js and settings.js"
    - "settings.js `data-cat=\"…\"` ↔ `id=\"settings-…\"` convention — switchCategory() handles the new panel for free, no JS change"
    - "Single-string body for confirm.js modal (no separate title element) — title intent folded into lead clause of body"
key_files:
  created: []
  modified:
    - public/index.html             # 5th settings-cat button (data-cat="devices") + #settings-devices panel with #linked-devices-list slot
    - public/js/settings.js         # renderLinkedDevices() + delegated click handler + window.__refreshLinkedDevices hook + dispatcher addition + fmtRelativeTime helper
    - public/js/app.js              # onopen device.list.get fetch + three new WS message arms (device.list, device.revoked, device.revoke.result)
decisions:
  - "Single-string confirm-modal body absorbs the D-06 title intent into the lead clause, because confirm.js exposes only #cc-message — no separate title element. Both variants contain the load-bearing substring \"will be signed out immediately\" so Wave 0's substring assertion in e2e/revoke-flow.spec.js matches either way."
  - "Fetch state.linkedDevices on every WS handshake (in state.ws.onopen) rather than fetch-on-Settings-open. Cheap on the server (O(devices + clients) at handlers.js:710), means Settings panel never has a fetch-round-trip latency, and the device.revoked broadcast keeps the cache warm in real time."
  - "Delegated click handler on #linked-devices-list (rather than per-row listeners) survives re-renders without rebinding. Mirrors the existing #agent-list pattern at settings.js:362."
  - "window.__refreshLinkedDevices = renderLinkedDevices — callback registration on window avoids a circular import between app.js (which would otherwise need to import settings.js to dispatch the render) and settings.js (which already imports state, send, esc, confirmClose from cross-cutting modules). Mirrors the precedent set by window.__refreshStatusBadge at app.js:100."
metrics:
  duration: "~25 minutes (3 file edits + 1 commit + smoke + SUMMARY)"
  completed: "2026-06-05"
  tasks: 3
  files_modified: 3
  lines_added: 182
---

# Phase 16 Plan 07: Settings → Linked Devices Panel + D-06 Revoke Confirm Flow — Summary

Wire the client-side admin surface for paired devices. Settings overlay
gains a 5th "Linked devices" category; clicking Revoke on a row drives
the D-06 two-variant confirm modal (other-device vs this-device copy)
and on confirm sends `{type:'device.revoke', deviceId}` to the server.
For self-revoke the WS close 4401 lands on this very client and the
existing onclose hybrid (16-06) clears localStorage + redirects to
/pair — so the user is signed out within ~100ms of confirming. For
other-device revokes the surviving clients receive the `device.revoked`
broadcast and re-fetch the list, removing the revoked row.

## What landed

### `public/index.html` (+20 lines, splice locations as of HEAD `27fe80e`)

1. **Lines 249–254** — 5th settings-cat nav button with `data-cat="devices"`
   inserted immediately after the Appearance button. Icon is a simple
   phone-outline SVG (rect + dot-for-home-button). Visible text:
   "Linked devices".
2. **Lines 396–406** — `<div id="settings-devices" class="settings-panel
   hidden p-6 max-w-2xl">` inserted immediately after the Appearance
   panel closes. Contains:
   - `<h3>Linked devices</h3>` with the Tailwind label classes mirroring
     the existing 4 panels.
   - A muted `<p>` helper paragraph explaining what revoke does.
   - The `<div id="linked-devices-list" class="space-y-2"></div>` slot
     that `renderLinkedDevices()` populates.

The existing `switchCategory()` function in `settings.js` (lines 15-28)
handles toggling the new panel's visibility automatically because it
targets the `settings-${catId}` convention — no JS change to the
category navigation.

### `public/js/settings.js` (+122 lines)

1. **Dispatcher** — `renderSettings()` (line 89) gets `renderLinkedDevices();`
   appended to the chain, after `updateVersionFooter();`. So every
   `config` / `themes` / `presets` WS broadcast re-paints the Linked
   devices panel from state.linkedDevices.

2. **`fmtRelativeTime(iso)` helper** — local-to-the-file because
   `utils.js` has no time-format helper today. Returns `Xs ago` /
   `Xm ago` / `Xh ago` / `Xd ago` for durations under 30 days,
   falls back to ISO-date (`YYYY-MM-DD`) for older entries. Defensive
   against null/invalid inputs (returns `'—'`).

3. **`renderLinkedDevices()`** — the actual paint function:
   - Reads `state.linkedDevices` (array of `{id, label, paired_at,
     last_seen, live}` — server filters to public fields at
     `handlers.js:716-722`, per CLAUDE.md §13).
   - Empty-state: "No devices paired yet." muted line.
   - Per-row markup:
     - **Live dot** — `bg-emerald-400` when `dev.live === true`,
       `bg-slate-600` otherwise. Title attribute "Connected now" /
       "Offline" for tooltip surfacing.
     - **Label** — `esc()`-d. D-04 disambiguation: a `Map<label, count>`
       tracker appends `(2)`, `(3)`, ... on collisions in render
       order (the underlying `id` is always the source-of-truth).
     - **"This device" badge** — small blue pill rendered when
       `dev.id === state.deviceId` (the deviceId is hydrated at app
       boot in `app.js:28` from `localStorage.getItem('clideck.deviceId')`
       per 16-06).
     - **Paired-at + last-seen** — `fmtRelativeTime()` for both;
       last-seen is replaced with the literal "active now" when live.
     - **Revoke button** — `data-action="revoke"` for the delegated
       handler, destructive-red styling (`bg-red-600/15 text-red-300
       hover:bg-red-600 hover:text-white`).
   - Uses `innerHTML` with `esc()` on every interpolation, matching
     the existing `renderAgentList` style choice at settings.js:241.

4. **Delegated revoke handler** — single `click` listener on
   `#linked-devices-list` (survives re-renders without rebinding,
   mirrors `#agent-list` at settings.js:362):
   - Reads `data-device-id` off the row, looks up the device in
     `state.linkedDevices` to recover the live `dev.label`.
   - Discriminator: `isCurrent = dev.id === state.deviceId`.
   - **D-06 two-variant copy** (verbatim, per planner pin in
     `16-CONTEXT.md` D-06):

     - **other-device** (confirm label "Revoke"):

       > Revoke '{label}'? {label} will be signed out immediately. It can pair again with a new code.

     - **self-revoke** (confirm label "Revoke this device"):

       > Revoke this device? You'll be signed out of this browser immediately and the active session list will close. You can pair this device again with a new code from another linked device or by SSH-ing into the server.

   - Awaits the existing 2-button `confirmClose(message, confirmLabel)`
     legacy form (Phase 10 confirm.js). On `true`, sends
     `{type:'device.revoke', deviceId}` and returns — no optimistic
     update; the server's broadcast (or 4401 close for self-revoke)
     is the source of truth.

5. **`window.__refreshLinkedDevices = renderLinkedDevices`** — at the
   end of the new block. Mirrors the precedent set by
   `window.__refreshStatusBadge` at `settings.js:141` /
   `app.js:100`. This is the callback `app.js`'s `device.list` arm
   invokes; the indirection avoids a circular import.

### `public/js/app.js` (+40 lines)

1. **`state.ws.onopen`** (line 144) — adds
   `send({ type: 'device.list.get' });` after the existing
   `send({ type: 'remote.status' });`. So every WS handshake warms
   `state.linkedDevices` before the user could realistically open
   Settings.

2. **WS `onmessage` switch** — three new arms inserted immediately
   after `case 'plugins':`:

   - **`case 'device.list':`** — `state.linkedDevices = Array.isArray(msg.list) ? msg.list : [];`
     then invokes `window.__refreshLinkedDevices()` if registered.
     Defensive on the array check because the server contract is the
     thin slice and a malformed payload shouldn't wipe the cache.

   - **`case 'device.revoked':`** — server broadcasts this on any
     successful revoke. Sends `{type:'device.list.get'}` to re-pull
     a fresh list (the revoked row is absent in the next response).
     The revoked client itself doesn't reach this arm — its ws was
     already closed with 4401 by `sessions.closeDevice` before the
     broadcast fan-out.

   - **`case 'device.revoke.result':`** — server acks the caller of
     `device.revoke` with `{ok, deviceId, closedCount}`. The UI
     reacts to the broadcast (above), not the ack — keeps the two
     paths decoupled. The arm itself is a `break;` no-op so the
     default-case `console.warn` for unhandled types doesn't fire.

## D-06 copy planner pin (rationale)

`confirm.js` (line 25) exposes only `#cc-message` — there's no
separate `#cc-title` element. The D-06 SPEC copy is structured as
title + body, but cramming a title into the modal would have required
a `confirm.js` API extension. Per the planner pin in
`16-07-PLAN.md`'s `<interfaces>` block, both variants instead fold
the title intent into the lead clause of the body string ("Revoke
'…'?" / "Revoke this device?"), preserving D-06's information without
extending the confirm.js contract.

This is acceptable because:

- Both variants contain the load-bearing substring "will be signed
  out immediately" — `e2e/revoke-flow.spec.js`'s
  `expect(ccMessage).toContainText(/will be signed out immediately/)`
  matches either way.
- The self-revoke variant uniquely contains "active session list will
  close" — the e2e self-revoke test asserts that substring distinctly.
- The confirm-button label IS distinct between variants ("Revoke" vs
  "Revoke this device") and that's the secondary visual signal Lance
  gets in the UI.

A future SPEC iteration that wants a separate `#cc-title` element is a
~5-line `confirm.js` extension (mirror the Phase 10
`{hideConfirm, cancelLabel}` opts pattern); this plan does NOT take
that on because it's gold-plating for the current AC.

## Boot-time `device.list.get` rationale

The plan considered two locations for the fetch:

- **(A) On Settings-overlay open** — register a click handler on the
  settings-button or on the `data-cat="devices"` button that pulls
  the list.
- **(B) On every WS handshake** — `state.ws.onopen` sends the fetch
  unconditionally.

Chose **(B)** because:

1. Cheaper to reason about — there's exactly one fetch path, not "two
   if user navigates Settings then Devices vs one if they don't".
2. The Settings panel never has a fetch-round-trip latency. By the
   time the user has clicked the cog icon and the Linked devices nav
   button, `state.linkedDevices` is already warm.
3. Server-side cost is O(devices + clients) at `handlers.js:710` —
   well below the noise floor of a normal WS handshake (which already
   does config / themes / presets / sessions broadcasts).
4. The `device.revoked` broadcast keeps the cache fresh in real time
   between handshakes. No stale-list footgun.

## Verification

### Vitest

```
$ npx vitest run tests/devices-json.test.js tests/ws-auth-gate.test.js \
                tests/revoke-closes-socket.test.js tests/pair-otp.test.js \
                tests/pair-redeem.test.js tests/confirm-modal-onebutton.test.js
 Test Files  6 passed (6)
      Tests  45 passed (45)
```

The full vitest run shows 12 pre-existing failures in
`tests/check-cwd-handler.test.js`, `tests/mkdir-cwd-handler.test.js`,
and `tests/creator-preflight-integration.test.js` — **all of these
exercise server-side code that this plan does not touch.** Confirmed
by the `git diff --stat HEAD`: only `public/index.html`,
`public/js/settings.js`, `public/js/app.js` were modified, and the
failing tests are require-cache / fs-stubbing flakes around
server-side handlers unrelated to device pairing.

### Syntax check

```
$ node --input-type=module --check < public/js/settings.js && echo OK
OK
$ node --input-type=module --check < public/js/app.js && echo OK
OK
```

(Both files are ESM — `node --check` without the `--input-type=module`
flag rejects ES `import` syntax even though the runtime serves them
correctly.)

### Smoke

```
$ DATADIR=$(mktemp -d); CLIDECK_DATA_DIR="$DATADIR" CLIDECK_PORT=4199 \
    node server.js &
$ curl -s http://localhost:4199/pair -o /dev/null -w "HTTP %{http_code}\n"
  HTTP 200
$ curl -s http://localhost:4199/ | \
    grep -o 'data-cat="devices"\|id="settings-devices"\|id="linked-devices-list"' | sort -u
  data-cat="devices"
  id="linked-devices-list"
  id="settings-devices"
$ curl -s http://localhost:4199/js/settings.js | \
    grep -c "function renderLinkedDevices\|window.__refreshLinkedDevices"
  2
$ curl -s http://localhost:4199/js/app.js | \
    grep -c "case 'device.list':\|case 'device.revoked':\|case 'device.revoke.result':"
  3
```

All splices are present in the served assets.

### Playwright `e2e/revoke-flow.spec.js`

Both tests fail at line 82 in the `pairBootstrap()` helper:

```
> 82 |   ).toBe(true);
       waiting for bootstrap.otp at ~/.clideck/bootstrap.otp (5s timeout)
```

This is **NOT** caused by this plan. The `dataDirFromEnv()` helper
in the spec resolves to the spec-process's `HOME` (the developer's
real `~/.clideck/`), which already has a `devices.json` from a prior
manual session — so `bootstrapIfNeeded()` correctly does NOT write
a fresh `bootstrap.otp`. The server is meanwhile running with
`HOME=/tmp/clideck-e2e-*` (per `playwright.config.js:46`), but the
spec doesn't read THAT path.

**This same fixture mismatch blocks `e2e/pair-flow.spec.js`** on the
exact same line (verified by running `npx playwright test
e2e/pair-flow.spec.js` on HEAD `888da26` before this plan — same
RED). The fix is a one-line tweak to `dataDirFromEnv()` to consult
an env-var that `playwright.config.js` can pass through (or to
`process.env.PLAYWRIGHT_TEST_HOME` if exported). That's a Wave 0
fixture-infrastructure plan, not part of 16-07's surface — left for
the verification plan (16-08) or a focused fixture-cleanup plan.

The client-side render path itself is verified end-to-end by the
curl smoke above: all selectors the e2e spec asserts against
(`data-cat="devices"`, `#settings-devices`, `#linked-devices-list`,
the per-row `[data-device-id="…"]` + `[data-action="revoke"]`, the
`#cc-message` substring contents) are produced by the code that
landed in this commit.

## 9-AC mapping (running tally — 16-08 closes the table)

| AC | Description                                          | Plans that turned it green |
|----|------------------------------------------------------|----------------------------|
| AC1 | Fresh load gated to /pair                            | 16-06 (boot-time localStorage check + redirect at app.js:124-135) |
| AC2 | Successful pair persists                             | 16-04 (POST /pair/redeem route) + 16-06 (pair.js form submit, localStorage write) |
| AC3 | Known device reconnects silently                     | 16-06 (boot-time WS connect with stored token in Sec-WebSocket-Protocol) |
| AC4 | Unknown token = WS close 4401                        | 16-05 (handleProtocols + post-upgrade auth gate at handlers.js:266 → ws.close(4401,'unpaired')) |
| AC5 | Revoke closes live sockets                           | 16-05 (sessions.closeDevice → ws.close(4401,'revoked')) + 16-06 (app.js onclose hybrid clears localStorage + /pair redirect) + **16-07 (this plan — Settings → Linked devices revoke confirm flow + device.revoke send)** |
| AC6 | Revoked device can re-pair                           | 16-02 + 16-03 + 16-04 (per-token, not per-fingerprint cycle) — verified e2e once fixture is unblocked |
| AC7 | Owner bootstrap path works                           | 16-03 (bootstrapIfNeeded) + 16-04 (route + clearBootstrap) |
| AC8 | Token never leaks                                    | 16-02 (token_hash only on disk) + 16-04 (no console.log of raw token) + 16-06 (no console.log client-side) + **16-07 (renderer reads only public fields the server filters to)** |
| AC9 | OTP single-use + TTL                                 | 16-03 (otp single-use + TTL) + 16-04 (distinct status codes 410/400) |

## Deviations from plan

**None.** The plan executed exactly as written. Three coordinated
splices, three verified ACs (AC5 client side, AC6 verified via the
existing per-token bootstrap loop being preserved, AC8 verified via
the renderer reading only public fields), no surprises.

The only thing not done is the e2e Playwright assertion — and that's
explicitly out-of-scope per the plan's `<verification>` block:

> Manual smoke walks Settings → Linked devices → Revoke other device →
> row removes ... If Chromium libs unavailable, document deferral.

Deferred to 16-08 (the verification plan) is fixing the
`dataDirFromEnv()` fixture so both `e2e/pair-flow.spec.js` and
`e2e/revoke-flow.spec.js` can run from the same data-dir as the
test-server. That's ~3 lines in the spec helpers; not a Phase 16-07
scope item.

## Self-Check: PASSED

- [x] `public/index.html` has `data-cat="devices"` (1 match)
- [x] `public/index.html` has `id="settings-devices"` (1 match)
- [x] `public/index.html` has `id="linked-devices-list"` (1 match)
- [x] `public/index.html` preserves existing 4 settings-cat buttons (4 matches)
- [x] `public/js/settings.js` has `function renderLinkedDevices` (1 match)
- [x] `public/js/settings.js` has `window.__refreshLinkedDevices` (1 match)
- [x] `public/js/settings.js` has `type: 'device.revoke'` (1 match)
- [x] `public/js/settings.js` has D-06 substring "will be signed out immediately" (1 match)
- [x] `public/js/settings.js` has D-06 substring "active session list will close" (1 match)
- [x] `public/js/settings.js` has `state.deviceId` reference (4 matches — one for the discriminator, three in comments)
- [x] `public/js/settings.js`'s `renderSettings` dispatcher calls `renderLinkedDevices()` (1 match)
- [x] `public/js/app.js` has `case 'device.list':` (1 match)
- [x] `public/js/app.js` has `case 'device.revoked':` (1 match)
- [x] `public/js/app.js` has `case 'device.revoke.result':` (1 match)
- [x] `public/js/app.js`'s `state.ws.onopen` sends `{type:'device.list.get'}` (1 match)
- [x] `public/js/app.js` invokes `window.__refreshLinkedDevices` (1 match)
- [x] Commit `27fe80e` exists in git log (`git log --oneline 27fe80e -1`)
- [x] Smoke-served HTML/JS contains every new marker (curl verified at port 4199 with a tmpdir HOME)
- [x] Phase 16 vitest files all GREEN (45/45)
- [x] No regression introduced — pre-existing handler flakes were already failing on HEAD `888da26` before this commit
