const http = require('http');
const { readFileSync, existsSync } = require('fs');
const { join, extname, resolve } = require('path');
const { WebSocketServer } = require('ws');
const { ensurePtyHelper } = require('./utils');
const { PORT, HOST, localUrl } = require('./runtime');

function terminalLink(url, text = url) {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

function openUrlHint() {
  return process.platform === 'darwin' ? 'Cmd+click to open' : 'Ctrl+click to open';
}

// --- Self-update check (runs before server starts) ---
const currentVersion = require('./package.json').version;
const { execFile, execSync } = require('child_process');
const shellOpt = process.platform === 'win32';

function checkSelfUpdate() {
  return new Promise(ok => {
    // Skip in non-interactive or local dev contexts
    if (!process.stdin.isTTY || !process.stdout.isTTY) return ok();
    if (!__dirname.includes(join('node_modules', 'clideck'))) return ok();
    execFile('npm', ['view', 'clideck', 'version'], { shell: shellOpt, windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return ok();
      const latest = stdout.trim();
      if (!latest || latest === currentVersion) return ok();
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`\n\x1b[38;5;105m  Update available:\x1b[0m \x1b[38;5;245m${currentVersion}\x1b[0m → \x1b[38;5;44m${latest}\x1b[0m\n\n  \x1b[38;5;252mUpdate now? [Y/n]\x1b[0m `, answer => {
        rl.close();
        if (answer.trim().toLowerCase() === 'n') return ok();
        console.log('\n  \x1b[38;5;245mUpdating...\x1b[0m\n');
        try {
          execSync('npm install -g clideck', { stdio: 'inherit', shell: true });
          console.log('\n  \x1b[38;5;44mUpdated to v' + latest + '. Restarting...\x1b[0m\n');
          const { spawn } = require('child_process');
          spawn(process.argv[0], process.argv.slice(1), { stdio: 'inherit', shell: shellOpt }).on('close', code => process.exit(code));
          return;
        } catch {
          console.log('\n  \x1b[38;5;196mUpdate failed.\x1b[0m Continuing with v' + currentVersion + '.\n');
          ok();
        }
      });
    });
  });
}

checkSelfUpdate().then(() => {

const { onConnection } = require('./handlers');
const sessions = require('./sessions');

const transcript = require('./transcript');
const telemetry = require('./telemetry-receiver');
const plugins = require('./plugin-loader');

ensurePtyHelper();
sessions.loadSessions();
transcript.init(sessions.broadcast, new Set(sessions.getResumable().map(s => s.id)), (...args) => plugins.notifyTranscript(...args));
telemetry.init(sessions.broadcast, sessions.getSessions, sessions.captureToken);
require('./opencode-bridge').init(sessions.broadcast, sessions.getSessions, sessions.captureToken);
const config = require('./config');
plugins.init(sessions.broadcast, sessions.getSessions, () => require('./handlers').getConfig(), (cfg) => config.save(cfg), sessions.input, sessions.createProgrammatic, sessions.close);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const ALIASES = {
  '/xterm.css':    require.resolve('@xterm/xterm/css/xterm.css'),
  '/xterm.js':     require.resolve('@xterm/xterm/lib/xterm.js'),
  '/addon-fit.js': require.resolve('@xterm/addon-fit/lib/addon-fit.js'),
};

const PUBLIC_ROOT = join(__dirname, 'public');
const geminiMenuPoll = new Map();

function startGeminiMenuPoll(id) {
  const prev = geminiMenuPoll.get(id);
  if (prev) clearInterval(prev);
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > 3000) {
      clearInterval(timer);
      geminiMenuPoll.delete(id);
      return;
    }
    sessions.broadcast({ type: 'terminal.capture', id });
  }, 500);
  geminiMenuPoll.set(id, timer);
}

