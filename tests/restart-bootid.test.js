// Integration test for the in-UI restart flow.
//
// Spawns a real clideck on a sandbox port with an isolated CLIDECK_DATA_DIR,
// captures the BOOT_ID from the initial `config` broadcast, sends a
// `server.restart` message, then reconnects and asserts a different BOOT_ID
// answers — i.e. a genuinely different process is on the port. Reproduces
// the EADDRINUSE race that broke the first cut of 7f33cbf and pins the
// retry-listen + bootId handshake that fix it.
//
// Uses a high random port to avoid colliding with a real clideck on :4000.
// Cleans up by killing whatever process owns the sandbox port at teardown
// (the restart spawns a detached child whose PID we don't track directly).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const WebSocket = requireCjs('ws');

const PORT = 4090 + Math.floor(Math.random() * 800); // 4090..4889
const REPO_ROOT = join(import.meta.dirname, '..');
const BIN = join(REPO_ROOT, 'bin', 'clideck.js');

let dataDir;
let parentProc;

function killPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const pids = new Set();
      const needle = `:${port}`;
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(needle) || !line.includes('LISTENING')) continue;
        const m = line.trim().match(/(\d+)\s*$/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch { /* noop */ }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      for (const pid of out.split(/\s+/).filter(Boolean)) {
        try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); } catch { /* noop */ }
      }
    }
  } catch { /* port already free */ }
}

async function waitForOpen(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), timeoutMs);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', e => { clearTimeout(t); reject(e); });
  });
}

async function nextConfig(ws, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('config timeout')), timeoutMs);
    const onMsg = data => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'config') {
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(msg.config);
      }
    };
    ws.on('message', onMsg);
  });
}

async function connectWithRetry(port, totalMs = 10000) {
  const deadline = Date.now() + totalMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await waitForOpen(ws, 2000);
      return ws;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error(`failed to connect within ${totalMs}ms: ${lastErr?.message}`);
}

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'clideck-restart-test-'));
  parentProc = spawn(process.execPath, [BIN, '--port', String(PORT)], {
    env: { ...process.env, CLIDECK_DATA_DIR: dataDir, CLIDECK_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  parentProc.stdout?.on('data', () => { /* drain */ });
  parentProc.stderr?.on('data', () => { /* drain */ });
}, 15000);

afterAll(async () => {
  killPidsOnPort(PORT);
  try { parentProc?.kill('SIGKILL'); } catch { /* noop */ }
  // Brief settle so file handles release before rmSync on Windows.
  await new Promise(r => setTimeout(r, 250));
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
}, 10000);

describe('in-UI restart bootId handshake', () => {
  it('a different process answers after restart, identified by a fresh bootId', async () => {
    const ws1 = await connectWithRetry(PORT, 10000);
    const cfg1 = await nextConfig(ws1, 5000);
    expect(typeof cfg1.bootId).toBe('string');
    expect(cfg1.bootId.length).toBeGreaterThan(0);

    const restartSeen = new Promise(resolve => {
      ws1.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'server.restarting') resolve();
        } catch { /* noop */ }
      });
    });

    ws1.send(JSON.stringify({ type: 'server.restart' }));
    await Promise.race([
      restartSeen,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no server.restarting broadcast')), 3000)),
    ]);

    // Wait for the original socket to actually close before we reconnect,
    // otherwise we may catch the parent's listener on its way down.
    await new Promise(resolve => {
      if (ws1.readyState === ws1.CLOSED) return resolve();
      ws1.once('close', () => resolve());
      setTimeout(resolve, 2000);
    });

    const ws2 = await connectWithRetry(PORT, 15000);
    const cfg2 = await nextConfig(ws2, 5000);
    expect(typeof cfg2.bootId).toBe('string');
    expect(cfg2.bootId).not.toBe(cfg1.bootId);

    try { ws2.close(); } catch { /* noop */ }
  }, 30000);
});
