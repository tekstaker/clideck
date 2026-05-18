#!/usr/bin/env node
// Restart wrapper — the neutral observer that owns the handoff between an
// old clideck instance and its replacement.
//
// Why this exists
// ---------------
// The old clideck used to spawn its own replacement directly and then
// shut down. That fails in three nasty ways:
//   1. The dying parent's onShutdown can hang (stubborn PTYs, plugin
//      cleanup), leaving the port occupied and the child crashing on
//      EADDRINUSE.
//   2. The detached child inherits state from the parent on Windows
//      (console handle, job object membership) that can ride it down
//      when the parent eventually dies.
//   3. There's no neutral place to observe and report on the handoff —
//      if it fails silently, you get a stranded process and no clue
//      what happened.
//
// This wrapper sits in between. It's launched by the old clideck as a
// fully detached child, then:
//   1. Polls for the old parent PID to disappear (it's already calling
//      process.exit but might be hung; the parent's watchdog will force
//      exit at 3s).
//   2. Polls for the listen port to be free.
//   3. Spawns the new clideck (also detached), so the new clideck is
//      NOT a grandchild of the old one — its parent is *this* wrapper,
//      and we exit cleanly once it's verified up.
//   4. Polls for the new clideck to be listening on the port.
//   5. Exits 0 on success, non-zero on any failure stage, with timing
//      and reason logged to ~/.clideck/restart.log via inherited stdio.
//
// Invocation
// ----------
// Spawned by server.js requestRestart() with these env vars:
//   CLIDECK_RESTART_PARENT_PID  — the PID we wait for to disappear
//   CLIDECK_RESTART_PORT        — the port we wait to be free then bound
//   CLIDECK_RESTART_ARGV        — JSON-encoded argv array used to spawn
//                                 the replacement clideck
//
// stdio is inherited from the parent: stdout/stderr both go to a file
// descriptor opened on ~/.clideck/restart.log so anything the wrapper
// or its spawned clideck print survives the parent's exit.

const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');

// ── Config from env ───────────────────────────────────────────────────────
const PARENT_PID = Number(process.env.CLIDECK_RESTART_PARENT_PID);
const PORT = Number(process.env.CLIDECK_RESTART_PORT);
const ARGV_JSON = process.env.CLIDECK_RESTART_ARGV;
if (!PARENT_PID || !PORT || !ARGV_JSON) {
  log('missing required env: CLIDECK_RESTART_PARENT_PID, CLIDECK_RESTART_PORT, CLIDECK_RESTART_ARGV');
  process.exit(2);
}
let ARGV;
try { ARGV = JSON.parse(ARGV_JSON); }
catch (e) { log('CLIDECK_RESTART_ARGV is not valid JSON: ' + e.message); process.exit(2); }

const PARENT_EXIT_TIMEOUT_MS = 10000;
const PORT_FREE_TIMEOUT_MS = 8000;
const PORT_BOUND_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 100;

// ── Logging helper ────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] [wrapper:${process.pid}] ${msg}\n`);
}

// ── Predicates ────────────────────────────────────────────────────────────
function parentAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== 'ESRCH'; } // EPERM means it's alive but we can't touch it
}

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function isPortBound(port) {
  return new Promise(resolve => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.once('error', () => { try { sock.destroy(); } catch { /* noop */ } resolve(false); });
    sock.once('connect', () => { try { sock.destroy(); } catch { /* noop */ } resolve(true); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let i = 0;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    i++;
    if (i % 20 === 0) log(`still waiting on ${label} (${Math.round((Date.now() - (deadline - timeoutMs)) / 100) / 10}s elapsed)`);
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  log(`starting — parent PID=${PARENT_PID}, port=${PORT}, argv=${JSON.stringify(ARGV)}`);

  // Stage 1: wait for parent to disappear.
  const parentGone = await pollUntil(() => !parentAlive(PARENT_PID), PARENT_EXIT_TIMEOUT_MS, `parent PID ${PARENT_PID} exit`);
  if (parentGone) {
    log(`parent PID ${PARENT_PID} exited after ${Date.now() - startedAt}ms`);
  } else {
    log(`parent PID ${PARENT_PID} still alive after ${PARENT_EXIT_TIMEOUT_MS}ms — proceeding anyway, new clideck will retry-listen`);
  }

  // Stage 2: wait for the port to be free.
  const portFreeStart = Date.now();
  const portFree = await pollUntil(() => isPortFree(PORT), PORT_FREE_TIMEOUT_MS, `port ${PORT} to be free`);
  if (portFree) {
    log(`port ${PORT} freed after ${Date.now() - portFreeStart}ms`);
  } else {
    log(`port ${PORT} still occupied after ${PORT_FREE_TIMEOUT_MS}ms — spawning anyway, new clideck has its own retry-listen`);
  }

  // Stage 3: spawn the new clideck — fully detached from us, so we can
  // exit cleanly once it's verified up.
  log(`spawning new clideck via ${ARGV[0]}`);
  const childEnv = { ...process.env };
  delete childEnv.CLIDECK_RESTART_PARENT_PID;
  delete childEnv.CLIDECK_RESTART_PORT;
  delete childEnv.CLIDECK_RESTART_ARGV;
  let child;
  try {
    child = spawn(ARGV[0], ARGV.slice(1), {
      detached: true,
      stdio: ['ignore', process.stdout.fd, process.stderr.fd],
      env: childEnv,
      windowsHide: true,
    });
  } catch (e) {
    log(`spawn failed: ${e.message}`);
    process.exit(1);
  }
  log(`spawned new clideck PID=${child.pid}`);
  child.unref();

  // Stage 4: wait until the new clideck is actually listening.
  const bindStart = Date.now();
  const bound = await pollUntil(() => isPortBound(PORT), PORT_BOUND_TIMEOUT_MS, `new clideck to bind ${PORT}`);
  if (bound) {
    log(`new clideck bound port ${PORT} after ${Date.now() - bindStart}ms — handoff complete after ${Date.now() - startedAt}ms total`);
    process.exit(0);
  } else {
    log(`new clideck failed to bind port ${PORT} within ${PORT_BOUND_TIMEOUT_MS}ms — handoff failed`);
    process.exit(1);
  }
}

main().catch(e => {
  log(`fatal: ${e.stack || e.message || e}`);
  process.exit(2);
});
