const http = require('http');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('fs');
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
const authGate = require('./auth-gate');

const transcript = require('./transcript');
const telemetry = require('./telemetry-receiver');
const plugins = require('./plugin-loader');

ensurePtyHelper();
sessions.loadSessions();
// Phase 16 — load paired-device registry and (if empty) mint a bootstrap OTP.
// Placement is deliberate: AFTER sessions.loadSessions() so devices.load() has
// a fully-initialised DATA_DIR, and BEFORE anything wires the wss / HTTP
// surface so the auth gate has the device list available the moment the first
// request arrives. announcePairCode() ALWAYS prints a reusable host pairing
// code to stdout and writes it to .clideck/bootstrap.otp — whether or not
// devices are already paired — so the owner can always grab a code to pair
// another device (CLAUDE.md §13 bounded exception, per CONTEXT D-02 + the
// 2026-06-09 localhost-trust revision). See routes/pair.js for the redeem flow.
const devices = require('./devices');
const pairOtp = require('./pair-otp');
devices.load();
pairOtp.announcePairCode();
// Localhost-trust (2026-06-09): the owner at the machine is never forced
// through the pair gate. Default ON; set CLIDECK_REQUIRE_PAIRING=1 to enforce
// pairing even on loopback (the verifyClient gate then rejects tokenless
// loopback connections). See auth-gate.js for the trust rationale.
const TRUST_LOOPBACK = !process.env.CLIDECK_REQUIRE_PAIRING;
// Rehydrate plain-shell tabs persisted via the replayable track (Phase 14).
// Must run AFTER loadSessions (so the replayable[] array is populated) and
// BEFORE the transcript initializes below (so the rehydrated live sessions
// exist when it builds its resumable-id set). handlers.getConfig() is safe
// here because `require('./handlers')` has already loaded its module-scope cfg.
sessions.rehydrateReplayable(require('./handlers').getConfig());
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

  // Paste-blob upload — Ctrl+V on a focused terminal posts a binary
  // clipboard item here. The bytes land in <cwd>/.clideck/paste/ and
  // a confirmation line is echoed into the session's terminal stream
  // so both the user and the running agent see the path that was
  // written.
  const blobMatch = req.method === 'POST' && req.url.match(/^\/sessions\/([^/]+)\/paste-blob$/);
  if (blobMatch) {
    const sessionId = decodeURIComponent(blobMatch[1]);
    const sess = sessions.getSessions().get(sessionId);
    if (!sess) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'session not found' }));
    }
    const pasteBlobs = require('./paste-blobs');
    const mime = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const hint = req.headers['x-filename'] ? String(req.headers['x-filename']) : null;
    const declaredLen = Number(req.headers['content-length'] || 0);
    if (declaredLen > pasteBlobs.MAX_PASTE_BLOB_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'blob exceeds size limit', limit: pasteBlobs.MAX_PASTE_BLOB_BYTES }));
    }
    const target = pasteBlobs.buildSafeBlobPath(sess.cwd, hint, mime);
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid filename or session cwd' }));
    }
    const chunks = [];
    let received = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > pasteBlobs.MAX_PASTE_BLOB_BYTES) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'blob exceeds size limit', limit: pasteBlobs.MAX_PASTE_BLOB_BYTES }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        mkdirSync(join(sess.cwd, '.clideck', 'paste'), { recursive: true });
        writeFileSync(target, Buffer.concat(chunks));
        const filename = target.split(/[\\/]/).pop();
        const relPath = `.clideck/paste/${filename}`;
        // Inject the path into the PTY's stdin so the agent actually
        // sees it. Broadcasting an `output` frame only writes to
        // xterm's display buffer — the agent process (Claude Code,
        // Codex, etc.) reads from its own stdin, not from xterm. By
        // writing to s.pty.write we put the path at the user's
        // cursor as if they'd typed it; user can prepend "describe
        // this " or hit enter as a bare ls/cat arg. Trailing space
        // so the next character types after it cleanly.
        try { sess.pty.write(relPath + ' '); } catch (e) {
          console.error('[paste-blob] pty.write threw:', e.message);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relPath, filename, sizeBytes: received, mime }));
      } catch (e) {
        console.error('[paste-blob] write failed:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'failed to write blob' }));
      }
    });
    req.on('error', (e) => {
      if (aborted) return;
      console.error('[paste-blob] request error:', e.message);
      try { res.writeHead(500).end(); } catch {}
    });
    return;
  }

  // Phase 16 — device pairing HTTP routes. Must sit ABOVE the DEBUG POST
  // catch-all below (which returns 200 '{}' for any unmatched POST and would
  // otherwise swallow /pair/redeem + /pair/mint-otp). The inline `require()`
  // mirrors the session-ask precedent at line ~247 above. `devices` and
  // `pairOtp` are the module-scope singletons bound in the boot block above —
  // captured by closure into this createServer callback.
  if (req.method === 'POST' && req.url === '/pair/redeem') {
    return require('./routes/pair').handleRedeemHttp(req, res, { devices, pairOtp });
  }
  if (req.method === 'POST' && req.url === '/pair/mint-otp') {
    return require('./routes/pair').handleMintOtpHttp(req, res, { devices, pairOtp });
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

  // Phase 16 — GET /pair sits ABOVE the static fallthrough so the URL hits
  // routes/pair.js (which serves public/pair.html with a defensive 503 if
  // missing) rather than resolving as a bare `pair` static-asset request
  // (which would 404 — public/pair.html has the `.html` extension).
  if (req.method === 'GET' && req.url === '/pair') {
    return require('./routes/pair').servePairHtml(req, res);
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
  // Phase 16 — gate WS upgrades on the device-token in Sec-WebSocket-Protocol.
  // Replaces the prior 1-arg verifyClient (which only ran the origin check)
  // with the 2-arg async form so we can also reject with HTTP 401 'unpaired'
  // BEFORE ws.completeUpgrade runs. Unpaired sockets are aborted at the HTTP
  // layer — they NEVER reach handlers.js:267's sessions.clients.add(ws),
  // so AC4's "no clients.count broadcast for unpaired" invariant is correct
  // by construction (Phase 15 merge-safety, RESEARCH §7).
  //
  // The origin check is preserved verbatim and runs FIRST inside
  // authGate.makeVerifyClient (RESEARCH §10.1) — non-browser clients with
  // no Origin header still pass through (isAllowedWsOrigin returns true).
  verifyClient: authGate.makeVerifyClient({ devices, isAllowedWsOrigin, trustLoopback: TRUST_LOOPBACK }),
  // Echo back the sentinel subprotocol so the browser handshake completes
  // for accepted tokens. ws will only emit 'connection' AFTER verifyClient
  // calls callback(true), so we know any protocol negotiation reaching
  // handleProtocols is from an authenticated request — but we still defend
  // by checking the sentinel is in the offered set. Returning false omits
  // the Sec-WebSocket-Protocol response header, which the browser treats
  // as a handshake failure (event.code === 1006). The test suite asserts
  // that we return the sentinel string, NOT the raw token (RESEARCH §1 R-1).
  handleProtocols: (protocols) => protocols.has('clideck-device-token') ? 'clideck-device-token' : false,
});
wss.on('connection', (ws, req) => {
  // Phase 16 Pattern A (RESEARCH §4) — tag the ws with the authenticated
  // device BEFORE handing to onConnection so revoke (sessions.closeDevice)
  // can identify the matching ws by ws.deviceId. req.clideckDevice was
  // stashed by authGate.makeVerifyClient — guaranteed present here because
  // we only reach the 'connection' event when verifyClient called
  // callback(true). Per CLAUDE.md §13 the raw token is NOT carried on the
  // ws; only the opaque device id + the sha256:<hex> hash are kept.
  ws.deviceId = req.clideckDevice.id;
  ws.deviceTokenHash = req.clideckDevice.token_hash;
  devices.touchLastSeen(req.clideckDevice.id);
  return onConnection(ws);
});
// Without this listener, the WebSocketServer rethrows any error emitted by
// the underlying http server — including EADDRINUSE during listen — which
// would crash the process before tryListen's retry loop can fire. Logging
// the error is enough; onListenError below handles the retry, and any
// post-bind socket error from the WSS side is informational.
wss.on('error', (err) => {
  console.error('[wss] error:', err.code || err.message);
});

