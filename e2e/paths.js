// Deterministic, shared E2E data dir.
//
// Required by playwright.config.js, e2e/global-setup.js, and the pair/revoke
// specs so EVERY process (Playwright main + each worker + the spawned server)
// resolves the SAME directory. It must NOT use mkdtempSync: Playwright
// evaluates the config (and these requires) separately per process, so a
// random path would differ between the server's process and a worker's — the
// exact mismatch that left bootstrap.otp unreadable ("e2e fixture-bug
// deferred" from Phase 16). A fixed path under os.tmpdir() is identical
// everywhere; global-setup.js wipes it once per run for isolation.

const { tmpdir } = require('os');
const { join } = require('path');

function e2eHome() {
  return join(tmpdir(), 'clideck-e2e-home');
}

function e2eDataDir() {
  return join(e2eHome(), '.clideck');
}

module.exports = { e2eHome, e2eDataDir };
