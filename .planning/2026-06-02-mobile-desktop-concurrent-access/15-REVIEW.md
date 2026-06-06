---
phase: 15-mobile-desktop-concurrent-access
reviewed: 2026-06-02
reviewer: claude (gsd-code-reviewer, adversarial pass)
depth: deep
status: findings
files_reviewed: 13
files_reviewed_list:
  - handlers.js
  - sessions.js
  - public/index.html
  - public/js/app.js
  - public/js/state.js
  - public/js/terminals.js
  - public/js/settings.js
  - tests/sessions-resize.test.js
  - tests/other-client-indicator.test.js
  - e2e/clideck-remote-deletion.spec.js
  - e2e/concurrent-input.spec.js
  - e2e/mobile-touch.spec.js
  - e2e/mobile-viewport.spec.js
  - e2e/pty-size-locked.spec.js
  - e2e/session-indicator-mutex.spec.js
findings:
  blocker: 1
  warning: 4
  info: 3
  total: 8
contracts:
  R2_resize_noop: PASS
  R5_clients_count_broadcast: PASS
  R5_indicator_markup_verbatim: PASS
  R1_state_no_remoteVersion: PASS
  R5_state_otherClientsConnected: PASS
  R1_html_no_btn_remote: PASS
  R6_term_wrap_overflow_x: PASS
  R5_app_dispatch_clients_count: PASS
  R1_app_no_remote_cases: PASS
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-02
**Depth:** deep
**Files reviewed:** 13 source + 6 spec files
**Status:** issues_found

## TL;DR

Phase 12 ships the locked contracts cleanly — every grep-able deletion sweep is at zero matches, the indicator markup matches UI-SPEC verbatim, and the resize no-op is correctly implemented. **One BLOCKER**: `sessions.resume()` no longer forwards client cols/rows to `spawnSession`, so resumed sessions silently spawn at the 80×24 fallback PTY size and are now permanently stuck there under R2's lock (server-side resize is now a no-op, so the client can no longer correct it). Four lower-severity findings around dead client-side resize sends, a not-quite-symmetric `createProgrammatic` path, and one timing risk in `mobile-touch.spec.js`.

## Contract compliance — Phase 12 locked items

| Contract                                                    | Status | Evidence |
|-------------------------------------------------------------|--------|----------|
| R2 — `sessions.resize` is a no-op                           | **PASS** | `sessions.js:368-374` — body is the documented no-op only. Unit test `tests/sessions-resize.test.js` GREEN. |
| R5 — `handlers.js` broadcasts `clients.count` on connect    | **PASS** | `handlers.js:216` — `sessions.broadcast({type:'clients.count', count: sessions.clients.size})` immediately after `clients.add(ws)`. |
| R5 — `handlers.js` broadcasts `clients.count` on disconnect | **PASS** | `handlers.js:572-575` — broadcast after `clients.delete(ws)`, so count excludes the leaver. |
| R5 — `terminals.js` indicator markup VERBATIM per UI-SPEC   | **PASS** | `terminals.js:516` (session-row) and `:1351` (resumable-row) — `title="Another client is connected"`, `aria-label` matches, SVG `viewBox="0 0 16 16" stroke-width="1.5"`, circles at `cx="6"/cx="10" cy="8" r="3.5"`, `text-amber-400` class, G9 mitigation ternary `${state.otherClientsConnected ? '' : ' hidden'}` on construction. |
| Plan 04 — `state.js` does NOT contain `remoteVersion`       | **PASS** | `grep remoteVersion public/js/*.js` returns zero matches. |
| Plan 05 — `state.js` DOES contain `otherClientsConnected`   | **PASS** | `state.js:23` — `otherClientsConnected: false` with full RESEARCH §10 G9 documentation block. |
| Plan 04 — `index.html` does NOT contain `btn-remote`, `remote-modal`, `version-remote` | **PASS** | All three IDs gone; settings panel `#version-footer` shows only `version-clideck`. |
| Plan 05 — `index.html` contains `.term-wrap { overflow-x: auto }` inside `@media (max-width: 960px)` | **PASS** | `index.html:138-141` inside the existing 960px block (no new ≤480 tier — matches D-16). |
| Plan 05 — `app.js` dispatches `case 'clients.count'`        | **PASS** | `app.js:206-214` — calls `updateOtherClientIndicator(msg.count)`. |
| Plan 04 — `app.js` does NOT dispatch `case 'remote.*'`      | **PASS** | `grep "case 'remote\|case \"remote"` returns zero matches. |

