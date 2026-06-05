// @vitest-environment node
//
// Phase 13 shutdown-feedback — createShutdown factory unit tests.
//
// These exercise the observable, hard-timed shutdown sequence (shutdown.js)
// with FULLY INJECTED FAKE deps — no server is booted, no port is bound, no
// real config/data dir is touched. The factory exists precisely so the D-08
// sequence is testable in isolation.
//
// The load-bearing case is Test A: the isolated-try regression. A throwing
// step must NOT prevent later steps or the final exit(0) — this preserves the
// 2026-05-18 stranded-PID-12980 protection (SPEC AC 3).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createShutdown } from '../shutdown.js';

// Build a fake dep set with output captured into an array so we can assert on
// the written/logged lines. Overrides let each test tweak one collaborator.
function makeDeps(overrides = {}) {
  const out = [];
  const sink = (s) => { out.push(String(s)); };
  const deps = {
    plugins: { shutdown: vi.fn() },
    activity: { stop: vi.fn() },
    sessions: { shutdown: vi.fn(async () => {}) },
    getConfig: vi.fn(() => ({})),
    log: vi.fn(sink),
    write: vi.fn(sink),
    exit: vi.fn(),
    timeoutMs: 10000,
    heartbeatMs: 3000,
    ...overrides,
  };
  return { deps, out };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createShutdown — isolated-try regression (AC 3)', () => {
  it('runs later steps and reaches exit(0) even when an earlier step throws', async () => {
    const { deps, out } = makeDeps({
      plugins: { shutdown: vi.fn(() => { throw new Error('boom'); }) },
    });
    const { onShutdown } = createShutdown(deps);

    await onShutdown('SIGINT');

    // The throwing first step did NOT abort the sequence:
    expect(deps.activity.stop).toHaveBeenCalledTimes(1);
    expect(deps.sessions.shutdown).toHaveBeenCalledTimes(1);
    // ...and exit(0) was still reached.
    expect(deps.exit).toHaveBeenCalledWith(0);
    // The failure was surfaced on the step's own line, not rethrown.
    expect(out.join('')).toContain('failed: boom');
    // Happy-path goodbye still printed (sequence completed normally).
    expect(out.join('')).toContain('[clideck] goodbye.');
  });

  it('emits the SIGINT banner first, then per-step done() lines, then goodbye', async () => {
    const { deps, out } = makeDeps();
    const { onShutdown } = createShutdown(deps);

    await onShutdown('SIGINT');

    const joined = out.join('');
    expect(joined).toContain('Ctrl+C received — shutting down…');
    expect(joined).toContain('[clideck] flushing plugins… ');
    expect(joined).toContain('[clideck] stopping activity… ');
    expect(joined).toContain('[clideck] persisting sessions… ');
    expect(joined).toMatch(/done \(\d+ms\)/);
    expect(joined).toContain('[clideck] goodbye.');
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('emits the SIGTERM banner variant when signal is SIGTERM (AC 7)', async () => {
    const { deps, out } = makeDeps();
    const { onShutdown } = createShutdown(deps);

    await onShutdown('SIGTERM');

    expect(out.join('')).toContain('SIGTERM received — shutting down…');
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});

describe('createShutdown — watchdog armed (AC 5)', () => {
  it('force-exits with the took-too-long message once the cap elapses', async () => {
    vi.useFakeTimers();
    let resolveSessions;
    const neverUntilWeSay = new Promise((r) => { resolveSessions = r; });
    const { deps, out } = makeDeps({
      timeoutMs: 10000,
      // sessions.shutdown hangs so the happy path can't reach exit on its own.
      sessions: { shutdown: vi.fn(() => neverUntilWeSay) },
    });
    const { onShutdown } = createShutdown(deps);

    // Kick it off but do NOT await to completion (it's stuck in step 6).
    const running = onShutdown('SIGINT');
    // Let the synchronous prologue (banner + timer arming + first two steps)
    // settle so the watchdog timer is registered.
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Just before the cap: not yet forced.
    vi.advanceTimersByTime(9999);
    expect(deps.exit).not.toHaveBeenCalled();

    // Past the cap: watchdog fires, logs, and forces exit(0).
    vi.advanceTimersByTime(2);
    expect(out.join('')).toContain('shutdown took too long — forcing exit');
    expect(deps.exit).toHaveBeenCalledWith(0);

    // Cleanup: unstick the hung step so the dangling promise can settle.
    resolveSessions();
    await running;
  });
});

describe('createShutdown — heartbeat format (AC 4)', () => {
  it('emits a heartbeat naming the current step and elapsed seconds while in flight', async () => {
    vi.useFakeTimers();
    let resolveStep;
    const slow = new Promise((r) => { resolveStep = r; });
    const { deps, out } = makeDeps({
      heartbeatMs: 3000,
      timeoutMs: 100000, // keep the watchdog out of the way for this test
      // Hang inside 'stopping activity' so currentStep is deterministic when
      // the heartbeat ticks. (Steps after a pending await don't advance under
      // fake timers without microtask flushing, so the in-flight step is the
      // first one we hang — here, activity.stop.)
      activity: { stop: vi.fn(() => slow) },
    });
    const { onShutdown } = createShutdown(deps);

    const running = onShutdown('SIGINT');
    await Promise.resolve();
    await Promise.resolve();

    // Advance to the first heartbeat tick.
    vi.advanceTimersByTime(3000);

    const joined = out.join('');
    expect(joined).toMatch(
      /\[clideck\] still shutting down… \(current step: .+, elapsed: \d+s\)/
    );
    // The active step at the time of the tick is 'stopping activity'.
    expect(joined).toContain('current step: stopping activity');

    // Cleanup.
    resolveStep();
    await running;
  });
});