const server = http.createServer((req, res) => {
  // OTLP telemetry endpoint — receives JSON from CLI agents
  // Some agents (Gemini) POST to / instead of /v1/logs
  if (req.method === 'POST' && (req.url === '/v1/logs' || req.url === '/')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { req.destroy(); return; }
    });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      try { req.body = JSON.parse(body); } catch {
        console.log(`OTLP: failed to parse body (content-type: ${contentType}, ${body.length} bytes)`);
        req.body = null;
      }
      telemetry.handleLogs(req, res);
    });
    return;
  }

  // Codex lifecycle hooks. Silent hooks call start/stop directly; legacy notify still arms a stop.
  if (req.method === 'POST' && req.url.startsWith('/hook/codex/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const route = req.url.slice('/hook/codex/'.length);
        const clideckId = payload.clideck_id;
        const threadId = payload['thread-id'] || payload.session_id;
        // console.log(`[codex] notify clideck=${clideckId ? clideckId.slice(0,8) : 'none'} thread=${threadId ? threadId.slice(0,8) : 'none'}`);
        const allSessions = sessions.getSessions();
        let matchedId = null;
        if (clideckId && allSessions.has(clideckId)) {
          matchedId = clideckId;
        } else if (threadId) {
          for (const [id, s] of allSessions) {
            if (s.sessionToken === threadId) {
              matchedId = id;
              break;
            }
          }
        }
        if (matchedId) {
          const sess = allSessions.get(matchedId);
          if (sess && threadId) sessions.captureToken(matchedId, threadId);
          const telemetry = require('./telemetry-receiver');
          if (route === 'start') telemetry.markCodexStart(matchedId, 'hook');
          else if (route === 'stop') telemetry.armCodexStop(matchedId);
        }
        // if (!matchedId) console.log(`[codex] hook ${route} no match clideck=${clideckId ? clideckId.slice(0,8) : 'none'} thread=${threadId ? threadId.slice(0,8) : 'none'}`);
      } catch {}
      res.writeHead(200).end('{}');
    });
    return;
  }

  // Claude Code hook endpoints — deterministic start/stop/idle signals
  if (req.method === 'POST' && req.url.startsWith('/hook/claude/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const route = req.url.slice('/hook/claude/'.length);
        const sessionId = payload.session_id;
        const allSessions = sessions.getSessions();
        const clideckId = payload.clideck_id && allSessions.has(payload.clideck_id)
          ? payload.clideck_id
          : sessionId
            ? [...allSessions].find(([, s]) => s.sessionToken === sessionId)?.[0]
            : null;
        // console.log(`[claude] hook ${route} clideck=${payload.clideck_id?.slice(0,8) || 'none'} session=${sessionId?.slice(0,8) || 'none'} match=${clideckId?.slice(0,8) || 'none'}`);
        if (clideckId) {
          const sess = allSessions.get(clideckId);
          // Claude's session_id IS the resumable session token. Capture
          // it on every hook payload that carries one — telemetry may
          // not be set up, in which case this is the only signal that
          // makes the session pauseable / resumable.
          if (sess && sessionId) sessions.captureToken(clideckId, sessionId);
          if (route === 'start') {
            // console.log(`[claude] status working=true source=hook session=${clideckId.slice(0,8)}`);
            sessions.broadcast({ type: 'session.status', id: clideckId, working: true, source: 'hook' });
          } else if (route === 'stop' || route === 'idle') {
            // console.log(`[claude] status working=false source=hook session=${clideckId.slice(0,8)}`);
            sessions.broadcast({ type: 'session.status', id: clideckId, working: false, source: 'hook' });
            // After an approval menu, Claude can already be idle before the real
            // stop hook arrives. In that case there is no new working→idle edge
            // on the client, so force one final capture from the true stop signal.
            if (route === 'stop' && sess && !sess.working) {
              // console.log(`[claude] stop capture session=${clideckId.slice(0,8)} source=claude-stop`);
              setTimeout(() => sessions.broadcast({ type: 'terminal.capture', id: clideckId }), 500);
            }
          } else if (route === 'menu') {
            // PreToolUse: trigger terminal capture — detectMenu will set idle if a choice menu is visible
            const menuVersion = sess ? ((sess._menuVersion || 0) + 1) : 1;
            if (sess) sess._menuVersion = menuVersion;
            // console.log(`[claude] menu capture session=${clideckId.slice(0,8)} source=claude-menu version=${menuVersion}`);
            setTimeout(() => sessions.broadcast({ type: 'terminal.capture', id: clideckId, menuVersion }), 500);
          }
        } else {
          // console.log(`[claude] hook ${route} no-match`);
        }
      } catch {}
      res.writeHead(200).end('{}');
    });
    return;
  }

  // Gemini hook endpoints — deterministic start/stop/menu signals
  if (req.method === 'POST' && req.url.startsWith('/hook/gemini/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const route = req.url.slice('/hook/gemini/'.length);
        const allSessions = sessions.getSessions();
        const clideckId = payload.clideck_id && allSessions.has(payload.clideck_id)
          ? payload.clideck_id
          : [...allSessions].find(([, s]) => s.sessionToken === payload.session_id)?.[0];
        if (clideckId) {
          const s = allSessions.get(clideckId);
          if (s && payload.session_id) sessions.captureToken(clideckId, payload.session_id);
          if (route === 'menu') {
            startGeminiMenuPoll(clideckId);
          } else {
            sessions.broadcast({ type: 'session.status', id: clideckId, working: route === 'start', source: 'hook' });
          }
        }
      } catch {}
      res.writeHead(200).end('{}');
    });
    return;
  }

  // OpenCode plugin bridge events
  if (req.method === 'POST' && req.url === '/opencode-events') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try { require('./opencode-bridge').handleEvent(JSON.parse(body)); } catch (e) { console.error('[opencode-bridge] handleEvent error:', e); }
      res.writeHead(200).end('{}');
    });
    return;
  }

  // Session-to-session ask bridge used by the `clideck ask` CLI command.
  if (req.method === 'POST' && req.url === '/api/session/ask') {
    require('./session-ask').handleHttp(req, res, sessions);
    return;
  }

  // DEBUG: log any POST (agents might use /v1/traces, /v1/metrics, or other paths)
  if (req.method === 'POST') {
    // console.log(`OTLP: received POST ${req.url} (not handled)`);
    return res.writeHead(200).end('{}');
  }

  // Plugin static files (/plugins/<id>/client.js, /plugins/<id>/public/*)
  if (req.url.startsWith('/plugins/')) {
    const pluginFile = plugins.resolveFile(req.url);
    if (pluginFile) {
      res.writeHead(200, { 'Content-Type': MIME[extname(pluginFile)] || 'application/javascript' });
      return res.end(readFileSync(pluginFile));
    }
    return res.writeHead(404).end();
  }

  const filePath = ALIASES[req.url]
    || resolve(PUBLIC_ROOT, (req.url === '/' ? 'index.html' : req.url).replace(/^\//, ''));
  if (!filePath.startsWith(PUBLIC_ROOT) && !ALIASES[req.url]) return res.writeHead(403).end();
  if (!existsSync(filePath)) return res.writeHead(404).end();
  try {
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  } catch { res.writeHead(500).end(); }
});

