'use strict';

// Graceful shutdown orchestration: an observable, hard-timed sequence layered
// on top of the existing three-step shutdown (plugins → activity → sessions).
//
// Each step is isolated in its own try/catch so one stuck/throwing step (e.g. a
// node-pty.kill() that won't return) can't prevent process.exit() from running
// and releasing port 4000 — which is what stranded PID 12980 on 2026-05-18.
// That isolated-try shape is LOAD-BEARING and must be preserved: the `step()`
// helper below swallows per-step errors and never rethrows.
//
// Extracted out of server.js (which binds a port on require and has no
// module.exports) so the full sequence is unit-testable WITHOUT booting a real
// server: every dependency is injected. server.js wires the real modules in and
// registers the returned onShutdown on SIGINT/SIGTERM, passing the signal name.
//
// Sequence (D-08):
//   1. banner naming the signal (≤50ms, first statement, no await before it)
//   2. arm the watchdog (force-exit at timeoutMs)
//   3. arm the heartbeat (tick every heartbeatMs naming the current step)
//   4. await step('flushing plugins')
//   5. await step('stopping activity')
//   6. await step('persisting sessions')
//   7. clearInterval(heartbeat) then clearTimeout(watchdog)
//   8. log goodbye
//   9. exit(0)

function createShutdown(deps = {}) {
  const {
    plugins,
    activity,
    sessions,
    getConfig,
    log = console.log,
    write = process.stdout.write.bind(process.stdout),
    exit = process.exit,
    timeoutMs = 10000,
    heartbeatMs = 3000,
  } = deps;

  // Tracked across step() calls so the heartbeat formatter can name the active
  // step cheaply (D-04). `stepInProgress` guards the dangling label span (the
  // window between writing '<label>… ' with no newline and writing the
  // 'done (Xms)'/'failed' completion) so a heartbeat firing mid-step can break
  // cleanly onto its own line instead of garbling the label (D-07).
  let currentStep = 'starting';
  let stepInProgress = false;

  // step(label, fn): write '[clideck] <label>… ' (no newline), await fn (sync or
  // Promise), then 'done (Xms)' or 'failed: <msg>' on the same line. Swallows a
  // thrown fn — one step failing must NEVER abort later steps or the exit. This
  // is the isolated-try shape (preserved from the 2026-05-18 incident).
  async function step(label, fn) {
    currentStep = label;
    const t0 = Date.now();
    stepInProgress = true;
    write(`[clideck] ${label}… `);
    try {
      await fn();
      write(`done (${Date.now() - t0}ms)\n`);
    } catch (e) {
      write(`failed: ${e && e.message ? e.message : String(e)}\n`);
      // SWALLOW: do not rethrow. Later steps and exit(0) must still run.
    } finally {
      stepInProgress = false;
    }
  }

  async function onShutdown(signal) {
    // 1. Ack banner — FIRST statement, nothing async precedes it (AC 1, ≤50ms).
    //    Leading \n separates the banner from the shell's `^C` glyph (load-bearing).
    if (signal === 'SIGTERM') {
      write('\n[clideck] SIGTERM received — shutting down…\n');
    } else {
      write('\n[clideck] Ctrl+C received — shutting down…\n');
    }

    const start = Date.now();

    // 2. Arm the watchdog: force-exit if shutdown drags past the cap (AC 5).
    const wd = setTimeout(() => {
      log('[clideck] shutdown took too long — forcing exit');
      exit(0);
    }, timeoutMs);

    // 3. Arm the heartbeat: tick while shutdown is in flight (AC 4). If a step's
    //    dangling label is on screen, prefix with \n so we break off it cleanly.
    const hb = setInterval(() => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const line = `[clideck] still shutting down… (current step: ${currentStep}, elapsed: ${elapsed}s)`;
      log(stepInProgress ? `\n${line}` : line);
    }, heartbeatMs);

    // 4-6. The three isolated steps. step() swallows throws (isolated-try).
    await step('flushing plugins', () => plugins.shutdown());
    await step('stopping activity', () => activity.stop());
    await step('persisting sessions', () => sessions.shutdown(getConfig()));

    // 7. Happy path: clear both timers so no stray heartbeat prints after goodbye
    //    and the watchdog can't fire post-exit (D-06, D-05 happy-path clear).
    clearInterval(hb);
    clearTimeout(wd);

    // 8-9. Unambiguous success signal, then exit.
    log('[clideck] goodbye.');
    exit(0);
  }

  return { onShutdown, step };
}

module.exports = { createShutdown };
