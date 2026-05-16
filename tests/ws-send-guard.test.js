// state.send() must NOT call ws.send() unless the socket is OPEN.
//
// Before this guard, every keystroke from xterm hit `state.ws.send()` even
// when the socket was in CLOSING/CLOSED state. The browser threw, the throw
// was silent, and the user saw their input go nowhere until they hard-refreshed.
// The fix is a readyState gate in public/js/state.js — these tests pin it.

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshSend() {
  vi.resetModules();
  const mod = await import('../public/js/state.js');
  return mod;
}

describe('state.send() readyState guard', () => {
  let mod;
  let calls;
  beforeEach(async () => {
    mod = await freshSend();
    calls = [];
  });

  it('returns true and forwards when socket is OPEN', () => {
    mod.state.ws = { readyState: WebSocket.OPEN, send: (d) => calls.push(d) };
    expect(mod.send({ type: 'input', data: 'x' })).toBe(true);
    expect(calls).toEqual([JSON.stringify({ type: 'input', data: 'x' })]);
  });

  it('returns false and skips ws.send() when socket is CONNECTING', () => {
    mod.state.ws = { readyState: WebSocket.CONNECTING, send: (d) => calls.push(d) };
    expect(mod.send({ type: 'input', data: 'x' })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('returns false and skips ws.send() when socket is CLOSING', () => {
    mod.state.ws = { readyState: WebSocket.CLOSING, send: (d) => calls.push(d) };
    expect(mod.send({ type: 'input', data: 'x' })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('returns false and skips ws.send() when socket is CLOSED', () => {
    mod.state.ws = { readyState: WebSocket.CLOSED, send: (d) => calls.push(d) };
    expect(mod.send({ type: 'input', data: 'x' })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('returns false when state.ws is null (pre-connect)', () => {
    mod.state.ws = null;
    expect(mod.send({ type: 'ping' })).toBe(false);
  });

  it('returns false and swallows when ws.send throws', () => {
    mod.state.ws = { readyState: WebSocket.OPEN, send: () => { throw new Error('boom'); } };
    expect(mod.send({ type: 'ping' })).toBe(false);
  });
});
