// E2E server entrypoint (used as playwright.config.js webServer.command).
//
// Wipes the deterministic data dir for a clean run, THEN boots the real
// server — both in THIS one process. Doing the wipe here, immediately before
// requiring server.js, sidesteps every Playwright ordering hazard we hit:
//   - the config module is re-evaluated per worker (can't wipe there safely),
//   - and Playwright starts the webServer BEFORE globalSetup (so a globalSetup
//     wipe race-deletes the freshly-written bootstrap.otp).
// Here the wipe provably happens before server boot, in the server's own
// process, so the empty devices.json → bootstrap path runs into a clean dir
// and bootstrap.otp survives for the specs to read. (2026-06-09)

const { rmSync, mkdirSync } = require('fs');
const { e2eHome, e2eDataDir } = require('./paths');

try { rmSync(e2eHome(), { recursive: true, force: true }); } catch { /* first run */ }
mkdirSync(e2eDataDir(), { recursive: true });

require('../server.js');
