const pty = require('node-pty');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');
const { parseCommand, resolveValidDir, defaultShell, binName } = require('./utils');
const activity = require('./activity');
const transcript = require('./transcript');
const telemetry = require('./telemetry-receiver');
const opencodeBridge = require('./opencode-bridge');
const plugins = require('./plugin-loader');

const THEMES = require('./themes');
const MAX_BUFFER = 200 * 1024;
const { PORT, localUrl } = require('./runtime');
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\x1b./g;
const PRESETS = JSON.parse(require('fs').readFileSync(join(__dirname, 'agent-presets.json'), 'utf8'));
for (const p of PRESETS) if (p.presetId === 'shell') p.command = defaultShell;
const { DATA_DIR } = require('./paths');
const SAVED_PATH = join(DATA_DIR, 'sessions.json');
const sessions = new Map();
const clients = new Set();

// Persisted sessions awaiting resume (loaded on startup, cleared as they're resumed)
let resumable = [];

// Persisted plain-shell sessions awaiting REPLAY (loaded on startup, drained
// once `rehydrateReplayable(cfg)` spawns them as fresh PTYs in their saved
// cwd). The replay vs resume distinction is the heart of this design:
//   resume  = re-attach an agent CLI to its prior session via
//             `--resume {{sessionId}}` — needs a captured token, has chat
//             history (the `resumable` track above).
//   replay  = spawn a brand-new PTY in the saved cwd — no token, no history,
//             just "put the tab back" (this track).
// Survive-the-container-restart, not survive-the-exit. A session lands here
// only when its preset declares the EXPLICIT `canReplay` capability — never
// by falling through from "not resumable" (CONTEXT D-01).
let replayable = [];

// Boot-time spawn-storm cap (CONTEXT D-03 / threat T-14-DoS): a corrupted or
// runaway sessions.json must not trigger hundreds of PTY spawns at boot.
const MAX_REPLAY_REHYDRATE = 50;

const broadcastListeners = [];

function addBroadcastListener(fn) {
  broadcastListeners.push(fn);
  return () => {
    const idx = broadcastListeners.indexOf(fn);
    if (idx >= 0) broadcastListeners.splice(idx, 1);
  };
}

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(raw);
  if (msg.type === 'session.status') {
    const s = sessions.get(msg.id);
    if (s) {
      s.working = !!msg.working;
      if (msg.working && msg.source === 'hook') {
        s._resolvedMenuKey = '';
      }
      // Codex approval flows can pause on a menu and then continue into a normal
      // reply; keep idle finalization enabled there so the completed post-menu
      // answer is not lost. Other agents still suppress transcript finalization on menu.
      s._finalizeOnIdle = !msg.working && msg.source !== 'esc' && (msg.source !== 'menu' || s.presetId === 'codex');
      // if (s.presetId === 'claude-code') {
      //   console.log(`[claude] broadcast status session=${msg.id.slice(0,8)} working=${!!msg.working} source=${msg.source} finalizeOnIdle=${!!s._finalizeOnIdle}`);
      // }
      // if (s.presetId === 'codex') console.log(`[codex] status session=${msg.id.slice(0,8)} working=${!!msg.working} source=${msg.source}`);
    }
    plugins.notifyStatus(msg.id, msg.working, msg.source);
  }
  for (const fn of broadcastListeners) try { fn(msg); } catch {}
}

// Phase 16 — close every live WS belonging to the given deviceId. Mirrors
// the broadcast() iteration shape immediately above: same `clients` Set,
// same readyState gate. Different action: ws.close(4401, 'revoked').
//
// Per-client try/catch — one wedged ws's close() throwing MUST NOT block
// the others (this is the AC5 latency budget: 50 clients close in < 1s).
// Returns the count of clients closed.
//
// 4401 = application-private close code (RFC 6455 §7.4.2 reserves
// 4000-4999 for app use). RESEARCH §4 + PATTERNS §4.7 verified 4401 is
// unused elsewhere in clideck — unambiguous for the client-side handler
// in app.js (Plan 16-06). Reason 'revoked' distinguishes the post-
// handshake revoke path from the pre-handshake 'unpaired' reject (which
// surfaces as event.code === 1006 — see auth-gate.js / RESEARCH §7).
//
// Pattern A (RESEARCH §4): ws.deviceId is tagged on the ws instance at
// successful upgrade in server.js's (ws, req) wrapper. n ≤ 5 paired
// devices × handful of tabs per device = single-digit iterations,
// sub-millisecond even with thousands of unrelated sockets in the Set.
function closeDevice(deviceId) {
  let closed = 0;
  for (const c of clients) {
    if (c.deviceId === deviceId && c.readyState === 1) {
      try {
        c.close(4401, 'revoked');
        closed++;
      } catch { /* one wedged ws must not block the rest */ }
    }
  }
  return closed;
}

// --- Spawn a PTY and wire up a session ---

