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
