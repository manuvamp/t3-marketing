// Fixes T3 Code (Alpha) "Reveal in File Explorer" / "Open in..." on Windows.
// Re-run after every T3 update, then fully quit and reopen T3:
//   node patches/reveal-fix.cjs
//
// Cause: the server launches its PowerShell helper with spawn({ detached: true }). On Windows that
// is DETACHED_PROCESS (no console), and powershell.exe then exits 0 without running the script, so
// Explorer is never started while T3 logs success. Not detached + windowsHide (hidden console) works.
//
// Patch: same-length byte replacement inside resources\server.asar (`detached: true,` ->
// `windowsHide:!0,`, both 15 chars), so no archive offsets move. Safe because this build has the
// EnableEmbeddedAsarIntegrityValidation fuse off (checked 2026-10-10); the script refuses otherwise.
const fs = require('fs');
const path = require('path');

const appDir = path.join(process.env.LOCALAPPDATA, 'Programs', 't3code');
const asar = path.join(appDir, 'resources', 'server.asar');
const exe = path.join(appDir, 'T3 Code (Alpha).exe');

// Fuse check: EnableEmbeddedAsarIntegrityValidation is fuse #4 after the sentinel + version + count.
const exeBuf = fs.readFileSync(exe);
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const at = exeBuf.indexOf(sentinel);
if (at < 0) throw new Error('Electron fuse sentinel not found; not patching');
if (String.fromCharCode(exeBuf[at + sentinel.length + 2 + 4]) !== '0')
  throw new Error('ASAR integrity validation is enabled in this T3 build; patching would break T3. Not patching.');

const edits = [
  {
    name: 'editor/file-manager launch (launchEditorProcess)',
    from: 'yield* launchAndUnref({\n\t\tcommand: spawnCommand.command,\n\t\targs: spawnCommand.args,\n\t\toptions: {\n\t\t\tdetached: true,',
    to: 'yield* launchAndUnref({\n\t\tcommand: spawnCommand.command,\n\t\targs: spawnCommand.args,\n\t\toptions: {\n\t\t\twindowsHide:!0,',
  },
  {
    name: 'browser launch (resolveWindowsBrowserLaunch)',
    from: 'args: [...POWERSHELL_ARGUMENTS_PREFIX, encodedCommand],\n\t\toptions: {\n\t\t\tdetached: true,',
    to: 'args: [...POWERSHELL_ARGUMENTS_PREFIX, encodedCommand],\n\t\toptions: {\n\t\t\twindowsHide:!0,',
  },
];

const data = fs.readFileSync(asar);
let changed = 0;
for (const e of edits) {
  const from = Buffer.from(e.from), to = Buffer.from(e.to);
  if (from.length !== to.length) throw new Error('length mismatch in ' + e.name);
  if (data.indexOf(to) >= 0 && data.indexOf(from) < 0) { console.log('already patched:', e.name); continue; }
  const i = data.indexOf(from);
  if (i < 0 || data.indexOf(from, i + 1) >= 0) throw new Error(`anchor for "${e.name}" not found exactly once; T3 changed, patch by hand`);
  to.copy(data, i);
  changed++;
  console.log('patched:', e.name);
}
if (changed) {
  const backup = asar + '.bak-reveal';
  if (!fs.existsSync(backup)) fs.copyFileSync(asar, backup);
  fs.writeFileSync(asar, data);
  console.log('wrote', asar, '(backup:', backup + ')');
  console.log('Fully quit T3 Code (tray icon too) and reopen it for the fix to take effect.');
}