function buildTelemetryEnv(id, cmd) {
  const bin = binName(cmd.command);
  const preset = PRESETS.find(p => binName(p.command) === bin);
  const telemetryEnabled = cmd.telemetryEnabled ?? (preset?.presetId === 'claude-code');
  const env = { CLIDECK_SESSION_ID: id, CLIDECK_PORT: String(PORT), CLIDECK_URL: localUrl() };
  if (!preset?.telemetryEnv || !telemetryEnabled) return env;
  for (const [k, v] of Object.entries(preset.telemetryEnv)) {
    env[k] = v.replace('{{port}}', String(PORT));
  }
  // Tag events with our session ID so the receiver can map them
  const existing = process.env.OTEL_RESOURCE_ATTRIBUTES || '';
  env.OTEL_RESOURCE_ATTRIBUTES = (existing ? existing + ',' : '') + `clideck.session_id=${id}`;
  return env;
}

function isLightTheme(themeId) {
  const t = THEMES.find(th => th.id === themeId);
  if (!t) return false;
  const bg = t.theme.background;
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function spawnSession(id, cmd, parts, cwd, name, themeId, commandId, savedToken, projectId, cols, rows) {
  const telemetryEnv = buildTelemetryEnv(id, cmd);
  const colorEnv = isLightTheme(themeId) ? { COLORFGBG: '0;15' } : { COLORFGBG: '15;0' };
  let term;
  try {
    term = pty.spawn(parts[0], parts.slice(1), {
      name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd,
      env: { ...process.env, ...telemetryEnv, ...colorEnv },
    });
  } catch (e) {
    return e;
  }

  const sessionIdRe = cmd.sessionIdPattern ? new RegExp(cmd.sessionIdPattern, 'i') : null;
  const bin = binName(cmd.command);
  const preset = PRESETS.find(p => binName(p.command) === bin);
  const session = { name, themeId, commandId, cwd, pty: term, chunks: [], chunksSize: 0, sessionToken: savedToken || null, projectId: projectId || null, presetId: preset?.presetId || 'shell', working: undefined };
  sessions.set(id, session);
  transcript.setFinalizeOnIdle(id, ['claude-code', 'codex', 'gemini-cli', 'opencode', 'clideck-agent'].includes(session.presetId) ? session.presetId : null);

  // Always watch telemetry-backed agents so OTLP fallback matching can attach
  // early events to this session even when the agent omits clideck.session_id.
  // The receiver itself decides whether to surface a setup prompt.
  if (preset?.telemetryEnv) telemetry.watchSession(id, bin);
  if (preset?.bridge === 'opencode') opencodeBridge.watchSession(id, cwd);

  function injectRolePrompt() {
    if (!session.pendingRolePrompt) return;
    transcript.recordInjectedInput(id, session.pendingRolePrompt);
    term.write(session.pendingRolePrompt);
    setTimeout(() => term.write('\r'), 150);
    console.log(`Session ${id.slice(0, 8)}: injected role prompt`);
    delete session.pendingRolePrompt;
    delete session._rolePromptTimer;
  }

  term.onData((data) => {
    // Role prompts should be injected only when the agent is likely ready for
    // input. For Codex, use the first OTLP startup event instead of a blind
    // fixed startup delay; other agents keep the existing delayed path.
    if (session.pendingRolePrompt && !session._rolePromptTimer) {
      if (session.presetId === 'codex') {
        if (telemetry.hasEvents(id)) injectRolePrompt();
      } else {
        session._rolePromptTimer = setTimeout(() => {
          if (session.pendingRolePrompt) injectRolePrompt();
        }, 3000);
      }
    }
    session.chunks.push(data);
    session.chunksSize += data.length;
    while (session.chunksSize > MAX_BUFFER && session.chunks.length > 1) {
      session.chunksSize -= session.chunks.shift().length;
    }
    // Capture session ID from output
    if (sessionIdRe && !session.sessionToken) {
      const joined = session.chunks.join('');
      const match = joined.match(sessionIdRe) || joined.replace(ANSI_RE, '').match(sessionIdRe);
      if (match) {
        captureToken(id, match[1]);
        console.log(`Session ${id.slice(0, 8)}: captured token via output regex: ${match[1].slice(0, 12)}…`);
      }
    }
    activity.trackOut(id, data);
    transcript.trackOutput(id, data);
    plugins.notifyOutput(id, data);
    broadcast({ type: 'output', id, data });
  });

  term.onExit(() => {
    // Skip cleanup if this PTY was replaced by a restart
    const s = sessions.get(id);
    if (s?.pty !== term) return;
    activity.clear(id);
    telemetry.clear(id);
    opencodeBridge.clear(id);
    plugins.clearStatus(id);

    // Failed-resume auto-recovery. When the agent CLI can't find the
    // requested conversation (e.g. `claude --resume <stale-token>` prints
    // "No conversation found with session ID …" and exits within seconds)
    // we'd otherwise re-queue the same broken entry on the next pass through
    // the resumable-rehydrate branch below, trapping the user in a loop with
    // no way to delete it. Detection is duration-only — a successful resume
    // keeps the PTY alive for as long as the user keeps using it.
    const FAILED_RESUME_WINDOW_MS = 5000;
    const isFailedResume = s.resumedAt && (Date.now() - s.resumedAt) < FAILED_RESUME_WINDOW_MS;
    if (isFailedResume) {
      transcript.clear(id);
      sessions.delete(id);
      broadcast({ type: 'closed', id });
      // Quarantine the original stale entry: do NOT push it back into resumable.
      // Then start a fresh session in the same cwd so the user can keep working.
      try {
        const newId = crypto.randomUUID();
        const parts = parseCommand(cmd.command);
        const err = spawnSession(newId, cmd, parts, s.cwd, s.name, s.themeId, s.commandId, null, s.projectId);
        if (!err) {
          const presetId = PRESETS.find(p => binName(p.command) === binName(cmd.command))?.presetId || 'shell';
          broadcast({ type: 'created', id: newId, name: s.name, themeId: s.themeId, commandId: s.commandId, presetId, projectId: s.projectId || null, cwd: s.cwd || '' });
          broadcast({ type: 'session.recovered', originalId: id, newId, cwd: s.cwd, name: s.name });
          console.log(`Session ${id.slice(0, 8)}: failed resume — started fresh ${newId.slice(0, 8)} in ${s.cwd}`);
        } else {
          console.error(`Session ${id.slice(0, 8)}: failed-resume auto-recovery spawn failed: ${err.message}`);
        }
      } catch (e) {
        console.error('failed-resume recovery threw:', e.message);
      }
      // Ensure the resumable list reflects the removal even though we never
      // re-pushed — the original `resume()` call already filtered it out, but
      // late-arriving clients depend on the broadcast to refresh.
      broadcast({ type: 'sessions.resumable', list: getResumable() });
      return;
    }

    // If resumable and token captured, move to resumable list (keep transcript for search)
    moveToResumable(id, s, cmd);
  });

  return null;
}

// --- Create a new session ---

function create(msg, ws, cfg) {
  const id = crypto.randomUUID();
  const cmd = cfg.commands.find(c => c.id === msg.commandId)
    || cfg.commands[0]
    || { label: 'Shell', command: defaultShell };
  const parts = parseCommand(cmd.command);
  const cwd = resolveValidDir(msg.cwd || cmd.defaultPath || cfg.defaultPath);
  const themeId = msg.themeId || cfg.defaultTheme || 'default';
  const name = msg.name || cmd.label;

  const projectId = msg.projectId || null;
  const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId, msg.cols, msg.rows);
  if (err) {
    console.error('Failed to spawn pty:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  // If a role was selected, store identity on session and queue prompt injection
  if (msg.roleId) {
    const role = (cfg.roles || []).find(r => r.id === msg.roleId);
    if (role) {
      const s = sessions.get(id);
      if (s) {
        s.roleName = role.name;
        if (role.instructions) s.pendingRolePrompt = role.instructions;
      }
    }
  }

  const createdPresetId = PRESETS.find(p => binName(p.command) === binName(cmd.command))?.presetId || 'shell';
  const installId = msg.installId || undefined;
  broadcast({ type: 'created', id, name, themeId, commandId: cmd.id, presetId: createdPresetId, projectId, installId, cwd: cwd || '' });

  // Immediate setup notification if config not detected
  const bin = binName(cmd.command);
  const preset = PRESETS.find(p => binName(p.command) === bin);
  if (preset && (preset.telemetrySetup || preset.bridge) && !(cmd.telemetryEnabled && cmd.telemetryStatus?.ok)) {
    broadcast({ type: 'session.needsSetup', id });
  }
}

// --- Programmatic session creation (for plugins / internal use) ---

function createProgrammatic(opts, cfg) {
  const id = crypto.randomUUID();
  let cmd;
  if (opts.presetId) cmd = cfg.commands.find(c => c.presetId === opts.presetId);
  else if (opts.commandId) cmd = cfg.commands.find(c => c.id === opts.commandId);
  if (!cmd) return { error: 'Command not found' };

  const parts = parseCommand(cmd.command);
  const cwd = resolveValidDir(opts.cwd || cmd.defaultPath || cfg.defaultPath);
  const themeId = opts.themeId || cfg.defaultTheme || 'default';
  const name = opts.name || cmd.label;
  const projectId = opts.projectId || null;

  const err = spawnSession(id, cmd, parts, cwd, name, themeId, cmd.id, null, projectId);
  if (err) return { error: err.message };

  const s = sessions.get(id);
  if (s && opts.roleName) s.roleName = opts.roleName;
  if (s && opts.ephemeral) s.ephemeral = true;

  const presetId = PRESETS.find(p => binName(p.command) === binName(cmd.command))?.presetId || 'shell';
  broadcast({ type: 'created', id, name, themeId, commandId: cmd.id, presetId, projectId, cwd: cwd || '' });
  return { id };
}

// --- Resume a persisted session ---

function resume(msg, ws, cfg) {
  const saved = resumable.find(s => s.id === msg.id);
  if (!saved) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found in resumable list' }));
    return;
  }

  const cmd = cfg.commands.find(c => c.id === saved.commandId);
  if (!cmd || !cmd.canResume || !cmd.resumeCommand) {
    ws.send(JSON.stringify({ type: 'error', message: 'Command does not support resume' }));
    return;
  }

  // Build the resume command, substituting {{sessionId}} if present
  let resumeStr = cmd.resumeCommand;
  if (resumeStr.includes('{{sessionId}}')) {
    if (!saved.sessionToken) {
      ws.send(JSON.stringify({ type: 'error', message: 'No session ID captured — cannot resume' }));
      return;
    }
    resumeStr = resumeStr.replace('{{sessionId}}', saved.sessionToken);
  }

  const parts = parseCommand(resumeStr);
  const cwd = resolveValidDir(saved.cwd || cfg.defaultPath);
  const id = saved.id;

  const err = spawnSession(id, cmd, parts, cwd, saved.name, saved.themeId || saved.profileId || 'default', saved.commandId, saved.sessionToken, saved.projectId);
  if (err) {
    console.error('Failed to resume pty:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    return;
  }

  const s = sessions.get(id);
  if (s) {
    if (saved.muted) s.muted = true;
    if (saved.roleName) s.roleName = saved.roleName;
    // Mark the spawn moment so onExit can distinguish a failed resume
    // (PTY exits within seconds because the underlying conversation is
    // gone) from a successful one. Cleared once the session lives past
    // the detection window, see below.
    s.resumedAt = Date.now();
    setTimeout(() => { if (sessions.get(id) === s) s.resumedAt = null; }, 5000);
  }

  // Remove from resumable list and notify all clients
  resumable = resumable.filter(s => s.id !== id);
  broadcast({ type: 'sessions.resumable', list: getResumable(cfg) });

  const resumePresetId = PRESETS.find(p => binName(p.command) === binName(cmd.command))?.presetId || saved.presetId || 'shell';
  broadcast({ type: 'created', id, name: saved.name, themeId: saved.themeId || saved.profileId || 'default', commandId: saved.commandId, presetId: resumePresetId, projectId: saved.projectId || null, muted: !!saved.muted, resumed: true, lastPreview: saved.lastPreview || '', cwd: saved.cwd || '', hasToken: !!saved.sessionToken });
}

// --- Standard session operations ---

function writeSessionInput(id, data) {
  transcript.trackInput(id, data);
  sessions.get(id)?.pty.write(data);
}

function input(msg) {
  const data = plugins.transformInput(msg.id, msg.data);
  activity.trackIn(msg.id, data.length);
  const s = sessions.get(msg.id);
  if (!s) return;
  // Menu choice selected → back to working (Enter or digit keys only)
  if (s._menuKey && !s.working && (data === '\r' || /^[1-9]$/.test(data))) {
    // Approval/denial menus can leave a transient tool line as the latest
    // parsed candidate; clear it before the next real reply starts.
    transcript.clearAgentCandidate(msg.id);
    s.pty.write(data);
    // Autopilot may need to retry the same approval menu if the first Enter
    // does not actually take, so only suppress same-menu re-detection for
    // manual flows.
    if (!plugins.shouldAutoApproveMenu(msg.id)) s._resolvedMenuKey = s._menuKey;
    if (s._menuActiveVersion) s._menuConsumedVersion = s._menuActiveVersion;
    s._menuKey = '';
    broadcast({ type: 'session.menu', id: msg.id, choices: [] });
    broadcast({ type: 'session.status', id: msg.id, working: true, source: 'menu-input' });
    return;
  }
  writeSessionInput(msg.id, data);
  if (data === '\x1b' && s.working) {
    transcript.clearAgentCandidate(msg.id);
    broadcast({ type: 'session.status', id: msg.id, working: false, source: 'esc' });
  }
}
function resize(msg) { sessions.get(msg.id)?.pty.resize(msg.cols, msg.rows); }

function rename(msg) {
  const s = sessions.get(msg.id);
  if (s) { s.name = msg.name; broadcast({ type: 'renamed', id: msg.id, name: msg.name }); }
}

function setTheme(id, themeId) {
  const s = sessions.get(id);
  if (s) { s.themeId = themeId; return true; }
  return false;
}

function setMute(id, muted) {
  const s = sessions.get(id);
  if (s) { s.muted = !!muted; return true; }
  return false;
}

function close(msg, cfg) {
  const s = sessions.get(msg.id);
  if (s) { s.pty.kill(); telemetry.clear(msg.id); transcript.clear(msg.id); plugins.clearStatus(msg.id); sessions.delete(msg.id); broadcast({ type: 'closed', id: msg.id }); }
  // Also remove from resumable list if present
  const before = resumable.length;
  resumable = resumable.filter(r => r.id !== msg.id);
  if (resumable.length !== before) broadcast({ type: 'sessions.resumable', list: getResumable(cfg) });
}

// Shared transition: a live session ends and (if eligible) moves into
// the resumable list. Called from two places — the natural-exit path
// inside spawnSession's `term.onExit` handler, and the user-triggered
// pause() handler below. Keeping both call sites on this one helper
// is load-bearing per the SPEC: the user's "Pause" gesture MUST
// produce the same on-disk shape and broadcast pattern as a natural
// PTY exit, so a paused session is indistinguishable from one that
// quit on its own.
//
// `reason` is an optional metadata tag stamped onto the `closed`
// broadcast (the pause path uses `reason: 'paused'` so the client
// can surface a "Session paused" toast instead of the silent
// natural-exit teardown).
function moveToResumable(id, s, cmd, { reason, cfg } = {}) {
  const closedFrame = reason ? { type: 'closed', id, reason } : { type: 'closed', id };
  const eligible = !s.ephemeral && cmd?.canResume && cmd?.resumeCommand && s.sessionToken;
  if (eligible) {
    resumable.push({
      id, name: s.name, commandId: s.commandId, presetId: s.presetId || 'shell', cwd: s.cwd,
      themeId: s.themeId, sessionToken: s.sessionToken, projectId: s.projectId, muted: !!s.muted,
      roleName: s.roleName || null,
      lastPreview: s.lastPreview || '', lastActivityAt: s.lastActivityAt || null,
      savedAt: new Date().toISOString(),
    });
    console.log(`Session ${id.slice(0, 8)}: moved to resumable (token: ${s.sessionToken.slice(0, 12)}…)${reason ? ` reason=${reason}` : ''}`);
  } else {
    transcript.clear(id);
  }
  sessions.delete(id);
  broadcast(closedFrame);
  if (!s.ephemeral && cmd?.canResume && s.sessionToken) {
    broadcast({ type: 'sessions.resumable', list: getResumable(cfg) });
  }
  return eligible;
}

// User-triggered pause — counterpart of the natural-exit transition.
// Ends the live PTY, persists the captured sessionToken + transcript
// (via moveToResumable), and moves the row from active → Previous
// Sessions. Refuses cleanly when the session has no captured token or
// the command can't resume — silently degrading to delete would lose
// user data, which the SPEC explicitly forbids.
function pause(msg, ws, cfg) {
  const s = sessions.get(msg?.id);
  if (!s) return false;
  const cmd = (cfg?.commands || []).find(c => c.id === s.commandId);
  if (!cmd || !cmd.canResume || !cmd.resumeCommand || !s.sessionToken) {
    const why = !cmd
      ? 'Command not found.'
      : !cmd.canResume || !cmd.resumeCommand
        ? 'This session type does not support resume — close it instead.'
        : 'Cannot pause yet — the agent has not emitted a resumable session ID.';
    try {
      ws?.send(JSON.stringify({
        type: 'error',
        message: why,
        context: 'session.pause',
        id: msg.id,
      }));
    } catch {}
    return false;
  }

  try { s.pty.kill(); } catch (e) { console.error(`[session.pause] pty.kill threw for ${msg.id}:`, e.message); }
  telemetry.clear?.(msg.id);
  plugins.clearStatus?.(msg.id);
  return moveToResumable(msg.id, s, cmd, { reason: 'paused', cfg });
}

// Restart a live session's PTY with updated env (e.g. after polarity flip).
// Uses resume command if available, otherwise re-launches the original command.
function restart(msg, ws, cfg) {
  const id = msg.id;
  // console.log('[restart] received', { id, themeId: msg.themeId });
  const s = sessions.get(id);
  if (!s) { ws.send(JSON.stringify({ type: 'session.restarted', id, error: 'not found' })); return; }
  const cmd = cfg.commands.find(c => c.id === s.commandId);
  if (!cmd) { ws.send(JSON.stringify({ type: 'session.restarted', id, error: 'command missing' })); return; }

  const themeId = msg.themeId || s.themeId;
  const canResume = cmd.canResume && cmd.resumeCommand && s.sessionToken;

  let parts;
  if (canResume) {
    parts = parseCommand(cmd.resumeCommand.replace('{{sessionId}}', s.sessionToken));
  } else {
    parts = parseCommand(cmd.command);
  }

  const savedToken = s.sessionToken;
  const { name, cwd, commandId, projectId, roleName, muted, lastPreview, lastActivityAt } = s;

  activity.clear(id);
  telemetry.clear(id);
  opencodeBridge.clear(id);
  transcript.clear(id);

  s.pty.kill();
  sessions.delete(id);

  const err = spawnSession(id, cmd, parts, cwd, name, themeId, commandId, savedToken, projectId, msg.cols, msg.rows);
  if (err) {
    console.error('[restart] spawn failed:', err.message);
    broadcast({ type: 'session.restarted', id, error: err.message });
    return;
  }

  const next = sessions.get(id);
  if (next) {
    next.roleName = roleName || null;
    next.muted = !!muted;
    next.lastPreview = lastPreview || '';
    next.lastActivityAt = lastActivityAt || null;
  }

  broadcast({ type: 'session.restarted', id, resumed: !!canResume });
}

function list() {
  return [...sessions].map(([id, s]) => ({
    id, name: s.name, themeId: s.themeId, commandId: s.commandId, presetId: s.presetId || 'shell', projectId: s.projectId, muted: !!s.muted,
    roleName: s.roleName || null,
    cwd: s.cwd || '',
    // Last preview text for sidebar display on reconnect
    lastPreview: s.lastPreview || '', lastActivityAt: s.lastActivityAt || null,
    // Whether the underlying agent has emitted a session token yet.
    // Drives the "Pause" menu item's enable state — pause without a
    // token would silently degrade to delete, which is unacceptable.
    hasToken: !!s.sessionToken,
    menu: s._menuKey ? JSON.parse(s._menuKey) : undefined,
  }));
}

// Store the latest preview text from the client (persisted by auto-save)
function setPreview(id, text, timestamp) {
  const s = sessions.get(id);
  if (!s) return false;
  s.lastPreview = (text || '').slice(0, 200);
  s.lastActivityAt = timestamp || new Date().toISOString();
  return true;
}

// Centralised session-token capture. Five different code paths can
// learn a session's resumable token (output regex, Codex hook, Claude
// hook, Gemini hook, telemetry receiver, OpenCode plugin bridge); they
// all funnel through here so the `session.token` broadcast fires
// EXACTLY once — at the first-set edge — regardless of which path
// observed it first.
//
// Returns true if the capture was the first set (broadcast was sent),
// false otherwise. Callers that gate by `!s.sessionToken` can stop
// doing that — this helper preserves the same semantic via wasUnset.
function captureToken(id, sessionToken) {
  const s = sessions.get(id);
  if (!s || !sessionToken) return false;
  const wasUnset = !s.sessionToken;
  s.sessionToken = sessionToken;
  if (wasUnset) {
    broadcast({ type: 'session.token', id, hasToken: true });
  }
  return wasUnset;
}

function setProject(id, projectId) {
  const s = sessions.get(id);
  if (s) { s.projectId = projectId || null; return true; }
  return false;
}

// Reorder the in-memory sessions Map and resumable array to match the
// caller's id sequence. Anything in `ids` that doesn't exist in either
// store is silently dropped; anything present in the stores but missing
// from `ids` is appended at the end (defensive — keeps unknown entries
// alive rather than vanishing them on a partial-sequence reorder).
//
// Persistence is automatic: saveSessions iterates the Map and resumable
// array in iteration order, so a reorder that lands here is captured by
// the 30s auto-save and by shutdown.
function reorderSessions(ids, cfg) {
  if (!Array.isArray(ids) || ids.length === 0) return false;

  // Map reorder — build a new Map in the requested order, then append
  // any remaining entries that the caller didn't mention.
  const seen = new Set();
  const rebuiltLive = new Map();
  for (const id of ids) {
    if (sessions.has(id) && !seen.has(id)) {
      rebuiltLive.set(id, sessions.get(id));
      seen.add(id);
    }
  }
  for (const [id, entry] of sessions) {
    if (!seen.has(id)) rebuiltLive.set(id, entry);
  }
  sessions.clear();
  for (const [id, entry] of rebuiltLive) sessions.set(id, entry);

  // Resumable reorder — same shape: respect the caller's order for ids
  // it knows, then keep any unmentioned dormant rows at the end.
  const resumeIdx = new Map(resumable.map((r, i) => [r.id, i]));
  const seenR = new Set();
  const rebuiltDormant = [];
  for (const id of ids) {
    if (resumeIdx.has(id) && !seenR.has(id)) {
      rebuiltDormant.push(resumable[resumeIdx.get(id)]);
      seenR.add(id);
    }
  }
  for (const r of resumable) {
    if (!seenR.has(r.id)) rebuiltDormant.push(r);
  }
  resumable = rebuiltDormant;

  try { saveSessions(cfg || { commands: [] }); } catch (e) {
    console.error('[session.reorder] persist failed:', e.message);
  }
  broadcast({ type: 'sessions.reorder', ids });
  return true;
}

// Rename a dormant ("resumable") session by id. Mutates in-memory entry,
// persists via saveSessions(), and broadcasts the updated list. Used by the
// per-row Rename action in "Previous Sessions" — the only path the user has
// to clean up stale entries beyond the existing bulk-clear.
function renameResumable(msg, cfg) {
  const idx = resumable.findIndex(r => r.id === msg?.id);
  if (idx < 0) return false;
  const name = String(msg?.name || '').trim().slice(0, 200);
  if (!name) return false;
  resumable[idx] = { ...resumable[idx], name };
  try { saveSessions(cfg || { commands: [] }); } catch (e) {
    console.error('[resumable.rename] persist failed:', e.message);
  }
  broadcast({ type: 'sessions.resumable', list: getResumable(cfg) });
  return true;
}

// Test-only hooks. Guarded so production cannot reach in and corrupt state.
function __setResumableForTest(arr) {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('__setResumableForTest is test-only');
  }
  resumable = Array.isArray(arr) ? arr.slice() : [];
}
function __getResumableForTest() {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('__getResumableForTest is test-only');
  }
  return resumable;
}
function __setReplayableForTest(arr) {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('__setReplayableForTest is test-only');
  }
  replayable = Array.isArray(arr) ? arr.slice() : [];
}
function __getReplayableForTest() {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('__getReplayableForTest is test-only');
  }
  return replayable;
}