const allowedOrigins = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
  `http://[::1]:${PORT}`, `http://${HOST}:${PORT}`,
]);
function isAllowedWsOrigin(origin, hostHeader) {
  if (!origin) return true; // non-browser clients
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === hostHeader) return true;
    return allowedOrigins.has(origin);
  } catch {
    return false;
  }
}
const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => {
    return isAllowedWsOrigin(req.headers.origin, req.headers.host);
  },
});
wss.on('connection', onConnection);
// Without this listener, the WebSocketServer rethrows any error emitted by
// the underlying http server — including EADDRINUSE during listen. That
// rethrow crashes the process before tryListen's retry loop has a chance
// to fire, which is what broke the in-UI restart on 2026-05-18 with PID
// 12980 holding the port and child PID 40804 dying immediately. Logging
// the error is enough — onListenError below handles the actual retry and
// any post-bind socket error from the WSS side is informational.
wss.on('error', (err) => {
  console.error('[wss] error:', err.code || err.message);
});

const activity = require('./activity');
activity.start(sessions.getSessions(), sessions.broadcast);
sessions.startAutoSave(() => require('./handlers').getConfig());

// Graceful shutdown: persist sessions before exit. Each step is isolated in
// its own try/catch so one stuck step (e.g. a node-pty.kill() that won't
// return) can't prevent process.exit() from running and releasing port
// 4000 — which is what stranded PID 12980 on 2026-05-18.
const { getConfig } = require('./handlers');
function onShutdown() {
  try { plugins.shutdown(); }            catch (e) { console.error('[shutdown] plugins:',  e.message); }
  try { activity.stop(); }               catch (e) { console.error('[shutdown] activity:', e.message); }
  try { sessions.shutdown(getConfig()); } catch (e) { console.error('[shutdown] sessions:', e.message); }
  process.exit(0);
}
process.on('SIGINT', onShutdown);
process.on('SIGTERM', onShutdown);

