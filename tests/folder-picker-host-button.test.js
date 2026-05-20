// Folder-picker "Host" button — surfaces an env-driven host filesystem root
// in the directory chooser modal so users running clideck inside a container
// can jump to a host bind-mount in one click instead of navigating manually.
//
// The server-side seam (handlers.js:configForClient) puts the resolved host
// path on `cfg.hostDir`; if it is null the button stays hidden so non-container
// runs do not see a misleading control.
//
// Tests cover:
//   1. Button is hidden when state.cfg.hostDir is null.
//   2. Button becomes visible when openFolderPicker is called with hostDir set.
//   3. Clicking the button dispatches dirs.list with the hostDir path.
//   4. Clicking the button does NOT navigate when hostDir is empty/undefined
//      (graceful no-op rather than throwing).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODAL_HTML = `
  <div id="folder-picker" class="hidden">
    <div>
      <div>
        <span>Choose Directory</span>
        <div>
          <button id="fp-host" class="hidden">Host</button>
          <button id="fp-new-folder">+</button>
          <button id="fp-toggle-hidden">eye</button>
        </div>
      </div>
      <div id="fp-path"></div>
      <div id="fp-listing"></div>
      <button id="fp-cancel">Cancel</button>
      <button id="fp-select">Select</button>
    </div>
  </div>
`;

async function loadFreshPicker() {
  vi.resetModules();
  document.body.innerHTML = MODAL_HTML;

  const stateMod = await import('../public/js/state.js');
  const state = stateMod.state;

  const sentMessages = [];
  state.ws = { readyState: WebSocket.OPEN, send: (data) => sentMessages.push(JSON.parse(data)) };
  state.cfg = { commands: [], defaultPath: '/home/clideck/Documents', defaultTheme: 'catppuccin-mocha', hostDir: null };

  const picker = await import('../public/js/folder-picker.js');
  return { state, sentMessages, picker };
}

describe('folder-picker Host button', () => {
  it('is hidden when state.cfg.hostDir is null', async () => {
    const { picker } = await loadFreshPicker();
    picker.openFolderPicker('/home/clideck/Documents', () => {});
    const btn = document.getElementById('fp-host');
    expect(btn.classList.contains('hidden')).toBe(true);
  });

  it('becomes visible after openFolderPicker when state.cfg.hostDir is set', async () => {
    const { state, picker } = await loadFreshPicker();
    state.cfg.hostDir = '/projects';
    picker.openFolderPicker('/home/clideck/Documents', () => {});
    const btn = document.getElementById('fp-host');
    expect(btn.classList.contains('hidden')).toBe(false);
  });

  it('dispatches dirs.list with hostDir path when clicked', async () => {
    const { state, sentMessages, picker } = await loadFreshPicker();
    state.cfg.hostDir = '/projects';
    picker.openFolderPicker('/home/clideck/Documents', () => {});
    sentMessages.length = 0; // discard the initial navigate

    document.getElementById('fp-host').click();

    const dirsList = sentMessages.find(m => m.type === 'dirs.list');
    expect(dirsList).toBeDefined();
    expect(dirsList.path).toBe('/projects');
  });

  it('is a graceful no-op when clicked with no hostDir set', async () => {
    const { sentMessages, picker } = await loadFreshPicker();
    picker.openFolderPicker('/home/clideck/Documents', () => {});
    sentMessages.length = 0;

    expect(() => document.getElementById('fp-host').click()).not.toThrow();
    const postClickDirsList = sentMessages.find(m => m.type === 'dirs.list');
    expect(postClickDirsList).toBeUndefined();
  });
});