function getResumable(cfg) {
  if (!cfg) return resumable;
  return resumable.map(s => {
    if (s.presetId) return s;
    const cmd = (cfg.commands || []).find(c => c.id === s.commandId);
    if (!cmd) return { ...s, presetId: 'shell' };
    const preset = PRESETS.find(p => binName(p.command) === binName(cmd.command));
    return { ...s, presetId: preset?.presetId || 'shell' };
  });
}

function sendBuffers(ws) {
  for (const [id, s] of sessions) {
    if (['claude-code', 'codex', 'gemini-cli', 'opencode', 'clideck-agent'].includes(s.presetId) && !s.working) {
      const text = transcript.getReplayText(id, s.presetId);
      if (text) {
        ws.send(JSON.stringify({ type: 'session.history', id, text, replay: true }));
        continue;
      }
    }
    if (s.chunks.length) {
      const data = s.chunks.join('');
      ws.send(JSON.stringify({ type: 'output', id, data, replay: true }));
    }
  }
}

// --- Persistence: save on shutdown, load on startup ---

function saveSessions(cfg) {
  // Persist BOTH tracks into one flat sessions.json array (Shape 1, D-02):
  //   resumable  — agent CLIs with --resume + token.
  //   replayable — plain shells with the explicit canReplay capability,
  //                tagged `replayable: true` on disk.
  // Partitioning is driven by EXPLICIT capability flags (D-01): a session
  // whose cmd has NEITHER canResume+resumeCommand NOR canReplay is persisted
  // to NEITHER bucket — no silent replay fallthrough.
  let skippedNoToken = 0;
  const liveResumable = [];
  const liveReplayable = [];
  for (const [id, s] of sessions) {
    if (s.ephemeral) continue;
    const cmd = cfg.commands.find(c => c.id === s.commandId);
    if (!cmd) continue;
    if (cmd.canResume && cmd.resumeCommand) {
      // Resumable path — needs a session token when the resume command
      // templates {{sessionId}}.
      if (cmd.resumeCommand.includes('{{sessionId}}') && !s.sessionToken) {
        skippedNoToken++;
        continue;
      }
      liveResumable.push({
        id, name: s.name, commandId: s.commandId, presetId: s.presetId || 'shell', cwd: s.cwd,
        themeId: s.themeId, sessionToken: s.sessionToken, projectId: s.projectId, muted: !!s.muted,
        roleName: s.roleName || null,
        lastPreview: s.lastPreview || '', lastActivityAt: s.lastActivityAt || null,
        savedAt: new Date().toISOString(),
      });
    } else if (cmd.canReplay) {
      // Replayable path — plain shells. Persisted so the tab survives a
      // server restart; rehydrated as a fresh PTY in the saved cwd on next
      // boot. No token, no resume command, no chat history replay.
      liveReplayable.push({
        id, name: s.name, commandId: s.commandId, presetId: s.presetId || 'shell', cwd: s.cwd,
        themeId: s.themeId, projectId: s.projectId, muted: !!s.muted,
        roleName: s.roleName || null,
        lastPreview: s.lastPreview || '', lastActivityAt: s.lastActivityAt || null,
        savedAt: new Date().toISOString(),
        replayable: true,
      });
    }
    // else: neither capability — not persisted (D-01, no else-fallthrough).
  }

  // Merge each track with still-pending entries from its module array (a
  // resumable a user never resumed, or a replayable whose rehydrate failed
  // and is still on disk).
  const liveResumableIds = new Set(liveResumable.map(s => s.id));
  const pendingResumable = resumable.filter(s => !liveResumableIds.has(s.id));
  const liveReplayableIds = new Set(liveReplayable.map(s => s.id));
  const pendingReplayable = replayable.filter(s => !liveReplayableIds.has(s.id));

  const resumableArr = [...liveResumable, ...pendingResumable];
  const replayableArr = [...liveReplayable, ...pendingReplayable];
  const data = [...resumableArr, ...replayableArr];

  writeFileSync(SAVED_PATH, JSON.stringify(data, null, 2));
  if (skippedNoToken > 0 && skippedNoToken !== lastSkippedNoTokenWarn) {
    console.warn(`Skipped ${skippedNoToken} resumable session(s): no session token captured`);
  }
  lastSkippedNoTokenWarn = skippedNoToken || null;
  return data.length;
}

