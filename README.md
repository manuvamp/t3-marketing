# t3-marketing

Patches for [T3 Code](https://github.com/pingdotgg/t3code) (Alpha, Windows desktop build):

1. **Reveal in File Explorer fix**: makes "Reveal in File Explorer" / "Open in..." work on Windows.
2. **Marketing / Coding toggle**: splits T3 into two modes, each with its own chat list, and shows your own
   dashboard in the main area while in Marketing mode.

Not affiliated with T3 Code or Ping Labs. Both patches change the installed app, so re-run them after every T3 update.

## How the patches work

T3 ships its server and web UI inside `%LOCALAPPDATA%\Programs\t3code\resources\server.asar`. Each patch swaps a
byte string in that archive for another of **exactly the same length**, so no archive offsets move. That is only safe
because T3's Electron build has the `EnableEmbeddedAsarIntegrityValidation` fuse off; both scripts check the fuse
and refuse to patch if it's on. Each script makes a backup next to the archive the first time
(`server.asar.bak-reveal`, `server.asar.bak-toggle`), and refuses if its anchor text isn't found exactly once (meaning
T3 changed and the patch needs updating by hand).

After patching, fully quit T3 Code (tray icon too) and reopen it.

Requires Node.js 22.5+ (the toggle server uses `node:sqlite`).

## 1. Reveal in File Explorer fix

```
node patches/reveal-fix.cjs
```

**Bug:** T3's server starts its PowerShell helper with `spawn({ detached: true })`. On Windows that means
`DETACHED_PROCESS` (no console), and `powershell.exe` then exits 0 without running the script. Explorer never opens,
but T3 logs success.

**Fix:** `detached: true,` becomes `windowsHide:!0,` (both 15 characters) in the two launch paths (editor/file
manager and browser). The process gets a hidden console instead of none, and the script runs.

## 2. Marketing / Coding toggle

```
node server/server.mjs              # companion server on 127.0.0.1:4780 (keep it running, e.g. at login)
node patches/toggle-loader.cjs      # one-time patch (re-run after T3 updates)
node patches/toggle-loader.cjs --undo
```

- Click the "T3 Code" wordmark (or press **Ctrl+Alt+M**) to switch modes. In Marketing mode the wordmark is replaced by
  a red "Marketing" label and a **Dashboard** button appears.
- Each mode's left bar shows only the chats created in that mode, whatever folder they're in. A chat keeps the mode it
  was created in.
- In Marketing mode, `server/public/index.html` is shown over T3's main area until you open a chat. Replace that file
  with your own dashboard. The toggle posts `t3m:host`, `t3m:show` and `t3m:hide` to the frame; post `t3m:close` to the
  parent to switch back to Coding.
- If the server isn't running, T3 is unchanged.

**How:** T3's page (`apps/server/dist/client/index.html`) starts with an inline theme script. The patch replaces a
4-line comment in it with a same-length loader that fetches `http://localhost:4780/t3-toggle.js` and runs it inline.
T3's CSP allows inline scripts and http fetches but not cross-origin `<script src>`, hence fetch + inline. The
toggle re-fetches itself every 30 s, so editing `server/public/t3-toggle.js` takes effect without restarting T3.

The toggle only hides rows and overlays the dashboard; it never edits T3's React-owned DOM or its database. The server
reads T3's database (`~/.t3/userdata/state.sqlite`) read-only and keeps its own state in `server/data/t3-modes.json`.
It accepts only `127.0.0.1` / `localhost` Host headers (DNS-rebinding guard), and only T3's own page can record a mode
switch.

| Env var | Default |
| --- | --- |
| `T3_STATE_DB` | `~/.t3/userdata/state.sqlite` |
| `T3M_DATA` | `server/data` |

The port (4780) is baked into the same-length patch; changing it means changing both `server/server.mjs` and the
loader string in `patches/toggle-loader.cjs`.

### Optional: context for Marketing chats

`hooks/t3-chat-hook.mjs` is a Claude Code `SessionStart` hook. When a T3 chat in Marketing mode starts, it adds a short
note to the chat's context (edit `CONTEXT`, or point `T3M_CONTEXT_FILE` at a Markdown file). Add it to
`~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"C:/path/to/t3-marketing/hooks/t3-chat-hook.mjs\"" }] }
    ]
  }
}
```

## License

MIT
