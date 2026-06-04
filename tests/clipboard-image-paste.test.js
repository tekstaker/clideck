// @vitest-environment happy-dom
//
// Phase 12 — clipboard-image-paste unit coverage (D-07).
//
// Locks the hardened binary branch of pasteIntoTerminal() shipped in Task 1:
//
//   A. Happy binary path: an image/png clipboard item is uploaded to
//      /sessions/:id/paste-blob with the blob body and an 'image/png'
//      content type, the request carries NO 'X-Filename' header (the
//      proxy that proves the 3-arg uploadBlobToSession call shape — the
//      helper only sets X-Filename when a truthy 4th filename arg is
//      passed, and it is not exported so arity can't be inspected directly),
//      and a success toast fires on the 200 { ok:true } response.
//   B. H5 rejection path (D-03): navigator.clipboard.read() rejects → an
//      error toast fires AND readText() still reaches the PTV via
//      state.ws.send (text fall-through preserved).
//   C. D-04 precision negative: a genuinely empty clipboard (read() → []
//      and readText() → '') does NOT fire the unreadable-clipboard toast.
//
// Runs under the DEFAULT happy-dom env (NOT @vitest-environment node — that
// header belongs to paste-blobs.test.js, which tests pure server functions).
// pasteIntoTerminal is not exported, so we reach it through the same
// document Ctrl+V dispatcher seam that hotkeys-paste.test.js uses.
//
// Seams that DO NOT exist in the referenced tests and are established here:
//   - showToast is a NAMED export from public/js/toast.js (not a window
//     global). We intercept it with vi.mock so we can assert on toast
//     type ('success' vs 'error') and id.
//   - fetch is an unmocked global. We stub global.fetch and read the
//     request init from fetch.mock.calls[0][1] to assert on headers.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Intercept showToast — a NAMED export from public/js/toast.js. vi.mock is
// hoisted above imports, so the spy must be created inside vi.hoisted() (which
// runs in that same hoisted scope) rather than as a plain top-level const —
// otherwise the factory closes over an undefined binding at collection time.
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../public/js/toast.js', () => ({ showToast }));

// Drain the binary async chain: read() → getType() → uploadBlobToSession()
// → fetch() → res.json(). Several promise hops, so flush a handful of
// macrotask ticks rather than a single microtask.
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function loadFreshTerminals() {
  vi.resetModules();
  document.body.innerHTML = '';
  showToast.mockClear();

  const stateMod = await import('../public/js/state.js');
  const state = stateMod.state;

  const sentMessages = [];
  state.ws = { readyState: WebSocket.OPEN, send: (data) => sentMessages.push(JSON.parse(data)) };
  state.active = null;
  state.terms = new Map();

  await import('../public/js/terminals.js');
  await import('../public/js/hotkeys.js');

  return { state, sentMessages };
}

function dispatchCtrlV() {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

// Build a fake clipboard whose read() yields the given items and whose
// readText() resolves the given string. Either may be a rejecting thunk.
function setClipboard({ read, readText }) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      read: read === undefined ? undefined : vi.fn(read),
      readText: vi.fn(readText),
    },
  });
}

describe('clipboard-image paste (Phase 12 hardened binary branch)', () => {
  beforeEach(() => {
    // Default fetch stub: 200 { ok:true, path } so uploadBlobToSession
    // resolves true and fires its success toast. Individual tests may
    // override before dispatch.
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, path: '.clideck/paste/x.png' }),
    }));
  });

  // ---- Test A: happy binary path + 3-arg proof via X-Filename absence ----
  it('uploads an image/png clipboard blob with no X-Filename header and toasts success', async () => {
    const { state } = await loadFreshTerminals();
    state.active = 'sess-img';

    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    setClipboard({
      read: async () => [
        { types: ['image/png'], getType: vi.fn(async () => blob) },
      ],
      readText: async () => '',
    });

    dispatchCtrlV();
    await flush();

    // The upload fetch fired exactly once, to the paste-blob endpoint.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/sessions/sess-img/paste-blob');
    expect(init.method).toBe('POST');
    // The blob itself is the request body.
    expect(init.body).toBe(blob);
    // mime is carried as the Content-Type.
    expect(init.headers['Content-Type']).toBe('image/png');
    // 3-arg proof: NO X-Filename header (uploadBlobToSession only sets it
    // when a truthy 4th filename arg is passed — its absence proves the
    // clipboard branch called with three args and let the server name it).
    expect('X-Filename' in init.headers).toBe(false);

    // Success toast fired after the 200 { ok:true }.
    const successCall = showToast.mock.calls.find(([, opts]) => opts && opts.type === 'success');
    expect(successCall).toBeTruthy();
    expect(successCall[0]).toContain('.clideck/paste/x.png');
  });

  // ---- Test B: H5 read() rejection → error toast + text fall-through ----
  it('surfaces an error toast on read() rejection AND still sends the text payload (D-03)', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-fall';

    setClipboard({
      read: async () => {
        throw new Error('clipboard access denied');
      },
      readText: async () => 'fallthrough text',
    });

    dispatchCtrlV();
    await flush();

    // D-03 error toast fired, with an id distinct from 'paste-blob'.
    const errorCall = showToast.mock.calls.find(([, opts]) => opts && opts.type === 'error');
    expect(errorCall).toBeTruthy();
    expect(errorCall[1].id).not.toBe('paste-blob');

    // Fall-through preserved: the text still reached the PTY via state.ws.send.
    expect(sentMessages).toEqual([
      { type: 'input', id: 'sess-fall', data: 'fallthrough text' },
    ]);

    // No upload should have fired on the rejection path.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ---- Test C: D-04 precision — empty clipboard fires no unreadable toast ----
  it('does NOT fire the unreadable-clipboard toast on a genuinely empty clipboard (D-04)', async () => {
    const { state, sentMessages } = await loadFreshTerminals();
    state.active = 'sess-empty';

    setClipboard({
      read: async () => [],
      readText: async () => '',
    });

    dispatchCtrlV();
    await flush();

    // The D-04 unreadable toast (id 'clipboard-unreadable') must NOT fire
    // on a genuinely empty clipboard — only on items-but-no-usable-MIME.
    const unreadable = showToast.mock.calls.find(
      ([, opts]) => opts && opts.id === 'clipboard-unreadable',
    );
    expect(unreadable).toBeFalsy();

    // And nothing reached the PTY.
    expect(sentMessages).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
