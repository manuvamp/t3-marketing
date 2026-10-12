// Adds the Marketing/Coding toggle to T3 Code: one line in its startup page, nothing else.
// Re-run after every T3 update, then fully quit T3 (tray icon too) and reopen it:
//   node patches/toggle-loader.cjs          (patch)
//   node patches/toggle-loader.cjs --undo   (put T3 back exactly as it was)
//
// How: T3's page (apps/server/dist/client/index.html inside resources\server.asar) starts with an inline theme
// script. We swap one 4-line comment in it for a same-length loader that fetches
// http://localhost:4780/t3-toggle.js and runs it inline. T3's CSP allows inline scripts, http fetches and http
// iframes, but not <script src> from another origin, hence fetch + inline. Same byte length, so no archive
// offsets move. That's safe because this build has the EnableEmbeddedAsarIntegrityValidation fuse off, and the
// script refuses otherwise. If the companion server (server/) isn't running the fetch fails quietly and T3 is unchanged.
const fs = require('fs');
const path = require('path');

const appDir = path.join(process.env.LOCALAPPDATA, 'Programs', 't3code');
const asar = path.join(appDir, 'resources', 'server.asar');
const exe = path.join(appDir, 'T3 Code (Alpha).exe');
const undo = process.argv.includes('--undo');

const exeBuf = fs.readFileSync(exe);
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const at = exeBuf.indexOf(sentinel);
if (at < 0) throw new Error('Electron fuse sentinel not found; not patching');
if (String.fromCharCode(exeBuf[at + sentinel.length + 2 + 4]) !== '0')
  throw new Error('ASAR integrity validation is enabled in this T3 build; patching would break T3. Not patching.');

const original = [
  '// These are the runtime defaults used to complete a custom palette',
  '        // when a stored theme omits a role. Keep them separate from the',
  '        // unselected splash so a partial custom theme does not flash generic',
  '        // app colors before React mounts.',
].join('\n');
const loader = 'try{fetch("http://localhost:4780/t3-toggle.js",{cache:"no-store"}).then(r=>r.ok?r.text():"")'
  + '.then(t=>{if(t){const s=document.createElement("script");s.textContent=t;document.head.append(s)}}).catch(()=>{})}catch(e){}';
if (loader.length > original.length) throw new Error('loader is longer than the comment it replaces');
const patched = loader + ' '.repeat(original.length - loader.length);

const [from, to] = (undo ? [patched, original] : [original, patched]).map((s) => Buffer.from(s, 'utf8'));
const data = fs.readFileSync(asar);
if (data.indexOf(to) >= 0 && data.indexOf(from) < 0) {
  console.log(undo ? 'T3 already has no toggle.' : 'T3 already has the toggle.');
  process.exit(0);
}
const i = data.indexOf(from);
if (i < 0 || data.indexOf(from, i + 1) >= 0) throw new Error('anchor not found exactly once; T3 changed, so update this script by hand');
const backup = asar + '.bak-toggle';
if (!undo && !fs.existsSync(backup)) fs.copyFileSync(asar, backup);
// Write only the changed bytes in place: T3 may be running and has this archive open.
const fd = fs.openSync(asar, 'r+');
try { fs.writeSync(fd, to, 0, to.length, i); } finally { fs.closeSync(fd); }
console.log(undo ? 'Removed the toggle from T3.' : `Added the toggle to T3 (backup: ${backup}).`);
console.log('Fully quit T3 Code (tray icon too) and reopen it.');