function loadSessions() {
  if (!existsSync(SAVED_PATH)) return;
  try {
    const all = JSON.parse(readFileSync(SAVED_PATH, 'utf8'));
    // Partition on the `replayable` discriminator. Entries without the flag
    // (including all pre-fix sessions.json files) land in resumable exactly
    // as before — zero-downtime upgrade (AC 4).
    resumable = all.filter(e => !e.replayable);
    replayable = all.filter(e => e.replayable);
    console.log(`Loaded ${resumable.length} resumable + ${replayable.length} replayable session(s)`);
  } catch {
    resumable = [];
    replayable = [];
  }
}

let autoSaveInterval = null;
let getConfigFn = null;
let lastSkippedNoTokenWarn = null;

function startAutoSave(getConfig) {
  getConfigFn = getConfig;
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(() => {
    const cfg = getConfigFn?.();
    if (!cfg) return;
    try {
      const count = saveSessions(cfg);
      if (count > 0) broadcast({ type: 'sessions.saved' });
    } catch (e) {
      console.error('Auto-save failed:', e.message);
    }
  }, 30000);
}

async function shutdown(cfg) {
  clearInterval(autoSaveInterval);
  saveSessions(cfg);
  // Diagnostic: the per-PTY kill loop is the real worst-case hang on Windows
  // ConPTY (per Phase 13 finding). Log the count + total loop time so the
  // "where did shutdown spend its time" question is answerable (PTYs vs
  // saveSessions) without per-PTY noise. The setImmediate yield after each
  // kill returns control to the event loop so the caller's heartbeat/watchdog
  // (server-side onShutdown) can actually fire DURING this loop.
  const n = sessions.size;
  const t0 = Date.now();
  process.stdout.write(`[clideck] killing ${n} PTYs… `);
  for (const [, s] of sessions) {
    try { s.pty.kill(); } catch {}
    await new Promise(r => setImmediate(r));
  }
  process.stdout.write(`done (${Date.now() - t0}ms)\n`);
}

