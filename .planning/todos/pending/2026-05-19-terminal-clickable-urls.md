---
created: 2026-05-19T11:52:00Z
title: Make URLs in terminal output Ctrl+clickable to open in a new tab
area: ui
phase_hint: 2026-05-19-terminal-ux
files:
  - public/js/terminals.js:520
  - public/index.html
  - package.json
---

## Problem

When agents, tools, or shells emit a URL into a terminal, the user
currently has no way to act on it except:

1. Select the URL text with the mouse
2. Right-click → Copy
3. Switch to a browser
4. Paste into the address bar

That's four steps for what should be one. Modern terminals (Windows
Terminal, iTerm2, VS Code) detect URLs in output and let the user
**Ctrl+click** (or Cmd+click on Mac) to open in a new browser tab.
clideck should do the same.

## Solution

Use `@xterm/addon-web-links` — the official xterm.js addon for this
exact purpose. clideck already runs `@xterm/xterm@^6.0.0` and
`@xterm/addon-fit@^0.11.0` (see `package.json`), so this is a natural
extension of the same stack.

### Steps

1. **Add the dep.** `npm install @xterm/addon-web-links`. Confirm the
   version is compatible with `@xterm/xterm@^6.0.0` (the 0.11.x line
   targets xterm 6 at the time of writing).

2. **Vendor the script.** clideck ships xterm.js as a vendored
   `/xterm.js` file (see `public/index.html`'s
   `<script src="/xterm.js">`). Match that pattern — either copy the
   built addon into `public/xterm-addon-web-links.js` and add a
   `<script>` tag, or move to ES module imports if that's already
   planned. Pick whichever matches the existing pattern of how
   `@xterm/addon-fit` is loaded.

3. **Register per-terminal.** In `public/js/terminals.js:520` (where
   `state.terms.set(id, …)` is called immediately after `term`
   construction), do:

   ```js
   const webLinks = new WebLinksAddon((event, uri) => {
     if (!(event.ctrlKey || event.metaKey)) return;
     if (!/^https?:\/\//i.test(uri)) return;
     window.open(uri, '_blank', 'noopener,noreferrer');
   });
   term.loadAddon(webLinks);
   ```

   Store the addon instance on the entry so `removeTerminal`
   (terminals.js:528) can dispose it cleanly via the term's own
   `dispose()` (xterm clears addons on dispose, but holding a ref
   makes the dependency explicit).

4. **Cursor / hover affordance.** The addon supports a `hover`
   callback you can use to add a class to the row, or rely on the
   addon's default underline-on-hover behavior. Keep it minimal —
   underline + pointer cursor is enough. Make sure the hover style
   adapts to the current xterm theme (light vs dark) so the URL
   stays readable.

5. **Don't fight the selection gesture.** Plain click should still
   start a text selection (the user might want to copy the URL as
   text rather than open it). The Ctrl/Cmd modifier check in the
   activate callback handles this — the addon by default opens on
   plain click, which **must** be overridden as above to require
   the modifier. This is the whole point of Lance's request.

## Security

- **Force `noopener,noreferrer`** on `window.open`. Terminal output
  is untrusted text; without `noopener`, a malicious URL could
  manipulate `window.opener`. With `noreferrer`, we also stop the
  Referer header from leaking the clideck URL to the destination.
- **Restrict to http(s)**. Reject `javascript:`, `file:`, `data:`,
  and other schemes. The regex above is a minimum; the addon ships
  a sane default URL regex that already excludes most of these, but
  the activate callback is the place to enforce it definitively.
- **No auto-open.** Never open a URL without an explicit user
  gesture (the Ctrl+click).

## Out of scope

- Auto-detection of non-URL patterns (file paths, IPs, IDs that
  look like ticket numbers). The addon supports custom link
  providers for these — capture as a follow-up if anyone asks for
  e.g. "Ctrl+click a file path to open it in the editor."
- Inline preview / unfurl of links. Out of scope; this is just a
  click gesture.
- Mobile / touch behavior. On touch devices there's no Ctrl key —
  decide later whether long-press should open, or whether the
  feature is desktop-only. Either is fine for v1.