// In-process restart, wrapper-coordinated:
//
//   [this clideck]  ──spawns──>  [lib/restart-wrapper.js]  ──spawns──>  [new clideck]
//          │                            │                                     │
//          └─exits via onShutdown───────┘                                     │
//                                       │                                     │
//                                       └─waits for parent exit + port free──┘
//                                       └─waits for new clideck to bind, then exits 0
//
// The wrapper is the neutral observer: a 5KB script with no plugins,
// no PTYs, no WSS. It can't hang on any of the things clideck can hang
// on. By spawning the new clideck from the wrapper rather than from us
// directly, the new clideck isn't entangled in our death sequence — it
// has a clean parent that exits cleanly when its job is done.
//
// The browser's existing WebSocket reconnect loop in app.js handles
// the disconnect/reconnect window — the user sees a "Restarting…" toast
// that gets cleared once the new process announces itself with a
// different bootId.
//
// The 200ms broadcast→shutdown delay gives in-flight `server.restarting`
// messages time to reach every client before we kill their sockets.
// node-pty PTYs in this process are torn down by sessions.shutdown(),
// which also persists the resumable list so it survives the restart.
function openRestartLog() {
  try {
    const fs = require('fs');
    const { DATA_DIR } = require('./paths');
    const logPath = join(DATA_DIR, 'restart.log');
    // One-generation rotation: if the current log is >1MB, roll it to
    // restart.log.1 (overwriting any prior generation) before opening
    // fresh. Keeps disk use bounded without needing a real log lib.
    try {
      const st = fs.statSync(logPath);
      if (st.size > 1024 * 1024) {
        try { fs.renameSync(logPath, logPath + '.1'); } catch { /* noop */ }
      }
    } catch { /* file doesn't exist yet — fine */ }
    const fd = fs.openSync(logPath, 'a');
    fs.writeSync(fd, `\n[${new Date().toISOString()}] parent ${process.pid} requesting restart\n`);
    return fd;
  } catch {
    return null;
  }
}

function requestRestart() {
  console.log('[restart] requestRestart() — broadcasting server.restarting');
  try { sessions.broadcast({ type: 'server.restarting' }); } catch { /* noop */ }
  // Hard-exit watchdog: if anything in onShutdown's call chain hangs
  // synchronously (a stubborn PTY, a plugin's shutdown handler, etc.),
  // the parent never releases port 4000 and the child fails EADDRINUSE
  // forever. After 3s of "we should be gone by now", force exit.
  setTimeout(() => {
    console.error('[restart] shutdown watchdog tripped at 3s — forcing process.exit(1)');
    process.exit(1);
  }, 3000);
  setTimeout(() => {
    console.log('[restart] 200ms elapsed — spawning restart wrapper');
    try {
      const { spawn } = require('child_process');
      const logFd = openRestartLog();
      // Instead of spawning the replacement clideck directly, we spawn a
      // tiny neutral wrapper (lib/restart-wrapper.js). The wrapper waits
      // for THIS process to exit, waits for the port to be free, then
      // spawns the new clideck and exits once it's verified listening.
      // Two big wins over the direct-spawn pattern:
      //   1. The new clideck is the wrapper's child, not ours — so it
      //      isn't entangled with our death sequence (Windows console
      //      ownership, job objects, the works).
      //   2. The wrapper is the neutral observer: if the handoff fails
      //      partway, restart.log captures exactly which stage broke.
      const wrapperPath = join(__dirname, 'lib', 'restart-wrapper.js');
      const wrapperEnv = {
        ...process.env,
        CLIDECK_RESTART_PARENT_PID: String(process.pid),
        CLIDECK_RESTART_PORT: String(PORT),
        CLIDECK_RESTART_ARGV: JSON.stringify(process.argv),
      };
      const child = spawn(process.argv[0], [wrapperPath], {
        detached: true,
        stdio: ['ignore', logFd || 'ignore', logFd || 'ignore'],
        env: wrapperEnv,
        windowsHide: true,
      });
      child.unref();
      console.log('[restart] spawned restart wrapper PID=' + child.pid + ' (log → ~/.clideck/restart.log)');
      if (logFd != null) {
        try { require('fs').closeSync(logFd); } catch { /* child still holds it */ }
      }
    } catch (e) {
      console.error('[restart] failed to spawn replacement:', e.message);
    }
    console.log('[restart] calling onShutdown() — parent exiting');
    onShutdown();
  }, 200);
}
module.exports = { requestRestart };

