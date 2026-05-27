function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return '';
  const value = process.argv[idx + 1];
  return value && !value.startsWith('-') ? value : '';
}

function parsePort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

const PORT = parsePort(argValue('--port'))
  || parsePort(process.env.CLIDECK_PORT)
  || parsePort(process.env.PORT)
  || 4000;

const HOST = (() => {
  const idx = process.argv.indexOf('--host');
  const value = idx >= 0 ? process.argv[idx + 1] : '';
  if (idx < 0) return '127.0.0.1';
  return value && !value.startsWith('-') ? value : '0.0.0.0';
})();

function localUrl(host = HOST, port = PORT) {
  return `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
}

// Fresh per-process identifier. Surfaced to clients in the `config`
// broadcast and logged at boot — a stable handle for "which clideck
// process am I talking to", useful when diagnosing reconnects.
const BOOT_ID = require('crypto').randomUUID();

module.exports = { PORT, HOST, localUrl, BOOT_ID };