**Repo-wide grep gate (D-03)** — `git grep -nE "remote-modal|clideck-remote|btn-remote|version-remote|remoteVersion|remoteUpdateCache|remoteCliEnv|remotePreflight|remoteStatusPoll|remoteState|remoteInstalled|remoteModalOpen|remoteLastStatus|btnRemote|remoteModal" -- ':!CHANGELOG.md' ':!.planning/' ':!e2e/clideck-remote-deletion.spec.js'` returns **zero matches**. The deletion sweep is complete.

**Vitest** — full 16-file / 143-test suite GREEN (re-run during this review, 1.03s).

## BLOCKER

### B-01 — `sessions.resume()` drops creator cols/rows; resumed sessions are now permanently stuck at 80×24

**File:** `sessions.js:307`
**Severity:** BLOCKER

**Issue:**
Phase 12 R2 says "the PTY's cols/rows is set once by the creator's viewport in `spawnSession(..., msg.cols, msg.rows)`" — and the `create` path correctly threads `msg.cols, msg.rows` through at line 220:
```js
const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId, msg.cols, msg.rows);
```

But the `resume(msg, ws, cfg)` handler at line 307 calls `spawnSession` WITHOUT the trailing `cols, rows` arguments:
```js
const err = spawnSession(id, cmd, parts, cwd, saved.name, saved.themeId || saved.profileId || 'default', saved.commandId, saved.sessionToken, saved.projectId);
```

`spawnSession` at line 85 falls back to `cols: cols || 80, rows: rows || 24` (`sessions.js:91`). So every resumed session spawns its PTY at 80×24 regardless of the resuming client's viewport.

**Why this is a blocker under Phase 12, not a pre-existing bug:**
Before Phase 12, the client's first fit() (`terminals.js:733`) would send a `resize` WS message, the server would honour it, and the PTY would catch up to the client viewport within ~50ms of mount. **Phase 12 makes `sessions.resize` a no-op (R2 / Plan 12-02).** So the PTY is now stuck at 80×24 for the lifetime of the resumed session — there is no longer a server-side path that can correct it.

The client `terminals.js:723-727` will still fire `send({type:'resize',...})` after fit, but those messages now hit the documented no-op in `sessions.js:368`. From the user's perspective: every resumed session in Phase 12 looks weirdly truncated at the top of a wider viewport, and there is no UI gesture to fix it (Refresh session → goes through `restart()` which DOES forward `msg.cols/msg.rows` at `sessions.js:502`, so refresh is a workaround — but a non-obvious one).

This violates SPEC AC #4 / R2 implicit-corollary: "two clients can attach to the same session simultaneously; both observe identical output stream". With a resumed session locked at 80×24, both clients see a tiny terminal regardless of viewport.

**Fix:**
The `resume` handler at `sessions.js:280-332` should accept and forward `msg.cols, msg.rows` exactly the way `create` does. The natural place is line 307. Diff:

```diff
-  const err = spawnSession(id, cmd, parts, cwd, saved.name, saved.themeId || saved.profileId || 'default', saved.commandId, saved.sessionToken, saved.projectId);
+  const err = spawnSession(id, cmd, parts, cwd, saved.name, saved.themeId || saved.profileId || 'default', saved.commandId, saved.sessionToken, saved.projectId, msg.cols, msg.rows);
```

Then update the client at `app.js` resume dispatch (the spot that sends `{type:'session.resume', id}`) to include `...estimateSize()`, mirroring the create path at `app.js:1197`. The resumable-row click handler at `app.js:534` is the dispatch site:

```diff
-    send({ type: 'session.resume', id: resumableRow.dataset.resumableId });
+    send({ type: 'session.resume', id: resumableRow.dataset.resumableId, ...estimateSize() });
```

(Note: `estimateSize` is already imported at `app.js:3`.)

The resume-dormant batch helper at `app.js:705-709` also needs the same treatment — currently `send({ type: 'session.resume', id })` with no size.

