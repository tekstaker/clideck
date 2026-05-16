// Ctrl+V paste hotkey — wiring test.
//
// xterm.js does not bind Ctrl+V by default. clideck owns paste via
// pasteIntoTerminal() and routes it through the hotkey registry in
// public/js/hotkeys.js. This test exercises the document-level dispatcher,
// which is the same seam the hotkey registry uses for keys outside the
// terminal focus, and asserts that Ctrl+V ends up pushing the clipboard
// contents to the active session's PTY.

import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadFreshTerminals() {
  vi.resetModules();
  document.body.innerHTML = '';

  const stateMod = await import('../public/js/state.js');
  const state = stateMod.state;

  const sentMessages = [];
  state.ws = { send: (data) => sentMessages.push(JSON.parse(data)) };
  state.active = null;
  state.terms = new Map();

  // Importing terminals.js triggers the core hotkey registrations
  // (Cmd+K, Ctrl+Shift+K, and — once implemented — Ctrl+V).
  await import('../public/js/terminals.js');

  return { state, sentMessages };
}

function setClipboardText(text) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn(async () => text) },
  });
}

describe('Ctrl+V paste hotkey', () => {
  beforeEach(() => {
    setClipboardText('pasted text');
  });

  it('Ctrl+V on document with active session sends clipboard to PTY', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyV',
      ctrlKey: true,
      bubbles: true,
    }));

    // pasteIntoTerminal awaits navigator.clipboard.readText, then send.
    // Drain the microtask queue.
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([
      { type: 'input', id: 'sess-1', data: 'pasted text' },
    ]);
  });
});
