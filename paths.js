const { join } = require('path');
const { mkdirSync, existsSync, copyFileSync, cpSync, readdirSync } = require('fs');
const os = require('os');

const DATA_DIR = process.env.CLIDECK_DATA_DIR || join(os.homedir(), '.clideck');
const LEGACY_DIR = __dirname;
const OLD_DATA_DIR = join(os.homedir(), '.termix');
mkdirSync(DATA_DIR, { recursive: true });

// Skip legacy migrations when caller specified a custom data dir (tests).
const IS_DEFAULT_DATA_DIR = !process.env.CLIDECK_DATA_DIR;

// Migrate from ~/.termix/ to ~/.clideck/ (one-time rename migration)
if (IS_DEFAULT_DATA_DIR && existsSync(OLD_DATA_DIR)) {
  for (const file of readdirSync(OLD_DATA_DIR, { withFileTypes: true })) {
    const src = join(OLD_DATA_DIR, file.name);
    const dest = join(DATA_DIR, file.name);
    if (existsSync(dest)) continue;
    try { cpSync(src, dest, { recursive: true }); } catch {}
  }
}

// Migrate legacy files from project root to ~/.clideck/ (one-time on upgrade)
const MIGRATE_FILES = IS_DEFAULT_DATA_DIR ? ['config.json', 'sessions.json', 'custom-themes.json'] : [];
for (const file of MIGRATE_FILES) {
  const src = join(LEGACY_DIR, file);
  const dest = join(DATA_DIR, file);
  if (existsSync(src) && !existsSync(dest)) {
    try { copyFileSync(src, dest); } catch {}
  }
}
// Migrate transcript JSONL files
const legacyTranscripts = join(LEGACY_DIR, 'data', 'transcripts');
const newTranscripts = join(DATA_DIR, 'transcripts');
if (IS_DEFAULT_DATA_DIR && existsSync(legacyTranscripts) && !existsSync(newTranscripts)) {
  mkdirSync(newTranscripts, { recursive: true });
  try {
    for (const f of readdirSync(legacyTranscripts)) {
      copyFileSync(join(legacyTranscripts, f), join(newTranscripts, f));
    }
  } catch {}
}

module.exports = { DATA_DIR };