Add a unit test pinning this: spawnSession of a fake-resumable, then assert the PTY's cols/rows received the msg.cols/rows arguments. Or extend `tests/sessions-resize.test.js` with a `resume('...', { id, cols: 120, rows: 30 }, ws, cfg)` arm.

---

## WARNINGS

### W-01 — `sessions.createProgrammatic` also drops cols/rows; same locked-at-create regression

**File:** `sessions.js:266`
**Severity:** WARNING

**Issue:**
Symmetry follow-up to B-01. `createProgrammatic(opts, cfg)` at `sessions.js:253-276` is the plugin / internal-use spawn path. Line 266:
```js
const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId);
```

No `cols, rows`. The `opts` param has no documented `cols/rows` field either. So any plugin that spawns a session through this API gets a permanent 80×24 PTY under R2's lock.

This is a WARNING (not BLOCKER) because (a) no in-repo plugin uses this path today (`opencode-bridge.js` and `plugin-loader.js` searched — neither calls `createProgrammatic`) and (b) the API has no public surface advertising cols/rows. But if any future or third-party plugin exercises this path expecting "PTY catches up to viewport", they get a stuck terminal under Phase 12.

**Fix:**
Extend the signature and forward — small surgery:

```diff
-  const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId);
+  const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId, opts.cols, opts.rows);
```

Default-document `opts.cols`/`opts.rows` as "creator viewport at create-time; falls back to 80×24". Same one-line change makes the API symmetric with `create()`.

Same fix applies to `sessions.js:181` (failed-resume auto-recovery spawn) which also drops cols/rows — that path spawns a fresh session in the same cwd after a failed resume, currently at 80×24. Pass the old session's last known size or have the client provide one when triggering the auto-recovery toast's resume button.

---

### W-02 — Client still sends `{type:'resize', id, cols, rows}` constantly; bandwidth + handler churn for nothing

**File:** `public/js/terminals.js:726, :733, :752, :376, :1111`
**Severity:** WARNING

**Issue:**
Five client-side sites still fire `send({ type: 'resize', id, cols, rows })`:
1. `terminals.js:726` — `doFit()` ResizeObserver callback
2. `terminals.js:733` — initial fit on first measurable ResizeObserver tick
3. `terminals.js:752` — 500ms fallback for hidden terminals
4. `terminals.js:376` — context-menu "Refresh session" (legitimately threads `cols`/`rows` to `session.restart`, NOT `resize` — wrong match; ignore this one)
5. `terminals.js:1111` — restart banner re-fit (also `session.restart`, not `resize` — ignore)

Sites (1)–(3) send a `resize` frame on every observable viewport change. The server-side handler at `sessions.js:368-374` is now a documented no-op, but it still:
- Costs network round-trip per fit (one per ResizeObserver fire, debounced to one rAF — small but non-zero on phones with many sessions and rotating viewports).
- Generates `JSON.parse` work in `handlers.js:248-249` for every frame.
- Pollutes any WS-traffic logs / debugging dumps with noise.

The R2 SPEC explicitly chose to keep the message type accepted ("The `resize` WebSocket message type must remain accepted") — so removing the client sends entirely is **not** required by the contract. But three sends per ResizeObserver tick on the active terminal, for every connected client, all of which result in zero state change, is wasted work.

**Fix:**
Two reasonable options, planner's call:

1. **Minimal (keep sends, document)** — leave `terminals.js:726, :733, :752` alone but add a one-line comment above each: `// Phase 12 R2: server treats this as a no-op; kept for older fork checkouts.` This is the SPEC's stated intent (D-05).
2. **Surgical (drop the sends, keep the type)** — comment out the three client sends. The server handler stays accepted (older clients on other forks may still hit it). This saves the wasted traffic and makes the deletion sweep more honest. The `fit.fit()` call itself is still needed for the local xterm renderer to recompute its grid (PTY size is locked, but the visual letterbox / horizontal-scroll viewport is a client concern).

Recommend (2). Pre-commit add an inline `// no-op server-side per Phase 12 R2 — left here as a wire-format reminder for older forks` comment if you want a paper trail.

---

### W-03 — `mobile-touch.spec.js` taps `.term-wrap` before `.xterm-helper-textarea` is guaranteed to exist; flake risk

**File:** `e2e/mobile-touch.spec.js:110-120`
**Severity:** WARNING