const activity = require('./activity');
activity.start(sessions.getSessions(), sessions.broadcast);
sessions.startAutoSave(() => require('./handlers').getConfig());

// Graceful shutdown: persist sessions before exit. Each step is isolated in
// its own try/catch so one stuck step (e.g. a node-pty.kill() that won't
// return) can't prevent process.exit() from running and releasing port
// 4000 — which is what stranded PID 12980 on 2026-05-18. That isolated-try
// shape is load-bearing and is preserved inside shutdown.js's step() helper.
//
// The orchestration (ack banner, per-step timing, 3s heartbeat, 10s watchdog,
// goodbye) lives in ./shutdown.js so it can be unit-tested with injected fakes
// without booting a server. Here we just wire the real modules in and register
// the handlers, passing the signal name through so the banner can name it.
const { getConfig } = require('./handlers');
const { createShutdown } = require('./shutdown');
const { onShutdown } = createShutdown({ plugins, activity, sessions, getConfig });
process.on('SIGINT', () => onShutdown('SIGINT'));
process.on('SIGTERM', () => onShutdown('SIGTERM'));

// Retry the bind for ~6s on EADDRINUSE. When clideck is relaunched
// manually (e.g. after a `taskkill` of a stuck instance) the OS can
// hold the old port briefly after the previous process exits; without
// this retry a fast relaunch would die on first bind. Any other listen
// error is fatal and exits 1.
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
  console.log(`[clideck] booted v${v} pid=${process.pid} bootId=${BOOT_ID} on ${HOST}:${PORT}`);
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
