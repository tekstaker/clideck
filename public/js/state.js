export const state = {
  ws: null,
  terms: new Map(),
  active: null,
  cfg: { commands: [], defaultPath: '', defaultTheme: 'catppuccin-mocha', hostDir: null },
  themes: [],
  presets: [],
  resumable: [],
  filter: { query: '', tab: 'all' },
  pills: new Map(),
  activePill: null,
  transcriptCache: {},
  remoteVersion: null,
  // Phase 16 — paired device IDs/labels list, populated by the `device.list`
  // broadcast (handlers.js arm landed in 16-05; Settings panel render lands
  // in 16-07). Each entry shape: { id, label, fingerprint, paired_at,
  // last_seen, isThisDevice }.
  linkedDevices: [],
  // Phase 16 — this device's opaque public ID (NOT the token). Populated
  // at app boot from localStorage.getItem('clideck.deviceId'); written by
  // pair.js on a successful /pair/redeem. Used by the Settings panel to
  // mark "This device" on the linked-devices row.
  deviceId: null,
};

// Returns true if the message was handed to the socket, false if the socket
// wasn't open. Callers historically ignored the return value; we keep that
// signature compatible. Guarding readyState is the load-bearing change — the
// raw .send() throws on CLOSING/CLOSED sockets, which silently lost every
// keystroke until the user reloaded the page.
export function send(msg) {
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}