**Issue:**
The test sequence is:
```js
await page.locator(`.group[data-id="${id}"]`).tap();
await page.locator('.term-wrap').first().tap();
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return !!(el && el.classList && el.classList.contains('xterm-helper-textarea'));
});
```

`.term-wrap` is created at `terminals.js:538-541` *synchronously* when `addTerminal` fires, but xterm's internal `.xterm-helper-textarea` is added by `term.open(el)` at `terminals.js:631`. The first ResizeObserver callback then has to fire before `fitted = true` (`:730-737`) — typically <50ms but not guaranteed.

If `.xterm-helper-textarea` hasn't mounted by the time `.evaluate(() => document.activeElement)` runs, the assertion sees `<body>` (the default activeElement) and the test fails. Playwright's `.tap()` does NOT auto-wait for descendants of the tapped element.

I haven't observed this flake during this review (server didn't run), but the pattern is the classic "test the eventually-consistent thing immediately after triggering it." On a busy CI machine the failure is likely intermittent.

**Fix:**
Insert a `waitForSelector` between the tap and the activeElement check:

```diff
   await page.locator(`.group[data-id="${id}"]`).tap();
   await page.locator('.term-wrap').first().tap();
+  await page.waitForSelector('.xterm-helper-textarea', { state: 'attached', timeout: 5000 });
   const focused = await page.evaluate(() => { ... });
```

Or use `expect.poll` on the activeElement check to give it the same 5s ceiling other tests use.

---

### W-04 — Heartbeat handler shadows top-level config-saved listeners with its own `ws.on('close')`

**File:** `handlers.js:235`
**Severity:** WARNING

**Issue:**
At `handlers.js:235` the heartbeat block adds:
```js
ws.on('close', () => clearInterval(heartbeat));
```

…and then at `handlers.js:572-575` the connection setup adds a second close listener that handles `sessions.clients.delete(ws)` + `clients.count` broadcast. Node's EventEmitter allows multiple listeners and both fire, so this isn't a correctness bug.

But the ordering matters: there's no guarantee the heartbeat-clear close listener fires *before* the broadcast — and if the heartbeat callback somehow throws (it doesn't today; `clearInterval` is safe), the broadcast might not run. This is mostly a future-proofing nit.

The other minor concern: if a client connects and the OS-level TCP teardown is gnarly (laptop sleep → wake → wifi roam), the heartbeat handler at `handlers.js:228` calls `ws.terminate()` which fires `close` synchronously inside the interval tick. That re-entrant pattern is correct but worth a code comment for the next reader.

**Fix:**
Optionally consolidate into a single close handler at the bottom of `onConnection`:

```js
ws.on('close', () => {
  clearInterval(heartbeat);
  sessions.clients.delete(ws);
  sessions.broadcast({ type: 'clients.count', count: sessions.clients.size });
});
```

…and delete the inner `ws.on('close', () => clearInterval(heartbeat))`. Same effective behaviour, single declaration site, removes the implicit ordering question.

---

## INFO

### I-01 — `sessions-resize.test.js` passes trivially because the implementation is `function resize(_msg) {}`; consider one positive-control test

**File:** `tests/sessions-resize.test.js:77-89`
**Severity:** INFO

The test correctly pins "no pty.resize call regardless of input" — that's the contract. But because the implementation body is empty, the test would pass even if the body were `if (msg.id === 'sess-A') { /* no-op */ } else { /* no-op */ }`. The spy never fires because the function never references pty.

Suggest one positive-control assertion to anchor the test — e.g., wire a `sessions.input(msg)` call in the same test that DOES call `pty.write` on the fake session, proving the test harness CAN catch a real `pty.method()` call when the implementation makes one. Otherwise a future regression where `resize` is silently re-wired to write to a different pty method (e.g. `pty.write` to send escape sequences) would slip past.

Not critical — the contract is correctly pinned for the documented surface. Just defense-in-depth.

### I-02 — Inline 119-char SVG markup in two row templates duplicates the indicator HTML

**File:** `public/js/terminals.js:516` and `:1351`
**Severity:** INFO

The exact same 460-character `<span class="other-client-indicator…">…</span>` block is inlined in both row templates. UI-SPEC §"DOM contract" treats this as a locked verbatim copy, so the duplication is intentional. But if a future tweak to the indicator (e.g. swap glyph for high-contrast light mode, per UI-SPEC contingency at §"Cross-mode verification") needs to land, both copies must change in lockstep — typical drift hazard.

