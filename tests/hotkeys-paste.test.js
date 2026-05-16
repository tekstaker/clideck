// Ctrl+V paste hotkey — wiring + regression tests.
//
// xterm.js does not bind Ctrl+V by default. clideck owns paste via
// pasteIntoTerminal() and routes it through the hotkey registry in
// public/js/hotkeys.js. These tests exercise the document-level dispatcher
// — the same seam the hotkey registry uses for keys outside terminal focus
// — and cover the Nyquist gaps called out in the handoff document:
//
//   1. Ctrl+V dispatches to pasteIntoTerminal with the active session.
//   2. Intercepted Ctrl+V has preventDefault() + stopPropagation() called
//      so xterm.js doesn't *also* forward ^V to the PTY.
//   3. Cmd+V (macOS, metaKey only) hits the same handler.
//   4. Ctrl+V with no active terminal is a graceful no-op (no throw).
//   5. Ctrl+V on a real <input> / <textarea> outside the terminal is not
//      intercepted — the browser's native paste continues to fire.
//   6. Ctrl+Shift+K still clears the active terminal (no regression).
//   7. Registering Ctrl+V twice is rejected by the registry's dedup logic.

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

  await import('../public/js/terminals.js');
  const hotkeysMod = await import('../public/js/hotkeys.js');

  return { state, sentMessages, hotkeys: hotkeysMod };
}

function setClipboardText(text) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn(async () => text) },
  });
}

function dispatchKey(target, init) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, ...init });
  // happy-dom honours bubbles, but preventDefault/stopPropagation
  // observability survives dispatch — assertions read defaultPrevented
  // and a manual stopPropagation spy below.
  let stopped = false;
  const origStop = ev.stopPropagation.bind(ev);
  ev.stopPropagation = () => {
    stopped = true;
    origStop();
  };
  target.dispatchEvent(ev);
  return { event: ev, stopped };
}

describe('Ctrl+V paste hotkey', () => {
  beforeEach(() => {
    setClipboardText('pasted text');
  });

  it('Ctrl+V on document with active session sends clipboard to PTY', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';

    dispatchKey(document.body, { code: 'KeyV', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([
      { type: 'input', id: 'sess-1', data: 'pasted text' },
    ]);
  });

  it('intercepted Ctrl+V has preventDefault and stopPropagation called', async () => {
    const { state } = await loadFreshTerminals();
    state.active = 'sess-1';

    const { event, stopped } = dispatchKey(document.body, {
      code: 'KeyV',
      ctrlKey: true,
      cancelable: true,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(event.defaultPrevented).toBe(true);
    expect(stopped).toBe(true);
  });

  it('Cmd+V (metaKey only) dispatches to the same paste handler', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-mac';

    dispatchKey(document.body, { code: 'KeyV', metaKey: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([
      { type: 'input', id: 'sess-mac', data: 'pasted text' },
    ]);
  });

  it('Ctrl+V with no active terminal is a graceful no-op', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = null;

    expect(() => {
      dispatchKey(document.body, { code: 'KeyV', ctrlKey: true });
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([]);
  });

  it('Ctrl+V inside an input/textarea is not intercepted by the dispatcher', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';

    const input = document.createElement('input');
    document.body.appendChild(input);

    const { event } = dispatchKey(input, {
      code: 'KeyV',
      ctrlKey: true,
      cancelable: true,
    });
    await new Promise((r) => setTimeout(r, 0));

    // hotkeys.js's document listener skips inputs via isInput(e.target),
    // so the browser's native paste should be free to fire — i.e. our
    // handler does not preventDefault and does not push to the PTY.
    expect(event.defaultPrevented).toBe(false);
    expect(sentMessages).toEqual([]);
  });

  it('Ctrl+V inside a contentEditable element is not intercepted', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);

    const { event } = dispatchKey(editor, {
      code: 'KeyV',
      ctrlKey: true,
      cancelable: true,
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(event.defaultPrevented).toBe(false);
    expect(sentMessages).toEqual([]);
  });

  it('empty clipboard does not push anything to the PTY', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';
    setClipboardText('');

    dispatchKey(document.body, { code: 'KeyV', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([]);
  });

  it('rejected clipboard read does not throw out of the dispatcher', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => {
          throw new Error('clipboard access denied');
        }),
      },
    });

    expect(() => {
      dispatchKey(document.body, { code: 'KeyV', ctrlKey: true });
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([]);
  });

  it('multi-line clipboard content is sent as a single input payload', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-1';
    setClipboardText('first line\nsecond line\nthird line');

    dispatchKey(document.body, { code: 'KeyV', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(sentMessages).toEqual([
      { type: 'input', id: 'sess-1', data: 'first line\nsecond line\nthird line' },
    ]);
  });

  it('Ctrl+Shift+K still clears the active terminal (no regression)', async () => {
    const { state } = await loadFreshTerminals();
    const clear = vi.fn();
    state.terms.set('sess-1', { term: { clear } });
    state.active = 'sess-1';

    dispatchKey(document.body, {
      code: 'KeyK',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('registering Ctrl+V twice is rejected by the dedup logic', async () => {
    const { hotkeys } = await loadFreshTerminals();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = hotkeys.registerHotkey('test-plugin', 'Ctrl+V', () => {});

    expect(second).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