// Rehydrate plain-shell tabs that were persisted via the replayable track.
// Called once from server.js after loadSessions(), before transcript.init().
// Each replayable becomes a fresh PTY in its saved cwd — no token, no chat
// replay, no agent CLI involvement. The live sessions Map gets the new entry
// just like a user-initiated tab; sessions.list() surfaces it to the first
// connecting WebSocket.
function rehydrateReplayable(cfg) {
  if (!cfg || !Array.isArray(cfg.commands)) return 0;
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // Cap the spawn loop (D-03 / T-14-DoS). Process at most the first
  // MAX_REPLAY_REHYDRATE entries; if more were persisted, drop the overflow
  // with a single WARN naming the dropped count.
  let toProcess = replayable;
  if (replayable.length > MAX_REPLAY_REHYDRATE) {
    const dropped = replayable.length - MAX_REPLAY_REHYDRATE;
    console.warn(`[rehydrate] ${replayable.length} replayable session(s) exceeds cap ${MAX_REPLAY_REHYDRATE}; dropping ${dropped}`);
    toProcess = replayable.slice(0, MAX_REPLAY_REHYDRATE);
  }

  let spawned = 0;
  for (const entry of toProcess) {
    const cmd = cfg.commands.find(c => c.id === entry.commandId);
    if (!cmd) {
      console.warn(`[rehydrate] skipping ${entry.id?.slice(0, 8)} — commandId '${entry.commandId}' not in config`);
      continue;
    }
    // Validate cwd; fall back to $HOME if the saved path no longer exists.
    // Threat T-14-cwd: a corrupted sessions.json could carry a bogus cwd;
    // spawning into it would either fail or land in an attacker-prepared
    // dir. Fail safe to $HOME (AC 5).
    let cwd = entry.cwd;
    if (cwd && !existsSync(cwd)) {
      console.warn(`[rehydrate] ${entry.id?.slice(0, 8)} cwd '${cwd}' does not exist; falling back to $HOME`);
      cwd = home;
    }
    const result = createProgrammatic({
      commandId: entry.commandId,
      cwd,
      themeId: entry.themeId,
      projectId: entry.projectId,
      name: entry.name,
    }, cfg);
    if (result?.error) {
      console.warn(`[rehydrate] ${entry.id?.slice(0, 8)} failed: ${result.error}`);
      continue;
    }
    spawned++;
  }
  if (replayable.length > 0) {
    console.log(`Rehydrated ${spawned}/${replayable.length} replayable session(s)`);
  }
  // Drain — the live sessions Map is now the single source of truth for
  // these entries. The next saveSessions cycle re-derives the replayable
  // persistence from the live Map (load-bearing: leaving stale entries here
  // would double them on the next save).
  replayable = [];
  return spawned;
}

module.exports = {
  clients, broadcast, closeDevice, addBroadcastListener, getSessions: () => sessions,
  create, createProgrammatic, resume, restart, input, resize, rename, setTheme, setMute, setProject, setPreview, close, pause, captureToken,
  list, getResumable, renameResumable, reorderSessions, sendBuffers,
  loadSessions, startAutoSave, shutdown, rehydrateReplayable,
  __setResumableForTest, __getResumableForTest,
  __setReplayableForTest, __getReplayableForTest,
};