Suggest a tiny `OTHER_CLIENT_INDICATOR_HTML` const at the top of `terminals.js`, mirroring the existing `TERMINAL_SVG`, `RESUME_SVG`, `MUTE_SVG` precedent at `:39, :1334, :1054`. Same indirection idiom already in use elsewhere in the file.

### I-03 — `e2e/clideck-remote-deletion.spec.js` exempts itself from its own grep gate; a brittle self-reference

**File:** `e2e/clideck-remote-deletion.spec.js:131`
**Severity:** INFO

The grep gate at line 130-133 exempts `:!e2e/clideck-remote-deletion.spec.js` because the spec file itself contains the pattern strings (`'remote-modal'`, `'clideck-remote'`, etc.). The exemption is correct, but if someone renames the spec file (e.g. moves it under `e2e/phase-12/`), the gate silently starts matching its own contents and the test starts failing. There's no test guarding this self-reference.

Suggest either (a) hoisting the pattern into a `const PATTERN` near the test top so a rename only needs to update one path, or (b) computing `__filename`-relative exemption at test runtime via `path.relative(repoRoot, __filename)`. (b) is mildly safer but adds complexity; (a) is the simpler defense.

---

## Honest gaps — what this review did NOT cover

1. **Playwright specs were not executed.** I read all six but did not stand up the dev server and run them. The vitest suite (16 files / 143 tests) WAS re-run during this review, confirming the unit-level contracts pass. The Phase 12 VERIFICATION.md (commit `ffd00da`) notes Playwright was deferred to D-14/D-18/D-19, so this matches the project's own intent — but it means R3 (touch focus), R4 (concurrent input over real WS), R5 indicator timing under real broadcast, and R6 mobile viewport overflow are pinned by spec quality, not by green CI.
2. **Real two-client manual test.** I did not stand up the server, open two browser contexts, and verify the indicator lights up + concurrent input works end-to-end. SPEC AC #5/#4 are unverified beyond static reasoning.
3. **Mobile DevTools 375×667 walkthrough.** SPEC AC #6 walkthrough `[load → switch → tap → sidebar → close → re-assert no overflow]` was not exercised in DevTools — only the e2e spec was code-reviewed.
4. **PTY pixel-grid verification at large viewports.** B-01's resume regression was found by code path analysis; I did not actually resume a session at a 200×60 viewport and observe the 80×24 truncation visually. The reasoning is direct from the code, but a manual repro before merging would harden the fix.
5. **Performance / hot-path scan.** v1 review scope explicitly excludes performance findings (per `<review_scope>`). W-02 is bandwidth-flavoured but is reported under the WARNING tier as quality/correctness — the wasted server-side JSON.parse per ResizeObserver tick is the substantive concern, not raw throughput.
6. **Codex / Claude / Gemini telemetry hooks.** Out of Phase 12 scope; not reviewed.
7. **Tailwind build pipeline.** `public/tailwind.css` shows zero diff under `git diff 687a028..HEAD --stat` — confirmed clean per phase brief. Not separately re-scanned.

---

## Suggested fix dispatch order

1. **B-01** (`sessions.resume` cols/rows) — must land before merge. Plus the client-side `app.js:534` resumable-row click and `app.js:705-709` batch resume. Unit test addition recommended.
2. **W-01** (`createProgrammatic` + failed-resume auto-recovery cols/rows) — same file, same shape, batch in the same commit as B-01.
3. **W-03** (mobile-touch flake risk) — small one-line `waitForSelector`. Bundle with the next phase-12 spec edit.
4. **W-02** (decide retain-vs-delete client-side resize sends) — one-line decision; either land now or punt to a hygiene phase.
5. **W-04** (heartbeat close-handler consolidation) — pure refactor, not load-bearing. Land when convenient.
6. **I-01 / I-02 / I-03** — quality nits, ship when convenient.

---

_Reviewed: 2026-06-02_
_Reviewer: Claude (gsd-code-reviewer, FORCE adversarial stance)_
_Depth: deep (cross-file trace: spawnSession call graph, ws message dispatch, indicator markup deduplication)_
_Project context: clideck fork, GSD Phase 12 (mobile-desktop-concurrent-access)_