// Retry the bind for ~6s on EADDRINUSE. The in-UI restart spawns a
// replacement clideck before the parent's process.exit() has released
// the port; without this retry the child would die on first bind and
// disappear silently (Windows holds the port slightly longer than the
// 200ms broadcast→exit delay accounts for). Any other listen error is
// fatal and exits 1.
const LISTEN_RETRY_LIMIT = 30;
const LISTEN_RETRY_DELAY_MS = 200;
let listenAttempt = 0;
function tryListen() {
  server.once('error', onListenError);
  server.listen(PORT, HOST, onListenOk);
}
function onListenError(err) {
  if (err.code === 'EADDRINUSE' && listenAttempt < LISTEN_RETRY_LIMIT) {
    listenAttempt++;
    if (listenAttempt === 1) {
      console.log(`\x1b[38;5;245m  ▸ port ${PORT} busy — waiting for previous clideck to release it…\x1b[0m`);
    }
    setTimeout(tryListen, LISTEN_RETRY_DELAY_MS);
    return;
  }
  console.error(`[clideck] failed to bind ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
}
function onListenOk() {
  const v = require('./package.json').version;
  const { BOOT_ID } = require('./runtime');
  console.log(`[restart] booted v${v} pid=${process.pid} bootId=${BOOT_ID} on ${HOST}:${PORT}`);
  const url = localUrl();
  const clickableUrl = terminalLink(url);
  const urlHint = openUrlHint();
  console.log(`
\x1b[38;5;105m  ╺━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╸\x1b[0m

\x1b[38;5;239m   ██████╗\x1b[38;5;242m██╗     \x1b[38;5;245m██╗\x1b[38;5;105m██████╗ \x1b[38;5;141m███████╗\x1b[38;5;147m ██████╗\x1b[38;5;183m██╗  ██╗\x1b[0m
\x1b[38;5;239m  ██╔════╝\x1b[38;5;242m██║     \x1b[38;5;245m██║\x1b[38;5;105m██╔══██╗\x1b[38;5;141m██╔════╝\x1b[38;5;147m██╔════╝\x1b[38;5;183m██║ ██╔╝\x1b[0m
\x1b[38;5;239m  ██║     \x1b[38;5;242m██║     \x1b[38;5;245m██║\x1b[38;5;105m██║  ██║\x1b[38;5;141m█████╗  \x1b[38;5;147m██║     \x1b[38;5;183m█████╔╝ \x1b[0m
\x1b[38;5;239m  ██║     \x1b[38;5;242m██║     \x1b[38;5;245m██║\x1b[38;5;105m██║  ██║\x1b[38;5;141m██╔══╝  \x1b[38;5;147m██║     \x1b[38;5;183m██╔═██╗ \x1b[0m
\x1b[38;5;239m  ╚██████╗\x1b[38;5;242m███████╗\x1b[38;5;245m██║\x1b[38;5;105m██████╔╝\x1b[38;5;141m███████╗\x1b[38;5;147m╚██████╗\x1b[38;5;183m██║  ██╗\x1b[0m
\x1b[38;5;239m   ╚═════╝\x1b[38;5;242m╚══════╝\x1b[38;5;245m╚═╝\x1b[38;5;105m╚═════╝ \x1b[38;5;141m╚══════╝\x1b[38;5;147m ╚═════╝\x1b[38;5;183m╚═╝  ╚═╝\x1b[0m

\x1b[38;5;105m  ╺━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╸\x1b[0m

\x1b[38;5;245m  v${v}\x1b[0m

\x1b[38;5;252m  ▸ Ready at \x1b[38;5;44m${clickableUrl}\x1b[38;5;245m (${urlHint})\x1b[0m
\x1b[38;5;245m  ▸ Stop with \x1b[38;5;252mCtrl+C\x1b[38;5;245m · Restart anytime with \x1b[38;5;252mclideck\x1b[0m
${HOST !== '127.0.0.1' ? '\x1b[38;5;208m  ▸ Warning: listening on ' + HOST + ' — no authentication, anyone on the network can connect\x1b[0m\n' : ''}`);
}
tryListen();

}); // checkSelfUpdate
