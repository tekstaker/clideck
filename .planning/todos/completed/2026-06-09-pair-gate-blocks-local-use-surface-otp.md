---
created: 2026-06-09
title: Pair gate blocks daily local browser use — surface OTP in the terminal
area: auth
files:
  - pair-otp.js:154-167   # bootstrapIfNeeded() — prints code to stdout + writes .clideck/bootstrap.otp
  - server.js:66-74       # boot wiring: bootstrapIfNeeded() called after devices.load()
  - auth-gate.js          # WS/HTTP gate that forces the pair screen
  - devices.js:48,168-179 # BOOTSTRAP_PATH (.clideck/bootstrap.otp), clearBootstrap()
  - package.json:version  # currently 1.31.17 — bump on every code change
---

## Problem

After Phase 16 (device pairing, merged to main as v1.31.17) landed, opening clideck in
the browser the way Lance uses it daily now **forces the pair screen** and demands an OTP
code. To get the code he has to go **read the server log** by hand — which breaks the
"just open the tab and use it" flow he's relied on.

Two distinct pain points:

1. **The code is hard to grab.** `bootstrapIfNeeded()` (`pair-otp.js:154`) *does* print a
   colored `[clideck] bootstrap pair code: XXX-XXXXX` line to stdout and write it to
   `.clideck/bootstrap.otp` — but only at boot, and only when `devices.json` is empty
   (it's a no-op once any device is paired, per `server.js:66`). So in practice Lance
   often can't see it: the line scrolls past, stdout is redirected to a logfile, or the
   gate fires after the no-op boot. He wants the code (or its file path) reliably visible
   in his terminal so he can copy-paste it into the browser and continue.

2. **Should localhost be gated at all?** The deeper UX regression is that the pairing gate
   now intercepts his normal *local* desktop use. Pairing is meant for remote/mobile
   access (Phase 15/16 milestones), not for the owner sitting at the machine. Worth
   deciding whether `127.0.0.1` / `localhost` should bypass the gate entirely (auto-trust
   loopback), or at minimum auto-pair the local browser on first hit.

## Solution

Literal ask (do at least this):
- Make the pairing/bootstrap code **reliably visible on the command line** so Lance can
  grab it from the terminal and paste it in. Options: always print the code (or the
  `.clideck/bootstrap.otp` path) at boot regardless of paired state when running
  interactively; add a startup banner line; and/or surface it via a CLI flag / log it
  louder than the current single console.log that can scroll away.

Recommended (decide during planning):
- Treat loopback (`127.0.0.1`/`::1`/`localhost`) as trusted in `auth-gate.js` so the owner
  at the desktop is never forced through the pair screen — pairing stays required only for
  non-loopback (mobile/remote) origins. This fixes the regression at the root rather than
  just making the code easier to copy.

Process reminder (from the capture): **bump `package.json` version (patch/subversion) on
every code-changing commit** — it surfaces in the connection lozenge so UAT can tell
new-vs-stale at a glance. See feedback memory `bump-version-on-code-changes`.

TDD: failing test first (e.g. loopback request bypasses gate / boot always emits a
copyable code line), then implement.
