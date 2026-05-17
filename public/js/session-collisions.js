// Detect whether a session (active or dormant) already lives in a given
// working directory. Used by the bulk-import modal (to default-uncheck
// colliding rows and label them) and by the single-session creator (to
// warn-then-confirm before spawning a second session in the same folder).
//
// Lives in its own module so both app.js and creator.js can import it
// without creating a circular dependency through app.js.

import { state } from './state.js';

// Normalize a filesystem path for comparison: unify separators, strip the
// trailing slash, lower-case on Windows. Mirrors the comparison the server
// uses inside `dirs.listSubdirs` so a folder picked there compares equal
// to the cwd we received when a session was spawned via the same path.
export function normalizeCwd(p) {
  if (!p) return '';
  let s = String(p).replace(/\//g, '\\').replace(/\\+$/, '');
  if (typeof navigator !== 'undefined' && /win/i.test(navigator.platform || '')) {
    s = s.toLowerCase();
  }
  return s;
}

// Returns an array of `{ kind, id, name }` for any session (active in
// state.terms or dormant in state.resumable) whose cwd matches the
// supplied path. Empty array = no collision.
export function sessionsInCwd(cwd) {
  const target = normalizeCwd(cwd);
  if (!target) return [];
  const out = [];
  for (const [id, entry] of state.terms) {
    if (normalizeCwd(entry.cwd) === target) {
      const nameEl = document.querySelector(`.group[data-id="${id}"] .name`);
      out.push({ kind: 'active', id, name: nameEl?.textContent || id.slice(0, 8) });
    }
  }
  for (const s of state.resumable || []) {
    if (normalizeCwd(s.cwd) === target) {
      out.push({ kind: 'dormant', id: s.id, name: s.name });
    }
  }
  return out;
}
